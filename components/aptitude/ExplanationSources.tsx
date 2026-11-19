import type { AptitudeComparisonCandidate } from '@/lib/aptitude/schema'
import styles from './AptitudeWorkspace.module.css'

/** Keep each explanatory response attributable, including identical responses. */
export function ExplanationSources({ message, candidates }: { message: string; candidates?: AptitudeComparisonCandidate[] }) {
  const labels = [...new Set((candidates ?? []).filter(candidate => candidate.status === 'complete'
    && candidate.observation?.message?.trim() === message).map(candidate =>
    `${candidate.provider === 'anthropic' ? 'Claude' : 'OpenAI'} · ${candidate.model ?? candidate.modelId}`))]
  return labels.length ? <p className={styles.guidanceSource}>Response from {labels.join(' · ')}</p> : null
}
