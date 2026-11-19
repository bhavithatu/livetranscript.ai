import { describe, expect, it } from 'vitest'
import { MAX_APTITUDE_IMAGE_CHARS, parseAptitudeObservation, parseAptitudeRequest, parseAptitudeResult } from './schema'
import { solvedObservation, TEST_REQUEST } from './testFixtures'

describe('aptitude wire contract', () => {
  it('accepts a complete objective answer and a genuine Cannot say option', () => {
    expect(parseAptitudeObservation(solvedObservation()).status).toBe('solved')
    const item = solvedObservation()
    item.category = 'verbal'
    item.question!.options[1].text = 'Cannot say'
    item.answer!.calculation = null
    item.answer!.value = null
    expect(parseAptitudeObservation(item).answer?.selectedOptionIds).toEqual(['B'])
  })
  it('rejects absent evidence, invented option IDs, duplicate options and hidden fields', () => {
    const missing = solvedObservation(); missing.question!.missingEvidence = ['The passage is cropped.']
    const invented = solvedObservation(); invented.answer!.selectedOptionIds = ['C']
    const duplicate = solvedObservation(); duplicate.question!.options[1].id = 'A'
    const noEvidence = solvedObservation(); noEvidence.answer!.evidence = []
    const noOptions = solvedObservation(); noOptions.question!.options = []
    for (const item of [missing, invented, duplicate, noEvidence, noOptions, { ...solvedObservation(), confidence: 0.99 }]) expect(() => parseAptitudeObservation(item)).toThrow()
  })
  it('requires abstention to withhold the answer and explain the missing information', () => {
    expect(() => parseAptitudeObservation({ ...solvedObservation(), status: 'needs_capture', message: 'Passage missing.' })).toThrow()
    expect(parseAptitudeObservation({ ...solvedObservation(), status: 'needs_capture', answer: null, message: 'Passage missing.' }).answer).toBeNull()
    expect(() => parseAptitudeObservation({ ...solvedObservation(), status: 'ambiguous', answer: null })).toThrow()
  })
  it('retains readable choices and missing choice locations without blank option placeholders', () => {
    const item = solvedObservation()
    item.status = 'needs_capture'
    item.answer = null
    item.message = 'Capture the complete question and choices.'
    item.question!.options = [item.question!.options[0]]
    item.question!.missingEvidence = ['Choice B at the lower right is cut off; only its label is readable.']
    const parsed = parseAptitudeObservation(item)
    expect(parsed.question?.options).toEqual([{ id: 'A', label: 'A', text: '20%' }])
    expect(parsed.question?.missingEvidence).toEqual(item.question!.missingEvidence)
    expect(parsed.answer).toBeNull()
    item.question!.options.push({ id: 'B', label: 'B', text: '' })
    expect(() => parseAptitudeObservation(item)).toThrow('Invalid option text')
  })
  it('preserves a complete panel and choice inventory by grouping within the evidence limit', () => {
    const item = solvedObservation()
    item.category = 'abstract'
    item.question!.stem = 'Which panel completes the pattern?'
    item.question!.options = ['r1c1', 'r1c2', 'r1c3', 'r2c1'].map((cell, index) => ({
      id: String.fromCharCode(65 + index), label: String.fromCharCode(65 + index), text: `One filled cell at ${cell}.`,
    }))
    item.answer!.selectedOptionIds = ['C']
    item.answer!.value = null
    item.answer!.unit = null
    item.answer!.summary = 'C: the filled cell is at r1c3.'
    item.answer!.calculation = null
    item.answer!.workedExplanation = ['In each complete row, the filled cell advances from r1c1 to r1c2 to r1c3.', 'The last panel completes the same progression, matching choice C.']
    const panels = Array.from({ length: 8 }, (_, index) => `panel r${Math.floor(index / 3) + 1}c${index % 3 + 1}: filled cell r1c${index % 3 + 1}`)
    const inventory = [...panels, 'panel r3c3: question mark', ...item.question!.options.map(option => `choice ${option.label}: ${option.text}`)]
    item.answer!.evidence = inventory
    expect(() => parseAptitudeObservation(item)).toThrow('Invalid answer evidence')
    item.answer!.evidence = [inventory.slice(0, 3).join('; '), inventory.slice(3, 6).join('; '), inventory.slice(6, 9).join('; '), inventory.slice(9).join('; ')]
    const parsed = parseAptitudeObservation(item)
    expect(parsed.answer!.evidence.join('; ')).toBe(inventory.join('; '))
    expect(parsed.answer!.selectedOptionIds).toEqual(['C'])
    item.answer!.workedExplanation = Array.from({ length: 7 }, (_, index) => `Step ${index + 1}`)
    expect(() => parseAptitudeObservation(item)).toThrow('Invalid worked explanation')
  })
  it('does not manufacture objective personality or situational-judgment answers', () => {
    for (const category of ['personality', 'situational_judgment', 'unknown']) expect(() => parseAptitudeObservation({ ...solvedObservation(), category })).toThrow()
  })
  it('bounds request size and fences response identity/version metadata', () => {
    expect(parseAptitudeRequest(TEST_REQUEST)).toEqual(TEST_REQUEST)
    for (const input of [{ ...TEST_REQUEST, image: 'https://example.test/image.png' }, { ...TEST_REQUEST, questionVersion: -1 }, { ...TEST_REQUEST, captureId: '../x' }, { ...TEST_REQUEST, image: 'x'.repeat(MAX_APTITUDE_IMAGE_CHARS + 1) }]) expect(() => parseAptitudeRequest(input)).toThrow()
    expect(() => parseAptitudeResult({ ...solvedObservation(), captureId: 'a' })).toThrow()
  })
  it('requires explicit comparison and preserves the request shape for old single clients', () => {
    expect(parseAptitudeRequest(TEST_REQUEST)).not.toHaveProperty('strategy')
    expect(parseAptitudeRequest({ ...TEST_REQUEST, strategy: 'single' }).strategy).toBe('single')
    expect(parseAptitudeRequest({ ...TEST_REQUEST, strategy: 'compare' }).strategy).toBe('compare')
    expect(() => parseAptitudeRequest({ ...TEST_REQUEST, strategy: 'automatic-race' })).toThrow()
    expect(() => parseAptitudeRequest({ ...TEST_REQUEST, strategy: null })).toThrow()
  })
  it('preserves old answers while validating optional numeric pattern evidence', () => {
    expect(parseAptitudeObservation(solvedObservation()).answer).not.toHaveProperty('numericPattern')
    const item = solvedObservation()
    item.answer!.numericPattern = null
    expect(parseAptitudeObservation(item).answer!.numericPattern).toBeNull()
    item.answer!.numericPattern = { observedValues: [3, 7, 13, 21], rule: 'constant_second_difference' }
    expect(parseAptitudeObservation(item).answer!.numericPattern).toEqual(item.answer!.numericPattern)
    item.answer!.numericPattern.observedValues = [3, 7, 13]
    expect(() => parseAptitudeObservation(item)).toThrow(/enough observed values/)
    item.answer!.numericPattern.observedValues = [1, 2, 3, 1e13]
    expect(() => parseAptitudeObservation(item)).toThrow(/precision or size/)
    item.answer!.numericPattern.observedValues = [1, 2, 3, Infinity]
    expect(() => parseAptitudeObservation(item)).toThrow(/numeric pattern value/)
  })
})
