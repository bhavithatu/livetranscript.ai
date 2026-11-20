import { describe, expect, it } from 'vitest'
import { buildBehavioralSnapshot } from '@/lib/behavioral/session'
import { modeProfile } from '@/lib/copilot/modes'
import { BEHAVIORAL_CONSISTENCY_FIXTURES } from './fixtures'
import { BehavioralEvaluationCallGuard, evaluationRequest, evaluationSummary, planBehavioralEvaluation, reviewSignals, type BehavioralEvaluationRow } from './evaluation'

const ENV = { BEHAVIORAL_EVAL_MODEL: 'anthropic:claude-sonnet-5-5', BEHAVIORAL_EVAL_MAX_CALLS: '6' }

describe('behavioral consistency evaluation contract', () => {
  it('requires an explicit model and call cap before any provider can run', () => {
    expect(() => planBehavioralEvaluation({})).toThrow('BEHAVIORAL_EVAL_MODEL')
    expect(() => planBehavioralEvaluation({ BEHAVIORAL_EVAL_MODEL: ENV.BEHAVIORAL_EVAL_MODEL })).toThrow('BEHAVIORAL_EVAL_MAX_CALLS')
    expect(() => planBehavioralEvaluation({ ...ENV, BEHAVIORAL_EVAL_MAX_CALLS: '5' })).toThrow('exceeds')
    expect(() => planBehavioralEvaluation({ ...ENV, BEHAVIORAL_EVAL_MAX_CALLS: '7' })).toThrow('1 to 6')
    expect(() => planBehavioralEvaluation({ ...ENV, BEHAVIORAL_EVAL_MODEL: 'openai:claude-sonnet-5-5' })).toThrow('provider')
    expect(planBehavioralEvaluation(ENV)).toMatchObject({ plannedCalls: 6, maxCalls: 6 })
  })

  it('rejects unknown, empty, and repeated cases instead of silently changing the call plan', () => {
    for (const cases of ['', 'unknown', 'actual-answer-over-suggestion,actual-answer-over-suggestion']) {
      expect(() => planBehavioralEvaluation({ ...ENV, BEHAVIORAL_EVAL_CASES: cases })).toThrow()
    }
    expect(planBehavioralEvaluation({ ...ENV, BEHAVIORAL_EVAL_MAX_CALLS: '1', BEHAVIORAL_EVAL_CASES: 'missing-evidence-needs-facts' }).plannedCalls).toBe(1)
  })

  it('a failed provider attempt consumes its case budget and cannot trigger a hidden retry', () => {
    const plan = planBehavioralEvaluation(ENV)
    const guard = new BehavioralEvaluationCallGuard(plan)
    guard.start(plan.fixtureIds[0])
    // The provider may fail after this call. The guard is intentionally never reset.
    expect(() => guard.start(plan.fixtureIds[0])).toThrow('UNPLANNED_BEHAVIORAL_RETRY')
    expect(() => guard.start('unplanned')).toThrow('UNPLANNED_BEHAVIORAL_CASE')
    expect(guard.callsStarted).toBe(1)
    plan.fixtureIds.slice(1).forEach(id => guard.start(id))
    expect(guard.callsStarted).toBe(6)
  })

  it('builds actual provider inputs from the production prompt and attributed full-round evidence', () => {
    const fixture = BEHAVIORAL_CONSISTENCY_FIXTURES[0]
    const request = evaluationRequest(fixture, 'claude-sonnet-5-5')
    const snapshot = buildBehavioralSnapshot(fixture.round, fixture.question)
    expect(request.system).toBe(modeProfile('behavioral').system)
    expect(request.maxTokens).toBe(modeProfile('behavioral').maxTokens)
    expect(request.question).toBe(fixture.question)
    expect(request.history).toEqual([])
    expect(request.context).toContain('USER-RECORDED ANSWER')
    expect(request.context).toContain('AI SUGGESTION')
    expect(snapshot.records.find(record => record.id === 'metric-actual')).toMatchObject({ kind: 'confirmed_answer', text: expect.stringContaining('14%') })
    expect(snapshot.records.find(record => record.id === 'metric-ai')).toMatchObject({ kind: 'ai_suggestion', text: expect.stringContaining('40%') })
    expect(snapshot.coverage).toMatchObject({ totalRecords: 2, totalConfirmedRecords: 1, omittedRecords: 0 })
  })

  it('retains the first project after forty later records and does not manufacture legacy assistant history', () => {
    const fixture = BEHAVIORAL_CONSISTENCY_FIXTURES.find(item => item.id === 'early-fact-after-forty-records')!
    const snapshot = buildBehavioralSnapshot(fixture.round, fixture.question)
    const request = evaluationRequest(fixture, 'claude-sonnet-5-5')
    expect(snapshot.records).toHaveLength(41)
    expect(snapshot.records[0]).toMatchObject({ id: 'cedar-actual', kind: 'confirmed_answer' })
    expect(snapshot.coverage.complete).toBe(true)
    expect(request.context).toContain('The Cedar pilot ran in 2023 with three engineers.')
    expect(request.context).toContain('I did not manage the team.')
    expect(request.history).toEqual([])
  })

  it('keeps current company and current negated option mapping distinct from historical suggestions and labels', () => {
    const company = BEHAVIORAL_CONSISTENCY_FIXTURES.find(item => item.id === 'company-fit-preserves-person')!
    const snapshot = buildBehavioralSnapshot(company.round, company.question)
    expect(snapshot.profile.company).toContain('Product Studio')
    expect(snapshot.records.find(record => record.kind === 'ai_suggestion')?.contextProfile?.company).toBe('Example Bank')
    const negated = BEHAVIORAL_CONSISTENCY_FIXTURES.find(item => item.id === 'negative-wording-and-new-labels')!
    const request = evaluationRequest(negated, 'claude-sonnet-5-5')
    expect(request.question).toContain('I dislike relying')
    expect(request.question).toContain('A = Disagree')
    expect(request.question).toContain('D = Strongly agree')
    expect(request.context).toContain('D — Agree')
  })

  it('reports semantic review as pending even if every presence signal matches', () => {
    const fixture = BEHAVIORAL_CONSISTENCY_FIXTURES[0]
    const signals = reviewSignals(fixture, 'I reduced latency by 14% and 40%.')
    expect(signals.every(signal => signal.present)).toBe(true)
    const failedRow: BehavioralEvaluationRow = {
      fixtureId: fixture.id, title: fixture.title, question: fixture.question,
      status: 'failed', answer: null, failure: 'provider_or_stream_failure', elapsedMs: 20,
      evidence: buildBehavioralSnapshot(fixture.round), signals: [], reviewCriteria: fixture.reviewCriteria,
      semanticReview: { status: 'pending', grounded: null, consistent: null, notes: '' },
    }
    const summary = evaluationSummary(planBehavioralEvaluation(ENV), [failedRow], 1)
    expect(summary).toMatchObject({ plannedCalls: 6, completed: 0, failed: 1, missingRows: 5, semanticReview: 'pending', semanticPassRate: null })
  })

  it('all six authored fixtures satisfy production snapshot validation without invented confirmation', () => {
    expect(BEHAVIORAL_CONSISTENCY_FIXTURES).toHaveLength(6)
    for (const fixture of BEHAVIORAL_CONSISTENCY_FIXTURES) {
      const snapshot = buildBehavioralSnapshot(fixture.round, fixture.question)
      expect(snapshot.coverage.complete).toBe(true)
      expect(fixture.reviewCriteria.length).toBeGreaterThan(1)
    }
    const empty = BEHAVIORAL_CONSISTENCY_FIXTURES.find(item => item.id === 'missing-evidence-needs-facts')!
    expect(buildBehavioralSnapshot(empty.round).records).toEqual([])
    const conflicted = BEHAVIORAL_CONSISTENCY_FIXTURES.find(item => item.id === 'unresolved-confirmed-conflict')!
    expect(buildBehavioralSnapshot(conflicted.round).records.every(record => record.kind === 'confirmed_answer' && !record.supersedes)).toBe(true)
  })
})
