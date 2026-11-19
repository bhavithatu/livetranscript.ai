/** Coordinates are relative to the entire shared source, before cropping. */
export type NormalizedRegion = { x: number; y: number; width: number; height: number }

export type FrameFingerprint = {
  width: number
  height: number
  /** Interleaved RGB, three bytes per pixel. Color is meaningful in diagrams. */
  pixels: Uint8Array
  hash: string
}

export type AvailableScreenSample = {
  kind: 'available'
  image: string
  capturedAt: number
  width: number
  height: number
  sourceHash: string
  fingerprint: FrameFingerprint
}

export type UnavailableScreenSample = {
  kind: 'unavailable'
  capturedAt: number
  reason: string
}

/** Local-only observation; it cannot be submitted as an analysis capture. */
export type AvailableScreenFingerprint = Omit<AvailableScreenSample, 'image'>
export type ScreenFingerprintSample = AvailableScreenFingerprint | UnavailableScreenSample
export type ScreenSample = AvailableScreenSample | UnavailableScreenSample

export type AptitudeCapture = {
  id: string
  image: string
  capturedAt: number
  width: number
  height: number
  sourceHash: string
}

export type AptitudeCaptureStatus = 'paused' | 'watching' | 'checking' | 'settling' | 'captured' | 'unavailable'

let captureSequence = 0
export function createAptitudeCapture(sample: AvailableScreenSample): AptitudeCapture {
  return {
    id: typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `capture-${sample.capturedAt}-${++captureSequence}`,
    image: sample.image,
    capturedAt: sample.capturedAt,
    width: sample.width,
    height: sample.height,
    sourceHash: sample.sourceHash,
  }
}

/** Reject an empty/invalid crop instead of silently sending the full screen. */
export function normalizeRegion(region: NormalizedRegion): NormalizedRegion | null {
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)
    || region.width <= 0 || region.height <= 0) return null
  const x = Math.max(0, Math.min(1, region.x))
  const y = Math.max(0, Math.min(1, region.y))
  const right = Math.max(0, Math.min(1, region.x + region.width))
  const bottom = Math.max(0, Math.min(1, region.y + region.height))
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** Make a fingerprint from an already cropped and masked RGBA sample. */
export function fingerprintFromRgba(data: Uint8ClampedArray, width: number, height: number): FrameFingerprint {
  const pixels = new Uint8Array(width * height * 3)
  let hash = 2166136261
  for (let index = 0; index < width * height; index++) {
    for (let channel = 0; channel < 3; channel++) {
      const value = data[index * 4 + channel]
      pixels[index * 3 + channel] = value
      hash = Math.imul(hash ^ value, 16777619)
    }
  }
  return { width, height, pixels, hash: `${width}x${height}-${(hash >>> 0).toString(16)}` }
}

export function isBlankFingerprint(frame: FrameFingerprint): boolean {
  if (!frame.pixels.length) return true
  const low = [255, 255, 255]
  const high = [0, 0, 0]
  for (let index = 0; index < frame.pixels.length; index++) {
    const channel = index % 3
    low[channel] = Math.min(low[channel], frame.pixels[index])
    high[channel] = Math.max(high[channel], frame.pixels[index])
    if (high[channel] - low[channel] >= 12) return false
  }
  return true
}

/**
 * Localized differences matter: a changed digit must not be averaged over the
 * entire display. This is deliberately a visual candidate detector, not OCR or
 * a claim to identify a new semantic question. Timer/hover regions need masks;
 * the aptitude pipeline decides whether a stable candidate is a new question.
 */
export function fingerprintsDiffer(a: FrameFingerprint, b: FrameFingerprint): boolean {
  if (a.width !== b.width || a.height !== b.height || a.pixels.length !== b.pixels.length) return true
  if (a.hash === b.hash && a.pixels.every((pixel, index) => pixel === b.pixels[index])) return false
  let changed = 0
  let total = 0
  for (let index = 0; index < a.pixels.length; index += 3) {
    let strongest = 0
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(a.pixels[index + channel] - b.pixels[index + channel])
      total += delta
      strongest = Math.max(strongest, delta)
    }
    if (strongest >= 20) changed++
    // Four locally different pixels can be a digit or negation. Temporal
    // settling, rather than a high whole-screen threshold, rejects animation.
    if (changed >= 4) return true
  }
  return total / Math.max(1, a.pixels.length) >= 2.5
}

/**
 * A clock tick and a changed question digit can look identical locally. Keep
 * both detectable, but require a compact change to remain still across a full
 * one-second clock tick before starting another paid analysis. Broad question
 * changes retain the shorter settling window.
 */
function isLocalizedChange(a: FrameFingerprint, b: FrameFingerprint): boolean {
  if (a.width !== b.width || a.height !== b.height || a.pixels.length !== b.pixels.length) return false
  let left = a.width
  let top = a.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < a.pixels.length; index += 3) {
    if (Math.max(Math.abs(a.pixels[index] - b.pixels[index]),
      Math.abs(a.pixels[index + 1] - b.pixels[index + 1]),
      Math.abs(a.pixels[index + 2] - b.pixels[index + 2])) < 20) continue
    const pixel = index / 3
    const x = pixel % a.width
    const y = Math.floor(pixel / a.width)
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
    if (right - left + 1 > a.width * 0.15 || bottom - top + 1 > a.height * 0.15) return false
  }
  return right >= left && bottom >= top
}

export type CaptureObservation = {
  status: Exclude<AptitudeCaptureStatus, 'paused'>
  capture?: AptitudeCapture
}

export type FingerprintObservation = {
  status: Exclude<AptitudeCaptureStatus, 'paused'>
  captureReady?: true
}

/** Deterministic state machine; no network, browser APIs, or global timers. */
export class AptitudeCaptureDetector {
  private previous: FrameFingerprint | null = null
  private accepted: FrameFingerprint | null = null
  private stableSince: number | null = null
  private stableSamples = 0

  constructor(private readonly settleMs = 450) {}

  reset() {
    this.previous = null
    this.accepted = null
    this.stableSince = null
    this.stableSamples = 0
  }

  /** Keep the accepted question across a pause, but require fresh stability. */
  pause() {
    this.previous = null
    this.stableSince = null
    this.stableSamples = 0
  }

  observe(sample: ScreenSample): CaptureObservation {
    const observation = this.observeFingerprint(sample)
    if (!observation.captureReady || sample.kind !== 'available') return { status: observation.status }
    this.accept(sample)
    return { status: 'captured', capture: createAptitudeCapture(sample) }
  }

  /** A manual analysis and an automatic one share the same novelty baseline. */
  accept(sample: AvailableScreenFingerprint) {
    this.accepted = sample.fingerprint
    this.previous = sample.fingerprint
    this.stableSince = null
    this.stableSamples = 0
  }

  /**
   * Mark a candidate ready without accepting it yet. The caller must acquire a
   * fresh full-quality image and confirm it still matches before accepting.
   * Sampling an unavailable image must not consume an uncaptured question.
   */
  observeFingerprint(sample: ScreenFingerprintSample): FingerprintObservation {
    if (sample.kind === 'unavailable') {
      this.pause()
      return { status: 'unavailable' }
    }
    const current = sample.fingerprint
    if (isBlankFingerprint(current)) {
      this.pause()
      return { status: 'settling' }
    }

    // Stability and novelty have independent baselines. Repeated local sampling
    // must not consume a change before it can produce an accepted capture.
    const changing = !this.previous || fingerprintsDiffer(this.previous, current)
    this.previous = current
    if (this.accepted && !fingerprintsDiffer(this.accepted, current)) {
      this.stableSince = null
      this.stableSamples = 0
      return { status: 'watching' }
    }
    const localized = this.accepted !== null && isLocalizedChange(this.accepted, current)
    // Compact changes can be a ticking clock. Expose that uncertainty without
    // telling the UI that the whole question is already transitioning; any
    // retained answer must still be labeled as belonging to the saved capture.
    const pendingStatus = localized ? 'checking' : 'settling'
    if (changing || this.stableSince === null || sample.capturedAt < this.stableSince) {
      this.stableSince = sample.capturedAt
      this.stableSamples = 1
      return { status: pendingStatus }
    }

    this.stableSamples++
    const settleMs = localized ? Math.max(this.settleMs, 1200) : this.settleMs
    if (this.stableSamples < 2 || sample.capturedAt - this.stableSince < settleMs) {
      return { status: pendingStatus }
    }
    return { status: 'captured', captureReady: true }
  }
}
