import { calculateExpression, numericAnswer, numbersAgree } from './calculator'
import type { AptitudeObservation, AptitudeVerification } from './schema'

export function verifyAptitudeObservation(input: AptitudeObservation): { observation: AptitudeObservation; verification: AptitudeVerification } {
  if (input.status !== 'solved' || !input.answer) return { observation: input, verification: { method: 'none', outcome: 'not_run', notes: ['No completed answer was published.'] } }
  const calculation = input.answer.calculation
  if (!calculation) return { observation: input, verification: { method: 'source_review', outcome: 'not_run', notes: ['AI explanation only. No independent correctness check was run.'] } }
  let value: number
  try { value = calculateExpression(calculation.expression, calculation.decimalPlaces).value }
  catch {
    return { observation: { ...input, status: 'ambiguous', answer: null, message: 'The proposed calculation could not be checked. Review the captured quantities and formula.' },
      verification: { method: 'arithmetic', outcome: 'disagreed', notes: ['The calculation is invalid or exceeds the restricted calculator limits.'] } }
  }
  const mismatches: string[] = []
  if (!numbersAgree(value, calculation.claimedValue)) mismatches.push('The expression does not equal the proposed result.')
  const answerValue = numericAnswer(input.answer.value, input.answer.unit)
  if (answerValue !== null && !numbersAgree(value, answerValue)) mismatches.push('The answer value does not match the calculated result.')
  if (input.question?.responseType === 'single_choice') {
    const option = input.question.options.find(o => o.id === input.answer!.selectedOptionIds[0])
    const selectedValue = numericAnswer(option?.text ?? null, input.answer.unit)
    if (selectedValue !== null && !numbersAgree(value, selectedValue)) mismatches.push('The selected option does not match the calculated result.')
  }
  if (mismatches.length) return {
    observation: { ...input, status: 'ambiguous', answer: null, message: 'The calculation and proposed answer disagree. A reliable answer is not available.' },
    verification: { method: 'arithmetic', outcome: 'disagreed', notes: mismatches },
  }
  return { observation: input, verification: { method: 'arithmetic', outcome: 'passed', notes: [
    'The displayed expression and comparable numeric answer values agree.',
    'This checks arithmetic only; it does not independently verify image reading, formula choice, units, or the question’s meaning.',
  ] } }
}
