import { parseAptitudeProgress } from './progress'
import { APTITUDE_CATEGORIES, parseAptitudeRequest, parseAptitudeResult } from './schema'
import type { AptitudeSessionEntry } from './useAptitudeSession'
import { buildAnswerGuidance, resultCandidates } from './guidance'
import { behavioralObservations, explanationObservations } from './behavioral'

export const APTITUDE_ARCHIVE_LIMIT = 100
export const APTITUDE_ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1_000
export const APTITUDE_ARCHIVE_MAX_CHARS = 200 * 1024 * 1024
export const APTITUDE_TAB_SESSION_KEY = 'lt.aptitude.tab-session.v1'
const FORMAT = 'livetranscript-aptitude-session-v1'
const DATABASE = 'livetranscript-aptitude-v1'
const SESSION_STORE = 'sessions'
const ENTRY_STORE = 'entries'
const STORAGE_TIMEOUT_MS = 5_000
const ID = /^[A-Za-z0-9._:-]{1,128}$/
const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const UNAVAILABLE = 'Session saving is unavailable in this browser. Keep this tab open and export the session before reloading.'
const NO_OWNER = 'Session saving requires a signed-in account. Current captures remain in this tab; export the session before reloading.'

type Manifest = { format: typeof FORMAT; id: string; ownerId: string; savedAt: number; entryIds: string[] }
type StoredSession = { manifest: unknown; entries: unknown[] }
export type AptitudeArchiveLoad = { entries: AptitudeSessionEntry[]; notice: string | null; savedAt: number | null }
export type AptitudeArchiveSave = { saved: boolean; notice: string | null; savedAt: number | null }

/** The injected store supports deterministic quota/race tests without changing browser permissions. */
export type AptitudeArchiveStorage = {
  read(sessionId: string): Promise<StoredSession | null>
  write(manifest: Manifest, changedEntries: AptitudeSessionEntry[], removedIds: string[]): Promise<void>
  remove(sessionId: string): Promise<void>
  purgeBefore(timestamp: number): Promise<void>
  close(): void
}
type ArchiveOptions = {
  ownerId?: string | null
  storage?: AptitudeArchiveStorage
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>
  now?: () => number
  randomId?: () => string
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid saved ${name}`)
  return value as Record<string, unknown>
}
function boundedText(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid saved ${name}`)
  return value
}
function integer(value: unknown, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`Invalid saved ${name}`)
  return value
}
function timestamp(value: unknown, now: number, name: string): number {
  return integer(value, now + 300_000, name)
}

/** Local records are untrusted. Only known fields survive validation and export. */
export function parseArchivedAptitudeEntry(value: unknown, now = Date.now()): AptitudeSessionEntry {
  const item = record(value, 'question')
  const capture = record(item.capture, 'capture')
  const id = boundedText(item.id, 128, 'question ID')
  if (!ID.test(id)) throw new Error('Invalid saved question ID')
  const questionVersion = integer(item.questionVersion, 2_147_483_647, 'attempt number')
  const request = parseAptitudeRequest({ captureId: capture.id, questionVersion, image: capture.image, category: item.category, strategy: item.strategy })
  const sourceHash = boundedText(capture.sourceHash, 128, 'capture fingerprint')
  if (!sourceHash.trim()) throw new Error('Invalid saved capture fingerprint')
  const width = integer(capture.width, 8192, 'capture width'), height = integer(capture.height, 8192, 'capture height')
  if (!width || !height || width * height > 24_000_000) throw new Error('Invalid saved capture dimensions')
  const capturedAt = timestamp(capture.capturedAt, now, 'capture time')
  const startedAt = timestamp(item.startedAt, now, 'start time')
  const finishedAt = item.finishedAt === null ? null : timestamp(item.finishedAt, now, 'finish time')
  const elapsedMs = item.elapsedMs === null ? null : integer(item.elapsedMs, APTITUDE_ARCHIVE_TTL_MS, 'elapsed time')
  if (startedAt < capturedAt || (finishedAt !== null && finishedAt < startedAt)) throw new Error('Invalid saved time order')
  if (!['analyzing', 'complete', 'cancelled', 'error'].includes(String(item.status))) throw new Error('Invalid saved analysis status')
  const status = item.status as AptitudeSessionEntry['status']
  const error = item.error === null ? null : boundedText(item.error, 1_000, 'error')
  const result = item.result === null ? null : parseAptitudeResult(item.result)
  if (result && (result.captureId !== request.captureId || result.questionVersion !== questionVersion)) throw new Error('Saved answer belongs to another capture or attempt')
  if (result && ((request.strategy === 'compare') !== Boolean(result.comparison))) throw new Error('Saved answer belongs to another analysis mode')
  if (status === 'complete' && (!result || result.status === 'error')) throw new Error('Saved completed question has no complete result')
  if ((status === 'analyzing' || status === 'cancelled') && result) throw new Error('Saved unfinished question has a final result')
  if (status === 'analyzing' ? finishedAt !== null || elapsedMs !== null : finishedAt === null || elapsedMs === null) throw new Error('Invalid saved completion timing')
  const progress = item.progress == null ? null : parseAptitudeProgress(item.progress)
  if (progress && request.strategy !== 'compare') throw new Error('Saved progress belongs to another analysis mode')
  if (progress && result) {
    const candidates = result.comparison?.candidates ?? []
    if (progress.sourceHash !== result.sourceHash || progress.models.length !== candidates.length
      || progress.models.some(model => !candidates.some(candidate => candidate.modelId === model.modelId && candidate.provider === model.provider))
      || progress.candidates.some(candidate => JSON.stringify(candidate) !== JSON.stringify(candidates.find(final => final.modelId === candidate.modelId)))) throw new Error('Saved progress does not match the final result')
  }
  return { id, capture: { id: request.captureId, image: request.image, sourceHash, width, height, capturedAt },
    category: request.category, strategy: request.strategy!, questionVersion, status, result, error, startedAt, finishedAt, elapsedMs,
    ...('progress' in item ? { progress } : {}) }
}

function parseManifest(value: unknown, expectedId: string, now: number, expectedOwner?: string): Manifest {
  const item = record(value, 'session')
  if (item.format !== FORMAT || item.id !== expectedId) throw new Error('Saved session does not belong to this tab')
  if (typeof item.ownerId !== 'string' || !ID.test(item.ownerId) || (expectedOwner !== undefined && item.ownerId !== expectedOwner)) throw new Error('Saved session does not belong to this signed-in account')
  const savedAt = timestamp(item.savedAt, now, 'save time')
  if (!Array.isArray(item.entryIds) || item.entryIds.length > APTITUDE_ARCHIVE_LIMIT || item.entryIds.some(id => typeof id !== 'string' || !ID.test(id)) || new Set(item.entryIds).size !== item.entryIds.length) throw new Error('Invalid saved session index')
  return { format: FORMAT, id: expectedId, ownerId: item.ownerId, savedAt, entryIds: item.entryIds as string[] }
}

function storageFailure(error: unknown): string {
  // DOMException is not an Error in every browser/realm.
  const failure = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : null
  return failure && (failure.name === 'QuotaExceededError' || (typeof failure.message === 'string' && /quota/i.test(failure.message)))
    ? 'Browser storage is full. Your current captures remain in this tab; export the session before reloading.'
    : 'The session could not be saved in this browser. Keep this tab open and export before reloading.'
}

function browserStorage(): AptitudeArchiveStorage {
  if (typeof window === 'undefined' || !window.indexedDB) throw new Error('IndexedDB unavailable')
  let database: Promise<IDBDatabase> | null = null
  let closed = false
  const open = () => {
    if (closed) return Promise.reject(new Error('Session archive is closed'))
    if (database) return database
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE, 1)
      let settled = false
      const timer = setTimeout(() => { settled = true; reject(new Error('Session storage did not respond')) }, STORAGE_TIMEOUT_MS)
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject((request.readyState === 'done' ? request.error : null) ?? new Error('Session storage is blocked')) } }
      request.onblocked = fail
      request.onerror = fail
      request.onupgradeneeded = () => {
        const db = request.result
        const sessions = db.createObjectStore(SESSION_STORE, { keyPath: 'id' })
        sessions.createIndex('savedAt', 'savedAt')
        const entries = db.createObjectStore(ENTRY_STORE, { keyPath: 'key' })
        entries.createIndex('sessionId', 'sessionId')
      }
      request.onsuccess = () => {
        if (settled || closed) { request.result.close(); return }
        settled = true; clearTimeout(timer)
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    })
    return database
  }
  async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([SESSION_STORE, ENTRY_STORE], mode)
      let value: T
      const timer = setTimeout(() => { reject(new Error('Session storage did not respond')); try { tx.abort() } catch { /* already finished */ } }, STORAGE_TIMEOUT_MS)
      tx.oncomplete = () => { clearTimeout(timer); resolve(value) }
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error ?? new Error('Session storage failed')) }
      try { work(tx, next => { value = next }) } catch (error) { clearTimeout(timer); try { tx.abort() } catch { /* already finished */ } reject(error) }
    })
  }
  const removeRows = (tx: IDBTransaction, sessionId: string) => {
    tx.objectStore(SESSION_STORE).delete(sessionId)
    const cursor = tx.objectStore(ENTRY_STORE).index('sessionId').openCursor(IDBKeyRange.only(sessionId))
    cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue() } }
  }
  return {
    read: sessionId => transaction<StoredSession | null>('readonly', (tx, result) => {
      result(null)
      const request = tx.objectStore(SESSION_STORE).get(sessionId)
      request.onsuccess = () => {
        if (!request.result) return
        let manifest: Manifest
        try { manifest = parseManifest(request.result, sessionId, Date.now()) } catch { tx.abort(); return }
        const entries: unknown[] = new Array(manifest.entryIds.length)
        result({ manifest, entries })
        manifest.entryIds.forEach((id, index) => {
          const entry = tx.objectStore(ENTRY_STORE).get(`${sessionId}|${id}`)
          entry.onsuccess = () => { entries[index] = entry.result?.entry }
        })
      }
    }),
    write: (manifest, changedEntries, removedIds) => transaction<void>('readwrite', (tx, result) => {
      tx.objectStore(SESSION_STORE).put(manifest)
      const store = tx.objectStore(ENTRY_STORE)
      for (const entry of changedEntries) store.put({ key: `${manifest.id}|${entry.id}`, sessionId: manifest.id, entry })
      for (const id of removedIds) store.delete(`${manifest.id}|${id}`)
      result(undefined)
    }),
    remove: sessionId => transaction<void>('readwrite', (tx, result) => { removeRows(tx, sessionId); result(undefined) }),
    purgeBefore: before => transaction<void>('readwrite', (tx, result) => {
      const cursor = tx.objectStore(SESSION_STORE).index('savedAt').openCursor(IDBKeyRange.upperBound(before))
      cursor.onsuccess = () => { if (cursor.result) { removeRows(tx, String(cursor.result.primaryKey)); cursor.result.continue() } }
      result(undefined)
    }),
    close: () => { closed = true; if (database) void database.then(db => db.close()).catch(() => {}) },
  }
}

/** No screenshot or answer is uploaded by this archive. The authenticated owner
 * comes from the server page; no anonymous fallback is created here. The tab key
 * is held in sessionStorage, scoped to that owner and ordinary browser tab. */
export function createAptitudeSessionArchive(options: ArchiveOptions = {}) {
  const now = options.now ?? Date.now
  const ownerId = typeof options.ownerId === 'string' && ID.test(options.ownerId) ? options.ownerId : null
  const unavailableNotice = ownerId ? UNAVAILABLE : NO_OWNER
  let storage: AptitudeArchiveStorage | null = null
  let sessionId = ''
  let savedAt: number | null = null
  let closing = false
  let recoveryNotice: string | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let cached = new Map<string, { original: AptitudeSessionEntry; parsed: AptitudeSessionEntry; chars: number }>()
  try {
    if (!ownerId) throw new Error('An authenticated owner is required for session recovery')
    const tabStorage = options.sessionStorage ?? window.sessionStorage
    const key = `${APTITUDE_TAB_SESSION_KEY}:${ownerId}`
    const previous = tabStorage.getItem(key)
    sessionId = previous && SESSION_ID.test(previous) ? previous : (options.randomId ?? (() => crypto.randomUUID()))()
    if (!SESSION_ID.test(sessionId)) throw new Error('Invalid session identity')
    if (previous !== sessionId) tabStorage.setItem(key, sessionId)
    storage = options.storage ?? browserStorage()
  } catch { storage = null }
  function sequential<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation)
    queue = next.catch(() => {})
    return next
  }
  return {
    load(): Promise<AptitudeArchiveLoad> {
      if (!storage || closing) return Promise.resolve({ entries: [], notice: unavailableNotice, savedAt: null })
      const store = storage
      return sequential(async () => {
        try {
          const value = await store.read(sessionId)
          if (!value) { await store.purgeBefore(now() - APTITUDE_ARCHIVE_TTL_MS).catch(() => {}); return { entries: [], notice: null, savedAt: null } }
          const manifest = parseManifest(value.manifest, sessionId, now(), ownerId!)
          if (now() - manifest.savedAt >= APTITUDE_ARCHIVE_TTL_MS) {
            await store.remove(sessionId)
            return { entries: [], notice: 'The previous saved session expired after seven days.', savedAt: null }
          }
          if (value.entries.length !== manifest.entryIds.length) throw new Error('Saved capture index is incomplete')
          let chars = 0, interrupted = 0
          const entries = value.entries.map((value, index) => {
            const entry = parseArchivedAptitudeEntry(value, now())
            if (entry.id !== manifest.entryIds[index]) throw new Error('Saved capture index does not match its questions')
            const size = JSON.stringify(entry).length
            chars += size
            if (chars > APTITUDE_ARCHIVE_MAX_CHARS) throw new Error('Saved session exceeds its size limit')
            if (entry.status === 'analyzing') {
              interrupted++
              return { ...entry, status: 'cancelled' as const, error: 'Analysis was interrupted by a reload. The capture and completed model responses were kept; retry when ready.',
                finishedAt: Math.max(manifest.savedAt, entry.startedAt), elapsedMs: Math.max(0, manifest.savedAt - entry.startedAt) }
            }
            return entry
          })
          savedAt = manifest.savedAt
          recoveryNotice = null
          cached = new Map(entries.map((entry, index) => [entry.id, { original: record(value.entries[index], 'question').status === 'analyzing' ? value.entries[index] as AptitudeSessionEntry : entry, parsed: entry, chars: JSON.stringify(entry).length }]))
          await store.purgeBefore(now() - APTITUDE_ARCHIVE_TTL_MS).catch(() => {})
          return { entries, savedAt, notice: interrupted ? `Restored ${entries.length} questions. ${interrupted} interrupted analysis${interrupted === 1 ? ' was' : 'es were'} stopped; completed model responses remain available.` : entries.length ? `Restored ${entries.length} saved questions in this tab.` : null }
        } catch {
          recoveryNotice = 'The saved session could not be read safely. It was not loaded or overwritten. Current analysis still works; export new captures before reloading. Clear history to resume saving.'
          return { entries: [], savedAt: null, notice: recoveryNotice }
        }
      })
    },
    save(entries: readonly AptitudeSessionEntry[]): Promise<AptitudeArchiveSave> {
      if (!storage || closing) return Promise.resolve({ saved: false, notice: unavailableNotice, savedAt })
      const store = storage
      // Snapshot the list before queueing so caller mutations cannot replace a pending save.
      const snapshot = [...entries]
      return sequential(async () => {
        // A load/clear failure must never be followed by a React effect replacing
        // the unread saved copy with an empty or unrelated in-memory session.
        if (recoveryNotice) return { saved: false, savedAt, notice: recoveryNotice }
        try {
          if (snapshot.length > APTITUDE_ARCHIVE_LIMIT) return { saved: false, savedAt, notice: 'This session exceeds the 100-question save limit. Export it before starting a new session; the previous saved copy was kept.' }
          const next = new Map<string, { original: AptitudeSessionEntry; parsed: AptitudeSessionEntry; chars: number }>()
          const changed: AptitudeSessionEntry[] = []
          let chars = 0
          for (const entry of snapshot) {
            const previous = cached.get(entry.id)
            const item = previous?.original === entry ? previous : (() => {
              const parsed = parseArchivedAptitudeEntry(entry, now())
              return { original: entry, parsed, chars: JSON.stringify(parsed).length }
            })()
            if (next.has(item.parsed.id)) throw new Error('Duplicate question IDs')
            next.set(item.parsed.id, item); chars += item.chars
            if (item !== previous) changed.push(item.parsed)
          }
          if (chars > APTITUDE_ARCHIVE_MAX_CHARS) return { saved: false, savedAt, notice: 'This session is too large to save in this browser. Export it before reloading; the previous saved copy was kept.' }
          const removed = [...cached.keys()].filter(id => !next.has(id))
          const notice = snapshot.length === APTITUDE_ARCHIVE_LIMIT ? '100 questions are saved. Export this session before older questions leave the history.' : null
          if (!changed.length && !removed.length && savedAt !== null) return { saved: true, notice, savedAt }
          const time = now()
          await store.write({ format: FORMAT, id: sessionId, ownerId: ownerId!, savedAt: time, entryIds: [...next.keys()] }, changed, removed)
          cached = next; savedAt = time
          return { saved: true, notice, savedAt }
        } catch (error) { return { saved: false, notice: storageFailure(error), savedAt } }
      })
    },
    clear(): Promise<AptitudeArchiveSave> {
      if (!storage || closing) return Promise.resolve({ saved: false, notice: 'The saved copy could not be cleared. Browser storage is unavailable.', savedAt })
      const store = storage
      return sequential(async () => {
        try { await store.remove(sessionId); cached.clear(); savedAt = null; recoveryNotice = null; return { saved: true, notice: null, savedAt: null } }
        catch {
          recoveryNotice = 'The saved copy could not be cleared. Saving is paused to protect it. Try clearing history again, or clear this site’s browser storage to remove it.'
          return { saved: false, savedAt, notice: recoveryNotice }
        }
      })
    },
    close() { closing = true; if (storage) { const store = storage; void queue.then(() => store.close()) } },
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** A downloadable record of suggestions, not an invented assessment score.
 * Never sends data, opens a download or mutates the running session itself. */
export function buildAptitudeSessionExport(entries: readonly AptitudeSessionEntry[], now = Date.now()): { filename: string; text: string } {
  if (entries.length > APTITUDE_ARCHIVE_LIMIT) throw new Error('Export supports up to 100 retained questions')
  const parsed = entries.map(entry => parseArchivedAptitudeEntry(entry, now))
  if (new Set(parsed.map(entry => entry.id)).size !== parsed.length) throw new Error('Duplicate question IDs in the session export')
  const firstCapturedAt = parsed.length ? Math.min(...parsed.map(entry => entry.capture.capturedAt)) : null
  const lastFinishedAt = parsed.length ? Math.max(...parsed.map(entry => entry.finishedAt ?? entry.startedAt)) : null
  const exportedAt = new Date(now).toISOString()
  const data = {
    format: FORMAT, exportedAt,
    scope: 'Retained questions in this browser tab. Each entry contains its latest retained attempt, not every previous retry.',
    confidenceMeaning: 'Confidence values are uncalibrated model estimates, not measured answer accuracy.',
    submittedAnswersRecorded: false, answerKeyIncluded: false, accuracy: null,
    reviewNote: 'The app records suggested answers. It does not observe which answers were submitted on another website or its grading. Correctness requires reviewing the captured evidence against an independent answer key.',
    counts: { retainedEntries: parsed.length, captures: new Set(parsed.map(entry => entry.capture.id)).size,
      completed: parsed.filter(entry => entry.status === 'complete').length, interrupted: parsed.filter(entry => entry.status === 'cancelled').length,
      errors: parsed.filter(entry => entry.status === 'error').length, stillAnalyzing: parsed.filter(entry => entry.status === 'analyzing').length },
    timing: { firstCapturedAt, lastFinishedAt, observedSpanMs: firstCapturedAt !== null && lastFinishedAt !== null ? Math.max(0, lastFinishedAt - firstCapturedAt) : null,
      medianFirstAnswerMs: median(parsed.flatMap(entry => entry.progress?.firstAnswerMs == null ? [] : [entry.progress.firstAnswerMs])),
      medianCompletedAnalysisMs: median(parsed.flatMap(entry => entry.status === 'complete' && entry.elapsedMs !== null ? [entry.elapsedMs] : [])),
      note: 'Capture and analysis timestamps measure this app’s observed activity, not the time spent answering on another website.' },
    categories: APTITUDE_CATEGORIES.filter(category => parsed.some(entry => entry.result?.category === category)),
    guidanceMeaning: 'Local heuristic recommendations and difficulty estimates. Confidence scores are not measured accuracy; no extra model call or tracking event is made.',
    guidance: parsed.map(entry => {
      const candidates = entry.result ? resultCandidates(entry.result) : entry.progress?.candidates ?? []
      const behavioral = behavioralObservations(candidates)
      const explanations = explanationObservations(candidates)
      if (explanations) return { captureId: entry.id, label: behavioral ? 'Behavioral guidance' : 'Question response', confidenceScore: null,
        confidenceBasis: 'This explanatory response has no checked answer or applicable correctness score.',
        difficulty: { level: 'Not rated', reasons: ['No objective answer key is supplied.'] },
        recommendedModelId: null, explanations: explanations.map(o => o.message).filter(Boolean) }
      const guide = buildAnswerGuidance(candidates, entry.status === 'analyzing')
      const { candidate, ...summary } = guide
      return { captureId: entry.id, ...summary, recommendedModelId: candidate?.modelId ?? null }
    }),
    entries: parsed,
  }
  return { filename: `livetranscript-aptitude-${exportedAt.replace(/[:.]/g, '-')}.json`, text: JSON.stringify(data, null, 2) }
}
