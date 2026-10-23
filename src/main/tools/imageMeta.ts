export function imageDimensions(buf: Buffer): { w: number; h: number; type: string } | null {
  if (buf.length < 16) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'PNG' }
  }
  if (buf.slice(0, 3).toString('latin1') === 'GIF') {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), type: 'GIF' }
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)), type: 'BMP' }
  }
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    if (buf.slice(12, 16).toString('latin1') === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
      return { w, h, type: 'WEBP' }
    }
    return { w: 0, h: 0, type: 'WEBP' }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++
        continue
      }
      const marker = buf[off + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7), type: 'JPEG' }
      }
      const len = buf.readUInt16BE(off + 2)
      if (len < 2) break
      off += 2 + len
    }
    return { w: 0, h: 0, type: 'JPEG' }
  }
  return null
}

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'])
