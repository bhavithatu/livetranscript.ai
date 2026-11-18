/** Synthetic responses for component/lifecycle tests only. Never imported by the product. */
import type { AptitudeComparison, AptitudeComparisonCandidate, AptitudeObservation, AptitudeResult } from '@/lib/aptitude/schema'

export function comparisonFixture(base: AptitudeResult, decision: AptitudeComparison['decision'] = 'agreement'): AptitudeResult {
  if (!base.answer || !base.question || base.status !== 'solved') throw new Error('Comparison fixture requires a solved base')
  const observation: AptitudeObservation = {
    category: base.category, status: 'solved', question: structuredClone(base.question), answer: structuredClone(base.answer), message: null,
  }
  const candidate = (provider: 'openai' | 'anthropic', model: string, durationMs: number): AptitudeComparisonCandidate => ({
    modelId: `${provider}:${model}`, model, provider, status: 'complete', observation: structuredClone(observation),
    verification: structuredClone(base.verification), durationMs, error: null,
  })
  const first = candidate('openai', 'test-model-a', 1370)
  const second = candidate('anthropic', 'test-model-b', 2240)
  const candidates = [first, second]
  const disagree = (item: AptitudeComparisonCandidate) => {
    item.observation!.answer = {
      ...item.observation!.answer!, selectedOptionIds: [base.question!.options[0].id], value: '20',
      summary: 'The increase is 20%.', workedExplanation: ['The increase is 18.', 'Divide by the later value: 18 ÷ 90 × 100 = 20%.'],
      calculation: { expression: '(90-72)/90*100', claimedValue: 20, decimalPlaces: null },
    }
  }
  if (decision === 'disagreement') disagree(second)
  if (decision === 'majority') {
    const third = candidate('openai', 'test-model-c', 1830)
    disagree(third)
    candidates.push(third)
  }
  if (decision === 'insufficient') Object.assign(second, {
    status: 'timed_out', model: null, observation: null, verification: null, durationMs: 25_000, error: 'The model did not finish before the deadline.',
  })
  const resolved = decision === 'agreement' || decision === 'majority'
  const comparison: AptitudeComparison = {
    decision, selectedModelId: resolved ? second.modelId : null, agreementCount: resolved ? 2 : 1,
    notes: ['Synthetic test response; no live model or measured provider performance.'], candidates,
  }
  return resolved ? { ...base, comparison, model: second.model, provider: second.provider,
    question: second.observation!.question, answer: second.observation!.answer, verification: second.verification! }
    : { ...base, comparison, status: 'ambiguous', answer: null, model: null, provider: null,
      verification: { method: 'none', outcome: 'not_run', notes: [] }, message: 'No answer was selected for this comparison.' }
}
