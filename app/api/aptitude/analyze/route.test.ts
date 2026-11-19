// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { currentUserId } from '@/lib/auth'
import { analyzeAptitude } from '@/lib/aptitude/analyze'
import { AptitudeServiceError } from '@/lib/aptitude/modelPolicy'
import { APTITUDE_CONTRACT_HEADER, APTITUDE_CONTRACT_VERSION, MAX_APTITUDE_BODY_BYTES, parseAptitudeResult, type AptitudeResult } from '@/lib/aptitude/schema'
import { solvedGridObservation, TEST_REQUEST } from '@/lib/aptitude/testFixtures'
import { comparisonFixture } from '@/components/aptitude/comparisonTestFixtures'
import { APTITUDE_PROGRESS_CONTENT_TYPE, readAptitudeProgressStream, type AptitudeProgressUpdate } from '@/lib/aptitude/progress'

vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn() }))
vi.mock('@/lib/aptitude/analyze', () => ({ analyzeAptitude: vi.fn() }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
const request = (body: unknown = TEST_REQUEST, headers: Record<string, string> = {}, signal?: AbortSignal) => new NextRequest('https://app.test/api/aptitude/analyze', { method: 'POST', body: JSON.stringify(body), headers: { [APTITUDE_CONTRACT_HEADER]: APTITUDE_CONTRACT_VERSION, ...headers }, signal })
beforeEach(() => { vi.clearAllMocks(); vi.mocked(currentUserId).mockResolvedValue('user-test') })
describe('aptitude endpoint boundaries', () => {
  it('authenticates before a model call', async () => {
    vi.mocked(currentUserId).mockResolvedValue(null)
    const result = await POST(request())
    expect(result.status).toBe(401)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(analyzeAptitude).not.toHaveBeenCalled()
  })
  it('rejects cross-origin requests and invalid/oversized bodies', async () => {
    expect((await POST(request(TEST_REQUEST, { origin: 'https://other.test' }))).status).toBe(403)
    expect((await POST(request(TEST_REQUEST, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect((await POST(request({ ...TEST_REQUEST, image: '' }))).status).toBe(400)
    expect((await POST(request(TEST_REQUEST, { 'content-length': String(MAX_APTITUDE_BODY_BYTES + 1) }))).status).toBe(413)
    expect((await POST(request({ ...TEST_REQUEST, image: 'x'.repeat(MAX_APTITUDE_BODY_BYTES + 1) }, { 'content-length': '1' }))).status).toBe(413)
    expect(analyzeAptitude).not.toHaveBeenCalled()
  })
  it.each([null, 'unsupported-version'])('asks an incompatible client (%s) to refresh before a paid model call', async (version) => {
    const oldRequest = request()
    if (version === null) oldRequest.headers.delete(APTITUDE_CONTRACT_HEADER)
    else oldRequest.headers.set(APTITUDE_CONTRACT_HEADER, version)
    const response = await POST(oldRequest)
    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Aptitude has been updated. Save your existing captures before refreshing this tab, then retry.', code: 'CLIENT_UPDATE_REQUIRED' })
    expect(analyzeAptitude).not.toHaveBeenCalled()
  })
  it('preserves typed source facts in the selected and candidate answers for compatible clients', async () => {
    const base: AptitudeResult = {
      ...solvedGridObservation(), schemaVersion: 1, captureId: TEST_REQUEST.captureId, questionVersion: 1,
      questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), durationMs: 50,
      model: 'test-model', provider: 'openai', verification: { method: 'source_review', outcome: 'not_run', notes: ['No independent visual check.'] },
    }
    const internal = comparisonFixture(base)
    vi.mocked(analyzeAptitude).mockResolvedValue(internal)
    const response = await POST(request({ ...TEST_REQUEST, strategy: 'compare' }))
    expect(response.status).toBe(200)
    const parsed = parseAptitudeResult(await response.json())
    expect(parsed).toEqual(internal)
    expect(parsed.answer!.gridInventory).toEqual(base.answer!.gridInventory)
    expect(parsed.comparison!.candidates.every(candidate => candidate.observation?.answer?.gridInventory)).toBe(true)
  })
  it('returns actionable provider failures without caching private output', async () => {
    vi.mocked(analyzeAptitude).mockRejectedValue(new AptitudeServiceError('Configure OPENAI_API_KEY on the server.', 503, 'PROVIDER_UNAVAILABLE'))
    const result = await POST(request())
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ error: 'Configure OPENAI_API_KEY on the server.', code: 'PROVIDER_UNAVAILABLE' })
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(analyzeAptitude).toHaveBeenCalledWith(TEST_REQUEST, expect.any(AbortSignal), expect.objectContaining({ onAttempt: expect.any(Function) }))
  })
  it('sanitizes unexpected provider/internal errors', async () => {
    vi.mocked(analyzeAptitude).mockRejectedValue(new Error('secret-provider-payload'))
    const result = await POST(request())
    expect(result.status).toBe(500)
    expect(JSON.stringify(await result.json())).not.toContain('secret-provider-payload')
  })
  it('does not analyze a cancelled upload', async () => {
    const controller = new AbortController(); controller.abort()
    expect((await POST(request(TEST_REQUEST, {}, controller.signal))).status).toBe(499)
    expect(analyzeAptitude).not.toHaveBeenCalled()
  })
  it('accepts explicit comparison, preserves usage reporting, and rejects unknown strategies', async () => {
    vi.mocked(analyzeAptitude).mockRejectedValue(new AptitudeServiceError('Configure both comparison providers.', 503, 'PROVIDER_UNAVAILABLE'))
    const response = await POST(request({ ...TEST_REQUEST, strategy: 'compare' }))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(analyzeAptitude).toHaveBeenCalledWith({ ...TEST_REQUEST, strategy: 'compare' }, expect.any(AbortSignal), expect.objectContaining({ onAttempt: expect.any(Function) }))
    vi.mocked(analyzeAptitude).mockClear()
    expect((await POST(request({ ...TEST_REQUEST, strategy: 'race' }))).status).toBe(400)
    expect(analyzeAptitude).not.toHaveBeenCalled()
  })

  it.each(['single', 'compare'] as const)('keeps an existing grid-v1 %s tab usable without mutating the new confidence result', async strategy => {
    const observation = solvedGridObservation()
    observation.answer!.confidence = 83
    const base: AptitudeResult = { ...observation, schemaVersion: 1, captureId: TEST_REQUEST.captureId, questionVersion: 1,
      questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), durationMs: 50, model: 'test-model', provider: 'openai',
      verification: { method: 'source_review', outcome: 'not_run', notes: ['No independent visual check.'] } }
    const internal = strategy === 'compare' ? comparisonFixture(base) : base
    const original = structuredClone(internal)
    vi.mocked(analyzeAptitude).mockResolvedValue(internal)
    const response = await POST(request({ ...TEST_REQUEST, strategy }, { [APTITUDE_CONTRACT_HEADER]: 'grid-v1', Accept: APTITUDE_PROGRESS_CONTENT_TYPE }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const value = await response.json()
    expect(value.answer).not.toHaveProperty('confidence')
    expect(value.answer.gridInventory).toEqual(base.answer!.gridInventory)
    for (const candidate of value.comparison?.candidates ?? []) expect(candidate.observation.answer).not.toHaveProperty('confidence')
    expect(internal).toEqual(original)
    expect(analyzeAptitude).toHaveBeenCalledOnce()
    expect(vi.mocked(analyzeAptitude).mock.calls[0][0].strategy).toBe(strategy)
  })

  it('delivers validated model completions before the final comparison while preserving JSON opt-out', async () => {
    const base: AptitudeResult = { ...solvedGridObservation(), schemaVersion: 1, captureId: TEST_REQUEST.captureId, questionVersion: TEST_REQUEST.questionVersion,
      questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), durationMs: 50, model: 'test-model', provider: 'openai',
      verification: { method: 'source_review', outcome: 'not_run', notes: ['No independent visual check.'] } }
    const result = comparisonFixture(base)
    const identity = { captureId: result.captureId, questionVersion: result.questionVersion, sourceHash: result.sourceHash }
    let resolve!: (value: AptitudeResult) => void
    let progress!: (event: AptitudeProgressUpdate) => void
    vi.mocked(analyzeAptitude).mockImplementation((_request, _signal, options) => {
      progress = options!.onProgress!
      progress({ type: 'start', ...identity, models: result.comparison!.candidates.map(candidate => ({ modelId: candidate.modelId, provider: candidate.provider, model: candidate.model! })) })
      return new Promise(done => { resolve = done })
    })
    const response = await POST(request({ ...TEST_REQUEST, strategy: 'compare' }, { Accept: APTITUDE_PROGRESS_CONTENT_TYPE }))
    expect(response.headers.get('content-type')).toContain(APTITUDE_PROGRESS_CONTENT_TYPE)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const update = vi.fn()
    const completion = readAptitudeProgressStream(response.body!, TEST_REQUEST, update, new AbortController().signal)
    progress({ type: 'candidate', ...identity, candidate: result.comparison!.candidates[0] })
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][0].candidate.provider).toBe('openai')
    progress({ type: 'candidate', ...identity, candidate: result.comparison!.candidates[1] })
    resolve(result)
    expect(await completion).toEqual(result)
  })

  it('sanitizes streamed errors and aborts provider work when the response reader disconnects', async () => {
    vi.mocked(analyzeAptitude).mockRejectedValueOnce(new Error('secret-provider-payload'))
    const response = await POST(request({ ...TEST_REQUEST, strategy: 'compare' }, { Accept: APTITUDE_PROGRESS_CONTENT_TYPE }))
    const message = await response.text()
    expect(message).not.toContain('secret-provider-payload')
    expect(JSON.parse(message)).toMatchObject({ type: 'error', code: 'INTERNAL_ERROR', captureId: TEST_REQUEST.captureId, sourceHash: null })
    let signal!: AbortSignal
    vi.mocked(analyzeAptitude).mockImplementation((_request, parent) => { signal = parent!; return new Promise(() => {}) })
    const pending = await POST(request({ ...TEST_REQUEST, strategy: 'compare' }, { Accept: APTITUDE_PROGRESS_CONTENT_TYPE }))
    await pending.body!.cancel()
    expect(signal.aborted).toBe(true)
  })
})
