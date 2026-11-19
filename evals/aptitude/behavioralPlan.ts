export const BEHAVIORAL_CHECK_MODELS = ['anthropic:claude-sonnet-5-5', 'openai:gpt-6.2-sol'] as const
export const behavioralCheckEnabled = (env: Record<string, string | undefined>) => env.VERCEL_ENV === 'preview' && env.LT_RUN_BEHAVIORAL_CHECK === '1'
export function behavioralCheckPlan(env: Record<string, string | undefined>) {
  if (!behavioralCheckEnabled(env)) throw new Error('Behavioral checks require explicit preview opt-in')
  const models = (env.BEHAVIORAL_CHECK_MODELS ?? '').split(',').map(s => s.trim())
  if (models.length !== 2 || new Set(models).size !== 2 || models.some(m => !BEHAVIORAL_CHECK_MODELS.includes(m as typeof BEHAVIORAL_CHECK_MODELS[number]))) throw new Error('Name both approved behavioral models explicitly')
  if (env.BEHAVIORAL_CHECK_MAX_CALLS !== '6') throw new Error('Behavioral check requires the explicit six-call cap')
  return { modelIds: models, maxCalls: 6, plannedCalls: 6 }
}
