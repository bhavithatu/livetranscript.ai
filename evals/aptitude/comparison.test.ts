// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { selectAptitudeComparison } from '@/lib/aptitude/comparison'
import { parseAptitudeResult, type AptitudeComparisonCandidate, type AptitudeResult } from '@/lib/aptitude/schema'
import { solvedObservation } from '@/lib/aptitude/testFixtures'
import { verifyAptitudeObservation } from '@/lib/aptitude/verify'
import { APTITUDE_FIXTURES } from './fixtures'
import { AptitudeEvaluationCallGuard, planAptitudeEvaluation } from './evaluationPlan'
import { aggregateAptitudeAttempts, type ScoredEvaluationAttempt } from './evaluationReport'
import { scoreAptitude, scoreAptitudeComparison, type AptitudeScore } from './score'

const models = ['openai:gpt-4.1', 'openai:gpt-4.1-mini', 'anthropic:claude-sonnet-4-5']
const planEnv = { APTITUDE_EVAL_MODELS: models.slice(0, 2).join(','), APTITUDE_EVAL_MAX_CALLS: '48', APTITUDE_EVAL_REPEATS: '2' }

describe('bounded comparison evaluation planning (no model calls)', () => {
  it('preserves independent single-model arms as the default', () => {
    const plan = planAptitudeEvaluation(planEnv, 12)
    expect(plan).toMatchObject({ strategy: 'single', plannedAttempts: 48, plannedCalls: 48, repeats: 2 })
    expect(plan.arms.map(arm => arm.modelIds)).toEqual([[models[0]], [models[1]]])
  })

  it('counts joint question attempts separately from all candidate calls', () => {
    const plan = planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_STRATEGY: 'compare' }, 12)
    expect(plan).toMatchObject({ strategy: 'compare', plannedAttempts: 24, plannedCalls: 48 })
    expect(plan.arms).toHaveLength(1)
    expect(plan.arms[0].modelIds).toEqual(models.slice(0, 2))
    const three = planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_STRATEGY: 'compare', APTITUDE_EVAL_MODELS: models.join(','), APTITUDE_EVAL_MAX_CALLS: '72' }, 12)
    expect(three).toMatchObject({ plannedAttempts: 24, plannedCalls: 72 })
  })

  it('rejects an over-budget plan before any provider work can begin', () => {
    expect(() => planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_MAX_CALLS: '47' }, 12)).toThrow('requires 48 calls')
    expect(() => planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_STRATEGY: 'compare', APTITUDE_EVAL_MODELS: models.join(','), APTITUDE_EVAL_REPEATS: '3', APTITUDE_EVAL_MAX_CALLS: '100' }, 12)).toThrow('requires 108 calls')
    expect(() => planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_MAX_CALLS: '101' }, 12)).toThrow('1 to 100')
    expect(() => planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_MAX_CALLS: undefined }, 12)).toThrow('explicitly')
  })

  it('requires two or three distinct explicit comparison models', () => {
    for (const value of [models[0], `${models[0]},${models[0]}`, `${models.join(',')},anthropic:claude-haiku-4-5`]) {
      expect(() => planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_STRATEGY: 'compare', APTITUDE_EVAL_MODELS: value }, 12)).toThrow('two or three distinct')
    }
    expect(() => planAptitudeEvaluation({ ...planEnv, APTITUDE_EVAL_STRATEGY: 'unknown' }, 12)).toThrow('single or compare')
  })

  it('counts failed calls and blocks hidden retries, fallback models, and excess starts', () => {
    const plan = planAptitudeEvaluation({ APTITUDE_EVAL_STRATEGY: 'compare', APTITUDE_EVAL_MODELS: models.slice(0, 2).join(','), APTITUDE_EVAL_MAX_CALLS: '100' }, 1)
    const guard = new AptitudeEvaluationCallGuard(plan)
    const reserve = guard.attempt(plan.arms[0])
    reserve(models[0]) // This start consumes budget even if its provider fails.
    expect(guard.callsStarted).toBe(1)
    expect(() => reserve(models[0])).toThrow('UNPLANNED_PROVIDER_RETRY')
    expect(() => reserve(models[2])).toThrow('UNPLANNED_PROVIDER_MODEL')
    reserve(models[1])
    expect(guard.callsStarted).toBe(2)
    expect(() => guard.attempt(plan.arms[0])(models[0])).toThrow('CALL_CAP_REACHED')
    expect(() => guard.attempt({ ...plan.arms[0], id: 'unplanned' })).toThrow('UNPLANNED_EVALUATION_ARM')
    expect(guard.callsStarted).toBe(plan.plannedCalls)
  })
})

const score = (overrides: Partial<AptitudeScore> = {}): AptitudeScore => ({ schemaValid: true, categoryCorrect: true, statusCorrect: true,
  answerCorrect: true, shouldAbstain: false, abstained: false, criticalTextCoverage: 1, ...overrides })
const attempt = (overrides: Partial<ScoredEvaluationAttempt> = {}): ScoredEvaluationAttempt => ({
  expectedStatus: 'solved', outcome: 'complete', score: score(), comparisonScore: null, durationMs: 100, ...overrides,
})

describe('failure-inclusive evaluation denominators', () => {
  it('keeps failed objective attempts in accuracy and failed boundary attempts in abstention denominators', () => {
    const report = aggregateAptitudeAttempts([
      attempt(),
      attempt({ outcome: 'error', score: null, durationMs: 500 }),
      attempt({ expectedStatus: 'needs_capture', score: score({ shouldAbstain: true, abstained: true }) }),
      attempt({ expectedStatus: 'needs_capture', outcome: 'error', score: null }),
      attempt({ expectedStatus: 'needs_capture', score: score({ shouldAbstain: true, answerCorrect: false, statusCorrect: false }) }),
      attempt({ expectedStatus: 'needs_capture', score: score({ shouldAbstain: true, schemaValid: false, answerCorrect: false }) }),
    ])
    expect(report).toMatchObject({
      attempted: 6, completed: 4, errors: 2, invalidResults: 1,
      endToEndCorrect: 2, endToEndAccuracy: 2 / 6,
      objectiveAttempted: 2, objectiveScored: 1, objectiveAnswersCorrect: 1, objectiveAccuracy: 0.5,
      expectedAbstentionsAttempted: 4, expectedAbstentionsScored: 2, expectedAbstentionErrors: 2,
      correctAbstentions: 1, correctAbstentionRate: 0.25,
      falseCertaintyCount: 1, falseCertaintyAmongAttempts: 0.25, falseCertaintyAmongScored: 0.5,
    })
  })

  it('does not count a missing, malformed or cancelled reply as a successful abstention', () => {
    const report = aggregateAptitudeAttempts([
      attempt({ expectedStatus: 'ambiguous', outcome: 'aborted', score: null }),
      attempt({ expectedStatus: 'ambiguous', outcome: 'error', score: null }),
      attempt({ expectedStatus: 'ambiguous', score: score({ schemaValid: false, answerCorrect: false, shouldAbstain: true }) }),
    ])
    expect(report).toMatchObject({ attempted: 3, endToEndCorrect: 0, expectedAbstentionsAttempted: 3,
      expectedAbstentionsScored: 0, correctAbstentions: 0, falseCertaintyCount: 0, falseCertaintyAmongScored: null })
    expect(aggregateAptitudeAttempts([])).toMatchObject({ attempted: 0, endToEndAccuracy: null, objectiveAccuracy: null, p50Ms: null, p95Ms: null })
  })
})

function candidate(index: number, correct = true): AptitudeComparisonCandidate {
  const observation = solvedObservation()
  observation.question!.options.push({ id: 'C', label: 'C', text: '80%' }, { id: 'D', label: 'D', text: '125%' })
  if (!correct) {
    // A correlated wrong denominator still passes arithmetic; the independent
    // fixture answer key must catch it even when several models agree.
    observation.answer = {
      ...observation.answer!, selectedOptionIds: ['A'], value: '20', summary: 'A — 20%',
      workedExplanation: ['The difference is 20. Divide by the new value, 100, to get 20%.'],
      calculation: { expression: '(100-80)/100*100', claimedValue: 20, decimalPlaces: null },
    }
  }
  const verified = verifyAptitudeObservation(observation)
  return { modelId: models[index], model: `offline-fixture-${index}`, provider: models[index].startsWith('openai:') ? 'openai' : 'anthropic',
    status: 'complete', observation: verified.observation, verification: verified.verification, durationMs: 5, error: null }
}

function comparisonResult(candidates: AptitudeComparisonCandidate[]): AptitudeResult {
  const { comparison, selected } = selectAptitudeComparison(candidates)
  const first = candidates.find(item => item.observation)?.observation
  return parseAptitudeResult({
    ...(selected?.observation ?? { category: first?.category ?? 'unknown', status: 'ambiguous', question: first?.question ?? null,
      answer: null, message: 'No corroborated answer was selected. Review the candidate evidence.' }),
    schemaVersion: 1, captureId: 'offline-eval-comparison', questionVersion: 1,
    sourceHash: 'a'.repeat(64), questionId: selected ? 'b'.repeat(64) : null,
    model: selected?.model ?? null, provider: selected?.provider ?? null, durationMs: 12,
    verification: selected?.verification ?? { method: 'none', outcome: 'not_run', notes: ['Selection withheld.'] }, comparison,
  })
}

describe('production comparison selection scored against fixture truth', () => {
  const fixture = APTITUDE_FIXTURES[0]

  it('scores a disagreement as a withheld answer, even when one candidate was correct', () => {
    const result = comparisonResult([candidate(0), candidate(1, false)])
    const scored = scoreAptitudeComparison(fixture, result)!
    expect(result.answer).toBeNull()
    expect(scoreAptitude(fixture, result)).toMatchObject({ answerCorrect: false, abstained: true })
    expect(scored).toMatchObject({ decision: 'disagreement', selectedModelId: null, selectedAnswerCorrect: false, consensusWrong: false })
    expect(scored.candidateScores.map(item => item.score?.answerCorrect)).toEqual([true, false])
  })

  it('flags unanimous correlated wrong answers, despite passing arithmetic', () => {
    const candidates = [candidate(0, false), candidate(1, false)]
    expect(candidates.every(item => item.verification?.outcome === 'passed')).toBe(true)
    const result = comparisonResult(candidates)
    const scored = scoreAptitudeComparison(fixture, result)!
    expect(result.comparison?.decision).toBe('agreement')
    expect(scoreAptitude(fixture, result).answerCorrect).toBe(false)
    expect(scored).toMatchObject({ agreementCount: 2, selectedAnswerCorrect: false, consensusWrong: true })
    expect(scored.candidateScores.every(item => item.score?.answerCorrect === false)).toBe(true)
    const aggregate = aggregateAptitudeAttempts([attempt({ score: scoreAptitude(fixture, result), comparisonScore: scored })])
    expect(aggregate).toMatchObject({ endToEndCorrect: 0, consensusWrongCount: 1, selectedAnswersCorrect: 0, comparisonDecisions: { agreement: 1 } })
  })

  it('does not substitute a correct minority candidate for the selected wrong majority', () => {
    const result = comparisonResult([candidate(0, false), candidate(1, false), candidate(2)])
    const scored = scoreAptitudeComparison(fixture, result)!
    expect(scored).toMatchObject({ decision: 'majority', agreementCount: 2, selectedAnswerCorrect: false, consensusWrong: true })
    expect(scored.candidateScores.filter(item => item.score?.answerCorrect)).toHaveLength(1)
    expect(scoreAptitude(fixture, result).answerCorrect).toBe(false)
  })

  it('scores the selected correct majority and retains the dissenting candidate', () => {
    const result = comparisonResult([candidate(0), candidate(1), candidate(2, false)])
    const scored = scoreAptitudeComparison(fixture, result)!
    expect(scored).toMatchObject({ decision: 'majority', agreementCount: 2, selectedAnswerCorrect: true, consensusWrong: false })
    expect(scored.candidateScores.map(item => item.score?.answerCorrect)).toEqual([true, true, false])
    expect(scoreAptitude(fixture, result).answerCorrect).toBe(true)
  })

  it('matches candidate-specific option IDs and label decoration without rewriting option text', () => {
    const other = candidate(1)
    other.observation!.question!.options.forEach(option => { option.id = `option-${option.id}`; option.label = `(${option.label})` })
    other.observation!.answer!.selectedOptionIds = ['option-B']
    const result = comparisonResult([candidate(0), other])
    expect(scoreAptitudeComparison(fixture, result)).toMatchObject({ decision: 'agreement', selectedAnswerCorrect: true, consensusWrong: false })
  })

  it('keeps a failed candidate distinct from a successful abstention or a corroborating answer', () => {
    const failed: AptitudeComparisonCandidate = { ...candidate(1), model: null, status: 'failed', observation: null, verification: null, error: 'Provider unavailable.' }
    const result = comparisonResult([candidate(0), failed])
    const scored = scoreAptitudeComparison(fixture, result)!
    expect(scored).toMatchObject({ decision: 'insufficient', selectedModelId: null, selectedAnswerCorrect: false })
    expect(scored.candidateScores[1]).toEqual({ modelId: models[1], status: 'failed', score: null })
    expect(result.answer).toBeNull()
  })
})
