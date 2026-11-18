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
