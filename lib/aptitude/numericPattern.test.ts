import { describe, expect, it } from 'vitest'
import { predictNumericPattern } from './numericPattern'
import { verifyAptitudeObservation } from './verify'
import { solvedObservation } from './testFixtures'
import type { AptitudeAnswer } from './schema'

type Pattern = NonNullable<AptitudeAnswer['numericPattern']>
function patternAnswer(pattern: Pattern, value: number, expression: string | null) {
  const observation = solvedObservation()
  observation.category = 'abstract'
  observation.question!.stem = 'Which number follows the visible sequence?'
  observation.question!.instructions = ['Choose one answer.']
  observation.question!.options = [
    { id: 'option-1', label: '', text: '29' },
    { id: 'option-2', label: '', text: '31' },
  ]
  observation.answer = {
    selectedOptionIds: [value === 31 ? 'option-2' : 'option-1'], value: String(value), unit: null,
    summary: `The next value is ${value}.`,
    workedExplanation: ['The successive differences are 4, 6, 8; the next difference is 10.'],
    evidence: ['The visible ordered numbers are 3, 7, 13, 21.'],
    calculation: expression ? { expression, claimedValue: value, decimalPlaces: null } : null,
    numericPattern: pattern,
  }
  return observation
}

describe('bounded numeric pattern consistency', () => {
  it('checks first differences, second differences and ratios across every observation', () => {
    expect(predictNumericPattern({ observedValues: [3, 7, 13, 21], rule: 'constant_second_difference' })).toBe(31)
    expect(predictNumericPattern({ observedValues: [17, 12, 7], rule: 'constant_difference' })).toBe(2)
    expect(predictNumericPattern({ observedValues: [2, -6, 18, -54], rule: 'constant_ratio' })).toBe(162)
    expect(predictNumericPattern({ observedValues: [0, 0, 0], rule: 'constant_difference' })).toBe(0)
  })
  it('uses exact decimal transitions and requested final rounding', () => {
    expect(predictNumericPattern({ observedValues: [0.1, 0.2, 0.3], rule: 'constant_difference' })).toBe(0.4)
    expect(predictNumericPattern({ observedValues: [0.1, 0.2, 0.4, 0.7], rule: 'constant_second_difference' })).toBe(1.1)
    expect(predictNumericPattern({ observedValues: [1, 0.5, 0.25], rule: 'constant_ratio' }, 2)).toBe(0.13)
  })
  it('rejects a convenient final pair when earlier transitions contradict the stated rule', () => {
    for (const pattern of [
      { observedValues: [2, 5, 9, 13], rule: 'constant_difference' },
      { observedValues: [1, 2, 6, 12], rule: 'constant_ratio' },
      { observedValues: [1, 3, 7, 15], rule: 'constant_second_difference' },
    ] as Pattern[]) expect(() => predictNumericPattern(pattern)).toThrow(/every observed transition/)
  })
  it('refuses insufficient, unbounded and undefined rules', () => {
    for (const pattern of [
      { observedValues: [1, 3], rule: 'constant_difference' },
      { observedValues: [1, 3, 7], rule: 'constant_second_difference' },
      { observedValues: [1, 0, 0], rule: 'constant_ratio' },
      { observedValues: [1, Infinity, 3], rule: 'constant_difference' },
      { observedValues: [1e-13, 2e-13, 3e-13], rule: 'constant_difference' },
    ] as Pattern[]) expect(() => predictNumericPattern(pattern)).toThrow()
  })
  it('withholds correct arithmetic that contradicts the stated increasing-difference rule', () => {
    // The old expression-only check passed 21 + 8 = 29 despite the rule requiring the NEXT difference, 10.
    const observation = patternAnswer({ observedValues: [3, 7, 13, 21], rule: 'constant_second_difference' }, 29, '21+8')
    const checked = verifyAptitudeObservation(observation)
    expect(checked.observation).toMatchObject({ status: 'ambiguous', answer: null })
    expect(checked.verification).toMatchObject({ method: 'arithmetic', outcome: 'disagreed' })
    expect(checked.verification.notes).toContain('The final calculation does not follow the stated numeric pattern.')
  })
  it('accepts a consistent next value and describes the limited scope of this check', () => {
    const observation = patternAnswer({ observedValues: [3, 7, 13, 21], rule: 'constant_second_difference' }, 31, '21+(21-13)+((21-13)-(13-7))')
    const checked = verifyAptitudeObservation(observation)
    expect(checked.observation.status).toBe('solved')
    expect(checked.verification.outcome).toBe('passed')
    expect(checked.verification.notes.join(' ')).toContain('does not establish that the rule is unique')
    expect(checked.verification.notes.join(' ')).toContain('does not independently verify image reading')
  })
  it('still checks the pattern if the model omitted its separate calculation', () => {
    const pattern: Pattern = { observedValues: [3, 7, 13, 21], rule: 'constant_second_difference' }
    expect(verifyAptitudeObservation(patternAnswer(pattern, 29, null)).observation.status).toBe('ambiguous')
    expect(verifyAptitudeObservation(patternAnswer(pattern, 31, null)).observation.status).toBe('solved')
  })
})
