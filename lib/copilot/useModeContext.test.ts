import { describe, it, expect, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { cosine, chunkCorpus, useModeContext } from './useModeContext'

describe('cosine', () => {
  it('is 1 for identical vectors, 0 for orthogonal', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })
  it('ranks a closer vector higher', () => {
    const q = [1, 1, 0]
    expect(cosine(q, [1, 1, 0])).toBeGreaterThan(cosine(q, [1, 0, 0]))
  })
  it('handles a zero vector without NaN', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0)
  })
})

describe('chunkCorpus', () => {
  it('splits on blank lines and drops trivial fragments', () => {
    const raw =
      'A meaningful paragraph describing the product requirements in detail.\n\nAnother paragraph covering the API contract.\n\nok'
    const chunks = chunkCorpus(raw)
    expect(chunks).toHaveLength(2) // "ok" is < 20 chars, dropped
    expect(chunks[0]).toMatch(/requirements/)
  })
})

describe('saved mode context', () => {
  it('keeps original story evidence available after retrieval and follow-up preparation', async () => {
    localStorage.setItem('lt.context.behavioral', JSON.stringify({ instructions: '', docs: [], stories: [
      { id: 'queue', title: 'Queue migration', fullText: 'I measured a 14% reduction in repeated work.', embedding: [1, 0] },
      { id: 'release', title: 'Release rollout', fullText: 'I owned the rollback check, not the full architecture.', embedding: [0, 1] },
    ] }))
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ embeddings: [[1, 0]] }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    try {
      const hook = renderHook(() => useModeContext('behavioral'))
      let first: { title: string; fullText: string }[] = []
      let followup: { title: string; fullText: string }[] = []
      await act(async () => { first = await hook.result.current.retrieveStories('Tell me about the migration.', 1) })
      // No answer was generated or adopted. A follow-up must still get its source.
      await act(async () => { followup = await hook.result.current.retrieveStories('How did you measure 14%?', 1) })
      expect(followup).toEqual(first)
      expect(followup).toEqual([{ title: 'Queue migration', fullText: 'I measured a 14% reduction in repeated work.' }])
      expect(hook.result.current.storyCount).toBe(2)
    } finally {
      cleanup()
      localStorage.removeItem('lt.context.behavioral')
      vi.unstubAllGlobals()
    }
  })

  it('discards malformed documents and embeddings before rendering or retrieval', () => {
    localStorage.setItem('lt.context.validation-test', JSON.stringify({
      instructions: 'Use the current repository.',
      docs: [null, { id: 'missing-chunks', name: 'Broken' }, {
        id: 'valid', name: 'Context', chunks: [null, { text: 'bad', embedding: ['x'] }, { text: 'usable', embedding: [1, 0] }],
      }],
      stories: [null, { id: 'broken', title: 'Bad', fullText: 'Bad', embedding: [null] },
        { id: 'valid', title: 'Story', fullText: 'Story content', embedding: [1, 0] }],
    }))
    try {
      const { result } = renderHook(() => useModeContext('validation-test'))
      expect(result.current.docs).toHaveLength(1)
      expect(result.current.count).toBe(1)
      expect(result.current.storyCount).toBe(1)
      expect(result.current.instructions).toBe('Use the current repository.')
    } finally {
      cleanup()
      localStorage.removeItem('lt.context.validation-test')
    }
  })
})
