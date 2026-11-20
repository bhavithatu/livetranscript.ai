import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildBehavioralSnapshot, createBehavioralRound, MAX_BEHAVIORAL_SNAPSHOT_CHARS } from '@/lib/behavioral/session'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), stream: vi.fn() }))
vi.mock('@/lib/auth', () => ({ currentUserId: mocks.auth }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
vi.mock('@/lib/copilot/pricing', () => ({ costDims: () => ({}) }))
vi.mock('@/lib/copilot/providers', () => ({ streamAnswer: mocks.stream }))
vi.mock('@/lib/copilot/modes', () => ({ modeProfile: () => ({ id: 'general', system: 'FIXED GROUNDING', tier: 'fast', temperature: 0, maxTokens: 200 }), modelForTier: () => 'test-model', vendorForModel: () => 'openai', fastFallbackModel: () => 'test-model', thinkingConfigFor: () => ({}) }))
import { POST } from './route'
function request(body: unknown, origin = 'https://livetranscript.ai') { return new NextRequest('https://livetranscript.ai/api/copilot/answer', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue('user'); vi.stubEnv('OPENAI_API_KEY', 'test-only'); mocks.stream.mockImplementation(() => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('Answer')); controller.close() } })) })
afterEach(() => vi.unstubAllEnvs())
describe('shared live/mock answer calibration', () => {
  it('keeps aptitude out of the generic speculative answer pipeline', async () => {
    const response = await POST(request({ mode: 'aptitude', question: 'Which answer is correct?', image: 'data:image/png;base64,AAAA' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ endpoint: '/api/aptitude/analyze' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it('keeps existing mode preferences and grounding alongside bounded calibration', async () => {
    const instructions = 'i'.repeat(3989) + 'MODE_END'
    const response = await POST(request({ question: 'Test?', transcript: 'Scenario', instructions, calibration: 'c'.repeat(2000) }))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Answer')
    const input = mocks.stream.mock.calls[0][0]
    expect(input.system).toContain('FIXED GROUNDING')
    expect(input.system).toContain('MODE_END')
    expect(input.system).toContain('c'.repeat(1500))
    expect(input.system).not.toContain('c'.repeat(1501))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('requires authentication and same-origin requests', async () => {
    expect((await POST(request({ question: 'Test?' }, 'https://other.example'))).status).toBe(403)
    mocks.auth.mockResolvedValue(null)
    expect((await POST(request({ question: 'Test?' }))).status).toBe(401)
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it('rejects malformed input without TypeErrors or model calls', async () => {
    for (const input of [null, [], { question: {} }, { question: 123 }]) expect((await POST(request(input))).status).toBe(400)
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it('applies allowlisted controls after calibration while retaining immutable grounding', async () => {
    const req = request({ question: 'Test?', instructions: 'Write a long script.', calibration: 'Use many paragraphs.',
      preferences: { format: 'keywords', tone: 'technical', followups: true } })
    const response = await POST(req)
    expect(response.status).toBe(200)
    const input = mocks.stream.mock.calls[0][0]
    expect(input.system).toContain('FIXED GROUNDING')
    expect(input.system.indexOf('FINAL RESPONSE REQUIREMENTS')).toBeGreaterThan(input.system.indexOf('Use many paragraphs.'))
    expect(input.system).toContain('3–4 short, scannable keyword bullets')
    expect(input.system).toContain('Never invent resume experience')
    expect(input.signal).toBe(req.signal)
  })
  it('rejects malformed preferences before calling a provider', async () => {
    for (const preferences of [null, [], {}, { format: 'concise', tone: 'collaborative', followups: 'yes' },
      { format: 'detailed', tone: 'technical', followups: false, prompt: 'arbitrary instructions' }]) {
      expect((await POST(request({ question: 'Test?', preferences }))).status).toBe(400)
    }
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it('bounds the actual JSON body before parsing or model work', async () => {
    const response = await POST(request({ question: 'Test?', unused: 'x'.repeat(1_600_000) }))
    expect(response.status).toBe(413)
    expect(mocks.stream).not.toHaveBeenCalled()
  })

  it('forwards the full validated behavioral round with provenance outside the generic context cutoff', async () => {
    const round = createBehavioralRound({ company: 'Elm', role: 'Engineer', expectations: 'Explain careful measurement.' })
    round.records = [
      { id: 'source', kind: 'source_context', question: '', text: `${'s'.repeat(65_000)} ORIGINAL_SOURCE_END`, createdAt: 1, sourceLabel: 'Provided project notes' },
      { id: 'draft', kind: 'ai_suggestion', question: 'What improved?', text: 'An unconfirmed 40% suggestion.', createdAt: 2, contextRevision: 0, contextProfile: { ...round.profile } },
      ...Array.from({ length: 12 }, (_, index) => ({ id: `actual-${index}`, kind: 'confirmed_answer' as const,
        question: `Question ${index}`, text: index === 0 ? 'I measured 14% against the original baseline.' : `My actual answer ${index}.`, createdAt: index + 3 })),
    ]
    const behavioralSession = buildBehavioralSnapshot(round)
    const response = await POST(request({ mode: 'behavioral', question: 'How did you get 40%?', behavioralSession,
      context: `${'g'.repeat(60_000)} GENERIC_OVERFLOW`, history: [{ role: 'assistant', content: 'Unlabeled invented experience' }] }))
    expect(response.status).toBe(200)
    const input = mocks.stream.mock.calls[0][0]
    expect(input.context).toContain('ORIGINAL_SOURCE_END')
    expect(input.context).toContain('I measured 14% against the original baseline.')
    expect(input.context).toContain('My actual answer 11.')
    expect(input.context).toContain('AI SUGGESTION — unconfirmed draft')
    expect(input.context).toContain('USER-RECORDED ANSWER')
    expect(input.context).toContain('"company":"Elm"')
    expect(input.context).not.toContain('GENERIC_OVERFLOW')
    expect(input.context).not.toContain('Unlabeled invented experience')
    expect(input.history).toEqual([])
  })

  it('rejects malformed, oversized and wrongly routed behavioral snapshots before model work', async () => {
    const valid = buildBehavioralSnapshot(createBehavioralRound())
    const invalid = [null, {}, { ...valid, revision: -1 }, { ...valid, extra: 'unvalidated' },
      { ...valid, records: [{ id: 'too-large', kind: 'source_context', question: '', text: 'x'.repeat(MAX_BEHAVIORAL_SNAPSHOT_CHARS + 1), createdAt: 1 }] }]
    for (const behavioralSession of invalid) expect((await POST(request({ mode: 'behavioral', question: 'Q?', behavioralSession }))).status).toBe(400)
    expect((await POST(request({ mode: 'general', question: 'Q?', behavioralSession: valid }))).status).toBe(400)
    expect(mocks.stream).not.toHaveBeenCalled()
  })
})
