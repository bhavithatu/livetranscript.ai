import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fingerprintFromRgba, type ScreenSample } from './captureDetector'
import { useAptitudeCapture } from './useAptitudeCapture'

function screen(seed = 0): ScreenSample {
  const data = new Uint8ClampedArray(16 * 16 * 4)
  for (let index = 0; index < 256; index++) {
    const value = (index + seed) % 8 < 4 ? 20 : 240
    data.set([value, value, value, 255], index * 4)
  }
  const fingerprint = fingerprintFromRgba(data, 16, 16)
  return { kind: 'available', image: `data:image/jpeg;base64,${seed}`, capturedAt: Date.now(),
    width: 16, height: 16, sourceHash: fingerprint.hash, fingerprint }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('aptitude screen watcher', () => {
  it('keeps sampling new questions while an earlier analysis is still pending', () => {
    let question = 0
    const sampleFrame = vi.fn(() => screen(question))
    const neverCompletes = new Promise<void>(() => {})
    const onCapture = vi.fn(() => neverCompletes)
    const { result } = renderHook(() => useAptitudeCapture({ enabled: true, sampleFrame, onCapture }))
    act(() => vi.advanceTimersByTime(1050))
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(result.current.lastCapturedAt).toBe(1050)
    question = 3
    act(() => vi.advanceTimersByTime(1400))
    expect(onCapture).toHaveBeenCalledTimes(2)
    expect(sampleFrame.mock.calls.length).toBeGreaterThan(5)
  })

  it('requires explicit opt-in and stops all sampling on pause or unmount', () => {
    const sampleFrame = vi.fn(() => screen())
    const onCapture = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useAptitudeCapture({ enabled, sampleFrame, onCapture }),
      { initialProps: { enabled: false } },
    )
    act(() => vi.advanceTimersByTime(4000))
    expect(sampleFrame).not.toHaveBeenCalled()
    expect(result.current.status).toBe('paused')
    rerender({ enabled: true })
    act(() => vi.advanceTimersByTime(1050))
    expect(onCapture).toHaveBeenCalledTimes(1)
    rerender({ enabled: false })
    const sampled = sampleFrame.mock.calls.length
    act(() => vi.advanceTimersByTime(4000))
    expect(sampleFrame).toHaveBeenCalledTimes(sampled)
    expect(result.current.status).toBe('paused')
    rerender({ enabled: true })
    unmount()
    act(() => vi.advanceTimersByTime(4000))
    expect(sampleFrame).toHaveBeenCalledTimes(sampled)
  })

  it('drops a pending candidate if screen permission is lost and waits for new stability', () => {
    let available = true
    const sampleFrame = () => available ? screen() : { kind: 'unavailable' as const, capturedAt: Date.now(), reason: 'stopped' }
    const onCapture = vi.fn()
    const { result } = renderHook(() => useAptitudeCapture({ enabled: true, sampleFrame, onCapture }))
    act(() => vi.advanceTimersByTime(700))
    available = false
    act(() => vi.advanceTimersByTime(350))
    expect(result.current.status).toBe('unavailable')
    expect(onCapture).not.toHaveBeenCalled()
    available = true
    act(() => vi.advanceTimersByTime(1050))
    expect(onCapture).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(350))
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  it('uses the latest callback and resets history when the selected region changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const sampleFrame = () => screen()
    const { result, rerender } = renderHook(
      ({ onCapture }) => useAptitudeCapture({ enabled: true, sampleFrame, onCapture }),
      { initialProps: { onCapture: first } },
    )
    act(() => vi.advanceTimersByTime(1050))
    expect(first).toHaveBeenCalledTimes(1)
    rerender({ onCapture: second })
    act(() => result.current.reset())
    expect(result.current.lastCapturedAt).toBeNull()
    act(() => vi.advanceTimersByTime(1400))
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })
})
