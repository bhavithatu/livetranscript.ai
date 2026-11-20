'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseDraftStream } from '@/lib/copilot/draftProtocol'
import {
  buildBehavioralSnapshot, createBehavioralRound, MAX_BEHAVIORAL_ARCHIVE_BYTES,
  parseBehavioralProfile, parseBehavioralRound, parseBehavioralSnapshot,
  type BehavioralProfile, type BehavioralRecord, type BehavioralRecordKind, type BehavioralRound, type BehavioralSnapshot,
} from './session'
import { exactSuffixPrefixOverlap, MIN_TRANSCRIPT_OVERLAP_CHARS } from './transcriptOverlap'
import { parseBehavioralSources } from './sources'

export type BehavioralRecordInput = {
  kind: BehavioralRecordKind; question?: string; text: string; supersedes?: string; sourceLabel?: string
}
export type BehavioralSessionController = {
  round: BehavioralRound
  ready: boolean
  notice: string | null
  snapshot: (question?: string) => BehavioralSnapshot
  isCurrent: (snapshot: BehavioralSnapshot) => boolean
  subscribeInvalidation: (callback: () => void) => () => void
  addRecord: (record: BehavioralRecordInput) => boolean
  observeContext: (context: string | null, transcript: string | null) => void
  recordSuggestion: (snapshot: BehavioralSnapshot, question: string, rawText: string) => void
  updateProfile: (profile: Partial<BehavioralProfile>) => boolean
  reset: () => boolean
  exportSession: () => string
}

type State = { identity: string; round: BehavioralRound; ready: boolean; notice: string | null }
const CONTEXT_SOURCE_PREFIX = 'Provided source: '
const TRANSCRIPT_SOURCE = 'Conversation transcript (capture; speaker attribution only as supplied)'
const TRANSCRIPT_APPEND = 'Conversation transcript (continued capture; speaker attribution only as supplied)'
const TRANSCRIPT_CHANGE = 'Conversation transcript (changed capture; speaker attribution and overlap not inferred)'

export function behavioralSessionKey(ownerId: string, scope = 'default'): string {
  if (!ownerId.trim() || ownerId.length > 256 || scope.length > 200) throw new Error('Invalid behavioral session owner or scope.')
  return `lt.behavioral.v1.${encodeURIComponent(ownerId)}.${encodeURIComponent(scope)}`
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'The behavioral round could not be updated.' }
function observedSources(round: BehavioralRound) {
  const context = new Set<string>()
  let transcript = ''
  for (const record of round.records) {
    if (record.kind !== 'source_context') continue
    if (record.sourceLabel?.startsWith(CONTEXT_SOURCE_PREFIX)) context.add(`${record.sourceLabel}\u0000${record.text}`)
    if (record.sourceLabel === TRANSCRIPT_SOURCE || record.sourceLabel === TRANSCRIPT_CHANGE) transcript = record.text
    if (record.sourceLabel === TRANSCRIPT_APPEND) transcript += record.text
  }
  return { context, transcript }
}

/** A round is shared by explicitly passing this controller to both transports.
 * Persistence uses sessionStorage, scoped to account and workspace. Anonymous
 * instances never read or write browser storage and never share their memory. */
export function useBehavioralSession({ ownerId, scope = 'default' }: { ownerId?: string | null; scope?: string } = {}): BehavioralSessionController {
  const owner = typeof ownerId === 'string' && ownerId.trim() ? ownerId : null
  const key = owner ? behavioralSessionKey(owner, scope) : null
  const identity = key ?? `memory:${scope}`
  const fresh = useMemo(() => ({ identity, round: createBehavioralRound() }), [identity])
  const [state, setState] = useState<State>(() => ({ identity, round: fresh.round, ready: !key, notice: null }))
  const stateRef = useRef(state)
  const identityRef = useRef(identity)
  const ownerRef = useRef({ owner, scope, key })
  const mounted = useRef(true)
  const corrupt = useRef(false)
  const invalidationListeners = useRef(new Set<() => void>())
  const invalidate = useCallback(() => {
    for (const callback of invalidationListeners.current) callback()
  }, [])
  // Fence the old account at commit, before async work or UI events can observe
  // the new account's screen. Persistence is still loaded in a normal effect.
  useLayoutEffect(() => {
    identityRef.current = identity
    ownerRef.current = { owner, scope, key }
    if (stateRef.current.identity !== identity) invalidate()
  }, [identity, owner, scope, key, invalidate])
  const setNotice = useCallback((notice: string) => {
    if (!mounted.current || stateRef.current.identity !== identityRef.current) return
    stateRef.current = { ...stateRef.current, notice }
    setState(stateRef.current)
  }, [])

  useEffect(() => {
    mounted.current = true
    corrupt.current = false
    let round = fresh.round
    let notice: string | null = null
    if (key && owner) {
      try {
        const raw = window.sessionStorage.getItem(key)
        if (raw !== null) {
          if (new TextEncoder().encode(raw).byteLength > MAX_BEHAVIORAL_ARCHIVE_BYTES + 2_000) throw new Error('Saved behavioral round exceeds the archive limit.')
          const stored: unknown = JSON.parse(raw)
          if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('Saved behavioral round is malformed.')
          const envelope = stored as Record<string, unknown>
          if (envelope.version !== 1 || envelope.ownerId !== owner || envelope.scope !== scope
            || Object.keys(envelope).some((field) => !['version', 'ownerId', 'scope', 'round'].includes(field))) throw new Error('Saved behavioral round does not match this account and workspace.')
          round = parseBehavioralRound(envelope.round)
        }
      } catch (error) {
        corrupt.current = true
        notice = `${message(error)} Existing saved data has not been overwritten. New work remains in this page; export it before leaving or start a new round to replace saved data.`
      }
    }
    stateRef.current = { identity, round, ready: true, notice }
    setState(stateRef.current)
    return () => { mounted.current = false; invalidate() }
  }, [identity, fresh, key, owner, scope, invalidate])

  const current = useCallback(() => {
    if (!mounted.current || stateRef.current.identity !== identityRef.current || !stateRef.current.ready) throw new Error('The behavioral round is still loading. Try again when it is ready.')
    return stateRef.current
  }, [])
  const commit = useCallback((round: BehavioralRound, explicitChange: boolean, replaceSaved = false): boolean => {
    const previous = current()
    const next = parseBehavioralRound(round)
    const settings = ownerRef.current
    let notice: string | null = null
    if (replaceSaved) corrupt.current = false
    if (settings.key && settings.owner) {
      try {
        if (corrupt.current) throw new Error('Unreadable saved data has not been overwritten.')
        window.sessionStorage.setItem(settings.key, JSON.stringify({ version: 1, ownerId: settings.owner, scope: settings.scope, round: next }))
      } catch (error) {
        notice = `${message(error)} This round is available in this page but could not be saved for reload. Export it before leaving.`
      }
    }
    stateRef.current = { ...previous, round: next, notice }
    setState(stateRef.current)
    if (explicitChange) invalidate()
    return true
  }, [current, invalidate])

  const snapshot = useCallback((question?: string) => buildBehavioralSnapshot(current().round, question), [current])
  const isCurrent = useCallback((captured: BehavioralSnapshot) => {
    const active = stateRef.current
    return mounted.current && active.ready && active.identity === identityRef.current && !!captured
      && captured.roundId === active.round.id && captured.revision === active.round.revision
  }, [])
  const subscribeInvalidation = useCallback((callback: () => void) => {
    invalidationListeners.current.add(callback)
    return () => { invalidationListeners.current.delete(callback) }
  }, [])

  const addRecord = useCallback((input: BehavioralRecordInput): boolean => {
    try {
      const { round } = current()
      const suggestion = input.kind === 'ai_suggestion'
      const record: BehavioralRecord = {
        id: crypto.randomUUID(), kind: input.kind, question: input.question ?? '', text: input.text, createdAt: Date.now(),
        ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
        ...(input.sourceLabel !== undefined ? { sourceLabel: input.sourceLabel } : {}),
        ...(suggestion ? { contextRevision: round.revision, contextProfile: { ...round.profile } } : {}),
      }
      return commit({ ...round, revision: round.revision + (suggestion ? 0 : 1), records: [...round.records, record] }, !suggestion)
    } catch (error) { setNotice(message(error)); return false }
  }, [current, commit, setNotice])

  const observeContext = useCallback((context: string | null, transcript: string | null): void => {
    try {
      const { round } = current()
      if ((context !== null && typeof context !== 'string') || (transcript !== null && typeof transcript !== 'string')) throw new Error('Original behavioral context must be text.')
      const observed = observedSources(round)
      const additions: BehavioralRecord[] = []
      const addSource = (text: string, sourceLabel: string) => additions.push({ id: crypto.randomUUID(), kind: 'source_context', question: '', text, sourceLabel, createdAt: Date.now() })
      // Deduplicate complete labeled blocks only. Paragraph dedup can detach a
      // shared metric or role description from the second story supplying it.
      if (context?.trim()) {
        for (const source of parseBehavioralSources(context)) {
          const sourceLabel = `${CONTEXT_SOURCE_PREFIX}${source.label}`
          const sourceKey = `${sourceLabel}\u0000${source.text}`
          if (observed.context.has(sourceKey)) continue
          observed.context.add(sourceKey)
          addSource(source.text, sourceLabel)
        }
      }
      if (transcript?.trim() && !observed.transcript.includes(transcript)) {
        if (!observed.transcript) addSource(transcript, TRANSCRIPT_SOURCE)
        else if (transcript.startsWith(observed.transcript)) addSource(transcript.slice(observed.transcript.length), TRANSCRIPT_APPEND)
        else {
          const overlap = exactSuffixPrefixOverlap(observed.transcript, transcript)
          if (overlap >= MIN_TRANSCRIPT_OVERLAP_CHARS) addSource(transcript.slice(overlap), TRANSCRIPT_APPEND)
          else addSource(transcript, TRANSCRIPT_CHANGE)
        }
      }
      if (additions.length) commit({ ...round, revision: round.revision + 1, records: [...round.records, ...additions] }, true)
    } catch (error) {
      setNotice(message(error))
      throw error
    }
  }, [current, commit, setNotice])

  // Call only after the transport has completed successfully. A partial or
  // failed plain stream cannot be distinguished from a final answer by text.
  // Draft protocol text IS distinguishable and never becomes retained evidence.
  const recordSuggestion = useCallback((captured: BehavioralSnapshot, question: string, rawText: string): void => {
    if (!isCurrent(captured)) return
    try {
      const source = parseBehavioralSnapshot(captured)
      const parsed = parseDraftStream(rawText)
      if (parsed.phase === 'draft' || !parsed.text.trim()) return
      const { round } = current()
      if (!isCurrent(source)) return
      if (round.records.some((record) => record.kind === 'ai_suggestion' && record.contextRevision === source.revision && record.question === question && record.text === parsed.text)) return
      const record: BehavioralRecord = {
        id: crypto.randomUUID(), kind: 'ai_suggestion', question, text: parsed.text, createdAt: Date.now(),
        contextRevision: source.revision, contextProfile: { ...source.profile },
      }
      commit({ ...round, records: [...round.records, record] }, false)
    } catch (error) { setNotice(message(error)) }
  }, [isCurrent, current, commit, setNotice])

  const updateProfile = useCallback((changes: Partial<BehavioralProfile>): boolean => {
    try {
      const { round } = current()
      const profile = parseBehavioralProfile({ ...round.profile, ...changes })
      if (JSON.stringify(profile) === JSON.stringify(round.profile)) return true
      return commit({ ...round, profile, revision: round.revision + 1 }, true)
    } catch (error) { setNotice(message(error)); return false }
  }, [current, commit, setNotice])
  const reset = useCallback((): boolean => {
    try { return commit(createBehavioralRound(current().round.profile), true, true) }
    catch (error) { setNotice(message(error)); return false }
  }, [current, commit, setNotice])
  const exportSession = useCallback((): string => JSON.stringify({
    format: 'LiveTranscript behavioral round', version: 1, exportedAt: new Date().toISOString(),
    provenance: 'AI suggestions are unconfirmed drafts. User-recorded answers and source transcripts do not establish external submission. No candidate fact is independently verified by this export.',
    round: current().round,
  }, null, 2), [current])

  const visible = state.identity === identity ? state : { identity, round: fresh.round, ready: false, notice: null }
  return { round: visible.round, ready: visible.ready, notice: visible.notice, snapshot, isCurrent, subscribeInvalidation,
    addRecord, observeContext, recordSuggestion, updateProfile, reset, exportSession }
}
