import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseAptitudeObservation, type AptitudeComparisonCandidate } from '@/lib/aptitude/schema'
import { verifyAptitudeObservation } from '@/lib/aptitude/verify'
import { buildAnswerGuidance } from '@/lib/aptitude/guidance'
import { canonicalAptitudeOptionLabel, selectAptitudeComparison } from '@/lib/aptitude/comparison'
import { APTITUDE_SELECTION_FIXTURES, APTITUDE_SELECTION_FIXTURE_HASH } from './selectionFixtures'
import { checkedReplayCandidate, type ReplayAttempt } from './qualityReplay'

const input = process.env.APTITUDE_CALCULATION_REPLAY_INPUT
const output = process.env.APTITUDE_CALCULATION_REPLAY_OUTPUT
const labels = (c: AptitudeComparisonCandidate | null) => (c?.observation?.answer?.selectedOptionIds ?? [])
  .map(id => canonicalAptitudeOptionLabel(c!.observation!.question!.options.find(o => o.id === id)!.label)).sort()
it.skipIf(!input || !output)('rechecks original saved provider responses with the corrected claim verifier without new calls', () => {
  const raw = readFileSync(input!, 'utf8'), source = JSON.parse(raw) as { complete: boolean; fixtureHash: string; promptHash: string; commit: string; attempts: ReplayAttempt[] }
  expect(source.complete).toBe(true); expect(source.fixtureHash).toBe(APTITUDE_SELECTION_FIXTURE_HASH)
  const attempts = source.attempts.map(attempt => {
    const before = checkedReplayCandidate(attempt)
    const after = before.status === 'complete' ? { ...before, ...verifyAptitudeObservation(parseAptitudeObservation(attempt.providerObservation)) } : before
    const fixture = APTITUDE_SELECTION_FIXTURES.find(f => f.id === attempt.fixtureId)!
    const correct = (c: AptitudeComparisonCandidate) => fixture.expected.status === 'solved'
      ? c.observation?.status === 'solved' && JSON.stringify(labels(c)) === JSON.stringify([...fixture.expected.selectedLabels].sort())
      : c.observation?.status === fixture.expected.status && c.observation.answer === null
    return { fixtureId: attempt.fixtureId, modelId: attempt.modelId, expectedStatus: fixture.expected.status,
      before, after, beforeCorrect: correct(before), afterCorrect: correct(after),
      changed: JSON.stringify(before) !== JSON.stringify(after), evidenceReviewRequired: attempt.evidenceReviewRequired }
  })
  const modelCounts = [...new Set(attempts.map(a => a.modelId))].map(modelId => {
    const modelAttempts = attempts.filter(a => a.modelId === modelId), objective = modelAttempts.filter(a => a.expectedStatus === 'solved')
    return { modelId, objectiveQuestions: objective.length,
      beforeCorrect: objective.filter(a => a.beforeCorrect).length, afterCorrect: objective.filter(a => a.afterCorrect).length,
      beforeWithheld: objective.filter(a => a.before.observation?.status !== 'solved').length,
      afterWithheld: objective.filter(a => a.after.observation?.status !== 'solved').length,
      boundaryQuestions: modelAttempts.length - objective.length,
      boundaryCorrect: modelAttempts.filter(a => a.expectedStatus !== 'solved' && a.afterCorrect).length }
  })
  const selectionRows = APTITUDE_SELECTION_FIXTURES.map(fixture => {
    const pair = attempts.filter(a => a.fixtureId === fixture.id)
    const select = (kind: 'before' | 'after') => {
      const candidates = pair.map(a => a[kind]), guide = buildAnswerGuidance(candidates), strict = selectAptitudeComparison(candidates)
      const selectedLabels = labels(guide.candidate), expected = [...fixture.expected.selectedLabels].sort()
      return { modelId: guide.candidate?.modelId ?? null, labels: selectedLabels, confidence: guide.confidenceScore,
        label: guide.label, strictDecision: strict.comparison.decision,
        correct: fixture.expected.status === 'solved' ? !!guide.candidate && JSON.stringify(selectedLabels) === JSON.stringify(expected) : guide.candidate === null,
        evidenceReviewRequired: pair.find(a => a.modelId === guide.candidate?.modelId)?.evidenceReviewRequired ?? null }
    }
    return { fixtureId: fixture.id, expectedStatus: fixture.expected.status, before: select('before'), after: select('after') }
  })
  const objective = selectionRows.filter(r => r.expectedStatus === 'solved'), boundaries = selectionRows.filter(r => r.expectedStatus !== 'solved')
  const summary = { modelCounts, changedAttempts: attempts.filter(a => a.changed).length,
    objectiveRecommendationsBefore: objective.filter(r => r.before.correct).length,
    objectiveRecommendationsAfter: objective.filter(r => r.after.correct).length,
    evidenceSupportedRecommendationsAfter: objective.filter(r => r.after.correct && r.after.evidenceReviewRequired === false).length,
    objectiveQuestions: objective.length, boundaryQuestions: boundaries.length, boundaryCorrectAfter: boundaries.filter(r => r.after.correct).length }
  writeFileSync(output!, JSON.stringify({ version: 1, scope: 'offline-reverification-of-saved-original-provider-responses',
    sourceSha256: createHash('sha256').update(raw).digest('hex'), sourceCommit: source.commit, sourcePromptHash: source.promptHash,
    newModelCalls: 0, correction: 'Allow bounded decimal truncation only in unrounded calculation claims; exact answer/option mapping remains unchanged.',
    summary, changedAttempts: attempts.filter(a => a.changed), selectionRows,
    limitations: ['This is local re-verification of existing paid-call results, not a fresh model evaluation.',
      'The source report and prior recommendation replay remain unchanged.',
      'The grid inventory evidence warning remains unresolved; correct selected answers do not prove every source observation correct.'] }, null, 2) + '\n')
  console.info(JSON.stringify(summary))
})
