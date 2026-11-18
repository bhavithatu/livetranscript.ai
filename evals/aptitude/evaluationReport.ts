import type { AptitudeStatus } from '@/lib/aptitude/schema'
import { percentile, type AptitudeComparisonScore, type AptitudeScore } from './score'

export type ScoredEvaluationAttempt = {
  expectedStatus: AptitudeStatus
  outcome: 'running' | 'complete' | 'error' | 'aborted'
  score: AptitudeScore | null
  comparisonScore: AptitudeComparisonScore | null
  durationMs: number | null
}

const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null

/** Denominators come from planned fixture truth, never from successful replies. */
export function aggregateAptitudeAttempts(group: readonly ScoredEvaluationAttempt[]) {
  const objective = group.filter(attempt => attempt.expectedStatus === 'solved')
  const expectedAbstentions = group.filter(attempt => attempt.expectedStatus !== 'solved')
  const valid = (attempt: ScoredEvaluationAttempt) => attempt.outcome === 'complete' && attempt.score?.schemaValid === true
  const correct = (attempt: ScoredEvaluationAttempt) => valid(attempt) && attempt.score?.answerCorrect === true
  const endToEndCorrect = group.filter(correct).length
  const objectiveAnswersCorrect = objective.filter(correct).length
  const expectedAbstentionsScored = expectedAbstentions.filter(valid).length
  const correctAbstentions = expectedAbstentions.filter(correct).length
  const falseCertaintyCount = expectedAbstentions.filter(attempt => valid(attempt) && !attempt.score!.abstained).length
  const comparisons = group.flatMap(attempt => attempt.comparisonScore ? [attempt.comparisonScore] : [])
  return {
    attempted: group.length,
    completed: group.filter(attempt => attempt.outcome === 'complete').length,
    errors: group.filter(attempt => attempt.outcome === 'error').length,
    aborted: group.filter(attempt => attempt.outcome === 'aborted').length,
    invalidResults: group.filter(attempt => attempt.score?.schemaValid === false).length,
    endToEndCorrect,
    endToEndAccuracy: ratio(endToEndCorrect, group.length),
    objectiveAttempted: objective.length,
    objectiveScored: objective.filter(valid).length,
    objectiveAnswersCorrect,
    objectiveAccuracy: ratio(objectiveAnswersCorrect, objective.length),
    expectedAbstentionsAttempted: expectedAbstentions.length,
    expectedAbstentionsScored,
    expectedAbstentionErrors: expectedAbstentions.filter(attempt => !valid(attempt)).length,
    correctAbstentions,
    correctAbstentionRate: ratio(correctAbstentions, expectedAbstentions.length),
    falseCertaintyCount,
    falseCertaintyAmongAttempts: ratio(falseCertaintyCount, expectedAbstentions.length),
    falseCertaintyAmongScored: ratio(falseCertaintyCount, expectedAbstentionsScored),
    comparisonDecisions: {
      agreement: comparisons.filter(score => score.decision === 'agreement').length,
      majority: comparisons.filter(score => score.decision === 'majority').length,
      disagreement: comparisons.filter(score => score.decision === 'disagreement').length,
      insufficient: comparisons.filter(score => score.decision === 'insufficient').length,
    },
    consensusWrongCount: comparisons.filter(score => score.consensusWrong).length,
    selectedAnswersCorrect: comparisons.filter(score => score.selectedAnswerCorrect).length,
    p50Ms: percentile(group.flatMap(attempt => attempt.durationMs === null ? [] : [attempt.durationMs]), 0.5),
    p95Ms: percentile(group.flatMap(attempt => attempt.durationMs === null ? [] : [attempt.durationMs]), 0.95),
  }
}
