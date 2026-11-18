import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AptitudeCaptureDetector, createAptitudeCapture } from '@/lib/aptitude/captureDetector'
import { useScreenStream } from './useScreenStream'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

class Track extends EventTarget {
  readyState = 'live'
  label = 'Practice question tab'
  stop = vi.fn(() => { this.readyState = 'ended' })
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')) }
}

function stream(track: Track) {
  return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
}

type Raster = { width: number; height: number; pixels: Uint8ClampedArray }
let videoRaster: Raster
let canvases: WeakMap<HTMLCanvasElement, Raster>
let encoded: Raster[]
const getDisplayMedia = vi.fn()

function paint(raster: Raster, x: number, y: number, value: number) {
  raster.pixels.set([value, value, value, 255], (y * raster.width + x) * 4)
}

function rasterFor(canvas: HTMLCanvasElement): Raster {
  let raster = canvases.get(canvas)
  if (!raster || raster.width !== canvas.width || raster.height !== canvas.height) {
    raster = { width: canvas.width, height: canvas.height, pixels: new Uint8ClampedArray(canvas.width * canvas.height * 4) }
    canvases.set(canvas, raster)
  }
  return raster
}

function contextFor(canvas: HTMLCanvasElement) {
  return {
      fillStyle: '#ffffff',
      drawImage(source: HTMLCanvasElement | HTMLVideoElement, ...args: number[]) {
        const input = source instanceof HTMLVideoElement ? videoRaster : rasterFor(source)
        const output = rasterFor(canvas)
        const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8
          ? args : [0, 0, input.width, input.height, args[0], args[1], args[2], args[3]]
        for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
          const ix = Math.min(input.width - 1, Math.floor(sx + x * sw / dw))
          const iy = Math.min(input.height - 1, Math.floor(sy + y * sh / dh))
          const offset = (iy * input.width + ix) * 4
          output.pixels.set(input.pixels.subarray(offset, offset + 4), ((dy + y) * output.width + dx + x) * 4)
        }
      },
      fillRect(x: number, y: number, width: number, height: number) {
        const raster = rasterFor(canvas)
        for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) paint(raster, col, row, 255)
      },
      getImageData() { return { data: rasterFor(canvas).pixels.slice() } },
  } as unknown as CanvasRenderingContext2D
}

// A small, deterministic raster implementation verifies that exclusions affect
// both the outgoing image and detection, rather than merely spying on fillRect.
function installCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return contextFor(this)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    const raster = rasterFor(this)
    encoded.push({ ...raster, pixels: raster.pixels.slice() })
    return `data:image/jpeg;base64,${btoa(String.fromCharCode(...raster.pixels))}`
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  canvases = new WeakMap()
  encoded = []
  videoRaster = { width: 64, height: 32, pixels: new Uint8ClampedArray(64 * 32 * 4) }
  for (let y = 0; y < videoRaster.height; y++) for (let x = 0; x < videoRaster.width; x++) paint(videoRaster, x, y, x % 8 < 4 ? 30 : 240)
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
  getDisplayMedia.mockResolvedValue(stream(new Track()))
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockImplementation(() => videoRaster.width)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockImplementation(() => videoRaster.height)
  installCanvas()
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('screen media ownership', () => {
  it('opens one picker and retires a permission grant that arrives after Stop', async () => {
    const permission = deferred<MediaStream>()
    const track = new Track()
    getDisplayMedia.mockReturnValue(permission.promise)
    const { result } = renderHook(() => useScreenStream())
    let pending!: Promise<void>
    act(() => { pending = result.current.start(); void result.current.start() })
    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
    expect(result.current.starting).toBe(true)
    act(() => result.current.stop())
    await act(async () => { permission.resolve(stream(track)); await pending })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(result.current.sharing).toBe(false)
    expect(result.current.starting).toBe(false)
    expect(result.current.sourceLabel).toBeNull()
  })

  it('does not let an old permission grant stop a replacement session', async () => {
    const permission = deferred<MediaStream>()
    const oldTrack = new Track()
    const replacement = new Track()
    replacement.label = 'Replacement tab'
    getDisplayMedia.mockReturnValueOnce(permission.promise).mockResolvedValueOnce(stream(replacement))
    const { result } = renderHook(() => useScreenStream())
    let pending!: Promise<void>
    act(() => { pending = result.current.start() })
    act(() => result.current.stop())
    await act(async () => result.current.start())
    await act(async () => { permission.resolve(stream(oldTrack)); await pending })
    expect(oldTrack.stop).toHaveBeenCalledTimes(1)
    expect(replacement.stop).not.toHaveBeenCalled()
    expect(result.current.sharing).toBe(true)
    expect(result.current.sourceLabel).toBe('Replacement tab')
    expect(result.current.sampleFrame().kind).toBe('available')
  })

  it('retires late permission after unmount without attaching a video', async () => {
    const permission = deferred<MediaStream>()
    const track = new Track()
    getDisplayMedia.mockReturnValue(permission.promise)
    const { result, unmount } = renderHook(() => useScreenStream())
    let pending!: Promise<void>
    act(() => { pending = result.current.start() })
    unmount()
    await act(async () => { permission.resolve(stream(track)); await pending })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('does not restart sharing when video initialization finishes after Stop', async () => {
    const playing = deferred<void>()
    const track = new Track()
    getDisplayMedia.mockResolvedValue(stream(track))
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(playing.promise)
    const { result } = renderHook(() => useScreenStream())
    let pending!: Promise<void>
    await act(async () => { pending = result.current.start(); await Promise.resolve() })
    act(() => result.current.stop())
    await act(async () => { playing.resolve(); await pending })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(result.current.sharing).toBe(false)
  })

  it('releases tracks on browser stop, page exit, and unmount', async () => {
    const ended = new Track()
    const pageExit = new Track()
    const removed = new Track()
    getDisplayMedia.mockResolvedValueOnce(stream(ended)).mockResolvedValueOnce(stream(pageExit)).mockResolvedValueOnce(stream(removed))
    const { result, unmount } = renderHook(() => useScreenStream())
    await act(async () => result.current.start())
    act(() => ended.end())
    expect(result.current.sharing).toBe(false)
    expect(ended.stop).toHaveBeenCalledTimes(1)
    await act(async () => result.current.start())
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(pageExit.stop).toHaveBeenCalledTimes(1)
    expect(result.current.sharing).toBe(false)
    await act(async () => result.current.start())
    unmount()
    expect(removed.stop).toHaveBeenCalledTimes(1)
  })
})

describe('independent aptitude screen samples', () => {
  it('returns repeatable manual captures without consuming the legacy difference gate', async () => {
    const { result } = renderHook(() => useScreenStream())
    expect(result.current.sampleFrame().kind).toBe('unavailable')
    await act(async () => result.current.start())
    const first = result.current.sampleFrame()
    const second = result.current.sampleFrame()
    expect(first.kind).toBe('available')
    expect(second.kind).toBe('available')
    if (first.kind !== 'available' || second.kind !== 'available') throw new Error('Expected readable samples')
    expect(first.image).toBe(second.image)
    expect(first.sourceHash).toBe(second.sourceHash)
    expect(createAptitudeCapture(first).id).not.toBe(createAptitudeCapture(second).id)
    expect(result.current.grabFrame()).not.toBeNull()
    expect(result.current.grabFrame()).toBeNull()
    expect(result.current.sampleFrame().kind).toBe('available')
    expect(result.current.grabCodeFrame()).not.toBeNull()
  })

  it('masks changing timer pixels in both the outgoing image and novelty detection', async () => {
    const { result } = renderHook(() => useScreenStream())
    await act(async () => result.current.start())
    const options = { masks: [{ x: 0.75, y: 0, width: 0.25, height: 0.25 }] }
    const first = result.current.sampleFrame(options)
    for (let y = 0; y < 8; y++) for (let x = 48; x < 64; x++) paint(videoRaster, x, y, 100)
    const second = result.current.sampleFrame(options)
    if (first.kind !== 'available' || second.kind !== 'available') throw new Error('Expected readable samples')
    expect(second.image).toBe(first.image)
    expect(second.sourceHash).toBe(first.sourceHash)
    expect(encoded[0].pixels[(2 * 64 + 50) * 4]).toBe(255)
    const detector = new AptitudeCaptureDetector()
    detector.observe({ ...first, capturedAt: 0 })
    expect(detector.observe({ ...second, capturedAt: 800 }).capture).toBeDefined()
    expect(detector.observe({ ...second, capturedAt: 1600 }).capture).toBeUndefined()
  })

  it('applies full-source coordinates after crop and leaves unmasked question text intact', async () => {
    const { result } = renderHook(() => useScreenStream())
    await act(async () => result.current.start())
    const current = result.current.sampleFrame({
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      masks: [{ x: 0.5, y: 0.25, width: 0.25, height: 0.25 }],
    })
    if (current.kind !== 'available') throw new Error('Expected readable crop')
    expect([current.width, current.height]).toEqual([32, 16])
    expect(encoded[0].pixels[(2 * 32 + 18) * 4]).toBe(255)
    expect(encoded[0].pixels[(2 * 32 + 2) * 4]).toBe(videoRaster.pixels[(10 * 64 + 18) * 4])
    expect(encoded[0].pixels[(10 * 32 + 18) * 4]).toBe(videoRaster.pixels[(18 * 64 + 34) * 4])
  })

  it('refuses invalid areas and oversized payloads rather than sending the whole source', async () => {
    const { result } = renderHook(() => useScreenStream())
    await act(async () => result.current.start())
    expect(result.current.sampleFrame({ crop: { x: 0, y: 0, width: 0, height: 1 } }).kind).toBe('unavailable')
    expect(result.current.sampleFrame({ masks: [{ x: 0, y: 0, width: 0, height: 1 }] }).kind).toBe('unavailable')
    expect(encoded).toHaveLength(0)
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(`data:image/jpeg;base64,${'a'.repeat(1_150_001)}`)
    const tooLarge = result.current.sampleFrame()
    expect(tooLarge.kind).toBe('unavailable')
    if (tooLarge.kind === 'unavailable') expect(tooLarge.reason).toContain('smaller question area')
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(3)
  })
})
