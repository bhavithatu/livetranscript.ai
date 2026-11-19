import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IMAGE_INPUT_STAGE_TIMEOUT_MS, readCaptureFile } from './captureInput'

const data = 'data:image/png;base64,AAAA'
const encode = vi.hoisted(() => vi.fn(() => 'data:image/png;base64,AAAA'))
vi.mock('@/lib/aptitude/captureEncoding', async importOriginal => ({ ...await importOriginal<object>(), encodeAptitudeCanvas: encode }))
let readers: Reader[] = []
let images: MockImage[] = []
class Reader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  readAsDataURL = vi.fn()
  abort = vi.fn(() => this.onabort?.())
  constructor() { readers.push(this) }
  finish() { this.result = data; this.onload?.() }
}
class MockImage {
  src = ''
  naturalWidth = 1100
  naturalHeight = 620
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  removeAttribute = vi.fn(() => { this.src = '' })
  constructor() { images.push(this) }
}
const file = () => new File(['owned practice bytes'], 'practice.png', { type: 'image/png' })
const outcome = (signal: AbortSignal) => readCaptureFile(file(), signal).then(value => ({ value, error: null }), (error: Error) => ({ value: null, error }))
const beginDecode = async () => { readers[0].finish(); await Promise.resolve() }
beforeEach(() => {
  vi.useFakeTimers()
  readers = []; images = []; encode.mockClear()
  vi.stubGlobal('FileReader', Reader); vi.stubGlobal('Image', MockImage)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('times out a silent FileReader and ignores its late load event', async () => {
  const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener')
  const pending = outcome(controller.signal), lateLoad = readers[0].onload!
  await vi.advanceTimersByTimeAsync(IMAGE_INPUT_STAGE_TIMEOUT_MS)
  expect((await pending).error?.message).toMatch(/Reading the screenshot took too long/)
  expect(readers[0].abort).toHaveBeenCalledOnce()
  expect(readers[0].onload).toBeNull(); expect(readers[0].onerror).toBeNull(); expect(readers[0].onabort).toBeNull()
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  lateLoad(); await Promise.resolve()
  expect(images).toHaveLength(0); expect(encode).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
})
it('times out image decoding separately and clears its source and handlers', async () => {
  const controller = new AbortController(), pending = outcome(controller.signal)
  await beginDecode()
  const lateLoad = images[0].onload!
  await vi.advanceTimersByTimeAsync(IMAGE_INPUT_STAGE_TIMEOUT_MS)
  expect((await pending).error?.message).toMatch(/Opening the screenshot took too long/)
  expect(images[0].removeAttribute).toHaveBeenCalledWith('src')
  expect(images[0].onload).toBeNull(); expect(images[0].onerror).toBeNull()
  lateLoad()
  expect(encode).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
})
it.each(['reading', 'decoding'] as const)('cancels %s without a later timeout or image result', async stage => {
  const controller = new AbortController(), pending = outcome(controller.signal)
  if (stage === 'decoding') await beginDecode()
  controller.abort()
  expect((await pending).error?.name).toBe('AbortError')
  expect(vi.getTimerCount()).toBe(0)
  if (stage === 'reading') expect(readers[0].abort).toHaveBeenCalledOnce()
  else expect(images[0].removeAttribute).toHaveBeenCalledWith('src')
  expect(encode).not.toHaveBeenCalled()
})
it('rejects an already cancelled request without starting a read', async () => {
  const controller = new AbortController(); controller.abort()
  expect((await outcome(controller.signal)).error?.name).toBe('AbortError')
  expect(readers).toHaveLength(0); expect(vi.getTimerCount()).toBe(0)
})
it.each(['reading', 'decoding'] as const)('cleans up timers on a browser %s error', async stage => {
  const pending = outcome(new AbortController().signal)
  if (stage === 'reading') readers[0].onerror!()
  else { await beginDecode(); images[0].onerror!() }
  expect((await pending).error?.message).toMatch(stage === 'reading' ? /could not be read/ : /not a readable image/)
  expect(vi.getTimerCount()).toBe(0)
})
it('completes a valid upload and leaves no timeout or abort listener behind', async () => {
  const drawImage = vi.fn(), controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D)
  const pending = outcome(controller.signal)
  await beginDecode(); images[0].onload!()
  expect((await pending).value).toMatchObject({ image: data, width: 1100, height: 620 })
  expect(drawImage).toHaveBeenCalledWith(images[0], 0, 0, 1100, 620)
  expect(remove).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
  controller.abort()
  expect(readers[0].abort).not.toHaveBeenCalled(); expect(images[0].removeAttribute).not.toHaveBeenCalled()
})

it('cleans up a synchronous FileReader start failure', async () => {
  vi.stubGlobal('FileReader', class extends Reader {
    readAsDataURL = vi.fn(() => { throw new Error('File handle is no longer readable') })
  })
  const pending = outcome(new AbortController().signal)
  expect((await pending).error?.message).toMatch(/could not be read/)
  expect(readers[0].abort).toHaveBeenCalledOnce()
  expect(readers[0].onload).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})
