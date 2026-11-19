import type { ReactNode } from 'react'
import type { AptitudeComparison as Comparison, AptitudeComparisonCandidate, AptitudeVerification } from '@/lib/aptitude/schema'
import { comparisonAnswersMatch } from '@/lib/aptitude/comparison'
import { formatAptitudeOption } from './formatOption'
import styles from './AptitudeWorkspace.module.css'

const DECISIONS = {
  agreement: 'Models agree', majority: 'Majority agreement',
  disagreement: 'Models disagree', insufficient: 'Comparison incomplete',
} as const

function modelName(candidate: AptitudeComparisonCandidate) {
  return candidate.model || candidate.modelId.replace(/^(?:anthropic|openai):/, '')
}

function Check({ verification }: { verification: AptitudeVerification }) {
  const title = verification.method === 'arithmetic'
    ? verification.outcome === 'passed' ? 'Calculation matches' : verification.outcome === 'disagreed' ? 'Calculation needs review' : 'Calculation not checked'
    : 'No independent correctness check'
  return <div className={styles.candidateCheck}>
    <p><strong>{title}</strong></p>
    <p>{verification.method === 'arithmetic'
      ? 'Arithmetic only. It does not verify image reading, rule choice or the final answer’s correctness.'
      : 'This response relies on the model’s reading and reasoning.'}</p>
    {verification.notes.length > 0 && <ul>{verification.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
  </div>
}

function ModelCard({ candidate, selected }: { candidate: AptitudeComparisonCandidate; selected: boolean }) {
  const observation = candidate.observation
  const answer = observation?.answer
  const choices = observation?.question?.options.filter((option) => answer?.selectedOptionIds.includes(option.id)) ?? []
  const choice = choices.length ? choices.map(formatAptitudeOption).join(' · ')
    : answer?.value ? `${answer.value}${answer.unit ? ` ${answer.unit}` : ''}` : null
  const status = candidate.status === 'timed_out' ? 'Timed out' : candidate.status === 'failed' ? 'Failed'
    : observation?.status === 'needs_capture' ? 'Needs another capture' : observation?.status === 'ambiguous' ? 'Uncertain'
      : observation?.status === 'unsupported' ? 'Unsupported question' : 'Complete'
  return <article className={styles.modelCard} aria-label={candidate.modelId} data-selected={selected}>
    <header className={styles.modelHeader}>
      <div><p className={styles.eyebrow}>{candidate.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</p><h4>{modelName(candidate)}</h4></div>
      <span className={styles.badge}>{selected ? 'Answer shown' : status}</span>
    </header>
    <p className={styles.modelTiming}>Response time {candidate.durationMs < 1000 ? `${Math.round(candidate.durationMs)} ms` : `${(candidate.durationMs / 1000).toFixed(1)} s`}</p>
    {answer && observation?.status === 'solved' && <div className={styles.modelAnswer}>
      <p className={styles.eyebrow}>Model answer</p>
      {choice && <p className={styles.modelChoice}>{choice}</p>}
      <p>{answer.summary}</p>
    </div>}
    {observation?.message && <p className={styles.candidateMessage}>{observation.message}</p>}
    {candidate.error && <p className={styles.candidateError}>{candidate.error}</p>}
    {candidate.verification && <Check verification={candidate.verification} />}
    {observation && <details className={styles.candidateDetails}>
      <summary>Explanation & evidence</summary>
      {answer?.workedExplanation.length ? <ol>{answer.workedExplanation.map((step, index) => <li key={index}>{step}</li>)}</ol> : null}
      {answer?.calculation && <p className={styles.candidateCalculation}><span>Stated calculation</span><code>{answer.calculation.expression} = {answer.calculation.claimedValue}</code></p>}
      {answer?.evidence.length ? <><h5>Evidence used</h5><ul>{answer.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
      {observation.question && <>
        <h5>Question read by this model</h5><p>{observation.question.stem}</p>
        {observation.question.instructions.length > 0 && <ul>{observation.question.instructions.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        {observation.question.passage && <blockquote>{observation.question.passage}</blockquote>}
        {observation.question.options.length > 0 && <ul>{observation.question.options.map((option) => <li key={option.id}>{formatAptitudeOption(option)}</li>)}</ul>}
        {observation.question.missingEvidence.length > 0 && <><h5>Missing from this capture</h5><ul>{observation.question.missingEvidence.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      </>}
    </details>}
  </article>
}

/** The comparison and its selected answer share one visible, accessible group. */
export function AptitudeComparison({ comparison, children }: { comparison: Comparison; children?: ReactNode }) {
  const selected = comparison.candidates.find((candidate) => candidate.modelId === comparison.selectedModelId)
  const resolved = (comparison.decision === 'agreement' || comparison.decision === 'majority') && !!selected
  const sameAnswerNeedsReview = comparison.decision === 'disagreement' && comparisonAnswersMatch(comparison.candidates)
  return <section className={styles.comparison} aria-label="Model comparison">
    <div className={styles.comparisonBanner} data-resolved={resolved}>
      <p className={styles.eyebrow}>Same capture · {comparison.candidates.length} models</p>
      <h3>{sameAnswerNeedsReview ? 'Same answer, evidence needs review' : DECISIONS[comparison.decision]}</h3>
      <p>{resolved
        ? `${comparison.agreementCount} of ${comparison.candidates.length} models support the same answer. The response shown below is from ${modelName(selected!)}.`
        : sameAnswerNeedsReview
          ? 'The answer values match, but the question, diagram evidence or option mapping could not be reconciled. No answer is selected; inspect the exact capture and both readings.'
        : comparison.decision === 'disagreement'
          ? 'No answer is selected. The models disagree; inspect their individual reasoning and the captured evidence.'
          : 'No answer is selected. Too few usable model results are available to compare.'}</p>
      {resolved && <p className={styles.muted}>Agreement helps compare responses; it does not prove the answer is correct.</p>}
      {comparison.notes.length > 0 && <details className={styles.checkDetails}><summary>How these answers were compared</summary><ul>{comparison.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
    </div>
    {resolved ? children : null}
    <div className={styles.modelResultsHeading}><h3>Individual model results</h3><p>Each model request uses the same captured image. Its answer, checks and response time stay together.</p></div>
    <div className={styles.modelGrid}>{comparison.candidates.map((candidate) => <ModelCard key={candidate.modelId} candidate={candidate} selected={resolved && candidate.modelId === comparison.selectedModelId} />)}</div>
  </section>
}
