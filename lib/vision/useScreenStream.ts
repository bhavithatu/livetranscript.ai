'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fingerprintFromRgba, normalizeRegion, type NormalizedRegion, type ScreenSample } from '@/lib/aptitude/captureDetector'
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

type ScreenStreamOptions = { preferNativeResolution?: boolean }

// Soft constraints apply after the user chooses the source. Unlike min/exact,
// they do not reject smaller screens or narrow the browser's source picker.
// resizeMode is in the Screen Capture specification, but not all DOM typings
// or browsers expose it yet; unsupported hints are ignored by the browser.
const DETAILED_SCREEN_CONSTRAINTS: MediaTrackConstraints & { resizeMode: ConstrainDOMString } = {
  width: { ideal: 4096 }, height: { ideal: 4096 },
  frameRate: { ideal: 5, max: 10 }, resizeMode: { ideal: 'none' },
}

type ScreenRun = {
  stream: MediaStream | null
  video: HTMLVideoElement | null
  onEnded: (() => void) | null
}

function disposeRun(run: ScreenRun) {
  if (run.onEnded) run.stream?.getVideoTracks().forEach((track) => track.removeEventListener('ended', run.onEnded!))
  run.stream?.getTracks().forEach((track) => track.stop())
  if (run.video) run.video.srcObject = null
  run.video = null
  run.stream = null
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
    const run: ScreenRun = { stream: null, video: null, onEnded: null }
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
      if (preferNativeResolution && 'contentHint' in track) {
        // The browser may ignore this hint. A missing implementation must not
        // turn an otherwise valid sharing grant into a failed session.
        try { track.contentHint = 'text' } catch { /* optional browser hint */ }
      }
      streamRef.current = stream
      const video = document.createElement('video')
      run.video = video
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      run.onEnded = () => { if (current()) stop() }
      track.addEventListener('ended', run.onEnded)
      await video.play()
      if (!current()) { disposeRun(run); return }
      videoRef.current = video
      // If the user stops sharing via the browser's own control, reflect it.
      setSharing(true)
      setStarting(false)
      setSourceLabel(track.label || 'Shared screen')
    } catch (e) {
      if (!current()) { disposeRun(run); return }
      // User cancelled the picker, or permission denied — not a hard error.
      setError(e instanceof Error && e.name === 'NotAllowedError' ? null : 'Could not start screen sharing')
      stop()
    }
  }, [preferNativeResolution, stop])

  // Grab one downscaled JPEG. Returns null if unchanged since the last grab (MAD
  // gate) so the caller can skip a redundant vision call, or if not sharing.
  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null

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
  const sampleFrame = useCallback((options?: {
    crop?: NormalizedRegion
    masks?: NormalizedRegion[]
    /** Local area-selector image only. Resample without this flag before analysis. */
    previewOnly?: boolean
  }): ScreenSample => {
    const capturedAt = Date.now()
    const unavailable = (reason: string): ScreenSample => ({ kind: 'unavailable', capturedAt, reason })
    const video = videoRef.current
    if (!video || !streamRef.current) return unavailable('Screen sharing is stopped.')
    if (!video.videoWidth || !video.videoHeight) return unavailable('Waiting for the shared screen.')
    const crop = options?.crop ? normalizeRegion(options.crop) : { x: 0, y: 0, width: 1, height: 1 }
    if (!crop) return unavailable('The selected capture area is empty.')
    const sx = Math.floor(crop.x * video.videoWidth)
    const sy = Math.floor(crop.y * video.videoHeight)
    const sw = Math.max(1, Math.min(video.videoWidth - sx, Math.ceil(crop.width * video.videoWidth)))
    const sh = Math.max(1, Math.min(video.videoHeight - sy, Math.ceil(crop.height * video.videoHeight)))

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
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) return unavailable('Screen capture is unavailable in this browser.')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      context.fillStyle = '#ffffff'
      for (const mask of options?.masks ?? []) {
        const region = normalizeRegion(mask)
        if (!region) return unavailable('An excluded area is empty or invalid. Adjust it before capturing.')
        const left = Math.max(sx, region.x * video.videoWidth)
        const top = Math.max(sy, region.y * video.videoHeight)
        const right = Math.min(sx + sw, (region.x + region.width) * video.videoWidth)
        const bottom = Math.min(sy + sh, (region.y + region.height) * video.videoHeight)
        if (right <= left || bottom <= top) continue
        // Round outward so no fraction of an excluded edge is transmitted.
        const x = Math.floor((left - sx) * canvas.width / sw)
        const y = Math.floor((top - sy) * canvas.height / sh)
        context.fillRect(x, y,
          Math.ceil((right - sx) * canvas.width / sw) - x,
          Math.ceil((bottom - sy) * canvas.height / sh) - y)
      }

      const fingerprintCanvas = document.createElement('canvas')
      const fingerprintScale = Math.min(1, APTITUDE_FINGERPRINT_EDGE / Math.max(canvas.width, canvas.height))
      fingerprintCanvas.width = Math.max(1, Math.round(canvas.width * fingerprintScale))
      fingerprintCanvas.height = Math.max(1, Math.round(canvas.height * fingerprintScale))
      const fingerprintContext = fingerprintCanvas.getContext('2d', { willReadFrequently: true })
      if (!fingerprintContext) return unavailable('Screen comparison is unavailable in this browser.')
      fingerprintContext.drawImage(canvas, 0, 0, fingerprintCanvas.width, fingerprintCanvas.height)
      const rgba = fingerprintContext.getImageData(0, 0, fingerprintCanvas.width, fingerprintCanvas.height).data
      const fingerprint = fingerprintFromRgba(rgba, fingerprintCanvas.width, fingerprintCanvas.height)

      const image = encodeAptitudeCanvas(canvas)
      return { kind: 'available', image, capturedAt, width: canvas.width, height: canvas.height,
        sourceHash: fingerprint.hash, fingerprint }
    } catch (cause) {
      if (cause instanceof AptitudeCaptureEncodingError) return unavailable(cause.message)
      return unavailable('Could not read the current screen. Try sharing it again.')
    }
  }, [])

  // Code needs legible punctuation and line numbers. Keep this separate from
  // the low-resolution chat diff gate: a chat grab must not consume repo capture.
  const grabCodeFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return null
    const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.94)
  }, [])

  return { sharing, starting, sourceLabel, error, start, stop, grabFrame, grabCodeFrame, sampleFrame }
}
