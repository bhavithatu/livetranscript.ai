// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { currentUserId } from '@/lib/auth'
import { analyzeAptitude } from '@/lib/aptitude/analyze'
import { AptitudeServiceError } from '@/lib/aptitude/modelPolicy'
import { MAX_APTITUDE_BODY_BYTES } from '@/lib/aptitude/schema'
import { TEST_REQUEST } from '@/lib/aptitude/testFixtures'

vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn() }))
vi.mock('@/lib/aptitude/analyze', () => ({ analyzeAptitude: vi.fn() }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
const request = (body: unknown = TEST_REQUEST, headers: Record<string, string> = {}, signal?: AbortSignal) => new NextRequest('https://app.test/api/aptitude/analyze', { method: 'POST', body: JSON.stringify(body), headers, signal })
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
})
