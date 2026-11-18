export type EvaluationStrategy = 'single' | 'compare'
export type EvaluationArm = { id: string; strategy: EvaluationStrategy; modelIds: string[] }
export type AptitudeEvaluationPlan = {
  strategy: EvaluationStrategy
  arms: EvaluationArm[]
  modelIds: string[]
  repeats: number
  fixtureCount: number
  plannedAttempts: number
  plannedCalls: number
  maxCalls: number
}

function integer(value: string | undefined, name: string, max: number): number {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${name} must explicitly be an integer from 1 to ${max}.`)
  }
  return Number(value)
}

/** Plan every provider call before credentials, fixtures, or transport are used. */
export function planAptitudeEvaluation(env: Record<string, string | undefined>, fixtureCount: number): AptitudeEvaluationPlan {
  if (!Number.isSafeInteger(fixtureCount) || fixtureCount < 1) throw new Error('The evaluation requires at least one fixture.')
  const strategy = env.APTITUDE_EVAL_STRATEGY ?? 'single'
  if (strategy !== 'single' && strategy !== 'compare') throw new Error('APTITUDE_EVAL_STRATEGY must be single or compare.')
  const maxCalls = integer(env.APTITUDE_EVAL_MAX_CALLS, 'APTITUDE_EVAL_MAX_CALLS', 100)
  const repeats = integer(env.APTITUDE_EVAL_REPEATS ?? '1', 'APTITUDE_EVAL_REPEATS', 3)
  const modelIds = [...new Set((env.APTITUDE_EVAL_MODELS ?? '').split(',').map(value => value.trim()).filter(Boolean))]
  if (!modelIds.length) throw new Error('Set APTITUDE_EVAL_MODELS to an explicit comma-separated aptitude model allowlist selection.')
  if (strategy === 'compare' && (modelIds.length < 2 || modelIds.length > 3)) {
    throw new Error('The comparison arm requires exactly two or three distinct explicitly selected models.')
  }
  const arms: EvaluationArm[] = strategy === 'compare'
    ? [{ id: `compare:${modelIds.join('|')}`, strategy, modelIds }]
    : modelIds.map(id => ({ id, strategy, modelIds: [id] }))
  const plannedCalls = modelIds.length * fixtureCount * repeats
  if (!Number.isSafeInteger(plannedCalls) || plannedCalls > maxCalls) {
    throw new Error(`The plan requires ${plannedCalls} calls and exceeds the explicit cap of ${maxCalls}. No calls were made.`)
  }
  return { strategy, arms, modelIds, repeats, fixtureCount, plannedAttempts: arms.length * fixtureCount * repeats, plannedCalls, maxCalls }
}

/** Failed calls still consume budget. No retry/fallback can silently add a call. */
export class AptitudeEvaluationCallGuard {
  callsStarted = 0

  constructor(private readonly plan: AptitudeEvaluationPlan) {}

  attempt(arm: EvaluationArm): (modelId: string) => void {
    const plannedArm = this.plan.arms.find(item => item.id === arm.id)
    if (!plannedArm) throw new Error('UNPLANNED_EVALUATION_ARM')
    const allowed = new Set(plannedArm.modelIds)
    const started = new Set<string>()
    return (modelId) => {
      if (!allowed.has(modelId)) throw new Error('UNPLANNED_PROVIDER_MODEL')
      if (started.has(modelId)) throw new Error('UNPLANNED_PROVIDER_RETRY')
      if (this.callsStarted >= this.plan.plannedCalls || this.callsStarted >= this.plan.maxCalls) throw new Error('CALL_CAP_REACHED')
      started.add(modelId)
      this.callsStarted++
    }
  }
}
