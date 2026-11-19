import type { AptitudeCapture } from '@/lib/aptitude/captureDetector'
import { aptitudeCaptureSize, encodeAptitudeCanvas } from '@/lib/aptitude/captureEncoding'

const MAX_UPLOAD_BYTES = 4_400_000
export const IMAGE_INPUT_STAGE_TIMEOUT_MS = 30_000

function abortError() { return new DOMException('Image loading cancelled', 'AbortError') }

export function captureFromImage(image: string, width: number, height: number): AptitudeCapture {
  let hash = 2166136261
  for (let i = 0; i < image.length; i += 1) hash = Math.imul(hash ^ image.charCodeAt(i), 16777619)
  return {
    id: crypto.randomUUID(), image, width, height, capturedAt: Date.now(),
    sourceHash: `image-${(hash >>> 0).toString(16)}`,
  }
}

function readFile(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const reader = new FileReader()
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      reader.onload = reader.onerror = reader.onabort = null
    }
    const fail = (error: Error, stop = false) => {
      if (settled) return
      settled = true
      cleanup()
      // Detach handlers before abort, which may synchronously fire onabort.
      if (stop) { try { reader.abort() } catch { /* The reader may already be stopped. */ } }
      reject(error)
    }
    const cancel = () => fail(abortError(), true)
    const timer = setTimeout(() => fail(new Error('Reading the screenshot took too long. Choose the file again or use screen capture.'), true), IMAGE_INPUT_STAGE_TIMEOUT_MS)
    reader.onload = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(String(reader.result))
    }
    reader.onerror = () => fail(new Error('This image could not be read. Choose another screenshot.'))
    reader.onabort = () => fail(abortError())
    signal.addEventListener('abort', cancel, { once: true })
    try { reader.readAsDataURL(file) }
    catch { fail(new Error('This image could not be read. Choose another screenshot.'), true) }
  })
}

function decodeImage(source: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const img = new Image()
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      img.onload = img.onerror = null
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      img.removeAttribute('src')
      reject(error)
    }
    const cancel = () => fail(abortError())
    const timer = setTimeout(() => fail(new Error('Opening the screenshot took too long. Save it as a new PNG or JPEG, then choose it again, or use screen capture.')), IMAGE_INPUT_STAGE_TIMEOUT_MS)
    img.onload = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(img)
    }
    img.onerror = () => fail(new Error('The file is not a readable image. Choose another screenshot.'))
    signal.addEventListener('abort', cancel, { once: true })
    try { img.src = source }
    catch { fail(new Error('The file is not a readable image. Choose another screenshot.')) }
  })
}

export async function readCaptureFile(file: File, signal: AbortSignal): Promise<AptitudeCapture> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Choose a PNG, JPEG or WebP screenshot smaller than 4.4 MB.')
  }
  const source = await readFile(file, signal)
  const image = await decodeImage(source, signal)
  if (signal.aborted) throw abortError()
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The screenshot is empty.')
  const size = aptitudeCaptureSize(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image preview is unavailable in this browser.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const data = encodeAptitudeCanvas(canvas)
  if (signal.aborted) throw abortError()
  return captureFromImage(data, canvas.width, canvas.height)
}

/** Original practice input. The answer key is deliberately absent from requests. */
export function createPracticeCapture(): AptitudeCapture {
  const canvas = document.createElement('canvas')
  canvas.width = 1000
  canvas.height = 600
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The practice image could not be created in this browser. Upload a screenshot instead.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#65685b'
  ctx.font = '20px sans-serif'
  ctx.fillText('PRACTICE QUESTION · NUMERICAL REASONING', 54, 56)
  ctx.fillStyle = '#25271f'
  ctx.font = 'bold 30px sans-serif'
  ctx.fillText('A team completed 72 tasks in week 1', 54, 126)
  ctx.fillText('and 90 tasks in week 2.', 54, 170)
  ctx.font = '28px sans-serif'
  ctx.fillText('What was the percentage increase?', 54, 232)
  ctx.font = '26px sans-serif'
  ;['A. 20%', 'B. 25%', 'C. 18%', 'D. 30%'].forEach((choice, index) => {
    ctx.fillText(choice, 66, 318 + index * 62)
  })
  return captureFromImage(canvas.toDataURL('image/png'), canvas.width, canvas.height)
}
