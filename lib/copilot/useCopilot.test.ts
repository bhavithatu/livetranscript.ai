import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCopilot } from './useCopilot'
import { useAnswerFeed } from './useAnswerFeed'
import { captureLatency } from './latency'
import { DRAFT_SENTINEL, REFINED_SENTINEL } from './draftProtocol'
import { buildBehavioralSnapshot, createBehavioralRound, type BehavioralSnapshot } from '@/lib/behavioral/session'
import type { BehavioralSessionController } from '@/lib/behavioral/useBehavioralSession'
import { useBehavioralSession } from '@/lib/behavioral/useBehavioralSession'
vi.mock('./latency', () => ({ captureLatency: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

function behavioralController() {
  const round = createBehavioralRound({ company: 'Elm', role: 'Engineer' })
  round.records = Array.from({ length: 12 }, (_, index) => ({ id: `actual-${index}`, kind: 'confirmed_answer' as const,
    question: `Question ${index}`, text: index === 0 ? 'I measured a 14% reduction against the original baseline.' : `My actual answer ${index}.`, createdAt: index + 1 }))
  const snapshot = buildBehavioralSnapshot(round)
  let current = true
  const listeners = new Set<() => void>()
  const recordSuggestion = vi.fn(), observeContext = vi.fn(), takeSnapshot = vi.fn(() => snapshot)
  const controller = {
    round, snapshot: takeSnapshot, recordSuggestion, observeContext,
    isCurrent: (request: BehavioralSnapshot) => current && request === snapshot,
    subscribeInvalidation: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  } as unknown as BehavioralSessionController
  return { controller, snapshot, recordSuggestion, observeContext, takeSnapshot,
    invalidate: () => { current = false; listeners.forEach(listener => listener()) } }
}

describe('copilot stream ownership', () => {
  it('clears one mode while preserving another mode history and active stream', async () => {
    let finish!: () => void
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('Original coding answer'))
      .mockResolvedValueOnce(new Response('Behavioral suggestion'))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('Current coding answer'))
        finish = () => controller.close()
      } })))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useCopilot(() => ''))
    await act(async () => { await hook.result.current.ask('Earlier code?', 'coding') })
    await act(async () => { await hook.result.current.ask('Earlier story?', 'behavioral') })
    let pending!: Promise<string | undefined>
    act(() => { pending = hook.result.current.ask('Current code?', 'coding') })
    await waitFor(() => expect(hook.result.current.turns.at(-1)?.content).toBe('Current coding answer'))
    act(() => hook.result.current.clear('behavioral'))
    expect(hook.result.current.streaming).toBe(true)
    expect(fetcher.mock.calls[2][1].signal.aborted).toBe(false)
    expect(hook.result.current.turns.every(turn => turn.mode === 'coding')).toBe(true)
    expect(hook.result.current.turns).toHaveLength(4)
    await act(async () => { finish(); expect(await pending).toBe('Current coding answer') })
    act(() => hook.result.current.clear())
    expect(hook.result.current.turns).toEqual([])
  })

  it('ignores a superseded response even if its fetch ignores abort', async () => {
    const resolves: ((response: Response) => void)[] = []
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => resolves.push(resolve)))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useCopilot(() => 'Source evidence', { format: 'keywords', tone: 'technical', followups: true }))
    let first!: Promise<string | undefined>; let second!: Promise<string | undefined>
    act(() => { first = hook.result.current.ask('Old question?') })
    act(() => { second = hook.result.current.ask('New question?') })
    await act(async () => { resolves[1](new Response('New answer')); expect(await second).toBe('New answer') })
    await act(async () => { resolves[0](new Response('Stale answer')); expect(await first).toBeUndefined() })
    expect(hook.result.current.turns.filter((turn) => turn.role === 'assistant').map((turn) => turn.content)).toEqual(['New answer'])
    expect(hook.result.current.streaming).toBe(false)
    expect(captureLatency).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(body.preferences).toEqual({ format: 'keywords', tone: 'technical', followups: true })
    expect(body.transcript).toBe('Source evidence')
  })
  it('stops a pending read immediately and preserves the partial answer', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('Partial')) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const hook = renderHook(() => useCopilot(() => ''))
    let pending!: Promise<string | undefined>
    act(() => { pending = hook.result.current.ask('Question?') })
    await waitFor(() => expect(hook.result.current.turns.at(-1)?.content).toBe('Partial'))
    await act(async () => { hook.result.current.stop(); expect(await pending).toBeUndefined() })
    expect(hook.result.current.streaming).toBe(false)
    expect(hook.result.current.turns.at(-1)?.content).toBe('Partial')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(captureLatency).not.toHaveBeenCalled()
  })
  it('does not return a failed partial stream as completed code', async () => {
    let fail!: () => void
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('Incomplete solution'))
      fail = () => controller.error(new Error('Connection interrupted'))
    } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const hook = renderHook(() => useCopilot(() => ''))
    let pending!: Promise<string | undefined>
    act(() => { pending = hook.result.current.ask('Solve?', 'coding') })
    await waitFor(() => expect(hook.result.current.turns.at(-1)?.content).toBe('Incomplete solution'))
    await act(async () => { fail(); expect(await pending).toBeUndefined() })
    expect(hook.result.current.error).toBe('Connection interrupted')
    expect(hook.result.current.streaming).toBe(false)
    expect(captureLatency).not.toHaveBeenCalled()
  })
  it('cancels open streams on unmount', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {}, cancel }))))
    const hook = renderHook(() => useCopilot(() => ''))
    let pending!: Promise<string | undefined>
    await act(async () => { pending = hook.result.current.ask('Question?'); await Promise.resolve() })
    hook.unmount()
    expect(await pending).toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

describe('behavioral request evidence and completion', () => {
  it('continues one real round across manual and automatic answers without confirming AI suggestions', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('Use the supplied 14% result.'))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => {
      const session = useBehavioralSession()
      return { session, manual: useCopilot(() => 'Candidate: I measured 14%.', undefined, session), feed: useAnswerFeed(undefined, session) }
    })
    await act(async () => { await hook.result.current.manual.ask('Describe your project.', 'behavioral', null, 'Original measurement notes') })
    await act(async () => { await hook.result.current.feed.answer('How was it measured?', 'behavioral', 'Original measurement notes', null, null, 'Candidate: I measured 14%.') })
    await act(async () => { await hook.result.current.manual.ask('Who owned the work?', 'behavioral', null, 'Original measurement notes') })

    const body = JSON.parse(String(fetcher.mock.calls[2][1].body))
    expect(body.behavioralSession.records.filter((record: { kind: string }) => record.kind === 'ai_suggestion').map((record: { question: string }) => record.question))
      .toEqual(['Describe your project.', 'How was it measured?'])
    expect(body.behavioralSession.records.some((record: { kind: string; text: string }) => record.kind === 'source_context' && record.text === 'Original measurement notes')).toBe(true)
    expect(body.behavioralSession.coverage.totalConfirmedRecords).toBe(0)
    expect(hook.result.current.session.round.records.filter(record => record.kind === 'ai_suggestion')).toHaveLength(3)
    expect(hook.result.current.session.round.records.filter(record => record.kind === 'confirmed_answer')).toEqual([])
    expect(hook.result.current.manual.error).toBeNull()
  })

  it('sends the complete immutable round instead of recent assistant history and records only refined text', async () => {
    const session = behavioralController()
    const raw = `${DRAFT_SENTINEL}Unconfirmed 40% draft${REFINED_SENTINEL}I measured a 14% reduction.`
    const fetcher = vi.fn().mockImplementation(async () => new Response(raw))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useCopilot(() => 'Candidate: I measured 14%.', undefined, session.controller))

    await act(async () => { await hook.result.current.ask('What changed?', 'behavioral', null, 'Original project source') })
    await act(async () => { await hook.result.current.ask('How was that measured?', 'behavioral', null, 'Original project source') })

    expect(session.takeSnapshot).toHaveBeenCalledTimes(2)
    expect(session.observeContext).toHaveBeenLastCalledWith('Original project source', 'Candidate: I measured 14%.')
    const body = JSON.parse(String(fetcher.mock.calls[1][1].body))
    expect(body.behavioralSession).toEqual(session.snapshot)
    expect(body.behavioralSession.records).toHaveLength(12)
    expect(body.behavioralSession.records[0].text).toContain('14%')
    expect(body.history).toEqual([])
    expect(session.recordSuggestion).toHaveBeenLastCalledWith(session.snapshot, 'How was that measured?', 'I measured a 14% reduction.')
    expect(session.recordSuggestion.mock.calls.every(([, , text]) => !String(text).includes('40%'))).toBe(true)
  })

  it('aborts a request on an explicit context change and ignores a late response', async () => {
    const session = behavioralController()
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise(done => { resolve = done }))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useCopilot(() => '', undefined, session.controller))
    let pending!: Promise<string | undefined>
    act(() => { pending = hook.result.current.ask('What would you choose?', 'behavioral') })
    act(() => session.invalidate())
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true)
    await act(async () => { resolve(new Response('Answer using the old company')); expect(await pending).toBeUndefined() })
    expect(session.recordSuggestion).not.toHaveBeenCalled()
    expect(hook.result.current.streaming).toBe(false)
    expect(hook.result.current.error).toMatch(/context changed/)
  })

  it.each(['draft', 'partial', 'cancelled'] as const)('does not save a %s response as a completed suggestion', async kind => {
    const session = behavioralController()
    let fail!: () => void
    const raw = kind === 'draft' ? `${DRAFT_SENTINEL}Quick unsupported take` : 'Partial answer'
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(raw))
      if (kind === 'draft') controller.close()
      else fail = () => controller.error(new Error('Interrupted'))
    } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const hook = renderHook(() => useCopilot(() => '', undefined, session.controller))
    let pending!: Promise<string | undefined>
    act(() => { pending = hook.result.current.ask('Tell me about that project.', 'behavioral') })
    await waitFor(() => expect(hook.result.current.turns.at(-1)?.content).toBe(raw))
    await act(async () => {
      if (kind === 'partial') fail()
      if (kind === 'cancelled') hook.result.current.stop()
      expect(await pending).toBeUndefined()
    })
    expect(session.recordSuggestion).not.toHaveBeenCalled()
  })
})
