import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AptitudeCapture } from './captureDetector'
import { APTITUDE_CONTRACT_HEADER, APTITUDE_CONTRACT_VERSION, type AptitudeRequest, type AptitudeResult } from './schema'
import { APTITUDE_HISTORY_LIMIT, APTITUDE_REQUEST_TIMEOUT_MS, useAptitudeSession } from './useAptitudeSession'
import { comparisonFixture } from '@/components/aptitude/comparisonTestFixtures'

function capture(id: string): AptitudeCapture {
  return { id, image: `data:image/png;base64,${btoa(id)}`, capturedAt: Date.now(), width: 100, height: 100, sourceHash: id }
}

function answer(request: AptitudeRequest): AptitudeResult {
  return {
    schemaVersion: 1, captureId: request.captureId, questionVersion: request.questionVersion,
    questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), category: 'numerical', status: 'solved',
    question: { stem: `Question from ${request.captureId}`, instructions: [], passage: null,
      options: [{ id: 'a', label: 'A', text: '20%' }, { id: 'b', label: 'B', text: '25%' }], responseType: 'single_choice', missingEvidence: [] },
    answer: { selectedOptionIds: ['b'], value: '25', unit: '%', summary: 'The increase is 25%.',
      workedExplanation: ['The increase is 18.', '18 divided by 72 is 25%.'], evidence: ['72 tasks then 90 tasks.'], calculation: null },
    verification: { method: 'arithmetic', outcome: 'passed', notes: ['25% verified.'] },
    model: 'test-model', provider: 'openai', durationMs: 200, message: null,
  }
}

type Pending = { request: AptitudeRequest; signal: AbortSignal; resolve: (response: Response) => void }
let pending: Pending[]

beforeEach(() => {
  pending = []
  vi.useFakeTimers()
  vi.setSystemTime(1_700_000_000_000)
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => {
    // Deliberately ignore abort: the hook must fence late responses too.
    pending.push({ request: JSON.parse(init.body as string), signal: init.signal as AbortSignal, resolve })
  })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function complete(index: number, value: unknown = answer(pending[index].request), status = 200) {
  await act(async () => pending[index].resolve(new Response(JSON.stringify(value), { status })))
}

describe('aptitude request lifecycle', () => {
  it('advertises structured grid support and preserves the capture when a refresh is requested', async () => {
    const { result } = renderHook(useAptitudeSession)
    const screenshot = capture('contract-refresh')
    act(() => { void result.current.analyze(screenshot) })
    expect(fetch).toHaveBeenCalledWith('/api/aptitude/analyze', expect.objectContaining({
      headers: { 'Content-Type': 'application/json', [APTITUDE_CONTRACT_HEADER]: APTITUDE_CONTRACT_VERSION },
    }))
    const error = 'Aptitude has been updated. Refresh this tab once, then retry your capture.'
    await complete(0, { error, code: 'CLIENT_UPDATE_REQUIRED' }, 409)
    expect(result.current.current).toMatchObject({ status: 'error', error, result: null })
    expect(result.current.current?.capture).toBe(screenshot)
    expect(pending).toHaveLength(1)
  })
  it('separates single and comparison requests and preserves their own results in history', async () => {
    const { result } = renderHook(useAptitudeSession)
    const screenshot = capture('same-question')
    act(() => { void result.current.analyze(screenshot) })
    expect(pending[0].request.strategy).toBeUndefined()
    await complete(0)
    const original = result.current.current!
    act(() => { void result.current.analyze(screenshot, 'auto', 'compare') })
    expect(pending[1].request).toEqual({ ...pending[0].request, questionVersion: 2, strategy: 'compare' })
    expect(result.current.entries).toHaveLength(2)
    expect(result.current.entries[0]).toBe(original)
    expect(result.current.current?.id).not.toBe(original.id)
    expect(result.current.current?.strategy).toBe('compare')
    act(() => { void result.current.analyze({ ...screenshot, id: 'same-bytes-again' }, 'auto', 'compare') })
    expect(pending).toHaveLength(2)
    await complete(1, comparisonFixture(answer(pending[1].request)))
    expect(result.current.current?.result?.comparison?.decision).toBe('agreement')
    act(() => { void result.current.analyze({ ...screenshot, id: 'same-complete-comparison' }, 'auto', 'compare') })
    expect(pending).toHaveLength(2)
    act(() => { void result.current.analyze(screenshot, 'auto', 'single') })
    expect(pending).toHaveLength(2)
    expect(result.current.current?.id).toBe(original.id)
    expect(result.current.current?.strategy).toBe('single')
    expect(result.current.current?.result?.comparison).toBeUndefined()
  })

  it('retries pinned history with the chosen strategy without relabeling the saved result or moving the latest question', async () => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('first')) })
    await complete(0)
    act(() => { result.current.pin('first'); void result.current.analyze(capture('latest')) })
    await complete(1)
    act(() => { void result.current.retry('first', 'numerical', 'compare') })
    expect(pending[2].request).toMatchObject({ captureId: 'first', questionVersion: 2, strategy: 'compare' })
    expect(result.current.entries[0].strategy).toBe('single')
    expect(result.current.entries[0].result?.answer).toBeTruthy()
    expect(result.current.selected?.strategy).toBe('compare')
    expect(result.current.selected?.id).not.toBe('first')
    expect(result.current.current?.id).toBe('latest')
    await complete(2, comparisonFixture(answer(pending[2].request)))
    act(() => { void result.current.retry(result.current.selected!.id) })
    expect(pending[3].request).toMatchObject({ captureId: 'first', questionVersion: 3, strategy: 'compare' })
    expect(result.current.entries).toHaveLength(3)
  })

  it('rejects a single answer returned for a comparison request', async () => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('compare'), 'auto', 'compare') })
    await complete(0)
    expect(result.current.current?.result).toBeNull()
    expect(result.current.current?.error).toMatch(/selected analysis mode/)
  })

  it('coalesces identical pending and completed images while keeping explicit retries fresh', async () => {
    const { result } = renderHook(useAptitudeSession)
    const first = capture('first')
    act(() => { void result.current.analyze(first) })
    act(() => { void result.current.analyze({ ...first, id: 'same-pending', sourceHash: 'different' }) })
    expect(pending).toHaveLength(1)
    expect(pending[0].signal.aborted).toBe(false)
    await complete(0)
    act(() => { void result.current.analyze({ ...first, id: 'same-complete' }) })
    expect(pending).toHaveLength(1)
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.current?.id).toBe('first')
    act(() => { void result.current.retry('first') })
    expect(pending).toHaveLength(2)
    await complete(1)
    act(() => { void result.current.analyze({ ...capture('different-bytes'), sourceHash: first.sourceHash }) })
    expect(pending).toHaveLength(3)
    expect(result.current.current?.id).toBe('different-bytes')
  })

  it('keeps a newer question current even when an aborted older response arrives last', async () => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('first')) })
    act(() => { vi.advanceTimersByTime(300); void result.current.analyze(capture('second'), 'numerical') })
    expect(pending[0].signal.aborted).toBe(true)
    expect(result.current.current?.capture.id).toBe('second')
    expect(result.current.current?.result).toBeNull()
    act(() => vi.advanceTimersByTime(700))
    await complete(1)
    expect(result.current.current?.elapsedMs).toBe(700)
    expect(result.current.current?.result?.question?.stem).toBe('Question from second')
    await complete(0)
    expect(result.current.current?.result?.captureId).toBe('second')
    expect(result.current.entries[0].status).toBe('cancelled')
    expect(result.current.entries[0].result).toBeNull()
    expect(result.current.running).toBeNull()
  })

  it('also ignores a response whose body finishes reading after a replacement starts', async () => {
    const { result } = renderHook(useAptitudeSession)
    let resolveBody!: (value: unknown) => void
    act(() => { void result.current.analyze(capture('first')) })
    await act(async () => pending[0].resolve({ ok: true, status: 200, json: () => new Promise((resolve) => { resolveBody = resolve }) } as Response))
    act(() => { void result.current.analyze(capture('second')) })
    await act(async () => resolveBody(answer(pending[0].request)))
    expect(result.current.entries[0].result).toBeNull()
    expect(result.current.current?.status).toBe('analyzing')
    await complete(1)
    expect(result.current.current?.result?.captureId).toBe('second')
  })

  it('pins history across new captures and retries the saved image without moving the latest question', async () => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('first')) })
    await complete(0)
    act(() => { result.current.pin('first'); void result.current.analyze(capture('second')) })
    await complete(1)
    expect(result.current.pinned).toBe(true)
    expect(result.current.selected?.id).toBe('first')
    expect(result.current.current?.id).toBe('second')
    act(() => { void result.current.retry('first', 'logical') })
    expect(pending[2].request).toEqual({ ...pending[0].request, questionVersion: 2, category: 'logical' })
    expect(result.current.selected?.result).toBeNull()
    expect(result.current.current?.result?.captureId).toBe('second')
    await complete(2)
    expect(result.current.selected?.questionVersion).toBe(2)
    act(() => result.current.pin(null))
    expect(result.current.selected?.id).toBe('second')
  })

  it('retains the capture after a service error and can retry successfully', async () => {
    const { result } = renderHook(useAptitudeSession)
    const screenshot = capture('recoverable')
    act(() => { void result.current.analyze(screenshot) })
    await complete(0, { error: 'The AI service is unavailable.' }, 503)
    expect(result.current.current?.status).toBe('error')
    expect(result.current.current?.error).toBe('The AI service is unavailable.')
    expect(result.current.current?.capture).toBe(screenshot)
    act(() => { void result.current.retry('recoverable') })
    expect(result.current.current?.error).toBeNull()
    await complete(1)
    expect(result.current.current?.status).toBe('complete')
  })

  it.each(['capture', 'version', 'schema'] as const)('rejects an invalid %s response instead of displaying its answer', async (invalid) => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('expected')) })
    const response = answer(pending[0].request)
    if (invalid === 'capture') response.captureId = 'other'
    if (invalid === 'version') response.questionVersion = 100
    await complete(0, invalid === 'schema' ? { answer: 'B' } : response)
    expect(result.current.current?.status).toBe('error')
    expect(result.current.current?.result).toBeNull()
    expect(result.current.current?.error).toMatch(/Retry/)
  })

  it('stops and clears immediately, preventing late responses from restoring a cleared session', async () => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('first')) })
    act(() => { vi.advanceTimersByTime(250); result.current.stop() })
    expect(pending[0].signal.aborted).toBe(true)
    expect(result.current.current?.status).toBe('cancelled')
    expect(result.current.current?.elapsedMs).toBe(250)
    await complete(0)
    expect(result.current.current?.result).toBeNull()
    act(() => { void result.current.retry('first'); result.current.pin('first') })
    act(() => result.current.clear())
    expect(pending[1].signal.aborted).toBe(true)
    await complete(1)
    expect(result.current.entries).toEqual([])
    expect(result.current.current).toBeNull()
    expect(result.current.selected).toBeNull()
    expect(result.current.pinned).toBe(false)
  })

  it('times out a lost request with measured time and ignores any later completion', async () => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('timeout')) })
    act(() => vi.advanceTimersByTime(APTITUDE_REQUEST_TIMEOUT_MS))
    expect(pending[0].signal.aborted).toBe(true)
    expect(result.current.current?.status).toBe('error')
    expect(result.current.current?.error).toMatch(/took too long/)
    expect(result.current.current?.elapsedMs).toBe(APTITUDE_REQUEST_TIMEOUT_MS)
    await complete(0)
    expect(result.current.current?.result).toBeNull()
    expect(result.current.current?.status).toBe('error')
  })

  it('bounds retained screenshots and safely falls back if a pinned capture is removed', () => {
    const { result } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('first')); result.current.pin('first') })
    for (let index = 0; index < APTITUDE_HISTORY_LIMIT; index++) act(() => { void result.current.analyze(capture(`later-${index}`)) })
    expect(result.current.entries).toHaveLength(APTITUDE_HISTORY_LIMIT)
    expect(result.current.entries.some((entry) => entry.id === 'first')).toBe(false)
    expect(result.current.pinned).toBe(false)
    expect(result.current.selected?.id).toBe(`later-${APTITUDE_HISTORY_LIMIT - 1}`)
  })

  it('aborts the active request when the workspace unmounts', async () => {
    const { result, unmount } = renderHook(useAptitudeSession)
    act(() => { void result.current.analyze(capture('leaving')) })
    unmount()
    expect(pending[0].signal.aborted).toBe(true)
    await complete(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
