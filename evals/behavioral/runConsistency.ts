import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { streamAnswerDirect } from '@/lib/copilot/providers'
import { buildBehavioralSnapshot } from '@/lib/behavioral/session'
import { BEHAVIORAL_CONSISTENCY_FIXTURES } from './fixtures'
import { BehavioralEvaluationCallGuard, evaluationRequest, evaluationSummary, planBehavioralEvaluation, reviewSignals, type BehavioralEvaluationRow } from './evaluation'
import { behavioralReportLogLines, behavioralReportSourceCommit } from './reportLogging'

const ENABLED = process.env.BEHAVIORAL_EVAL_RUN === '1'
const REQUEST_TIMEOUT_MS = 35_000
const MAX_OUTPUT_BYTES = 80_000

async function readComplete(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let bytes = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) { output += decoder.decode(); break }
      bytes += value.byteLength
      if (bytes > MAX_OUTPUT_BYTES) throw new Error('Evaluation output budget exceeded.')
      output += decoder.decode(value, { stream: true })
    }
    if (!output.trim()) throw new Error('Empty model response.')
    return output
  } finally {
    signal.removeEventListener('abort', cancel)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

describe('authored behavioral continuity semantic evaluation', () => {
  it.skipIf(!ENABLED)('collects one bounded, direct provider response per selected case for semantic review', async () => {
    const plan = planBehavioralEvaluation(process.env)
    const keyName = plan.vendor === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
    if (!process.env[keyName]) throw new Error(`The selected provider is not configured (${keyName}). No calls were made.`)
    const guard = new BehavioralEvaluationCallGuard(plan)
    const rows: BehavioralEvaluationRow[] = []
    for (const id of plan.fixtureIds) {
      const fixture = BEHAVIORAL_CONSISTENCY_FIXTURES.find(item => item.id === id)!
      // Validate and freeze the complete request before counting a paid attempt.
      const request = evaluationRequest(fixture, plan.model)
      const evidence = buildBehavioralSnapshot(fixture.round, fixture.question)
      const controller = new AbortController()
      const startedAt = performance.now()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      let answer: string | null = null
      try {
        guard.start(id)
        answer = await readComplete(streamAnswerDirect({ ...request, signal: controller.signal }), controller.signal)
      } catch {
        // Do not dump provider errors, headers, or key material into an artifact.
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
      rows.push({
        fixtureId: id, title: fixture.title, question: fixture.question,
        status: answer === null ? 'failed' : 'complete', answer,
        failure: answer === null ? 'provider_or_stream_failure' : null,
        elapsedMs: Math.round(performance.now() - startedAt), evidence,
        signals: answer === null ? [] : reviewSignals(fixture, answer),
        reviewCriteria: fixture.reviewCriteria,
        semanticReview: { status: 'pending', grounded: null, consistent: null, notes: '' },
      })
    }
    const report = {
      schemaVersion: 1,
      kind: 'authored_behavioral_continuity_regression',
      createdAt: new Date().toISOString(),
      sourceCommit: behavioralReportSourceCommit(process.env),
      model: plan.modelId,
      transport: 'streamAnswerDirect: production provider code, SDK retries disabled, no fallback, no speculative draft',
      independentHoldout: false,
      employerAnswerKeyIncluded: false,
      plan,
      summary: evaluationSummary(plan, rows, guard.callsStarted),
      rows,
    }
    const json = JSON.stringify(report, null, 2)
    if (process.env.BEHAVIORAL_EVAL_REPORT_PATH) {
      const path = resolve(process.env.BEHAVIORAL_EVAL_REPORT_PATH)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${json}\n`, { encoding: 'utf8', flag: 'wx' })
    }
    for (const line of behavioralReportLogLines(report)) console.log(line)
    expect(guard.callsStarted).toBe(plan.plannedCalls)
    expect(report.summary.missingRows).toBe(0)
    expect(report.summary.failed, 'Provider failures are recorded and fail this transport run; semantic review is still separate.').toBe(0)
  }, 240_000)
})
