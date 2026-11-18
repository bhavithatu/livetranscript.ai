import { describe, expect, it } from 'vitest'
import {
  AptitudeCaptureDetector,
  createAptitudeCapture,
  fingerprintFromRgba,
  fingerprintsDiffer,
  normalizeRegion,
  type AvailableScreenSample,
  type FrameFingerprint,
} from './captureDetector'

function frame(seed = 0, size = 32): FrameFingerprint {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const value = (i + seed) % 11 < 5 ? 20 : 240
    rgba.set([value, value, value, 255], i * 4)
  }
  return fingerprintFromRgba(rgba, size, size)
}

function sample(fingerprint: FrameFingerprint, capturedAt: number): AvailableScreenSample {
  return { kind: 'available', image: `data:image/jpeg;base64,${fingerprint.hash}`,
    capturedAt, width: fingerprint.width, height: fingerprint.height,
    sourceHash: fingerprint.hash, fingerprint }
}

describe('aptitude visual capture gate', () => {
  it('waits for stability, emits the latest frame once, and captures a new question without cooldown', () => {
    const detector = new AptitudeCaptureDetector()
    const first = frame()
    expect(detector.observe(sample(first, 0)).status).toBe('settling')
    expect(detector.observe(sample(first, 350)).capture).toBeUndefined()
    expect(detector.observe(sample(first, 700)).capture).toBeUndefined()
    const accepted = detector.observe(sample(first, 1050))
    expect(accepted.capture?.capturedAt).toBe(1050)
    expect(detector.observe(sample(first, 1400))).toEqual({ status: 'watching' })

    const second = frame(4)
    detector.observe(sample(second, 1750))
    detector.observe(sample(second, 2100))
    detector.observe(sample(second, 2450))
    const next = detector.observe(sample(second, 2800)).capture
    expect(next?.sourceHash).toBe(second.hash)
    expect(next?.id).not.toBe(accepted.capture?.id)
  })

  it('does not treat continuous motion, blank transitions, or an unavailable stream as a settled question', () => {
    const detector = new AptitudeCaptureDetector()
    for (let index = 0; index < 8; index++) {
      expect(detector.observe(sample(frame(index), index * 350)).capture).toBeUndefined()
    }
    const blank: FrameFingerprint = { width: 32, height: 32, pixels: new Uint8Array(1024 * 3).fill(255), hash: 'blank' }
    expect(detector.observe(sample(blank, 4000)).capture).toBeUndefined()
    expect(detector.observe(sample(blank, 5000)).capture).toBeUndefined()
    const question = frame(2)
    detector.observe(sample(question, 5350))
    expect(detector.observe({ kind: 'unavailable', capturedAt: 5700, reason: 'stopped' }).status).toBe('unavailable')
    expect(detector.observe(sample(question, 7000)).capture).toBeUndefined()
    expect(detector.observe(sample(question, 7350)).capture).toBeUndefined()
    expect(detector.observe(sample(question, 8050)).capture?.sourceHash).toBe(question.hash)
  })

  it('discards a short intermediate question and accepts the final settled frame', () => {
    const detector = new AptitudeCaptureDetector()
    detector.observe(sample(frame(), 0))
    detector.observe(sample(frame(2), 350))
    const final = frame(6)
    detector.observe(sample(final, 700))
    expect(detector.observe(sample(final, 1050)).capture).toBeUndefined()
    expect(detector.observe(sample(final, 1400)).capture).toBeUndefined()
    expect(detector.observe(sample(final, 1750)).capture?.sourceHash).toBe(final.hash)
  })

  it('detects a tiny local digit-sized change that a whole-frame mean would hide', () => {
    const original = frame(0, 512)
    const pixels = original.pixels.slice()
    for (const index of [1010, 1011, 1522, 1523]) {
      for (let channel = 0; channel < 3; channel++) pixels[index * 3 + channel] = 255 - pixels[index * 3 + channel]
    }
    const digit = { ...original, pixels, hash: 'changed-digit' }
    expect(fingerprintsDiffer(original, digit)).toBe(true)
    const meanDifference = pixels.reduce((sum, value, index) => sum + Math.abs(value - original.pixels[index]), 0) / pixels.length / 255
    expect(meanDifference).toBeLessThan(0.02)
    const detector = new AptitudeCaptureDetector()
    detector.observe(sample(original, 0))
    detector.observe(sample(original, 800))
    detector.observe(sample(digit, 1100))
    expect(detector.observe(sample(digit, 1900)).capture?.sourceHash).toBe('changed-digit')
  })

  it('detects color-pattern changes even when the two colors have equal luminance', () => {
    const red = [255, 0, 0, 255]
    const green = [0, 130, 0, 255]
    expect(Math.round(0.299 * red[0])).toBe(Math.round(0.587 * green[1]))
    const a = new Uint8ClampedArray(16 * 16 * 4)
    const b = new Uint8ClampedArray(a.length)
    for (let index = 0; index < 256; index++) {
      a.set(index % 2 ? red : green, index * 4)
      b.set(index % 2 ? green : red, index * 4)
    }
    const first = fingerprintFromRgba(a, 16, 16)
    const second = fingerprintFromRgba(b, 16, 16)
    expect(first.hash).not.toBe(second.hash)
    expect(fingerprintsDiffer(first, second)).toBe(true)
    const detector = new AptitudeCaptureDetector()
    detector.observe(sample(first, 0))
    expect(detector.observe(sample(first, 800)).capture).toBeDefined()
    detector.observe(sample(second, 1000))
    expect(detector.observe(sample(second, 1800)).capture?.sourceHash).toBe(second.hash)
  })

  it('uses independent novelty/stability baselines and emits revisits for semantic history to resolve', () => {
    const detector = new AptitudeCaptureDetector()
    const a = frame()
    const b = frame(5)
    detector.observe(sample(a, 0))
    detector.observe(sample(a, 800))
    detector.observe(sample(b, 1000))
    expect(detector.observe(sample(b, 1200)).capture).toBeUndefined()
    expect(detector.observe(sample(b, 1800)).capture?.sourceHash).toBe(b.hash)
    detector.observe(sample(a, 2000))
    expect(detector.observe(sample(a, 2800)).capture?.sourceHash).toBe(a.hash)
  })

  it('preserves the accepted frame across pause, but reset explicitly permits a fresh capture', () => {
    const detector = new AptitudeCaptureDetector()
    const question = frame()
    detector.observe(sample(question, 0))
    detector.observe(sample(question, 800))
    detector.pause()
    expect(detector.observe(sample(question, 1000)).capture).toBeUndefined()
    detector.reset()
    expect(detector.observe(sample(question, 1500)).capture).toBeUndefined()
    expect(detector.observe(sample(question, 2300)).capture).toBeDefined()
  })

  it('creates independent manual revisions even when the image is unchanged', () => {
    const current = sample(frame(), 100)
    const first = createAptitudeCapture(current)
    const second = createAptitudeCapture(current)
    expect(second.id).not.toBe(first.id)
    expect(second.image).toBe(first.image)
    expect(second.sourceHash).toBe(first.sourceHash)
  })

  it('clamps regions to the shared source and rejects empty/nonfinite selections', () => {
    expect(normalizeRegion({ x: -0.1, y: 0.2, width: 0.5, height: 1 })).toEqual({ x: 0, y: 0.2, width: 0.4, height: 0.8 })
    expect(normalizeRegion({ x: 1, y: 0, width: 0.2, height: 1 })).toBeNull()
    expect(normalizeRegion({ x: 0, y: 0, width: 0, height: 1 })).toBeNull()
    expect(normalizeRegion({ x: NaN, y: 0, width: 1, height: 1 })).toBeNull()
  })
})
