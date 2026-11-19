import { calculateExpression, numericAnswer, numbersAgree } from './calculator'
import type { AptitudeObservation, AptitudeVerification } from './schema'
import { predictNumericPattern } from './numericPattern'

export function verifyAptitudeObservation(input: AptitudeObservation): { observation: AptitudeObservation; verification: AptitudeVerification } {
  if (input.status !== 'solved' || !input.answer) return { observation: input, verification: { method: 'none', outcome: 'not_run', notes: ['No completed answer was published.'] } }
  const calculation = input.answer.calculation
  const numericPattern = input.answer.numericPattern
  if (!calculation && !numericPattern) return { observation: input, verification: { method: 'source_review', outcome: 'not_run', notes: ['AI explanation only. No independent correctness check was run.'] } }
  let value: number | null = null
  let patternValue: number | null = null
  try {
    if (calculation) value = calculateExpression(calculation.expression, calculation.decimalPlaces).value
    if (numericPattern) patternValue = predictNumericPattern(numericPattern, calculation?.decimalPlaces ?? null)
  }
  catch {
    return { observation: { ...input, status: 'ambiguous', answer: null, message: 'The proposed calculation or numeric pattern could not be checked. Review the captured values and stated rule.' },
      verification: { method: 'arithmetic', outcome: 'disagreed', notes: ['The calculation is invalid, the numeric rule does not fit every transcribed transition, or a check exceeds the supported limits.'] } }
  }
  const mismatches: string[] = []
  if (calculation && value !== null && !numbersAgree(value, calculation.claimedValue)) mismatches.push('The expression does not equal the proposed result.')
  if (patternValue !== null && value !== null && !numbersAgree(value, patternValue)) mismatches.push('The final calculation does not follow the stated numeric pattern.')
  const checkedValue = patternValue ?? value!
  const answerValue = numericAnswer(input.answer.value, input.answer.unit)
  if (answerValue !== null && !numbersAgree(checkedValue, answerValue)) mismatches.push('The answer value does not match the calculated result.')
  let selectedValue: number | null = null
  if (input.question?.responseType === 'single_choice') {
    const option = input.question.options.find(o => o.id === input.answer!.selectedOptionIds[0])
    selectedValue = numericAnswer(option?.text ?? null, input.answer.unit)
    if (selectedValue !== null && !numbersAgree(checkedValue, selectedValue)) mismatches.push('The selected option does not match the calculated result.')
  }
  if (numericPattern && answerValue === null && selectedValue === null) mismatches.push('The numeric pattern cannot be matched to a scalar answer value or numeric option.')
  if (mismatches.length) return {
    observation: { ...input, status: 'ambiguous', answer: null, message: 'The calculation and proposed answer disagree. A reliable answer is not available.' },
    verification: { method: 'arithmetic', outcome: 'disagreed', notes: mismatches },
  }
  return { observation: input, verification: { method: 'arithmetic', outcome: 'passed', notes: [
    ...(numericPattern ? ['The stated numeric rule fits every transcribed transition and its next value matches the proposed answer. This does not establish that the rule is unique.'] : []),
    ...(calculation ? ['The displayed expression and comparable numeric answer values agree.'] : []),
    'This checks arithmetic only; it does not independently verify image reading, formula choice, units, or the question’s meaning.',
  ] } }
}
