'use client'

import Image from 'next/image'
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { Camera, Crop, Download, Monitor, Pause, Play, Square, Upload, ZoomIn } from 'lucide-react'
import { useScreenStream } from '@/lib/vision/useScreenStream'
import { useAptitudeCapture } from '@/lib/aptitude/useAptitudeCapture'
import { createAptitudeCapture, type AptitudeCapture, type NormalizedRegion } from '@/lib/aptitude/captureDetector'
import { APTITUDE_CATEGORIES, APTITUDE_CATEGORY_LABELS, type AptitudeCategorySelection, type AptitudeStrategy } from '@/lib/aptitude/schema'
import { APTITUDE_HISTORY_LIMIT, useAptitudeSession } from '@/lib/aptitude/useAptitudeSession'
import { AptitudeAnswer, aptitudeEntryLabel, aptitudeEntryStatus, aptitudeStrategyLabel } from './AptitudeAnswer'
import { createPracticeCapture, readCaptureFile } from './captureInput'
import { FULL_REGION, RegionControls } from './RegionControls'
import { CaptureInspector } from './CaptureInspector'
import styles from './AptitudeWorkspace.module.css'

/** Content only; CopilotWorkspace owns route navigation and WorkspaceShell. */
export function AptitudeWorkspace({ archiveOwnerId }: { archiveOwnerId?: string | null } = {}) {
  const screen = useScreenStream({ preferNativeResolution: true })
  const session = useAptitudeSession({ archiveOwnerId })
  const { sampleFrame: sampleScreenFrame, sampleFingerprint: sampleScreenFingerprint } = screen
  const { analyze } = session
  const [category, setCategory] = useState<AptitudeCategorySelection>('auto')
  const [strategy, setStrategy] = useState<AptitudeStrategy>('compare')
  const [automatic, setAutomaticState] = useState(false)
  const automaticEnabled = useRef(false)
  const selectedStrategy = useRef<AptitudeStrategy>('compare')
  const strategyDescriptionId = useId()
  const setAutomatic = useCallback((enabled: boolean) => {
    automaticEnabled.current = enabled
    setAutomaticState(enabled)
  }, [])
  const [screenChanged, setScreenChanged] = useState(false)
  const [crop, setCrop] = useState<NormalizedRegion>(FULL_REGION)
  const [masks, setMasks] = useState<NormalizedRegion[]>([])
  const [preview, setPreview] = useState<AptitudeCapture | null>(null)
  const [previewSource, setPreviewSource] = useState<'screen' | 'upload' | 'practice'>('screen')
  const [inspection, setInspection] = useState<{ capture: AptitudeCapture; title: string; selecting: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [readingFile, setReadingFile] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const advancedOptions = useRef<HTMLDetailsElement>(null)
  const fileRequest = useRef<AbortController | null>(null)
  const inputGeneration = useRef(0)
  const wasSharing = useRef(false)
  const wasCheckingScreenChange = useRef(false)

  const sampleFrame = useCallback(() => sampleScreenFrame({ crop, masks }), [sampleScreenFrame, crop, masks])
  const sampleFingerprint = useCallback(() => sampleScreenFingerprint({ crop, masks }), [sampleScreenFingerprint, crop, masks])
  const onAutomaticCapture = useCallback((capture: AptitudeCapture) => {
    // The watcher's callback ref updates in an effect. Reject an older callback
    // immediately after a mode change, before that effect has cleaned up.
    if (!automaticEnabled.current || selectedStrategy.current !== strategy) return
    setScreenChanged(false)
    setPreview(capture)
    setPreviewSource('screen')
    setInputError(null)
    setNotice(null)
    void analyze(capture, category, strategy)
  }, [analyze, category, strategy])
  const watcher = useAptitudeCapture({ enabled: automatic && screen.sharing, sampleFrame, sampleFingerprint, onCapture: onAutomaticCapture })

  // A browser Stop sharing action is an external lifecycle event, not a new capture.
  const onSharingEnded = useEffectEvent((pendingChange: boolean) => {
    if (pendingChange) setScreenChanged(true)
    setAutomatic(false)
    session.stop()
    setInspection((current) => current?.selecting ? null : current)
  })
  useEffect(() => {
    if (wasSharing.current && !screen.sharing) onSharingEnded(wasCheckingScreenChange.current)
    wasSharing.current = screen.sharing
    wasCheckingScreenChange.current = automatic && screen.sharing && (watcher.status === 'checking' || watcher.status === 'settling' || watcher.status === 'unavailable')
  }, [screen.sharing, automatic, watcher.status])
  useEffect(() => () => {
    automaticEnabled.current = false
    inputGeneration.current += 1
    fileRequest.current?.abort()
  }, [])
  useEffect(() => {
    // Preserve the tools catalog's direct practice link even though setup is
    // collapsed for the normal capture flow.
    if (window.location.hash === '#aptitude-practice' && advancedOptions.current) advancedOptions.current.open = true
  }, [])

  const pause = () => {
    if (automatic && screen.sharing && (watcher.status === 'checking' || watcher.status === 'settling' || watcher.status === 'unavailable')) setScreenChanged(true)
    setAutomatic(false)
    session.stop()
    setNotice(screen.sharing ? 'Automatic analysis is paused. Screen sharing remains on.' : 'Analysis is paused.')
  }

  const changeStrategy = (next: AptitudeStrategy) => {
    if (next === strategy) return
    selectedStrategy.current = next
    pause()
    watcher.reset()
    setStrategy(next)
    setNotice(`${aptitudeStrategyLabel(next)} selected. Automatic capture is paused. Analyze the capture when you are ready.`)
  }

  const cancelInput = () => {
    inputGeneration.current += 1
    fileRequest.current?.abort()
    fileRequest.current = null
    setReadingFile(false)
    setInspection(null)
  }

  const stopSharing = () => {
    cancelInput()
    if (automatic && (watcher.status === 'checking' || watcher.status === 'settling' || watcher.status === 'unavailable')) setScreenChanged(true)
    setAutomatic(false)
    session.stop()
    watcher.reset()
    screen.stop()
    setNotice('Screen sharing stopped. Your existing captures remain in this tab.')
  }

  const analyzeCapture = (capture: AptitudeCapture) => {
    const existing = session.entries.find((entry) => entry.capture.image === capture.image && entry.category === category && entry.strategy === strategy
      && (entry.status === 'complete' || entry.status === 'analyzing'))
    setNotice(existing ? existing.status === 'analyzing'
      ? 'This question is already being analyzed.'
      : 'Showing the existing answer for this exact image. Use Retry this capture for a new analysis.' : null)
    void session.analyze(capture, category, strategy)
  }

  const takeCapture = (analyze: boolean) => {
    setInputError(null)
    const sample = sampleFrame()
    if (sample.kind !== 'available') {
      setInputError(sample.reason || 'The shared screen is not ready. Try capturing again.')
      return
    }
    const capture = createAptitudeCapture(sample)
    session.pin(null)
    setScreenChanged(false)
    setPreview(capture)
    setPreviewSource('screen')
    setNotice(analyze ? null : 'Preview ready. Review the question area, then analyze once or turn on automatic capture.')
    if (analyze) {
      watcher.accept(sample)
      analyzeCapture(capture)
    }
  }

  const startSharing = async () => {
    cancelInput()
    const generation = inputGeneration.current
    setAutomatic(false)
    session.stop()
    watcher.reset()
    screen.stop()
    setPreview(null)
    session.pin(null)
    setCrop(FULL_REGION)
    setScreenChanged(false)
    setInputError(null)
    setNotice(null)
    await screen.start()
    if (generation !== inputGeneration.current) return
    const sample = sampleScreenFrame({ crop: FULL_REGION, masks })
    if (sample.kind === 'available') {
      setPreview(createAptitudeCapture(sample))
      setPreviewSource('screen')
      setNotice('Preview ready. Select the question area to keep small text and diagrams readable before starting analysis.')
    } else setInputError(sample.reason || 'Select the question area or refresh the preview once the shared source is ready.')
  }

  const selectQuestionArea = () => {
    cancelInput()
    pause()
    setInputError(null)
    // This smaller, local-only view is never assigned to preview or sent to a model.
    const source = sampleScreenFrame({ crop: FULL_REGION, masks, previewOnly: true })
    if (source.kind !== 'available') {
      setInputError(source.reason || 'The shared source is not ready. Try again after it has loaded.')
      return
    }
    setInspection({ capture: createAptitudeCapture(source), title: 'Select question area', selecting: true })
  }

  const applyQuestionArea = (next: NormalizedRegion) => {
    // Validate the fresh source before replacing a still-usable prior capture.
    // The native browser sharing control can end the stream while this dialog is open.
    const sample = sampleScreenFrame({ crop: next, masks })
    if (sample.kind !== 'available') {
      setInspection(null)
      setInputError(sample.reason || 'Could not capture this question area. The previous capture has been kept.')
      return
    }
    cancelInput()
    pause()
    watcher.reset()
    setCrop(next)
    setPreview(null)
    session.pin(null)
    setScreenChanged(false)
    setInputError(null)
    // Re-read the source at analysis quality; never analyze the selection thumbnail.
    setPreview(createAptitudeCapture(sample))
    setPreviewSource('screen')
    setNotice('Question area captured. Enlarge the preview to check the diagram and every answer choice, then analyze or start automatic capture.')
  }

  const upload = async (file?: File) => {
    if (!file) return
    cancelInput()
    setAutomatic(false)
    session.stop()
    setPreview(null)
    session.pin(null)
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
    session.pin(null)
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
  const checkingSmallChange = autoOn && watcher.status === 'checking'
  const awaitingCurrentCapture = screenChanged || autoOn && (watcher.status === 'settling' || watcher.status === 'unavailable')
  const watchMessage = !screen.sharing ? 'Screen sharing is off' : !autoOn ? 'Ready for manual capture' : {
    paused: 'Automatic capture paused', watching: 'Watching for a changed question', checking: 'Checking a small screen change', settling: 'Waiting for the question to settle', captured: 'New question captured', unavailable: 'Waiting for a readable screen',
  }[watcher.status]
  const sourceLabel = screen.sourceLabel?.startsWith('web-contents-media-stream://') ? 'Shared tab' : screen.sourceLabel
  const currentIndex = session.selected ? session.entries.findIndex((item) => item.id === session.selected!.id) : -1
  const answerEntry = session.pinned ? session.selected : preview?.image === session.current?.capture.image && session.current?.strategy === strategy ? session.current : null
  const savedPreview = session.pinned ? session.selected : null
  const displayedCapture = savedPreview?.capture ?? preview
  const savedCaptureLabel = savedPreview ? aptitudeEntryLabel(savedPreview, currentIndex) : null
  const livePreview = previewSource === 'screen' && screen.sharing
  const analyzePreview = () => {
    setNotice(null)
    // A shared source can change before the watcher notices it. A manual action
    // always reads it now; Retry is the explicit way to rerun a saved image.
    if (livePreview) takeCapture(true)
    else if (preview) analyzeCapture(preview)
  }

  return <div className={styles.workspace}>
    <section className={styles.controls} aria-label="Aptitude capture controls">
      <div className={styles.controlHeading}>
        <div><h2>One question. Clear reasoning.</h2><p>Share the question, include every choice, then analyze. Turn on automatic capture to follow new questions.</p></div>
        <span className={styles.badge}>{strategy === 'compare' ? 'Claude + OpenAI' : 'Single model'} · {category === 'auto' ? 'Auto-detect type' : APTITUDE_CATEGORY_LABELS[category]}</span>
      </div>
      <p id={strategyDescriptionId} className={styles.modeDescription}>{strategy === 'compare'
        ? 'Claude and OpenAI analyze the same capture in parallel. Each answer appears when ready; this uses both models’ credits.'
        : 'One model analyzes the capture. Choose comparison in Advanced options for Claude and OpenAI together.'}</p>
      <div className={styles.buttonRow}>
        {!screen.sharing && <button type="button" className="btn-signal" onClick={() => screen.starting ? stopSharing() : void startSharing()} disabled={readingFile || !session.archiveReady}>
          <Monitor size={16} aria-hidden />{screen.starting ? 'Cancel sharing setup' : 'Share screen'}
        </button>}
        {screen.sharing && <>
          <button type="button" className={autoOn ? 'btn-ghost' : 'btn-signal'} aria-pressed={autoOn} disabled={readingFile || !session.archiveReady} onClick={() => {
            if (autoOn) { pause(); return }
            setNotice(null); setInputError(null); watcher.reset(); setAutomatic(true)
          }}>{autoOn ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}{autoOn ? 'Pause automatic capture' : 'Start automatic capture'}</button>
          <button type="button" className="btn-ghost" disabled={readingFile || !session.archiveReady} onClick={() => takeCapture(true)}><Camera size={16} aria-hidden />Capture now</button>
          <button type="button" className="btn-ghost" disabled={readingFile || !session.archiveReady} onClick={selectQuestionArea}><Crop size={16} aria-hidden />Select question area</button>
          <button type="button" className="btn-stop" onClick={stopSharing}><Square size={14} aria-hidden />Stop sharing</button>
        </>}
        {!screen.sharing && <button type="button" className="btn-ghost" disabled={readingFile || !session.archiveReady} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden />Upload screenshot</button>}
        <input ref={fileInput} className={styles.hiddenInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload aptitude screenshot" disabled={!session.archiveReady} onChange={(event) => void upload(event.target.files?.[0])} />
        {readingFile && <button type="button" className="btn-ghost" onClick={cancelInput}>Cancel image loading</button>}
      </div>
      <div className={styles.captureStatus} role="status"><span className={`${styles.dot} ${screen.sharing ? styles.dotActive : ''}`} aria-hidden />{screen.starting ? 'Choose a source in the browser sharing dialog.' : readingFile ? 'Opening screenshot…' : watchMessage}{screen.sharing && sourceLabel ? ` · ${sourceLabel}` : ''}</div>
      {!session.archiveReady && <p className={styles.muted} role="status">Restoring saved questions…</p>}
      {session.archiveNotice && <p className={styles.archiveNotice} role="status">{session.archiveNotice}</p>}
      {notice && <p className={styles.muted} role="status">{notice}</p>}
      {(screen.error || inputError) && <p className={styles.error} role="alert">{inputError || screen.error}</p>}
      <details ref={advancedOptions} className={styles.settings} id="aptitude-practice">
        <summary>Advanced options</summary>
        <div className={styles.analysisOptions}>
          <label className={styles.category}>Question type
            <select aria-label="Question type" value={category} onChange={(event) => setCategory(event.target.value as AptitudeCategorySelection)}>
              <option value="auto">Detect automatically</option>
              {APTITUDE_CATEGORIES.map((item) => <option key={item} value={item}>{APTITUDE_CATEGORY_LABELS[item]}</option>)}
            </select>
          </label>
          <label className={styles.category}>Analysis mode
            <select aria-label="Analysis mode" aria-describedby={strategyDescriptionId} value={strategy} onChange={(event) => changeStrategy(event.target.value as AptitudeStrategy)}>
              <option value="compare">Claude + OpenAI</option>
              <option value="single">Single model</option>
            </select>
          </label>
        </div>
      <div className={styles.buttonRow}>
        {screen.sharing && <>
          <button type="button" className="btn-ghost" disabled={readingFile || !session.archiveReady} onClick={() => void startSharing()}><Monitor size={16} aria-hidden />Change shared screen</button>
          <button type="button" className="btn-ghost" disabled={readingFile || !session.archiveReady} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden />Upload screenshot</button>
        </>}
        <button type="button" className="btn-ghost" disabled={!session.archiveReady} onClick={loadPractice}>Try a practice question</button>
      </div>
      <RegionControls crop={crop} masks={masks} canPreview={screen.sharing && !readingFile && session.archiveReady} onRefresh={() => takeCapture(false)} onCropChange={(next) => {
        cancelInput(); pause(); setCrop(next); watcher.reset(); setPreview(null)
        setNotice('Question area changed. Refresh the capture preview before analyzing.')
      }} onMasksChange={(next) => {
        cancelInput(); pause(); setMasks(next); watcher.reset(); setPreview(null)
        setNotice('Excluded regions changed. Refresh the capture preview before analyzing.')
      }} />
      </details>
    </section>

    <div className={styles.columns}>
      <aside className={styles.side} aria-label="Capture preview and question history">
        <section className={styles.preview}>
          <div className={styles.sectionHeading}><h2>Capture preview</h2>{displayedCapture && <span className={styles.badge}>{savedPreview ? `Saved · ${savedCaptureLabel}` : checkingSmallChange ? 'Previous capture' : previewSource === 'practice' ? 'Practice' : previewSource === 'upload' ? 'Uploaded' : 'Screen'}</span>}</div>
          {displayedCapture ? <>
            <Image className={styles.captureImage} src={displayedCapture.image} width={displayedCapture.width} height={displayedCapture.height} alt={savedPreview ? 'Screenshot for selected saved capture' : 'Question screenshot ready for analysis'} unoptimized />
            <p className={styles.muted}><time dateTime={new Date(displayedCapture.capturedAt).toISOString()}>{new Date(displayedCapture.capturedAt).toLocaleTimeString()}</time> · {displayedCapture.width} × {displayedCapture.height}</p>
            <button type="button" className="btn-ghost" onClick={() => setInspection({ capture: displayedCapture, title: savedPreview ? `${savedCaptureLabel} — exact image` : 'Capture preview — exact image', selecting: false })}><ZoomIn size={16} aria-hidden />Enlarge capture</button>
            {savedPreview ? <>
              <p className={styles.previewIdentity}>This is the image for {savedCaptureLabel} shown alongside it.</p>
              <button type="button" className="btn-ghost" onClick={() => session.pin(null)}>Return to latest capture</button>
            </> : <>
              <button type="button" className="btn-signal" disabled={!session.archiveReady || readingFile || !livePreview && session.running?.capture.image === displayedCapture.image && session.running.strategy === strategy} onClick={analyzePreview}>Analyze this capture</button>
              <p className={styles.muted}>{livePreview ? awaitingCurrentCapture ? 'The question changed. Analyze now captures the current screen immediately.' : 'Analyze takes a fresh image of the shared question area.' : 'This exact image is analyzed. Include the full question and every choice.'}</p>
              {previewSource === 'screen' && <p className={styles.previewTip}>Small diagram? Select question area, then enlarge to check it.</p>}
            </>}
          </> : <div className={styles.emptyPreview}><Camera size={28} aria-hidden /><p>Share a screen or upload a screenshot.</p><span>Preview the exact question before sending it.</span></div>}
        </section>
        {(preview || session.entries.length > 0) && <section className={styles.history} aria-label="Question history">
          <div className={styles.sectionHeading}><h2>Questions</h2><span className={styles.badge}>{session.entries.length}</span></div>
          {session.entries.length > 0 && <button type="button" className={`btn-ghost ${styles.exportButton}`} disabled={!session.archiveReady} onClick={() => void session.exportSession()}><Download size={15} aria-hidden />Export session</button>}
          {session.entries.length ? <>
            <label className={styles.historySelect}>View a question
              <select value={session.pinned ? session.selectedId! : ''} onChange={(event) => session.pin(event.target.value || null)}>
                <option value="">Follow latest question</option>
                {[...session.entries].reverse().map((entry) => <option key={entry.id} value={entry.id}>{aptitudeEntryLabel(entry, session.entries.indexOf(entry))} · {aptitudeStrategyLabel(entry.strategy)} · {aptitudeEntryStatus(entry)}</option>)}
              </select>
            </label>
            <button type="button" className={styles.textButton} onClick={clear}>Clear captures and history</button>
            <p className={styles.muted}>Up to {APTITUDE_HISTORY_LIMIT} questions in this session. Export saves the screenshots, both model answers, confidence estimates and timings for review.</p>
            {session.savedAt && <p className={styles.savedStatus}>Saved in this browser tab · <time dateTime={new Date(session.savedAt).toISOString()}>{new Date(session.savedAt).toLocaleTimeString()}</time></p>}
          </> : <>
            <p className={styles.muted}>Your questions and answers will appear here.</p>
            {preview && <button type="button" className={styles.textButton} onClick={clear}>Clear captures and history</button>}
          </>}
        </section>}
      </aside>

      <section className={styles.answerColumn} aria-label="Current aptitude answer">
        {checkingSmallChange && !session.pinned && answerEntry && <div className={styles.notice} role="status">
          <strong>Small screen change detected.</strong> Showing the last captured question while checking. This answer has not been checked against the current screen.
        </div>}
        {session.pinned && <div className={styles.pinned}>
          <span>Viewing a saved capture{session.running && session.running.id !== session.selected?.id ? ' · Another question is being analyzed' : preview && preview.image !== session.selected?.capture.image ? ' · A newer capture is available' : ''}.</span>
          <button type="button" className={styles.textButton} onClick={() => session.pin(null)}>Follow latest</button>
        </div>}
        {awaitingCurrentCapture && !session.pinned ? <div className={styles.emptyAnswer}>
          <p className={styles.eyebrow}>Waiting for a new capture</p>
          <h2>{watcher.status === 'unavailable' ? 'The shared screen is not readable.' : autoOn ? 'The question is changing.' : 'Capture the current question.'}</h2>
          <p role="status">{watcher.status === 'unavailable' ? 'Check screen sharing, or upload a complete screenshot.' : autoOn ? 'Automatic capture will analyze the question after it settles.' : 'The screen changed after the previous capture. Capture again or resume automatic capture.'}</p>
          {session.current && <button type="button" className={styles.textButton} onClick={() => session.pin(session.current!.id)}>View previous capture</button>}
        </div> : answerEntry ? <AptitudeAnswer entry={answerEntry} index={currentIndex} retryStrategy={strategy} onRetry={() => { setNotice(null); void session.retry(answerEntry.id, category, strategy) }} onStop={pause} onCapture={() => {
          if (screen.sharing) takeCapture(true)
          else fileInput.current?.click()
        }} /> : <div className={styles.emptyAnswer}>
          <span className={styles.emptyMark} aria-hidden>?</span>
          <h2>{preview ? strategy === 'compare' ? 'Ready to compare this capture.' : 'New capture ready to analyze.' : 'Start with the question.'}</h2>
          <p>{preview ? 'Review the screenshot, then analyze this question. Previous answers remain with their saved captures.' : 'Get a suggested choice, a short worked explanation and an explicit check. If anything is missing from the capture, you will see what to include.'}</p>
          <div className={styles.emptySteps}><span>01 · Capture</span><span>02 · Analyze</span><span>03 · Check</span></div>
        </div>}
      </section>
    </div>
    <p className={styles.privacyNote}>Screen capture starts only when you choose a source. Captured questions are sent to the configured AI services when you analyze them. Session history is saved in this browser tab for up to 7 days; clear it here or export a copy. This mode does not select or submit answers on another website.</p>
    {inspection && <CaptureInspector capture={inspection.capture} title={inspection.title} crop={crop}
      onApply={inspection.selecting ? applyQuestionArea : undefined} onClose={() => setInspection(null)} />}
  </div>
}
