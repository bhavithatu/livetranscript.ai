import type { AptitudeCapture } from '@/lib/aptitude/captureDetector'

const MAX_UPLOAD_BYTES = 4_400_000
const MAX_IMAGE_LENGTH = 1_150_000

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
    const cleanup = () => signal.removeEventListener('abort', cancel)
    const cancel = () => { reader.abort(); cleanup(); reject(abortError()) }
    reader.onload = () => { cleanup(); resolve(String(reader.result)) }
    reader.onerror = () => { cleanup(); reject(new Error('This image could not be read. Choose another screenshot.')) }
    reader.onabort = () => { cleanup(); reject(abortError()) }
    signal.addEventListener('abort', cancel, { once: true })
    reader.readAsDataURL(file)
  })
}

export async function readCaptureFile(file: File, signal: AbortSignal): Promise<AptitudeCapture> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Choose a PNG, JPEG or WebP screenshot smaller than 4.4 MB.')
  }
  const source = await readFile(file, signal)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const img = new Image()
    const cleanup = () => signal.removeEventListener('abort', cancel)
    const cancel = () => { cleanup(); img.src = ''; reject(abortError()) }
    img.onload = () => { cleanup(); resolve(img) }
    img.onerror = () => { cleanup(); reject(new Error('The file is not a readable image. Choose another screenshot.')) }
    signal.addEventListener('abort', cancel, { once: true })
    img.src = source
  })
  if (signal.aborted) throw abortError()
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The screenshot is empty.')
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image preview is unavailable in this browser.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  let data = canvas.toDataURL('image/jpeg', 0.88)
  if (data.length > MAX_IMAGE_LENGTH) data = canvas.toDataURL('image/jpeg', 0.65)
  if (data.length > MAX_IMAGE_LENGTH) throw new Error('This screenshot has too much detail. Crop to the complete question and try again.')
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
