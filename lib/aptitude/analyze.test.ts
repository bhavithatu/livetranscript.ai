// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { analyzeAptitude, type AptitudeTransport } from './analyze'
import { configuredAptitudeModels } from './modelPolicy'
import { validateAptitudeImage } from './image'
import { solvedGridObservation, solvedObservation, TEST_IMAGE, TEST_REQUEST } from './testFixtures'

const env = { OPENAI_API_KEY: 'test-placeholder', APTITUDE_MODEL: 'openai:gpt-4.1' }
const reply = () => ({ text: JSON.stringify(solvedObservation()), model: 'gpt-4.1-actual-snapshot' })
describe('grounded aptitude analysis', () => {
  it('requires a configured capability-allowed provider and never infers vision from a key', () => {
    expect(() => configuredAptitudeModels({})).toThrow(/Configure OPENAI_API_KEY/)
    expect(() => configuredAptitudeModels({ GROQ_API_KEY: 'test-placeholder' })).toThrow()
    expect(() => configuredAptitudeModels({ ...env, APTITUDE_MODEL: 'openai:text-only-model' })).toThrow(/unsupported/)
    expect(() => configuredAptitudeModels({ ...env, APTITUDE_FALLBACK_MODELS: 'anthropic:claude-haiku-4-5' })).toThrow(/ANTHROPIC_API_KEY/)
  })
  it('passes the screenshot in a single attempt and echoes actual identity/timing/model', async () => {
    const transport = vi.fn<AptitudeTransport>().mockResolvedValue(reply())
    const result = await analyzeAptitude(TEST_REQUEST, undefined, { env, transport })
    expect(transport).toHaveBeenCalledOnce()
    expect(transport.mock.calls[0][0].request.image).toBe(TEST_IMAGE)
    expect(result).toMatchObject({ captureId: TEST_REQUEST.captureId, questionVersion: 1, status: 'solved', model: 'gpt-4.1-actual-snapshot', provider: 'openai', verification: { outcome: 'passed' } })
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
  it('retains the same image for an explicitly configured fallback after malformed output', async () => {
    const transport = vi.fn<AptitudeTransport>().mockResolvedValueOnce({ text: '{}', model: 'bad' }).mockResolvedValueOnce(reply())
    const result = await analyzeAptitude(TEST_REQUEST, undefined, { env: { ...env, APTITUDE_FALLBACK_MODELS: 'openai:gpt-4.1-mini' }, transport })
    expect(result.status).toBe('solved')
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls.every(([input]) => input.request.image === TEST_IMAGE)).toBe(true)
  })
  it('preserves the provider grid inventory through parsing, verification, and internal analysis results', async () => {
    const observation = solvedGridObservation()
    const transport = vi.fn<AptitudeTransport>().mockResolvedValue({ text: JSON.stringify(observation), model: 'actual-grid-model' })
    const result = await analyzeAptitude(TEST_REQUEST, undefined, { env, transport })
    expect(result.status).toBe('solved')
    expect(result.answer!.gridInventory).toEqual(observation.answer!.gridInventory)
    expect(transport).toHaveBeenCalledOnce()
  })
  it('does not fallback or publish a late answer after cancellation', async () => {
    const controller = new AbortController()
    const transport = vi.fn<AptitudeTransport>().mockImplementation(async () => { controller.abort(); return reply() })
    await expect(analyzeAptitude(TEST_REQUEST, controller.signal, { env: { ...env, APTITUDE_FALLBACK_MODELS: 'openai:gpt-4.1-mini' }, transport })).rejects.toMatchObject({ code: 'ANALYSIS_CANCELLED' })
    expect(transport).toHaveBeenCalledOnce()
    await expect(analyzeAptitude(TEST_REQUEST, controller.signal, { env, transport })).rejects.toMatchObject({ status: 499 })
    expect(transport).toHaveBeenCalledOnce()
  })
  it('times out an uncooperative transport instead of waiting indefinitely', async () => {
    const transport = vi.fn<AptitudeTransport>().mockImplementation(() => new Promise(() => {}))
    await expect(analyzeAptitude(TEST_REQUEST, undefined, { env, transport, timeoutMs: 10 })).rejects.toMatchObject({ code: 'ANALYSIS_TIMEOUT' })
  })
  it('rejects missing evidence and malformed screenshots before a result can publish', async () => {
    const invalid = solvedObservation(); invalid.answer!.evidence = []
    const transport = vi.fn<AptitudeTransport>().mockResolvedValue({ text: JSON.stringify(invalid), model: 'test-model' })
    await expect(analyzeAptitude(TEST_REQUEST, undefined, { env, transport })).rejects.toMatchObject({ status: 502 })
    transport.mockClear()
    await expect(analyzeAptitude({ ...TEST_REQUEST, image: 'data:image/png;base64,AAAA' }, undefined, { env, transport })).rejects.toThrow(/content/)
    expect(transport).not.toHaveBeenCalled()
    expect(() => validateAptitudeImage('data:image/png;base64,iVBORw0KGgo=')).toThrow(/dimensions/)
  })
  it('surfaces legitimate capture needs without unnecessary fallback calls', async () => {
    const transport = vi.fn<AptitudeTransport>().mockResolvedValue({ text: JSON.stringify({ category: 'verbal', status: 'needs_capture', question: null, answer: null, message: 'Capture the passage and every option.' }), model: 'actual' })
    const result = await analyzeAptitude(TEST_REQUEST, undefined, { env, transport })
    expect(result.status).toBe('needs_capture')
    expect(result.answer).toBeNull()
    expect(transport).toHaveBeenCalledOnce()
  })
  it('withholds a provider answer whose arithmetic contradicts its stated numeric pattern', async () => {
    const observation = solvedObservation()
    observation.category = 'abstract'
    observation.question!.stem = 'Which number comes next: 3, 7, 13, 21, ?'
    observation.question!.options = [{ id: 'one', label: '', text: '29' }, { id: 'two', label: '', text: '31' }]
    observation.answer = {
      selectedOptionIds: ['one'], value: '29', unit: null, summary: '29',
      workedExplanation: ['The differences grow by 2: 4, 6, 8, then 10.'], evidence: ['3, 7, 13, 21'],
      calculation: { expression: '21+8', claimedValue: 29, decimalPlaces: null },
      numericPattern: { observedValues: [3, 7, 13, 21], rule: 'constant_second_difference' },
    }
    const transport = vi.fn<AptitudeTransport>().mockResolvedValue({ text: JSON.stringify(observation), model: 'actual' })
    const result = await analyzeAptitude(TEST_REQUEST, undefined, { env, transport })
    expect(result).toMatchObject({ status: 'ambiguous', answer: null, verification: { outcome: 'disagreed' } })
    expect(result.verification.notes).toContain('The final calculation does not follow the stated numeric pattern.')
    expect(transport).toHaveBeenCalledOnce()
  })
})
