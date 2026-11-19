import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import type { AptitudeGridInventory, AptitudeResult } from '@/lib/aptitude/schema'
import { solvedObservation } from '@/lib/aptitude/testFixtures'
import { APTITUDE_SELECTION_FIXTURES, APTITUDE_SELECTION_FIXTURE_HASH, SELECTION_TRANSFORM_SOURCE, SELECTION_TRANSFORM_OPTIONS,
  SELECTION_XOR_PANELS, SELECTION_XOR_OPTIONS, renderSelectionFixture, selectionFixtureSvg } from './selectionFixtures'
import { planAptitudeSelection, selectionCollectionStatus } from './selectionPlan'
import { AptitudeEvaluationCallGuard } from './evaluationPlan'
import { aggregateAptitudeAttempts, type ScoredEvaluationAttempt } from './evaluationReport'
import { scoreSelectionFixture, selectionGridMatches } from './selectionScoring'
import { aptitudeSelectionEnvironment } from '../../scripts/aptitude-selection-environment.mjs'

const commit = 'a'.repeat(40)
const selectedModels = 'openai:gpt-6.2-astra,openai:gpt-6.2-sol,anthropic:claude-sonnet-5-5'
const enabled = { VERCEL_ENV: 'preview', LT_RUN_APTITUDE_SELECTION_CHECK: '1', LT_APTITUDE_SELECTION_COMMIT: commit, VERCEL_GIT_COMMIT_SHA: commit }

describe('commit-bound model selection guard', () => {
  it.each([{}, { LT_RUN_APTITUDE_SELECTION_CHECK: '1' }, { CI: 'true', LT_RUN_APTITUDE_SELECTION_CHECK: '1' },
    { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview', LT_RUN_APTITUDE_SELECTION_CHECK: 'true' },
    { ...enabled, VERCEL_ENV: 'development' }])('never opts in ordinary/local/CI builds: %j', env => {
    expect(aptitudeSelectionEnvironment(env)).toBeNull()
  })
  it.each(['preview', 'production'])('permits an exact commit-bound %s run', VERCEL_ENV => {
    expect(aptitudeSelectionEnvironment({ ...enabled, VERCEL_ENV })).toBe(VERCEL_ENV)
  })
  it.each([undefined, '', 'b'.repeat(40), 'not-a-sha'])('rejects an absent or mismatched expected commit: %s', expected => {
    expect(() => aptitudeSelectionEnvironment({ ...enabled, LT_APTITUDE_SELECTION_COMMIT: expected })).toThrow('match this deployment commit')
  })
  it('plans exactly three independent arms and thirty-six calls', () => {
    const plan = planAptitudeSelection({ APTITUDE_SELECTION_MODELS: selectedModels, APTITUDE_SELECTION_MAX_CALLS: '36' })
    expect(plan).toMatchObject({ strategy: 'single', fixtureCount: 12, repeats: 1, plannedAttempts: 36, plannedCalls: 36, maxCalls: 36 })
    expect(plan.arms.map(arm => arm.modelIds.length)).toEqual([1, 1, 1])
    const guard = new AptitudeEvaluationCallGuard(plan)
    for (let fixture = 0; fixture < 12; fixture++) for (const arm of plan.arms) {
      const reserve = guard.attempt(arm)
      reserve(arm.modelIds[0])
      expect(() => reserve(arm.modelIds[0])).toThrow()
    }
    expect(guard.callsStarted).toBe(36)
    expect(() => guard.attempt(plan.arms[0])(plan.modelIds[0])).toThrow('CALL_CAP_REACHED')
  })
  it.each([
    {}, { APTITUDE_SELECTION_MODELS: selectedModels },
    { APTITUDE_SELECTION_MODELS: selectedModels, APTITUDE_SELECTION_MAX_CALLS: '100' },
    { APTITUDE_SELECTION_MODELS: 'a,b', APTITUDE_SELECTION_MAX_CALLS: '36' },
    { APTITUDE_SELECTION_MODELS: 'a,b,a', APTITUDE_SELECTION_MAX_CALLS: '36' },
    { APTITUDE_SELECTION_MODELS: 'a,b,c,d', APTITUDE_SELECTION_MAX_CALLS: '36' },
  ])('rejects an unbounded/implicit plan before provider work: %j', env => {
    expect(() => planAptitudeSelection(env)).toThrow()
  })
})

describe('independent selection truth and rendering', () => {
  it('contains ten objective and two distinct boundary scenarios with no reused fixture IDs', () => {
    expect(APTITUDE_SELECTION_FIXTURES).toHaveLength(12)
    expect(new Set(APTITUDE_SELECTION_FIXTURES.map(fixture => fixture.id)).size).toBe(12)
    expect(APTITUDE_SELECTION_FIXTURES.filter(fixture => fixture.expected.status === 'solved')).toHaveLength(10)
    expect(APTITUDE_SELECTION_FIXTURES.filter(fixture => fixture.expected.status === 'ambiguous')).toHaveLength(1)
    expect(APTITUDE_SELECTION_FIXTURES.filter(fixture => fixture.expected.status === 'needs_capture')).toHaveLength(1)
    expect(APTITUDE_SELECTION_FIXTURE_HASH).toMatch(/^[a-f0-9]{64}$/)
  })
  it('independently verifies inverse percentage, weighted mean and shape values', () => {
    expect(96 / 0.8).toBe(120)
    expect((120 * 15 + 80 * 21) / 200).toBe(17.4)
    const circle = (2 * 13 - 14) / 3, square = (2 * 14 - 13) / 3
    expect(circle + 2 * square).toBe(14)
    expect(2 * circle + square).toBe(13)
    expect(3 * circle + 2 * square).toBe(22)
    expect((24 - 18) / 18).toBeGreaterThan((48 - 40) / 40)
    expect((24 - 18) / 18).toBeGreaterThan((30 - 25) / 25)
  })
  it('checks all orderings rather than assuming the intended five-person order', () => {
    const permute = (values: string[]): string[][] => values.length ? values.flatMap((value, index) => permute(values.filter((_, position) => position !== index)).map(tail => [value, ...tail])) : [[]]
    const valid = permute(['Ada', 'Ben', 'Cara', 'Dev', 'Eli']).filter(order => order.indexOf('Ben') === order.indexOf('Dev') + 1
      && order.indexOf('Ada') < order.indexOf('Dev') && order.indexOf('Cara') > order.indexOf('Ben') && order[4] === 'Eli')
    expect(valid).toEqual([['Ada', 'Dev', 'Ben', 'Cara', 'Eli']])
  })
  it('independently computes reflection then clockwise rotation and distinct distractors', () => {
    const mirrored = SELECTION_TRANSFORM_SOURCE.map(cell => Math.floor(cell / 3) * 3 + 2 - cell % 3)
    const transformed = mirrored.map(cell => cell % 3 * 3 + 2 - Math.floor(cell / 3)).sort((a, b) => a - b)
    expect(transformed).toEqual([1, 3, 5, 8])
    expect(SELECTION_TRANSFORM_OPTIONS[3]).toEqual(transformed)
    expect(new Set(SELECTION_TRANSFORM_OPTIONS.map(cells => JSON.stringify(cells))).size).toBe(4)
  })
  it('independently verifies XOR in every row and a uniquely correct equal-count choice', () => {
    for (let row = 0; row < 3; row++) {
      const left: readonly number[] = SELECTION_XOR_PANELS[row * 3], right: readonly number[] = SELECTION_XOR_PANELS[row * 3 + 1]
      const xor = [...new Set([...left, ...right])].filter(cell => left.includes(cell) !== right.includes(cell)).sort((a, b) => a - b)
      expect(xor).toEqual(SELECTION_XOR_PANELS[row * 3 + 2])
    }
    expect(SELECTION_XOR_OPTIONS[1]).toEqual(SELECTION_XOR_PANELS[8])
    expect(SELECTION_XOR_OPTIONS.every(cells => cells.length === 4)).toBe(true)
    expect(new Set(SELECTION_XOR_OPTIONS.map(cells => JSON.stringify(cells))).size).toBe(4)
  })
  it('renders only visible question data, never fixture IDs, expected labels, domains or score hints', () => {
    for (const fixture of APTITUDE_SELECTION_FIXTURES) {
      const svg = selectionFixtureSvg(fixture)
      expect(svg).not.toContain(fixture.id)
      expect(svg).not.toContain(fixture.domain)
      expect(svg).not.toMatch(/selectedLabels|criticalText|gridTruth|answer key|correct answer/i)
      expect(svg).toContain('APTITUDE PRACTICE')
    }
  })
  it('rasterizes every scenario to real PNG bytes with the intended crop', async () => {
    const require = createRequire(import.meta.url), fromNext = createRequire(require.resolve('next/package.json'))
    const sharp = fromNext('sharp')
    for (const fixture of APTITUDE_SELECTION_FIXTURES) {
      const { png, sha256 } = await renderSelectionFixture(fixture)
      const metadata = await sharp(png).metadata()
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(metadata.width).toBe(1080)
      expect(metadata.height).toBe(fixture.cropped ? 510 : 680)
      expect(sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})

describe('complete experiment and failure denominators', () => {
  const plan = { plannedCalls: 36, plannedAttempts: 36 }
  const completed = () => Array.from({ length: 36 }, () => ({ outcome: 'complete', callStarted: true, validated: true,
    diagnostic: { code: 'VALID' }, sourceImageMatches: true, error: null as unknown, answerCorrect: false }))
  it('allows all incorrect but structurally valid answers to finish collection without calling them accurate', () => {
    expect(selectionCollectionStatus(completed(), 36, plan)).toEqual({ complete: true, operationallyPassed: true })
  })
  it.each(['schema', 'source', 'provider'] as const)('preserves completion but fails a %s defect after all attempts', defect => {
    const attempts = completed()
    if (defect === 'schema') { attempts[0].validated = false; attempts[0].diagnostic.code = 'INVALID_SCHEMA' }
    if (defect === 'source') attempts[0].sourceImageMatches = false
    if (defect === 'provider') { attempts[0].outcome = 'error'; attempts[0].error = { code: 'HTTP_503' } }
    expect(selectionCollectionStatus(attempts, 36, plan)).toEqual({ complete: true, operationallyPassed: false })
  })
  it('never presents missing, interrupted or unstarted attempts as a complete experiment', () => {
    expect(selectionCollectionStatus(completed().slice(1), 35, plan).complete).toBe(false)
    const interrupted = completed(); interrupted[3].outcome = 'aborted'
    expect(selectionCollectionStatus(interrupted, 36, plan).complete).toBe(false)
    const unstarted = completed(); unstarted[3].callStarted = false
    expect(selectionCollectionStatus(unstarted, 36, plan).complete).toBe(false)
  })
  it('includes wrong answers and provider failures in the objective denominator', () => {
    const correct = { schemaValid: true, categoryCorrect: true, statusCorrect: true, answerCorrect: true,
      shouldAbstain: false, abstained: false, criticalTextCoverage: 1, optionMappingCorrect: null, evidenceReview: null }
    const attempts: ScoredEvaluationAttempt[] = [
      { expectedStatus: 'solved', outcome: 'complete', score: correct, comparisonScore: null, durationMs: 10 },
      { expectedStatus: 'solved', outcome: 'complete', score: { ...correct, answerCorrect: false }, comparisonScore: null, durationMs: 20 },
      { expectedStatus: 'solved', outcome: 'error', score: null, comparisonScore: null, durationMs: 25_000 },
    ]
    expect(aggregateAptitudeAttempts(attempts)).toMatchObject({ objectiveAttempted: 3, objectiveAnswersCorrect: 1, objectiveAccuracy: 1 / 3, errors: 1 })
  })
})

describe('selection scoring', () => {
  const fixture = APTITUDE_SELECTION_FIXTURES.find(fixture => fixture.gridTruth)!
  const options = ['A', 'B', 'C', 'D'].map(label => ({ id: `id-${label}`, label, text: `Visible ${label}` }))
  const inventory = (): AptitudeGridInventory => ({
    rows: 3, columns: 3, cellRows: 3, cellColumns: 3,
    panels: structuredClone(fixture.gridTruth!.panels),
    options: Object.entries(fixture.gridTruth!.options).map(([label, filledCells]) => ({ optionId: `id-${label}`, filledCells: [...filledCells] })),
  })
  it('accepts identical cells independent of cell order and provider option IDs', () => {
    const actual = inventory()
    actual.panels.reverse(); actual.options.reverse(); actual.panels.forEach(panel => panel.filledCells?.reverse())
    expect(selectionGridMatches(actual, options, fixture.gridTruth!)).toBe(true)
  })
  it.each(['source', 'choice', 'missing', 'omitted'] as const)('rejects %s grid evidence errors even with the correct answer label', kind => {
    const actual = inventory()
    if (kind === 'source') actual.panels[0].filledCells = ['r1c1']
    if (kind === 'choice') actual.options[1].filledCells = ['r1c1']
    if (kind === 'missing') actual.panels[8].filledCells = []
    expect(selectionGridMatches(kind === 'omitted' ? null : actual, options, fixture.gridTruth!)).toBe(false)
  })
  it('separates a correct answer label from a wrong literal grid inventory', () => {
    const observation = solvedObservation()
    observation.category = 'abstract'
    observation.question!.options = options
    observation.answer!.selectedOptionIds = ['id-B']
    observation.answer!.calculation = null
    observation.answer!.gridInventory = inventory()
    const result: AptitudeResult = { ...observation, schemaVersion: 1, captureId: 'selection-test', questionVersion: 1,
      sourceHash: 'a'.repeat(64), questionId: 'b'.repeat(64), verification: { method: 'none', outcome: 'not_run', notes: [] },
      model: 'test-model', provider: 'openai', durationMs: 1 }
    expect(scoreSelectionFixture(fixture, result)).toMatchObject({ answerCorrect: true, gridInventoryCorrect: true, evidenceReviewRequired: false })
    result.answer!.gridInventory!.panels[0].filledCells = ['r1c1']
    expect(scoreSelectionFixture(fixture, result)).toMatchObject({ answerCorrect: true, gridInventoryCorrect: false, evidenceReviewRequired: true })
    result.answer!.selectedOptionIds = ['id-A']
    expect(scoreSelectionFixture(fixture, result).answerCorrect).toBe(false)
  })
})
