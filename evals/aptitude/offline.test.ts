// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { APTITUDE_FIXTURES } from './fixtures'
import { aptitudeFixtureSvg, renderAptitudeFixture } from './render'
import { scoreAptitude, percentile } from './score'
import { solvedObservation } from '@/lib/aptitude/testFixtures'
import { validateAptitudeImage } from '@/lib/aptitude/image'

const result = () => ({ ...solvedObservation(), schemaVersion: 1, captureId: 'eval-1', questionVersion: 1, questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
  model: 'mock-not-live', provider: 'openai', durationMs: 3, verification: { method: 'arithmetic', outcome: 'passed', notes: ['Fixture test, not a model result.'] } })
describe('aptitude offline benchmark mechanics (no model calls)', () => {
  it('renders each owned screenshot with a verified hash and without expected-answer metadata', async () => {
    for (const fixture of APTITUDE_FIXTURES) {
      const { png, sha256 } = await renderAptitudeFixture(fixture)
      expect(sha256).toBe(createHash('sha256').update(png).digest('hex'))
      expect(validateAptitudeImage(`data:image/png;base64,${png.toString('base64')}`).mediaType).toBe('image/png')
      const svg = aptitudeFixtureSvg(fixture)
      expect(svg).not.toContain('selectedLabels')
      expect(svg).not.toContain('expected')
      expect(svg).not.toContain(fixture.id)
    }
  })
  it('rejects a wrong choice, malformed output and false certainty on an incomplete image', () => {
    const fixture = APTITUDE_FIXTURES[0]
    expect(scoreAptitude(fixture, result()).answerCorrect).toBe(true)
    const wrong = result(); wrong.answer!.selectedOptionIds = ['A']
    expect(scoreAptitude(fixture, wrong).answerCorrect).toBe(false)
    expect(scoreAptitude(fixture, {}).schemaValid).toBe(false)
    expect(scoreAptitude(APTITUDE_FIXTURES.find(item => item.id === 'missing-passage')!, result())).toMatchObject({ shouldAbstain: true, abstained: false, answerCorrect: false })
  })
  it.each(['B', 'B.', '(B)', ' [B] ', ' ( B ). '])('matches the correct option with label presentation %j', label => {
    const value = result(); value.question!.options[1].label = label
    expect(scoreAptitude(APTITUDE_FIXTURES[0], value).answerCorrect).toBe(true)
    value.answer!.selectedOptionIds = ['A']
    expect(scoreAptitude(APTITUDE_FIXTURES[0], value).answerCorrect).toBe(false)
  })
  it('preserves exact checking option text, character case and punctuation when comparing labels', () => {
    const fixture = APTITUDE_FIXTURES.find(item => item.id === 'checking-zero')!
    const value = result()
    value.category = 'checking'
    value.question!.stem = 'Choose the matching code.'
    value.question!.options = [
      { id: 'A', label: 'A.', text: 'AOl-7B2' },
      { id: 'B', label: '(B)', text: 'A0l-7B2' },
      { id: 'C', label: 'C.', text: 'A01-7B2' },
      { id: 'D', label: 'D.', text: 'A0l-7BZ' },
    ]
    value.answer!.calculation = null
    const before = JSON.stringify(value.question!.options)
    expect(scoreAptitude(fixture, value)).toMatchObject({ answerCorrect: true, criticalTextCoverage: 1 })
    expect(JSON.stringify(value.question!.options)).toBe(before)
    value.question!.options[0].text = 'aOl-7B2'
    expect(scoreAptitude(fixture, value).criticalTextCoverage).toBe(0.75)
    const decorated = { ...fixture, expected: { ...fixture.expected, criticalText: [' (A0l-7B2). '] } }
    value.question!.options[1].text = ' (A0l-7B2). '
    expect(scoreAptitude(decorated, value).criticalTextCoverage).toBe(1)
    value.question!.options[1].text = 'A0l-7B2'
    expect(scoreAptitude(decorated, value).criticalTextCoverage).toBe(0)
  })
  it('scores a complete underdetermined problem as ambiguous rather than a missing capture', () => {
    const fixture = APTITUDE_FIXTURES.find(item => item.id === 'ambiguous-instruction')!
    const value = { ...result(), category: 'logical', status: 'ambiguous', answer: null, message: 'Both 5 and 6 satisfy the permitted operations; no unique choice follows.' }
    value.question!.stem = fixture.view.lines.join(' ')
    value.question!.options = [{ id: 'A', label: 'A.', text: '5' }, { id: 'B', label: 'B.', text: '6' }]
    expect(scoreAptitude(fixture, value)).toMatchObject({ statusCorrect: true, answerCorrect: true, shouldAbstain: true, abstained: true })
    expect(scoreAptitude(fixture, { ...value, status: 'needs_capture' }).answerCorrect).toBe(false)
    expect(fixture.view.lines.join(' ')).toContain('Both operations are permitted. No other rules apply.')
  })
  it('distinguishes a correct boundary abstention from answer accuracy and keeps empty latency unknown', () => {
    const fixture = APTITUDE_FIXTURES.find(item => item.id === 'personality-boundary')!
    expect(scoreAptitude(fixture, { ...result(), category: 'personality', status: 'unsupported', answer: null, message: 'Answer according to your own preferences.' })).toMatchObject({ answerCorrect: true, shouldAbstain: true, abstained: true })
    expect(percentile([],0.95)).toBeNull()
    expect(percentile([9,1,3,5],0.5)).toBe(3)
  })
})
