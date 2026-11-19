import { describe, expect, it } from 'vitest'
import { comparisonAnswersMatch, selectAptitudeComparison } from './comparison'
import { parseAptitudeComparison, parseAptitudeResult, type AptitudeComparisonCandidate, type AptitudeObservation } from './schema'
import { verifyAptitudeObservation } from './verify'
import { solvedGridObservation, solvedObservation } from './testFixtures'

const ids = ['anthropic:claude-sonnet-4-5', 'openai:gpt-4.1', 'openai:gpt-4.1-mini']
function candidate(index: number, observation = solvedObservation()): AptitudeComparisonCandidate {
  const checked = verifyAptitudeObservation(observation)
  return { modelId: ids[index], model: `${ids[index].split(':')[1]}-actual`, provider: index === 0 ? 'anthropic' : 'openai', status: 'complete',
    observation: checked.observation, verification: checked.verification, durationMs: 12, error: null }
}
function wrongButConsistent(): AptitudeObservation {
  const observation = solvedObservation()
  observation.answer!.selectedOptionIds = ['A']; observation.answer!.value = '20'; observation.answer!.summary = 'A — 20%'
  observation.answer!.calculation = { expression: '(100-80)/100*100', claimedValue: 20, decimalPlaces: null }
  return observation
}
function completedResult(candidates: AptitudeComparisonCandidate[]) {
  const { comparison, selected } = selectAptitudeComparison(candidates)
  return { ...selected!.observation!, schemaVersion: 1, captureId: 'comparison-1', questionVersion: 1, questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
    model: selected!.model, provider: selected!.provider, durationMs: 24, verification: selected!.verification, comparison }
}

describe('deterministic model comparison', () => {
  it('corroborates literal option text despite different generated IDs and label decorations', () => {
    const other = solvedObservation()
    other.question!.options = [{ id: 'second-choice', label: '(B)', text: '25%' }, { id: 'first-choice', label: 'A.', text: '20%' }]
    other.answer!.selectedOptionIds = ['second-choice']
    const { comparison, selected } = selectAptitudeComparison([candidate(1, other), candidate(0)])
    expect(comparison).toMatchObject({ decision: 'agreement', agreementCount: 2, selectedModelId: ids[0] })
    expect(selected?.observation?.answer?.selectedOptionIds).toEqual(['B'])
  })
  it('does not count matching model-generated IDs as matching answers', () => {
    const other = wrongButConsistent()
    other.question!.options[0].id = 'B'; other.question!.options[1].id = 'A'
    other.answer!.selectedOptionIds = ['B']
    expect(selectAptitudeComparison([candidate(0), candidate(1, other)]).comparison).toMatchObject({ decision: 'disagreement', selectedModelId: null, agreementCount: 1 })
  })
  it('withholds a tie while retaining both complete observations for review', () => {
    const { comparison, selected } = selectAptitudeComparison([candidate(0), candidate(1, wrongButConsistent())])
    expect(selected).toBeNull()
    expect(comparison).toMatchObject({ decision: 'disagreement', agreementCount: 1, selectedModelId: null })
    expect(comparison.candidates.every(item => item.observation?.answer)).toBe(true)
  })
  it('labels a two-of-three majority and retains the dissenting answer', () => {
    const result = selectAptitudeComparison([candidate(0), candidate(1), candidate(2, wrongButConsistent())])
    expect(result.comparison).toMatchObject({ decision: 'majority', agreementCount: 2, selectedModelId: ids[0] })
    expect(result.comparison.notes.join(' ')).toContain('not unanimous')
    expect(result.comparison.candidates[2].observation?.answer?.selectedOptionIds).toEqual(['A'])
  })
  it('does not turn a majority into a semantic correctness guarantee', () => {
    // Both wrong candidates use the new value as the percentage denominator. Arithmetic passes, semantics are wrong.
    const result = selectAptitudeComparison([candidate(0, wrongButConsistent()), candidate(1, wrongButConsistent()), candidate(2)])
    expect(result.comparison.decision).toBe('majority')
    expect(result.selected?.observation?.answer?.selectedOptionIds).toEqual(['A'])
    expect(result.comparison.notes.join(' ')).toContain('not calibrated correctness')
    expect(result.comparison.notes.join(' ')).toContain('same transcription or reasoning mistake')
  })
  it('withholds even a matching two-vote answer when an eligible source transcription differs', () => {
    const other = solvedObservation(); other.question!.stem = 'A value rises from 90 to 100. What is the percentage increase?'
    expect(selectAptitudeComparison([candidate(0), candidate(1), candidate(2, other)]).comparison).toMatchObject({ decision: 'disagreement', agreementCount: 0, selectedModelId: null })
  })
  it('preserves literal option text, punctuation, case and zero/O differences', () => {
    for (const changed of ['25 %', '25%.', '25 percent']) {
      const other = solvedObservation(); other.answer!.calculation = null; other.question!.options[1].text = changed
      expect(selectAptitudeComparison([candidate(0), candidate(1, other)]).selected).toBeNull()
    }
    const original = solvedObservation(); original.category = 'checking'; original.answer!.calculation = null
    original.question!.options = [{ id: 'A', label: 'A', text: 'AOl-7B2' }, { id: 'B', label: 'B', text: 'A0l-7B2' }]
    const other = structuredClone(original); other.question!.options[1].text = 'a0l-7B2'
    expect(selectAptitudeComparison([candidate(0, original), candidate(1, other)]).comparison.decision).toBe('disagreement')
    expect(original.question!.options[1].text).toBe('A0l-7B2')
  })
  it('withholds ambiguous option mappings and free-response unit conflicts', () => {
    const duplicate = solvedObservation(); duplicate.question!.options[0].text = '25%'
    expect(selectAptitudeComparison([candidate(0, duplicate), candidate(1, duplicate)]).selected).toBeNull()
    const free = solvedObservation(); free.question!.responseType = 'free_response'; free.question!.options = []; free.answer!.selectedOptionIds = []; free.answer!.calculation = null
    const other = structuredClone(free); other.answer!.unit = 'percentage points'
    expect(selectAptitudeComparison([candidate(0, free), candidate(1, other)]).comparison.decision).toBe('disagreement')
  })
  it('does not give failed, ambiguous or arithmetic-disagreed candidates a vote', () => {
    const ambiguous: AptitudeObservation = { ...solvedObservation(), status: 'ambiguous', answer: null, message: 'Two interpretations fit.' }
    const arithmeticMismatch = wrongButConsistent(); arithmeticMismatch.answer!.calculation!.claimedValue = 19
    for (const excluded of [candidate(1, ambiguous), candidate(1, arithmeticMismatch), { ...candidate(1), status: 'failed' as const, observation: null, verification: null, error: 'Unavailable' }]) {
      expect(selectAptitudeComparison([candidate(0), excluded]).comparison).toMatchObject({ decision: 'insufficient', agreementCount: 1, selectedModelId: null })
    }
  })
  it('does not count a nominal solved candidate with missing source evidence', () => {
    const incomplete = candidate(1); incomplete.observation!.question!.missingEvidence = ['Table units are cropped.']
    expect(selectAptitudeComparison([candidate(0), incomplete]).comparison).toMatchObject({ decision: 'insufficient', agreementCount: 1 })
    const noEvidence = candidate(1); noEvidence.observation!.answer!.evidence = []
    expect(selectAptitudeComparison([candidate(0), noEvidence]).selected).toBeNull()
  })
  it('keeps two valid agreements when the third candidate fails without inventing a dissenting vote', () => {
    const failed = { ...candidate(2), status: 'failed' as const, observation: null, verification: null, error: 'Unavailable' }
    const { comparison } = selectAptitudeComparison([candidate(0), candidate(1), failed])
    expect(comparison).toMatchObject({ decision: 'agreement', agreementCount: 2 })
    expect(comparison.notes.join(' ')).toContain('did not vote')
  })
  it('prefers a checked representative deterministically without consulting model confidence or response speed', () => {
    const unchecked = candidate(0); unchecked.observation!.answer!.calculation = null; unchecked.verification = { method: 'source_review', outcome: 'not_run', notes: ['Not checked.'] }; unchecked.durationMs = 1
    const checked = candidate(1); checked.durationMs = 999
    expect(selectAptitudeComparison([unchecked, checked]).selected?.modelId).toBe(ids[1])
    expect(selectAptitudeComparison([checked, unchecked]).selected?.modelId).toBe(ids[1])
  })
  it('does not treat a repeated returned model identity as independent corroboration', () => {
    const first = candidate(1), second = candidate(2); second.model = first.model
    expect(selectAptitudeComparison([first, second]).comparison).toMatchObject({ decision: 'insufficient', agreementCount: 0, selectedModelId: null })
  })
  it('requires diagram evidence as well as matching answer values for visual corroboration', () => {
    const first = solvedObservation(); first.category = 'abstract'
    first.answer!.evidence = ['r1c1: 1 star with 4 points', 'r1c2: 1 star with 5 points']
    const other = structuredClone(first)
    other.answer!.evidence = ['r1c1: 1 star', 'r1c2: 2 stars']
    const candidates = [candidate(0, first), candidate(1, other)]
    expect(comparisonAnswersMatch(candidates)).toBe(true)
    expect(selectAptitudeComparison(candidates).comparison).toMatchObject({ decision: 'disagreement', selectedModelId: null })
    other.answer!.evidence = [...first.answer!.evidence].reverse()
    expect(selectAptitudeComparison([candidate(0, first), candidate(1, other)]).comparison.decision).toBe('agreement')
  })
  it('compares typed source and option cells even when answer and prose are identical', () => {
    const first = solvedGridObservation()
    const sourceMismatch = structuredClone(first)
    sourceMismatch.answer!.gridInventory!.panels[0].filledCells = ['r2c2']
    const optionMismatch = structuredClone(first)
    optionMismatch.answer!.gridInventory!.options[1].filledCells = ['r1c1']
    const missingMismatch = structuredClone(first)
    missingMismatch.answer!.gridInventory!.panels[3].filledCells = []
    const omitted = structuredClone(first)
    delete omitted.answer!.gridInventory
    for (const other of [sourceMismatch, optionMismatch, missingMismatch, omitted]) {
      const candidates = [candidate(0, first), candidate(1, other)]
      expect(comparisonAnswersMatch(candidates)).toBe(true)
      expect(selectAptitudeComparison(candidates).comparison).toMatchObject({ decision: 'disagreement', selectedModelId: null, agreementCount: 0 })
    }
  })
  it('canonicalizes grid record order and option IDs without losing literal cells', () => {
    const first = solvedGridObservation()
    const other = structuredClone(first)
    const grid = other.answer!.gridInventory!
    grid.panels.reverse(); grid.options.reverse(); grid.options[1].filledCells.reverse()
    other.question!.options[1] = { ...other.question!.options[1], id: 'second-choice', label: '(B)' }
    other.question!.options.reverse()
    other.answer!.selectedOptionIds = ['second-choice']
    grid.options[0].optionId = 'second-choice'
    const candidates = [candidate(0, first), candidate(1, other)]
    expect(selectAptitudeComparison(candidates).comparison).toMatchObject({ decision: 'agreement', agreementCount: 2 })
    expect(parseAptitudeResult(completedResult(candidates)).answer!.gridInventory).toEqual(first.answer!.gridInventory)
  })
})

describe('comparison runtime wire validation', () => {
  it('accepts a consistent selected candidate and rejects tampered decision/count/winner metadata', () => {
    const value = completedResult([candidate(0), candidate(1)])
    expect(parseAptitudeResult(value).comparison?.agreementCount).toBe(2)
    expect(() => parseAptitudeComparison({ ...value.comparison, agreementCount: 3 })).toThrow()
    expect(() => parseAptitudeComparison({ ...value.comparison, decision: 'disagreement' })).toThrow()
    expect(() => parseAptitudeComparison({ ...value.comparison, selectedModelId: ids[1] })).toThrow()
    expect(() => parseAptitudeComparison({ ...value.comparison, candidates: [candidate(0), candidate(0)] })).toThrow()
  })
  it('rejects top-level output that differs from the selected candidate', () => {
    const value = completedResult([candidate(0), candidate(1)])
    expect(() => parseAptitudeResult({ ...value, model: 'invented-model' })).toThrow()
    expect(() => parseAptitudeResult({ ...value, answer: { ...value.answer!, selectedOptionIds: ['A'] } })).toThrow()
    expect(() => parseAptitudeResult({ ...value, verification: { method: 'none', outcome: 'not_run', notes: [] } })).toThrow()
  })
  it('cannot publish a solved top-level answer for a tied comparison', () => {
    const comparison = selectAptitudeComparison([candidate(0), candidate(1, wrongButConsistent())]).comparison
    const value = completedResult([candidate(0), candidate(1)])
    expect(() => parseAptitudeResult({ ...value, comparison })).toThrow()
  })
})
