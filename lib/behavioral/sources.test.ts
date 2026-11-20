import { describe, expect, it } from 'vitest'
import { BEHAVIORAL_SOURCES_PREFIX, parseBehavioralSources, serializeBehavioralSources } from './sources'

describe('labeled original behavioral sources', () => {
  it('round trips whole blocks with exact wording and associations', () => {
    const shared = 'I tested the rollback.\n\nThe result was 18 percent.'
    const sources = [{ label: 'Resume', text: 'Actual experience.\n' }, { label: 'Story Alpha', text: shared }, { label: 'Story Beta', text: shared }]
    expect(parseBehavioralSources(serializeBehavioralSources(sources))).toEqual(sources)
  })
  it('keeps legacy plain context as one exact source and rejects malformed marked bundles', () => {
    const plain = 'STORY Alpha\n\nExact source wording.\n'
    expect(parseBehavioralSources(plain)).toEqual([{ label: 'Original supplied context', text: plain }])
    expect(() => parseBehavioralSources(`${BEHAVIORAL_SOURCES_PREFIX}{broken`)).toThrow('malformed')
    expect(() => parseBehavioralSources(`${BEHAVIORAL_SOURCES_PREFIX}${JSON.stringify([{ label: 'Story', text: 'Claim', confirmed: true }])}`)).toThrow('exact text')
  })
  it('rejects malformed or overlarge source blocks instead of silently truncating them', () => {
    expect(() => serializeBehavioralSources([{ label: 'Story', text: 'x'.repeat(120_001) }])).toThrow('120,000')
    expect(() => serializeBehavioralSources([{ label: 'l'.repeat(161), text: 'Actual text' }])).toThrow('160')
    expect(() => serializeBehavioralSources([{ label: 'Story', text: '' }])).toThrow('non-empty')
    expect(parseBehavioralSources(serializeBehavioralSources([]))).toEqual([])
  })
})
