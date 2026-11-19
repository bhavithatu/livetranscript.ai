import type { AptitudeComparison as Comparison, AptitudeComparisonCandidate, AptitudeVerification } from '@/lib/aptitude/schema'
import { comparisonAnswersMatch } from '@/lib/aptitude/comparison'
import { AnswerConfidence, CopyAnswer } from './AnswerActions'
import { formatAptitudeOption } from './formatOption'
import styles from './AptitudeWorkspace.module.css'

const DECISIONS = {
  agreement: 'Models agree', majority: 'Majority agreement',
  disagreement: 'Models disagree', insufficient: 'Comparison incomplete',
} as const

type ModelDescriptor = { modelId: string; model: string; provider: 'anthropic' | 'openai' }
type Progress = { models: ModelDescriptor[]; candidates: AptitudeComparisonCandidate[] }
const INITIAL_MODELS: ModelDescriptor[] = [
  { modelId: 'pending:anthropic', model: 'Connecting…', provider: 'anthropic' },
  { modelId: 'pending:openai', model: 'Connecting…', provider: 'openai' },
]
const providerName = (provider: 'anthropic' | 'openai') => provider === 'anthropic' ? 'Claude' : 'OpenAI'
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
const modelName = (candidate: AptitudeComparisonCandidate) => candidate.model || candidate.modelId.replace(/^(?:anthropic|openai):/, '')

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
  const answer = observation?.status === 'solved' ? observation.answer : null
  const choices = observation?.question?.options.filter((option) => answer?.selectedOptionIds.includes(option.id)) ?? []
  const choice = choices.length ? choices.map(formatAptitudeOption).join(' · ')
    : answer?.value ? `${answer.value}${answer.unit ? ` ${answer.unit}` : ''}` : answer?.summary ?? null
  const provider = providerName(candidate.provider)
  const status = candidate.status === 'timed_out' ? 'Timed out' : candidate.status === 'failed' ? 'Failed'
    : observation?.status === 'needs_capture' ? 'Needs capture' : observation?.status === 'ambiguous' ? 'Uncertain'
      : observation?.status === 'unsupported' ? 'Unsupported' : 'Answer ready'
  return <article className={styles.modelCard} aria-label={candidate.modelId} data-selected={selected}>
    <header className={styles.modelHeader}>
      <div><h3>{provider}</h3><p className={styles.modelIdentity}>{modelName(candidate)}</p></div>
      <span className={styles.badge}>{status}</span>
    </header>
    {answer && choice ? <>
      <div className={styles.modelAnswer}>
        <p className={styles.modelChoice}>{choice}</p>
        <AnswerConfidence confidence={answer.confidence} />
      </div>
      <div className={styles.modelActions}>
        <CopyAnswer key={`${candidate.modelId}:${choice}`} text={choice} subject={provider} compact />
        <p className={styles.modelTiming}>Response time {duration(candidate.durationMs)}</p>
      </div>
    </> : <>
      <p className={styles.noModelAnswer}>No answer supplied</p>
      {observation?.message && <p className={styles.candidateMessage}>{observation.message}</p>}
      {candidate.error && <p className={styles.candidateError}>{candidate.error}</p>}
      <p className={styles.modelTiming}>Response time {duration(candidate.durationMs)}</p>
    </>}
    {observation && <details className={styles.candidateDetails}>
      <summary>Explanation & checks</summary>
      {answer && <p>{answer.summary}</p>}
      {answer?.workedExplanation.length ? <ol>{answer.workedExplanation.map((step, index) => <li key={index}>{step}</li>)}</ol> : null}
      {candidate.verification && <Check verification={candidate.verification} />}
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

function PendingCard({ model, active }: { model: ModelDescriptor; active: boolean }) {
  return <article className={`${styles.modelCard} ${styles.pendingModel}`} aria-label={model.modelId} aria-busy={active}>
    <header className={styles.modelHeader}><div><h3>{providerName(model.provider)}</h3><p className={styles.modelIdentity}>{model.model}</p></div><span className={styles.badge}>{active ? 'Analyzing' : 'Not completed'}</span></header>
    <p className={styles.noModelAnswer}>{active ? 'Waiting for this model…' : 'No completed response'}</p>
    <p className={styles.modelTiming}>{active ? 'Its answer will appear here immediately.' : 'Retry this capture to request a new analysis.'}</p>
  </article>
}

function ConfidenceNote() {
  return <p className={styles.confidenceNote}>Confidence is each model’s uncalibrated estimate, not measured accuracy. Compare the capture and checks.</p>
}

/** Keep one stable card per provider from the first response through completion. */
export function AptitudeComparison({ comparison, progress, active = false }: {
  comparison?: Comparison; progress?: Progress | null; active?: boolean
}) {
  const models = comparison?.candidates ?? (progress?.models.length ? progress.models : INITIAL_MODELS)
  const candidates = comparison?.candidates ?? progress?.candidates ?? []
  const selected = comparison?.candidates.find(candidate => candidate.modelId === comparison.selectedModelId)
  const resolved = !!comparison && (comparison.decision === 'agreement' || comparison.decision === 'majority') && !!selected
  const sameAnswerNeedsReview = comparison?.decision === 'disagreement' && comparisonAnswersMatch(comparison.candidates)
  return <section className={styles.comparison} aria-label="Model comparison">
    <div className={styles.modelGrid} aria-live="polite" aria-relevant="additions text">
      {models.map(model => {
        const candidate = candidates.find(item => item.modelId === model.modelId)
        return candidate ? <ModelCard key={model.modelId} candidate={candidate} selected={resolved && candidate.modelId === comparison?.selectedModelId} />
          : <PendingCard key={model.modelId} model={{ ...model, model: model.model ?? model.modelId }} active={active} />
      })}
    </div>
    <ConfidenceNote />
    {comparison ? <div className={styles.comparisonBanner} data-resolved={resolved}>
      <h3>{sameAnswerNeedsReview ? 'Same answer, evidence needs review' : DECISIONS[comparison.decision]}</h3>
      <p>{resolved
        ? `${comparison.agreementCount} of ${comparison.candidates.length} models support the same answer. Agreement does not prove the answer is correct.`
        : sameAnswerNeedsReview
          ? 'The answer values match, but their question, diagram evidence or option mapping could not be reconciled. No combined answer is selected.'
          : comparison.decision === 'disagreement'
            ? 'No combined answer is selected. Compare the model answers and their captured evidence.'
            : 'Too few usable model results are available. Any completed answer remains above for review.'}</p>
      {comparison.notes.length > 0 && <details className={styles.checkDetails}><summary>How these answers were compared</summary><ul>{comparison.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
    </div> : !active && <p className={styles.comparisonStatus}>Comparison did not finish. Returned model answers are kept for review; no combined answer is selected.</p>}
  </section>
}
