import type { AptitudeGridInventory, AptitudeQuestion, AptitudeResult } from '@/lib/aptitude/schema'
import { scoreAptitude } from './score'
import { selectionScoringFixture, type SelectionFixture, type SelectionGridTruth } from './selectionFixtures'

const label = (value: string) => value.trim().replace(/\.$/, '').replace(/^\(([A-Za-z])\)$/, '$1').replace(/^\[([A-Za-z])\]$/, '$1')
const cells = (value: readonly string[] | null) => value === null ? null : [...value].sort()

/** Compare literal cells to independently authored truth; prose never substitutes for missing typed facts. */
export function selectionGridMatches(actual: AptitudeGridInventory | null | undefined, options: AptitudeQuestion['options'], truth: SelectionGridTruth): boolean {
  if (!actual || actual.rows !== truth.rows || actual.columns !== truth.columns || actual.cellRows !== truth.cellRows || actual.cellColumns !== truth.cellColumns) return false
  if (actual.panels.length !== truth.panels.length || actual.options.length !== Object.keys(truth.options).length) return false
  for (const expected of truth.panels) {
    const matched = actual.panels.filter(panel => panel.row === expected.row && panel.column === expected.column)
    if (matched.length !== 1 || JSON.stringify(cells(matched[0].filledCells)) !== JSON.stringify(cells(expected.filledCells))) return false
  }
  const observed = new Map<string, string[]>()
  for (const entry of actual.options) {
    const option = options.find(option => option.id === entry.optionId)
    if (!option || observed.has(label(option.label))) return false
    observed.set(label(option.label), entry.filledCells)
  }
  return Object.entries(truth.options).every(([key, expected]) => observed.has(key) && JSON.stringify(cells(observed.get(key)!)) === JSON.stringify(cells(expected)))
}

export function scoreSelectionFixture(fixture: SelectionFixture, result: AptitudeResult) {
  const score = scoreAptitude(selectionScoringFixture(fixture), result)
  const gridInventoryCorrect = fixture.gridTruth
    ? selectionGridMatches(result.answer?.gridInventory, result.question?.options ?? [], fixture.gridTruth) : null
  return { ...score, gridInventoryCorrect, evidenceReviewRequired: score.evidenceReview?.reviewRequired === true || gridInventoryCorrect === false }
}
