import { parseRepoImage, RepoRequestError } from '@/lib/repo/agentHttp'

/** Header/dimension checks are not an image decoder; they reject obvious malformed or oversized uploads. */
export function validateAptitudeImage(value: string): ReturnType<typeof parseRepoImage> {
  const image = parseRepoImage(value)
  const bytes = Buffer.from(image.data, 'base64')
  let width = 0, height = 0
  if (image.mediaType === 'image/png') {
    if (bytes.length >= 57 && bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString() === 'IHDR' && bytes.subarray(-8, -4).toString() === 'IEND') {
      width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
    }
  } else if (image.mediaType === 'image/jpeg') {
    if (bytes.length >= 12 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
      let offset = 2
      while (offset + 4 < bytes.length) {
        if (bytes[offset++] !== 0xff) break
        while (bytes[offset] === 0xff) offset++
        const marker = bytes[offset++]
        if (marker === 0xda || marker === 0xd9) break
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
        if (offset + 2 > bytes.length) break
        const length = bytes.readUInt16BE(offset)
        if (length < 2 || offset + length > bytes.length) break
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
          height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break
        }
        offset += length
      }
    }
  } else if (bytes.length >= 30 && bytes.readUInt32LE(4) === bytes.length - 8) {
    const kind = bytes.subarray(12, 16).toString()
    if (kind === 'VP8X') { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1 }
    else if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1
    } else if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff
    }
  }
  if (width < 1 || height < 1 || width > 8_192 || height > 8_192 || width * height > 24_000_000) throw new RepoRequestError('Screenshot has invalid or oversized image dimensions. Use a fresh PNG, JPEG, or WebP capture.')
  return image
}
