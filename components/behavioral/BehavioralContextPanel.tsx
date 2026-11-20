'use client'

import { useId, useMemo, useState } from 'react'
import { Check, ChevronDown, Download, History, RotateCcw } from 'lucide-react'
import { BEHAVIORAL_PROFILE_LIMITS, buildBehavioralSnapshot, type BehavioralProfile, type BehavioralRecord } from '@/lib/behavioral/session'
import type { useBehavioralSession } from '@/lib/behavioral/useBehavioralSession'

type Session = ReturnType<typeof useBehavioralSession>
const fieldClass = 'mt-1 min-h-11 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 py-2 text-sm font-normal text-ink'
const labelClass = 'block text-xs font-semibold text-ink'
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[color:var(--line)] px-3 py-2 text-xs font-medium hover:bg-[color:var(--surface-soft)] disabled:opacity-50'

export function BehavioralContextPanel({ session, onBeforeChange, onNewRound, latestQuestion = '', persistent = false, sourceNotice }: {
  session: Session
  onBeforeChange: () => void
  onNewRound: () => void
  latestQuestion?: string
  persistent?: boolean
  sourceNotice?: string | null
}) {
  const { round, ready } = session
  const [recording, setRecording] = useState(false)
  const [correction, setCorrection] = useState<BehavioralRecord | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const recorded = round.records.filter((record) => record.kind === 'confirmed_answer' || record.kind === 'correction')
  const suggestions = round.records.filter((record) => record.kind === 'ai_suggestion')
  const latestSuggestion = suggestions.at(-1)
  const coverage = useMemo(() => {
    if (!ready) return { snapshot: null, error: null }
    try { return { snapshot: buildBehavioralSnapshot(round), error: null } }
    catch (error) { return { snapshot: null, error: error instanceof Error ? error.message : 'Round context is too large. Export it and start a new round.' } }
  }, [round, ready])
  const history = showAll ? round.records : round.records.slice(-12)
  const companyLabel = [round.profile.company, round.profile.role].filter(Boolean).join(' · ')

  const download = () => {
    setExportError(null)
    let url: string | undefined
    try {
      url = URL.createObjectURL(new Blob([session.exportSession()], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `behavioral-round-${new Date(round.createdAt).toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch { setExportError('Could not export this round. Your context remains available here.') }
    finally { if (url) { const href = url; setTimeout(() => URL.revokeObjectURL(href), 1_000) } }
  }

  return <section aria-label="Behavioral round context" className="border-b border-[color:var(--line)] px-4 py-4 sm:px-6">
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Behavioral context</h2>
          <p className="mt-1 break-words text-xs text-[color:var(--muted)]">{companyLabel || 'Add the company, role and your own work style.'}</p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">{recorded.length} recorded answer{recorded.length === 1 ? '' : 's'} · {suggestions.length} AI suggestion{suggestions.length === 1 ? '' : 's'}</p>
        </div>
        <button type="button" disabled={!session.ready} onClick={() => { setCorrection(null); setRecording((value) => !value); setSaved(null) }} aria-expanded={recording} className={buttonClass}><Check size={14} aria-hidden />Record my answer</button>
      </div>
      <p role="status" className="mt-2 text-[11px] leading-relaxed text-[color:var(--muted)]">{!session.ready ? 'Loading round context…' : coverage.error ? coverage.error : coverage.snapshot?.coverage.complete ? 'All retained round context is included in the next answer.' : `${coverage.snapshot?.coverage.omittedRecords ?? 0} older AI suggestions will be omitted from the next request. Recorded answers and source evidence are retained.`} {persistent ? 'Saved for this account in this tab.' : 'Kept while this workspace is open.'}</p>
      {session.notice && <p role="alert" className="mt-2 text-xs text-[color:var(--stop)]">{session.notice}</p>}
      {sourceNotice && <p role="status" className="mt-2 text-xs text-[color:var(--muted)]">{sourceNotice}</p>}
      <details className="mt-3 rounded-lg border border-[color:var(--line)]">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-xs font-semibold">Company, role and your work style<ChevronDown size={14} aria-hidden className="ml-auto" /></summary>
        <div className="border-t border-[color:var(--line)] p-3">
          <ProfileForm key={JSON.stringify(round.profile)} profile={round.profile} onSave={(profile) => { onBeforeChange(); if (session.updateProfile(profile)) setSaved('Behavioral context updated for the next answer.') }} />
        </div>
      </details>
      {recording && <ActualAnswerForm key={`${round.id}:${correction?.id ?? 'actual-answer'}`} question={correction?.question || latestQuestion || latestSuggestion?.question || ''}
        suggestion={correction?.text || (latestSuggestion?.question === latestQuestion || !latestQuestion ? latestSuggestion?.text : '') || ''}
        correcting={!!correction} onCancel={() => { setRecording(false); setCorrection(null) }} onSave={(question, text) => {
          onBeforeChange()
          const ok = session.addRecord({ kind: correction ? 'correction' : 'confirmed_answer', question, text, ...(correction ? { supersedes: correction.id } : {}) })
          if (ok !== false) { setRecording(false); setCorrection(null); setSaved('Your answer is recorded and will ground the next question.') }
        }} />}
      {saved && <p role="status" className="mt-2 text-xs text-[color:var(--signal)]">{saved}</p>}
      <details className="mt-2">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-[color:var(--muted)]"><History size={14} aria-hidden />Round history and controls ({round.records.length})</summary>
        <p className="mb-3 text-[11px] leading-relaxed text-[color:var(--muted)]">Recorded answers are what you tell us you answered. AI suggestions stay separate. Corrections preserve the earlier wording and identify what changed. Company expectations guide relevant emphasis; they do not establish a hidden scoring key.</p>
        <ol className="max-h-80 space-y-2 overflow-y-auto">
          {[...history].reverse().map((record) => <li key={record.id} className="rounded-lg border border-[color:var(--line)] p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{record.kind === 'confirmed_answer' ? 'Your recorded answer' : record.kind === 'correction' ? 'Your correction' : record.kind === 'ai_suggestion' ? 'AI suggestion · unconfirmed' : record.kind === 'source_context' ? 'Provided source context' : 'Your note'}</span>
              {(record.kind === 'confirmed_answer' || record.kind === 'correction' || record.kind === 'candidate_note') && <button type="button" onClick={() => { setCorrection(record); setRecording(true); setSaved(null) }} className="min-h-9 px-2 text-[color:var(--signal)] underline underline-offset-4">Correct this</button>}
            </div>
            {record.question && <p className="mt-1 font-medium leading-relaxed">{record.question}</p>}
            <details className="mt-1"><summary className="cursor-pointer text-[color:var(--muted)]">Read saved text</summary><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{record.text}</p></details>
            {record.kind === 'ai_suggestion' && record.contextProfile && <p className="mt-2 text-[11px] text-[color:var(--muted)]">Context when generated: {[record.contextProfile.company, record.contextProfile.role].filter(Boolean).join(' · ') || 'No company specified'} · revision {record.contextRevision}</p>}
          </li>)}
        </ol>
        {!showAll && round.records.length > 12 && <button type="button" onClick={() => setShowAll(true)} className="mt-2 min-h-11 text-xs text-[color:var(--signal)]">Show all {round.records.length} records</button>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={download} className={buttonClass}><Download size={14} aria-hidden />Export round</button>
          <button type="button" disabled={!session.ready} onClick={() => { onNewRound(); setRecording(false); setCorrection(null); setShowAll(false); setSaved('New round started. Company and work style are retained.'); }} className={buttonClass}><RotateCcw size={14} aria-hidden />New behavioral round</button>
        </div>
        <p className="mt-2 text-[11px] text-[color:var(--muted)]">A new round clears this answer history and stops pending answers. Export first if you want to keep a copy.</p>
        {exportError && <p role="alert" className="mt-2 text-xs text-[color:var(--stop)]">{exportError}</p>}
      </details>
    </div>
  </section>
}

function ProfileForm({ profile, onSave }: { profile: BehavioralProfile; onSave: (profile: BehavioralProfile) => void }) {
  const [draft, setDraft] = useState(profile)
  const id = useId()
  const set = <K extends keyof BehavioralProfile>(field: K, value: BehavioralProfile[K]) => setDraft((current) => ({ ...current, [field]: value }))
  return <form onSubmit={(event) => { event.preventDefault(); onSave(draft) }} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={labelClass} htmlFor={`${id}-company`}>Company<input id={`${id}-company`} value={draft.company} maxLength={200} onChange={(event) => set('company', event.target.value)} placeholder="Company name" className={fieldClass} /></label>
      <label className={labelClass} htmlFor={`${id}-role`}>Target role<input id={`${id}-role`} value={draft.role} maxLength={200} onChange={(event) => set('role', event.target.value)} placeholder="Role or team" className={fieldClass} /></label>
    </div>
    <label className={labelClass} htmlFor={`${id}-expectations`}>Company and role expectations<textarea id={`${id}-expectations`} value={draft.expectations} maxLength={BEHAVIORAL_PROFILE_LIMITS.expectations} onChange={(event) => set('expectations', event.target.value)} rows={3} placeholder="Paste the relevant job description, company values or interviewer guidance." className={fieldClass} /></label>
    <label className={labelClass} htmlFor={`${id}-self`}>Your actual work style and facts<textarea id={`${id}-self`} value={draft.selfDescription} maxLength={BEHAVIORAL_PROFILE_LIMITS.selfDescription} onChange={(event) => set('selfDescription', event.target.value)} rows={3} placeholder="For example: I prefer preparation, work well with feedback, and ask for help when a risk is unclear. Add only facts and preferences that describe you." className={fieldClass} /></label>
    <label className={labelClass} htmlFor={`${id}-kind`}>Question type<select id={`${id}-kind`} value={draft.questionStyle} onChange={(event) => set('questionStyle', event.target.value as BehavioralProfile['questionStyle'])} className={fieldClass}><option value="interview">Behavioral interview</option><option value="assessment">Personality or situational judgment</option></select></label>
    <p className="text-[11px] leading-relaxed text-[color:var(--muted)]">The next answer uses these details together with your resume, source stories and retained round history. Personality guidance uses your stated preferences and the current question wording.</p>
    <button type="submit" className="btn-signal min-h-11 px-4 text-sm">Save behavioral context</button>
  </form>
}

function ActualAnswerForm({ question: initialQuestion, suggestion, correcting, onSave, onCancel }: {
  question: string; suggestion: string; correcting: boolean
  onSave: (question: string, answer: string) => void; onCancel: () => void
}) {
  const id = useId()
  const [question, setQuestion] = useState(initialQuestion)
  const [answer, setAnswer] = useState(correcting ? suggestion : '')
  const [sourceSuggestion] = useState(suggestion)
  return <form onSubmit={(event) => { event.preventDefault(); if (question.trim() && answer.trim()) onSave(question.trim(), answer.trim()) }} className="mt-3 space-y-3 rounded-lg border border-[color:var(--line)] p-3">
    <h3 className="text-sm font-semibold">{correcting ? 'Correct your earlier answer' : 'Record what you actually answered'}</h3>
    <label className={labelClass} htmlFor={`${id}-question`}>Question<textarea id={`${id}-question`} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2_000} rows={2} className={fieldClass} required /></label>
    <label className={labelClass} htmlFor={`${id}-answer`}>{correcting ? 'Corrected answer and what changed' : 'Your actual answer or selected option text'}<textarea id={`${id}-answer`} value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={16_000} rows={3} className={fieldClass} placeholder="Use the option text or the words you actually said. Include context if your answer depends on the situation." required /></label>
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={!question.trim() || !answer.trim()} className="btn-signal min-h-11 px-4 text-sm disabled:opacity-50">{correcting ? 'Save correction' : 'Save actual answer'}</button>
      {!correcting && sourceSuggestion && <button type="button" onClick={() => setAnswer(sourceSuggestion)} className={buttonClass}>Use suggested text to edit</button>}
      <button type="button" onClick={onCancel} className={buttonClass}>Cancel</button>
    </div>
    <p className="text-[11px] text-[color:var(--muted)]">This records your report in this round. It does not select or submit an answer on another website.</p>
  </form>
}
