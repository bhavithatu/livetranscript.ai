import { createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { parseRepoImage } from '@/lib/repo/agentHttp'
import { APTITUDE_OBSERVATION_JSON_SCHEMA, parseAptitudeObservation, parseAptitudeRequest, parseAptitudeResult, type AptitudeComparisonCandidate, type AptitudeRequest, type AptitudeResult } from './schema'
import { APTITUDE_SYSTEM_PROMPT, aptitudeUserPrompt } from './prompt'
import { AptitudeServiceError, configuredAptitudeComparisonModels, configuredAptitudeModels, providerKey, type AptitudeEnvironment, type AptitudeModel } from './modelPolicy'
import { verifyAptitudeObservation } from './verify'
import { validateAptitudeImage } from './image'
import { comparisonReviewQuestion, selectAptitudeComparison } from './comparison'

export type AptitudeProviderReply = { text: string; model: string; inputTokens?: number; outputTokens?: number }
export type AptitudeTransportInput = { candidate: AptitudeModel; request: AptitudeRequest; signal: AbortSignal; env: AptitudeEnvironment }
export type AptitudeTransport = (input: AptitudeTransportInput) => Promise<AptitudeProviderReply>

/** Exactly one image-grounded call per attempt. SDK retries are disabled and no draft path is used. */
export const defaultAptitudeTransport: AptitudeTransport = async ({ candidate, request, signal, env }) => {
  const apiKey = providerKey(candidate, env)
  if (!apiKey) throw new AptitudeServiceError('The selected aptitude provider is not configured.', 503, 'PROVIDER_UNAVAILABLE')
  const settings = candidate.generation
  if (candidate.provider === 'anthropic') {
    const image = parseRepoImage(request.image)
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 25_000 })
    const response = await client.messages.create({
      model: candidate.model, max_tokens: settings.maxOutputTokens, system: APTITUDE_SYSTEM_PROMPT,
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.reasoningEffort ? { thinking: { type: 'adaptive' as const } } : {}),
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: aptitudeUserPrompt(request.category) },
      ] }],
      output_config: { format: { type: 'json_schema', schema: APTITUDE_OBSERVATION_JSON_SCHEMA },
        ...(settings.reasoningEffort ? { effort: settings.reasoningEffort } : {}) },
    }, { signal })
    if (response.stop_reason !== 'end_turn') throw new Error('Incomplete provider response')
    return { text: response.content.filter(block => block.type === 'text').map(block => block.text).join(''), model: response.model,
      inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
  }
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 25_000 })
  const response = await client.chat.completions.create({
    model: candidate.model, max_completion_tokens: settings.maxOutputTokens,
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
    messages: [{ role: 'system', content: APTITUDE_SYSTEM_PROMPT }, { role: 'user', content: [
      { type: 'image_url', image_url: { url: request.image, detail: 'high' } },
      { type: 'text', text: aptitudeUserPrompt(request.category) },
    ] }],
    response_format: { type: 'json_schema', json_schema: { name: 'aptitude_observation', strict: true, schema: APTITUDE_OBSERVATION_JSON_SCHEMA } },
  }, { signal })
  const choice = response.choices[0]
  if (!choice || choice.finish_reason !== 'stop' || choice.message.refusal || !choice.message.content) throw new Error('Incomplete provider response')
  return { text: choice.message.content, model: response.model, inputTokens: response.usage?.prompt_tokens, outputTokens: response.usage?.completion_tokens }
}

function cancelled(timedOut: boolean): never {
  throw new AptitudeServiceError(timedOut ? 'Analysis timed out. Try again with a clear, complete capture.' : 'Analysis was cancelled.', timedOut ? 504 : 499, timedOut ? 'ANALYSIS_TIMEOUT' : 'ANALYSIS_CANCELLED')
}
/** Fence even transports that resolve late or do not implement cancellation correctly. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
export type AnalyzeAptitudeOptions = {
  env?: AptitudeEnvironment
  transport?: AptitudeTransport
  /** Dependency-injected deadline for tests; production stays bounded to 25 seconds. */
  timeoutMs?: number
  onAttempt?: (attempt: { requestedModel: string; model: string | null; provider: string; durationMs: number; inputTokens: number | null; outputTokens: number | null; completed: boolean }) => void
}
export async function analyzeAptitude(value: AptitudeRequest, parentSignal?: AbortSignal, options: AnalyzeAptitudeOptions = {}): Promise<AptitudeResult> {
  const started = performance.now()
  const request = parseAptitudeRequest(value)
  const image = validateAptitudeImage(request.image)
  const sourceHash = createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex')
  const env = options.env ?? process.env
  if (parentSignal?.aborted) throw new AptitudeServiceError('Analysis was cancelled.', 499, 'ANALYSIS_CANCELLED')
  const candidates = request.strategy === 'compare' ? configuredAptitudeComparisonModels(env) : configuredAptitudeModels(env)
  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = Math.min(25_000, Math.max(1, options.timeoutMs ?? 25_000))
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, Math.max(1, timeoutMs - (performance.now() - started)))
  const onAbort = () => controller.abort()
  parentSignal?.addEventListener('abort', onAbort, { once: true })
  if (parentSignal?.aborted) controller.abort()
  try {
    if (request.strategy === 'compare') {
      // Each configured model gets one independent call with the same image. No fallback or shared drafts.
      const outcomes = await Promise.all(candidates.map(async (candidate): Promise<AptitudeComparisonCandidate> => {
        const attemptStarted = performance.now()
        let attemptReply: AptitudeProviderReply | undefined
        let attempted = false
        let completed = false
        const metadata = () => ({ modelId: candidate.id, provider: candidate.provider,
          model: typeof attemptReply?.model === 'string' && attemptReply.model.trim() && attemptReply.model.length <= 200 ? attemptReply.model : null,
          durationMs: Math.round(performance.now()-attemptStarted) })
        try {
          if (controller.signal.aborted) throw new Error('Aborted before attempt')
          attempted = true
          const reply = await abortable((options.transport ?? defaultAptitudeTransport)({ candidate, request, signal: controller.signal, env }), controller.signal)
          attemptReply = reply
          if (performance.now()-started >= timeoutMs) { timedOut = true; controller.abort() }
          if (controller.signal.aborted || parentSignal?.aborted) throw new Error('Late or cancelled result')
          if (!metadata().model) throw new Error('Missing returned model identity')
          const parsed = parseAptitudeObservation(JSON.parse(reply.text))
          const { observation, verification } = verifyAptitudeObservation(parsed)
          if (controller.signal.aborted || parentSignal?.aborted) throw new Error('Cancelled result')
          completed = true
          return { ...metadata(), status: 'complete', observation, verification, error: null }
        } catch {
          return { ...metadata(), status: timedOut ? 'timed_out' : 'failed', observation: null, verification: null,
            error: timedOut ? 'The model did not complete within the shared analysis deadline.' : 'The model could not produce a complete, valid analysis.' }
        } finally {
          if (attempted) {
            try { options.onAttempt?.({ requestedModel: candidate.model, model: metadata().model, provider: candidate.provider,
              durationMs: Math.round(performance.now()-attemptStarted), inputTokens: attemptReply?.inputTokens ?? null, outputTokens: attemptReply?.outputTokens ?? null, completed }) } catch { /* Metrics cannot change an analysis outcome. */ }
          }
        }
      }))
      // Timeouts retain candidate details. User cancellation invalidates the entire request and its late answers.
      if (parentSignal?.aborted || (controller.signal.aborted && !timedOut)) cancelled(false)
      const { comparison, selected } = selectAptitudeComparison(outcomes)
      const review = comparisonReviewQuestion(outcomes)
      const allFailed = outcomes.every(candidate => candidate.status !== 'complete')
      const observation = selected?.observation ?? { ...review, status: allFailed ? 'error' as const : 'ambiguous' as const, answer: null,
        message: comparison.decision === 'disagreement' ? 'The model answers could not be reconciled with matching evidence. Review the comparison before choosing an answer.'
          : 'Too few models produced eligible answers to corroborate a result. Review the candidates or retry.' }
      const questionId = observation.question ? createHash('sha256').update(JSON.stringify({ sourceHash, category: observation.category, question: observation.question })).digest('hex') : null
      return parseAptitudeResult({ ...observation, schemaVersion: 1, captureId: request.captureId, questionVersion: request.questionVersion, sourceHash, questionId,
        verification: selected?.verification ?? { method: 'none', outcome: 'not_run', notes: ['No corroborated answer was selected. Candidate checks remain available for review.'] },
        model: selected?.model ?? null, provider: selected?.provider ?? null, durationMs: Math.round(performance.now()-started), comparison })
    }
    for (const candidate of candidates) {
      if (controller.signal.aborted) cancelled(timedOut)
      const remaining = timeoutMs - (performance.now() - started)
      if (remaining <= 0) { timedOut = true; cancelled(timedOut) }
      const attemptController = new AbortController()
      const abortAttempt = () => attemptController.abort()
      controller.signal.addEventListener('abort', abortAttempt, { once: true })
      const attemptTimer = candidate !== candidates[candidates.length - 1] ? setTimeout(abortAttempt, Math.min(remaining, 12_000)) : undefined
      const attemptStarted = performance.now()
      let attemptReply: AptitudeProviderReply | undefined
      let completed = false
      try {
        const reply = await abortable((options.transport ?? defaultAptitudeTransport)({ candidate, request, signal: attemptController.signal, env }), attemptController.signal)
        attemptReply = reply
        if (controller.signal.aborted || parentSignal?.aborted) cancelled(timedOut)
        const parsed = parseAptitudeObservation(JSON.parse(reply.text))
        const { observation, verification } = verifyAptitudeObservation(parsed)
        const questionId = observation.question ? createHash('sha256').update(JSON.stringify({ sourceHash, category: observation.category, question: observation.question })).digest('hex') : null
        const result = parseAptitudeResult({ ...observation, schemaVersion: 1, captureId: request.captureId, questionVersion: request.questionVersion,
          sourceHash, questionId, verification, model: reply.model, provider: candidate.provider, durationMs: Math.round(performance.now() - started) })
        completed = true
        return result
      } catch (error) {
        if (controller.signal.aborted || parentSignal?.aborted) cancelled(timedOut)
        if (error instanceof AptitudeServiceError && error.code === 'ANALYSIS_CANCELLED') throw error
        // Only explicitly configured, capability-checked candidates are tried; every attempt retains the image.
      } finally {
        clearTimeout(attemptTimer)
        controller.signal.removeEventListener('abort', abortAttempt)
        try { options.onAttempt?.({ requestedModel: candidate.model, model: attemptReply?.model ?? null, provider: candidate.provider,
          durationMs: Math.round(performance.now() - attemptStarted), inputTokens: attemptReply?.inputTokens ?? null, outputTokens: attemptReply?.outputTokens ?? null, completed }) } catch { /* Metrics cannot change an analysis outcome. */ }
      }
    }
    throw new AptitudeServiceError('The configured image models could not produce a complete, valid analysis. Retry a clear capture or check the server provider configuration.', 502, 'ANALYSIS_FAILED')
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onAbort)
  }
}
