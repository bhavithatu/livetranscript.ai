import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { analyzeAptitude, defaultAptitudeTransport } from '@/lib/aptitude/analyze'
import { configuredAptitudeComparisonModels } from '@/lib/aptitude/modelPolicy'
import { APTITUDE_SYSTEM_PROMPT } from '@/lib/aptitude/prompt'
import { APTITUDE_OBSERVATION_JSON_SCHEMA, type AptitudeComparisonCandidate, type AptitudeResult } from '@/lib/aptitude/schema'
import { APTITUDE_FIXTURES } from './fixtures'
import { renderAptitudeFixture } from './render'
import { selectAptitudeFixtures } from './selectFixtures'
import { AptitudeEvaluationCallGuard, planAptitudeEvaluation } from './evaluationPlan'
import { APTITUDE_RELEASE_FIXTURE_IDS, APTITUDE_RELEASE_MAX_CALLS, assessAptitudeReleaseFixture, inspectAptitudeReleaseReply, safeAptitudeProviderError, type AptitudeReleaseFixtureCheck, type AptitudeReleaseReplyDiagnostic } from './releaseGate'
import { aptitudeReleaseLogLines } from './releaseLogging'
import { aptitudeReleaseEnvironment } from '../../scripts/aptitude-release-environment.mjs'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const log = (...input: Parameters<typeof aptitudeReleaseLogLines>) => aptitudeReleaseLogLines(...input).forEach(line => console.info(line))
type Call = {
  modelId: string; requestedModel: string; returnedModel: string | null; provider: string;
  outcome: 'running' | 'returned' | 'error'; validated: boolean | null; durationMs: number | null;
  inputTokens: number | null; outputTokens: number | null; error: { code: string; status: number | null } | null;
  validationDiagnostic: AptitudeReleaseReplyDiagnostic | null;
}
type BriefCandidate = {
  modelId: string; model: string | null; status: string; durationMs: number;
  answer: { labels: string[]; value: string | null; summary: string; evidence: string[]; workedExplanation: string[];
    calculation: { expression: string; claimedValue: number } | null;
    numericPattern: { observedValues: number[]; rule: string } | null } | null;
  observationStatus: string | null;
}
type Attempt = {
  fixtureId: string; expectedStatus: string; imageHash: string | null; durationMs: number | null;
  calls: Call[]; check: AptitudeReleaseFixtureCheck | null; candidates: BriefCandidate[]; error: { code: string; status: number | null } | null;
}
function briefCandidate(candidate: AptitudeComparisonCandidate): BriefCandidate {
  const observation = candidate.observation
  const answer = observation?.answer
  return { modelId: candidate.modelId, model: candidate.model, status: candidate.status, durationMs: candidate.durationMs,
    observationStatus: observation?.status ?? null,
    answer: answer ? {
      labels: answer.selectedOptionIds.map(id => observation?.question?.options.find(option => option.id === id)?.label ?? '').map(label => label.slice(0, 80)),
      value: answer.value?.slice(0, 100) ?? null, summary: answer.summary.slice(0, 400),
      evidence: answer.evidence.map(value => value.slice(0, 2_000)), workedExplanation: answer.workedExplanation.map(value => value.slice(0, 2_000)),
      calculation: answer.calculation ? { expression: answer.calculation.expression.slice(0, 200), claimedValue: answer.calculation.claimedValue } : null,
      numericPattern: answer.numericPattern ? { observedValues: answer.numericPattern.observedValues, rule: answer.numericPattern.rule } : null,
    } : null,
  }
}

it.skipIf(aptitudeReleaseEnvironment(process.env) === null)('blocks an enabled deployment on wrong visual answers, unsafe abstentions or provider failures', async () => {
  const fixtures = selectAptitudeFixtures(APTITUDE_FIXTURES, APTITUDE_RELEASE_FIXTURE_IDS.join(','))
  const commit = process.env.VERCEL_GIT_COMMIT_SHA
  const report = {
    version: 1, scope: 'synthetic-aptitude-release-check', environment: aptitudeReleaseEnvironment(process.env), liveModel: false, deviceVerified: false,
    passed: false, complete: false, phase: 'configuration', commit: commit && /^[a-f0-9]{40}$/i.test(commit) ? commit : null,
    startedAt: new Date().toISOString(), finishedAt: null as string | null,
    configuredModels: [] as string[], configuredModelDetails: [] as { id: string; model: string; provider: string }[],
    fixtureIds: fixtures.map(fixture => fixture.id), fixtureHash: hash(JSON.stringify(fixtures)),
    promptHash: hash(APTITUDE_SYSTEM_PROMPT), schemaHash: hash(JSON.stringify(APTITUDE_OBSERVATION_JSON_SCHEMA)),
    plannedCalls: 0, callsStarted: 0, maxCalls: APTITUDE_RELEASE_MAX_CALLS,
    attempts: [] as Attempt[], failure: null as { code: string; status: number | null } | null,
    summary: null as { objectiveCandidatesCorrect: number; objectiveCandidatesAttempted: number; boundaryCandidatesCorrect: number; boundaryCandidatesAttempted: number; evidenceReviewFlagged: number; providerFailures: number; resolvedObjectiveSelections: number; conservativeObjectiveAbstentions: number } | null,
    limitations: [
      'Four original synthetic fixtures, not a general assessment accuracy estimate.',
      'Uses the production analysis and comparison path; browser capture, login and device behavior are not tested here.',
      'Candidate correctness and published selections are reported separately. Correct candidates can remain unselected when source evidence differs.',
      'Bounded evidence rubrics may flag valid paraphrases and require review; passing is not proof of semantic correctness.',
      'Only existing brief answers and cited evidence from original fixtures are reported; no hidden reasoning, provider error bodies or credentials.',
    ],
  }
  mkdirSync('public', { recursive: true })
  const save = () => writeFileSync('public/aptitude-readiness.json', JSON.stringify(report, null, 2) + '\n')
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 110_000)
  const interrupt = () => { controller.abort(); report.phase = 'interrupted'; save() }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  save()
  try {
    // Preview is an explicit deployment opt-in; the flag alone cannot enable local/CI calls.
    if (aptitudeReleaseEnvironment(process.env) === null) throw new Error('Enabled deployment release check required')
    const candidates = configuredAptitudeComparisonModels(process.env)
    const modelIds = candidates.map(candidate => candidate.id)
    report.configuredModels = modelIds
    report.configuredModelDetails = candidates.map(({ id, model, provider }) => ({ id, model, provider }))
    const plan = planAptitudeEvaluation({ APTITUDE_EVAL_STRATEGY: 'compare', APTITUDE_EVAL_MODELS: modelIds.join(','),
      APTITUDE_EVAL_MAX_CALLS: String(APTITUDE_RELEASE_MAX_CALLS), APTITUDE_EVAL_REPEATS: '1' }, fixtures.length)
    if (plan.plannedCalls !== fixtures.length * candidates.length) throw new Error('Unexpected release call plan')
    report.plannedCalls = plan.plannedCalls
    const budget = new AptitudeEvaluationCallGuard(plan)
    const env = { ...process.env, APTITUDE_COMPARISON_MODELS: modelIds.join(','), APTITUDE_FALLBACK_MODELS: '' }
    const rendered = await Promise.all(fixtures.map(async fixture => ({ fixture, ...await renderAptitudeFixture(fixture) })))
    report.phase = 'analysis'; save()
    for (const [index, { fixture, png, sha256 }] of rendered.entries()) {
      controller.signal.throwIfAborted()
      const attempt: Attempt = { fixtureId: fixture.id, expectedStatus: fixture.expected.status, imageHash: sha256,
        durationMs: null, calls: [], check: null, candidates: [], error: null }
      report.attempts.push(attempt); save()
      const started = performance.now()
      const reserve = budget.attempt(plan.arms[0])
      try {
        const result: AptitudeResult = await analyzeAptitude({
          captureId: `release-${index + 1}`, questionVersion: index + 1, category: 'auto', strategy: 'compare',
          image: `data:image/png;base64,${png.toString('base64')}`,
        }, controller.signal, {
          env,
          transport: async input => {
            // Reserve before any SDK call. This rejects duplicate model attempts,
            // fallbacks and any call beyond the configured plan (at most twelve).
            // Production SDK retries are disabled.
            reserve(input.candidate.id)
            report.callsStarted = budget.callsStarted
            report.liveModel = true
            const call: Call = { modelId: input.candidate.id, requestedModel: input.candidate.model, returnedModel: null,
              provider: input.candidate.provider, outcome: 'running', validated: null, durationMs: null,
              inputTokens: null, outputTokens: null, error: null, validationDiagnostic: null }
            attempt.calls.push(call); save()
            const callStarted = performance.now()
            try {
              const reply = await defaultAptitudeTransport(input)
              call.returnedModel = /^[A-Za-z0-9._:/-]{1,200}$/.test(reply.model) ? reply.model : 'INVALID_MODEL_ID'
              call.inputTokens = tokenCount(reply.inputTokens); call.outputTokens = tokenCount(reply.outputTokens)
              call.outcome = 'returned'
              // Inspect without changing, repairing, rejecting or replacing the reply.
              // The production analyzer below still performs its own normal validation.
              call.validationDiagnostic = inspectAptitudeReleaseReply(reply.text)
              return reply
            } catch (error) {
              call.outcome = 'error'; call.error = safeAptitudeProviderError(error, input.signal.aborted)
              throw error
            } finally { call.durationMs = Math.round(performance.now() - callStarted); save() }
          },
          onAttempt: event => {
            const call = attempt.calls.find(call => call.requestedModel === event.requestedModel && call.provider === event.provider)
            if (call) {
              call.validated = event.completed
              if (!event.completed && call.outcome === 'returned' && !call.error) call.error = { code: 'INVALID_MODEL_OUTPUT', status: null }
              save()
            }
          },
        })
        attempt.check = assessAptitudeReleaseFixture(fixture, result, modelIds, sha256)
        attempt.candidates = (result.comparison?.candidates ?? []).map(briefCandidate)
      } catch (error) { attempt.error = safeAptitudeProviderError(error, controller.signal.aborted) }
      finally {
        attempt.durationMs = Math.round(performance.now() - started); save()
        log('fixture', { fixtureId: attempt.fixtureId }, { passed: attempt.check?.passed ?? false,
          failures: attempt.check?.failures ?? [], error: attempt.error, durationMs: attempt.durationMs,
          conservativeAbstention: attempt.check?.conservativeAbstention ?? false })
        const loggedModels = new Set([...attempt.calls.map(call => call.modelId), ...attempt.candidates.map(candidate => candidate.modelId)])
        for (const modelId of loggedModels) {
          const context = { fixtureId: attempt.fixtureId, modelId }
          const candidate = attempt.candidates.find(candidate => candidate.modelId === modelId)
          const check = attempt.check?.candidates.find(candidate => candidate.modelId === modelId)
          const answer = candidate?.answer
          log('candidate', context, { calls: attempt.calls.filter(call => call.modelId === modelId),
            status: candidate?.status ?? null, observationStatus: candidate?.observationStatus ?? null,
            answer: answer ? { labels: answer.labels, value: answer.value, summary: answer.summary,
              calculation: answer.calculation, numericPattern: answer.numericPattern } : null })
          log('score', context, { passed: check?.passed ?? false,
            failures: attempt.check?.failures.filter(failure => failure.modelId === modelId) ?? [], score: check?.score ?? null })
          // Only schema-validated, displayed evidence and worked steps for original fixtures.
          // Separate events preserve each item and its model even when a later item is long.
          answer?.evidence.forEach((text, index) => log('evidence', { ...context, item: index + 1 }, { text }))
          answer?.workedExplanation.forEach((text, index) => log('explanation', { ...context, item: index + 1 }, { text }))
        }
      }
    }
    const objective = report.attempts.filter(attempt => attempt.expectedStatus === 'solved')
    const boundary = report.attempts.filter(attempt => attempt.expectedStatus !== 'solved')
    report.summary = {
      objectiveCandidatesCorrect: objective.reduce((sum, attempt) => sum + (attempt.check?.candidates.filter(candidate => candidate.score?.answerCorrect).length ?? 0), 0),
      objectiveCandidatesAttempted: objective.length * candidates.length,
      boundaryCandidatesCorrect: boundary.reduce((sum, attempt) => sum + (attempt.check?.candidates.filter(candidate => candidate.score?.answerCorrect).length ?? 0), 0),
      boundaryCandidatesAttempted: boundary.length * candidates.length,
      evidenceReviewFlagged: report.attempts.reduce((sum, attempt) => sum + (attempt.check?.candidates.filter(candidate => candidate.score?.evidenceReview?.reviewRequired).length ?? 0), 0),
      providerFailures: report.attempts.reduce((sum, attempt) => sum + attempt.calls.filter(call => call.outcome !== 'returned' || call.validated !== true).length, 0),
      resolvedObjectiveSelections: objective.filter(attempt => attempt.check?.selectionResolved).length,
      conservativeObjectiveAbstentions: objective.filter(attempt => attempt.check?.conservativeAbstention).length,
    }
    report.complete = report.attempts.length === fixtures.length && report.callsStarted === plan.plannedCalls
      && report.attempts.every(attempt => attempt.calls.length === candidates.length && attempt.calls.every(call => call.outcome !== 'running'))
    report.passed = report.complete && report.attempts.every(attempt => attempt.check?.passed === true && !attempt.error
      && attempt.calls.every(call => call.outcome === 'returned' && call.validated === true && call.error === null))
    report.phase = report.passed ? 'complete' : 'failed'
  } catch (error) {
    report.failure ??= safeAptitudeProviderError(error, controller.signal.aborted)
    report.phase = controller.signal.aborted ? 'interrupted' : 'failed'
  } finally {
    clearTimeout(deadline); controller.abort(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    report.finishedAt = new Date().toISOString(); save()
    log('summary', {}, { passed: report.passed, complete: report.complete, phase: report.phase,
      environment: report.environment, configuredModels: report.configuredModels, commit: report.commit, plannedCalls: report.plannedCalls, callsStarted: report.callsStarted,
      summary: report.summary, failure: report.failure, report: '/aptitude-readiness.json' })
  }
  expect(report.passed, 'Aptitude release check failed. Inspect safe fixture logs and public/aptitude-readiness.json; no automatic retry was made.').toBe(true)
})
