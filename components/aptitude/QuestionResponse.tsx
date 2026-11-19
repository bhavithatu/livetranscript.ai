import type { AptitudeComparisonCandidate, AptitudeObservation } from '@/lib/aptitude/schema'
import { ExplanationSources } from './ExplanationSources'
import styles from './AptitudeWorkspace.module.css'

export function QuestionResponse({ observations, active, candidates }: { observations: AptitudeObservation[]; active: boolean; candidates?: AptitudeComparisonCandidate[] }) {
  const messages = [...new Set(observations.map(o => o.message?.trim()).filter((text): text is string => !!text))]
  return <section className={styles.guidance} aria-label="Question response">
    <div className={styles.guidanceHeader}><h3>Question response</h3>{active && <span className={styles.badge}>More analysis pending</span>}</div>
    {messages.length > 1 && <p className={styles.behavioralIntro}>Separate model responses are shown below. They have not been combined into one recommendation.</p>}
    {messages.map((message, i) => <div key={i}><ExplanationSources message={message} candidates={candidates} /><p className={styles.behavioralIntro}>{message}</p></div>)}
    <p className={styles.guidanceSource}>This response is explanatory. No checked answer choice or correctness confidence is available.</p>
  </section>
}
