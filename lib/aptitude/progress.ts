/** Public, bounded comparison events. Never contains provider token streams or private reasoning. */
import { AptitudeValidationError, parseAptitudeComparisonCandidate, parseAptitudeResult, type AptitudeComparisonCandidate, type AptitudeResult } from './schema'

export const APTITUDE_PROGRESS_CONTENT_TYPE = 'application/x-ndjson'
export const MAX_APTITUDE_PROGRESS_EVENT_BYTES = 1_048_576
export const MAX_APTITUDE_PROGRESS_BYTES = 4_194_304
export type AptitudeProgressModel = { modelId: string; model: string; provider: 'anthropic' | 'openai' }
export type AptitudeProgress = {
  sourceHash: string
  models: AptitudeProgressModel[]
  candidates: AptitudeComparisonCandidate[]
  /** Client-observed time to the first usable answer; null until one arrives. */
  firstAnswerMs: number | null
}
type Identity = { captureId: string; questionVersion: number }
type SourceIdentity = Identity & { sourceHash: string }
export type AptitudeProgressUpdate =
  | (SourceIdentity & { type: 'start'; models: AptitudeProgressModel[] })
  | (SourceIdentity & { type: 'candidate'; candidate: AptitudeComparisonCandidate })
export type AptitudeProgressEvent = AptitudeProgressUpdate
  | { type: 'result'; result: AptitudeResult }
  | (Identity & { type: 'error'; sourceHash: string | null; code: string; message: string })

const invalid = (): never => { throw new AptitudeValidationError('The comparison stream returned an invalid or mismatched event.') }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some(key => !(key in record))) return invalid()
  return record
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid()
  return value
}
function identity(value: Record<string, unknown>): Identity {
  const captureId = text(value.captureId, 128)
  if (!/^[A-Za-z0-9._:-]+$/.test(captureId) || !Number.isSafeInteger(value.questionVersion)
    || (value.questionVersion as number) < 0 || (value.questionVersion as number) > 2_147_483_647) return invalid()
  return { captureId, questionVersion: value.questionVersion as number }
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid()
  return value
}
function models(value: unknown): AptitudeProgressModel[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return invalid()
  const parsed = value.map((item): AptitudeProgressModel => {
    const model = object(item, ['modelId', 'model', 'provider'])
    if (model.provider !== 'anthropic' && model.provider !== 'openai') return invalid()
    const modelId = text(model.modelId, 200)
    if (!/^(?:anthropic|openai):[A-Za-z0-9._-]+$/.test(modelId) || !modelId.startsWith(`${model.provider}:`)) return invalid()
    return { modelId, model: text(model.model, 200), provider: model.provider }
  })
  if (new Set(parsed.map(model => model.modelId)).size !== parsed.length) return invalid()
  return parsed
}
function candidateFits(candidate: AptitudeComparisonCandidate, declared: AptitudeProgressModel[]) {
  return declared.some(model => model.modelId === candidate.modelId && model.provider === candidate.provider)
}

/** Also used when recovering a saved tab. Older captures may omit progress entirely. */
export function parseAptitudeProgress(value: unknown): AptitudeProgress {
  const item = object(value, ['sourceHash', 'models', 'candidates', 'firstAnswerMs'])
  const declared = models(item.models)
  if (!Array.isArray(item.candidates) || item.candidates.length > declared.length) return invalid()
  const candidates = item.candidates.map(parseAptitudeComparisonCandidate)
  if (new Set(candidates.map(candidate => candidate.modelId)).size !== candidates.length || candidates.some(candidate => !candidateFits(candidate, declared))) return invalid()
  const firstAnswerMs = item.firstAnswerMs
  if (firstAnswerMs !== null && (typeof firstAnswerMs !== 'number' || !Number.isFinite(firstAnswerMs) || firstAnswerMs < 0 || firstAnswerMs > 3_600_000)) return invalid()
  if (firstAnswerMs !== null && !candidates.some(candidate => candidate.observation?.status === 'solved')) return invalid()
  return { sourceHash: hash(item.sourceHash), models: declared, candidates, firstAnswerMs }
}

export function parseAptitudeProgressEvent(value: unknown): AptitudeProgressEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const type = (value as Record<string, unknown>).type
  if (type === 'start') {
    const item = object(value, ['type', 'captureId', 'questionVersion', 'sourceHash', 'models'])
    return { type, ...identity(item), sourceHash: hash(item.sourceHash), models: models(item.models) }
  }
  if (type === 'candidate') {
    const item = object(value, ['type', 'captureId', 'questionVersion', 'sourceHash', 'candidate'])
    return { type, ...identity(item), sourceHash: hash(item.sourceHash), candidate: parseAptitudeComparisonCandidate(item.candidate) }
  }
  if (type === 'result') {
    const item = object(value, ['type', 'result'])
    const result = parseAptitudeResult(item.result)
    if (!result.comparison) return invalid()
    return { type, result }
  }
  if (type === 'error') {
    const item = object(value, ['type', 'captureId', 'questionVersion', 'sourceHash', 'code', 'message'])
    const code = text(item.code, 64)
    if (!/^[A-Z0-9_]+$/.test(code)) return invalid()
    return { type, ...identity(item), sourceHash: item.sourceHash === null ? null : hash(item.sourceHash), code, message: text(item.message, 1_000) }
  }
  return invalid()
}

export function encodeAptitudeProgressEvent(event: AptitudeProgressEvent): Uint8Array {
  const bytes = new TextEncoder().encode(`${JSON.stringify(parseAptitudeProgressEvent(event))}\n`)
  if (bytes.byteLength > MAX_APTITUDE_PROGRESS_EVENT_BYTES) return invalid()
  return bytes
}

/** Candidate events are usable before EOF. A final result is accepted only from a complete stream. */
export async function readAptitudeProgressStream(
  body: ReadableStream<Uint8Array>, expected: Identity,
  onUpdate: (event: AptitudeProgressUpdate) => void, signal: AbortSignal,
): Promise<AptitudeResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let pending = '', receivedBytes = 0, lines = 0
  let start: Extract<AptitudeProgressUpdate, { type: 'start' }> | null = null
  let final: AptitudeResult | null = null
  const seen = new Map<string, AptitudeComparisonCandidate>()
  const abort = () => { void reader.cancel().catch(() => {}) }
  const checkIdentity = (item: Identity) => {
    if (item.captureId !== expected.captureId || item.questionVersion !== expected.questionVersion) return invalid()
  }
  function consume(line: string) {
    if (!line.trim() || ++lines > 5 || encoder.encode(line).byteLength > MAX_APTITUDE_PROGRESS_EVENT_BYTES || final) return invalid()
    const event = parseAptitudeProgressEvent(JSON.parse(line))
    const item = event.type === 'result' ? event.result : event
    checkIdentity(item)
    if (event.type === 'start') {
      if (start) return invalid()
      start = event
      onUpdate(event)
    } else if (event.type === 'error') {
      if ((start && event.sourceHash !== start.sourceHash) || (!start && event.sourceHash !== null)) return invalid()
      throw new Error(event.message)
    } else {
      if (!start || item.sourceHash !== start.sourceHash) return invalid()
      if (event.type === 'candidate') {
        if (!candidateFits(event.candidate, start.models) || seen.has(event.candidate.modelId)) return invalid()
        seen.set(event.candidate.modelId, event.candidate)
        onUpdate(event)
      } else {
        const candidates = event.result.comparison!.candidates
        if (seen.size !== start.models.length || candidates.length !== start.models.length
          || candidates.some(candidate => !candidateFits(candidate, start!.models)
            || JSON.stringify(candidate) !== JSON.stringify(seen.get(candidate.modelId)))) return invalid()
        final = event.result
      }
    }
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    if (signal.aborted) throw new Error('Analysis was cancelled.')
    while (true) {
      const chunk = await reader.read()
      if (signal.aborted) throw new Error('Analysis was cancelled.')
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > MAX_APTITUDE_PROGRESS_BYTES) return invalid()
      pending += decoder.decode(chunk.value, { stream: true })
      let boundary: number
      while ((boundary = pending.indexOf('\n')) !== -1) {
        consume(pending.slice(0, boundary))
        pending = pending.slice(boundary + 1)
      }
      if (pending.length > MAX_APTITUDE_PROGRESS_EVENT_BYTES) return invalid()
    }
    pending += decoder.decode()
    if (pending.length || !final) throw new Error('The comparison connection ended before both results were confirmed. Completed model answers remain available; retry this capture to finish.')
    return final
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
