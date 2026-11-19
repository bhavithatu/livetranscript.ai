'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import type { AptitudeSessionEntry } from '@/lib/aptitude/useAptitudeSession'
import { APTITUDE_CATEGORY_LABELS, type AptitudeResult, type AptitudeStrategy } from '@/lib/aptitude/schema'
import { AptitudeComparison } from './AptitudeComparison'
import { formatAptitudeOption } from './formatOption'
import { AnswerGuidance } from './AnswerGuidance'
import { resultCandidates } from '@/lib/aptitude/guidance'
import { behavioralObservations, explanationObservations } from '@/lib/aptitude/behavioral'
import styles from './AptitudeWorkspace.module.css'

function Elapsed({ entry }: { entry: AptitudeSessionEntry }) {
  const [now, setNow] = useState(entry.startedAt)
  useEffect(() => {
    if (entry.status !== 'analyzing') return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [entry.startedAt, entry.status])
  const elapsed = entry.elapsedMs ?? Math.max(0, now - entry.startedAt)
  return <span className={styles.timing}>{(elapsed / 1000).toFixed(1)} s {entry.status === 'analyzing' ? 'elapsed' : 'total'}</span>
}

export function aptitudeEntryLabel(entry: AptitudeSessionEntry, index?: number) {
  return `Capture ${index === undefined ? new Date(entry.capture.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : index + 1}`
}

export function aptitudeStrategyLabel(strategy: AptitudeStrategy) {
  return strategy === 'compare' ? 'Compare models' : 'Single model'
}

export function aptitudeEntryStatus(entry: AptitudeSessionEntry) {
  if (entry.status === 'analyzing') return entry.strategy === 'compare' ? entry.progress?.candidates.length ? `${entry.progress.candidates.length} of ${entry.progress.models.length} responses ready` : 'Comparing models' : 'Analyzing'
  if (entry.status === 'cancelled') return 'Stopped'
  if (entry.status === 'error') return 'Could not finish'
  if (entry.result && behavioralObservations(resultCandidates(entry.result))) return 'Behavioral guidance ready'
  if (entry.result?.comparison?.candidates.some(candidate => candidate.observation?.status === 'solved')) return 'Model answers ready'
  return { solved: 'Answer ready', needs_capture: 'Needs another capture', ambiguous: 'Uncertain', unsupported: 'Explanation ready', error: 'Could not finish' }[entry.result?.status ?? 'error']
}

function SuggestedAnswer({ result }: { result: AptitudeResult }) {
  const answer = result.answer
  if (!answer || result.status !== 'solved') return null
  return <>
    <section className={styles.verification} aria-label="Answer check">
      <h3>{result.verification.outcome === 'passed' ? 'Calculation matches' : result.verification.outcome === 'disagreed' ? 'Calculation needs review' : 'Answer review'}</h3>
      <p className={styles.muted}>{result.verification.method === 'arithmetic' ? 'Arithmetic only. This does not verify that the image was read correctly or that the chosen rule is valid.' : result.verification.method === 'source_review' ? 'Review against captured evidence' : 'No independent check was available.'}</p>
      {result.verification.notes.length > 0 && <details className={styles.checkDetails}><summary>Check details</summary><ul>{result.verification.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
    </section>
  </>
}

export function AptitudeAnswer({ entry, index, retryStrategy, onRetry, onStop, onCapture }: {
  entry: AptitudeSessionEntry; index: number
  retryStrategy?: AptitudeStrategy
  onRetry: () => void; onStop: () => void; onCapture: () => void
}) {
  const result = entry.result
  const question = result?.question
  const comparison = result?.comparison
  const recommendationAllowed = !comparison || (comparison.decision === 'agreement' || comparison.decision === 'majority') && !!comparison.selectedModelId
  const answer = recommendationAllowed ? result?.answer : null
  const suggestedAnswer = answer && result ? <SuggestedAnswer key={`${entry.id}-${entry.questionVersion}`} result={result} /> : null
  return <article className={styles.answer} aria-label="Question analysis">
    <header className={styles.answerHeader}>
      <div>
        <p className={styles.eyebrow}>{aptitudeEntryLabel(entry, index)}{result ? ` · ${APTITUDE_CATEGORY_LABELS[result.category]}` : ''}</p>
        <h2>{aptitudeEntryStatus(entry)}</h2>
      </div>
      <div className={styles.timingSummary}>
        <Elapsed key={`${entry.id}-${entry.questionVersion}`} entry={entry} />
        {entry.progress?.firstAnswerMs != null && <span>First answer {(entry.progress.firstAnswerMs / 1000).toFixed(1)} s</span>}
      </div>
    </header>
    <p className={styles.muted}>Captured <time dateTime={new Date(entry.capture.capturedAt).toISOString()}>{new Date(entry.capture.capturedAt).toLocaleTimeString()}</time> · Attempt {entry.questionVersion} · {aptitudeStrategyLabel(entry.strategy)}</p>

    {comparison || entry.strategy === 'compare' && (entry.status === 'analyzing' || entry.progress?.candidates.length)
      ? <AptitudeComparison key={`${entry.id}-${entry.questionVersion}`} comparison={comparison} progress={entry.progress} active={entry.status === 'analyzing'} />
      : <>{result && <AnswerGuidance key={`guidance-${entry.id}-${entry.questionVersion}`} candidates={resultCandidates(result)} single />} {suggestedAnswer}</>}
    {entry.status === 'analyzing' && <div className={entry.strategy === 'compare' ? styles.pendingCompact : styles.pending}>
      <p role="status">{entry.strategy === 'compare' ? 'Each model answer appears as soon as it is ready.' : 'Reading this capture and checking the answer…'}</p>
      <button type="button" className="btn-stop" onClick={onStop}>Stop analysis</button>
    </div>}
    {entry.status === 'cancelled' && <div className={styles.notice}><p>This analysis was stopped. The capture is available to retry.</p></div>}
    {entry.error && <div className={styles.error} role="alert">{entry.error}</div>}
    {result?.message && result.status !== 'error' && !comparison && !explanationObservations(resultCandidates(result)) && <div className={styles.notice}><p>{result.message}</p></div>}


    {question?.missingEvidence.length ? <section className={styles.notice} aria-label="Missing question content"><h3>Include in your next capture</h3><ul>{question.missingEvidence.map((item, i) => <li key={i}>{item}</li>)}</ul></section> : null}
    {(result?.status === 'needs_capture' || comparison?.candidates.some((candidate) => candidate.observation?.status === 'needs_capture')) && <button type="button" className="btn-signal" onClick={onCapture}>Capture a complete view</button>}

    <details className={styles.evidence}>
      <summary>What was captured & read</summary>
      <Image className={styles.captureImage} src={entry.capture.image} width={entry.capture.width} height={entry.capture.height} alt="Exact screenshot used for this question analysis" unoptimized />
      {question && <div className={styles.observed}>
        <h3>Observed question</h3><p>{question.stem}</p>
        {question.instructions.length > 0 && <ul>{question.instructions.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        {question.passage && <blockquote>{question.passage}</blockquote>}
        {question.options.length > 0 && <ul>{question.options.map((option) => <li key={option.id}>{formatAptitudeOption(option)}</li>)}</ul>}
        {answer?.evidence.length ? <><h3>Evidence used</h3><ul>{answer.evidence.map((item, i) => <li key={i}>{item}</li>)}</ul></> : null}
      </div>}
      {result?.model && <p className={styles.muted}>Analyzed with {result.model} · Service time {(result.durationMs / 1000).toFixed(1)} s</p>}
    </details>
    {entry.status !== 'analyzing' && <div className={styles.buttonRow}><button type="button" className="btn-ghost" onClick={onRetry}>Retry this capture</button>{retryStrategy && retryStrategy !== entry.strategy && <p className={styles.muted}>This retry uses {aptitudeStrategyLabel(retryStrategy)}.</p>}</div>}
  </article>
}
