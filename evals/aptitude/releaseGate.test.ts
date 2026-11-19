// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { selectAptitudeComparison } from '@/lib/aptitude/comparison'
import { parseAptitudeResult, type AptitudeComparisonCandidate, type AptitudeObservation } from '@/lib/aptitude/schema'
import { APTITUDE_FIXTURES } from './fixtures'
import { APTITUDE_RELEASE_FIXTURE_IDS, APTITUDE_RELEASE_MAX_CALLS, assessAptitudeReleaseFixture, safeAptitudeProviderError } from './releaseGate'
import { AptitudeEvaluationCallGuard, planAptitudeEvaluation } from './evaluationPlan'
import { aptitudeReleaseEnvironment } from '../../scripts/aptitude-release-environment.mjs'

const ids = ['anthropic:claude-sonnet-4-5', 'openai:gpt-4.1', 'openai:gpt-4.1-mini']
const imageHash = 'b'.repeat(64)
const starFixture = APTITUDE_FIXTURES.find(fixture => fixture.id === 'visual-star-points')!
const croppedFixture = APTITUDE_FIXTURES.find(fixture => fixture.id === 'visual-grid-cropped-choices')!

describe('paid deployment environment guard', () => {
  it.each([
    [{}, null],
    [{ LT_RUN_APTITUDE_RELEASE_CHECK: '1' }, null],
    [{ CI: 'true', LT_RUN_APTITUDE_RELEASE_CHECK: '1' }, null],
    [{ VERCEL_ENV: 'development', LT_RUN_APTITUDE_RELEASE_CHECK: '1' }, null],
    [{ VERCEL_ENV: 'preview' }, null],
    [{ VERCEL_ENV: 'preview', LT_RUN_APTITUDE_RELEASE_CHECK: 'true' }, null],
    [{ VERCEL_ENV: 'preview', LT_RUN_APTITUDE_RELEASE_CHECK: '0' }, null],
    [{ VERCEL_ENV: 'preview', LT_RUN_APTITUDE_RELEASE_CHECK: '1' }, 'preview'],
    [{ VERCEL_ENV: 'production' }, 'production'],
    [{ VERCEL_ENV: 'production', LT_RUN_APTITUDE_RELEASE_CHECK: '0' }, 'production'],
  ])('enables only production or an explicitly opted-in preview: %j', (env, expected) => {
    expect(aptitudeReleaseEnvironment(env)).toBe(expected)
  })
})
function observation(): AptitudeObservation {
  return { category: 'abstract', status: 'solved', message: null,
    question: { stem: starFixture.view.lines.join(' '), instructions: ['Choose one.'], passage: null,
      responseType: 'single_choice', missingEvidence: [],
      options: ['42', '45', '49', '56'].map((text, index) => ({ id: 'ABCD'[index], label: 'ABCD'[index], text })),
    },
    answer: { selectedOptionIds: ['C'], value: '49', unit: null, summary: 'C — 49',
      evidence: ['A 4-point star has 28; a 5-point star has 35; a 7-point star is unknown.'],
      workedExplanation: ['Each point is worth 7, so 7 × 7 = 49.'], calculation: { expression: '7*7', claimedValue: 49, decimalPlaces: null } },
  }
}
function candidate(index: number, source = observation()): AptitudeComparisonCandidate {
  return { modelId: ids[index], model: `offline-model-${index}`, provider: index === 0 ? 'anthropic' : 'openai',
    status: 'complete', observation: source, verification: { method: 'arithmetic', outcome: 'passed', notes: ['Offline fixture; not a model result.'] },
    durationMs: 5, error: null }
}
function result(candidates: AptitudeComparisonCandidate[]) {
  const { comparison, selected } = selectAptitudeComparison(candidates)
  return parseAptitudeResult({
    ...(selected?.observation ?? { category: 'abstract', status: 'ambiguous', question: candidates[0].observation?.question ?? null,
      answer: null, message: 'The comparison remains unresolved.' }),
    schemaVersion: 1, captureId: 'offline-release-check', questionVersion: 1, sourceHash: imageHash,
    questionId: selected ? 'a'.repeat(64) : null, model: selected?.model ?? null, provider: selected?.provider ?? null,
    durationMs: 10, verification: selected?.verification ?? { method: 'none', outcome: 'not_run', notes: ['No selection.'] }, comparison,
  })
}

describe('production release criteria without provider calls', () => {
  it('requires the original four-fixture plan and preserves two-model and three-model budgets', () => {
    expect(APTITUDE_RELEASE_FIXTURE_IDS).toHaveLength(4)
    expect(APTITUDE_RELEASE_FIXTURE_IDS.every(id => APTITUDE_FIXTURES.some(fixture => fixture.id === id))).toBe(true)
    for (const count of [2, 3]) {
      const plan = planAptitudeEvaluation({ APTITUDE_EVAL_STRATEGY: 'compare', APTITUDE_EVAL_MODELS: ids.slice(0, count).join(','),
        APTITUDE_EVAL_MAX_CALLS: String(APTITUDE_RELEASE_MAX_CALLS), APTITUDE_EVAL_REPEATS: '1' }, APTITUDE_RELEASE_FIXTURE_IDS.length)
      expect(plan.plannedCalls).toBe(count * 4)
      const guard = new AptitudeEvaluationCallGuard(plan)
      for (let fixture = 0; fixture < 4; fixture++) {
        const reserve = guard.attempt(plan.arms[0])
        for (const id of ids.slice(0, count)) reserve(id)
        expect(() => reserve(ids[0])).toThrow('UNPLANNED_PROVIDER_RETRY')
        expect(() => reserve('openai:unexpected')).toThrow('UNPLANNED_PROVIDER_MODEL')
      }
      expect(guard.callsStarted).toBe(plan.plannedCalls)
      expect(() => guard.attempt(plan.arms[0])(ids[0])).toThrow('CALL_CAP_REACHED')
    }
  })

  it('passes correct candidates and a correct published selection with two or three configured models', () => {
    for (const count of [2, 3]) {
      const analysis = result(Array.from({ length: count }, (_, index) => candidate(index)))
      expect(assessAptitudeReleaseFixture(starFixture, analysis, ids.slice(0, count), imageHash)).toMatchObject({
        passed: true, selectionResolved: true, conservativeAbstention: false, publishedAnswerCorrect: true, failures: [],
      })
    }
  })

  it('reports conservative evidence reconciliation separately from correct candidate accuracy', () => {
    const second = candidate(1)
    second.observation!.question!.stem = 'What is the value of the star with seven points?'
    const check = assessAptitudeReleaseFixture(starFixture, result([candidate(0), second]), ids.slice(0, 2), imageHash)
    expect(check).toMatchObject({ passed: true, selectionResolved: false, conservativeAbstention: true, publishedAnswerCorrect: null })
    expect(check.candidates.every(candidate => candidate.score?.answerCorrect)).toBe(true)
  })

  it('fails a wrong candidate even when the final comparison withholds an answer', () => {
    const wrong = candidate(1)
    wrong.observation!.answer!.selectedOptionIds = ['A']
    wrong.observation!.answer!.value = '42'
    wrong.observation!.answer!.calculation = { expression: '6*7', claimedValue: 42, decimalPlaces: null }
    const check = assessAptitudeReleaseFixture(starFixture, result([candidate(0), wrong]), ids.slice(0, 2), imageHash)
    expect(check.passed).toBe(false)
    expect(check.failures).toContainEqual({ code: 'WRONG_OBJECTIVE_ANSWER', modelId: ids[1] })
    expect(check.failures).toContainEqual({ code: 'EVIDENCE_REVIEW_REQUIRED', modelId: ids[1] })
  })

  it('fails invented visual evidence even when both selected labels happen to be correct', () => {
    const fabricated = candidate(1)
    fabricated.observation!.answer!.evidence = ['Four stars become five stars, then seven stars.']
    const check = assessAptitudeReleaseFixture(starFixture, result([candidate(0), fabricated]), ids.slice(0, 2), imageHash)
    expect(check.passed).toBe(false)
    expect(check.failures).toContainEqual({ code: 'EVIDENCE_REVIEW_REQUIRED', modelId: ids[1] })
  })

  it('accepts explicit recapture from every candidate even when the comparison wrapper says ambiguous', () => {
    const abstention = (): AptitudeObservation => ({ ...observation(), status: 'needs_capture', answer: null, message: 'The option diagrams are cropped.' })
    const analysis = result([candidate(0, abstention()), candidate(1, abstention())])
    expect(analysis.status).toBe('ambiguous')
    expect(assessAptitudeReleaseFixture(croppedFixture, analysis, ids.slice(0, 2), imageHash)).toMatchObject({ passed: true, selectionResolved: false, publishedAnswerCorrect: null })
    const wrongBoundary = result([candidate(0), candidate(1)])
    const rejected = assessAptitudeReleaseFixture(croppedFixture, wrongBoundary, ids.slice(0, 2), imageHash)
    expect(rejected.passed).toBe(false)
    expect(rejected.failures).toContainEqual({ code: 'PUBLISHED_BOUNDARY_ANSWER' })
  })

  it('fails an unexpected abstention on a clear objective fixture', () => {
    const abstention: AptitudeObservation = { ...observation(), status: 'needs_capture', answer: null, message: 'Cannot read the clear fixture.' }
    const check = assessAptitudeReleaseFixture(starFixture, result([candidate(0), candidate(1, abstention)]), ids.slice(0, 2), imageHash)
    expect(check.failures).toContainEqual({ code: 'OBJECTIVE_NOT_SOLVED', modelId: ids[1] })
    expect(check.passed).toBe(false)
  })

  it('fails model errors, source mismatches and unexpected model configurations', () => {
    const failed: AptitudeComparisonCandidate = { ...candidate(1), model: null, status: 'timed_out', observation: null, verification: null, error: 'Synthetic timeout.' }
    expect(assessAptitudeReleaseFixture(starFixture, result([candidate(0), failed]), ids.slice(0, 2), imageHash).failures).toContainEqual({ code: 'MODEL_TIMEOUT', modelId: ids[1] })
    const analysis = result([candidate(0), candidate(1)])
    expect(assessAptitudeReleaseFixture(starFixture, analysis, ids.slice(0, 2), 'c'.repeat(64)).failures).toContainEqual({ code: 'SOURCE_IMAGE_MISMATCH' })
    expect(assessAptitudeReleaseFixture(starFixture, analysis, [ids[0], ids[2]], imageHash).failures).toContainEqual({ code: 'MODEL_SET_MISMATCH' })
    expect(assessAptitudeReleaseFixture(starFixture, {}, ids.slice(0, 2), imageHash).failures).toEqual([{ code: 'INVALID_RESULT' }])
  })
})

describe('public release error sanitization', () => {
  it('reports only approved provider codes and numeric status, never error bodies or credentials', () => {
    const diagnostic = safeAptitudeProviderError({ status: 404, code: 'model_not_found', message: 'SECRET credential in error message',
      headers: { authorization: 'SECRET' }, error: { key: 'SECRET', body: 'SECRET' } })
    expect(diagnostic).toEqual({ code: 'model_not_found', status: 404 })
    expect(JSON.stringify(diagnostic)).not.toContain('SECRET')
    expect(safeAptitudeProviderError({ status: 401, code: 'SECRET', message: 'SECRET' })).toEqual({ code: 'HTTP_401', status: 401 })
    expect(safeAptitudeProviderError({ error: { error: { type: 'rate_limit_error', message: 'SECRET' } } })).toEqual({ code: 'rate_limit_error', status: null })
  })
  it('distinguishes deadlines, incomplete output and unavailable credentials without raw messages', () => {
    expect(safeAptitudeProviderError(new Error('Incomplete provider response'))).toEqual({ code: 'INCOMPLETE_RESPONSE', status: null })
    expect(safeAptitudeProviderError({ name: 'APIConnectionTimeoutError' }).code).toBe('PROVIDER_TIMEOUT')
    expect(safeAptitudeProviderError(new Error('anything'), true).code).toBe('ABORTED_OR_DEADLINE')
    expect(safeAptitudeProviderError({ code: 'PROVIDER_UNAVAILABLE', status: 503 })).toEqual({ code: 'PROVIDER_UNAVAILABLE', status: 503 })
  })
})
