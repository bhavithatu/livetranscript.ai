// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { validateAptitudeImage } from './image'

const require = createRequire(import.meta.url)
const fromNext = createRequire(require.resolve('next/package.json'))
const sharp = fromNext('sharp') as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> }; jpeg(): { toBuffer(): Promise<Buffer> }; webp(): { toBuffer(): Promise<Buffer> } }
const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="white"/><text x="12" y="45">Question</text></svg>')
describe('screenshot validation', () => {
  it('accepts real PNG, JPEG and WebP captures', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const bytes = await sharp(source)[format]().toBuffer()
      expect(validateAptitudeImage(`data:image/${format};base64,${bytes.toString('base64')}`).mediaType).toBe(`image/${format}`)
    }
  })
  it('rejects a plausible image signature with impossible dimensions or incomplete PNG content', async () => {
    const bytes = await sharp(source).png().toBuffer()
    const oversized = Buffer.from(bytes); oversized.writeUInt32BE(100_000, 16)
    expect(() => validateAptitudeImage(`data:image/png;base64,${oversized.toString('base64')}`)).toThrow('dimensions')
    expect(() => validateAptitudeImage(`data:image/png;base64,${bytes.subarray(0,40).toString('base64')}`)).toThrow('dimensions')
  })
})
