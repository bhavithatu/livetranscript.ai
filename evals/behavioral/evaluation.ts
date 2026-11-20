import { modeProfile, thinkingConfigFor, vendorForModel } from '@/lib/copilot/modes'
import type { AnswerParams } from '@/lib/copilot/providers'
import { buildBehavioralSnapshot, renderBehavioralSnapshot } from '@/lib/behavioral/session'
import { BEHAVIORAL_CONSISTENCY_FIXTURES, type BehavioralConsistencyFixture } from './fixtures'

export type BehavioralEvaluationPlan = {
  vendor: 'anthropic' | 'openai'
  model: string
  modelId: string
  fixtureIds: string[]
  plannedCalls: number
  maxCalls: number
}

/** Resolve the whole bounded plan before examining keys or starting any request. */
export function planBehavioralEvaluation(env: Record<string, string | undefined>): BehavioralEvaluationPlan {
  const match = /^(anthropic|openai):([a-zA-Z0-9._-]+)$/.exec(env.BEHAVIORAL_EVAL_MODEL ?? '')
  if (!match) throw new Error('Set BEHAVIORAL_EVAL_MODEL explicitly as anthropic:<model-id> or openai:<model-id>.')
  const vendor = match[1] as BehavioralEvaluationPlan['vendor']
  const model = match[2]
  if (vendorForModel(model) !== vendor) throw new Error('The explicit provider does not match the model routing used by production.')
  const cap = env.BEHAVIORAL_EVAL_MAX_CALLS
  if (!cap || !/^[1-6]$/.test(cap)) throw new Error('BEHAVIORAL_EVAL_MAX_CALLS must explicitly be an integer from 1 to 6.')
  const fixtureIds = env.BEHAVIORAL_EVAL_CASES === undefined
    ? BEHAVIORAL_CONSISTENCY_FIXTURES.map(fixture => fixture.id)
    : env.BEHAVIORAL_EVAL_CASES.split(',').map(id => id.trim()).filter(Boolean)
  if (!fixtureIds.length || new Set(fixtureIds).size !== fixtureIds.length) throw new Error('Select at least one distinct authored case; repeats are not enabled.')
  if (fixtureIds.some(id => !BEHAVIORAL_CONSISTENCY_FIXTURES.some(fixture => fixture.id === id))) throw new Error('Unknown behavioral evaluation case. No calls were made.')
  if (fixtureIds.length > Number(cap)) throw new Error(`The plan needs ${fixtureIds.length} calls and exceeds the explicit cap of ${cap}. No calls were made.`)
  return { vendor, model, modelId: `${vendor}:${model}`, fixtureIds, plannedCalls: fixtureIds.length, maxCalls: Number(cap) }
}

/** Same prompt, posture, evidence renderer, and per-mode generation budget as the
 * answer route. The direct provider seam disables fallback and speculative drafts. */
export function evaluationRequest(fixture: BehavioralConsistencyFixture, model: string): AnswerParams {
  const profile = modeProfile('behavioral')
  const posture = thinkingConfigFor('behavioral', model)
  return {
    model,
    system: profile.system,
    transcript: '',
    context: renderBehavioralSnapshot(buildBehavioralSnapshot(fixture.round, fixture.question)),
    history: [],
    question: fixture.question,
    image: null,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    thinking: posture.thinking,
    effort: posture.effort,
  }
}

export class BehavioralEvaluationCallGuard {
  private started = new Set<string>()
  constructor(private readonly plan: BehavioralEvaluationPlan) {}
  get callsStarted() { return this.started.size }
  start(fixtureId: string): void {
    if (!this.plan.fixtureIds.includes(fixtureId)) throw new Error('UNPLANNED_BEHAVIORAL_CASE')
    if (this.started.has(fixtureId)) throw new Error('UNPLANNED_BEHAVIORAL_RETRY')
    if (this.callsStarted >= this.plan.maxCalls || this.callsStarted >= this.plan.plannedCalls) throw new Error('BEHAVIORAL_CALL_CAP_REACHED')
    this.started.add(fixtureId)
  }
}

export function reviewSignals(fixture: BehavioralConsistencyFixture, answer: string) {
  return fixture.reviewSignals.map(signal => ({ label: signal.label, present: signal.pattern.test(answer) }))
}

export type BehavioralEvaluationRow = {
  fixtureId: string
  title: string
  question: string
  status: 'complete' | 'failed'
  answer: string | null
  failure: 'provider_or_stream_failure' | null
  elapsedMs: number
  evidence: ReturnType<typeof buildBehavioralSnapshot>
  signals: ReturnType<typeof reviewSignals>
  reviewCriteria: string[]
  semanticReview: { status: 'pending'; grounded: null; consistent: null; notes: string }
}

export function evaluationSummary(plan: BehavioralEvaluationPlan, rows: BehavioralEvaluationRow[], callsStarted: number) {
  const completed = rows.filter(row => row.status === 'complete').length
  const failed = rows.filter(row => row.status === 'failed').length
  return {
    plannedCalls: plan.plannedCalls,
    callsStarted,
    completed,
    failed,
    missingRows: Math.max(0, plan.plannedCalls - rows.length),
    semanticReview: 'pending' as const,
    semanticPassRate: null,
    note: 'Presence signals are review aids, not semantic correctness checks. Provider failures remain in the planned-call denominator. Every answer requires review against its supplied evidence.',
  }
}
