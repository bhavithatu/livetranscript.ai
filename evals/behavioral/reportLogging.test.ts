import { describe, expect, it } from 'vitest'
import { BEHAVIORAL_REPORT_LOG_MAX_BYTES, behavioralReportLogLines, behavioralReportSourceCommit } from './reportLogging'
import { BEHAVIORAL_CONSISTENCY_FIXTURES } from './fixtures'
import { buildBehavioralSnapshot } from '@/lib/behavioral/session'

function reconstruct(lines: string[]): unknown {
  const chunks = lines.map((line, index) => {
    const match = /^\[behavioral-consistency-eval\] \[part (\d+)\/(\d+)\] ([\s\S]*)$/.exec(line)
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBe(index + 1)
    expect(Number(match![2])).toBe(lines.length)
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(BEHAVIORAL_REPORT_LOG_MAX_BYTES)
    return match![3]
  })
  return JSON.parse(chunks.join(''))
}

describe('behavioral deployment report logging', () => {
  it('reconstructs compact JSON exactly with stable numbered parts and multibyte text', () => {
    const report = { answer: ('Quoted "answer"\n14% → 40% • café 中文 🧭 ' + 'x'.repeat(503)).repeat(60), semanticReview: 'pending', correct: null }
    const lines = behavioralReportLogLines(report)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every(line => !line.includes('\n') && !line.includes('\uFFFD'))).toBe(true)
    expect(reconstruct(lines)).toEqual(report)
    expect(behavioralReportLogLines(report)).toEqual(lines)
  })

  it('fits all six authored snapshots and representative complete answers below 100 log events', () => {
    const report = { rows: BEHAVIORAL_CONSISTENCY_FIXTURES.map(fixture => ({
      question: fixture.question, evidence: buildBehavioralSnapshot(fixture.round),
      answer: 'A grounded answer with a brief consistency explanation. '.repeat(120),
      reviewCriteria: fixture.reviewCriteria,
    })) }
    const lines = behavioralReportLogLines(report)
    expect(lines.length).toBeLessThan(100)
    expect(reconstruct(lines)).toEqual(report)
  })

  it('includes only a validated Vercel commit identity and handles absent metadata', () => {
    expect(behavioralReportSourceCommit({})).toBeNull()
    expect(behavioralReportSourceCommit({ VERCEL_GIT_COMMIT_SHA: 'not-a-commit' })).toBeNull()
    expect(behavioralReportSourceCommit({ VERCEL_GIT_COMMIT_SHA: 'A'.repeat(40) })).toBe('a'.repeat(40))
    expect(behavioralReportSourceCommit({ VERCEL_GIT_COMMIT_SHA: 'f'.repeat(39) })).toBeNull()
  })
})
