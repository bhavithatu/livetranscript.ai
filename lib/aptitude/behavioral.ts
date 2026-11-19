import type { AptitudeComparisonCandidate } from './schema'

/** The legacy wire status means an explanatory response, not a UI dead end. */
export function explanationObservations(candidates: AptitudeComparisonCandidate[]) {
  const observations = candidates.filter(c => c.status === 'complete').map(c => c.observation)
  if (!observations.length || observations.some(o => !o || o.status !== 'unsupported'
    || o.question?.missingEvidence.length)) return null
  return observations.filter(o => o !== null)
}

/** Preserve objective answers and capture errors when models disagree on type. */
export function behavioralObservations(candidates: AptitudeComparisonCandidate[]) {
  const observations = explanationObservations(candidates)
  if (!observations || observations.some(o => !['personality', 'situational_judgment'].includes(o.category)
    || !o.question || o.question.missingEvidence.length)) return null
  return observations.filter(o => o !== null)
}
