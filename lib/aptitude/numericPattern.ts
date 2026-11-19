import { calculateExpression } from './calculator'
import type { AptitudeAnswer } from './schema'

/** Checks the model's stated, transcribed numeric rule; it does not discover a rule or read pixels. */
export function predictNumericPattern(pattern: NonNullable<AptitudeAnswer['numericPattern']>, decimalPlaces: number | null = null): number {
  const { observedValues, rule } = pattern
  if (!['constant_difference', 'constant_second_difference', 'constant_ratio'].includes(rule) ||
    observedValues.length < (rule === 'constant_second_difference' ? 4 : 3) || observedValues.length > 24) throw new Error('Insufficient observations for the stated numeric rule')
  // Fixed notation prevents scientific notation from bypassing the restricted arithmetic grammar.
  const terms = observedValues.map(value => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e12 || value !== Number(value.toFixed(12))) throw new Error('Unsupported numeric pattern value')
    return `(${value.toFixed(12).replace(/\.?0+$/, '') || '0'})`
  })
  const differences = terms.slice(1).map((value, index) => `${value}-${terms[index]}`)
  let checks: string[]
  let prediction: string
  const last = terms.at(-1)!
  if (rule === 'constant_difference') {
    checks = differences
    prediction = `${last}+(${differences.at(-1)})`
  } else if (rule === 'constant_second_difference') {
    checks = differences.slice(1).map((value, index) => `(${value})-(${differences[index]})`)
    prediction = `${last}+(${differences.at(-1)})+(${checks.at(-1)})`
  } else {
    checks = terms.slice(1).map((value, index) => `${value}/${terms[index]}`)
    prediction = `${last}*(${checks.at(-1)})`
  }
  const evaluated = checks.map(expression => calculateExpression(expression).exact)
  if (new Set(evaluated).size !== 1) throw new Error('The stated rule does not fit every observed transition')
  return calculateExpression(prediction, decimalPlaces).value
}
