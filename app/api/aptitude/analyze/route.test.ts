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
    expect(await response.json()).toEqual({ error: 'Aptitude has been updated. Refresh this tab once, then retry your capture.', code: 'CLIENT_UPDATE_REQUIRED' })
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
})
