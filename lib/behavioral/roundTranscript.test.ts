import { describe, expect, it } from 'vitest'
import { createBehavioralTranscriptBoundary } from './roundTranscript'

describe('behavioral new-round transcript boundary', () => {
  it('returns the complete raw transcript until the first explicit reset', () => {
    const boundary = createBehavioralTranscriptBoundary()
    expect(boundary.read('Candidate: An earlier answer.')).toEqual({ text: 'Candidate: An earlier answer.', uncertain: false })
    expect(boundary.read('Candidate: An earlier answer. More words.')).toEqual({ text: 'Candidate: An earlier answer. More words.', uncertain: false })
  })

  it('does not reimport an old rolling tail and accumulates only subsequent new speech', () => {
    const boundary = createBehavioralTranscriptBoundary()
    const oldTail = 'Candidate: I described the rollback before the reset.'
    boundary.reset(`Interviewer: Tell me about the migration.\n${oldTail}`)
    expect(boundary.read(oldTail)).toEqual({ text: '', uncertain: false })
    const question = '\nInterviewer: What changed next after that?'
    expect(boundary.read(`${oldTail}${question}`)).toEqual({ text: question, uncertain: false })
    const answer = '\nCandidate: I added the retry check in the new round.'
    expect(boundary.read(`${question.trimStart()}${answer}`)).toEqual({ text: question + answer, uncertain: false })
    expect(boundary.read(`${question.trimStart()}${answer}`)).toEqual({ text: question + answer, uncertain: false })
    const next = '\nInterviewer: How did you verify that change?'
    expect(boundary.read(`${answer.trimStart()}${next}`)).toEqual({ text: question + answer + next, uncertain: false })
  })

  it('keeps prior new-round speech when an ASR correction cannot establish an exact boundary', () => {
    const boundary = createBehavioralTranscriptBoundary()
    const baseline = 'Candidate: I worked with six engineers.'
    boundary.reset(baseline)
    const first = '\nInterviewer: What did you do personally?'
    expect(boundary.read(baseline + first).text).toBe(first)
    const changed = 'Candidate: I worked with five engineers.\nInterviewer: What did you personally own?'
    expect(boundary.read(changed)).toEqual({ text: first, uncertain: true })
    const next = '\nCandidate: I tested the recovery path.'
    expect(boundary.read(changed + next)).toEqual({ text: first + next, uncertain: true })
    expect(boundary.read(changed + next).text).not.toContain('five engineers')
  })

  it('does not accept a one-character overlap or a disjoint transcript as new speech', () => {
    const boundary = createBehavioralTranscriptBoundary()
    boundary.reset('Previous interview ended with x')
    expect(boundary.read('xAn unrelated old recording.')).toEqual({ text: '', uncertain: true })
    expect(boundary.read('An entirely disjoint recording.')).toEqual({ text: '', uncertain: true })
    const current = 'An entirely disjoint recording. Newly appended words.'
    expect(boundary.read(current)).toEqual({ text: ' Newly appended words.', uncertain: true })
    boundary.reset(current)
    expect(boundary.read(current)).toEqual({ text: '', uncertain: false })
  })

  it('does not turn a shortened prefix into a repeated old utterance on the next read', () => {
    const boundary = createBehavioralTranscriptBoundary()
    const original = 'Interviewer: Original question. Candidate: Original answer.'
    boundary.reset(original)
    expect(boundary.read('Interviewer: Original question.').text).toBe('')
    expect(boundary.read(original).text).toBe('')
    expect(boundary.read(original + ' Newly spoken answer.').text).toBe(' Newly spoken answer.')
  })

  it('throws on accumulation overflow instead of silently truncating newly captured text', () => {
    const boundary = createBehavioralTranscriptBoundary()
    const baseline = 'Interviewer: Original question.'
    boundary.reset(baseline)
    expect(() => boundary.read(baseline + 'n'.repeat(120_001))).toThrow('no transcript text has been silently truncated')
    expect(boundary.read(baseline)).toEqual({ text: '', uncertain: false })
  })
})
