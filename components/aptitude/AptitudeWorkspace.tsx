'use client'

import Image from 'next/image'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Camera, FlaskConical, Monitor, Pause, Play, Square, Upload } from 'lucide-react'
import { useScreenStream } from '@/lib/vision/useScreenStream'
import { useAptitudeCapture } from '@/lib/aptitude/useAptitudeCapture'
import { createAptitudeCapture, type AptitudeCapture, type NormalizedRegion } from '@/lib/aptitude/captureDetector'
import { APTITUDE_CATEGORIES, APTITUDE_CATEGORY_LABELS, type AptitudeCategorySelection } from '@/lib/aptitude/schema'
import { APTITUDE_HISTORY_LIMIT, useAptitudeSession } from '@/lib/aptitude/useAptitudeSession'
import { AptitudeAnswer, aptitudeEntryLabel, aptitudeEntryStatus } from './AptitudeAnswer'
import { createPracticeCapture, readCaptureFile } from './captureInput'
import { FULL_REGION, RegionControls } from './RegionControls'
import styles from './AptitudeWorkspace.module.css'

/** Content only; CopilotWorkspace owns route navigation and WorkspaceShell. */
export function AptitudeWorkspace() {
  const screen = useScreenStream()
  const session = useAptitudeSession()
  const { sampleFrame: sampleScreenFrame } = screen
  const { analyze } = session
  const [category, setCategory] = useState<AptitudeCategorySelection>('auto')
  const [automatic, setAutomatic] = useState(false)
  const [screenChanged, setScreenChanged] = useState(false)
  const [crop, setCrop] = useState<NormalizedRegion>(FULL_REGION)
  const [masks, setMasks] = useState<NormalizedRegion[]>([])
  const [preview, setPreview] = useState<AptitudeCapture | null>(null)
  const [previewSource, setPreviewSource] = useState<'screen' | 'upload' | 'practice'>('screen')
  const [notice, setNotice] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [readingFile, setReadingFile] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileRequest = useRef<AbortController | null>(null)
  const inputGeneration = useRef(0)
  const wasSharing = useRef(false)

  const sampleFrame = useCallback(() => sampleScreenFrame({ crop, masks }), [sampleScreenFrame, crop, masks])
  const onAutomaticCapture = useCallback((capture: AptitudeCapture) => {
    setScreenChanged(false)
    setPreview(capture)
    setPreviewSource('screen')
    setInputError(null)
    setNotice(null)
    void analyze(capture, category)
  }, [analyze, category])
  const watcher = useAptitudeCapture({ enabled: automatic && screen.sharing, sampleFrame, onCapture: onAutomaticCapture })

  // A browser Stop sharing action is an external lifecycle event, not a new capture.
  const onSharingEnded = useEffectEvent(() => {
    setAutomatic(false)
    session.stop()
  })
  useEffect(() => {
    if (wasSharing.current && !screen.sharing) onSharingEnded()
    wasSharing.current = screen.sharing
  }, [screen.sharing])
  useEffect(() => () => {
    inputGeneration.current += 1
    fileRequest.current?.abort()
  }, [])

  const pause = () => {
    if (automatic && screen.sharing && (watcher.status === 'settling' || watcher.status === 'unavailable')) setScreenChanged(true)
    setAutomatic(false)
    session.stop()
    setNotice(screen.sharing ? 'Automatic analysis is paused. Screen sharing remains on.' : 'Analysis is paused.')
  }

  const cancelInput = () => {
    inputGeneration.current += 1
    fileRequest.current?.abort()
    fileRequest.current = null
    setReadingFile(false)
  }

  const stopSharing = () => {
    cancelInput()
    if (automatic && (watcher.status === 'settling' || watcher.status === 'unavailable')) setScreenChanged(true)
    setAutomatic(false)
    session.stop()
    watcher.reset()
    screen.stop()
    setNotice('Screen sharing stopped. Your existing captures remain in this tab.')
  }

  const takeCapture = (analyze: boolean) => {
    setInputError(null)
    const sample = sampleFrame()
    if (sample.kind !== 'available') {
      setInputError(sample.reason || 'The shared screen is not ready. Try capturing again.')
      return
    }
    const capture = createAptitudeCapture(sample)
    setScreenChanged(false)
    setPreview(capture)
    setPreviewSource('screen')
    setNotice(analyze ? null : 'Preview ready. Review the question area, then analyze once or turn on automatic capture.')
    if (analyze) void session.analyze(capture, category)
  }

  const startSharing = async () => {
    cancelInput()
    const generation = inputGeneration.current
    setAutomatic(false)
    session.stop()
    watcher.reset()
    screen.stop()
    setPreview(null)
    setScreenChanged(false)
    setInputError(null)
    setNotice(null)
    await screen.start()
    if (generation !== inputGeneration.current) return
    const sample = sampleFrame()
    if (sample.kind === 'available') {
      setPreview(createAptitudeCapture(sample))
      setPreviewSource('screen')
      setNotice('Preview ready. Review the question area before starting automatic analysis.')
    }
  }

  const upload = async (file?: File) => {
    if (!file) return
    cancelInput()
    setAutomatic(false)
    session.stop()
    setPreview(null)
    setScreenChanged(false)
    setInputError(null)
    setNotice(null)
    const controller = new AbortController()
    fileRequest.current = controller
    const generation = inputGeneration.current
    setReadingFile(true)
    try {
      const capture = await readCaptureFile(file, controller.signal)
      if (generation !== inputGeneration.current || controller.signal.aborted) return
      setPreview(capture)
      setPreviewSource('upload')
      setNotice('Screenshot ready. Select Analyze this capture when you are ready.')
    } catch (cause) {
      if (generation === inputGeneration.current && !controller.signal.aborted) setInputError(cause instanceof Error ? cause.message : 'Could not open this screenshot.')
    } finally {
      if (generation === inputGeneration.current) {
        fileRequest.current = null
        setReadingFile(false)
      }
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const loadPractice = () => {
    cancelInput()
    setAutomatic(false)
    session.stop()
    setScreenChanged(false)
    setInputError(null)
    try {
      setPreview(createPracticeCapture())
      setPreviewSource('practice')
      setCategory('numerical')
      setNotice('Original practice question loaded. Analyze it to test the real AI service; no answer key is sent.')
    } catch (cause) { setInputError(cause instanceof Error ? cause.message : 'Practice preview is unavailable.') }
  }

  const clear = () => {
    cancelInput()
    setAutomatic(false)
    session.clear()
    watcher.reset()
    setPreview(null)
    setScreenChanged(false)
    setInputError(null)
    setNotice(screen.sharing ? 'History cleared. Screen sharing is still on; automatic analysis is paused.' : 'Captures and answers cleared.')
  }

  const autoOn = automatic && screen.sharing
  const awaitingCurrentCapture = screenChanged || autoOn && (watcher.status === 'settling' || watcher.status === 'unavailable')
  const watchMessage = !screen.sharing ? 'Screen sharing is off' : !autoOn ? 'Ready for manual capture' : {
    paused: 'Automatic capture paused', watching: 'Watching for a changed question', settling: 'Waiting for the question to settle', captured: 'New question captured', unavailable: 'Waiting for a readable screen',
  }[watcher.status]
  const currentIndex = session.selected ? session.entries.findIndex((item) => item.id === session.selected!.id) : -1
  const answerEntry = session.pinned ? session.selected : preview?.image === session.current?.capture.image ? session.current : null

  return <div className={styles.workspace}>
    <section className={styles.controls} aria-label="Aptitude capture controls">
      <div className={styles.controlHeading}>
        <div><h2>One question. Clear reasoning.</h2><p>Capture a complete question to see the answer, working and checks. Audio is optional and is not started here.</p></div>
        <label className={styles.category}>Question type
          <select value={category} onChange={(event) => setCategory(event.target.value as AptitudeCategorySelection)}>
            <option value="auto">Detect automatically</option>
            {APTITUDE_CATEGORIES.map((item) => <option key={item} value={item}>{APTITUDE_CATEGORY_LABELS[item]}</option>)}
          </select>
        </label>
      </div>
      <div className={styles.buttonRow}>
        <button type="button" className="btn-signal" onClick={() => screen.starting ? stopSharing() : void startSharing()} disabled={readingFile}>
          <Monitor size={16} aria-hidden />{screen.starting ? 'Cancel sharing setup' : screen.sharing ? 'Change shared screen' : 'Share screen'}
        </button>
        <button type="button" className="btn-ghost" disabled={!screen.sharing || readingFile} onClick={() => takeCapture(true)}><Camera size={16} aria-hidden />Capture now</button>
        <button type="button" className="btn-ghost" disabled={readingFile} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden />Upload screenshot</button>
        <input ref={fileInput} className={styles.hiddenInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload aptitude screenshot" onChange={(event) => void upload(event.target.files?.[0])} />
        {screen.sharing && <button type="button" className={autoOn ? 'btn-ghost' : 'btn-signal'} aria-pressed={autoOn} disabled={readingFile} onClick={() => {
          if (autoOn) { pause(); return }
          setNotice(null); setInputError(null); watcher.reset(); setAutomatic(true)
        }}>{autoOn ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}{autoOn ? 'Pause automatic capture' : 'Start automatic capture'}</button>}
        {(screen.sharing || screen.starting) && <button type="button" className="btn-stop" onClick={stopSharing}><Square size={14} aria-hidden />Stop sharing</button>}
        {readingFile && <button type="button" className="btn-ghost" onClick={cancelInput}>Cancel image loading</button>}
      </div>
      <div className={styles.captureStatus} role="status"><span className={`${styles.dot} ${screen.sharing ? styles.dotActive : ''}`} aria-hidden />{screen.starting ? 'Choose a source in the browser sharing dialog.' : readingFile ? 'Opening screenshot…' : watchMessage}{screen.sharing && screen.sourceLabel ? ` · ${screen.sourceLabel}` : ''}</div>
      {notice && <p className={styles.muted} role="status">{notice}</p>}
      {(screen.error || inputError) && <p className={styles.error} role="alert">{inputError || screen.error}</p>}
      <RegionControls crop={crop} masks={masks} canPreview={screen.sharing && !readingFile} onRefresh={() => takeCapture(false)} onCropChange={(next) => {
        cancelInput(); pause(); setCrop(next); watcher.reset(); setPreview(null)
        setNotice('Question area changed. Refresh the capture preview before analyzing.')
      }} onMasksChange={(next) => {
        cancelInput(); pause(); setMasks(next); watcher.reset(); setPreview(null)
        setNotice('Excluded regions changed. Refresh the capture preview before analyzing.')
      }} />
    </section>

    <div className={styles.columns}>
      <aside className={styles.side} aria-label="Capture preview and question history">
        <section className={styles.preview}>
          <div className={styles.sectionHeading}><h2>Capture preview</h2>{preview && <span className={styles.badge}>{previewSource === 'practice' ? 'Practice' : previewSource === 'upload' ? 'Uploaded' : 'Screen'}</span>}</div>
          {preview ? <>
            <Image className={styles.captureImage} src={preview.image} width={preview.width} height={preview.height} alt="Question screenshot ready for analysis" unoptimized />
            <p className={styles.muted}><time dateTime={new Date(preview.capturedAt).toISOString()}>{new Date(preview.capturedAt).toLocaleTimeString()}</time> · {preview.width} × {preview.height}</p>
            <button type="button" className="btn-signal" disabled={readingFile || awaitingCurrentCapture || session.running?.capture.image === preview.image} onClick={() => { setNotice(null); void session.analyze(preview, category) }}>Analyze this capture</button>
            {awaitingCurrentCapture && <p className={styles.muted}>Previous capture. The shared screen has changed.</p>}
            <p className={styles.muted}>Make sure the full stem, passage, diagrams and choices are readable. Only this captured image is analyzed.</p>
            {previewSource === 'upload' && <p className={styles.muted}>Uploaded images are sent as shown. To omit content, upload a cropped or redacted image.</p>}
          </> : <div className={styles.emptyPreview}><Camera size={28} aria-hidden /><p>Share a screen or upload a screenshot.</p><span>Preview the exact question before sending it.</span></div>}
        </section>
        <section className={styles.history} aria-label="Question history">
          <div className={styles.sectionHeading}><h2>Questions</h2><span className={styles.badge}>{session.entries.length}</span></div>
          {session.entries.length ? <>
            <label className={styles.historySelect}>View a question
              <select value={session.pinned ? session.selectedId! : ''} onChange={(event) => session.pin(event.target.value || null)}>
                <option value="">Follow latest question</option>
                {[...session.entries].reverse().map((entry) => <option key={entry.id} value={entry.id}>{aptitudeEntryLabel(entry, session.entries.indexOf(entry))} · {aptitudeEntryStatus(entry)}</option>)}
              </select>
            </label>
            <ol className={styles.historyList}>{[...session.entries].reverse().map((entry) => <li key={entry.id}>
              <button type="button" className={styles.historyItem} aria-pressed={session.selected?.id === entry.id} onClick={() => session.pin(entry.id)}>
                <span><strong>{aptitudeEntryLabel(entry, session.entries.indexOf(entry))}</strong><span>{aptitudeEntryStatus(entry)}</span></span>
                <p>{entry.result?.question?.stem || 'Captured question'}</p>
              </button>
            </li>)}</ol>
            <button type="button" className={styles.textButton} onClick={clear}>Clear captures and history</button>
            <p className={styles.muted}>Up to {APTITUDE_HISTORY_LIMIT} recent questions stay in this tab. Reloading clears them.</p>
          </> : <>
            <p className={styles.muted}>Your questions and answers will appear here.</p>
            {preview && <button type="button" className={styles.textButton} onClick={clear}>Clear captures and history</button>}
          </>}
        </section>
        <section className={styles.practice} id="aptitude-practice" aria-label="Aptitude practice">
          <FlaskConical size={19} aria-hidden /><h2>Check the workflow first</h2>
          <p>Try an original practice question, then review the answer and measured time.</p>
          <button type="button" className="btn-ghost" onClick={loadPractice}>Try a practice question</button>
        </section>
      </aside>

      <section className={styles.answerColumn} aria-label="Current aptitude answer">
        {session.pinned && <div className={styles.pinned}>
          <span>Viewing a saved capture{session.running && session.running.id !== session.selected?.id ? ' · Another question is being analyzed' : ''}.</span>
          <button type="button" className={styles.textButton} onClick={() => session.pin(null)}>Follow latest</button>
        </div>}
        {awaitingCurrentCapture && !session.pinned ? <div className={styles.emptyAnswer}>
          <p className={styles.eyebrow}>Waiting for a new capture</p>
          <h2>{watcher.status === 'unavailable' ? 'The shared screen is not readable.' : autoOn ? 'The question is changing.' : 'Capture the current question.'}</h2>
          <p role="status">{watcher.status === 'unavailable' ? 'Check screen sharing, or upload a complete screenshot.' : autoOn ? 'Automatic capture will analyze the question after it settles.' : 'The screen changed after the previous capture. Capture again or resume automatic capture.'}</p>
          {session.current && <button type="button" className={styles.textButton} onClick={() => session.pin(session.current!.id)}>View previous capture</button>}
        </div> : answerEntry ? <AptitudeAnswer entry={answerEntry} index={currentIndex} onRetry={() => void session.retry(answerEntry.id, category)} onStop={pause} onCapture={() => {
          if (screen.sharing) takeCapture(true)
          else fileInput.current?.click()
        }} /> : <div className={styles.emptyAnswer}>
          <span className={styles.emptyMark} aria-hidden>?</span>
          <h2>{preview ? 'New capture ready to analyze.' : 'Start with the question.'}</h2>
          <p>{preview ? 'Review the screenshot, then analyze this question. Previous answers remain with their saved captures.' : 'Get a suggested choice, a short worked explanation and an explicit check. If anything is missing from the capture, you will see what to include.'}</p>
          {preview && <button type="button" className={styles.textButton} disabled={readingFile} onClick={() => void session.analyze(preview, category)}>Analyze captured question</button>}
          <div className={styles.emptySteps}><span>01 · Capture</span><span>02 · Analyze</span><span>03 · Check</span></div>
        </div>}
      </section>
    </div>
    <p className={styles.privacyNote}>Screen capture starts only when you choose a source. Captured questions are sent to the configured AI service when you analyze them. This mode does not select or submit answers on another website.</p>
  </div>
}
