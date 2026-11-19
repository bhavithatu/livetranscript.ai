// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AptitudeGridInventory, AptitudeResult } from '@/lib/aptitude/schema'
import { APTITUDE_FIXTURES } from './fixtures'
import { scoreAptitude } from './score'
import { structuredRotationObservation } from './structuredGridFixture'
import { hasCorrectStructuredRotationGridInventory } from './structuredGridEvidence'

const fixture = APTITUDE_FIXTURES.find(item => item.id === 'visual-grid-quarter-turns')!
function result(): AptitudeResult {
  return { ...structuredRotationObservation(), schemaVersion: 1, captureId: 'offline-typed-grid', questionVersion: 1,
    questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), model: 'offline-fixture-not-live', provider: 'openai', durationMs: 1,
    verification: { method: 'none', outcome: 'not_run', notes: ['Offline typed-grid fixture.'] } }
}
const review = (value: AptitudeResult) => scoreAptitude(fixture, value).evidenceReview

describe('typed rotation-grid evidence', () => {
  it('checks all literal facts without depending on English evidence formatting', () => {
    for (const prose of [
      'Choices A–D have filled cells, respectively: see the structured grid inventory.',
      'Row 1: c1 filled; the typed inventory contains the coordinates.',
      'The next rotation matches option D.',
    ]) {
      const value = result()
      value.answer!.evidence = [prose]
      expect(scoreAptitude(fixture, value)).toMatchObject({ schemaValid: true, answerCorrect: true,
        evidenceReview: { reviewRequired: false, checks: [{ id: 'three-squares-rotate', passed: true }] } })
    }
  })

  it('accepts independent record/cell ordering and decorative visible option labels', () => {
    const value = result()
    const inventory = value.answer!.gridInventory!
    inventory.panels.reverse()
    inventory.options.reverse()
    inventory.panels.forEach(panel => panel.filledCells?.reverse())
    inventory.options.forEach(option => option.filledCells.reverse())
    value.question!.options.reverse()
    value.question!.options.forEach(option => { option.label = `(${option.label})` })
    expect(review(value)?.reviewRequired).toBe(false)
  })

  it.each<[string, (inventory: AptitudeGridInventory) => void]>([
    ['wrong source cell', inventory => { inventory.panels[0].filledCells = ['r1c1', 'r2c1', 'r3c2'] }],
    ['missing source cell', inventory => { inventory.panels[0].filledCells = ['r1c1', 'r2c1'] }],
    ['extra source cell', inventory => { inventory.panels[0].filledCells = ['r1c1', 'r2c1', 'r2c2', 'r3c3'] }],
    ['duplicate source cell', inventory => { inventory.panels[0].filledCells = ['r1c1', 'r2c1', 'r2c1'] }],
    ['missing source panel', inventory => { inventory.panels.pop() }],
    ['duplicate source address', inventory => { inventory.panels[1].column = 1 }],
    ['wrong missing position', inventory => { inventory.panels[7].filledCells = null; inventory.panels[8].filledCells = ['r1c1', 'r2c1', 'r2c2'] }],
    ['invented cells in the missing panel', inventory => { inventory.panels[8].filledCells = ['r1c1', 'r2c1', 'r2c2'] }],
    ['wrong matrix dimensions', inventory => { inventory.columns = 2 }],
    ['wrong cell-grid dimensions', inventory => { inventory.cellRows = 4 }],
    ['wrong option cells', inventory => { inventory.options[0].filledCells = ['r1c1', 'r2c1', 'r2c2'] }],
    ['missing option inventory', inventory => { inventory.options.pop() }],
    ['duplicate option ID', inventory => { inventory.options[1].optionId = inventory.options[0].optionId }],
    ['unknown option ID', inventory => { inventory.options[0].optionId = 'nonexistent-option' }],
  ])('rejects %s even though the selected answer is D', (_name, mutate) => {
    const value = result()
    mutate(value.answer!.gridInventory!)
    expect(hasCorrectStructuredRotationGridInventory(value.answer!.gridInventory!, value.question!.options)).toBe(false)
    const scored = scoreAptitude(fixture, value)
    expect(scored.schemaValid === false || scored.evidenceReview?.reviewRequired === true).toBe(true)
  })

  it('binds every option inventory to its visible label through the actual option ID', () => {
    const value = result()
    const [a, b] = value.question!.options
    ;[a.id, b.id] = [b.id, a.id]
    expect(scoreAptitude(fixture, value)).toMatchObject({ schemaValid: true, answerCorrect: true,
      evidenceReview: { reviewRequired: true } })
  })

  it('does not fall back to correct prose when the typed inventory is wrong', () => {
    const value = result()
    value.answer!.evidence = ['Every panel contains three filled squares.']
    value.answer!.gridInventory!.panels[0].filledCells = ['r1c1', 'r2c1', 'r3c2']
    expect(review(value)?.reviewRequired).toBe(true)
  })

  it('retains a bounded check for a contradictory growth rule', () => {
    const value = result()
    value.answer!.workedExplanation.push('Each panel adds one square.')
    expect(review(value)?.reviewRequired).toBe(true)
  })

  it.each([undefined, null])('keeps legacy offline scoring when grid inventory is %s', inventory => {
    const value = result()
    if (inventory === undefined) delete value.answer!.gridInventory
    else value.answer!.gridInventory = inventory
    value.answer!.evidence = ['Every panel contains three filled squares.']
    expect(review(value)?.reviewRequired).toBe(false)
  })
})
