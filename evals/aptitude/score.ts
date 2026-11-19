import { parseAptitudeObservation, parseAptitudeResult, type AptitudeResult } from '@/lib/aptitude/schema'
import type { AptitudeFixture } from './fixtures'
import { calculateExpression } from '@/lib/aptitude/calculator'
import { hasCorrectRotationGridInventory } from './gridEvidence'

export type AptitudeEvidenceReview = {
  checks: { id: string; description: string; passed: boolean }[]
  calculationMatchesExpected: boolean | null
  /** A focused review flag, not a semantic correctness score or an LLM judge. */
  reviewRequired: boolean
}
export type AptitudeScore = { schemaValid: boolean; categoryCorrect: boolean; statusCorrect: boolean; answerCorrect: boolean; shouldAbstain: boolean; abstained: boolean; criticalTextCoverage: number | null;
  optionMappingCorrect: boolean | null; evidenceReview: AptitudeEvidenceReview | null }
export type AptitudeComparisonScore = {
  decision: NonNullable<AptitudeResult['comparison']>['decision']
  selectedModelId: string | null
  agreementCount: number
  selectedAnswerCorrect: boolean
  consensusWrong: boolean
  candidateScores: { modelId: string; status: string; score: AptitudeScore | null }[]
}
/** Compare label presentation only. Never use this on option text or source evidence. */
function canonicalOptionLabel(label: string): string {
  const value = label.trim().replace(/\.$/, '').trim()
  const bracketed = /^(?:\(\s*([A-Za-z]|\d+)\s*\)|\[\s*([A-Za-z]|\d+)\s*\])$/.exec(value)
  return bracketed ? bracketed[1] ?? bracketed[2] : value
}
function invalidScore(fixture: AptitudeFixture): AptitudeScore {
  return { schemaValid: false, categoryCorrect: false, statusCorrect: false, answerCorrect: false,
    shouldAbstain: fixture.expected.status !== 'solved', abstained: false, criticalTextCoverage: null, optionMappingCorrect: null, evidenceReview: null }
}
function reviewEvidence(fixture: AptitudeFixture, result: Pick<AptitudeResult, 'question' | 'answer'>): AptitudeEvidenceReview | null {
  if (!fixture.expected.evidenceChecks?.length && fixture.expected.calculationValue === undefined) return null
  const evidence = [result.question?.stem ?? '', ...(result.answer?.evidence ?? []), ...(result.answer?.workedExplanation ?? []), result.answer?.calculation?.expression ?? ''].join('\n')
  const checks = (fixture.expected.evidenceChecks ?? []).map(check => {
    const inventory = check.gridRotationInventory ? hasCorrectRotationGridInventory(result.answer?.evidence ?? [], result.question?.options ?? []) : null
    return {
      id: check.id, description: check.description,
      // Exact source/choice configurations establish the known rotation without an English keyword.
      // Absent coordinates retain the verbal rubric; incorrect coordinates cannot fall back to it.
      passed: (inventory ?? check.allPatterns.every(pattern => new RegExp(pattern, 'iu').test(evidence)))
        && !(check.forbiddenPatterns ?? []).some(pattern => new RegExp(pattern, 'iu').test(evidence)),
    }
  })
  let calculationMatchesExpected: boolean | null = null
  if (fixture.expected.calculationValue !== undefined && result.answer?.calculation) {
    try {
      const calculation = result.answer.calculation
      calculationMatchesExpected = calculateExpression(calculation.expression, calculation.decimalPlaces).value === fixture.expected.calculationValue
        && calculation.claimedValue === fixture.expected.calculationValue
    } catch { calculationMatchesExpected = false }
  }
  return { checks, calculationMatchesExpected, reviewRequired: checks.some(check => !check.passed) || calculationMatchesExpected === false }
}
function scoreObservation(fixture: AptitudeFixture, result: Pick<AptitudeResult, 'category' | 'status' | 'question' | 'answer'>): AptitudeScore {
  const shouldAbstain = fixture.expected.status !== 'solved'
  const labels = (result.answer?.selectedOptionIds ?? []).map(id => canonicalOptionLabel(result.question?.options.find(option => option.id === id)?.label ?? '')).sort()
  const expected = fixture.expected.selectedLabels.map(canonicalOptionLabel).sort()
  const statusCorrect = result.status === fixture.expected.status
  const optionTruth = fixture.expected.optionTextByLabel
  const optionMappingCorrect = optionTruth ? result.question?.options.length === Object.keys(optionTruth).length
    && new Set(result.question.options.map(option => canonicalOptionLabel(option.label))).size === Object.keys(optionTruth).length
    && result.question.options.every(option => optionTruth[canonicalOptionLabel(option.label)] === option.text.trim()) : null
  const answerCorrect = statusCorrect && (shouldAbstain ? result.answer === null : JSON.stringify(labels) === JSON.stringify(expected) && optionMappingCorrect !== false)
  // Diagnostic only: text coverage is NOT a semantic correctness or OCR accuracy score.
  const visibleText = result.question ? [result.question.stem, result.question.passage ?? '', ...result.question.instructions, ...result.question.options.map(o => o.text)].join(' ') : ''
  const terms = fixture.expected.criticalText
  return { schemaValid: true, categoryCorrect: result.category === fixture.expected.category, statusCorrect, answerCorrect, shouldAbstain,
    abstained: result.status !== 'solved', criticalTextCoverage: terms.length ? terms.filter(term => visibleText.includes(term)).length / terms.length : null,
    optionMappingCorrect, evidenceReview: reviewEvidence(fixture, result) }
}
export function scoreAptitude(fixture: AptitudeFixture, value: unknown): AptitudeScore {
  try { return scoreObservation(fixture, parseAptitudeResult(value)) }
  catch { return invalidScore(fixture) }
}

/** Agreement is a selector outcome, not an answer key or independent check. */
export function scoreAptitudeComparison(fixture: AptitudeFixture, value: unknown): AptitudeComparisonScore | null {
  let result: AptitudeResult
  try { result = parseAptitudeResult(value) } catch { return null }
  const comparison = result.comparison
  if (!comparison) return null
  const score = scoreObservation(fixture, result)
  return {
    decision: comparison.decision,
    selectedModelId: comparison.selectedModelId,
    agreementCount: comparison.agreementCount,
    selectedAnswerCorrect: comparison.selectedModelId !== null && score.answerCorrect,
    consensusWrong: ['agreement', 'majority'].includes(comparison.decision) && result.status === 'solved' && !score.answerCorrect,
    candidateScores: comparison.candidates.map(candidate => {
      let candidateScore: AptitudeScore | null = null
      if (candidate.observation) {
        try { candidateScore = scoreObservation(fixture, parseAptitudeObservation(candidate.observation)) }
        catch { candidateScore = invalidScore(fixture) }
      }
      return { modelId: candidate.modelId, status: candidate.status, score: candidateScore }
    }),
  }
}
export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a,b) => a-b)
  return sorted[Math.max(0, Math.ceil(sorted.length*fraction)-1)]
}
