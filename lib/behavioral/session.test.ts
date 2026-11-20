import { describe, expect, it } from 'vitest'
import {
  buildBehavioralSnapshot, createBehavioralRound, MAX_BEHAVIORAL_RECORDS, MAX_BEHAVIORAL_SNAPSHOT_CHARS,
  parseBehavioralRound, parseBehavioralSnapshot, renderBehavioralSnapshot,
  type BehavioralRecord, type BehavioralRound,
} from './session'

function record(round: BehavioralRound, index: number, kind: BehavioralRecord['kind'], text: string): BehavioralRecord {
  return { id: `record-${index}`, kind, question: `Question ${index}?`, text, createdAt: 1_000 + index,
    ...(kind === 'ai_suggestion' ? { contextRevision: round.revision, contextProfile: { ...round.profile } } : {}) }
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

describe('behavioral source provenance and continuity', () => {
  it('retains early answers beyond the old four-question window and never labels suggestions as candidate speech', () => {
    const round = createBehavioralRound({ company: 'Example Co', expectations: 'Ownership and collaboration', selfDescription: 'I prefer checking evidence before a decision.' })
    for (let index = 0; index < 12; index++) {
      round.records.push(record(round, index * 2, 'confirmed_answer', index === 0 ? 'I worked with two engineers. The measured result was 18 percent.' : `My actual answer ${index}.`))
      round.records.push(record(round, index * 2 + 1, 'ai_suggestion', `Possible answer ${index}; this has not been confirmed.`))
    }
    const snapshot = buildBehavioralSnapshot(round)
    const output = renderBehavioralSnapshot(snapshot)
    expect(snapshot.records).toHaveLength(24)
    expect(snapshot.coverage).toMatchObject({ complete: true, totalConfirmedRecords: 12, includedConfirmedRecords: 12, omittedRecords: 0 })
    expect(output).toContain('The measured result was 18 percent.')
    expect(output).toContain('AI SUGGESTION — unconfirmed draft')
    expect(output).toContain('not candidate speech, experience, a selected option, or a submitted answer')
    expect(output).toContain('external submission is not established')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.records)).toBe(true)
    expect(Object.isFrozen(snapshot.records[1].contextProfile)).toBe(true)
    round.profile.company = 'Different Co'
    round.records[0].text = 'Changed after capture'
    expect(snapshot.profile.company).toBe('Example Co')
    expect(snapshot.records[0].text).toContain('18 percent')
  })

  it('keeps exact corrections and quoted source attribution without rewriting the original record', () => {
    const round = createBehavioralRound()
    round.records = [
      record(round, 0, 'confirmed_answer', 'I managed a team of six.'),
      { ...record(round, 1, 'correction', 'Correction: I coordinated with six colleagues; I did not manage them.'), supersedes: 'record-0' },
      { ...record(round, 2, 'source_context', 'Interviewer: You must enjoy risk.\nCandidate: I do not take unreviewed risks.'), sourceLabel: 'Conversation transcript; attribution as supplied' },
    ]
    const snapshot = buildBehavioralSnapshot(round)
    expect(snapshot.records[0].text).toBe('I managed a team of six.')
    expect(snapshot.records[1]).toMatchObject({ kind: 'correction', supersedes: 'record-0' })
    expect(snapshot.coverage).toMatchObject({ totalConfirmedRecords: 2, totalSourceRecords: 1 })
    const rendered = renderBehavioralSnapshot(snapshot)
    expect(rendered).toContain('I did not manage them.')
    expect(rendered).toContain('speaker and source attribution is only as supplied')
    expect(rendered).toContain('not facts about the candidate')
    expect(rendered).toContain('Preserve exact metrics, dates, ownership, preferences and negation')
  })

  it('omits only explicitly identified whole AI suggestions when the request budget is full', () => {
    const round = createBehavioralRound({ company: 'Example' })
    round.records.push(record(round, 0, 'confirmed_answer', 'EARLY FACT: I chose option B, not option A.'))
    round.records.push({ ...record(round, 1, 'source_context', 'Original company/story evidence. '.repeat(2_000)), sourceLabel: 'Supplied references' })
    for (let index = 2; index < 15; index++) round.records.push(record(round, index, 'ai_suggestion', `${index}: ${'suggested wording '.repeat(1_500)}`))
    const snapshot = buildBehavioralSnapshot(round, 'What did you choose?')
    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(MAX_BEHAVIORAL_SNAPSHOT_CHARS)
    expect(snapshot.coverage.complete).toBe(false)
    expect(snapshot.coverage.omittedRecords).toBeGreaterThan(0)
    expect(snapshot.coverage.omittedSuggestionIds).toHaveLength(snapshot.coverage.omittedRecords)
    expect(snapshot.records[0].text).toBe('EARLY FACT: I chose option B, not option A.')
    expect(snapshot.records[1].text).toBe(round.records[1].text)
    expect(snapshot.coverage.includedConfirmedRecords).toBe(snapshot.coverage.totalConfirmedRecords)
    expect(snapshot.coverage.includedSourceRecords).toBe(snapshot.coverage.totalSourceRecords)
    for (const omitted of snapshot.coverage.omittedSuggestionIds) expect(round.records.find((item) => item.id === omitted)?.kind).toBe('ai_suggestion')
    for (const included of snapshot.records) expect(included.text).toBe(round.records.find((item) => item.id === included.id)?.text)
    expect(round.records).toHaveLength(15)
    const rendered = renderBehavioralSnapshot(snapshot)
    expect(rendered).toContain('AI suggestions omitted to fit the request')
    expect(rendered.length).toBeLessThan(MAX_BEHAVIORAL_SNAPSHOT_CHARS + 5_000)
  })

  it('retains a corrected suggestion even when older unrelated suggestions are omitted', () => {
    const round = createBehavioralRound()
    round.records.push(record(round, 0, 'ai_suggestion', 'Unsupported proposal: managed six engineers.'))
    for (let index = 1; index < 13; index++) round.records.push(record(round, index, 'ai_suggestion', 'Example wording. '.repeat(1_500)))
    round.records.push({ ...record(round, 13, 'correction', 'I did not manage engineers. I coordinated work.'), supersedes: 'record-0' })
    const snapshot = buildBehavioralSnapshot(round)
    expect(snapshot.coverage.omittedRecords).toBeGreaterThan(0)
    expect(snapshot.records.find((item) => item.id === 'record-0')).toBeDefined()
    expect(snapshot.records.at(-1)?.supersedes).toBe('record-0')
  })

  it('refuses overfull confirmed evidence instead of silently dropping early or later facts', () => {
    const round = createBehavioralRound()
    round.records = Array.from({ length: 7 }, (_, index) => record(round, index, 'candidate_note', `${index}: ${'f'.repeat(30_000)}`))
    expect(() => buildBehavioralSnapshot(round)).toThrow('no confirmed facts have been silently omitted')
    expect(round.records).toHaveLength(7)
  })

  it('bounds the archive by record count and encoded bytes without silently evicting records', () => {
    const round = createBehavioralRound()
    round.records = Array.from({ length: MAX_BEHAVIORAL_RECORDS + 1 }, (_, index) => record(round, index, 'candidate_note', 'A real note.'))
    expect(() => parseBehavioralRound(round)).toThrow('up to 500 records')
    round.records = Array.from({ length: 50 }, (_, index) => record(round, index, 'candidate_note', '漢'.repeat(20_000)))
    expect(() => parseBehavioralRound(round)).toThrow('storage limit')
  })
})

describe('behavioral snapshot validation', () => {
  it.each([null, undefined, [], {}, { version: 2 }])('rejects malformed root %j', (value) => {
    expect(() => parseBehavioralSnapshot(value)).toThrow()
  })
  it('rejects forged coverage, unresolved corrections, duplicate IDs, omitted provenance and extra fields', () => {
    const round = createBehavioralRound()
    round.records = [record(round, 0, 'confirmed_answer', 'I tested the rollback.'), record(round, 1, 'ai_suggestion', 'Suggested follow-up wording.')]
    const valid = buildBehavioralSnapshot(round)
    const invalid: unknown[] = []
    invalid.push({ ...clone(valid), extra: 'instruction' })
    invalid.push({ ...clone(valid), revision: -1 })
    invalid.push({ ...clone(valid), profile: { ...valid.profile, questionStyle: 'invent-persona' } })
    invalid.push({ ...clone(valid), coverage: { ...valid.coverage, includedRecords: 1 } })
    invalid.push({ ...clone(valid), records: [valid.records[0], { ...valid.records[1], id: valid.records[0].id }] })
    const noProvenance = clone(valid)
    delete (noProvenance.records[1] as { contextProfile?: unknown }).contextProfile
    invalid.push(noProvenance)
    invalid.push({ ...clone(valid), records: [{ ...valid.records[0], kind: 'correction', supersedes: 'missing-source' }, valid.records[1]] })
    invalid.push({ ...clone(valid), records: [{ ...valid.records[0], text: 'Bad\u0000control' }, valid.records[1]] })
    for (const input of invalid) expect(() => parseBehavioralSnapshot(input)).toThrow()
    expect(parseBehavioralSnapshot(clone(valid))).toEqual(valid)
  })
})
