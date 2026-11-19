// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { comparisonFixture } from '@/components/aptitude/comparisonTestFixtures'
import { solvedObservation, TEST_REQUEST } from './testFixtures'
import type { AptitudeResult } from './schema'
import { encodeAptitudeProgressEvent, MAX_APTITUDE_PROGRESS_EVENT_BYTES, parseAptitudeProgress, parseAptitudeProgressEvent, readAptitudeProgressStream, type AptitudeProgressEvent } from './progress'

const base: AptitudeResult = { ...solvedObservation(), schemaVersion: 1, captureId: TEST_REQUEST.captureId, questionVersion: TEST_REQUEST.questionVersion,
  sourceHash: 'b'.repeat(64), questionId: 'a'.repeat(64), model: 'test-model', provider: 'openai', durationMs: 250,
  verification: { method: 'arithmetic', outcome: 'passed', notes: ['The expression matches.'] } }
const final = comparisonFixture(base)
const identity = { captureId: final.captureId, questionVersion: final.questionVersion, sourceHash: final.sourceHash }
const start = { ...identity, type: 'start' as const, models: final.comparison!.candidates.map(candidate => ({ modelId: candidate.modelId, provider: candidate.provider, model: candidate.model! })) }
const events: AptitudeProgressEvent[] = [start, ...final.comparison!.candidates.map(candidate => ({ ...identity, type: 'candidate' as const, candidate })), { type: 'result', result: final }]
function stream(values: unknown[], suffix = '') {
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const value of values) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
    if (suffix) controller.enqueue(new TextEncoder().encode(suffix))
    controller.close()
  } })
}
const read = (values: unknown[], update = vi.fn()) => readAptitudeProgressStream(stream(values), TEST_REQUEST, update, new AbortController().signal)

describe('validated progressive comparison protocol', () => {
  it('publishes the first complete model before the slower model and accepts fragmented UTF-8', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
    const update = vi.fn()
    let finished = false
    const result = readAptitudeProgressStream(body, TEST_REQUEST, update, new AbortController().signal).then(value => { finished = true; return value })
    for (const event of events.slice(0, 2)) {
      const bytes = encodeAptitudeProgressEvent(event)
      for (let index = 0; index < bytes.length; index += 11) source.enqueue(bytes.slice(index, index + 11))
    }
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][0]).toEqual(events[1])
    expect(finished).toBe(false)
    for (const event of events.slice(2)) source.enqueue(encodeAptitudeProgressEvent(event))
    source.close()
    expect(await result).toEqual(final)
  })

  it.each([
    ['another capture', [{ ...start, captureId: 'other-capture' }]],
    ['another revision', [start, { ...events[1], questionVersion: 99 }]],
    ['another image', [start, { ...events[1], sourceHash: 'c'.repeat(64) }]],
    ['a duplicate candidate', [start, events[1], events[1]]],
    ['a candidate before its roster', [events[1]]],
    ['a changed final candidate', [start, ...events.slice(1, 3), { type: 'result', result: { ...final, comparison: { ...final.comparison, candidates: final.comparison!.candidates.map(candidate => ({ ...candidate, durationMs: candidate.durationMs + 1 })) } } }]],
    ['a premature final result', [start, events[1], events[3]]],
    ['extra output after a final result', [...events, events[1]]],
  ])('rejects %s without accepting a final answer', async (_label, values) => {
    await expect(read(values)).rejects.toThrow()
  })

  it('preserves delivered candidates when a stream is truncated or reports a later error', async () => {
    const update = vi.fn()
    await expect(read([start, events[1]], update)).rejects.toThrow(/Completed model answers remain available/)
    expect(update).toHaveBeenCalledTimes(2)
    await expect(read([start, events[1], { ...identity, type: 'error', code: 'INTERNAL_ERROR', message: 'Comparison interrupted.' }])).rejects.toThrow('Comparison interrupted.')
  })

  it('rejects an incomplete final JSON line, oversized events and unknown fields', async () => {
    await expect(readAptitudeProgressStream(stream(events.slice(0, 3), JSON.stringify(events[3])), TEST_REQUEST, vi.fn(), new AbortController().signal)).rejects.toThrow(/connection ended/)
    await expect(readAptitudeProgressStream(stream([], 'x'.repeat(MAX_APTITUDE_PROGRESS_EVENT_BYTES + 1)), TEST_REQUEST, vi.fn(), new AbortController().signal)).rejects.toThrow()
    expect(() => parseAptitudeProgressEvent({ ...start, internalReasoning: 'not part of the public protocol' })).toThrow()
    expect(() => parseAptitudeProgressEvent({ ...events[1], candidate: { ...final.comparison!.candidates[0], observation: { answer: 'B' } } })).toThrow()
  })

  it('cancels a waiting stream immediately without a late candidate callback', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encodeAptitudeProgressEvent(start)) }, cancel: cancelled })
    const abort = new AbortController(), update = vi.fn()
    const result = readAptitudeProgressStream(body, TEST_REQUEST, update, abort.signal)
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    abort.abort()
    await expect(result).rejects.toThrow(/cancelled/)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
  })

  it('validates recovered progress and refuses invented, duplicate or mismatched candidates', () => {
    const valid = { sourceHash: final.sourceHash, models: start.models, candidates: final.comparison!.candidates, firstAnswerMs: 550 }
    expect(parseAptitudeProgress(valid)).toEqual(valid)
    expect(() => parseAptitudeProgress({ ...valid, candidates: [valid.candidates[0], valid.candidates[0]] })).toThrow()
    expect(() => parseAptitudeProgress({ ...valid, candidates: [], firstAnswerMs: 1 })).toThrow()
    expect(() => parseAptitudeProgress({ ...valid, firstAnswerMs: -1 })).toThrow()
    expect(() => parseAptitudeProgress({ ...valid, models: [start.models[0], start.models[0]] })).toThrow()
  })
})
