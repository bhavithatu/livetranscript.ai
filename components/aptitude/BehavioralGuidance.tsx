import type { AptitudeComparisonCandidate, AptitudeObservation } from '@/lib/aptitude/schema'
import { parseBehavioralAdvice } from '@/lib/aptitude/behavioralAdvice'
import { ExplanationSources } from './ExplanationSources'
import styles from './AptitudeWorkspace.module.css'

const RESPONSE_MEANINGS: Record<string, string> = {
  'strongly agree': 'The statement as written closely describes your usual behavior.',
  agree: 'The statement as written generally describes you.',
  neutral: 'Your experience is mixed or genuinely between agreement and disagreement.',
  'neither agree nor disagree': 'Your experience is mixed or genuinely between agreement and disagreement.',
  disagree: 'The statement as written generally does not describe you.',
  'strongly disagree': 'The statement as written is strongly unlike your usual behavior.',
}

export function BehavioralGuidance({ observations, active = false, candidates }: { observations: AptitudeObservation[]; active?: boolean; candidates?: AptitudeComparisonCandidate[] }) {
  const situational = observations.some(o => o.category === 'situational_judgment')
  const explanations = [...new Set(observations.map(o => o.message?.trim()).filter((text): text is string => !!text))]
  const options = situational ? [] : observations[0]?.question?.options ?? []
  const mappedOptions = options.filter(o => RESPONSE_MEANINGS[o.text.toLowerCase().trim()])
  return <section className={styles.guidance} aria-label="Behavioral guidance">
    <div className={styles.guidanceHeader}><h3>Section 2 · Behavioral assessment</h3>{active && <span className={styles.badge}>More analysis pending</span>}</div>
    <h4 className={styles.guidanceAnswer}>{situational ? 'A constructive response.' : 'Find the response that fits.'}</h4>
    <p className={styles.behavioralIntro}>{situational
      ? 'Situational judgment may use an assessment-specific scoring rubric. No scoring key has been provided here.'
      : 'A personality statement asks about your usual behavior. There is no universal correct choice.'}</p>
    {explanations.length > 1 && <p className={styles.behavioralIntro}>Separate model responses are shown below. They have not been combined into one recommendation.</p>}
    {explanations.map((text, i) => {
      const advice = parseBehavioralAdvice(text)
      return advice ? <section className={styles.behavioralAdvice} aria-label={explanations.length > 1 ? `Behavioral response ${i + 1}` : 'Behavioral response'} key={i}>
        <ExplanationSources message={text} candidates={candidates} />
        <div className={styles.behavioralSuggestion}><h5>Suggested response</h5><p>{advice.suggestedResponse}</p></div>
        <div><h5>What this may assess</h5><p>{advice.assessedBehavior}</p></div>
        <div><h5>Constructive behavior</h5><p>{advice.constructiveBehavior}</p></div>
      </section> : <section className={styles.guidanceExplanation} aria-label="Question explanation" key={i}><ExplanationSources message={text} candidates={candidates} /><p>{text}</p></section>
    })}
    {mappedOptions.length === options.length && options.length > 0 && <section className={styles.guidanceExplanation} aria-label="How to choose your response">
      <h5>Which response fits?</h5>
      <ul>{mappedOptions.map(o => <li key={o.id}><strong>{o.text}:</strong> {RESPONSE_MEANINGS[o.text.toLowerCase().trim()]}</li>)}</ul>
    </section>}
    <ol className={styles.behavioralSteps}>
      <li>Read the exact wording, including “not,” “rarely,” and “always.”</li>
      <li>Think of real, recent examples in the context the question specifies.</li>
      <li>Choose the response that honestly fits. Similar statements can differ in context; do not force matching answers.</li>
    </ol>
    <p className={styles.guidanceSource}>Correctness confidence: Not applicable · Difficulty: Not rated</p>
  </section>
}
