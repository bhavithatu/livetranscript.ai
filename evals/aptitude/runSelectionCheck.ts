import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { analyzeAptitude, defaultAptitudeTransport } from '@/lib/aptitude/analyze'
import { configuredAptitudeModels } from '@/lib/aptitude/modelPolicy'
import { APTITUDE_SYSTEM_PROMPT } from '@/lib/aptitude/prompt'
import { APTITUDE_OBSERVATION_JSON_SCHEMA, parseAptitudeObservation, type AptitudeObservation, type AptitudeResult, type AptitudeVerification } from '@/lib/aptitude/schema'
import { AptitudeEvaluationCallGuard } from './evaluationPlan'
import { aggregateAptitudeAttempts, type ScoredEvaluationAttempt } from './evaluationReport'
import { inspectAptitudeReleaseReply, safeAptitudeProviderError, type AptitudeReleaseReplyDiagnostic } from './releaseGate'
import { aptitudeReleaseLogLines } from './releaseLogging'
import { APTITUDE_SELECTION_FIXTURES, APTITUDE_SELECTION_FIXTURE_HASH, renderSelectionFixture } from './selectionFixtures'
import { APTITUDE_SELECTION_MAX_CALLS, planAptitudeSelection, selectionCollectionStatus } from './selectionPlan'
import { scoreSelectionFixture } from './selectionScoring'
import { aptitudeSelectionEnvironment } from '../../scripts/aptitude-selection-environment.mjs'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const log = (...input: Parameters<typeof aptitudeReleaseLogLines>) => aptitudeReleaseLogLines(...input)
  .map(line => line.replace('[aptitude-release-', '[aptitude-selection-')).forEach(line => console.info(line))
type SafeError = ReturnType<typeof safeAptitudeProviderError>
type Attempt = ScoredEvaluationAttempt & {
  fixtureId: string; domain: string; modelId: string; imageHash: string;
  requestedModel: string | null; returnedModel: string | null; provider: string | null;
  inputTokens: number | null; outputTokens: number | null; providerDurationMs: number | null;
  callStarted: boolean; validated: boolean; diagnostic: AptitudeReleaseReplyDiagnostic | null;
  error: SafeError | null; sourceImageMatches: boolean | null;
  gridInventoryCorrect: boolean | null; evidenceReviewRequired: boolean;
  /** Original authored fixtures only: preserve the structured answer before local checks. */
  providerObservation: AptitudeObservation | null;
  verification: AptitudeVerification | null; message: string | null;
  answer: { status: string; labels: string[]; value: string | null; summary: string | null;
    confidence: number | null; evidence: string[]; workedExplanation: string[] } | null;
}

it.skipIf(aptitudeSelectionEnvironment(process.env) === null)('collects the frozen selection suite without hiding incorrect answers or adding calls', async () => {
  const environment = aptitudeSelectionEnvironment(process.env)
  const commit = process.env.VERCEL_GIT_COMMIT_SHA
  const report = {
    version: 1, scope: 'original-aptitude-model-selection', environment,
    commit: commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null,
    liveModel: false, deviceVerified: false, complete: false, operationallyPassed: false,
    phase: 'configuration', startedAt: new Date().toISOString(), finishedAt: null as string | null,
    fixtureHash: APTITUDE_SELECTION_FIXTURE_HASH, promptHash: hash(APTITUDE_SYSTEM_PROMPT),
    schemaHash: hash(JSON.stringify(APTITUDE_OBSERVATION_JSON_SCHEMA)),
    configuredModels: [] as string[], fixtureIds: APTITUDE_SELECTION_FIXTURES.map(fixture => fixture.id),
    plannedCalls: 0, callsStarted: 0, maxCalls: APTITUDE_SELECTION_MAX_CALLS,
    attempts: [] as Attempt[], aggregates: [] as unknown[], failure: null as SafeError | null,
    automaticModelPromotion: false, comparisonSelectionEvaluated: false,
    limitations: [
      'Twelve original regression scenarios: ten objective questions and two boundaries. Previously used for model selection; not a fresh holdout or a general accuracy estimate.',
      'Frozen before the first model run. Once used to select models or tune prompts, these examples are no longer an untouched validation set.',
      'All models receive the same screenshot and generic prompt. Answer keys, fixture IDs and expected categories never enter provider requests.',
      'Wrong answers and unnecessary abstentions are scored without stopping collection; provider/schema/plumbing failures fail the build after collection.',
      'Single-model arms only. No automatic best-answer judge, comparison selection or production model promotion is performed.',
      'Actual returned token counts are recorded; missing usage remains unknown. No price estimate or hidden retry is used.',
      'Evidence checks cover authored grid coordinates and available numeric calculations; they do not establish correctness of every explanation.',
    ],
  }
  mkdirSync('public', { recursive: true })
  const save = () => writeFileSync('public/aptitude-model-selection.json', JSON.stringify(report, null, 2) + '\n')
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 330_000)
  const interrupted = () => { controller.abort(); report.phase = 'interrupted'; save() }
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted)
  save()
  try {
    if (environment === null) throw new Error('Commit-bound deployment selection is required')
    const plan = planAptitudeSelection(process.env)
    report.configuredModels = plan.modelIds; report.plannedCalls = plan.plannedCalls; report.maxCalls = plan.maxCalls
    // Validate every selected provider configuration before beginning any paid work.
    for (const id of plan.modelIds) configuredAptitudeModels({ ...process.env, APTITUDE_MODEL: id, APTITUDE_FALLBACK_MODELS: '' })
    const rendered = await Promise.all(APTITUDE_SELECTION_FIXTURES.map(async fixture => ({ fixture, ...await renderSelectionFixture(fixture) })))
    const budget = new AptitudeEvaluationCallGuard(plan)
    report.phase = 'analysis'; save()
    for (const [index, { fixture, png, sha256 }] of rendered.entries()) {
      controller.signal.throwIfAborted()
      // At most three requests run together. All see identical bytes; each has its own bounded production call.
      await Promise.all(plan.arms.map(async arm => {
        const attempt: Attempt = {
          fixtureId: fixture.id, domain: fixture.domain, modelId: arm.modelIds[0], expectedStatus: fixture.expected.status,
          imageHash: sha256, requestedModel: null, returnedModel: null, provider: null,
          inputTokens: null, outputTokens: null, providerDurationMs: null, durationMs: null,
          outcome: 'running', callStarted: false, validated: false, diagnostic: null, error: null,
          sourceImageMatches: null, score: null, comparisonScore: null, gridInventoryCorrect: null,
          evidenceReviewRequired: false, answer: null, providerObservation: null, verification: null, message: null,
        }
        report.attempts.push(attempt); save()
        const started = performance.now(), reserve = budget.attempt(arm)
        try {
          const result: AptitudeResult = await analyzeAptitude({
            captureId: `selection-${index + 1}`, questionVersion: index + 1, category: 'auto', strategy: 'single',
            image: `data:image/png;base64,${png.toString('base64')}`,
          }, controller.signal, {
            env: { ...process.env, APTITUDE_MODEL: arm.modelIds[0], APTITUDE_FALLBACK_MODELS: '', APTITUDE_COMPARISON_MODELS: '' },
            transport: async input => {
              reserve(input.candidate.id)
              report.callsStarted = budget.callsStarted; report.liveModel = true; attempt.callStarted = true
              attempt.requestedModel = input.candidate.model; attempt.provider = input.candidate.provider; save()
              const callStarted = performance.now()
              try {
                const reply = await defaultAptitudeTransport(input)
                attempt.returnedModel = /^[A-Za-z0-9._:/-]{1,200}$/.test(reply.model) ? reply.model : 'INVALID_MODEL_ID'
                attempt.inputTokens = count(reply.inputTokens); attempt.outputTokens = count(reply.outputTokens)
                attempt.diagnostic = inspectAptitudeReleaseReply(reply.text)
                // This runner only sends our original practice fixtures. Retain schema-validated
                // visible answers, never provider thinking blocks, credentials or user captures.
                try { attempt.providerObservation = parseAptitudeObservation(JSON.parse(reply.text)) } catch { /* Diagnostic records the invalid schema. */ }
                return reply
              } catch (error) {
                attempt.error = safeAptitudeProviderError(error, input.signal.aborted)
                throw error
              } finally { attempt.providerDurationMs = Math.round(performance.now() - callStarted); save() }
            },
            onAttempt: event => { attempt.validated = event.completed; save() },
          })
          attempt.sourceImageMatches = result.sourceHash === sha256
          const score = scoreSelectionFixture(fixture, result)
          attempt.score = score; attempt.gridInventoryCorrect = score.gridInventoryCorrect
          attempt.evidenceReviewRequired = score.evidenceReviewRequired
          attempt.verification = result.verification; attempt.message = result.message
          attempt.answer = {
            status: result.status,
            labels: (result.answer?.selectedOptionIds ?? []).map(id => result.question?.options.find(option => option.id === id)?.label ?? ''),
            value: result.answer?.value?.slice(0, 100) ?? null, summary: result.answer?.summary.slice(0, 400) ?? null,
            confidence: result.answer?.confidence ?? null,
            evidence: result.answer?.evidence.map(value => value.slice(0, 2_000)) ?? [],
            workedExplanation: result.answer?.workedExplanation.map(value => value.slice(0, 2_000)) ?? [],
          }
          attempt.outcome = 'complete'
          if (!attempt.sourceImageMatches) attempt.error = { code: 'SOURCE_IMAGE_MISMATCH', status: null }
        } catch (error) {
          attempt.outcome = controller.signal.aborted ? 'aborted' : 'error'
          attempt.error ??= safeAptitudeProviderError(error, controller.signal.aborted)
        } finally {
          attempt.durationMs = Math.round(performance.now() - started); save()
          const context = { fixtureId: fixture.id, modelId: attempt.modelId }
          log('candidate', context, {
            requestedModel: attempt.requestedModel, returnedModel: attempt.returnedModel, provider: attempt.provider,
            outcome: attempt.outcome, durationMs: attempt.durationMs, providerDurationMs: attempt.providerDurationMs,
            inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens, validated: attempt.validated,
            diagnostic: attempt.diagnostic, error: attempt.error, sourceImageMatches: attempt.sourceImageMatches,
            answer: attempt.answer && { status: attempt.answer.status, labels: attempt.answer.labels, value: attempt.answer.value, summary: attempt.answer.summary, confidence: attempt.answer.confidence },
            providerObservation: attempt.providerObservation, verification: attempt.verification, message: attempt.message,
          })
          log('score', context, { score: attempt.score, gridInventoryCorrect: attempt.gridInventoryCorrect, evidenceReviewRequired: attempt.evidenceReviewRequired })
          attempt.answer?.evidence.forEach((text, item) => log('evidence', { ...context, item: item + 1 }, { text }))
          attempt.answer?.workedExplanation.forEach((text, item) => log('explanation', { ...context, item: item + 1 }, { text }))
        }
      }))
    }
    const collectionStatus = selectionCollectionStatus(report.attempts, report.callsStarted, plan)
    report.complete = collectionStatus.complete
    report.aggregates = plan.modelIds.map(modelId => {
      const attempts = report.attempts.filter(attempt => attempt.modelId === modelId)
      const total = (field: 'inputTokens' | 'outputTokens') => attempts.every(attempt => attempt[field] !== null)
        ? attempts.reduce((sum, attempt) => sum + attempt[field]!, 0) : null
      return { modelId, ...aggregateAptitudeAttempts(attempts),
        objectiveWrongSolvedCount: attempts.filter(attempt => attempt.expectedStatus === 'solved' && attempt.answer?.status === 'solved' && !attempt.score?.answerCorrect).length,
        objectiveUnnecessaryAbstentions: attempts.filter(attempt => attempt.expectedStatus === 'solved' && attempt.outcome === 'complete' && attempt.answer?.status !== 'solved').length,
        evidenceSupportedObjectiveCorrect: attempts.filter(attempt => attempt.expectedStatus === 'solved' && attempt.score?.answerCorrect && !attempt.evidenceReviewRequired).length,
        evidenceReviewFlagged: attempts.filter(attempt => attempt.evidenceReviewRequired).length,
        gridInventoriesCorrect: attempts.filter(attempt => attempt.gridInventoryCorrect === true).length,
        gridInventoriesAttempted: attempts.filter(attempt => attempt.gridInventoryCorrect !== null).length,
        inputTokens: total('inputTokens'), outputTokens: total('outputTokens') }
    })
    report.operationallyPassed = collectionStatus.operationallyPassed
    report.phase = report.operationallyPassed ? 'complete' : 'failed'
  } catch (error) {
    report.failure = safeAptitudeProviderError(error, controller.signal.aborted)
    report.phase = controller.signal.aborted ? 'interrupted' : 'failed'
  } finally {
    clearTimeout(deadline); controller.abort(); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
    report.finishedAt = new Date().toISOString(); save()
    log('summary', {}, { environment: report.environment, commit: report.commit, complete: report.complete,
      operationallyPassed: report.operationallyPassed, phase: report.phase, configuredModels: report.configuredModels,
      fixtureHash: report.fixtureHash, promptHash: report.promptHash, plannedCalls: report.plannedCalls,
      callsStarted: report.callsStarted, failure: report.failure, aggregates: report.aggregates,
      automaticModelPromotion: false, comparisonSelectionEvaluated: false, report: '/aptitude-model-selection.json' })
  }
  expect(report.operationallyPassed, 'Selection collection had a provider, schema, configuration or source-image error. Inspect the complete report; no automatic retry was made. Wrong answers alone do not fail this collection.').toBe(true)
})
