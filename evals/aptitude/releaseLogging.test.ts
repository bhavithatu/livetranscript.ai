// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { APTITUDE_RELEASE_LOG_MAX_BYTES, aptitudeReleaseLogLines } from './releaseLogging'

const context = { fixtureId: 'visual-grid-quarter-turns', modelId: 'anthropic:fixture-model', item: 12 }
const reconstruct = (lines: string[]) => JSON.parse(lines.map(line => line.replace(/^.*? \[part \d+\/\d+\] /, '')).join(''))

describe('bounded release diagnostics (no model calls)', () => {
  it('keeps the exact failed rubric, validation diagnostic and safe metadata in separate readable events', () => {
    const metadata = { validated: true, diagnostic: { code: 'VALID', structuralCounts: { evidenceItems: 12, workedSteps: 3, options: 4 } } }
    const score = { answerCorrect: true, evidenceReview: { reviewRequired: true,
      checks: [{ id: 'three-squares-rotate', description: 'Tracks rotation of three filled squares rather than changing square counts.', passed: false }] } }
    const candidateLines = aptitudeReleaseLogLines('candidate', context, metadata)
    const scoreLines = aptitudeReleaseLogLines('score', context, score)
    expect(candidateLines).toHaveLength(1)
    expect(scoreLines).toHaveLength(1)
    expect(reconstruct(candidateLines)).toEqual(metadata)
    expect(reconstruct(scoreLines)).toEqual(score)
    expect(scoreLines[0]).toContain('three-squares-rotate')
    expect(scoreLines[0]).toContain('"passed":false')
  })

  it.each(['evidence', 'explanation', 'option'] as const)('preserves every character of a maximum-size %s item including Unicode and escapes', section => {
    const text = 'Filled “green” square 🟩; "label" \\ row\n'.repeat(100).slice(0, 2_000)
    const lines = aptitudeReleaseLogLines(section, context, { text })
    expect(lines.length).toBeGreaterThan(1)
    for (const [index, line] of lines.entries()) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(APTITUDE_RELEASE_LOG_MAX_BYTES)
      expect(line.length).toBeLessThanOrEqual(2_000)
      expect(line).toContain(JSON.stringify(context))
      expect(line).toContain(`[part ${index + 1}/${lines.length}]`)
      expect(line).not.toContain('\n')
    }
    expect(reconstruct(lines)).toEqual({ text })
  })

  it('keeps later evidence and a second model identifiable after a long first item', () => {
    const sources = [
      { context, text: 'first diagram evidence '.repeat(90) },
      { context: { ...context, item: 13 }, text: 'The next panel keeps three squares.' },
      { context: { ...context, modelId: 'openai:second-fixture-model', item: 1 }, text: 'The filled cells rotate clockwise.' },
    ]
    for (const source of sources) {
      const lines = aptitudeReleaseLogLines('evidence', source.context, { text: source.text })
      expect(lines.every(line => line.includes(JSON.stringify(source.context)))).toBe(true)
      expect(reconstruct(lines)).toEqual({ text: source.text })
    }
  })
})
