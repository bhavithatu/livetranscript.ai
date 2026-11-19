import type { AptitudeObservation } from '@/lib/aptitude/schema'

/** Authored offline response. Never sent as provider input or used as an answer hint. */
export function structuredRotationObservation(): AptitudeObservation {
  return {
    category: 'abstract', status: 'solved', message: null,
    question: { stem: 'Choose the panel that completes the bottom-right position.', instructions: [], passage: null,
      responseType: 'single_choice', missingEvidence: [],
      options: [...'ABCD'].map(label => ({ id: `choice-${label.toLowerCase()}`, label, text: `Diagram ${label}` })) },
    answer: { selectedOptionIds: ['choice-d'], value: 'D', unit: null, summary: 'Option D',
      evidence: ['Eight source panels are visible and the bottom-right panel is missing.'],
      workedExplanation: ['Each row rotates the filled pattern 90 degrees clockwise. Option D continues it.'], calculation: null,
      gridInventory: {
        rows: 3, columns: 3, cellRows: 3, cellColumns: 3,
        panels: [
          { row: 1, column: 1, filledCells: ['r1c1', 'r2c1', 'r2c2'] },
          { row: 1, column: 2, filledCells: ['r1c2', 'r1c3', 'r2c2'] },
          { row: 1, column: 3, filledCells: ['r2c2', 'r2c3', 'r3c3'] },
          { row: 2, column: 1, filledCells: ['r1c2', 'r1c3', 'r2c2'] },
          { row: 2, column: 2, filledCells: ['r2c2', 'r2c3', 'r3c3'] },
          { row: 2, column: 3, filledCells: ['r2c2', 'r3c1', 'r3c2'] },
          { row: 3, column: 1, filledCells: ['r2c2', 'r2c3', 'r3c3'] },
          { row: 3, column: 2, filledCells: ['r2c2', 'r3c1', 'r3c2'] },
          { row: 3, column: 3, filledCells: null },
        ],
        options: [
          { optionId: 'choice-a', filledCells: ['r1c2', 'r1c3', 'r2c2'] },
          { optionId: 'choice-b', filledCells: ['r2c2', 'r2c3', 'r3c3'] },
          { optionId: 'choice-c', filledCells: ['r2c2', 'r3c1', 'r3c2'] },
          { optionId: 'choice-d', filledCells: ['r1c1', 'r2c1', 'r2c2'] },
        ],
      },
    },
  }
}
