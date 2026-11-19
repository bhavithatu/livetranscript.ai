'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AptitudeCapture } from './captureDetector'
import { APTITUDE_PROGRESS_CONTENT_TYPE, readAptitudeProgressStream, type AptitudeProgress } from './progress'
import { buildAptitudeSessionExport, createAptitudeSessionArchive } from './sessionArchive'
import {
  APTITUDE_CONTRACT_HEADER,
  APTITUDE_CONTRACT_VERSION,
  parseAptitudeResult,
  type AptitudeCategorySelection,
  type AptitudeRequest,
  type AptitudeResult,
  type AptitudeStrategy,
} from './schema'

export const APTITUDE_HISTORY_LIMIT = 100
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
  /** Independently validated model completions remain reviewable if the other call fails. */
  progress?: AptitudeProgress | null
}

type ActiveRequest = {
  id: string
  version: number
  generation: number
  controller: AbortController
  timer: ReturnType<typeof setTimeout> | null
}

/** A request owns one capture revision. New captures never inherit an old answer. */
export function useAptitudeSession({ archiveOwnerId }: { archiveOwnerId?: string | null } = {}) {
  const ownerId = archiveOwnerId ?? null
  const [entries, setEntries] = useState<AptitudeSessionEntry[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const entriesRef = useRef<AptitudeSessionEntry[]>([])
  const active = useRef<ActiveRequest | null>(null)
  const generation = useRef(0)
  const archive = useRef<ReturnType<typeof createAptitudeSessionArchive> | null>(null)
  const owner = useRef(ownerId)
  const [entriesOwnerId, setEntriesOwnerId] = useState(ownerId)
  const [archiveReady, setArchiveReady] = useState(false)
  const [storageNotice, setStorageNotice] = useState<string | null>(null)
  const [historyNotice, setHistoryNotice] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const update = useCallback((fn: (items: AptitudeSessionEntry[]) => AptitudeSessionEntry[]) => {
    const next = fn(entriesRef.current)
    entriesRef.current = next
    setEntries(next)
  }, [])

  useEffect(() => {
    if (owner.current !== ownerId) {
      owner.current = ownerId
      generation.current += 1
      if (active.current?.timer) clearTimeout(active.current.timer)
      active.current?.controller.abort()
      active.current = null
      update(() => [])
      setCurrentId(null)
      setSelectedId(null)
      setStorageNotice(null)
      setHistoryNotice(null)
      setSavedAt(null)
      setArchiveReady(false)
      setEntriesOwnerId(ownerId)
    }
    const storage = createAptitudeSessionArchive({ ownerId })
    archive.current = storage
    let mounted = true
    const initialGeneration = generation.current
    void storage.load().then(saved => {
      if (!mounted) return
      // UI waits for recovery, but an imperative action must also fence a late load.
      if (generation.current === initialGeneration && entriesRef.current.length === 0) {
        update(() => saved.entries)
        setCurrentId(saved.entries.at(-1)?.id ?? null)
        setSelectedId(saved.entries.at(-1)?.id ?? null)
      }
      setStorageNotice(saved.notice)
      setSavedAt(saved.savedAt)
      setArchiveReady(true)
    }).catch(() => {
      if (!mounted) return
      setStorageNotice('Saved questions could not be restored. This tab still works; export your session before closing it.')
      setArchiveReady(true)
    })
    return () => { mounted = false; storage.close(); if (archive.current === storage) archive.current = null }
  }, [ownerId, update])

  useEffect(() => {
    const storage = archive.current
    // This effect can run in the same commit as an account switch. Its entries
    // still belong to the previous render until recovery resets that state.
    if (!archiveReady || !storage || entriesOwnerId !== ownerId) return
    let current = true
    void storage.save(entries).then(saved => {
      if (!current) return
      setStorageNotice(saved.notice)
      setSavedAt(saved.savedAt)
    }).catch(() => {
      if (current) setStorageNotice('This session could not be saved in the browser. Export it before closing or reloading this tab.')
    })
    return () => { current = false }
  }, [entries, archiveReady, entriesOwnerId, ownerId])

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
      ? { ...item, category: entry.category, strategy: entry.strategy, questionVersion: request.version, status: 'analyzing', result: null, progress: null, error: null, startedAt, finishedAt: null, elapsedMs: null }
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
        method: 'POST', headers: { 'Content-Type': 'application/json', [APTITUDE_CONTRACT_HEADER]: APTITUDE_CONTRACT_VERSION,
          ...(entry.strategy === 'compare' ? { Accept: APTITUDE_PROGRESS_CONTENT_TYPE } : {}) },
        body: JSON.stringify(body), signal: controller.signal,
      })
      if (!isCurrent()) return
      const streaming = response.ok && response.headers?.get('content-type')?.split(';')[0].trim() === APTITUDE_PROGRESS_CONTENT_TYPE
      let result: AptitudeResult
      if (streaming) {
        if (entry.strategy !== 'compare' || !response.body) throw new Error('The AI service returned an incomplete comparison. Retry this capture.')
        result = await readAptitudeProgressStream(response.body, body, event => {
          if (!isCurrent()) return
          update(items => items.map(item => {
            if (item.id !== entry.id || item.questionVersion !== request.version) return item
            if (event.type === 'start') return { ...item, progress: { sourceHash: event.sourceHash, models: event.models, candidates: [], firstAnswerMs: null } }
            if (!item.progress) return item
            return { ...item, progress: { ...item.progress, candidates: [...item.progress.candidates, event.candidate],
              firstAnswerMs: item.progress.firstAnswerMs ?? (event.candidate.observation?.status === 'solved' ? Math.max(0, Date.now() - startedAt) : null) } }
          }))
        }, controller.signal)
      } else {
        const data: unknown = await response.json().catch(() => null)
        if (!isCurrent()) return
        if (!response.ok) {
          const detail = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error.slice(0, 500) : null
          throw new Error(response.status === 401
            ? 'Sign in to analyze this question. Your capture is still available.'
            : detail || 'The question could not be analyzed. Retry when you are ready.')
        }
        try { result = parseAptitudeResult(data) } catch {
          throw new Error('The AI service returned an incomplete result. Retry this capture.')
        }
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
    if (entriesRef.current.length >= APTITUDE_HISTORY_LIMIT) setHistoryNotice(`This tab retains ${APTITUDE_HISTORY_LIMIT} captures. The oldest capture was removed; export regularly to keep a complete record.`)
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
    setHistoryNotice(null)
    const storage = archive.current
    if (storage) void storage.clear().then(saved => {
      if (archive.current !== storage) return
      setStorageNotice(saved.notice)
      setSavedAt(saved.savedAt)
    }).catch(() => {
      if (archive.current === storage) setStorageNotice('This tab was cleared, but the saved browser copy could not be removed. Try clearing again.')
    })
  }, [stop, update])

  const exportSession = useCallback(() => {
    try {
      const file = buildAptitudeSessionExport(entriesRef.current)
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = file.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch {
      setStorageNotice('This browser could not export the session. Keep the tab open and try Export session again.')
    }
  }, [])

  useEffect(() => () => {
    generation.current += 1
    if (active.current?.timer) clearTimeout(active.current.timer)
    active.current?.controller.abort()
    active.current = null
  }, [])

  // Hide a prior account synchronously; the effect then cancels and releases it.
  const ownsEntries = entriesOwnerId === ownerId
  const visibleEntries = ownsEntries ? entries : []
  const current = visibleEntries.find((item) => item.id === currentId) ?? null
  const selected = visibleEntries.find((item) => item.id === selectedId) ?? current
  const running = visibleEntries.find((item) => item.status === 'analyzing') ?? null
  return { entries: visibleEntries, current, selected, running, selectedId: ownsEntries ? selectedId : null, pinned: ownsEntries && !!selectedId && selected?.id === selectedId, analyze, retry, stop, clear, pin: setSelectedId,
    archiveReady: ownsEntries && archiveReady, archiveNotice: ownsEntries ? [storageNotice, historyNotice].filter(Boolean).join(' ') || null : null, savedAt: ownsEntries ? savedAt : null, exportSession }
}
