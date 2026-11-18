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
  it('does not manufacture objective personality or situational-judgment answers', () => {
    for (const category of ['personality', 'situational_judgment', 'unknown']) expect(() => parseAptitudeObservation({ ...solvedObservation(), category })).toThrow()
  })
  it('bounds request size and fences response identity/version metadata', () => {
    expect(parseAptitudeRequest(TEST_REQUEST)).toEqual(TEST_REQUEST)
    for (const input of [{ ...TEST_REQUEST, image: 'https://example.test/image.png' }, { ...TEST_REQUEST, questionVersion: -1 }, { ...TEST_REQUEST, captureId: '../x' }, { ...TEST_REQUEST, image: 'x'.repeat(MAX_APTITUDE_IMAGE_CHARS + 1) }]) expect(() => parseAptitudeRequest(input)).toThrow()
    expect(() => parseAptitudeResult({ ...solvedObservation(), captureId: 'a' })).toThrow()
  })
})
