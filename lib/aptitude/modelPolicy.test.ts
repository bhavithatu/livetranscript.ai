import { describe, expect, it } from 'vitest'
import { aptitudeModel, configuredAptitudeComparisonModels, configuredAptitudeModels, DEFAULT_APTITUDE_COMPARISON_MODELS } from './modelPolicy'

const env = { ANTHROPIC_API_KEY: 'test-anthropic-key', OPENAI_API_KEY: 'test-openai-key' }

describe('explicit aptitude model profiles', () => {
  it('preserves the existing defaults while challenger models are evaluated', () => {
    expect(configuredAptitudeModels(env).map(model => model.id)).toEqual(['anthropic:claude-sonnet-4-5'])
    expect(configuredAptitudeModels({ OPENAI_API_KEY: env.OPENAI_API_KEY }).map(model => model.id)).toEqual(['openai:gpt-4.1'])
    expect(DEFAULT_APTITUDE_COMPARISON_MODELS).toEqual(['anthropic:claude-sonnet-4-5', 'openai:gpt-4.1'])
    expect(configuredAptitudeComparisonModels(env).map(model => model.id)).toEqual(DEFAULT_APTITUDE_COMPARISON_MODELS)
  })
  it('allows explicit challenger selection without adding implicit fallback calls', () => {
    for (const id of ['anthropic:claude-sonnet-5-5', 'openai:gpt-6-sol']) {
      const models = configuredAptitudeModels({ ...env, APTITUDE_MODEL: id })
      expect(models.map(model => model.id)).toEqual([id])
      expect(models[0]).toMatchObject({ imageInput: true, structuredOutput: true, generation: { maxOutputTokens: 6000, reasoningEffort: 'high' } })
      expect(models[0].generation).not.toHaveProperty('temperature')
    }
    expect(configuredAptitudeComparisonModels({ ...env, APTITUDE_COMPARISON_MODELS: 'anthropic:claude-sonnet-5-5,openai:gpt-6-sol' }).map(model => model.id))
      .toEqual(['anthropic:claude-sonnet-5-5', 'openai:gpt-6-sol'])
  })
  it('still requires each configured provider key and an exact allowlist match', () => {
    expect(() => configuredAptitudeModels({ OPENAI_API_KEY: env.OPENAI_API_KEY, APTITUDE_MODEL: 'anthropic:claude-sonnet-5-5' })).toThrow(/ANTHROPIC_API_KEY/)
    expect(() => configuredAptitudeModels({ ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, APTITUDE_MODEL: 'openai:gpt-6-sol' })).toThrow(/OPENAI_API_KEY/)
    expect(() => aptitudeModel('openai:gpt-6-arbitrary')).toThrow(/unsupported/)
    expect(() => aptitudeModel('anthropic:claude-sonnet-5-5-unverified')).toThrow(/unsupported/)
    expect(() => configuredAptitudeComparisonModels({ ...env, APTITUDE_COMPARISON_MODELS: 'openai:gpt-6-sol,openai:gpt-6-sol' })).toThrow(/distinct/)
  })
})
