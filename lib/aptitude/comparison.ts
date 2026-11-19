import type { AptitudeComparison, AptitudeComparisonCandidate, AptitudeQuestion } from './schema'

/** Label decoration is presentation. Literal option text and source evidence are never normalized. */
export function canonicalAptitudeOptionLabel(label: string): string {
  const value = label.trim().replace(/\.$/, '').trim()
  const bracketed = /^(?:\(\s*([A-Za-z]|\d+)\s*\)|\[\s*([A-Za-z]|\d+)\s*\])$/.exec(value)
  return bracketed ? bracketed[1] ?? bracketed[2] : value
}
function sourceKey(candidate: AptitudeComparisonCandidate): string | null {
  const observation = candidate.observation
  const question = observation?.question
  if (!observation || !question) return null
  const labels = question.options.map(option => canonicalAptitudeOptionLabel(option.label))
  const nonemptyLabels = labels.filter(Boolean)
  // Repeated literal choices or colliding labels cannot be mapped unambiguously between models.
  if (new Set(question.options.map(option => option.text)).size !== question.options.length || new Set(nonemptyLabels).size !== nonemptyLabels.length) return null
  const options = question.options.map(option => ({ label: canonicalAptitudeOptionLabel(option.label), text: option.text }))
    .sort((a,b) => a.label.localeCompare(b.label) || a.text.localeCompare(b.text))
  // For diagram questions the literal stem often says only "Which pattern?".
  // Matching that text and a final answer cannot corroborate incompatible pixels.
  const visualEvidence = observation.category === 'abstract' || observation.category === 'spatial'
    ? observation.answer?.evidence.map(item => item.trim().replace(/\s+/g, ' ')).sort() ?? [] : null
  const grid = observation.answer?.gridInventory
  // Provider IDs and record order are arbitrary; visible option identity and
  // occupied cells are source facts. A missing marker never equals an empty grid.
  const gridInventory = grid ? {
    rows: grid.rows, columns: grid.columns, cellRows: grid.cellRows, cellColumns: grid.cellColumns,
    panels: grid.panels.map(panel => ({ ...panel, filledCells: panel.filledCells === null ? null : [...panel.filledCells].sort() }))
      .sort((a, b) => a.row - b.row || a.column - b.column),
    options: grid.options.map(inventory => {
      const option = question.options.find(option => option.id === inventory.optionId)
      return option ? { label: canonicalAptitudeOptionLabel(option.label), text: option.text, filledCells: [...inventory.filledCells].sort() } : null
    }).sort((a, b) => a && b ? a.label.localeCompare(b.label) || a.text.localeCompare(b.text) : 0),
  } : null
  if (gridInventory?.options.some(option => option === null)) return null
  return JSON.stringify({ category: observation.category, stem: question.stem, instructions: question.instructions,
    passage: question.passage, responseType: question.responseType, options, visualEvidence, gridInventory })
}
function answerKey(candidate: AptitudeComparisonCandidate): string | null {
  const answer = candidate.observation?.answer
  const question = candidate.observation?.question
  if (!answer || !question) return null
  if (question.responseType === 'free_response') return JSON.stringify({ value: answer.value, unit: answer.unit })
  const selected = answer.selectedOptionIds.map(id => question.options.find(option => option.id === id)?.text)
  if (selected.some(text => text === undefined)) return null
  return JSON.stringify(selected.sort())
}
const eligible = (candidate: AptitudeComparisonCandidate) => candidate.status === 'complete' && candidate.observation?.status === 'solved' &&
  candidate.observation.question !== null && candidate.observation.question.missingEvidence.length === 0 && candidate.observation.answer !== null &&
  candidate.observation.answer.evidence.length > 0 && candidate.observation.answer.workedExplanation.length > 0 &&
  candidate.verification !== null && candidate.verification.outcome !== 'disagreed'
const checked = (candidate: AptitudeComparisonCandidate) => candidate.verification?.method === 'arithmetic' && candidate.verification.outcome === 'passed' ? 1 : 0
export { eligible as isEligibleAptitudeCandidate }
const CAUTION = 'Model agreement is not calibrated correctness. Models can share the same transcription or reasoning mistake.'

/** Presentation only: matching answer values never relax the source agreement gate. */
export function comparisonAnswersMatch(candidates: AptitudeComparisonCandidate[]): boolean {
  const usable = candidates.filter(eligible)
  const keys = usable.map(answerKey)
  return usable.length >= 2 && keys.every(key => key !== null) && new Set(keys).size === 1
}

/** Even repeated outputs from one model can contradict the captured source.
 * This detects a conflict; it never establishes independent corroboration. */
export function comparisonSourcesMatch(candidates: AptitudeComparisonCandidate[]): boolean {
  const usable = candidates.filter(eligible)
  const keys = usable.map(sourceKey)
  return usable.length >= 2 && keys.every(key => key !== null) && new Set(keys).size === 1
}

/** Deterministic corroboration, not a confidence ranking or an LLM judge. Safe for runtime wire validation. */
export function selectAptitudeComparison(candidates: AptitudeComparisonCandidate[]): { comparison: AptitudeComparison; selected: AptitudeComparisonCandidate | null } {
  const finish = (decision: AptitudeComparison['decision'], count: number, notes: string[], selected: AptitudeComparisonCandidate | null = null) => ({
    comparison: { decision, selectedModelId: selected?.modelId ?? null, agreementCount: count, notes: [...notes, CAUTION], candidates }, selected,
  })
  const usable = candidates.filter(eligible)
  if (usable.length < 2) return finish('insufficient', usable.length, ['At least two complete, eligible model answers are required. Failed, timed-out, ambiguous or unsupported candidates do not vote.'])
  if (new Set(usable.map(candidate => `${candidate.provider}:${candidate.model}`)).size !== usable.length) return finish('insufficient', 0, ['The returned model identities are not distinct; repeated model output is not independent corroboration.'])
  const sources = usable.map(sourceKey)
  if (sources.some(key => key === null) || new Set(sources).size !== 1) return finish('disagreement', 0, [
    'The models did not transcribe the same question, visual evidence and complete option mapping, or repeated option text could not be mapped uniquely. No answer was selected.',
    'Comparison preserves literal source and option text. Even a benign paraphrase can require manual review.',
  ])
  const groups = new Map<string, AptitudeComparisonCandidate[]>()
  for (const candidate of usable) {
    const key = answerKey(candidate)
    if (key === null) return finish('disagreement', 0, ['A selected answer could not be matched to the visible options.'])
    groups.set(key, [...(groups.get(key) ?? []), candidate])
  }
  const ranked = [...groups.values()].sort((a,b) => b.length-a.length)
  const winners = ranked[0]
  if (!winners || winners.length < 2 || (ranked[1] && ranked[1].length === winners.length)) return finish('disagreement', winners?.length ?? 0, ['The eligible models chose different answers to the same transcribed question. Review their evidence; no answer was selected.'])
  const selected = [...winners].sort((a,b) => checked(b)-checked(a) || a.modelId.localeCompare(b.modelId))[0]
  const decision = winners.length === usable.length ? 'agreement' : 'majority'
  const notes = [decision === 'majority'
    ? `${winners.length} of ${usable.length} eligible models chose the same answer; another eligible model disagreed. This is a majority, not unanimous agreement.`
    : `${winners.length} eligible models agree on the transcribed question, complete options, and selected answer text.`]
  if (usable.length < candidates.length) notes.push(`${candidates.length-usable.length} configured candidate(s) failed, timed out or abstained and did not vote.`)
  notes.push(checked(selected) ? 'The displayed representative passed the restricted arithmetic check. Formula choice, image reading and semantics remain unverified.' : 'No independent arithmetic check distinguishes these matching answers; a stable model-ID order selects the displayed representative.')
  return finish(decision, winners.length, notes, selected)
}

/** A source view to show for review when selection is withheld; it never carries an answer. */
export function comparisonReviewQuestion(candidates: AptitudeComparisonCandidate[]): { category: NonNullable<AptitudeComparisonCandidate['observation']>['category']; question: AptitudeQuestion | null } {
  const observation = candidates.find(candidate => candidate.status === 'complete' && candidate.observation?.question)?.observation
  return { category: observation?.category ?? 'unknown', question: observation?.question ?? null }
}
