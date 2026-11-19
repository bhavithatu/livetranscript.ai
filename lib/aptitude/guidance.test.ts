import { describe, expect, it } from 'vitest'
import { buildAnswerGuidance, estimateQuestionDifficulty } from './guidance'
import type { AptitudeComparisonCandidate, AptitudeCategory } from './schema'
import { solvedObservation } from './testFixtures'

function candidate(id = 'openai:gpt-6.2-sol'): AptitudeComparisonCandidate {
  const observation = solvedObservation(); observation.answer!.confidence = 96
  return { modelId: id, model: id.split(':')[1], provider: id.startsWith('openai:') ? 'openai' : 'anthropic',
    status: 'complete', observation, verification: { method: 'arithmetic', outcome: 'passed', notes: [] }, durationMs: 2000, error: null }
}
const second = () => candidate('anthropic:claude-sonnet-5-5')
describe('best available answer guidance', () => {
  it('keeps a validated answer when the other provider times out', () => {
    const a = candidate(), b = second(); Object.assign(b, { status: 'timed_out', observation: null, verification: null })
    const g = buildAnswerGuidance([a,b]); expect(g.candidate).toBe(a); expect(g.confidenceScore).toBe(70)
  })
  it('does not let claimed confidence override failed arithmetic', () => {
    const a = candidate(), b = second(); a.observation!.answer!.confidence = 100; a.verification!.outcome = 'disagreed'
    b.observation!.answer!.confidence = 61
    const g = buildAnswerGuidance([a,b]); expect(g.candidate).toBe(b); expect(g.confidenceScore).toBe(61)
  })
  it('shows a low-confidence tentative choice for incompatible answers, not consensus', () => {
    const a = candidate(), b = second(); b.observation!.answer!.selectedOptionIds = ['A']; b.observation!.answer!.value = '20'
    b.observation!.answer!.confidence = 100; b.verification = { method:'source_review', outcome:'not_run', notes:[] }
    const g = buildAnswerGuidance([a,b]); expect(g.candidate).toBe(a); expect(g.label).toBe('Best-effort answer'); expect(g.confidenceScore).toBe(45)
    expect(buildAnswerGuidance([a,b], true).confidenceScore).toBe(45)
  })
  it('never converts different source readings into strong confidence', () => {
    const a = candidate(), b = second(); b.observation!.question!.stem += ' NOT'
    expect(buildAnswerGuidance([a,b]).confidenceScore).toBe(45)
  })
  it.each(['answer', 'source'] as const)('keeps %s conflicts tentative even when two aliases return one actual model', conflict => {
    const a = candidate(), b = candidate('openai:alias')
    b.model = a.model
    if (conflict === 'answer') {
      b.observation!.answer!.selectedOptionIds = ['A']
      b.observation!.answer!.value = '20'
      b.verification = { method: 'source_review', outcome: 'not_run', notes: [] }
    } else b.observation!.question!.stem += ' NOT'
    const guide = buildAnswerGuidance([a, b])
    expect(guide.label).toBe('Best-effort answer')
    expect(guide.confidenceScore).toBe(45)
    expect(guide.reasons.join(' ')).toContain('not independent corroboration')
  })
  it('does not promote matching repeated model output into independent agreement', () => {
    const a = candidate(), b = candidate('openai:alias')
    b.model = a.model
    const guide = buildAnswerGuidance([a, b])
    expect(guide.label).toBe('Best available answer')
    expect(guide.confidenceScore).toBe(70)
    expect(guide.reasons.join(' ')).toContain('not independent corroboration')
  })
  it('exposes the tie-break instead of declaring a higher-confidence model better', () => {
    const a = candidate(), b = second(); b.observation!.answer!.selectedOptionIds=['A']; a.observation!.answer!.confidence=100; b.observation!.answer!.confidence=52
    const g = buildAnswerGuidance([a,b]); expect(g.candidate).toBe(b); expect(g.reasons.join(' ')).toContain('stable model order')
  })
  it('uses a labeled fallback for historical answers without a score', () => {
    const a = candidate(); delete a.observation!.answer!.confidence
    const g = buildAnswerGuidance([a]); expect(g.confidenceScore).toBe(50); expect(g.confidenceBasis).toContain('fallback')
  })
  it('caps agreement and keeps provisional confidence conservative', () => {
    const g = buildAnswerGuidance([candidate(),second()]); expect(g.confidenceScore).toBe(95)
    const partial = buildAnswerGuidance([candidate(),second()], true); expect(partial.confidenceScore).toBe(65)
  })
  it.each(['needs_capture','ambiguous','unsupported'] as const)('shows an honest zero-support score for %s, not a fabricated choice', status => {
    const a = candidate(); a.observation!.status=status; a.observation!.answer=null
    const g=buildAnswerGuidance([a]); expect(g.candidate).toBeNull(); expect(g.confidenceScore).toBe(0)
  })
  it('handles no model response and does not mutate candidates', () => {
    expect(buildAnswerGuidance([]).confidenceScore).toBe(0)
    const a=candidate(), b=second(); const before=JSON.stringify([a,b]); buildAnswerGuidance([a,b]); expect(JSON.stringify([a,b])).toBe(before)
  })
})
describe('local difficulty estimates', () => {
  it.each(['numerical','verbal','logical','checking','data_interpretation','critical_reasoning','abstract','spatial'] satisfies AptitudeCategory[])('rates complete %s questions independently of confidence', category => {
    const a=solvedObservation(); a.category=category
    const first=estimateQuestionDifficulty(a); a.answer!.confidence=1
    expect(estimateQuestionDifficulty(a)).toEqual(first); expect(first.level).not.toBe('Not rated')
  })
  it('distinguishes short arithmetic from a long constrained multi-select task', () => {
    const a=solvedObservation(); expect(estimateQuestionDifficulty(a).level).toBe('Easy')
    a.category='logical'; a.question!.stem='Exactly one must stand before Ada and after Bo. Neither may stand between the others.'
    a.question!.passage='Additional detail '.repeat(90); a.question!.responseType='multiple_choice'
    expect(estimateQuestionDifficulty(a).level).toBe('Hard')
  })
  it('does not label unreadable content easy', () => {
    const a=solvedObservation(); a.question!.missingEvidence=['Missing chart axis']
    expect(estimateQuestionDifficulty(a).level).toBe('Not rated')
  })
  it('does not infer difficulty from response latency or model confidence', () => {
    const a=candidate();const before=buildAnswerGuidance([a]).difficulty;a.durationMs=24000;a.observation!.answer!.confidence=15
    expect(buildAnswerGuidance([a]).difficulty).toEqual(before)
  })
})
