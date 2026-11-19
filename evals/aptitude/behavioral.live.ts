import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { analyzeAptitude, defaultAptitudeTransport } from '@/lib/aptitude/analyze'
import { configuredAptitudeModels } from '@/lib/aptitude/modelPolicy'
import { APTITUDE_SYSTEM_PROMPT } from '@/lib/aptitude/prompt'
import type { AptitudeObservation } from '@/lib/aptitude/schema'
import { safeAptitudeProviderError } from './releaseGate'
import { BEHAVIORAL_FIXTURE_HASH, BEHAVIORAL_LIVE_FIXTURES, renderBehavioralFixture, scoreBehavioralResponse } from './behavioralFixtures'
import { behavioralCheckEnabled, behavioralCheckPlan } from './behavioralPlan'

type Attempt = { fixtureId: string; modelId: string; returnedModel: string | null; durationMs: number | null;
  sourceImageMatches: boolean; callStarted: boolean; observation: AptitudeObservation | null;
  score: ReturnType<typeof scoreBehavioralResponse> | null; error: ReturnType<typeof safeAptitudeProviderError> | null }
it.skipIf(!behavioralCheckEnabled(process.env))('collects six bounded original behavioral responses without hidden retries', async () => {
  const report = { version: 1, scope: 'original-behavioral-format-and-boundary-check', environment: 'preview',
    commit: /^[a-f0-9]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '') ? process.env.VERCEL_GIT_COMMIT_SHA : null,
    promptHash: createHash('sha256').update(APTITUDE_SYSTEM_PROMPT).digest('hex'), fixtureHash: BEHAVIORAL_FIXTURE_HASH,
    startedAt: new Date().toISOString(), finishedAt: null as string | null, liveModel: false, deviceVerified: false,
    complete: false, operationallyPassed: false, formatAndBoundaryPassed: false,
    callsStarted: 0, plannedCalls: 6, maxCalls: 6, modelIds: [] as string[], attempts: [] as Attempt[],
    failure: null as ReturnType<typeof safeAptitudeProviderError> | null,
    limitations: ['Three authored scenarios and two providers; this is not a broad accuracy estimate or an employer scoring key.',
      'Conditional wording, visible-choice references and tentative assessment intent are lexical checks, not a semantic guarantee. Review all complete behavioral advice manually.',
      'No user captures, traits, selected answers, secrets, raw provider errors or private reasoning are included.',
      'Quality failures are recorded without stopping collection; no automatic model promotion or retries.'],
  }
  mkdirSync('public', { recursive: true })
  const save = () => writeFileSync('public/behavioral-readiness.json', JSON.stringify(report, null, 2) + '\n')
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 165_000)
  const interrupted = () => { controller.abort(); save() }
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted)
  save()
  try {
    const plan = behavioralCheckPlan(process.env)
    report.modelIds = plan.modelIds
    for (const id of plan.modelIds) configuredAptitudeModels({ ...process.env, APTITUDE_MODEL: id, APTITUDE_FALLBACK_MODELS: '' })
    const rendered = await Promise.all(BEHAVIORAL_LIVE_FIXTURES.map(async fixture => ({ fixture, ...await renderBehavioralFixture(fixture) })))
    for (const [index, { fixture, png, sha256 }] of rendered.entries()) {
      controller.signal.throwIfAborted()
      await Promise.all(plan.modelIds.map(async modelId => {
        const attempt: Attempt = { fixtureId: fixture.id, modelId, returnedModel: null, durationMs: null,
          sourceImageMatches: false, callStarted: false, observation: null, score: null, error: null }
        report.attempts.push(attempt); save()
        const start = performance.now()
        try {
          const result = await analyzeAptitude({ captureId: `behavioral-${index + 1}`, questionVersion: index + 1,
            image: `data:image/png;base64,${png.toString('base64')}`, category: 'auto', strategy: 'single' }, controller.signal, {
            env: { ...process.env, APTITUDE_MODEL: modelId, APTITUDE_FALLBACK_MODELS: '', APTITUDE_COMPARISON_MODELS: '' },
            transport: async input => {
              if (attempt.callStarted || report.callsStarted >= plan.maxCalls || input.candidate.id !== modelId) throw new Error('Call budget or model mismatch')
              attempt.callStarted = true; report.callsStarted++; report.liveModel = true; save()
              try { return await defaultAptitudeTransport(input) }
              catch (error) { attempt.error = safeAptitudeProviderError(error, input.signal.aborted); throw error }
            },
          })
          attempt.returnedModel = result.model && /^[A-Za-z0-9._:/-]{1,200}$/.test(result.model) ? result.model : null
          attempt.sourceImageMatches = result.sourceHash === sha256
          if (result.status !== 'error') {
            attempt.observation = { category: result.category, status: result.status, question: result.question, answer: result.answer, message: result.message }
            attempt.score = scoreBehavioralResponse(fixture, attempt.observation)
          }
          if (!attempt.sourceImageMatches) attempt.error = { code: 'SOURCE_IMAGE_MISMATCH', status: null }
        } catch (error) { attempt.error ??= safeAptitudeProviderError(error, controller.signal.aborted) }
        finally { attempt.durationMs = Math.round(performance.now() - start); save() }
      }))
    }
    report.complete = report.callsStarted === plan.plannedCalls && report.attempts.length === plan.plannedCalls
    report.operationallyPassed = report.complete && report.attempts.every(a => a.callStarted && !a.error && a.sourceImageMatches && a.score?.schemaValid)
    report.formatAndBoundaryPassed = report.operationallyPassed && report.attempts.every(a => a.score?.formatAndBoundaryPassed)
  } catch (error) { report.failure = safeAptitudeProviderError(error, controller.signal.aborted) }
  finally {
    clearTimeout(deadline); controller.abort(); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
    report.finishedAt = new Date().toISOString(); save()
    console.info('[behavioral-check-report]', JSON.stringify(report))
  }
  expect(report.operationallyPassed, 'Behavioral collection had provider, configuration, schema or source-image failures; inspect behavioral-readiness.json. Quality failures are reported separately.').toBe(true)
})
