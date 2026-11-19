// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { APTITUDE_FIXTURES } from './fixtures'
import { renderAptitudeFixture, aptitudeFixtureSvg } from './render'
import { ROTATION_PANELS, XOR_PANELS } from './visualRender'
import { selectAptitudeFixtures } from './selectFixtures'
import { planAptitudeEvaluation } from './evaluationPlan'
import { scoreAptitude } from './score'
import { aggregateAptitudeAttempts } from './evaluationReport'
import type { AptitudeResult } from '@/lib/aptitude/schema'

const fixture = (id: string) => APTITUDE_FIXTURES.find(item => item.id === id)!
function starResult(): AptitudeResult {
  return {
    schemaVersion: 1, captureId: 'offline-visual-case', questionVersion: 1, questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
    model: 'offline-fixture-not-live', provider: 'openai', durationMs: 1,
    category: 'abstract', status: 'solved', message: null,
    question: { stem: 'Each star follows the same number rule. What number belongs below the last star?',
      instructions: ['Choose one.'], passage: null, responseType: 'single_choice', missingEvidence: [],
      options: ['42', '45', '49', '56'].map((text, index) => ({ id: 'ABCD'[index], label: 'ABCD'[index], text })),
    },
    answer: { selectedOptionIds: ['C'], value: '49', unit: null, summary: 'C — 49',
      evidence: ['There are three separate stars: a 4-point star labeled 28, a 5-point star labeled 35, and a 7-point star labeled ?.'],
      workedExplanation: ['Each point corresponds to 7: 4 × 7 = 28 and 5 × 7 = 35.', 'For seven points, 7 × 7 = 49.'],
      calculation: { expression: '7*7', claimedValue: 49, decimalPlaces: null },
    },
    verification: { method: 'arithmetic', outcome: 'passed', notes: ['Offline fixture only.'] },
  }
}
function incrementResult(): AptitudeResult {
  const result = starResult()
  result.question!.stem = 'The numbers follow a pattern clockwise around the star. Which value replaces the question mark?'
  result.question!.options = ['34', '36', '38', '32'].map((text, index) => ({ id: 'ABCD'[index], label: 'ABCD'[index], text }))
  result.answer = { selectedOptionIds: ['B'], value: '36', unit: null, summary: 'B — 36',
    evidence: ['Clockwise numbers: 8, 12, 18, 26, ?.'], workedExplanation: ['The increments are +4, +6, +8, so the next increment is +10.', '26 + 10 = 36.'],
    calculation: { expression: '26+10', claimedValue: 36, decimalPlaces: null } }
  return result
}

describe('original visual fixture truth and rendering (no model calls)', () => {
  it('keeps the full desktop frame at native dimensions, with a separate clear question variant', async () => {
    const clear = await renderAptitudeFixture(fixture('visual-star-points'))
    const page = await renderAptitudeFixture(fixture('visual-star-points-large-page'))
    expect([clear.png.readUInt32BE(16), clear.png.readUInt32BE(20)]).toEqual([1080, 640])
    expect([page.png.readUInt32BE(16), page.png.readUInt32BE(20)]).toEqual([2560, 1600])
    expect(page.sha256).not.toBe(clear.sha256)
    expect(fixture('visual-star-points-large-page').split).toBe('development')
  })

  it('defines a rotation matrix with three squares in every panel and a distinct correct option', () => {
    expect(ROTATION_PANELS).toEqual([[0, 3, 4], [1, 2, 4], [4, 5, 8], [4, 6, 7]])
    expect(new Set(ROTATION_PANELS.map(cells => cells.join(','))).size).toBe(4)
    expect(fixture('visual-grid-quarter-turns').expected.selectedLabels).toEqual(['D'])
    expect(ROTATION_PANELS.every(cells => cells.length === 3)).toBe(true)
  })

  it('defines XOR rows where the center is removed in the missing panel', () => {
    for (let row = 0; row < 3; row++) {
      const first = new Set(XOR_PANELS[row * 3])
      const second = new Set(XOR_PANELS[row * 3 + 1])
      const exclusive = Array.from({ length: 9 }, (_, cell) => cell).filter(cell => first.has(cell) !== second.has(cell))
      expect(XOR_PANELS[row * 3 + 2]).toEqual(exclusive)
    }
    expect(XOR_PANELS[8]).toEqual([0, 1, 7, 8])
    expect(fixture('visual-grid-exclusive-or').expected.selectedLabels).toEqual(['A'])
  })

  it('physically clips choices and removes critical source numbers in capture-boundary cases', async () => {
    const clipped = await renderAptitudeFixture(fixture('visual-grid-cropped-choices'))
    expect(clipped.png.readUInt32BE(20)).toBe(528)
    const obscured = aptitudeFixtureSvg(fixture('visual-obscured-star-values'))
    expect(obscured.match(/fill="#b8bdc5"/g)).toHaveLength(4)
    expect(obscured).not.toMatch(/>26<|>18<|>12</)
    for (const id of ['visual-grid-cropped-choices', 'visual-obscured-star-values']) {
      expect(fixture(id).expected.status).toBe('needs_capture')
      expect(scoreAptitude(fixture(id), starResult())).toMatchObject({ answerCorrect: false, shouldAbstain: true, abstained: false })
    }
  })
})

describe('visual evidence review and answer scoring', () => {
  it('does not credit a correct option label when its visible number was transcribed incorrectly', () => {
    const value = starResult()
    expect(scoreAptitude(fixture('visual-star-points'), value)).toMatchObject({ answerCorrect: true, optionMappingCorrect: true })
    value.question!.options[2].text = '48'
    expect(scoreAptitude(fixture('visual-star-points'), value)).toMatchObject({ answerCorrect: false, optionMappingCorrect: false })
    value.question!.options[2].text = '49'
    value.question!.options[3].label = 'A'
    value.question!.options[3].text = '42'
    expect(scoreAptitude(fixture('visual-star-points'), value).optionMappingCorrect).toBe(false)
  })

  it('flags counting stars instead of star points even when the selected answer coincides with the key', () => {
    const value = starResult()
    const truth = fixture('visual-star-points')
    expect(scoreAptitude(truth, value).evidenceReview).toMatchObject({ reviewRequired: false, calculationMatchesExpected: true })
    value.answer!.evidence = ['There are four stars, then five stars, then seven stars.']
    value.answer!.workedExplanation = ['Seven stars correspond to 49.']
    const score = scoreAptitude(truth, value)
    expect(score.answerCorrect).toBe(true)
    expect(score.evidenceReview).toMatchObject({ reviewRequired: true, checks: [{ id: 'counts-points-not-stars', passed: false }] })
    expect(aggregateAptitudeAttempts([{ expectedStatus: 'solved', outcome: 'complete', score, comparisonScore: null, durationMs: 1 }])).toMatchObject({ endToEndCorrect: 1, evidenceReviewed: 1, evidenceReviewFlagged: 1 })
  })

  it('separates a correct selected answer from a contradictory worked explanation', () => {
    const value = incrementResult()
    const truth = fixture('visual-star-increasing-differences')
    expect(scoreAptitude(truth, value).evidenceReview).toMatchObject({ reviewRequired: false, calculationMatchesExpected: true })
    value.answer!.workedExplanation[1] = 'The next value is 26 + 8 = 34.'
    expect(scoreAptitude(truth, value)).toMatchObject({ answerCorrect: true, evidenceReview: { reviewRequired: true } })
    value.answer!.calculation = { expression: '26+8', claimedValue: 34, decimalPlaces: null }
    expect(scoreAptitude(truth, value).evidenceReview?.calculationMatchesExpected).toBe(false)
  })

  it('scores recapture and genuine transformation ambiguity against distinct boundaries', () => {
    const value = starResult()
    value.answer = null; value.status = 'needs_capture'; value.message = 'The numerical labels are obscured.'
    value.question!.missingEvidence = ['Numbers around the diagram.']
    expect(scoreAptitude(fixture('visual-obscured-star-values'), value).answerCorrect).toBe(true)
    value.category = 'spatial'; value.status = 'ambiguous'; value.message = 'Reflection and rotation give different permitted panels.'
    value.question!.missingEvidence = []
    expect(scoreAptitude(fixture('visual-two-permitted-transformations'), value).answerCorrect).toBe(true)
    value.status = 'needs_capture'
    expect(scoreAptitude(fixture('visual-two-permitted-transformations'), value).answerCorrect).toBe(false)
  })
})

describe('explicit paid visual regression subset', () => {
  it('budgets only selected fixtures and preserves suite order', () => {
    const ids = 'visual-grid-quarter-turns,visual-star-points,visual-star-increasing-differences'
    const selected = selectAptitudeFixtures(APTITUDE_FIXTURES, ids)
    expect(selected.map(item => item.id)).toEqual(['visual-star-points', 'visual-star-increasing-differences', 'visual-grid-quarter-turns'])
    const plan = planAptitudeEvaluation({ APTITUDE_EVAL_MODELS: 'openai:gpt-4.1,anthropic:claude-sonnet-4-5', APTITUDE_EVAL_STRATEGY: 'compare', APTITUDE_EVAL_MAX_CALLS: '6' }, selected.length)
    expect(plan).toMatchObject({ fixtureCount: 3, plannedAttempts: 3, plannedCalls: 6 })
  })
  it('rejects empty, duplicate and unknown fixture selections before provider work', () => {
    expect(selectAptitudeFixtures(APTITUDE_FIXTURES, undefined)).toBe(APTITUDE_FIXTURES)
    for (const selection of ['', ',', 'visual-star-points,', 'visual-star-points,visual-star-points', 'not-a-fixture']) {
      expect(() => selectAptitudeFixtures(APTITUDE_FIXTURES, selection)).toThrow()
    }
  })
})
