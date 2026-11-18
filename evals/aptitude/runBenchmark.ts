import { mkdir, readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { analyzeAptitude, defaultAptitudeTransport, type AptitudeProviderReply } from '@/lib/aptitude/analyze'
import { aptitudeModel, configuredAptitudeModels } from '@/lib/aptitude/modelPolicy'
import type { AptitudeResult } from '@/lib/aptitude/schema'
import { prepareAptitudeFixtures } from './manifest'
import { percentile, scoreAptitude, type AptitudeScore } from './score'

type Attempt = { fixtureId: string; split: string; category: string; imageHash: string; requestedModel: string; repeat: number;
  outcome: 'running' | 'complete' | 'error' | 'aborted'; model: string | null; durationMs: number | null; inputTokens: number | null; outputTokens: number | null;
  errorCode: string | null; result: AptitudeResult | null; score: AptitudeScore | null }

function integer(value: string | undefined, name: string, max: number): number {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error(`${name} must explicitly be an integer from 1 to ${max}.`)
  return Number(value)
}

it.skipIf(process.env.APTITUDE_EVAL_LIVE !== '1')('run bounded, image-grounded live aptitude evaluation', async () => {
  const maxCalls = integer(process.env.APTITUDE_EVAL_MAX_CALLS, 'APTITUDE_EVAL_MAX_CALLS', 100)
  const repeats = integer(process.env.APTITUDE_EVAL_REPEATS ?? '1', 'APTITUDE_EVAL_REPEATS', 3)
  const modelIds = [...new Set((process.env.APTITUDE_EVAL_MODELS ?? '').split(',').map(value => value.trim()).filter(Boolean))]
  if (!modelIds.length) throw new Error('Set APTITUDE_EVAL_MODELS to an explicit comma-separated aptitude model allowlist selection.')
  for (const id of modelIds) { aptitudeModel(id); configuredAptitudeModels({ ...process.env, APTITUDE_MODEL: id, APTITUDE_FALLBACK_MODELS: '' }) }
  if (!process.env.APTITUDE_EVAL_MANIFEST) throw new Error('Prepare and inspect the owned screenshots, then set APTITUDE_EVAL_MANIFEST to their manifest.json path.')
  const { rendered, manifest } = await prepareAptitudeFixtures()
  const approvedManifest: unknown = JSON.parse(await readFile(resolve(process.env.APTITUDE_EVAL_MANIFEST), 'utf8'))
  if (JSON.stringify(approvedManifest) !== JSON.stringify(manifest)) throw new Error('Fixture, prompt, schema or rendered image hashes differ from the supplied manifest. Prepare and inspect a new manifest.')
  const plannedCalls = modelIds.length * rendered.length * repeats
  if (plannedCalls > maxCalls) throw new Error(`The plan requires ${plannedCalls} calls and exceeds the explicit cap of ${maxCalls}. No calls were made.`)
  const directory = resolve('benchmark-results', `aptitude-${new Date().toISOString().replaceAll(':', '-')}`)
  await mkdir(directory, { recursive: true })
  const reportPath = resolve(directory, 'report.json')
  const attempts: Attempt[] = []
  const report = { version: 1, kind: 'live-aptitude-evaluation', complete: false, aborted: false, plannedCalls, maxCalls, callsStarted: 0,
    startedAt: new Date().toISOString(), finishedAt: null as string | null, manifest, attempts, aggregates: [] as unknown[],
    limitations: ['Owned synthetic pilot only; not a validation of real assessment performance.', 'No price estimate: token counts are actual when returned, otherwise null. Failed or cancelled calls can still incur provider charges.', 'Critical-text coverage is a diagnostic, not semantic or OCR accuracy.', 'No model selection is made by this harness.'] }
  const checkpoint = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  const controller = new AbortController()
  let active: Attempt | undefined
  const interrupt = () => { report.aborted = true; if (active?.outcome === 'running') { active.outcome = 'aborted'; active.errorCode = 'INTERRUPTED' }; checkpoint(); controller.abort() }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  checkpoint()
  try {
    outer: for (const id of modelIds) for (let repeat = 1; repeat <= repeats; repeat++) for (const { fixture, png, sha256 } of rendered) {
      if (controller.signal.aborted) break outer
      const attempt: Attempt = { fixtureId: fixture.id, split: fixture.split, category: fixture.expected.category, imageHash: sha256, requestedModel: id, repeat,
        outcome: 'running', model: null, durationMs: null, inputTokens: null, outputTokens: null, errorCode: null, result: null, score: null }
      attempts.push(attempt); active = attempt; checkpoint()
      const started = performance.now()
      let providerReply: AptitudeProviderReply | undefined
      try {
        // Only image + category=auto enter production analysis. No fixture ID, answer key or expected category is supplied.
        const result = await analyzeAptitude({ captureId: `eval-${attempts.length}`, questionVersion: attempts.length, category: 'auto', image: `data:image/png;base64,${png.toString('base64')}` }, controller.signal, {
          env: { ...process.env, APTITUDE_MODEL: id, APTITUDE_FALLBACK_MODELS: '' },
          transport: async input => {
            if (report.callsStarted >= maxCalls) throw new Error('CALL_CAP_REACHED')
            report.callsStarted++; checkpoint()
            providerReply = await defaultAptitudeTransport(input)
            return providerReply
          },
        })
        attempt.result = result; attempt.score = scoreAptitude(fixture, result); attempt.model = result.model; attempt.outcome = 'complete'
      } catch (error) {
        attempt.outcome = controller.signal.aborted ? 'aborted' : 'error'
        attempt.errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'ANALYSIS_ERROR'
      } finally {
        attempt.durationMs = Math.round(performance.now() - started)
        attempt.inputTokens = providerReply?.inputTokens ?? null; attempt.outputTokens = providerReply?.outputTokens ?? null
        attempt.model ??= providerReply?.model ?? null
        checkpoint(); active = undefined
      }
    }
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    report.complete = !report.aborted && attempts.length === plannedCalls && attempts.every(attempt => attempt.outcome !== 'running' && attempt.outcome !== 'aborted')
    report.finishedAt = new Date().toISOString()
    report.aggregates = modelIds.flatMap(id => ['all', 'development', 'held_out'].map(split => {
      const group = attempts.filter(attempt => attempt.requestedModel === id && (split === 'all' || attempt.split === split))
      const objective = group.filter(attempt => attempt.score?.shouldAbstain === false)
      const expectedAbstentions = group.filter(attempt => attempt.score?.shouldAbstain === true)
      return { model: id, split, attempted: group.length, completed: group.filter(attempt => attempt.outcome === 'complete').length,
        endToEndCorrect: group.filter(attempt => attempt.score?.answerCorrect).length,
        objectiveAnswersCorrect: objective.filter(attempt => attempt.score?.answerCorrect).length, objectiveScored: objective.length,
        falseCertaintyCount: expectedAbstentions.filter(attempt => attempt.score?.abstained === false).length,
        expectedAbstentionsScored: expectedAbstentions.length,
        p50Ms: percentile(group.map(attempt => attempt.durationMs).filter((n): n is number => n !== null), 0.5),
        p95Ms: percentile(group.map(attempt => attempt.durationMs).filter((n): n is number => n !== null), 0.95) }
    }))
    checkpoint()
  }
  console.info(`Live evaluation report: ${reportPath}. Completed ${attempts.length}/${plannedCalls} planned attempts; started ${report.callsStarted} provider calls.`)
  expect(report.complete, 'Interrupted/incomplete runs must not be reported as complete. Inspect the checkpoint.').toBe(true)
}, 3_600_000)
