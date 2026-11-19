export type AptitudeProvider = 'anthropic' | 'openai'
export type AptitudeGenerationSettings = { maxOutputTokens: 3_000 | 6_000; temperature?: 0; reasoningEffort?: 'high' }
export type AptitudeModel = { id: string; provider: AptitudeProvider; model: string; imageInput: true; structuredOutput: true; generation: AptitudeGenerationSettings }

const legacyGeneration: AptitudeGenerationSettings = { maxOutputTokens: 3_000, temperature: 0 }
// Challenger profiles are opt-in, not benchmark winners or new defaults. Thinking shares
// this output cap and the existing 25-second deadline. No automatic retry is added.
// Sonnet5.5 rejects temperature; use adaptive thinking plus output_config.effort:
// https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
// GPT6 Sol supports image input, strict outputs and reasoning_effort in Chat Completions:
// https://developers.openai.com/api/docs/models/gpt-6-sol
// GPT6.2 Astra/Sol retain this contract and omit unsupported sampling parameters:
// https://developers.openai.com/api/docs/models/gpt-6.2-astra
// https://developers.openai.com/api/docs/models/gpt-6.2-sol
const reasoningGeneration: AptitudeGenerationSettings = { maxOutputTokens: 6_000, reasoningEffort: 'high' }

/** Explicit capability allowlist, not a benchmark ranking. See evals/aptitude/README.md. */
export const APTITUDE_MODELS: readonly AptitudeModel[] = [
  { id: 'anthropic:claude-sonnet-4-5', provider: 'anthropic', model: 'claude-sonnet-4-5', imageInput: true, structuredOutput: true, generation: legacyGeneration },
  { id: 'anthropic:claude-haiku-4-5', provider: 'anthropic', model: 'claude-haiku-4-5', imageInput: true, structuredOutput: true, generation: legacyGeneration },
  { id: 'openai:gpt-4.1', provider: 'openai', model: 'gpt-4.1', imageInput: true, structuredOutput: true, generation: legacyGeneration },
  { id: 'openai:gpt-4.1-mini', provider: 'openai', model: 'gpt-4.1-mini', imageInput: true, structuredOutput: true, generation: legacyGeneration },
  { id: 'anthropic:claude-sonnet-5-5', provider: 'anthropic', model: 'claude-sonnet-5-5', imageInput: true, structuredOutput: true, generation: reasoningGeneration },
  { id: 'openai:gpt-6-sol', provider: 'openai', model: 'gpt-6-sol', imageInput: true, structuredOutput: true, generation: reasoningGeneration },
  { id: 'openai:gpt-6.2-astra', provider: 'openai', model: 'gpt-6.2-astra', imageInput: true, structuredOutput: true, generation: reasoningGeneration },
  { id: 'openai:gpt-6.2-sol', provider: 'openai', model: 'gpt-6.2-sol', imageInput: true, structuredOutput: true, generation: reasoningGeneration },
] as const

export type AptitudeEnvironment = Record<string, string | undefined>
export class AptitudeServiceError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); this.name = 'AptitudeServiceError' }
}
export function aptitudeModel(id: string): AptitudeModel {
  const candidate = APTITUDE_MODELS.find(item => item.id === id)
  if (!candidate) throw new AptitudeServiceError('The aptitude model configuration names an unsupported image/structured-output model. Use an entry from the aptitude model allowlist.', 503, 'MODEL_CONFIGURATION')
  return candidate
}
export function providerKey(candidate: AptitudeModel, env: AptitudeEnvironment): string | undefined {
  return env[candidate.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY']?.trim() || undefined
}
export function configuredAptitudeModels(env: AptitudeEnvironment = process.env): AptitudeModel[] {
  const primary = env.APTITUDE_MODEL?.trim() || (env.ANTHROPIC_API_KEY?.trim() ? 'anthropic:claude-sonnet-4-5' : 'openai:gpt-4.1')
  const ids = [...new Set([primary, ...(env.APTITUDE_FALLBACK_MODELS ?? '').split(',').map(x => x.trim()).filter(Boolean)])]
  if (ids.length > 3) throw new AptitudeServiceError('Configure at most two aptitude fallback models.', 503, 'MODEL_CONFIGURATION')
  const candidates = ids.map(aptitudeModel)
  for (const candidate of candidates) {
    if (!providerKey(candidate, env)) throw new AptitudeServiceError(`Aptitude analysis is unavailable. Configure ${candidate.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} on the server for ${candidate.id}, or choose a configured APTITUDE_MODEL.`, 503, 'PROVIDER_UNAVAILABLE')
  }
  return candidates
}

export const DEFAULT_APTITUDE_COMPARISON_MODELS = ['anthropic:claude-sonnet-4-5', 'openai:gpt-4.1'] as const
export function configuredAptitudeComparisonModels(env: AptitudeEnvironment = process.env): AptitudeModel[] {
  const ids = (env.APTITUDE_COMPARISON_MODELS?.trim() || DEFAULT_APTITUDE_COMPARISON_MODELS.join(',')).split(',').map(value => value.trim()).filter(Boolean)
  if (ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length) throw new AptitudeServiceError('APTITUDE_COMPARISON_MODELS must name two or three distinct allowlisted models.', 503, 'MODEL_CONFIGURATION')
  const candidates = ids.map(aptitudeModel)
  for (const candidate of candidates) {
    if (!providerKey(candidate, env)) throw new AptitudeServiceError(`Model comparison is unavailable. Configure ${candidate.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} on the server for ${candidate.id}, or adjust APTITUDE_COMPARISON_MODELS.`, 503, 'PROVIDER_UNAVAILABLE')
  }
  return candidates
}
