import { comparisonAnswersMatch, comparisonSourcesMatch, isEligibleAptitudeCandidate, selectAptitudeComparison } from './comparison'
import type { AptitudeComparisonCandidate, AptitudeObservation, AptitudeResult } from './schema'

export type QuestionDifficulty = { level: 'Easy' | 'Moderate' | 'Hard' | 'Not rated'; reasons: string[] }
export type AnswerGuidance = {
  candidate: AptitudeComparisonCandidate | null
  confidenceScore: number
  confidenceBasis: string
  provisional: boolean
  label: 'Best available answer' | 'Best-effort answer' | 'No reliable answer yet'
  reasons: string[]
  difficulty: QuestionDifficulty
}

/** A local reading/constraint-load estimate, not measured human difficulty.
 * No model calls, timers, persistence, analytics or network access. */
export function estimateQuestionDifficulty(observation: AptitudeObservation | null): QuestionDifficulty {
  const q = observation?.question
  if (!q || q.missingEvidence.length || observation?.status === 'needs_capture' || observation?.status === 'unsupported') {
    return { level: 'Not rated', reasons: ['A complete, supported question is needed to estimate difficulty.'] }
  }
  const text = [q.stem, ...q.instructions, q.passage ?? '', ...q.options.map(o => o.text)].join(' ')
  let load = 0
  const reasons: string[] = []
  if (text.split(/\s+/).length > 150) { load += 2; reasons.push('Long passage or detailed choices') }
  if (q.responseType === 'multiple_choice' || /\b(?:select|choose) all\b/i.test(text)) { load++; reasons.push('Several choices may need to be checked') }
  const constraints = text.match(/\b(?:before|after|between|unless|only if|at least|at most|exactly|neither|either|must|cannot|every|all|some|none)\b/gi)?.length ?? 0
  if (constraints >= 3) { load += 2; reasons.push('Several interacting constraints') }
  else if (constraints) { load++; reasons.push('Explicit constraints to check') }
  if (observation?.category === 'abstract' || observation?.category === 'spatial') { load += 2; reasons.push('Visual relationships or transformations') }
  if (observation?.category === 'critical_reasoning' || observation?.category === 'data_interpretation') { load += 2; reasons.push('Interpret evidence before selecting an answer') }
  if (observation?.answer?.numericPattern?.rule === 'constant_second_difference') { load += 2; reasons.push('Differences change between terms') }
  if (observation?.category === 'numerical' && /\b(?:average|weighted|simultaneous|fixed value)\b/i.test(text)) { load += 2; reasons.push('Combine quantities or solve related values') }
  if (observation?.category === 'spatial' && /reflect/i.test(text) && /rotat/i.test(text)) { load += 2; reasons.push('Apply reflection and rotation in the stated order') }
  const grid = observation?.answer?.gridInventory
  if (grid && grid.rows * grid.columns >= 9) { load += 2; reasons.push('Compare a matrix of at least nine panels') }
  if (q.options.length > 5) { load++; reasons.push('Many options to compare') }
  if (!reasons.length) reasons.push('Short question with few explicit constraints')
  return { level: load >= 4 ? 'Hard' : load >= 2 ? 'Moderate' : 'Easy', reasons }
}

export function resultCandidates(result: AptitudeResult): AptitudeComparisonCandidate[] {
  return result.comparison?.candidates ?? [{ modelId: `${result.provider ?? 'unknown'}:${result.model ?? 'unknown'}`, model: result.model,
    provider: result.provider ?? 'openai', status: result.status === 'error' ? 'failed' : 'complete',
    observation: result.status === 'error' ? null : { category: result.category, status: result.status, question: result.question, answer: result.answer, message: result.message },
    verification: result.verification, durationMs: result.durationMs, error: result.status === 'error' ? result.message : null }]
}

/** Recommendation is deliberately separate from strict corroboration. A single
 * valid answer need not disappear because a second model failed. The score is
 * a conservative UI heuristic, never a probability or a model benchmark rank. */
export function buildAnswerGuidance(candidates: AptitudeComparisonCandidate[], provisional = false): AnswerGuidance {
  const usable = candidates.filter(isEligibleAptitudeCandidate)
  const { comparison, selected } = selectAptitudeComparison(candidates)
  const arithmetic = (c: AptitudeComparisonCandidate) => c.verification?.method === 'arithmetic' && c.verification.outcome === 'passed' ? 1 : 0
  // Do not promote the model which simply claims the highest confidence. A
  // deterministic tie-break is explicit; it is not evidence of model quality.
  const candidate = selected ?? [...usable].sort((a,b) => arithmetic(b)-arithmetic(a) || a.modelId.localeCompare(b.modelId))[0] ?? null
  const difficulty = estimateQuestionDifficulty(candidate?.observation ?? candidates.find(c => c.observation?.question)?.observation ?? null)
  if (!candidate) return { candidate: null, confidenceScore: 0, confidenceBasis: 'No usable answer evidence; not a probability that a guess is wrong.', provisional,
    label: 'No reliable answer yet', difficulty,
    reasons: [provisional ? 'The models are still working.' : 'No model supplied a complete answer that passed the available checks.',
      'A score is always shown, but missing question content or failed calculations cannot justify inventing an answer.'] }
  // An alias collision prevents independent corroboration, but must not hide
  // contradictions between the responses and give them the single-answer cap.
  const conflict = comparison.decision === 'disagreement' || comparison.decision === 'insufficient' && usable.length > 1 &&
    (!comparisonAnswersMatch(usable) || !comparisonSourcesMatch(usable))
  const cap = Math.min(provisional ? 65 : 100, conflict ? 45 : selected ? comparison.decision === 'majority' ? 80 : 95 : 70)
  const reported = candidate.observation!.answer!.confidence
  const hasRating = typeof reported === 'number' && Number.isInteger(reported) && reported >= 0 && reported <= 100
  const confidenceScore = Math.min(cap, hasRating ? reported : 50)
  const reasons = selected
    ? [`${comparison.agreementCount} eligible models support the same answer and source reading.`]
    : conflict ? ['The returned responses disagree on the answer or source reading. Treat this as a tentative choice.']
      : ['This is the available checked response; another model has not corroborated it.']
  if (!selected && usable.length > 1) reasons.push(arithmetic(candidate) > Math.min(...usable.map(arithmetic))
    ? 'Preferred because its arithmetic passed; that does not establish its interpretation is correct.'
    : 'Available checks do not distinguish these candidates; stable model order breaks the tie, not claimed confidence.')
  if (comparison.decision === 'insufficient' && usable.length > 1) reasons.push('Repeated output from the same model is not independent corroboration.')
  if (provisional) reasons.push('Provisional: this recommendation can change when the remaining models finish.')
  return { candidate, confidenceScore,
    confidenceBasis: hasRating ? `Model estimate ${reported}/100, limited to ${cap}/100 for the available support. Uncalibrated.` : 'No model estimate supplied: conservative 50/100 fallback, limited by available support. Uncalibrated.',
    provisional, label: conflict ? 'Best-effort answer' : 'Best available answer',
    reasons, difficulty }
}
