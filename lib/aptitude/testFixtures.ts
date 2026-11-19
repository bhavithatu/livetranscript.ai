import type { AptitudeObservation, AptitudeRequest } from './schema'

// An owned one-pixel PNG for transport/header tests. Benchmark screenshots are rendered separately.
export const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2cAAAAASUVORK5CYII='
export const TEST_REQUEST: AptitudeRequest = { captureId: 'capture-1', questionVersion: 1, category: 'auto', image: TEST_IMAGE }
export function solvedObservation(): AptitudeObservation {
  return { category: 'numerical', status: 'solved', question: {
    stem: 'A value rises from 80 to 100. What is the percentage increase?', instructions: ['Choose one answer.'], passage: null,
    options: [{ id: 'A', label: 'A', text: '20%' }, { id: 'B', label: 'B', text: '25%' }], responseType: 'single_choice', missingEvidence: [],
  }, answer: { selectedOptionIds: ['B'], value: '25', unit: '%', summary: 'B — 25%',
    workedExplanation: ['The increase is 100 − 80 = 20.', '20 / 80 × 100 = 25%.'], evidence: ['Original value 80; new value 100.'],
    calculation: { expression: '(100-80)/80*100', claimedValue: 25, decimalPlaces: null } }, message: null }
}

/** Small owned grid for contract tests; its cells are unrelated to release fixtures. */
export function solvedGridObservation(): AptitudeObservation {
  return { category: 'abstract', status: 'solved', question: {
    stem: 'Which grid completes the pattern?', instructions: ['Choose one answer.'], passage: null,
    options: [{ id: 'A', label: 'A', text: 'Two filled cells in the left column' }, { id: 'B', label: 'B', text: 'One filled cell at bottom right' }],
    responseType: 'single_choice', missingEvidence: [],
  }, answer: {
    selectedOptionIds: ['B'], value: null, unit: null, summary: 'B',
    workedExplanation: ['The occupied corner follows the panel position.'],
    evidence: ['Three occupied source cells and a question-mark panel are visible.'], calculation: null,
    gridInventory: {
      rows: 2, columns: 2, cellRows: 2, cellColumns: 2,
      panels: [
        { row: 1, column: 1, filledCells: ['r1c1'] }, { row: 1, column: 2, filledCells: ['r1c2'] },
        { row: 2, column: 1, filledCells: ['r2c1'] }, { row: 2, column: 2, filledCells: null },
      ],
      options: [{ optionId: 'A', filledCells: ['r1c1', 'r2c1'] }, { optionId: 'B', filledCells: ['r2c2'] }],
    },
  }, message: null }
}
