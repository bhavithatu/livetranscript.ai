import { MAX_APTITUDE_IMAGE_CHARS } from './schema'

// Keep the pixels of a question crop rather than making it fit the sidebar.
// This bound also keeps unusually large display surfaces below the server's
// image-dimension limit. Smaller captures are never enlarged.
export const APTITUDE_CAPTURE_LONG_EDGE = 4096

export function aptitudeCaptureSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new AptitudeCaptureEncodingError('The screenshot is empty. Capture the complete question again.')
  }
  const scale = Math.min(1, APTITUDE_CAPTURE_LONG_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export class AptitudeCaptureEncodingError extends Error {}

/**
 * Lossless screen text and diagram edges first. If PNG exceeds the request
 * budget, use high-quality JPEG at the SAME dimensions. Never silently shrink
 * an already selected question to satisfy a byte budget: that can erase the
 * marks that distinguish diagram options or individual digits.
 */
export function encodeAptitudeCanvas(canvas: HTMLCanvasElement): string {
  for (const [type, quality] of [
    ['image/png', undefined],
    ['image/jpeg', 0.95],
    ['image/jpeg', 0.9],
  ] as const) {
    const image = canvas.toDataURL(type, quality)
    if (image.startsWith(`data:${type};base64,`) && image.length <= MAX_APTITUDE_IMAGE_CHARS) return image
  }
  throw new AptitudeCaptureEncodingError('The capture is too large to send clearly. Select a smaller question area that includes the complete question and all answer options.')
}
