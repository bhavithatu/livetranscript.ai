'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AptitudeCapture } from './captureDetector'
import {
  parseAptitudeResult,
  type AptitudeCategorySelection,
  type AptitudeRequest,
  type AptitudeResult,
  type AptitudeStrategy,
} from './schema'

export const APTITUDE_HISTORY_LIMIT = 12
export const APTITUDE_REQUEST_TIMEOUT_MS = 45_000

export type AptitudeSessionEntry = {
  id: string
  capture: AptitudeCapture
  category: AptitudeCategorySelection
  strategy: AptitudeStrategy
  questionVersion: number
  status: 'analyzing' | 'complete' | 'cancelled' | 'error'
  result: AptitudeResult | null
  error: string | null
  startedAt: number
  finishedAt: number | null
  elapsedMs: number | null
}

type ActiveRequest = {
  id: string
  version: number
  generation: number
  controller: AbortController
  timer: ReturnType<typeof setTimeout> | null
}

/** A request owns one capture revision. New captures never inherit an old answer. */
export function useAptitudeSession() {
  const [entries, setEntries] = useState<AptitudeSessionEntry[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const entriesRef = useRef<AptitudeSessionEntry[]>([])
  const active = useRef<ActiveRequest | null>(null)
  const generation = useRef(0)

  const update = useCallback((fn: (items: AptitudeSessionEntry[]) => AptitudeSessionEntry[]) => {
    const next = fn(entriesRef.current)
    entriesRef.current = next
    setEntries(next)
  }, [])

  const stop = useCallback(() => {
    generation.current += 1
    const previous = active.current
    active.current = null
    if (previous?.timer) clearTimeout(previous.timer)
    previous?.controller.abort()
    if (previous) {
      const now = Date.now()
      update((items) => items.map((item) => item.id === previous.id && item.questionVersion === previous.version
        ? { ...item, status: 'cancelled', finishedAt: now, elapsedMs: Math.max(0, now - item.startedAt) }
        : item))
    }
  }, [update])

  const run = useCallback(async (entry: AptitudeSessionEntry) => {
    stop()
    const controller = new AbortController()
    const request: ActiveRequest = {
      id: entry.id,
      version: Math.max(entry.questionVersion, ...entriesRef.current.filter((item) => item.capture.id === entry.capture.id).map((item) => item.questionVersion)) + 1,
      generation: generation.current,
      controller,
      timer: null,
    }
    active.current = request
    const startedAt = Date.now()
    update((items) => items.map((item) => item.id === entry.id
      ? { ...item, category: entry.category, strategy: entry.strategy, questionVersion: request.version, status: 'analyzing', result: null, error: null, startedAt, finishedAt: null, elapsedMs: null }
      : item))
    const isCurrent = () => active.current === request && generation.current === request.generation && !controller.signal.aborted
    request.timer = setTimeout(() => {
      if (!isCurrent()) return
      active.current = null
      generation.current += 1
      controller.abort()
      const finishedAt = Date.now()
      update((items) => items.map((item) => item.id === entry.id && item.questionVersion === request.version
        ? { ...item, status: 'error', error: 'The analysis took too long. Check your connection and retry this capture.', finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }
        : item))
    }, APTITUDE_REQUEST_TIMEOUT_MS)
    const body: AptitudeRequest = {
      captureId: entry.capture.id,
      questionVersion: request.version,
      image: entry.capture.image,
      category: entry.category,
      ...(entry.strategy === 'compare' ? { strategy: 'compare' as const } : {}),
    }
    try {
      const response = await fetch('/api/aptitude/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      })
      if (!isCurrent()) return
      const data: unknown = await response.json().catch(() => null)
      if (!isCurrent()) return
      if (!response.ok) {
        const detail = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error.slice(0, 500) : null
        throw new Error(response.status === 401
          ? 'Sign in to analyze this question. Your capture is still available.'
          : detail || 'The question could not be analyzed. Retry when you are ready.')
      }
      let result: AptitudeResult
      try { result = parseAptitudeResult(data) } catch {
        throw new Error('The AI service returned an incomplete result. Retry this capture.')
      }
      if (result.captureId !== body.captureId || result.questionVersion !== body.questionVersion) {
        throw new Error('The response did not match this capture. Retry this question.')
      }
      if ((entry.strategy === 'compare') !== Boolean(result.comparison)) {
        throw new Error('The response did not match the selected analysis mode. Retry this capture.')
      }
      if (!isCurrent()) return
      const finishedAt = Date.now()
      update((items) => items.map((item) => item.id === entry.id && item.questionVersion === request.version
        ? { ...item, result, status: result.status === 'error' ? 'error' : 'complete', error: result.status === 'error' ? result.message || 'Analysis failed. Retry this question.' : null, finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }
        : item))
    } catch (cause) {
      if (!isCurrent()) return
      const finishedAt = Date.now()
      update((items) => items.map((item) => item.id === entry.id && item.questionVersion === request.version
        ? { ...item, status: 'error', error: cause instanceof Error ? cause.message : 'Could not reach the AI service. Retry this capture.', finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }
        : item))
    } finally {
      if (request.timer) clearTimeout(request.timer)
      if (active.current === request) active.current = null
    }
  }, [stop, update])

  const addEntry = useCallback((capture: AptitudeCapture, category: AptitudeCategorySelection, strategy: AptitudeStrategy) => {
    // A second strategy retains the original analysis instead of relabeling it.
    // Screenshot identity stays unchanged; the history entry has its own ID.
    const entry: AptitudeSessionEntry = {
      id: entriesRef.current.some((item) => item.id === capture.id) ? crypto.randomUUID() : capture.id,
      capture, category, strategy, questionVersion: 0, status: 'analyzing',
      result: null, error: null, startedAt: Date.now(), finishedAt: null, elapsedMs: null,
    }
    update((items) => [...items, entry].slice(-APTITUDE_HISTORY_LIMIT))
    return entry
  }, [update])

  const analyze = useCallback(async (capture: AptitudeCapture, category: AptitudeCategorySelection = 'auto', strategy: AptitudeStrategy = 'single') => {
    // Screen re-selection and auto resume can produce a fresh ID for identical
    // bytes. Reuse the exact image, category and strategy, never a perceptual hash.
    // Explicit Retry always calls run and therefore remains a fresh request.
    const reusable = [...entriesRef.current].reverse().find((item) => item.capture.image === capture.image
      && item.category === category && item.strategy === strategy && (item.status === 'analyzing' || item.status === 'complete'))
    if (reusable) {
      if (active.current && active.current.id !== reusable.id) stop()
      setCurrentId(reusable.id)
      return
    }
    const existing = entriesRef.current.find((item) => item.capture.id === capture.id && item.capture.image === capture.image
      && item.category === category && item.strategy === strategy)
    const entry = existing ?? addEntry(capture, category, strategy)
    setCurrentId(entry.id)
    await run(entry)
  }, [addEntry, run, stop])

  const retry = useCallback(async (id: string, category?: AptitudeCategorySelection, strategy?: AptitudeStrategy) => {
    const entry = entriesRef.current.find((item) => item.id === id)
    if (!entry) return
    const requestedStrategy = strategy ?? entry.strategy
    if (requestedStrategy !== entry.strategy) {
      const replacement = addEntry(entry.capture, category ?? entry.category, requestedStrategy)
      setCurrentId((current) => current === id ? replacement.id : current)
      setSelectedId((selected) => selected === id ? replacement.id : selected)
      await run(replacement)
    } else await run({ ...entry, category: category ?? entry.category })
  }, [addEntry, run])

  const clear = useCallback(() => {
    stop()
    update(() => [])
    setCurrentId(null)
    setSelectedId(null)
  }, [stop, update])

  useEffect(() => () => {
    generation.current += 1
    if (active.current?.timer) clearTimeout(active.current.timer)
    active.current?.controller.abort()
    active.current = null
  }, [])

  const current = entries.find((item) => item.id === currentId) ?? null
  const selected = entries.find((item) => item.id === selectedId) ?? current
  const running = entries.find((item) => item.status === 'analyzing') ?? null
  return { entries, current, selected, running, selectedId, pinned: !!selectedId && selected?.id === selectedId, analyze, retry, stop, clear, pin: setSelectedId }
}
