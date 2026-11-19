// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { AptitudeResult } from '@/lib/aptitude/schema'
import { APTITUDE_FIXTURES } from './fixtures'
import { scoreAptitude } from './score'

// Exact visible inventories from the owned fixture's live release run; no provider calls here.
const explicitInventory = [
  'Panel row 1: r1c1 filled cells r1c1, r2c1, r2c2; r1c2 filled cells r1c2, r1c3, r2c2; r1c3 filled cells r2c2, r2c3, r3c3.',
  'Panel row 2: r2c1 filled cells r1c2, r1c3, r2c2; r2c2 filled cells r2c2, r2c3, r3c3; r2c3 filled cells r2c2, r3c1, r3c2.',
  'Panel row 3: r3c1 filled cells r2c2, r2c3, r3c3; r3c2 filled cells r2c2, r3c1, r3c2; r3c3 shows a question mark.',
  'Choices: A filled cells r1c2, r1c3, r2c2; B filled cells r2c2, r2c3, r3c3; C filled cells r2c2, r3c1, r3c2; D filled cells r1c1, r2c1, r2c2.',
]
const scopedInventory = [
  'Row 1: panel c1 filled r1c1,r2c1,r2c2; panel c2 filled r1c2,r1c3,r2c2; panel c3 filled r2c2,r2c3,r3c3.',
  'Row 2: panel c1 filled r1c2,r1c3,r2c2; panel c2 filled r2c2,r2c3,r3c3; panel c3 filled r2c2,r3c1,r3c2.',
  "Row 3: panel c1 filled r2c2,r2c3,r3c3; panel c2 filled r2c2,r3c1,r3c2; panel c3 is '?'.",
  'Options: A filled r1c2,r1c3,r2c2; B filled r2c2,r2c3,r3c3; C filled r2c2,r3c1,r3c2; D filled r1c1,r2c1,r2c2.',
]
const fixture = APTITUDE_FIXTURES.find(item => item.id === 'visual-grid-quarter-turns')!
function result(evidence = explicitInventory): AptitudeResult {
  return {
    schemaVersion: 1, captureId: 'offline-grid-inventory', questionVersion: 1, questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
    model: 'offline-fixture-not-live', provider: 'openai', durationMs: 1, category: 'abstract', status: 'solved', message: null,
    question: { stem: 'Choose the panel that completes the bottom-right position.', instructions: [], passage: null,
      responseType: 'single_choice', missingEvidence: [], options: [...'ABCD'].map(label => ({ id: label, label, text: `Panel ${label}` })) },
    answer: { selectedOptionIds: ['D'], value: 'D', unit: null, summary: 'D', evidence: [...evidence],
      workedExplanation: ['Each panel rotates 90 degrees clockwise across its row.', 'The bottom-middle panel rotates to match option D.'], calculation: null },
    verification: { method: 'none', outcome: 'not_run', notes: ['Offline rubric regression only.'] },
  }
}
const review = (value: AptitudeResult) => scoreAptitude(fixture, value).evidenceReview

describe('quarter-turn grid literal inventory rubric', () => {
  it.each([
    { format: 'explicit panel coordinates', inventory: explicitInventory },
    { format: 'row-scoped panel labels', inventory: scopedInventory },
  ])('accepts the complete $format inventory without requiring the words “three squares”', ({ inventory }) => {
    expect(inventory.join(' ')).not.toMatch(/three squares|3 squares/iu)
    expect(scoreAptitude(fixture, result(inventory))).toMatchObject({ answerCorrect: true,
      evidenceReview: { reviewRequired: false, checks: [{ id: 'three-squares-rotate', passed: true }] } })
  })

  it('accepts the prompted “panel r1c2: filled cells …” label syntax without changing the expected cells', () => {
    const inventory = explicitInventory.map(item => item.replace(/\b(r\d+c\d+) filled cells/gu, 'panel $1: filled cells')
      .replace(/\b([A-D]) filled cells/gu, '$1: filled cells'))
    expect(inventory[0]).toContain('panel r1c2: filled cells r1c2, r1c3, r2c2')
    expect(review(result(inventory))?.reviewRequired).toBe(false)
    // The prompt's illustrative triplet is not the correct content for this fixture's r1c2 panel.
    inventory[0] = inventory[0].replace('panel r1c2: filled cells r1c2, r1c3, r2c2', 'panel r1c2: filled cells r1c1,r2c1,r2c2')
    expect(review(result(inventory))?.reviewRequired).toBe(true)
  })

  it('accepts colons after scoped/choice labels and whitespace within cell notation', () => {
    const inventory = scopedInventory.map(item => item.replace(/\b(panel c\d+|[A-D]) filled/gu, '$1: filled')
      .replace(/\br(\d+)c(\d+)\b/gu, 'r $1 c $2'))
    expect(review(result(inventory))?.reviewRequired).toBe(false)
    inventory[0] = inventory[0].replace('r 1 c 1,r 2 c 1,r 2 c 2', 'r 1 c 1,r 2 c 1,r 2 c 1')
    expect(review(result(inventory))?.reviewRequired).toBe(true)
  })

  it('accepts the latest complete inventory with missing-panel wording, inherited choice qualifiers and sequence explanation', () => {
    const inventory = [...explicitInventory]
    inventory[2] = inventory[2].replace('shows a question mark', 'is the missing panel')
    inventory[3] = 'Choices: A filled cells r1c2,r1c3,r2c2; B r2c2,r2c3,r3c3; C r2c2,r3c1,r3c2; D r1c1,r2c1,r2c2.'
    const value = result(inventory)
    value.answer!.workedExplanation = [
      'Each row advances through the same sequence of filled-cell arrangements; the next row begins one arrangement later.',
      'After r3c2, the sequence returns to filled cells r1c1, r2c1 and r2c2, matching D.',
    ]
    expect(review(value)?.reviewRequired).toBe(false)
    value.answer!.evidence[3] = value.answer!.evidence[3].replace('D r1c1,r2c1,r2c2', 'D r1c1,r2c1,r2c1')
    expect(review(value)?.reviewRequired).toBe(true)
  })

  it('accepts numbered panels under a row scope and the literal question-mark marker', () => {
    const inventory = scopedInventory.map(item => item.replace(/\bpanel c(\d+)/gu, 'panel $1')
      .replace("panel 3 is '?'", 'panel 3 is the ? at the bottom-right'))
    expect(review(result(inventory))?.reviewRequired).toBe(false)
    inventory[0] = inventory[0].replace('Row 1: ', '')
    expect(review(result(inventory))?.reviewRequired).toBe(true)
  })

  it.each([
    ['missing cell', 'r1c1, r2c1'],
    ['duplicate cell', 'r1c1, r2c1, r2c1'],
    ['extra cell', 'r1c1, r2c1, r2c2, r3c3'],
    ['misread cell', 'r1c1, r2c1, r3c2'],
    ['out-of-grid cell', 'r1c1, r2c1, r4c2'],
    ['another known configuration in the wrong panel', 'r1c2, r1c3, r2c2'],
  ])('rejects a %s even when the selected answer and a verbal count are correct', (_description, cells) => {
    const value = result()
    value.answer!.evidence[0] = value.answer!.evidence[0].replace('r1c1 filled cells r1c1, r2c1, r2c2', `r1c1 filled cells ${cells}`)
    value.answer!.workedExplanation.push('There are three filled squares in every panel.')
    expect(scoreAptitude(fixture, value)).toMatchObject({ answerCorrect: true,
      evidenceReview: { reviewRequired: true, checks: [{ id: 'three-squares-rotate', passed: false }] } })
  })

  it('requires each source panel and choice, not merely the four known configurations somewhere', () => {
    const missing = result()
    missing.answer!.evidence[1] = missing.answer!.evidence[1].replace('r2c2 filled cells r2c2, r2c3, r3c3; ', '')
    expect(review(missing)?.reviewRequired).toBe(true)
    const duplicate = result()
    duplicate.answer!.evidence[1] += ' r2c2 filled cells r2c2, r2c3, r3c3.'
    expect(review(duplicate)?.reviewRequired).toBe(true)
    const wrongChoice = result()
    wrongChoice.answer!.evidence[3] = wrongChoice.answer!.evidence[3].replace('D filled cells r1c1, r2c1, r2c2', 'D filled cells r1c2, r1c3, r2c2')
    expect(review(wrongChoice)?.reviewRequired).toBe(true)
  })

  it('derives the rotation from a complete correct inventory and still rejects the conflicting growth rule', () => {
    const missingRule = result()
    missingRule.answer!.workedExplanation = ['The missing panel matches option D.']
    expect(review(missingRule)?.reviewRequired).toBe(false)
    const conflictingRule = result()
    conflictingRule.answer!.workedExplanation.push('Each panel adds one square.')
    expect(review(conflictingRule)?.reviewRequired).toBe(true)
  })

  it('preserves the existing verbal count check when no cell inventory is provided', () => {
    expect(review(result(['Every panel contains three filled squares.']))?.reviewRequired).toBe(false)
    expect(review(result(['Every panel contains four filled squares.']))?.reviewRequired).toBe(true)
    const missingRule = result(['Every panel contains three filled squares.'])
    missingRule.answer!.workedExplanation = ['The missing panel matches option D.']
    expect(review(missingRule)?.reviewRequired).toBe(true)
  })
})
