export type AptitudeProvider = 'anthropic' | 'openai'
export type AptitudeModel = { id: string; provider: AptitudeProvider; model: string; imageInput: true; structuredOutput: true }

/** Explicit capability allowlist, not a benchmark ranking. See evals/aptitude/README.md. */
export const APTITUDE_MODELS: readonly AptitudeModel[] = [
  { id: 'anthropic:claude-sonnet-4-5', provider: 'anthropic', model: 'claude-sonnet-4-5', imageInput: true, structuredOutput: true },
  { id: 'anthropic:claude-haiku-4-5', provider: 'anthropic', model: 'claude-haiku-4-5', imageInput: true, structuredOutput: true },
  { id: 'openai:gpt-4.1', provider: 'openai', model: 'gpt-4.1', imageInput: true, structuredOutput: true },
  { id: 'openai:gpt-4.1-mini', provider: 'openai', model: 'gpt-4.1-mini', imageInput: true, structuredOutput: true },
] as const

export type AptitudeEnvironment = Record<string, string | undefined>
export class AptitudeServiceError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); this.name = 'AptitudeServiceError' }
}
export function aptitudeModel(id: string): AptitudeModel {
  const candidate = APTITUDE_MODELS.find(item => item.id === id)
  if (!candidate) throw new AptitudeServiceError('APTITUDE_MODEL or APTITUDE_FALLBACK_MODELS names an unsupported image/structured-output model. Use an entry from the aptitude model allowlist.', 503, 'MODEL_CONFIGURATION')
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
