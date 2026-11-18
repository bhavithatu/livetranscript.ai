import { parseAptitudeResult } from '@/lib/aptitude/schema'
import type { AptitudeFixture } from './fixtures'

export type AptitudeScore = { schemaValid: boolean; categoryCorrect: boolean; statusCorrect: boolean; answerCorrect: boolean; shouldAbstain: boolean; abstained: boolean; criticalTextCoverage: number | null }
/** Compare label presentation only. Never use this on option text or source evidence. */
function canonicalOptionLabel(label: string): string {
  const value = label.trim().replace(/\.$/, '').trim()
  const bracketed = /^(?:\(\s*([A-Za-z]|\d+)\s*\)|\[\s*([A-Za-z]|\d+)\s*\])$/.exec(value)
  return bracketed ? bracketed[1] ?? bracketed[2] : value
}
export function scoreAptitude(fixture: AptitudeFixture, value: unknown): AptitudeScore {
  const shouldAbstain = fixture.expected.status !== 'solved'
  try {
    const result = parseAptitudeResult(value)
    const labels = (result.answer?.selectedOptionIds ?? []).map(id => canonicalOptionLabel(result.question?.options.find(option => option.id === id)?.label ?? '')).sort()
    const expected = fixture.expected.selectedLabels.map(canonicalOptionLabel).sort()
    const statusCorrect = result.status === fixture.expected.status
    const answerCorrect = statusCorrect && (shouldAbstain ? result.answer === null : JSON.stringify(labels) === JSON.stringify(expected))
    // Diagnostic only: text coverage is NOT a semantic correctness or OCR accuracy score.
    const visibleText = result.question ? [result.question.stem, result.question.passage ?? '', ...result.question.instructions, ...result.question.options.map(o => o.text)].join(' ') : ''
    const terms = fixture.expected.criticalText
    return { schemaValid: true, categoryCorrect: result.category === fixture.expected.category, statusCorrect, answerCorrect, shouldAbstain,
      abstained: result.status !== 'solved', criticalTextCoverage: terms.length ? terms.filter(term => visibleText.includes(term)).length / terms.length : null }
  } catch {
    return { schemaValid: false, categoryCorrect: false, statusCorrect: false, answerCorrect: false, shouldAbstain, abstained: false, criticalTextCoverage: null }
  }
}
export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a,b) => a-b)
  return sorted[Math.max(0, Math.ceil(sorted.length*fraction)-1)]
}
