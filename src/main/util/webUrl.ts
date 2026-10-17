/**
 * تطبيع وجهة تصفح (قلب `fix()` من agent-app، مُعاد بناؤه نقياً).
 *
 * - `http(s)://…`          → كما هي (بعد التحقق من صلاحيتها)
 * - `localhost:3000`       → `http://localhost:3000`
 * - `example.com/path`     → `https://example.com/path`
 * - نص/سؤال (عربي أو غيره) → بحث Google مع `encodeURIComponent`
 *
 * البروتوكولات المرفوضة صراحةً (`file:`, `javascript:`, `data:`, `blob:`)
 * والنص الفارغ تُرمى بخطأ بدل التخمين — المنادي يحوّلها إلى `fail` عربي.
 */
export function normalizeWebTarget(raw: string): string {
  const text = (raw ?? '').trim()
  if (!text) throw new Error('وجهة فارغة: أعطِ رابطاً أو عبارة بحث.')

  const lower = text.toLowerCase()
  for (const bad of ['file:', 'javascript:', 'data:', 'blob:']) {
    if (lower.startsWith(bad)) throw new Error(`بروتوكول مرفوض: ${bad} — المسموح http/https فقط.`)
  }

  // رابط صريح بمخطط http/https
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad')
      return u.href
    } catch {
      // يسقط للبحث أدناه
    }
  } else {
    // مضيف:منفذ بلا مخطط (localhost:3000 أو 127.0.0.1:8080/path)
    if (/^[A-Za-z0-9.-]+:\d{1,5}(\/\S*)?$/.test(text)) return `http://${text}`
    // نطاق عارٍ (example.com أو example.com/path) — لاتيني فقط بلا مسافات
    if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d{1,5})?(\/\S*)?$/.test(text)) return `https://${text}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}
