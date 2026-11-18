// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAptitudeTransport } from './analyze'
import { aptitudeModel } from './modelPolicy'
import { APTITUDE_OBSERVATION_JSON_SCHEMA } from './schema'
import { solvedObservation, TEST_IMAGE, TEST_REQUEST } from './testFixtures'

const sdk = vi.hoisted(() => ({ openai: vi.fn(), anthropic: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: sdk.openai } } } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: sdk.anthropic } } }))
beforeEach(() => vi.clearAllMocks())

describe('actual multimodal SDK payload contracts', () => {
  it('sends high-detail image and strict JSON schema to OpenAI, retaining actual usage/model', async () => {
    sdk.openai.mockResolvedValue({ model: 'gpt-4.1-snapshot', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(solvedObservation()), refusal: null } }], usage: { prompt_tokens: 123, completion_tokens: 45 } })
    const signal = new AbortController().signal
    const result = await defaultAptitudeTransport({ candidate: aptitudeModel('openai:gpt-4.1'), request: TEST_REQUEST, signal, env: { OPENAI_API_KEY: 'not-a-real-key' } })
    expect(sdk.openai).toHaveBeenCalledOnce()
    expect(sdk.openai.mock.calls[0][0]).toMatchObject({ response_format: { type: 'json_schema', json_schema: { strict: true, schema: APTITUDE_OBSERVATION_JSON_SCHEMA } } })
    expect(sdk.openai.mock.calls[0][0].messages[1].content).toContainEqual({ type: 'image_url', image_url: { url: TEST_IMAGE, detail: 'high' } })
    expect(sdk.openai.mock.calls[0][1]).toEqual({ signal })
    expect(result).toMatchObject({ model: 'gpt-4.1-snapshot', inputTokens: 123, outputTokens: 45 })
  })
  it('sends original image bytes and output_config schema to Anthropic', async () => {
    sdk.anthropic.mockResolvedValue({ model: 'claude-actual', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(solvedObservation()) }], usage: { input_tokens: 201, output_tokens: 71 } })
    const signal = new AbortController().signal
    const result = await defaultAptitudeTransport({ candidate: aptitudeModel('anthropic:claude-sonnet-4-5'), request: TEST_REQUEST, signal, env: { ANTHROPIC_API_KEY: 'not-a-real-key' } })
    expect(sdk.anthropic).toHaveBeenCalledOnce()
    expect(sdk.anthropic.mock.calls[0][0].messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: TEST_IMAGE.split(',')[1] } })
    expect(sdk.anthropic.mock.calls[0][0].output_config).toEqual({ format: { type: 'json_schema', schema: APTITUDE_OBSERVATION_JSON_SCHEMA } })
    expect(result).toMatchObject({ model: 'claude-actual', inputTokens: 201, outputTokens: 71 })
  })
  it('refuses truncated or provider-refused responses even when they contain plausible JSON', async () => {
    for (const choice of [{ finish_reason: 'length', message: { content: JSON.stringify(solvedObservation()) } }, { finish_reason: 'stop', message: { content: JSON.stringify(solvedObservation()), refusal: 'Cannot answer' } }]) {
      sdk.openai.mockResolvedValue({ model: 'gpt-4.1', choices: [choice] })
      await expect(defaultAptitudeTransport({ candidate: aptitudeModel('openai:gpt-4.1'), request: TEST_REQUEST, signal: new AbortController().signal, env: { OPENAI_API_KEY: 'placeholder' } })).rejects.toThrow('Incomplete')
    }
  })
})
