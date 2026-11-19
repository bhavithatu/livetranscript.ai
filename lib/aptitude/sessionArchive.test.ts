import { describe, expect, it, vi } from 'vitest'
import { comparisonFixture } from '@/components/aptitude/comparisonTestFixtures'
import { solvedObservation, TEST_IMAGE } from './testFixtures'
import { BEHAVIORAL_PRACTICE } from './behavioralFixtures'
import type { AptitudeSessionEntry } from './useAptitudeSession'
import type { AptitudeArchiveStorage } from './sessionArchive'
import {
  APTITUDE_ARCHIVE_LIMIT, APTITUDE_ARCHIVE_TTL_MS, APTITUDE_TAB_SESSION_KEY,
  buildAptitudeSessionExport, createAptitudeSessionArchive, parseArchivedAptitudeEntry,
} from './sessionArchive'

const NOW = 1_790_000_000_000
const SESSION = '11111111-2222-4333-8444-555555555555'
const OTHER_SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const OWNER = 'user_archive_test'
type Manifest = Parameters<AptitudeArchiveStorage['write']>[0]

function question(id = 'question-1', now = NOW): AptitudeSessionEntry {
  return { id, capture: { id, image: TEST_IMAGE, capturedAt: now - 5_000, width: 1, height: 1, sourceHash: 'capture-fingerprint' },
    category: 'auto', strategy: 'single', questionVersion: 1, status: 'complete', error: null,
    startedAt: now - 4_000, finishedAt: now - 3_000, elapsedMs: 1_000,
    result: { ...solvedObservation(), schemaVersion: 1, captureId: id, questionVersion: 1, questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
      verification: { method: 'arithmetic', outcome: 'passed', notes: ['Stated arithmetic agrees.'] }, model: 'gpt-6.2-sol', provider: 'openai', durationMs: 900 },
  }
}

function tab(sessionId = SESSION, ownerId = OWNER) {
  const values = new Map<string, string>([[`${APTITUDE_TAB_SESSION_KEY}:${ownerId}`, sessionId]])
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

class MemoryStorage implements AptitudeArchiveStorage {
  sessions = new Map<string, { manifest: Manifest; entries: unknown[] }>()
  writes: number[] = []
  removed: string[] = []
  writeError: Error | null = null
  readError: Error | null = null
  waitForWrite: Promise<void> | null = null
  closed = false
  async read(id: string) {
    if (this.readError) throw this.readError
    return structuredClone(this.sessions.get(id) ?? null)
  }
  async write(manifest: Manifest, changed: AptitudeSessionEntry[], removedIds: string[]) {
    this.writes.push(changed.length)
    if (this.waitForWrite) await this.waitForWrite
    if (this.writeError) throw this.writeError
    const previous = this.sessions.get(manifest.id)?.entries ?? []
    const entries = new Map(previous.map(entry => [(entry as AptitudeSessionEntry).id, entry]))
    for (const entry of changed) entries.set(entry.id, structuredClone(entry))
    for (const id of removedIds) entries.delete(id)
    this.sessions.set(manifest.id, { manifest: structuredClone(manifest), entries: manifest.entryIds.map(id => entries.get(id)) })
  }
  async remove(id: string) { this.removed.push(id); this.sessions.delete(id) }
  async purgeBefore(timestamp: number) { for (const [id, session] of this.sessions) if (session.manifest.savedAt <= timestamp) await this.remove(id) }
  close() { this.closed = true }
}

function archive(storage: MemoryStorage, sessionStorage = tab(), now = NOW) {
  return createAptitudeSessionArchive({ ownerId: OWNER, storage, sessionStorage, now: () => now })
}

describe('Aptitude session recovery and export', () => {
  it('retains and restores a full forty-question session with exact captures and model results', async () => {
    const storage = new MemoryStorage(), sessionStorage = tab()
    const entries = Array.from({ length: 40 }, (_, index) => question(`question-${index + 1}`))
    const first = archive(storage, sessionStorage)
    expect(await first.load()).toEqual({ entries: [], notice: null, savedAt: null })
    expect(await first.save(entries)).toEqual({ saved: true, savedAt: NOW, notice: null })
    first.close()
    const recovered = await archive(storage, sessionStorage).load()
    expect(recovered.entries).toEqual(entries)
    expect(recovered.entries).toHaveLength(40)
    expect(recovered.entries[39].capture.image).toBe(TEST_IMAGE)
    expect(recovered.entries[39].result?.model).toBe('gpt-6.2-sol')
    expect(recovered.notice).toMatch(/Restored 40/)
  })

  it('does not load another tab’s session', async () => {
    const storage = new MemoryStorage()
    await archive(storage).save([question()])
    expect((await archive(storage, tab(OTHER_SESSION)).load()).entries).toEqual([])
    expect(storage.sessions.get(SESSION)?.entries).toHaveLength(1)
  })

  it('isolates a second signed-in account in the same tab and restores the original account separately', async () => {
    const storage = new MemoryStorage(), sessionStorage = tab()
    await archive(storage, sessionStorage).save([question('owner-a')])
    const second = createAptitudeSessionArchive({ ownerId: 'user_second', storage, sessionStorage, now: () => NOW, randomId: () => OTHER_SESSION })
    expect(await second.load()).toEqual({ entries: [], notice: null, savedAt: null })
    expect(sessionStorage.getItem(`${APTITUDE_TAB_SESSION_KEY}:user_second`)).toBe(OTHER_SESSION)
    await second.save([question('owner-b')])
    expect((await archive(storage, sessionStorage).load()).entries.map(entry => entry.id)).toEqual(['owner-a'])
    expect((await second.load()).entries.map(entry => entry.id)).toEqual(['owner-b'])
  })

  it('rejects a different account’s saved record even when a tab points at its session ID', async () => {
    const storage = new MemoryStorage()
    await archive(storage).save([question()])
    const second = createAptitudeSessionArchive({ ownerId: 'user_second', storage, sessionStorage: tab(SESSION, 'user_second'), now: () => NOW })
    expect(await second.load()).toMatchObject({ entries: [], notice: expect.stringContaining('could not be read safely') })
    expect(await second.save([])).toMatchObject({ saved: false })
    expect(storage.sessions.get(SESSION)!.manifest.ownerId).toBe(OWNER)
    expect(storage.sessions.get(SESSION)!.entries).toHaveLength(1)
  })

  it('does not persist or read history without an authenticated owner', async () => {
    const storage = new MemoryStorage(), sessionStorage = tab()
    await archive(storage).save([question()])
    const read = vi.spyOn(storage, 'read')
    const anonymous = createAptitudeSessionArchive({ storage, sessionStorage, now: () => NOW })
    expect(await anonymous.load()).toMatchObject({ entries: [], notice: expect.stringContaining('signed-in account') })
    expect(await anonymous.save([question('new')])).toMatchObject({ saved: false, notice: expect.stringContaining('signed-in account') })
    expect(read).not.toHaveBeenCalled()
    expect(storage.writes).toEqual([1])
    expect(JSON.parse(buildAptitudeSessionExport([question()], NOW).text).entries).toHaveLength(1)
  })

  it('rejects a foreign manifest even if returned under the current tab key', async () => {
    const storage = new MemoryStorage()
    await archive(storage).save([question()])
    storage.sessions.get(SESSION)!.manifest.id = OTHER_SESSION
    const restored = await archive(storage).load()
    expect(restored.entries).toEqual([])
    expect(restored.notice).toMatch(/could not be read safely/)
    expect(storage.sessions.has(SESSION)).toBe(true)
  })

  it.each(['capture', 'attempt', 'mode', 'missing row'])('refuses a saved %s mismatch instead of attaching the wrong answer', async kind => {
    const storage = new MemoryStorage()
    await archive(storage).save([question()])
    const saved = storage.sessions.get(SESSION)!
    const entry = saved.entries[0] as AptitudeSessionEntry
    if (kind === 'capture') entry.result!.captureId = 'another-question'
    if (kind === 'attempt') entry.result!.questionVersion = 2
    if (kind === 'mode') entry.strategy = 'compare'
    if (kind === 'missing row') saved.entries = []
    const recovered = await archive(storage).load()
    expect(recovered.entries).toEqual([])
    expect(recovered.notice).toMatch(/could not be read safely/)
  })

  it.each(['https://example.test/remote.png', 'data:image/svg+xml;base64,PHN2Zy8+'])('rejects non-capture image data %s', image => {
    const entry = question(); entry.capture.image = image
    expect(() => parseArchivedAptitudeEntry(entry, NOW)).toThrow()
    expect(() => buildAptitudeSessionExport([entry], NOW)).toThrow()
  })

  it('retains a completed first model when a comparison is interrupted by reload', async () => {
    const storage = new MemoryStorage()
    const entry = question()
    const compared = comparisonFixture(entry.result!)
    entry.strategy = 'compare'; entry.status = 'analyzing'; entry.result = null; entry.finishedAt = null; entry.elapsedMs = null
    entry.progress = { sourceHash: compared.sourceHash,
      models: compared.comparison!.candidates.map(candidate => ({ modelId: candidate.modelId, model: candidate.model!, provider: candidate.provider })),
      candidates: [compared.comparison!.candidates[0]], firstAnswerMs: 1_370 }
    await archive(storage).save([entry])
    const second = archive(storage)
    const recovered = await second.load()
    expect(recovered.entries[0]).toMatchObject({ status: 'cancelled', result: null, finishedAt: NOW, elapsedMs: 4_000,
      progress: { firstAnswerMs: 1_370, candidates: [{ modelId: 'openai:test-model-a' }] } })
    expect(recovered.entries[0].progress?.candidates[0].observation?.answer?.selectedOptionIds).toEqual(['B'])
    expect(recovered.notice).toMatch(/1 interrupted analysis was stopped/)
    await second.save(recovered.entries)
    expect((storage.sessions.get(SESSION)!.entries[0] as AptitudeSessionEntry).status).toBe('cancelled')
  })

  it('rejects progressive suggestions that disagree with their final saved comparison', () => {
    const entry = question()
    entry.strategy = 'compare'; entry.result = comparisonFixture(entry.result!)
    entry.progress = { sourceHash: entry.result.sourceHash,
      models: entry.result.comparison!.candidates.map(candidate => ({ modelId: candidate.modelId, model: candidate.model!, provider: candidate.provider })),
      candidates: structuredClone(entry.result.comparison!.candidates), firstAnswerMs: 1_370 }
    expect(parseArchivedAptitudeEntry(entry, NOW)).toEqual(entry)
    entry.progress.candidates[0].observation!.answer!.value = 'corrupted suggestion'
    expect(() => parseArchivedAptitudeEntry(entry, NOW)).toThrow(/does not match/)
  })

  it('expires an old saved session without presenting it as current work', async () => {
    const storage = new MemoryStorage(), old = NOW - APTITUDE_ARCHIVE_TTL_MS
    await archive(storage, tab(), old).save([question('old', old)])
    const recovered = await archive(storage).load()
    expect(recovered).toEqual({ entries: [], notice: 'The previous saved session expired after seven days.', savedAt: null })
    expect(storage.sessions.has(SESSION)).toBe(false)
  })

  it('warns at capacity and preserves the previous saved copy when over the limit', async () => {
    const storage = new MemoryStorage(), session = archive(storage)
    const entries = Array.from({ length: APTITUDE_ARCHIVE_LIMIT }, (_, index) => question(`q-${index}`))
    expect(await session.save(entries)).toMatchObject({ saved: true, notice: expect.stringContaining('100 questions') })
    expect(await session.save([...entries, question('too-many')])).toMatchObject({ saved: false, notice: expect.stringContaining('100-question save limit') })
    expect(storage.sessions.get(SESSION)?.entries).toHaveLength(100)
  })

  it('writes only changed entries so each model response does not rewrite every screenshot', async () => {
    const storage = new MemoryStorage(), session = archive(storage)
    const entries = [question('one'), question('two')]
    await session.save(entries)
    await session.save([...entries])
    await session.save([entries[0], { ...entries[1], elapsedMs: 1_100 }])
    expect(storage.writes).toEqual([2, 1])
  })

  it('reports quota failure while preserving the previously saved version', async () => {
    const storage = new MemoryStorage(), session = archive(storage)
    await session.save([question('saved')])
    storage.writeError = new DOMException('Storage full', 'QuotaExceededError')
    const status = await session.save([question('new')])
    expect(status).toMatchObject({ saved: false, savedAt: NOW, notice: expect.stringContaining('storage is full') })
    expect((storage.sessions.get(SESSION)!.entries[0] as AptitudeSessionEntry).id).toBe('saved')
  })

  it('serializes a pending save before clearing so it cannot resurrect cleared captures', async () => {
    const storage = new MemoryStorage(), session = archive(storage)
    let finishWrite!: () => void
    storage.waitForWrite = new Promise(resolve => { finishWrite = resolve })
    const saved = session.save([question()])
    await Promise.resolve()
    const cleared = session.clear()
    expect(storage.removed).toEqual([])
    finishWrite()
    expect(await saved).toMatchObject({ saved: true })
    expect(await cleared).toEqual({ saved: true, notice: null, savedAt: null })
    expect(storage.sessions.has(SESSION)).toBe(false)
  })

  it('continues in memory and supports export when sessionStorage is blocked', async () => {
    const storage = new MemoryStorage()
    const blocked = createAptitudeSessionArchive({ ownerId: OWNER, storage, sessionStorage: { getItem: () => { throw new Error('Blocked') }, setItem: vi.fn() } })
    expect(await blocked.load()).toMatchObject({ entries: [], notice: expect.stringContaining('saving is unavailable') })
    expect(await blocked.save([question()])).toMatchObject({ saved: false })
    expect(JSON.parse(buildAptitudeSessionExport([question()], NOW).text).entries).toHaveLength(1)
    expect(storage.writes).toEqual([])
  })

  it('reports a clear failure instead of claiming screenshots were deleted', async () => {
    const storage = new MemoryStorage(), session = archive(storage)
    await session.save([question()])
    storage.remove = async () => { throw new Error('Blocked') }
    expect(await session.clear()).toMatchObject({ saved: false, notice: expect.stringContaining('could not be cleared') })
    expect(await session.save([])).toMatchObject({ saved: false, notice: expect.stringContaining('could not be cleared') })
    expect(storage.sessions.has(SESSION)).toBe(true)
    expect(storage.sessions.get(SESSION)!.entries).toHaveLength(1)
  })

  it('preserves an unread saved copy when the load fails and saving immediately follows', async () => {
    const storage = new MemoryStorage()
    await archive(storage).save([question('previous')])
    storage.readError = new Error('Read failed temporarily')
    const reloaded = archive(storage)
    const recovered = await reloaded.load()
    expect(recovered.entries).toEqual([])
    expect(await reloaded.save([])).toMatchObject({ saved: false, notice: recovered.notice })
    expect(await reloaded.save([question('new')])).toMatchObject({ saved: false, notice: recovered.notice })
    expect(storage.writes).toEqual([1])
    expect((storage.sessions.get(SESSION)!.entries[0] as AptitudeSessionEntry).id).toBe('previous')
    expect(await reloaded.clear()).toMatchObject({ saved: true })
    expect(await reloaded.save([question('new')])).toMatchObject({ saved: true })
    expect((storage.sessions.get(SESSION)!.entries[0] as AptitudeSessionEntry).id).toBe('new')
  })

  it('exports exact suggestions and timing without inventing user submissions or accuracy', () => {
    const one = question('one'), two = question('two')
    one.result!.answer!.confidence = 91
    const exportFile = buildAptitudeSessionExport([one, two], NOW)
    const data = JSON.parse(exportFile.text)
    expect(exportFile.filename).toMatch(/^livetranscript-aptitude-.*\.json$/)
    expect(data).toMatchObject({ format: 'livetranscript-aptitude-session-v1', submittedAnswersRecorded: false,
      answerKeyIncluded: false, accuracy: null, counts: { retainedEntries: 2, captures: 2, completed: 2 },
      timing: { medianCompletedAnalysisMs: 1_000, medianFirstAnswerMs: null, observedSpanMs: 2_000 } })
    expect(data.entries).toEqual([one, two])
    expect(data.entries[0].capture.image).toBe(TEST_IMAGE)
    expect(data.entries[0].result.answer.confidence).toBe(91)
    expect(data.reviewNote).toMatch(/independent answer key/)
    expect(data.scope).toMatch(/not every previous retry/)
  })

  it('strips unknown local metadata and rejects duplicated exported rows', () => {
    const entry = { ...question(), unintendedMetadata: 'must not export' }
    expect(buildAptitudeSessionExport([entry], NOW).text).not.toContain('unintendedMetadata')
    expect(() => buildAptitudeSessionExport([entry, entry], NOW)).toThrow(/Duplicate/)
  })
})

it('exports behavioral guidance without a numeric correctness score or recommended model', () => {
  const entry = question()
  entry.result = { ...entry.result!, ...BEHAVIORAL_PRACTICE[0].observation,
    verification: { method: 'none', outcome: 'not_run', notes: [] } }
  const exported = JSON.parse(buildAptitudeSessionExport([entry], NOW).text)
  expect(exported.guidance[0].confidenceScore).toBeNull()
  expect(exported.guidance[0].recommendedModelId).toBeNull()
  expect(exported.guidance[0].explanations).toEqual([BEHAVIORAL_PRACTICE[0].observation.message])
  expect(exported.entries[0].result.answer).toBeNull()
})
