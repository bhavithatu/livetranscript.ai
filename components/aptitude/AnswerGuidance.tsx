import type { AptitudeComparisonCandidate } from '@/lib/aptitude/schema'
import { buildAnswerGuidance } from '@/lib/aptitude/guidance'
import { behavioralObservations, explanationObservations } from '@/lib/aptitude/behavioral'
import { BehavioralGuidance } from './BehavioralGuidance'
import { QuestionResponse } from './QuestionResponse'
import { formatAptitudeOption } from './formatOption'
import { CopyAnswer } from './AnswerActions'
import styles from './AptitudeWorkspace.module.css'

export function AnswerGuidance({ candidates, active = false, single = false }: { candidates: AptitudeComparisonCandidate[]; active?: boolean; single?: boolean }) {
  const behavioral = behavioralObservations(candidates)
  if (behavioral) return <BehavioralGuidance observations={behavioral} active={active} candidates={candidates} />
  const explanations = explanationObservations(candidates)
  if (explanations) return <QuestionResponse observations={explanations} active={active} candidates={candidates} />
  const guide = buildAnswerGuidance(candidates, active)
  const answer = guide.candidate?.observation?.answer
  const options = guide.candidate?.observation?.question?.options ?? []
  const choices = options.filter(o => answer?.selectedOptionIds.includes(o.id))
  const text = choices.length ? choices.map(formatAptitudeOption).join(' · ')
    : answer?.value ? `${answer.value}${answer.unit ? ` ${answer.unit}` : ''}` : answer?.summary
  return <section className={styles.guidance} aria-label="Answer recommendation">
    <div className={styles.guidanceHeader}><h3>{guide.label}</h3>{guide.provisional && <span className={styles.badge}>Provisional</span>}</div>
    <div className={styles.guidanceSummary}>
    {text && <h4 className={styles.guidanceAnswer}>{text}</h4>}
    <div className={styles.guidanceMetrics}>
      <p><span>Confidence</span><strong>{guide.confidenceScore}/100</strong><small>Heuristic, not measured accuracy</small></p>
      <p><span>Difficulty</span><strong>{guide.difficulty.level}</strong><small>Estimated locally</small></p>
    </div>
    </div>
    {guide.candidate && <p className={styles.guidanceSource}>{guide.candidate.provider === 'anthropic' ? 'Claude' : 'OpenAI'} · {guide.candidate.model ?? guide.candidate.modelId}</p>}
    {answer?.workedExplanation.length ? <section className={styles.guidanceExplanation} aria-label="Worked explanation"><ol>{answer.workedExplanation.map((step, i) => <li key={i}>{step}</li>)}</ol></section> : null}
    {text && <CopyAnswer key={`${guide.candidate?.modelId}:${text}`} text={text} subject={single ? undefined : "recommended"} compact={!single} />}
    <details className={styles.checkDetails}><summary>Why this answer and difficulty?</summary>
      <p>{guide.confidenceBasis}</p><ul>{guide.reasons.map((r,i) => <li key={i}>{r}</li>)}</ul>
      <p>Difficulty is a rough estimate of reading and constraint load, not your ability or time to solve.</p>
      <ul>{guide.difficulty.reasons.map((r,i) => <li key={i}>{r}</li>)}</ul>
      <p>Calculated locally from existing results. No extra model request or tracking event is added. The source website can still record its own activity.</p>
    </details>
  </section>
}
