import { describe, expect, it, vi } from 'vitest'
import { aptitudeCaptureSize, encodeAptitudeCanvas } from './captureEncoding'
import { MAX_APTITUDE_IMAGE_CHARS } from './schema'

describe('readable aptitude capture encoding', () => {
  it('preserves high-DPI question pixels and portrait aspect ratios without enlarging small crops', () => {
    expect(aptitudeCaptureSize(2560, 2820)).toEqual({ width: 2560, height: 2820 })
    expect(aptitudeCaptureSize(300, 176)).toEqual({ width: 300, height: 176 })
    expect(aptitudeCaptureSize(5120, 2880)).toEqual({ width: 4096, height: 2304 })
    expect(aptitudeCaptureSize(2880, 5120)).toEqual({ width: 2304, height: 4096 })
    expect(() => aptitudeCaptureSize(0, 100)).toThrow('empty')
    expect(() => aptitudeCaptureSize(Number.NaN, 100)).toThrow('empty')
  })

  it('keeps a lossless screenshot that exceeded the former client limit but fits the API budget', () => {
    const png = `data:image/png;base64,${'A'.repeat(1_500_000)}`
    const toDataURL = vi.fn(() => png)
    const canvas = { width: 2560, height: 2820, toDataURL } as unknown as HTMLCanvasElement
    expect(encodeAptitudeCanvas(canvas)).toBe(png)
    expect(toDataURL).toHaveBeenCalledOnce()
    expect(toDataURL).toHaveBeenCalledWith('image/png', undefined)
    expect([canvas.width, canvas.height]).toEqual([2560, 2820])
  })

  it('falls back to high-quality JPEG at the original dimensions for photo-heavy sources', () => {
    const png = `data:image/png;base64,${'A'.repeat(MAX_APTITUDE_IMAGE_CHARS)}`
    const jpeg = 'data:image/jpeg;base64,AAAA'
    const toDataURL = vi.fn().mockReturnValueOnce(png).mockReturnValueOnce(jpeg)
    const canvas = { width: 2560, height: 1440, toDataURL } as unknown as HTMLCanvasElement
    expect(encodeAptitudeCanvas(canvas)).toBe(jpeg)
    expect(toDataURL).toHaveBeenNthCalledWith(2, 'image/jpeg', 0.95)
    expect([canvas.width, canvas.height]).toEqual([2560, 1440])
  })

  it('asks for a complete, smaller question area instead of destroying detail to fit the request', () => {
    const toDataURL = vi.fn((type: string) => `data:${type};base64,${'A'.repeat(MAX_APTITUDE_IMAGE_CHARS)}`)
    const canvas = { width: 3840, height: 2160, toDataURL } as unknown as HTMLCanvasElement
    expect(() => encodeAptitudeCanvas(canvas)).toThrow('complete question and all answer options')
    expect([canvas.width, canvas.height]).toEqual([3840, 2160])
    expect(toDataURL.mock.calls.every((call) => call[0] === 'image/png' || call[0] === 'image/jpeg')).toBe(true)
  })
})
