import type { ImageAttachment } from './types'

export const MAX_IMAGES = 6
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export interface ValidateResult {
  ok: ImageAttachment[]
  error?: string
}

export function base64Bytes(b64: string): number {
  if (!b64) return 0
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

function isBase64(s: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0
}

export function validateImages(list: readonly { mediaType: string; data: string }[]): ValidateResult {
  if (!list.length) return { ok: [] }
  if (list.length > MAX_IMAGES) return { ok: [], error: `الحد الأقصى ${MAX_IMAGES} صور في الرسالة الواحدة.` }
  const out: ImageAttachment[] = []
  for (const a of list) {
    if (!ALLOWED_IMAGE_TYPES.includes(a.mediaType as (typeof ALLOWED_IMAGE_TYPES)[number]))
      return { ok: [], error: `نوع غير مدعوم: ${a.mediaType}. المدعوم: PNG و JPEG و WebP و GIF.` }
    if (!a.data || !isBase64(a.data)) return { ok: [], error: 'بيانات الصورة تالفة (base64 غير صالح).' }
    const bytes = base64Bytes(a.data)
    if (bytes > MAX_IMAGE_BYTES) return { ok: [], error: `صورة أضخ من الحد (${(bytes / 1048576).toFixed(1)}MB > 4MB).` }
    out.push({ mediaType: a.mediaType, data: a.data })
  }
  return { ok: out }
}
