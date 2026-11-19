import { mkdir, readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { analyzeAptitude, defaultAptitudeTransport } from '@/lib/aptitude/analyze'
import { aptitudeModel, configuredAptitudeModels } from '@/lib/aptitude/modelPolicy'
import type { AptitudeResult } from '@/lib/aptitude/schema'
import { APTITUDE_FIXTURES } from './fixtures'
import { prepareAptitudeFixtures } from './manifest'
import { AptitudeEvaluationCallGuard, planAptitudeEvaluation, type EvaluationStrategy } from './evaluationPlan'
import { aggregateAptitudeAttempts, type ScoredEvaluationAttempt } from './evaluationReport'
import { scoreAptitude, scoreAptitudeComparison } from './score'
import { selectAptitudeFixtures } from './selectFixtures'

type ProviderCall = {
  modelId: string
  requestedModel: string
  provider: string
  outcome: 'running' | 'returned' | 'error' | 'aborted'
  model: string | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  validated: boolean | null
  errorCode: string | null
}
type Attempt = ScoredEvaluationAttempt & {
  fixtureId: string; split: string; category: string; imageHash: string
  armId: string; strategy: EvaluationStrategy; requestedModels: string[]; repeat: number
  model: string | null; inputTokens: number | null; outputTokens: number | null
  calls: ProviderCall[]; errorCode: string | null; result: AptitudeResult | null
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code).slice(0, 100) : 'ANALYSIS_ERROR'
}
function knownTotal(calls: ProviderCall[], field: 'inputTokens' | 'outputTokens'): number | null {
  return calls.length && calls.every(call => call[field] !== null)
    ? calls.reduce((sum, call) => sum + call[field]!, 0) : null
}

it.skipIf(process.env.APTITUDE_EVAL_LIVE !== '1')('run bounded, image-grounded live aptitude evaluation', async () => {
  const fixtures = selectAptitudeFixtures(APTITUDE_FIXTURES, process.env.APTITUDE_EVAL_FIXTURES)
  const plan = planAptitudeEvaluation(process.env, fixtures.length)
  // Validate every explicitly selected model and credential before the first call.
  for (const id of plan.modelIds) {
    aptitudeModel(id)
    configuredAptitudeModels({ ...process.env, APTITUDE_MODEL: id, APTITUDE_FALLBACK_MODELS: '' })
  }
  if (!process.env.APTITUDE_EVAL_MANIFEST) throw new Error('Prepare and inspect the owned screenshots, then set APTITUDE_EVAL_MANIFEST to their manifest.json path.')
  const { rendered, manifest } = await prepareAptitudeFixtures()
  const approvedManifest: unknown = JSON.parse(await readFile(resolve(process.env.APTITUDE_EVAL_MANIFEST), 'utf8'))
  if (JSON.stringify(approvedManifest) !== JSON.stringify(manifest)) throw new Error('Fixture, prompt, schema or rendered image hashes differ from the supplied manifest. Prepare and inspect a new manifest.')
  const directory = resolve('benchmark-results', `aptitude-${plan.strategy}-${new Date().toISOString().replaceAll(':', '-')}`)
  await mkdir(directory, { recursive: true })
  const reportPath = resolve(directory, 'report.json')
  const attempts: Attempt[] = []
  const budget = new AptitudeEvaluationCallGuard(plan)
  const report = {
    version: 3, kind: 'live-aptitude-evaluation', complete: false, aborted: false, ...plan, fixtureIds: fixtures.map(fixture => fixture.id), callsStarted: 0,
    startedAt: new Date().toISOString(), finishedAt: null as string | null, manifest, attempts, aggregates: [] as unknown[],
    limitations: [
      'Owned synthetic pilot only; not a validation of real assessment performance.',
      'Agreement or majority is not correctness: correlated wrong answers are scored against the fixture answer key.',
      'No price estimate: token counts are actual when returned, otherwise null. Failed or cancelled calls can still incur provider charges.',
      'Comparison wall-clock duration is measured independently of per-provider duration and total usage; parallel calls are not free.',
      'Critical-text coverage is a diagnostic, not semantic or OCR accuracy.',
      'Evidence-review rubrics flag known visual/rationale failure modes for human review. Passing them is not proof of semantic correctness.',
      'The harness scores the production selector; it does not tune the selector, use answer keys to choose an answer, or select a deployment model.',
    ],
  }
  const checkpoint = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  const controller = new AbortController()
  let active: Attempt | undefined
  const interrupt = () => {
    report.aborted = true
    if (active?.outcome === 'running') { active.outcome = 'aborted'; active.errorCode = 'INTERRUPTED' }
    checkpoint()
    controller.abort()
  }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  checkpoint()
  try {
    const selectedIds = new Set(fixtures.map(fixture => fixture.id))
    outer: for (const arm of plan.arms) for (let repeat = 1; repeat <= plan.repeats; repeat++) for (const { fixture, png, sha256 } of rendered.filter(item => selectedIds.has(item.fixture.id))) {
      if (controller.signal.aborted) break outer
      const attempt: Attempt = {
        fixtureId: fixture.id, split: fixture.split, category: fixture.expected.category, expectedStatus: fixture.expected.status,
        imageHash: sha256, armId: arm.id, strategy: arm.strategy, requestedModels: arm.modelIds, repeat,
        outcome: 'running', model: null, durationMs: null, inputTokens: null, outputTokens: null,
        calls: [], errorCode: null, result: null, score: null, comparisonScore: null,
      }
      attempts.push(attempt); active = attempt; checkpoint()
      const started = performance.now()
      const reserveCall = budget.attempt(arm)
      try {
        // Production receives only the image, neutral revision, strategy, and category=auto.
        // Fixture IDs, splits, categories and answer keys never enter a provider prompt.
        const result = await analyzeAptitude({
          captureId: `eval-${attempts.length}`, questionVersion: attempts.length, category: 'auto', strategy: arm.strategy,
          image: `data:image/png;base64,${png.toString('base64')}`,
        }, controller.signal, {
          env: {
            ...process.env, APTITUDE_MODEL: arm.modelIds[0], APTITUDE_FALLBACK_MODELS: '',
            APTITUDE_COMPARISON_MODELS: arm.strategy === 'compare' ? arm.modelIds.join(',') : '',
          },
          transport: async input => {
            reserveCall(input.candidate.id)
            report.callsStarted = budget.callsStarted
            const call: ProviderCall = {
              modelId: input.candidate.id, requestedModel: input.candidate.model, provider: input.candidate.provider,
              outcome: 'running', model: null, durationMs: null, inputTokens: null, outputTokens: null, validated: null, errorCode: null,
            }
            attempt.calls.push(call); checkpoint()
            const callStarted = performance.now()
            try {
              const reply = await defaultAptitudeTransport(input)
              call.model = reply.model; call.inputTokens = reply.inputTokens ?? null; call.outputTokens = reply.outputTokens ?? null
              call.outcome = 'returned'
              return reply
            } catch (error) {
              call.outcome = input.signal.aborted ? 'aborted' : 'error'
              call.errorCode = errorCode(error)
              throw error
            } finally {
              call.durationMs = Math.round(performance.now() - callStarted)
              checkpoint()
            }
          },
          onAttempt: event => {
            const call = attempt.calls.find(item => item.requestedModel === event.requestedModel && item.provider === event.provider)
            if (call) call.validated = event.completed
          },
        })
        attempt.result = result; attempt.score = scoreAptitude(fixture, result)
        attempt.comparisonScore = scoreAptitudeComparison(fixture, result)
        attempt.model = result.model; attempt.outcome = 'complete'
      } catch (error) {
        attempt.outcome = controller.signal.aborted ? 'aborted' : 'error'
        attempt.errorCode = errorCode(error)
      } finally {
        attempt.durationMs = Math.round(performance.now() - started)
        attempt.inputTokens = knownTotal(attempt.calls, 'inputTokens')
        attempt.outputTokens = knownTotal(attempt.calls, 'outputTokens')
        checkpoint(); active = undefined
      }
    }
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    report.complete = !report.aborted && attempts.length === plan.plannedAttempts
      && attempts.every(attempt => attempt.outcome !== 'running' && attempt.outcome !== 'aborted' && attempt.calls.every(call => call.outcome !== 'running'))
    report.finishedAt = new Date().toISOString()
    report.aggregates = plan.arms.flatMap(arm => ['all', 'development', 'held_out'].map(split => ({
      armId: arm.id, strategy: arm.strategy, models: arm.modelIds, split,
      ...aggregateAptitudeAttempts(attempts.filter(attempt => attempt.armId === arm.id && (split === 'all' || attempt.split === split))),
    })))
    checkpoint()
  }
  console.info(`Live evaluation report: ${reportPath}. Completed ${attempts.length}/${plan.plannedAttempts} planned question attempts; started ${report.callsStarted}/${plan.plannedCalls} planned provider calls (cap ${plan.maxCalls}).`)
  expect(report.complete, 'Interrupted/incomplete runs must not be reported as complete. Inspect the checkpoint.').toBe(true)
}, 3_600_000)
