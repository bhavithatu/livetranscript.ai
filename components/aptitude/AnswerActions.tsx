'use client'

import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import styles from './AptitudeWorkspace.module.css'

/** Confidence is supplied by a model, never derived from agreement or arithmetic. */
export function AnswerConfidence({ confidence }: { confidence: number | null | undefined }) {
  const rated = typeof confidence === 'number' && Number.isInteger(confidence) && confidence >= 0 && confidence <= 100
  return <div className={styles.confidence}>
    <span>Model confidence</span>
    <strong>{rated ? `${confidence}%` : 'Not rated'}</strong>
    <small>{rated ? 'Uncalibrated estimate' : 'No model estimate supplied'}</small>
  </div>
}

export function CopyAnswer({ text, subject, compact = false }: { text: string; subject?: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'manual'>('idle')
  const copying = useRef(false)
  const copy = async () => {
    if (copying.current) return
    copying.current = true
    setState('copying')
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('manual')
    } finally {
      copying.current = false
    }
  }
  const label = subject ? state === 'copied' ? `${subject} answer copied` : `Copy ${subject} answer` : undefined
  return <div className={`${styles.answerActions} ${compact ? styles.compactActions : ''}`}>
    {/* Native disabled buttons lose focus while the clipboard promise is pending. */}
    <button type="button" className={compact ? 'btn-ghost' : 'btn-signal'} aria-label={label} onClick={() => void copy()} aria-disabled={state === 'copying'}>
      {state === 'copied' ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      {state === 'copying' ? 'Copying…' : state === 'copied' ? compact ? 'Copied' : 'Answer copied' : 'Copy answer'}
    </button>
    {(!compact || state === 'manual') && <p className={styles.muted} role={state === 'copied' || state === 'manual' ? 'status' : undefined}>
      {state === 'manual' ? 'Clipboard access is unavailable. Copy the selected answer below.'
        : state === 'copied' ? 'Copied. Choose or paste it on the question page.'
          : 'Choose the answer on the question page. Screen sharing cannot click it for you.'}
    </p>}
    {state === 'manual' && <label className={styles.copyFallback}>{subject ? `${subject} answer to copy` : 'Answer to copy'}
      <textarea autoFocus readOnly value={text} rows={2} onFocus={(event) => event.currentTarget.select()} />
    </label>}
  </div>
}
