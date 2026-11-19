import { planAptitudeEvaluation } from './evaluationPlan'
import { APTITUDE_SELECTION_FIXTURES } from './selectionFixtures'

export const APTITUDE_SELECTION_MAX_CALLS = 36
export function planAptitudeSelection(env: Record<string, string | undefined>) {
  const ids = (env.APTITUDE_SELECTION_MODELS ?? '').split(',').map(value => value.trim())
  if (ids.length < 2 || ids.length > 3 || ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('APTITUDE_SELECTION_MODELS must explicitly name two or three distinct models.')
  const plannedCalls = ids.length * APTITUDE_SELECTION_FIXTURES.length
  if (plannedCalls > APTITUDE_SELECTION_MAX_CALLS || env.APTITUDE_SELECTION_MAX_CALLS !== String(plannedCalls)) throw new Error('APTITUDE_SELECTION_MAX_CALLS must exactly match the selected models times twelve fixtures (24 or 36).')
  if (APTITUDE_SELECTION_FIXTURES.length !== 12) throw new Error('The frozen selection suite must have exactly twelve fixtures.')
  return planAptitudeEvaluation({ APTITUDE_EVAL_STRATEGY: 'single', APTITUDE_EVAL_MODELS: ids.join(','),
    APTITUDE_EVAL_MAX_CALLS: String(plannedCalls), APTITUDE_EVAL_REPEATS: '1' }, APTITUDE_SELECTION_FIXTURES.length)
}

type CollectionAttempt = {
  outcome: string; callStarted: boolean; validated: boolean;
  diagnostic: { code: string } | null; sourceImageMatches: boolean | null; error: unknown;
}
/** Answer correctness is deliberately separate from whether the full experiment ran soundly. */
export function selectionCollectionStatus(attempts: readonly CollectionAttempt[], callsStarted: number,
  plan: { plannedCalls: number; plannedAttempts: number }) {
  const complete = callsStarted === plan.plannedCalls && attempts.length === plan.plannedAttempts
    && attempts.every(attempt => attempt.outcome !== 'running' && attempt.outcome !== 'aborted' && attempt.callStarted)
  const operationallyPassed = complete && attempts.every(attempt => attempt.outcome === 'complete'
    && attempt.validated && attempt.diagnostic?.code === 'VALID' && attempt.sourceImageMatches === true && attempt.error === null)
  return { complete, operationallyPassed }
}
