import { describe, expect, it } from 'vitest'
import { buildAnswerGuidance, estimateQuestionDifficulty } from '@/lib/aptitude/guidance'
import type { AptitudeObservation } from '@/lib/aptitude/schema'
import { APTITUDE_SELECTION_FIXTURES } from './selectionFixtures'

describe('difficulty across original mixed-question fixtures (offline, not model accuracy)', () => {
  it.each(APTITUDE_SELECTION_FIXTURES)('$domain', fixture => {
    const observation: AptitudeObservation = { category: fixture.expected.category, status: fixture.expected.status === 'error' ? 'ambiguous' : fixture.expected.status,
      question: { stem: fixture.lines.join(' '), passage: null, instructions: [],
        options: fixture.choices.map((o,i) => ({ ...o, id: String(i) })), responseType: 'single_choice',
        missingEvidence: fixture.cropped ? ['Option diagrams are cropped'] : [] }, answer: null, message: null }
    const result=estimateQuestionDifficulty(observation)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.level === 'Not rated').toBe(Boolean(fixture.cropped))
    const guide=buildAnswerGuidance([{modelId:'offline:fixture',model:'fixture',provider:'openai',status:'complete',observation,verification:{method:'none',outcome:'not_run',notes:[]},durationMs:0,error:null}])
    // A fixture's answer key is not a model response and must not be promoted.
    expect(guide.candidate).toBeNull();expect(guide.confidenceScore).toBe(0)
  })
})
