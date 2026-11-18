import { parseAptitudeObservation, parseAptitudeResult, type AptitudeResult } from '@/lib/aptitude/schema'
import type { AptitudeFixture } from './fixtures'

export type AptitudeScore = { schemaValid: boolean; categoryCorrect: boolean; statusCorrect: boolean; answerCorrect: boolean; shouldAbstain: boolean; abstained: boolean; criticalTextCoverage: number | null }
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
    shouldAbstain: fixture.expected.status !== 'solved', abstained: false, criticalTextCoverage: null }
}
function scoreObservation(fixture: AptitudeFixture, result: Pick<AptitudeResult, 'category' | 'status' | 'question' | 'answer'>): AptitudeScore {
  const shouldAbstain = fixture.expected.status !== 'solved'
  const labels = (result.answer?.selectedOptionIds ?? []).map(id => canonicalOptionLabel(result.question?.options.find(option => option.id === id)?.label ?? '')).sort()
  const expected = fixture.expected.selectedLabels.map(canonicalOptionLabel).sort()
  const statusCorrect = result.status === fixture.expected.status
  const answerCorrect = statusCorrect && (shouldAbstain ? result.answer === null : JSON.stringify(labels) === JSON.stringify(expected))
  // Diagnostic only: text coverage is NOT a semantic correctness or OCR accuracy score.
  const visibleText = result.question ? [result.question.stem, result.question.passage ?? '', ...result.question.instructions, ...result.question.options.map(o => o.text)].join(' ') : ''
  const terms = fixture.expected.criticalText
  return { schemaValid: true, categoryCorrect: result.category === fixture.expected.category, statusCorrect, answerCorrect, shouldAbstain,
    abstained: result.status !== 'solved', criticalTextCoverage: terms.length ? terms.filter(term => visibleText.includes(term)).length / terms.length : null }
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
