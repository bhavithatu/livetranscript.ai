'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AptitudeCaptureDetector,
  createAptitudeCapture,
  fingerprintsDiffer,
  type AptitudeCapture,
  type AptitudeCaptureStatus,
  type AvailableScreenSample,
  type ScreenFingerprintSample,
  type ScreenSample,
} from './captureDetector'

type Options = {
  enabled: boolean
  sampleFrame: () => ScreenSample
  /** Cheap local observation; encode a full image only after it settles. */
  sampleFingerprint?: () => ScreenFingerprintSample
  onCapture: (capture: AptitudeCapture) => void
  /** Local sampling cadence, not a provider latency promise. */
  intervalMs?: number
}

export function useAptitudeCapture({ enabled, sampleFrame, sampleFingerprint, onCapture, intervalMs = 200 }: Options) {
  const [status, setStatus] = useState<AptitudeCaptureStatus>('paused')
  const [lastCapturedAt, setLastCapturedAt] = useState<number | null>(null)
  const detector = useRef(new AptitudeCaptureDetector())
  const callbacks = useRef({ sampleFrame, sampleFingerprint, onCapture })
  const enabledRef = useRef(enabled)

  useEffect(() => { callbacks.current = { sampleFrame, sampleFingerprint, onCapture }; enabledRef.current = enabled }, [sampleFrame, sampleFingerprint, onCapture, enabled])

  const reset = useCallback(() => {
    detector.current.reset()
    setLastCapturedAt(null)
    setStatus(enabledRef.current ? 'watching' : 'paused')
  }, [])

  const accept = useCallback((sample: AvailableScreenSample) => {
    detector.current.accept(sample)
    setLastCapturedAt(sample.capturedAt)
    setStatus(enabledRef.current ? 'captured' : 'paused')
  }, [])

  useEffect(() => {
    const gate = detector.current
    if (!enabled) {
      gate.pause()
      return
    }
    let active = true
    const tick = () => {
      if (!active) return
      try {
        const current = callbacks.current
        const sampled = current.sampleFingerprint ? current.sampleFingerprint() : current.sampleFrame()
        const observation = gate.observeFingerprint(sampled)
        if (!active) return
        setStatus(observation.status)
        if (observation.captureReady && sampled.kind === 'available') {
          // The source can change between the cheap observation and full-image
          // acquisition. Never send a newer transition frame under an older
          // candidate's stability decision.
          const full = current.sampleFingerprint ? current.sampleFrame() : sampled as ScreenSample
          if (full.kind !== 'available' || fingerprintsDiffer(sampled.fingerprint, full.fingerprint)) {
            setStatus(gate.observeFingerprint(full).status)
            return
          }
          gate.accept(full)
          const capture = createAptitudeCapture(full)
          setLastCapturedAt(capture.capturedAt)
          current.onCapture(capture)
        }
      } catch {
        gate.pause()
        if (active) setStatus('unavailable')
      }
    }
    // A timer also avoids setting state synchronously in an effect. The watcher
    // never waits for the analysis callback, so newer questions remain visible.
    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, Math.max(100, intervalMs))
    return () => {
      active = false
      window.clearTimeout(first)
      window.clearInterval(timer)
      gate.pause()
    }
  }, [enabled, intervalMs])

  return { status: enabled ? status : 'paused' as const, lastCapturedAt, reset, accept }
}
