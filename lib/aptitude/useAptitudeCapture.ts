'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AptitudeCaptureDetector,
  type AptitudeCapture,
  type AptitudeCaptureStatus,
  type ScreenSample,
} from './captureDetector'

type Options = {
  enabled: boolean
  sampleFrame: () => ScreenSample
  onCapture: (capture: AptitudeCapture) => void
  /** Local sampling cadence, not a provider latency promise. */
  intervalMs?: number
}

export function useAptitudeCapture({ enabled, sampleFrame, onCapture, intervalMs = 350 }: Options) {
  const [status, setStatus] = useState<AptitudeCaptureStatus>('paused')
  const [lastCapturedAt, setLastCapturedAt] = useState<number | null>(null)
  const detector = useRef(new AptitudeCaptureDetector())
  const callbacks = useRef({ sampleFrame, onCapture })
  const enabledRef = useRef(enabled)

  useEffect(() => { callbacks.current = { sampleFrame, onCapture }; enabledRef.current = enabled }, [sampleFrame, onCapture, enabled])

  const reset = useCallback(() => {
    detector.current.reset()
    setLastCapturedAt(null)
    setStatus(enabledRef.current ? 'watching' : 'paused')
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
        const observation = gate.observe(callbacks.current.sampleFrame())
        if (!active) return
        setStatus(observation.status)
        if (observation.capture) {
          setLastCapturedAt(observation.capture.capturedAt)
          callbacks.current.onCapture(observation.capture)
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

  return { status: enabled ? status : 'paused' as const, lastCapturedAt, reset }
}
