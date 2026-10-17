import { clip } from '../util'
import { isAppPort } from '../ports'
import { preview } from '../preview'
import { normalizeWebTarget } from '../util/webUrl'
import { Tool, fail, ok, schema } from './types'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&#x27;': "'" }
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENT[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|iframe)[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<h([1-3])[^>]*>/gi, (_, n) => '\n\n' + '#'.repeat(+n) + ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/pre)[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

interface Hit { title: string; url: string; snippet: string }

async function ddg(q: string, signal: AbortSignal): Promise<Hit[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: new URLSearchParams({ q }).toString(),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
  })
  const html = await res.text()
  const hits: Hit[] = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && hits.length < 10) {
    let url = decode(m[1])
    const u = /uddg=([^&]+)/.exec(url)
    if (u) url = decodeURIComponent(u[1])
    else if (url.startsWith('//')) url = 'https:' + url
    hits.push({ title: strip(m[2]), url, snippet: strip(m[3] ?? '') })
  }
  return hits
}

async function bing(q: string, signal: AbortSignal): Promise<Hit[]> {
  const res = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(q), { headers: { 'user-agent': UA }, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
  const html = await res.text()
  const hits: Hit[] = []
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?[\s\S]*?<\/li>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && hits.length < 10) hits.push({ title: strip(m[2]), url: decode(m[1]), snippet: strip(m[3] ?? '') })
  return hits
}

export const webTools: Tool[] = [
  {
    name: 'web_search',
    parallel: true,
    description: 'Search the web and return top results with title, URL, and snippet.',
    schema: schema({ query: { type: 'string', description: 'Search query' } }, ['query']),
    async run(i, ctx) {
      const q = String(i.query)
      let hits: Hit[] = []
      let lastErr = ''
      for (const engine of [ddg, bing]) {
        try { hits = await engine(q, ctx.signal) } catch (e) { lastErr = (e as Error).message }
        if (hits.length) break
      }
      if (!hits.length) return fail(`لم تُرجع محركات البحث نتائج${lastErr ? ` (${lastErr})` : ''}. جرّب صياغة أخرى أو web_fetch لصفحة التوثيق مباشرة.`)
      return ok(hits.map((h, k) => `${k + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n'))
    }
  },
  {
    name: 'web_fetch',
    parallel: true,
    description: 'Fetch a URL and return its readable text/markdown or JSON content.',
    schema: schema({ url: { type: 'string', description: 'HTTP/HTTPS URL to fetch' }, max_chars: { type: 'number', description: 'Max characters to return (default 40000, max 80000)' } }, ['url']),
    async run(i, ctx) {
      try {
        const res = await fetch(String(i.url), { headers: { 'user-agent': UA, accept: 'text/html,application/json,text/plain,*/*' }, redirect: 'follow', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20000)]) })
        const ct = res.headers.get('content-type') ?? ''
        if (!res.ok) return fail(`فشل الجلب: الخادم رد HTTP ${res.status} (${res.statusText}) للرابط ${i.url}. تحقق من الرابط، أو جرّب web_search للوصول لصفحة بديلة.`)
        if (/image|video|audio|zip|octet/.test(ct)) return fail(`نوع محتوى غير نصي: ${ct}`)
        const raw = await res.text()
        const text = /html/.test(ct) ? htmlToText(raw) : raw
        return ok(clip(text, Math.min(Number(i.max_chars) || 40000, 80000), 0.8))
      } catch (e) {
        return fail(`تعذّر جلب ${i.url} (${(e as Error).message}). تحقق من الاتصال والإملاء ثم أعد المحاولة، أو استخدم web_search.`)
      }
    }
  },
  {
    name: 'web_open',
    // تسلسلي عمداً: فتحان متزامنان يتسابقان على الصفحة نفسها
    description: 'Open any website or search words in the live preview browser (general web: Google, X, YouTube…). For local projects use preview_open (port/path) instead. Accepts a full URL, a bare domain (example.com), or plain search words in any language.',
    schema: schema({ target: { type: 'string', description: 'URL, bare domain, or search words (Arabic supported)' } }, ['target']),
    async run(i, ctx) {
      let target: string
      try {
        target = normalizeWebTarget(String(i.target))
      } catch (e) {
        return fail((e as Error).message)
      }
      try {
        const u = new URL(target)
        if (isAppPort(Number(u.port || 0)))
          return fail(`المنفذ ${u.port} هو منفذ NT Studio نفسه. للمشاريع المحلية استخدم preview_open، وللويب العام رابطاً خارجياً.`)
      } catch {
        return fail(`تعذّر فهم الوجهة "${i.target}". أعطِ رابط http(s) كاملاً أو عبارة بحث واضحة.`)
      }
      const r = await preview.load(target, 25000, ctx.signal)
      if (!r.ok) return fail(`فشل فتح ${target} (${r.message}). تحقق من الإملاء والاتصال، أو جرّب web_open بكلمات بحث بدل الرابط، ثم أعد المحاولة.`)
      const logs = preview.getLogs()
      const errs = logs.console.filter((c) => c.level === 'error')
      return ok(`فُتح: ${preview.state.url} — «${preview.state.title || 'بلا عنوان'}»${errs.length ? `\n⚠ أخطاء Console (${errs.length}):\n${errs.slice(0, 5).map((e) => '  ' + e.text).join('\n')}` : '\n✓ لا أخطاء Console'}`)
    }
  },
  {
    name: 'browser_nav',
    // تسلسلي عمداً: تنقلان متزامنان يخلطان سجل الصفحات
    description: 'Go back or forward in the preview browser history (like browser back/forward buttons).',
    schema: schema({ dir: { type: 'string', enum: ['back', 'forward'], description: 'Navigation direction' } }, ['dir']),
    async run(i, ctx) {
      const wc = preview.wc
      if (!wc || wc.isDestroyed() || !preview.isOpen()) return fail('المعاينة غير مفتوحة. افتح صفحة عبر web_open أولاً.')
      const h = wc.navigationHistory
      if (!h) return fail('سجل التنقل غير متاح هنا. افتح الرابط المقصود مباشرة عبر web_open بدل back/forward.')
      try {
        if (i.dir === 'back') {
          if (!h.canGoBack()) return fail('لا صفحة سابقة في السجل — أنت في أول الصفحات. افتح الوجهة المطلوبة عبر web_open.')
          h.goBack()
        } else if (i.dir === 'forward') {
          if (!h.canGoForward()) return fail('لا صفحة تالية في السجل. افتح الوجهة المطلوبة عبر web_open.')
          h.goForward()
        } else return fail(`الاتجاه dir يجب أن يكون back أو forward (استلمت ${JSON.stringify(i.dir)}).`)
      } catch (e) {
        return fail(`تعذّر التنقل: ${(e as Error).message}`)
      }
      await preview.settle(ctx.signal, 1500) // تنقل تاريخي: رجوع/تقدم سريع عادة (الكاش الخلفي)
      return ok(`الآن: ${preview.state.url} — «${preview.state.title || 'بلا عنوان'}»`)
    }
  }
]
