'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fingerprintFromRgba, normalizeRegion, type NormalizedRegion, type ScreenSample, type ScreenFingerprintSample, type AvailableScreenFingerprint } from '@/lib/aptitude/captureDetector'
import { AptitudeCaptureEncodingError, aptitudeCaptureSize, encodeAptitudeCanvas } from '@/lib/aptitude/captureEncoding'

// Screen capture for the copilot's vision (Phase 2). Opens getDisplayMedia video
// (the track useMicStream deliberately discards), holds it in an offscreen
// <video>, and grabs a DOWNSCALED JPEG frame on demand. Two cost/privacy levers:
//   - downscale to ~1024px long edge + JPEG q0.6 -> small payload, detail:low read
//   - MAD perceptual-diff vs the last grabbed frame -> identical screen returns
//     null (skips a redundant vision call)
// Privacy: explicit user gesture (the browser picker), a visible "sharing" state,
// and the stream is fully torn down on stop. Nothing is persisted.

const LONG_EDGE = 1024
const JPEG_QUALITY = 0.6
const DIFF_THUMB = 64 // luma thumbnail size for the perceptual diff
const DIFF_THRESHOLD = 0.02 // mean-abs-diff (0..1) below which the screen is "unchanged"
const APTITUDE_FINGERPRINT_EDGE = 512
const FIRST_FRAME_TIMEOUT_MS = 10_000

type ScreenStreamOptions = { preferNativeResolution?: boolean }

type AptitudeFrameOptions = {
  crop?: NormalizedRegion
  masks?: NormalizedRegion[]
  /** Local area-selector image only. Resample without this flag before analysis. */
  previewOnly?: boolean
}

type AptitudeRasterSample = (AvailableScreenFingerprint & { canvas: HTMLCanvasElement }) | Extract<ScreenSample, { kind: 'unavailable' }>

// Soft constraints apply after the user chooses the source. Unlike min/exact,
// they do not reject smaller screens or narrow the browser's source picker.
// resizeMode is in the Screen Capture specification, but not all DOM typings
// or browsers expose it yet; unsupported hints are ignored by the browser.
const DETAILED_SCREEN_CONSTRAINTS: MediaTrackConstraints & { resizeMode: ConstrainDOMString } = {
  // One size preference lets WebKit retain a window's intrinsic aspect ratio.
  // Equal width/height preferences can introduce a square capture surface.
  width: { ideal: 4096 },
  frameRate: { ideal: 5, max: 10 }, resizeMode: { ideal: 'none' },
}

type ScreenRun = {
  stream: MediaStream | null
  video: HTMLVideoElement | null
  onEnded: (() => void) | null
  onMute: (() => void) | null
  onUnmute: (() => void) | null
  controller: AbortController
}

function disposeRun(run: ScreenRun) {
  run.controller.abort()
  run.stream?.getVideoTracks().forEach((track) => {
    if (run.onEnded) track.removeEventListener('ended', run.onEnded)
    if (run.onMute) track.removeEventListener('mute', run.onMute)
    if (run.onUnmute) track.removeEventListener('unmute', run.onUnmute)
  })
  run.stream?.getTracks().forEach((track) => track.stop())
  if (run.video) run.video.srcObject = null
  run.video = null
  run.stream = null
}

class CaptureReadinessError extends Error {}

function sourceName(track: MediaStreamTrack): string {
  try { if (track.getSettings?.().displaySurface === 'window') return 'window' } catch { /* optional source metadata */ }
  return 'screen'
}

function frameUnavailable(video: HTMLVideoElement, track: MediaStreamTrack | undefined): string | null {
  if (!track || track.readyState === 'ended') return 'The shared source has ended. Share it again to capture a question.'
  if (track.muted || track.enabled === false) return `The shared ${sourceName(track)} is not providing frames. Restore the window and keep it visible, or choose Screen in the sharing dialog.`
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return 'Waiting for a readable frame from the shared source. Keep its window visible and try again.'
  return null
}

/** A grant (and even dimensions) is not enough to draw a decoded video frame.
 * Bound initialization after the picker returns, including a stalled play(). */
function playFirstFrame(video: HTMLVideoElement, track: MediaStreamTrack, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let playing = false
    const events = ['loadeddata', 'canplay', 'playing', 'resize']
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(poll)
      for (const event of events) video.removeEventListener(event, check)
      track.removeEventListener('unmute', check)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (track.readyState === 'ended') finish(new CaptureReadinessError('The selected source stopped before a frame was available. Restore its window and share it again.'))
      else if (playing && !frameUnavailable(video, track)) finish()
    }
    const abort = () => finish(new DOMException('Sharing setup was cancelled.', 'AbortError'))
    const timeout = setTimeout(() => finish(new CaptureReadinessError(`The shared ${sourceName(track)} did not provide a readable frame. Restore the window and share it again, or choose Screen in the sharing dialog.`)), FIRST_FRAME_TIMEOUT_MS)
    // Some engines update dimensions without a useful media event during window
    // initialization. This bounded local poll does not capture or upload images.
    const poll = setInterval(check, 100)
    for (const event of events) video.addEventListener(event, check)
    track.addEventListener('unmute', check)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    try { void video.play().then(() => { playing = true; check() }, error => finish(error ?? new Error('Could not play the shared video'))) } catch (error) { finish(error) }
  })
}

export function useScreenStream({ preferNativeResolution = false }: ScreenStreamOptions = {}) {
  const [sharing, setSharing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [sourceLabel, setSourceLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastThumbRef = useRef<Uint8ClampedArray | null>(null)
  const lastFrameRef = useRef<string | null>(null)
  const runRef = useRef<ScreenRun | null>(null)
  const mountedRef = useRef(true)

  const stop = useCallback(() => {
    const run = runRef.current
    runRef.current = null
    if (run) disposeRun(run)
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current = null
    }
    lastThumbRef.current = null
    lastFrameRef.current = null
    if (mountedRef.current) {
      setSharing(false)
      setStarting(false)
      setSourceLabel(null)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    window.addEventListener('pagehide', stop)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [stop])

  const start = useCallback(async () => {
    if (!mountedRef.current || runRef.current) return
    const run: ScreenRun = { stream: null, video: null, onEnded: null, onMute: null, onUnmute: null, controller: new AbortController() }
    runRef.current = run
    const current = () => mountedRef.current && runRef.current === run
    setError(null)
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: preferNativeResolution ? DETAILED_SCREEN_CONSTRAINTS : true, audio: false,
      })
      run.stream = stream
      // Stop while the browser picker is pending must retire a late grant,
      // without touching a replacement session that the user already started.
      if (!current()) { disposeRun(run); return }
      const track = stream.getVideoTracks()[0]
      if (!track) throw new Error('No screen video track')
      if (track.readyState === 'ended') throw new CaptureReadinessError('The selected source ended before sharing started. Restore its window and share it again.')
      if (preferNativeResolution && 'contentHint' in track) {
        // The browser may ignore this hint. A missing implementation must not
        // turn an otherwise valid sharing grant into a failed session.
        try { track.contentHint = 'text' } catch { /* optional browser hint */ }
      }
      streamRef.current = stream
      const video = document.createElement('video')
      run.video = video
      video.muted = true
      video.defaultMuted = true
      video.playsInline = true
      video.srcObject = stream
      run.onEnded = () => {
        if (!current()) return
        if (videoRef.current !== video) setError('The selected source stopped before a frame was available. Restore its window and share it again.')
        stop()
      }
      run.onMute = () => { if (current()) setError(frameUnavailable(video, track)) }
      run.onUnmute = () => { if (current()) setError(null) }
      track.addEventListener('ended', run.onEnded)
      track.addEventListener('mute', run.onMute)
      track.addEventListener('unmute', run.onUnmute)
      await playFirstFrame(video, track, run.controller.signal)
      if (!current()) { disposeRun(run); return }
      videoRef.current = video
      // If the user stops sharing via the browser's own control, reflect it.
      setSharing(true)
      setStarting(false)
      setError(null)
      setSourceLabel(track.label || `Shared ${sourceName(track)}`)
    } catch (e) {
      if (!current()) { disposeRun(run); return }
      // User cancelled the picker, or permission denied — not a hard error.
      setError(e instanceof CaptureReadinessError ? e.message
        : e instanceof Error && e.name === 'NotAllowedError' ? run.stream ? 'The browser could not play the shared video. Restore its window and share it again.' : null
          : e instanceof Error && e.name === 'NotReadableError' ? 'The browser could not read the selected window or screen. Restore the window, check screen-recording permission, and share it again.'
            : 'Could not start screen sharing. Try selecting the window again, or choose Screen in the sharing dialog.')
      stop()
    }
  }, [preferNativeResolution, stop])

  // Grab one downscaled JPEG. Returns null if unchanged since the last grab (MAD
  // gate) so the caller can skip a redundant vision call, or if not sharing.
  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || frameUnavailable(video, streamRef.current?.getVideoTracks()[0])) return null

    const scale = Math.min(1, LONG_EDGE / Math.max(video.videoWidth, video.videoHeight))
    const w = Math.max(1, Math.round(video.videoWidth * scale))
    const h = Math.max(1, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)

    // Perceptual-diff gate: compare a tiny luma thumbnail to the previous grab.
    const thumb = document.createElement('canvas')
    thumb.width = DIFF_THUMB
    thumb.height = DIFF_THUMB
    const tctx = thumb.getContext('2d')
    if (tctx) {
      tctx.drawImage(video, 0, 0, DIFF_THUMB, DIFF_THUMB)
      const cur = tctx.getImageData(0, 0, DIFF_THUMB, DIFF_THUMB).data
      const prev = lastThumbRef.current
      if (prev) {
        let sum = 0
        // luma of every pixel; mean absolute difference normalized to 0..1
        for (let i = 0; i < cur.length; i += 4) {
          const lc = 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2]
          const lp = 0.299 * prev[i] + 0.587 * prev[i + 1] + 0.114 * prev[i + 2]
          sum += Math.abs(lc - lp)
        }
        const mad = sum / (cur.length / 4) / 255
        if (mad < DIFF_THRESHOLD && lastFrameRef.current) return null // unchanged -> skip
      }
      lastThumbRef.current = cur
    }

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    lastFrameRef.current = dataUrl
    return dataUrl
  }, [])

  /**
   * Always return the current readable frame, even when it is unchanged. The
   * aptitude detector owns its own baseline; this method never consumes the
   * legacy chat/code difference gate. Excluded regions are blanked before both
   * fingerprinting and encoding, so the preview is exactly what is sent.
   */
  const readAptitudeRaster = useCallback((options?: AptitudeFrameOptions, fingerprintOnly = false): AptitudeRasterSample => {
    const capturedAt = Date.now()
    const unavailable = (reason: string): Extract<ScreenSample, { kind: 'unavailable' }> => ({ kind: 'unavailable', capturedAt, reason })
    const video = videoRef.current
    if (!video || !streamRef.current) return unavailable('Screen sharing is stopped.')
    const reason = frameUnavailable(video, streamRef.current.getVideoTracks()[0])
    if (reason) return unavailable(reason)
    // A window can resize while shared. Use its current intrinsic dimensions,
    // not early getSettings() metadata or a previously captured frame's size.
    const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight
    const crop = options?.crop ? normalizeRegion(options.crop) : { x: 0, y: 0, width: 1, height: 1 }
    if (!crop) return unavailable('The selected capture area is empty.')
    const sx = Math.floor(crop.x * sourceWidth)
    const sy = Math.floor(crop.y * sourceHeight)
    const sw = Math.max(1, Math.min(sourceWidth - sx, Math.ceil(crop.width * sourceWidth)))
    const sh = Math.max(1, Math.min(sourceHeight - sy, Math.ceil(crop.height * sourceHeight)))

    try {
      const size = aptitudeCaptureSize(sw, sh)
      if (options?.previewOnly) {
        // A whole high-DPI desktop may exceed the analysis payload budget.
        // Keep the local crop selector usable so the user can select a readable
        // question region, which is then captured again at full detail.
        const previewScale = Math.min(1, 1536 / Math.max(size.width, size.height))
        size.width = Math.max(1, Math.round(size.width * previewScale))
        size.height = Math.max(1, Math.round(size.height * previewScale))
      }
      const masks: NormalizedRegion[] = []
      for (const mask of options?.masks ?? []) {
        const region = normalizeRegion(mask)
        if (!region) return unavailable('An excluded area is empty or invalid. Adjust it before capturing.')
        masks.push(region)
      }

      const render = (width: number, height: number, readFrequently = false) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: readFrequently })
        if (!context) return null
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height)
        context.fillStyle = '#ffffff'
        for (const region of masks) {
          const left = Math.max(sx, region.x * sourceWidth)
          const top = Math.max(sy, region.y * sourceHeight)
          const right = Math.min(sx + sw, (region.x + region.width) * sourceWidth)
          const bottom = Math.min(sy + sh, (region.y + region.height) * sourceHeight)
          if (right <= left || bottom <= top) continue
          // Round outward in each raster so masked edges are never transmitted.
          const x = Math.floor((left - sx) * width / sw)
          const y = Math.floor((top - sy) * height / sh)
          context.fillRect(x, y, Math.ceil((right - sx) * width / sw) - x, Math.ceil((bottom - sy) * height / sh) - y)
        }
        return canvas
      }

      // Both paths fingerprint the same source crop directly. A poll never
      // allocates or encodes the native-size image; that work happens once the
      // local detector has a stable candidate, or on an explicit capture.
      const fingerprintScale = Math.min(1, APTITUDE_FINGERPRINT_EDGE / Math.max(size.width, size.height))
      const fingerprintCanvas = render(Math.max(1, Math.round(size.width * fingerprintScale)), Math.max(1, Math.round(size.height * fingerprintScale)), true)
      if (!fingerprintCanvas) return unavailable('Screen comparison is unavailable in this browser.')
      const fingerprintContext = fingerprintCanvas.getContext('2d', { willReadFrequently: true })
      if (!fingerprintContext) return unavailable('Screen comparison is unavailable in this browser.')
      const rgba = fingerprintContext.getImageData(0, 0, fingerprintCanvas.width, fingerprintCanvas.height).data
      const fingerprint = fingerprintFromRgba(rgba, fingerprintCanvas.width, fingerprintCanvas.height)

      const canvas = fingerprintOnly || size.width === fingerprintCanvas.width && size.height === fingerprintCanvas.height
        ? fingerprintCanvas : render(size.width, size.height)
      if (!canvas) return unavailable('Screen capture is unavailable in this browser.')
      return { kind: 'available', canvas, capturedAt, width: size.width, height: size.height,
        sourceHash: fingerprint.hash, fingerprint }
    } catch (cause) {
      if (cause instanceof AptitudeCaptureEncodingError) return unavailable(cause.message)
      return unavailable('Could not read the current screen. Try sharing it again.')
    }
  }, [])

  const sampleFingerprint = useCallback((options?: AptitudeFrameOptions): ScreenFingerprintSample => {
    const sample = readAptitudeRaster(options, true)
    if (sample.kind === 'unavailable') return sample
    return { kind: 'available', capturedAt: sample.capturedAt, width: sample.width, height: sample.height,
      sourceHash: sample.sourceHash, fingerprint: sample.fingerprint }
  }, [readAptitudeRaster])

  const sampleFrame = useCallback((options?: AptitudeFrameOptions): ScreenSample => {
    const sample = readAptitudeRaster(options)
    if (sample.kind === 'unavailable') return sample
    const { canvas, ...fingerprint } = sample
    try {
      return { ...fingerprint, image: encodeAptitudeCanvas(canvas) }
    } catch (cause) {
      return { kind: 'unavailable', capturedAt: sample.capturedAt, reason: cause instanceof AptitudeCaptureEncodingError
        ? cause.message : 'Could not read the current screen. Try sharing it again.' }
    }
  }, [readAptitudeRaster])

  // Code needs legible punctuation and line numbers. Keep this separate from
  // the low-resolution chat diff gate: a chat grab must not consume repo capture.
  const grabCodeFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || frameUnavailable(video, streamRef.current?.getVideoTracks()[0])) return null
    const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.94)
  }, [])

  return { sharing, starting, sourceLabel, error, start, stop, grabFrame, grabCodeFrame, sampleFrame, sampleFingerprint }
}
