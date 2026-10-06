/**
 * توليد أيقونة التطبيق (256x256 PNG) بدون أي اعتماديات خارجية.
 *
 * يُشغَّل من npm run build:icon — والبناء لا ينجح بدون أيقونة 256 على الأقل،
 * لذلك نولّدها برمجيًا: دائرة لون التمييز على خلفية داكنة.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZE = 256

/** يبني صورة PNG خام (RGBA) بتدرّج دائري بسيط. */
function buildPixels() {
  const data = Buffer.alloc(SIZE * SIZE * 4)
  const cx = SIZE / 2 - 0.5
  const cy = SIZE / 2 - 0.5
  const rOuter = SIZE * 0.42
  const rMid = SIZE * 0.33
  const rInner = SIZE * 0.17

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      const d = Math.hypot(x - cx, y - cy)
      // تنعيم الحواف بقليل
      const soft = (edge, width) => Math.min(1, Math.max(0, (edge - d) / width + 0.5))

      const ring = soft(rOuter, 1.5) * soft(-rMid, 1.5)
      const core = soft(rMid, 1.5)

      // الخلفية شبه شفافة لتظهر على أي سطح
      let r = 0x0a
      let g = 0x0b
      let b = 0x0d
      let a = Math.round(soft(rOuter + 2, 2) * 255)

      if (ring > 0) {
        r = Math.round(r * (1 - ring) + 0x2a * ring)
        g = Math.round(g * (1 - ring) + 0x6d * ring)
        b = Math.round(b * (1 - ring) + 0xd9 * ring)
      }
      if (core > 0) {
        r = Math.round(r * (1 - core) + 0x4c * core)
        g = Math.round(g * (1 - core) + 0x8d * core)
        b = Math.round(b * (1 - core) + 0xff * core)
      }

      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return data
}

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, payload) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(payload.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, payload])), 0)
  return Buffer.concat([len, typeBuf, payload, crcBuf])
}

function makePng(pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // كل سطر مسبوق ببايت نوع الترشيح (0 = none)
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    const src = y * SIZE * 4
    const dst = y * (SIZE * 4 + 1)
    raw[dst] = 0
    pixels.copy(raw, dst + 1, src, src + SIZE * 4)
  }

  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = path.join(process.cwd(), 'build')
fs.mkdirSync(out, { recursive: true })
const png = makePng(buildPixels())
const pngPath = path.join(out, 'icon.png')
fs.writeFileSync(pngPath, png)
console.log(`icon written: ${pngPath} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`)