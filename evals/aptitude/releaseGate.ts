import { parseAptitudeResult, type AptitudeResult } from '@/lib/aptitude/schema'
import type { AptitudeFixture } from './fixtures'
import { scoreAptitude, scoreAptitudeComparison, type AptitudeScore } from './score'

export const APTITUDE_RELEASE_FIXTURE_IDS = [
  'visual-star-points', 'visual-star-increasing-differences', 'visual-grid-quarter-turns', 'visual-grid-cropped-choices',
] as const
export const APTITUDE_RELEASE_MAX_CALLS = 12

export type AptitudeReleaseFailure = { code: string; modelId?: string }
export type AptitudeReleaseFixtureCheck = {
  passed: boolean
  failures: AptitudeReleaseFailure[]
  selectionResolved: boolean
  conservativeAbstention: boolean
  publishedAnswerCorrect: boolean | null
  candidates: { modelId: string; passed: boolean; score: AptitudeScore | null }[]
}

/** Independent fixture truth is used only after the production path returns. */
export function assessAptitudeReleaseFixture(fixture: AptitudeFixture, raw: unknown, modelIds: readonly string[], imageHash: string): AptitudeReleaseFixtureCheck {
  const failures: AptitudeReleaseFailure[] = []
  const result: AptitudeReleaseFixtureCheck = { passed: false, failures, selectionResolved: false, conservativeAbstention: false, publishedAnswerCorrect: null, candidates: [] }
  let analysis: AptitudeResult
  try { analysis = parseAptitudeResult(raw) } catch { failures.push({ code: 'INVALID_RESULT' }); return result }
  if (analysis.sourceHash !== imageHash) failures.push({ code: 'SOURCE_IMAGE_MISMATCH' })
  const comparison = analysis.comparison
  if (!comparison) { failures.push({ code: 'MISSING_COMPARISON' }); return result }
  const actualIds = comparison.candidates.map(candidate => candidate.modelId).sort()
  if (modelIds.length < 2 || modelIds.length > 3 || new Set(modelIds).size !== modelIds.length || actualIds.length !== modelIds.length || JSON.stringify(actualIds) !== JSON.stringify([...modelIds].sort())) {
    failures.push({ code: 'MODEL_SET_MISMATCH' })
  }
  const comparisonScore = scoreAptitudeComparison(fixture, analysis)
  for (const candidate of comparison.candidates) {
    const score = comparisonScore?.candidateScores.find(item => item.modelId === candidate.modelId)?.score ?? null
    const before = failures.length
    const fail = (code: string) => failures.push({ code, modelId: candidate.modelId })
    if (candidate.status !== 'complete' || !score?.schemaValid) fail(candidate.status === 'timed_out' ? 'MODEL_TIMEOUT' : 'MODEL_ERROR')
    else if (fixture.expected.status === 'solved') {
      if (candidate.observation?.status !== 'solved') fail('OBJECTIVE_NOT_SOLVED')
      else if (!score.answerCorrect) fail('WRONG_OBJECTIVE_ANSWER')
      if (score.evidenceReview?.reviewRequired) fail('EVIDENCE_REVIEW_REQUIRED')
    } else {
      if (candidate.observation?.status !== 'needs_capture' || candidate.observation.answer !== null || !score.answerCorrect) fail('INCORRECT_CAPTURE_ABSTENTION')
    }
    result.candidates.push({ modelId: candidate.modelId, passed: failures.length === before, score })
  }
  result.selectionResolved = comparison.selectedModelId !== null
  if (fixture.expected.status === 'solved') {
    if (analysis.status === 'solved') {
      result.publishedAnswerCorrect = scoreAptitude(fixture, analysis).answerCorrect
      if (!result.publishedAnswerCorrect) failures.push({ code: 'PUBLISHED_WRONG_ANSWER' })
    } else {
      // Literal evidence reconciliation can withhold otherwise correct candidates.
      // This is reported, never counted as a published correct answer.
      result.conservativeAbstention = analysis.answer === null && result.candidates.length === modelIds.length && result.candidates.every(candidate => candidate.passed)
    }
  } else if (analysis.answer !== null || analysis.status === 'solved' || result.selectionResolved) {
    failures.push({ code: 'PUBLISHED_BOUNDARY_ANSWER' })
  }
  result.passed = failures.length === 0
  return result
}

/** Never copy provider messages, response bodies, headers, URLs, or arbitrary codes into a public report. */
export function safeAptitudeProviderError(error: unknown, aborted = false): { code: string; status: number | null } {
  const item = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const status = Number.isInteger(item.status) && Number(item.status) >= 100 && Number(item.status) <= 599 ? Number(item.status) : null
  if (aborted) return { code: 'ABORTED_OR_DEADLINE', status }
  if (item.message === 'Incomplete provider response') return { code: 'INCOMPLETE_RESPONSE', status }
  if (item.name === 'APIConnectionTimeoutError' || item.name === 'TimeoutError') return { code: 'PROVIDER_TIMEOUT', status }
  if (item.name === 'APIConnectionError') return { code: 'PROVIDER_CONNECTION_ERROR', status }
  const allowed = new Set(['model_not_found', 'not_found_error', 'invalid_request_error', 'authentication_error', 'permission_error',
    'rate_limit_error', 'rate_limit_exceeded', 'insufficient_quota', 'overloaded_error', 'api_error', 'server_error',
    'MODEL_CONFIGURATION', 'PROVIDER_UNAVAILABLE', 'ANALYSIS_TIMEOUT', 'ANALYSIS_CANCELLED', 'ANALYSIS_FAILED'])
  const nested = item.error && typeof item.error === 'object' ? item.error as Record<string, unknown> : {}
  const inner = nested.error && typeof nested.error === 'object' ? nested.error as Record<string, unknown> : {}
  const code = [item.code, item.type, nested.type, nested.code, inner.type].find(value => typeof value === 'string' && allowed.has(value))
  return { code: typeof code === 'string' ? code : status ? `HTTP_${status}` : 'PROVIDER_ERROR', status }
}
