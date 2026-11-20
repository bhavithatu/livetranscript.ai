import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_SENTINEL, REFINED_SENTINEL } from '@/lib/copilot/draftProtocol'
import { behavioralSessionKey, useBehavioralSession } from './useBehavioralSession'
import { serializeBehavioralSources } from './sources'

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('behavioral account and tab persistence', () => {
  it('keeps anonymous rounds separate and never accesses browser storage for them', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const first = renderHook(() => useBehavioralSession())
    const second = renderHook(() => useBehavioralSession())
    act(() => { expect(first.result.current.addRecord({ kind: 'candidate_note', text: 'I check a baseline first.' })).toBe(true) })
    expect(first.result.current.round.records).toHaveLength(1)
    expect(second.result.current.round.records).toHaveLength(0)
    expect(first.result.current.round.id).not.toBe(second.result.current.round.id)
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('restores the same owner and scope on reload, and isolates other owners and workspaces', () => {
    const first = renderHook(() => useBehavioralSession({ ownerId: 'owner-a', scope: 'copilot' }))
    act(() => { first.result.current.updateProfile({ company: 'Example Co' }); first.result.current.addRecord({ kind: 'confirmed_answer', question: 'How large?', text: 'We were three engineers.' }) })
    const originalId = first.result.current.round.id
    first.unmount()
    const restored = renderHook(() => useBehavioralSession({ ownerId: 'owner-a', scope: 'copilot' }))
    expect(restored.result.current.ready).toBe(true)
    expect(restored.result.current.round.id).toBe(originalId)
    expect(restored.result.current.round.records[0].text).toBe('We were three engineers.')
    expect(restored.result.current.round.profile.company).toBe('Example Co')
    const otherOwner = renderHook(() => useBehavioralSession({ ownerId: 'owner-b', scope: 'copilot' }))
    const otherScope = renderHook(() => useBehavioralSession({ ownerId: 'owner-a', scope: 'live' }))
    const anonymous = renderHook(() => useBehavioralSession({ scope: 'copilot' }))
    expect(otherOwner.result.current.round.records).toHaveLength(0)
    expect(otherScope.result.current.round.records).toHaveLength(0)
    expect(anonymous.result.current.round.records).toHaveLength(0)
  })

  it('fences old account results and does not carry records when the owner changes in place', () => {
    const hook = renderHook(({ ownerId }) => useBehavioralSession({ ownerId, scope: 'copilot' }), { initialProps: { ownerId: 'owner-a' } })
    act(() => { hook.result.current.addRecord({ kind: 'candidate_note', text: 'Owner A only.' }) })
    const captured = hook.result.current.snapshot()
    hook.rerender({ ownerId: 'owner-b' })
    expect(hook.result.current.round.records).toHaveLength(0)
    expect(hook.result.current.isCurrent(captured)).toBe(false)
    act(() => { hook.result.current.recordSuggestion(captured, 'Old request?', 'Old account suggestion') })
    expect(hook.result.current.round.records).toHaveLength(0)
    hook.rerender({ ownerId: 'owner-a' })
    expect(hook.result.current.round.records[0].text).toBe('Owner A only.')
  })

  it('keeps successful in-memory edits when saving fails and reports the failure', () => {
    const hook = renderHook(() => useBehavioralSession({ ownerId: 'owner' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    act(() => { expect(hook.result.current.addRecord({ kind: 'candidate_note', text: 'Keep this real experience.' })).toBe(true) })
    expect(hook.result.current.snapshot().records[0].text).toBe('Keep this real experience.')
    expect(hook.result.current.notice).toContain('could not be saved for reload')
    expect(JSON.parse(hook.result.current.exportSession()).round.records[0].text).toBe('Keep this real experience.')
  })

  it('does not overwrite corrupt saved data until an explicit new round', () => {
    const key = behavioralSessionKey('owner')
    window.sessionStorage.setItem(key, '{invalid saved round')
    const hook = renderHook(() => useBehavioralSession({ ownerId: 'owner' }))
    expect(hook.result.current.notice).toContain('has not been overwritten')
    act(() => { hook.result.current.addRecord({ kind: 'candidate_note', text: 'New in-memory note.' }) })
    expect(window.sessionStorage.getItem(key)).toBe('{invalid saved round')
    expect(hook.result.current.round.records).toHaveLength(1)
    act(() => { expect(hook.result.current.reset()).toBe(true) })
    expect(JSON.parse(window.sessionStorage.getItem(key)!).round.records).toEqual([])
    expect(hook.result.current.notice).toBeNull()
  })
})

describe('behavioral revision ownership and provenance', () => {
  it('invalidates explicit edits but lets completed concurrent suggestions share their captured revision', () => {
    const hook = renderHook(() => useBehavioralSession())
    const invalidated = vi.fn()
    hook.result.current.subscribeInvalidation(invalidated)
    const original = hook.result.current.snapshot()
    act(() => { hook.result.current.addRecord({ kind: 'confirmed_answer', text: 'I worked with two engineers.' }) })
    expect(hook.result.current.isCurrent(original)).toBe(false)
    expect(invalidated).toHaveBeenCalledTimes(1)
    const captured = hook.result.current.snapshot()
    act(() => {
      hook.result.current.recordSuggestion(captured, 'Question A?', 'First suggested wording.')
      hook.result.current.recordSuggestion(captured, 'Question B?', 'Second suggested wording.')
    })
    expect(hook.result.current.round.records.filter((record) => record.kind === 'ai_suggestion')).toHaveLength(2)
    expect(hook.result.current.round.revision).toBe(captured.revision)
    expect(hook.result.current.isCurrent(captured)).toBe(true)
    expect(invalidated).toHaveBeenCalledTimes(1)
    act(() => { hook.result.current.updateProfile({ company: 'New target company' }) })
    expect(invalidated).toHaveBeenCalledTimes(2)
    expect(hook.result.current.round.records[1].contextProfile?.company).toBe('')
    act(() => { hook.result.current.recordSuggestion(captured, 'Stale?', 'Do not record this.') })
    expect(hook.result.current.round.records).toHaveLength(3)
  })

  it('keeps explicit correction provenance and never auto-confirms generated text', () => {
    const hook = renderHook(() => useBehavioralSession())
    act(() => { hook.result.current.addRecord({ kind: 'confirmed_answer', question: 'Size?', text: 'Six people.' }) })
    const id = hook.result.current.round.records[0].id
    act(() => { hook.result.current.addRecord({ kind: 'correction', text: 'Correction: five people, including me.', supersedes: id }) })
    const captured = hook.result.current.snapshot()
    act(() => { hook.result.current.recordSuggestion(captured, 'Size?', 'So we were five people.') })
    expect(hook.result.current.round.records.map((record) => record.kind)).toEqual(['confirmed_answer', 'correction', 'ai_suggestion'])
    expect(hook.result.current.round.records[1].supersedes).toBe(id)
    expect(hook.result.current.snapshot().coverage.totalConfirmedRecords).toBe(2)
    expect(JSON.parse(hook.result.current.exportSession()).provenance).toContain('do not establish external submission')
  })

  it('retains only completed final/refined output, not speculative drafts', () => {
    const hook = renderHook(() => useBehavioralSession())
    const captured = hook.result.current.snapshot()
    act(() => {
      hook.result.current.recordSuggestion(captured, 'Question?', `${DRAFT_SENTINEL}Speculative invented metric`)
      hook.result.current.recordSuggestion(captured, 'Question?', `${DRAFT_SENTINEL}Speculative invented metric${REFINED_SENTINEL}Grounded final wording.`)
    })
    expect(hook.result.current.round.records).toHaveLength(1)
    expect(hook.result.current.round.records[0]).toMatchObject({ kind: 'ai_suggestion', text: 'Grounded final wording.', contextRevision: captured.revision })
  })

  it('starts a new round with the same profile and fences old and unmounted completions', () => {
    const hook = renderHook(() => useBehavioralSession())
    act(() => { hook.result.current.updateProfile({ company: 'Example Co', selfDescription: 'I ask for evidence.' }) })
    const captured = hook.result.current.snapshot()
    act(() => { hook.result.current.reset(); hook.result.current.recordSuggestion(captured, 'Old?', 'Late response') })
    expect(hook.result.current.round.id).not.toBe(captured.roundId)
    expect(hook.result.current.round.profile.company).toBe('Example Co')
    expect(hook.result.current.round.records).toHaveLength(0)
    const controller = hook.result.current
    const newSnapshot = controller.snapshot()
    hook.unmount()
    expect(controller.isCurrent(newSnapshot)).toBe(false)
    controller.recordSuggestion(newSnapshot, 'Unmounted?', 'Late response')
  })
})

describe('original behavioral source continuity', () => {
  it('deduplicates original context and preserves new transcript words with supplied speaker attribution', () => {
    const hook = renderHook(() => useBehavioralSession())
    const firstTranscript = 'Interviewer: What happened?\nCandidate: I checked the baseline.'
    act(() => { hook.result.current.observeContext('RESUME:\nReal experience.\n\nSTORY:\nI tested rollback.', firstTranscript) })
    const first = hook.result.current.snapshot()
    expect(first.coverage).toMatchObject({ totalConfirmedRecords: 0, totalSourceRecords: 2 })
    expect(first.records.every((record) => record.kind === 'source_context')).toBe(true)
    act(() => { hook.result.current.observeContext('RESUME:\nReal experience.\n\nSTORY:\nI tested rollback.', firstTranscript) })
    expect(hook.result.current.round.revision).toBe(first.revision)
    expect(hook.result.current.round.records).toHaveLength(2)
    act(() => { hook.result.current.observeContext('RESUME:\nReal experience.\n\nNEW STORY:\nI asked for review.', `${firstTranscript}\nCandidate: I measured 18 percent.`) })
    expect(hook.result.current.round.records).toHaveLength(4)
    expect(hook.result.current.round.records[2].text).toBe('RESUME:\nReal experience.\n\nNEW STORY:\nI asked for review.')
    expect(hook.result.current.round.records[3].text).toBe('\nCandidate: I measured 18 percent.')
    expect(hook.result.current.round.records[3].sourceLabel).toContain('speaker attribution only as supplied')
    expect(hook.result.current.isCurrent(first)).toBe(false)
  })

  it('handles an exact rolling transcript overlap without duplicating old words', () => {
    const hook = renderHook(() => useBehavioralSession())
    act(() => { hook.result.current.observeContext(null, 'Question one. Candidate: I checked the baseline.') })
    act(() => { hook.result.current.observeContext(null, 'Candidate: I checked the baseline. Interviewer: Why?') })
    expect(hook.result.current.round.records[1].text).toBe(' Interviewer: Why?')
  })

  it('preserves a repeated outcome in each distinct story source bundle', () => {
    const hook = renderHook(() => useBehavioralSession())
    const outcome = 'I owned testing. The result was 18 percent.'
    act(() => { hook.result.current.observeContext(`STORY — Alpha\n\n${outcome}`, null) })
    act(() => { hook.result.current.observeContext(`STORY — Beta\n\n${outcome}`, null) })
    expect(hook.result.current.round.records.map((record) => record.text)).toEqual([
      `STORY — Alpha\n\n${outcome}`, `STORY — Beta\n\n${outcome}`,
    ])
  })

  it('deduplicates complete labeled sources while keeping identical facts attached to different stories', () => {
    const hook = renderHook(() => useBehavioralSession())
    const resume = { label: 'Resume', text: 'Actual background.' }
    const shared = 'I owned testing.\n\nThe result was 18 percent.'
    act(() => { hook.result.current.observeContext(serializeBehavioralSources([resume, { label: 'Story Alpha', text: shared }]), null) })
    act(() => { hook.result.current.observeContext(serializeBehavioralSources([resume, { label: 'Story Beta', text: shared }]), null) })
    expect(hook.result.current.round.records).toHaveLength(3)
    expect(hook.result.current.round.records[1]).toMatchObject({ sourceLabel: 'Provided source: Story Alpha', text: shared })
    expect(hook.result.current.round.records[2]).toMatchObject({ sourceLabel: 'Provided source: Story Beta', text: shared })
  })

  it('rejects oversized mandatory source input atomically instead of continuing without it', () => {
    const hook = renderHook(() => useBehavioralSession())
    act(() => { hook.result.current.addRecord({ kind: 'candidate_note', text: 'An early fact to preserve.' }) })
    const before = hook.result.current.snapshot()
    act(() => { expect(() => hook.result.current.observeContext('Too large: '.repeat(12_000), null)).toThrow('at most 120,000') })
    expect(hook.result.current.notice).toContain('at most 120,000')
    expect(hook.result.current.snapshot()).toEqual(before)
  })
})
