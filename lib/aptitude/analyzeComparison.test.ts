// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { analyzeAptitude, type AptitudeProviderReply, type AptitudeTransport } from './analyze'
import { configuredAptitudeComparisonModels } from './modelPolicy'
import { solvedObservation, TEST_IMAGE, TEST_REQUEST } from './testFixtures'
import type { AptitudeProgressUpdate } from './progress'

const env = { ANTHROPIC_API_KEY: 'test-only-placeholder', OPENAI_API_KEY: 'test-only-placeholder' }
const request = { ...TEST_REQUEST, strategy: 'compare' as const }
const reply = (model: string): AptitudeProviderReply => ({ text: JSON.stringify(solvedObservation()), model, inputTokens: 10, outputTokens: 20 })
describe('bounded comparison orchestration', () => {
  it('starts two independent calls in parallel with the exact image and keeps usage per candidate', async () => {
    const pending: ((value: AptitudeProviderReply) => void)[] = []
    const transport = vi.fn<AptitudeTransport>().mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const onAttempt = vi.fn()
    const analysis = analyzeAptitude(request, undefined, { env, transport, onAttempt })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls.every(([input]) => input.request.image === TEST_IMAGE && input.request.captureId === TEST_REQUEST.captureId)).toBe(true)
    pending[1](reply('gpt-4.1-returned')); pending[0](reply('claude-sonnet-returned'))
    const result = await analysis
    expect(result).toMatchObject({ status: 'solved', model: 'claude-sonnet-returned', comparison: { decision: 'agreement', agreementCount: 2 } })
    expect(onAttempt).toHaveBeenCalledTimes(2)
    expect(onAttempt.mock.calls.every(([attempt]) => attempt.completed && attempt.inputTokens === 10 && attempt.outputTokens === 20)).toBe(true)
  })
  it('publishes only verified complete candidates before the slower provider finishes', async () => {
    const pending: ((value: AptitudeProviderReply) => void)[] = []
    const transport = vi.fn<AptitudeTransport>().mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const progress: AptitudeProgressUpdate[] = []
    let finished = false
    const analysis = analyzeAptitude(request, undefined, { env, transport, onProgress: event => progress.push(event) }).then(result => { finished = true; return result })
    expect(progress[0]).toMatchObject({ type: 'start', captureId: request.captureId, questionVersion: request.questionVersion })
    expect(transport).toHaveBeenCalledTimes(2)
    pending[1](reply('openai-fast'))
    await vi.waitFor(() => expect(progress).toHaveLength(2))
    expect(progress[1]).toMatchObject({ type: 'candidate', sourceHash: progress[0].sourceHash, candidate: { provider: 'openai', status: 'complete', observation: { status: 'solved' } } })
    expect(finished).toBe(false)
    pending[0]({ model: 'claude-invalid', text: '{"answer":"guess"}' })
    const result = await analysis
    expect(progress[2]).toMatchObject({ type: 'candidate', candidate: { provider: 'anthropic', status: 'failed', observation: null } })
    expect(result.comparison?.candidates[1].observation?.answer).toBeTruthy()
  })
  it('stops progress publication when the capture is cancelled, even if providers resolve late', async () => {
    const controller = new AbortController(), progress = vi.fn()
    const pending: ((value: AptitudeProviderReply) => void)[] = []
    const transport = vi.fn<AptitudeTransport>().mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const analysis = analyzeAptitude(request, controller.signal, { env, transport, onProgress: progress })
    expect(progress).toHaveBeenCalledOnce()
    controller.abort()
    pending.forEach(resolve => resolve(reply('late-model')))
    await expect(analysis).rejects.toMatchObject({ code: 'ANALYSIS_CANCELLED' })
    expect(progress).toHaveBeenCalledOnce()
  })
  it('keeps old clients and explicit single requests on one call even when comparison models are configured', async () => {
    const transport = vi.fn<AptitudeTransport>().mockResolvedValue(reply('claude-single'))
    expect((await analyzeAptitude(TEST_REQUEST, undefined, { env, transport })).comparison).toBeUndefined()
    expect(transport).toHaveBeenCalledTimes(1)
    expect((await analyzeAptitude({ ...TEST_REQUEST, strategy: 'single' }, undefined, { env, transport })).comparison).toBeUndefined()
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('validates every credential and model count before starting any call', async () => {
    const transport = vi.fn<AptitudeTransport>()
    await expect(analyzeAptitude(request, undefined, { env: { ANTHROPIC_API_KEY: 'placeholder' }, transport })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(transport).not.toHaveBeenCalled()
    for (const models of ['openai:gpt-4.1', 'openai:gpt-4.1,openai:gpt-4.1', 'openai:gpt-4.1,openai:text-only', 'anthropic:claude-sonnet-4-5,anthropic:claude-haiku-4-5,openai:gpt-4.1,openai:gpt-4.1-mini']) {
      expect(() => configuredAptitudeComparisonModels({ ...env, APTITUDE_COMPARISON_MODELS: models })).toThrow()
    }
  })
  it('never fans out through fallback configuration and returns sanitized all-failed details', async () => {
    const transport = vi.fn<AptitudeTransport>().mockRejectedValue(new Error('secret-provider-payload'))
    const result = await analyzeAptitude(request, undefined, { env: { ...env, APTITUDE_FALLBACK_MODELS: 'openai:gpt-4.1-mini,anthropic:claude-haiku-4-5' }, transport })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'error', answer: null, comparison: { decision: 'insufficient', agreementCount: 0, selectedModelId: null } })
    expect(result.comparison?.candidates.every(candidate => candidate.status === 'failed')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret-provider-payload')
  })
  it('records a malformed candidate as failed and withholds the lone usable answer', async () => {
    const onAttempt = vi.fn()
    const transport = vi.fn<AptitudeTransport>().mockResolvedValueOnce(reply('claude-returned')).mockResolvedValueOnce({ text: '{}', model: 'gpt-returned', inputTokens: 11, outputTokens: 3 })
    const result = await analyzeAptitude(request, undefined, { env, transport, onAttempt })
    expect(result).toMatchObject({ status: 'ambiguous', answer: null, comparison: { decision: 'insufficient', agreementCount: 1 } })
    expect(onAttempt.mock.calls.find(([attempt]) => !attempt.completed)?.[0]).toMatchObject({ model: 'gpt-returned', inputTokens: 11, outputTokens: 3 })
  })
  it('marks an uncooperative candidate timed out under the shared deadline and keeps an eligible completion', async () => {
    const signals: AbortSignal[] = []
    const transport = vi.fn<AptitudeTransport>().mockImplementation(async input => {
      signals.push(input.signal)
      if (input.candidate.provider === 'anthropic') return reply('claude-returned')
      return new Promise(() => {})
    })
    const result = await analyzeAptitude(request, undefined, { env, transport, timeoutMs: 15 })
    expect(result).toMatchObject({ status: 'ambiguous', answer: null, comparison: { decision: 'insufficient', agreementCount: 1 } })
    expect(result.comparison?.candidates.map(candidate => candidate.status)).toEqual(['complete', 'timed_out'])
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })
  it('returns explicit timed-out candidates when every model misses the deadline', async () => {
    const transport = vi.fn<AptitudeTransport>().mockImplementation(() => new Promise(() => {}))
    const result = await analyzeAptitude(request, undefined, { env, transport, timeoutMs: 10 })
    expect(result.status).toBe('error')
    expect(result.comparison?.candidates.every(candidate => candidate.status === 'timed_out')).toBe(true)
  })
  it('aborts every in-flight call and rejects late publication after cancellation', async () => {
    const controller = new AbortController()
    const pending: ((value: AptitudeProviderReply) => void)[] = []
    const signals: AbortSignal[] = []
    const transport = vi.fn<AptitudeTransport>().mockImplementation(input => { signals.push(input.signal); return new Promise(resolve => pending.push(resolve)) })
    const analysis = analyzeAptitude(request, controller.signal, { env, transport })
    expect(transport).toHaveBeenCalledTimes(2)
    controller.abort()
    pending.forEach((resolve,index) => resolve(reply(`late-${index}`)))
    await expect(analysis).rejects.toMatchObject({ code: 'ANALYSIS_CANCELLED', status: 499 })
    expect(signals.every(signal => signal.aborted)).toBe(true)
    await expect(analyzeAptitude(request, controller.signal, { env, transport })).rejects.toMatchObject({ status: 499 })
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('bounds three-model comparison to exactly three attempts, despite failures', async () => {
    const transport = vi.fn<AptitudeTransport>().mockImplementation(async input => {
      if (input.candidate.model === 'gpt-4.1-mini') throw new Error('Unavailable')
      return reply(`${input.candidate.model}-returned`)
    })
    const result = await analyzeAptitude(request, undefined, { env: { ...env, APTITUDE_COMPARISON_MODELS: 'anthropic:claude-sonnet-4-5,openai:gpt-4.1,openai:gpt-4.1-mini' }, transport })
    expect(transport).toHaveBeenCalledTimes(3)
    expect(result.comparison).toMatchObject({ decision: 'agreement', agreementCount: 2, selectedModelId: 'anthropic:claude-sonnet-4-5' })
  })
})
