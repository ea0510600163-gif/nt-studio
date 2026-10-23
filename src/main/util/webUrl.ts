export function normalizeWebTarget(raw: string): string {
  const text = (raw ?? '').trim()
  if (!text) throw new Error('وجهة فارغة: أعطِ رابطاً أو عبارة بحث.')

  const lower = text.toLowerCase()
  for (const bad of ['file:', 'javascript:', 'data:', 'blob:']) {
    if (lower.startsWith(bad)) throw new Error(`بروتوكول مرفوض: ${bad} — المسموح http/https فقط.`)
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad')
      return u.href
    } catch {}
  } else {
    if (/^[A-Za-z0-9.-]+:\d{1,5}(\/\S*)?$/.test(text)) return `http://${text}`
    if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d{1,5})?(\/\S*)?$/.test(text)) return `https://${text}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}
