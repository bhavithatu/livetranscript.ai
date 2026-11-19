import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { solvedObservation } from '@/lib/aptitude/testFixtures'
import { buildAnswerGuidance } from '@/lib/aptitude/guidance'
import { canonicalAptitudeOptionLabel, selectAptitudeComparison } from '@/lib/aptitude/comparison'
import { parseAptitudeComparisonCandidate, parseAptitudeObservation, type AptitudeComparisonCandidate, type AptitudeStatus, type AptitudeVerification } from '@/lib/aptitude/schema'
import { APTITUDE_SELECTION_FIXTURES, APTITUDE_SELECTION_FIXTURE_HASH } from './selectionFixtures'

export type ReplayAttempt = {
  fixtureId: string; modelId: string; returnedModel: string | null; provider: 'openai' | 'anthropic';
  outcome: string; validated: boolean; durationMs: number | null; sourceImageMatches: boolean | null;
  imageHash: string; providerObservation: unknown; verification: AptitudeVerification | null; message: string | null;
  evidenceReviewRequired: boolean;
  answer: { status: AptitudeStatus; labels: string[]; value: string | null; confidence: number | null } | null;
}

/** Rebuild the final checked response, never resurrect the provider's rejected answer. */
export function checkedReplayCandidate(attempt: ReplayAttempt): AptitudeComparisonCandidate {
  const base = { modelId: attempt.modelId, model: attempt.returnedModel, provider: attempt.provider,
    durationMs: attempt.durationMs ?? 0 }
  if (attempt.outcome !== 'complete' || !attempt.validated || !attempt.answer || !attempt.verification) {
    return parseAptitudeComparisonCandidate({ ...base, status: 'failed', observation: null, verification: null, error: 'Recorded evaluation did not produce a validated final result.' })
  }
  if (attempt.sourceImageMatches !== true) throw new Error(`Unverified input image: ${attempt.fixtureId}/${attempt.modelId}`)
  const original = parseAptitudeObservation(attempt.providerObservation)
  const status = attempt.answer.status
  if (status === 'error') throw new Error('A completed validated attempt cannot have an error observation')
  if (status === 'solved') {
    if (original.status !== 'solved' || !original.answer) throw new Error('Final solved answer has no matching provider observation')
    const labels = original.answer.selectedOptionIds.map(id => original.question!.options.find(o => o.id === id)!.label)
    if (JSON.stringify(labels) !== JSON.stringify(attempt.answer.labels) || original.answer.value !== attempt.answer.value || (original.answer.confidence ?? null) !== attempt.answer.confidence) throw new Error('Recorded final answer differs from provider observation')
  }
  return parseAptitudeComparisonCandidate({ ...base, status: 'complete',
    observation: { ...original, status, answer: status === 'solved' ? original.answer : null,
      message: status === 'solved' ? original.message : attempt.message }, verification: attempt.verification, error: null })
}

const input = process.env.APTITUDE_QUALITY_REPLAY_INPUT
const output = process.env.APTITUDE_QUALITY_REPLAY_OUTPUT
it.skipIf(!input || !output)('replays final checked candidate pairs against original fixture answers without provider calls', () => {
  const raw = readFileSync(input!, 'utf8')
  const report = JSON.parse(raw) as { fixtureHash: string; complete: boolean; attempts: ReplayAttempt[]; promptHash?: string; commit?: string }
  expect(report.complete).toBe(true)
  expect(report.fixtureHash).toBe(APTITUDE_SELECTION_FIXTURE_HASH)
  const rows = APTITUDE_SELECTION_FIXTURES.map(fixture => {
    const attempts = report.attempts.filter(a => a.fixtureId === fixture.id)
    expect(attempts).toHaveLength(2)
    expect(new Set(attempts.map(a => a.modelId)).size).toBe(2)
    expect(new Set(attempts.map(a => a.imageHash)).size).toBe(1)
    const candidates = attempts.map(checkedReplayCandidate)
    const guide = buildAnswerGuidance(candidates)
    const strict = selectAptitudeComparison(candidates)
    const selectedLabels = (candidate: AptitudeComparisonCandidate | null) => (candidate?.observation?.answer?.selectedOptionIds ?? [])
      .map(id => canonicalAptitudeOptionLabel(candidate!.observation!.question!.options.find(o => o.id === id)!.label)).sort()
    const expected = [...fixture.expected.selectedLabels].sort()
    const recommendedLabels = selectedLabels(guide.candidate), strictLabels = selectedLabels(strict.selected)
    const selectedAttempt = attempts.find(a => a.modelId === guide.candidate?.modelId)
    const isObjective = fixture.expected.status === 'solved'
    const recommendationCorrect = isObjective && !!guide.candidate && JSON.stringify(recommendedLabels) === JSON.stringify(expected)
    return { fixtureId: fixture.id, domain: fixture.domain, expectedStatus: fixture.expected.status, expectedLabels: expected,
      candidateStatuses: candidates.map(c => ({ modelId: c.modelId, status: c.observation?.status ?? c.status, verification: c.verification })),
      recommendedModelId: guide.candidate?.modelId ?? null, recommendedLabels, confidence: guide.confidenceScore, label: guide.label,
      difficulty: guide.difficulty.level, recommendationCorrect: isObjective ? recommendationCorrect : null,
      recommendationEvidenceReviewRequired: selectedAttempt?.evidenceReviewRequired ?? null,
      evidenceSupportedRecommendationCorrect: isObjective ? recommendationCorrect && selectedAttempt?.evidenceReviewRequired === false : null,
      boundaryNoAnswer: !isObjective ? guide.candidate === null : null,
      strictDecision: strict.comparison.decision, strictModelId: strict.selected?.modelId ?? null, strictLabels,
      strictCorrect: isObjective ? !!strict.selected && JSON.stringify(strictLabels) === JSON.stringify(expected) : null,
      reasons: guide.reasons }
  })
  const objective = rows.filter(r => r.expectedStatus === 'solved'), boundary = rows.filter(r => r.expectedStatus !== 'solved')
  const summary = { objectiveQuestions: objective.length,
    correctRecommendedAnswers: objective.filter(r => r.recommendationCorrect).length,
    wrongRecommendedAnswers: objective.filter(r => r.recommendedModelId && !r.recommendationCorrect).length,
    missingRecommendedAnswers: objective.filter(r => !r.recommendedModelId).length,
    evidenceSupportedCorrectRecommendations: objective.filter(r => r.evidenceSupportedRecommendationCorrect).length,
    recommendedAnswersFlaggedForEvidenceReview: objective.filter(r => r.recommendationEvidenceReviewRequired).length,
    strictCorroboratedCorrect: objective.filter(r => r.strictCorrect).length,
    strictCorroboratedWrong: objective.filter(r => r.strictModelId && !r.strictCorrect).length,
    boundaryQuestions: boundary.length, boundaryNoAnswer: boundary.filter(r => r.boundaryNoAnswer).length,
    decisions: Object.fromEntries(['agreement','majority','disagreement','insufficient'].map(key => [key, rows.filter(r => r.strictDecision === key).length])) }
  writeFileSync(output!, JSON.stringify({ version: 1, scope: 'offline-replay-of-fresh-live-single-model-results', newModelCalls: 0,
    sourceSha256: createHash('sha256').update(raw).digest('hex'), sourceCommit: report.commit ?? null,
    promptHash: report.promptHash ?? null, fixtureHash: report.fixtureHash, summary, rows,
    limitations: ['Replays checked single-model responses through comparison selection; does not rerun providers or measure concurrent request latency.',
      'These twelve original fixtures are regression cases, not a new holdout or general accuracy estimate.',
      'Answer-key correctness and evidence quality are reported separately. Confidence remains a heuristic, not calibrated accuracy.'] }, null, 2) + '\n')
  console.info(JSON.stringify(summary))
})

function recordedAttempt(): ReplayAttempt {
  return { fixtureId: 'original-fixture', modelId: 'openai:fixture', returnedModel: 'fixture', provider: 'openai',
    outcome: 'complete', validated: true, durationMs: 12, sourceImageMatches: true, imageHash: 'same-image',
    providerObservation: solvedObservation(), verification: { method: 'arithmetic', outcome: 'passed', notes: [] },
    message: null, evidenceReviewRequired: false, answer: { status: 'solved', labels: ['B'], value: '25', confidence: null } }
}
it('does not restore a provider answer withheld by final arithmetic verification', () => {
  const attempt = recordedAttempt()
  attempt.answer = { status: 'ambiguous', labels: [], value: null, confidence: null }
  attempt.message = 'The calculation and proposed answer disagree.'
  attempt.verification = { method: 'arithmetic', outcome: 'disagreed', notes: ['Mismatch'] }
  const candidate = checkedReplayCandidate(attempt)
  expect(candidate.observation?.answer).toBeNull()
  expect(candidate.observation?.status).toBe('ambiguous')
  expect(buildAnswerGuidance([candidate]).candidate).toBeNull()
})
it('rejects a changed final answer instead of silently using the raw provider choice', () => {
  const attempt = recordedAttempt()
  attempt.answer!.labels = ['A']
  expect(() => checkedReplayCandidate(attempt)).toThrow('differs from provider observation')
})
it('does not promote an unvalidated provider response', () => {
  const attempt = recordedAttempt()
  attempt.validated = false
  expect(checkedReplayCandidate(attempt)).toMatchObject({ status: 'failed', observation: null })
})
