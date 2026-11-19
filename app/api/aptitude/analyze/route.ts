import { NextRequest, NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { analyzeAptitude, type AnalyzeAptitudeOptions } from '@/lib/aptitude/analyze'
import { AptitudeServiceError } from '@/lib/aptitude/modelPolicy'
import { APTITUDE_CONTRACT_HEADER, APTITUDE_CONTRACT_VERSION, AptitudeValidationError, MAX_APTITUDE_BODY_BYTES, parseAptitudeRequest, type AptitudeAnswer, type AptitudeResult } from '@/lib/aptitude/schema'
import { APTITUDE_PROGRESS_CONTENT_TYPE, encodeAptitudeProgressEvent, type AptitudeProgressEvent } from '@/lib/aptitude/progress'
import { recordUsage } from '@/lib/usage'

export const runtime = 'nodejs'
export const maxDuration = 40
const headers = { 'Cache-Control': 'no-store' }

function failure(error: unknown) {
  if (error instanceof AptitudeServiceError) return { status: error.status, error: error.message, code: error.code }
  if (error instanceof AptitudeValidationError || error instanceof RepoRequestError) return { status: error instanceof RepoRequestError ? error.status : 400, error: error.message, code: 'INVALID_REQUEST' }
  return { status: 500, error: 'Aptitude analysis is temporarily unavailable.', code: 'INTERNAL_ERROR' }
}

/** Keep existing tabs usable: their retained captures would otherwise be lost on refresh. */
function legacyResult(result: AptitudeResult): AptitudeResult {
  const answer = (value: AptitudeAnswer | null) => {
    if (!value) return null
    const copy = { ...value }
    delete copy.confidence
    return copy
  }
  return { ...result, answer: answer(result.answer), ...(result.comparison ? {
    comparison: { ...result.comparison, candidates: result.comparison.candidates.map(candidate => ({ ...candidate,
      observation: candidate.observation ? { ...candidate.observation, answer: answer(candidate.observation.answer) } : null,
    })) },
  } : {}) }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await currentUserId()
    if (!userId) return NextResponse.json({ error: 'Sign in to analyze an aptitude question.', code: 'UNAUTHENTICATED' }, { status: 401, headers })
    const origin = req.headers.get('origin')
    if ((origin && origin !== req.nextUrl.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Cross-origin requests are not allowed.', code: 'INVALID_ORIGIN' }, { status: 403, headers })
    const request = parseAptitudeRequest(await readRepoJson(req, MAX_APTITUDE_BODY_BYTES))
    const contract = req.headers.get(APTITUDE_CONTRACT_HEADER)
    const legacy = contract === 'grid-v1'
    if (!legacy && contract !== APTITUDE_CONTRACT_VERSION) return NextResponse.json({ error: 'Aptitude has been updated. Save your existing captures before refreshing this tab, then retry.', code: 'CLIENT_UPDATE_REQUIRED' }, { status: 409, headers })
    const onAttempt: NonNullable<AnalyzeAptitudeOptions['onAttempt']> = attempt => recordUsage('aptitude', userId, attempt)
    const wantsStream = !legacy && request.strategy === 'compare'
      && req.headers.get('accept')?.split(',').some(value => value.split(';')[0].trim() === APTITUDE_PROGRESS_CONTENT_TYPE)
    if (wantsStream) {
      const work = new AbortController()
      const abort = () => work.abort()
      req.signal.addEventListener('abort', abort, { once: true })
      if (req.signal.aborted) work.abort()
      let closed = false
      let sourceHash: string | null = null
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: AptitudeProgressEvent) => {
            if (closed || work.signal.aborted) return
            try { controller.enqueue(encodeAptitudeProgressEvent(event)) } catch {
              closed = true
              work.abort()
              controller.error(new Error('The comparison connection could not continue.'))
            }
          }
          void analyzeAptitude(request, work.signal, { onAttempt, onProgress: event => {
            if (event.type === 'start') sourceHash = event.sourceHash
            send(event)
          } }).then(result => send({ type: 'result', result })).catch(error => {
            const safe = failure(error)
            send({ type: 'error', captureId: request.captureId, questionVersion: request.questionVersion,
              sourceHash, code: safe.code, message: safe.error })
          }).finally(() => {
            req.signal.removeEventListener('abort', abort)
            if (!closed) { closed = true; controller.close() }
          })
        },
        cancel() { closed = true; work.abort(); req.signal.removeEventListener('abort', abort) },
      })
      return new Response(body, { headers: { ...headers, 'Content-Type': `${APTITUDE_PROGRESS_CONTENT_TYPE}; charset=utf-8`, 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } })
    }
    const result = await analyzeAptitude(request, req.signal, { onAttempt })
    return NextResponse.json(legacy ? legacyResult(result) : result, { headers })
  } catch (error) {
    const safe = failure(error)
    return NextResponse.json({ error: safe.error, code: safe.code }, { status: safe.status, headers })
  }
}
