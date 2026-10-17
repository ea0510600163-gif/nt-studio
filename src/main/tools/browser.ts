import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { send } from '../bus'
import { findFreePort, isAppPort } from '../ports'
import { preview, waitForPort } from '../preview'
import { clip, resolvePath, sleep } from '../util'
import { Tool, ToolContext, fail, ok, schema } from './types'

const SNAPSHOT_JS = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[onclick],[tabindex]:not([tabindex="-1"]),canvas,[contenteditable=true]';
  document.querySelectorAll('[data-nt-ref]').forEach((e) => e.removeAttribute('data-nt-ref'));
  const items = []; let n = 0;
  for (const e of document.querySelectorAll(sel)) {
    if (items.length >= 80) break; if (!vis(e)) continue;
    const ref = ++n; e.setAttribute('data-nt-ref', String(ref));
    const r = e.getBoundingClientRect(); const tag = e.tagName.toLowerCase();
    const label = String(e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.alt || e.title || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    const x = [];
    if (tag === 'input') x.push('type=' + (e.type || 'text'));
    if (e.name) x.push('name=' + e.name); if (e.id) x.push('#' + e.id);
    if (e.getAttribute('href')) x.push('→' + e.getAttribute('href').slice(0, 60));
    if (e.disabled) x.push('معطّل'); if (e.checked) x.push('محدد');
    if (tag === 'input' || tag === 'textarea') x.push('قيمة="' + String(e.value).slice(0, 30) + '"');
    items.push('[' + ref + '] ' + tag + ' «' + label + '» ' + x.join(' ') + ' @' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  const heads = [...document.querySelectorAll('h1,h2,h3')].filter(vis).slice(0, 25).map((h) => h.tagName.toLowerCase() + ': ' + h.innerText.trim().slice(0, 80));
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 1800);
  return 'العنوان: ' + document.title + '\\nالرابط: ' + location.href + '\\nالنافذة: ' + innerWidth + '×' + innerHeight + ' | التمرير: ' + Math.round(scrollY) + '/' + Math.max(0, document.documentElement.scrollHeight - innerHeight) +
    '\\n\\nالعناوين:\\n' + (heads.join('\\n') || '(لا شيء)') + '\\n\\nالعناصر التفاعلية (ref):\\n' + (items.join('\\n') || '(لا شيء)') + '\\n\\nالنص المرئي:\\n' + text;
})()`

const AUDIT_JS = `(async () => {
  const out = [];
  const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
  if (broken.length) out.push('✗ صور مفقودة (' + broken.length + '): ' + broken.slice(0, 6).join(' , '));
  const noAlt = [...document.images].filter((i) => !i.hasAttribute('alt')).length; if (noAlt) out.push('△ صور بلا alt: ' + noAlt);
  const ox = document.documentElement.scrollWidth - innerWidth; if (ox > 2) out.push('✗ تمرير أفقي غير مقصود: المحتوى أعرض من النافذة بـ ' + ox + 'px (' + [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 2).slice(0, 4).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')).join(', ') + ')');
  if (!document.title) out.push('△ الصفحة بلا عنوان <title>');
  if (!document.querySelector('meta[name=viewport]')) out.push('△ لا يوجد meta viewport');
  try { await document.fonts.ready; const bad = [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family); if (bad.length) out.push('✗ خطوط فشل تحميلها: ' + bad.join(', ')); } catch (e) {}
  const empty = [...document.querySelectorAll('a')].filter((a) => !(a.innerText || a.getAttribute('aria-label') || '').trim() && !a.querySelector('img,svg')).length; if (empty) out.push('△ روابط بلا نص: ' + empty);
  const hrefs = [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin) && !h.includes('#')))].slice(0, 10);
  const dead = [];
  // فحص خفيف: HEAD أولاً (يسقط لـ GET ببايت واحد عند الرفض)، تزامن 6، مهلة 4s للرابط
  const checkOne = async (h) => {
    try {
      let r = await fetch(h, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      if (r.status === 405 || r.status === 501) r = await fetch(h, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(4000) });
      if (r.status >= 400) dead.push(r.status + ' ' + h);
    } catch (e) { dead.push('ERR ' + h); }
  };
  for (let k = 0; k < hrefs.length; k += 6) await Promise.all(hrefs.slice(k, k + 6).map(checkOne));
  if (dead.length) out.push('✗ روابط مكسورة: ' + dead.join(' , '));
  const small = [...document.querySelectorAll('button,a,input,select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).length; if (small && innerWidth < 600) out.push('△ عناصر لمس صغيرة (<24px): ' + small);
  const bodyBg = getComputedStyle(document.body).backgroundColor; const fg = getComputedStyle(document.body).color; out.push('ℹ لون الخلفية ' + bodyBg + ' | لون النص ' + fg + ' | خط الجسم: ' + getComputedStyle(document.body).fontFamily.slice(0, 60));
  return out.join('\\n');
})()`

function resolverJs(spec: Record<string, unknown>): string {
  return `(() => {
  const s = ${JSON.stringify(spec)};
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  let el = null;
  if (s.ref != null) el = document.querySelector('[data-nt-ref="' + s.ref + '"]');
  else if (s.selector) { try { el = document.querySelector(s.selector); } catch (e) { return { ok: false, error: 'محدد CSS غير صالح: "' + s.selector + '". صححه (مثال: "#login-btn" أو "input[type=file]") أو استخدم ref من أحدث browser_snapshot.' }; } }
  else if (s.text) {
    const t = String(s.text).trim().toLowerCase();
    const get = (e) => String(e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || '').trim().toLowerCase().replace(/\\s+/g, ' ');
    const c = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[onclick],summary,label,li,h1,h2,h3,p,span,div')].filter(vis);
    el = c.find((e) => get(e) === t) || c.filter((e) => get(e).includes(t)).sort((a, b) => get(a).length - get(b).length)[0] || null;
  }
  if (!el) return { ok: false, error: 'لم يُعثر على العنصر. خذ browser_snapshot جديدة.' };
  // تحقق لحظة الحل: الرقم قد يُعاد ترقيمه لعنصر مختلف بعد تغيّر DOM — المخفي/المعدوم يُرفض
  const vr = el.getBoundingClientRect(); const vcs = getComputedStyle(el);
  if (!(vr.width > 0 && vr.height > 0 && vcs.visibility !== 'hidden' && vcs.display !== 'none'))
    return { ok: false, error: 'العنصر اختفى أو أصبح مخفياً بعد آخر لقطة. خذ browser_snapshot جديدة ولا تستخدم أرقاماً قديمة.' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  if (s.focus) { el.focus(); if (s.clear) { if (el.select) el.select(); else if (el.isContentEditable) document.execCommand('selectAll'); } }
  return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), text: String(el.innerText || el.value || '').trim().slice(0, 50), disabled: !!el.disabled };
})()`
}

function need(ctx: ToolContext): string | null {
  if (!preview.isOpen()) return 'المعاينة غير مفتوحة. افتح صفحة أولاً عبر web_open (للويب العام) أو preview_open (لمنفذ/مسار محلي)، ثم أعد المحاولة.'
  send('ui:focus', 'preview')
  return null
}

/** frames instead of a fixed sleep: rAF x2 is the real "painted and idle" signal */
const nextFrame = () => preview.exec('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))').catch(() => null)

/**
 * إغلاق ما فتحه الوكيل قبل أي التقاط — «الطريقة الذكية».
 *
 * المشكلة التي يعيشها المستخدمون: الوكيل يفتح قائمة ليفحصها، تبقى مفتوحة،
 * ثم تُلتقط لقطة الشاشة واللقطة النصية وهي تعجّ بالقوائم والحوارات — فيلخبط
 * الحكم على التصميم وتتلوّث مراجع العناصر. أنظمة الوكلاء العالمية تحلّها
 * بخطوة تنظيف قياسية قبل كل رصد للحالة: Escape (مرّتين: قائمة فرعية ثم
 * رئيسية) ثم إزالة التركيز. من يريد التقاط قائمة مفتوحة متعمّداً يمرّر keep_open.
 */
async function dismissOverlays(): Promise<void> {
  // فحص مشروط أولاً: صفحة بلا قوائم/حوارات/تركيز لا تدفع 6 رحلات ثابتة
  const busy = await preview
    .exec<boolean>(
      `!!(document.querySelector('dialog[open],[aria-expanded="true"],[role="dialog"],.modal.open,.dropdown.open,.menu.open')||(document.activeElement&&document.activeElement!==document.body))`
    )
    .catch(() => true)
  if (!busy) {
    await nextFrame()
    return
  }
  await preview.key('Escape').catch(() => null)
  await nextFrame()
  await preview.key('Escape').catch(() => null)
  await nextFrame()
  await preview.exec('try{const a=document.activeElement;a&&a.blur&&a.blur()}catch(e){}').catch(() => null)
  await nextFrame()
}

const targetProps = {
  ref: { type: 'number', description: 'رقم العنصر من browser_snapshot' },
  selector: { type: 'string', description: 'CSS selector' },
  text: { type: 'string', description: 'نص ظاهر على العنصر' }
}

async function errorsSince(before: number): Promise<string> {
  const l = preview.getLogs().console.filter((c) => c.level === 'error').slice(before)
  return l.length ? `\n⚠ أخطاء Console جديدة:\n${l.slice(0, 5).map((c) => '  ' + c.text).join('\n')}` : ''
}
const errCount = () => preview.getLogs().console.filter((c) => c.level === 'error').length

export const browserTools: Tool[] = [
  {
    name: 'preview_open',
    phase: 'acting',
    description: 'Open the live preview pane for a local TCP port, URL, or local HTML file/folder path.',
    schema: schema({
      port: { type: 'number', description: 'Local TCP port to wait for and load' },
      url: { type: 'string', description: 'HTTP/HTTPS URL or localhost:PORT' },
      path: { type: 'string', description: 'Path to a local HTML file or directory containing index.html' },
      wait_sec: { type: 'number', description: 'Max seconds to wait for port readiness (5–300, default 60)' }
    }),
    async run(i, ctx) {
      let url = ''
      let hint = ''
      if (i.port != null && i.port !== '') {
        // منفذ واحد فقط يقبل: رقم صحيح داخل 1–65535 — لا انتظار 28 ساعة ولا NaN
        const port = Number(i.port)
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          return fail(`منفذ غير صالح: ${JSON.stringify(i.port)}. أرسل رقماً صحيحاً بين 1 و65535.`)
        // منفذ التطبيق نفسه ممنوع: فتحه يعرض واجهة NT Studio داخل المعاينة (صفحة فارغة)
        if (isAppPort(port))
          return fail(`المنفذ ${port} هو منفذ NT Studio نفسه (خادم الواجهة أثناء التطوير). استخدم free_port للحصول على منفذ آخر ثم شغّل خادمك عليه.`)
        const waitSec = Math.min(Math.max(Number(i.wait_sec) || 60, 5), 300)
        const up = await waitForPort(port, waitSec * 1000, ctx.signal)
        if (!up) return fail(`المنفذ ${port} لم يستجب خلال ${waitSec} ثانية. تحقق من مخرجات الخادم عبر read_process_output ومن أن الأمر يعمل فعلاً.`)
        url = `http://localhost:${port}`
      } else if (i.url) {
        const raw = String(i.url).trim()
        // نتحقّق قبل التحليل: `new URL` كان يرمي «Invalid URL» الإنجليزي على
        // صيغ شائعة (ليس آخرها localhost:3000) فيسقط ذلك في نصّ عربي فج.
        // نقبل كذلك host:port بلا مخطّة ونكملها بـ http://.
        const withScheme = /^https?:\/\//i.test(raw) ? raw : /^[A-Za-z0-9.-]+:\d{1,5}(?:\/|$)/.test(raw) ? `http://${raw}` : ''
        if (!withScheme)
          return fail(`رابط غير صالح: ${raw}. الصيغ المقبولة: localhost:PORT أو http(s)://… أو مسار ملف مطلق.`)
        let u: URL
        try {
          u = new URL(withScheme)
        } catch {
          return fail(`رابط غير قابل للتحليل: ${raw}. الصيغ المقبولة: localhost:PORT أو http(s)://… أو مسار ملف مطلق.`)
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
          return fail(`بروتوكول غير مدعوم: ${u.protocol}. الصيغ المقبولة: localhost:PORT أو http(s)://… أو مسار ملف مطلق.`)
        url = u.href
        if (isAppPort(Number(u.port || 0))) hint = '\n⚠ هذا هو خادم NT Studio نفسه.'
      } else if (i.path) {
        const raw = String(i.path).trim()
        if (!raw) return fail('مسار فارغ. أعطِ ملف HTML بمسار مطلق أو مجلداً يحتوي index.html.')
        const p = resolvePath(ctx.cwd(), raw)
        let st: ReturnType<typeof statSync> | null = null
        try {
          st = existsSync(p) ? statSync(p) : null
        } catch {
          st = null
        }
        if (!st) return fail(`المسار غير موجود: ${p}`)
        if (st.isDirectory()) {
          const idx = join(p, 'index.html')
          if (!existsSync(idx)) return fail(`المجلد لا يحتوي index.html: ${p}. شغّل خادماً ثم أعطِ رقم المنفذ بدلاً من ذلك.`)
          url = pathToFileURL(idx).href
        } else {
          url = pathToFileURL(p).href
        }
      } else return fail('حدّد port أو url أو path.')
      const r = await preview.load(url, 25000, ctx.signal)
      const logs = preview.getLogs()
      const errs = logs.console.filter((c) => c.level === 'error')
      return r.ok
        ? ok(`فُتحت المعاينة: ${preview.state.url} — «${preview.state.title || 'بلا عنوان'}»${hint}${errs.length ? `\n⚠ أخطاء Console (${errs.length}):\n${errs.slice(0, 5).map((e) => '  ' + e.text).join('\n')}` : '\n✓ لا أخطاء Console'}${logs.network.length ? `\n⚠ أخطاء شبكة:\n  ${logs.network.slice(0, 5).join('\n  ')}` : ''}`)
        : fail(`فشل التحميل: ${r.message}. إن كان هذا خادمك فقد فشل الإقلاع — اقرأ read_process_output.`)
    }
  },
  {
    name: 'preview_reload',
    phase: 'testing',
    description: 'Hard-reload the preview ignoring the browser cache (use after changes if HMR did not refresh).',
    schema: schema({}),
    async run(_i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      await preview.reloadAndSettle(ctx.signal)
      return ok('أُعيد التحميل.' + (await errorsSince(0)))
    }
  },
  {
    name: 'preview_close',
    description: 'Close the preview panel.',
    schema: schema({}),
    async run() {
      preview.close()
      return ok('أُغلقت المعاينة.')
    }
  },
  {
    name: 'browser_screenshot',
    parallel: true,
    phase: 'testing',
    description: 'Capture a screenshot of the open live preview.',
    schema: schema({ keep_open: { type: 'boolean', description: 'Keep open menus/overlays instead of dismissing them before capture' } }),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      if (!i.keep_open) await dismissOverlays()
      // بلا nextFrame زائد: dismissOverlays ينتهي أصلاً بإطار رسم
      try {
        const s = await preview.screenshot()
        return ok(`لقطة ${s.width}×${s.height} (${preview.state.device})${ctx.vision ? '' : ' — نموذجك لا يدعم الصور؛ استخدم browser_snapshot للفحص النصي.'}`, [{ mediaType: s.mediaType, data: s.data }])
      } catch (e) {
        return fail(`تعذّر التقاط اللقطة (${(e as Error).message}). إن كانت المعاينة مخفية خلف حوار فأغلقه، أو أعد فتح الصفحة ثم خذ browser_snapshot نصية بديلاً.`)
      }
    }
  },
  {
    name: 'browser_snapshot',
    parallel: true,
    phase: 'testing',
    description: 'Read a structured text snapshot of the preview page: title, headings, visible text, and interactive elements numbered as [ref].',
    schema: schema({ keep_open: { type: 'boolean', description: 'Keep open menus/overlays instead of dismissing them' } }),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      if (!i.keep_open) await dismissOverlays()
      try {
        return ok(clip(await preview.exec<string>(SNAPSHOT_JS), 9000))
      } catch (e) {
        return fail(`تعذّر أخذ اللقطة (${(e as Error).message}). أعد تحميل المعاينة عبر preview_reload ثم خذ لقطة جديدة؛ إن تكرر فاقرأ browser_console.`)
      }
    }
  },
  {
    name: 'browser_click',
    phase: 'testing',
    description: 'Real mouse click on an element (by ref, selector or visible text) or at page coordinates x,y (for canvas/games). Returns new console errors, if any.',
    schema: schema({ ...targetProps, x: { type: 'number' }, y: { type: 'number' }, double: { type: 'boolean' } }),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      const before = errCount()
      let x = Number(i.x), y = Number(i.y), desc = `(${i.x},${i.y})`
      if (i.ref == null && !i.selector && !i.text) {
        if (isNaN(x) || isNaN(y)) return fail('حدّد ref أو selector أو text أو x/y.')
      } else {
        const r = await preview.exec<any>(resolverJs({ ref: i.ref, selector: i.selector, text: i.text }))
        if (!r.ok) return fail(r.error)
        if (r.disabled) return fail(`العنصر <${r.tag}> «${r.text}» معطّل (disabled). خذ browser_snapshot جديدة واختر عنصراً مفعّلاً بديلاً، ولا تعِد النقر نفسه.`)
        ;({ x, y } = r)
        desc = `<${r.tag}> «${r.text}»`
      }
      const url0 = preview.state.url
      preview.click(x, y, !!i.double)
      await preview.settle(ctx.signal)
      return ok(`نُقر على ${desc}${preview.state.url !== url0 ? ` → انتقلت الصفحة إلى ${preview.state.url}` : ''}${await errorsSince(before)}`)
    }
  },
  {
    name: 'browser_type',
    phase: 'testing',
    description: 'Type text into an input/textarea (focus + real text insertion, works with React-controlled inputs). clear=true replaces existing text. submit=true presses Enter afterwards.',
    schema: schema({ ...targetProps, value: { type: 'string' }, clear: { type: 'boolean' }, submit: { type: 'boolean' } }, ['value']),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      if (i.ref == null && !i.selector && !i.text) return fail('حدّد الحقل عبر ref من أحدث browser_snapshot (أو selector/text). خذ لقطة جديدة أولاً ولا تستخدم أرقام لقطة قديمة.')
      const before = errCount()
      const r = await preview.exec<any>(resolverJs({ ref: i.ref, selector: i.selector, text: i.text, focus: true, clear: i.clear !== false }))
      if (!r.ok) return fail(r.error)
      preview.insertText(String(i.value))
      await nextFrame()
      if (i.submit) {
        await preview.key('Enter')
        await preview.settle(ctx.signal)
      }
      return ok(`كُتب في <${r.tag}>${i.submit ? ' + Enter' : ''}${await errorsSince(before)}`)
    }
  },
  {
    name: 'browser_press',
    phase: 'testing',
    description: 'Press a keyboard key on the page: Enter, Escape, Tab, Space, ArrowUp/Down/Left/Right, or a single character (w a s d). hold_ms keeps the key down (for game controls). Use repeat to press several times.',
    schema: schema({ key: { type: 'string' }, hold_ms: { type: 'number' }, repeat: { type: 'number' } }, ['key']),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      const k = String(i.key)
      const known = ['Enter', 'Escape', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
      if (!known.includes(k) && k.length !== 1)
        return fail(`مفتاح غير مدعوم: "${k}". المدعوم: ${known.join('/')} أو حرف واحد.`)
      const rep = Number(i.repeat) || 1
      if (!Number.isInteger(rep) || rep < 1 || rep > 50)
        return fail(`repeat يجب أن يكون عدداً صحيحاً بين 1 و50 (استلمت ${JSON.stringify(i.repeat)}).`)
      const before = errCount()
      for (let k = 0; k < rep; k++) {
        await preview.key(String(i.key), Number(i.hold_ms) || 0)
      }
      await preview.settle(ctx.signal, 1500) // ضغطة: لا تنقّل متوقع — سقف قصير
      return ok(`ضُغط ${i.key}${rep > 1 ? ` ×${rep}` : ''}${await errorsSince(before)}`)
    }
  },
  {
    name: 'browser_scroll',
    phase: 'testing',
    description: 'Scroll the page. dy>0 scrolls down (px). to="top"|"bottom" jumps.',
    schema: schema({ dy: { type: 'number' }, to: { type: 'string', enum: ['top', 'bottom'] } }),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      // رحلة واحدة: التمرير وقراءة الموضع معاً (كانت 3 رحلات)
      const js = i.to === 'top' ? 'window.scrollTo(0,0)' : i.to === 'bottom' ? 'window.scrollTo(0,document.documentElement.scrollHeight)' : `window.scrollBy(0,${Number(i.dy) || 600})`
      const pos = await preview.exec<string>(js + ';Math.round(scrollY)+"/"+Math.max(0,document.documentElement.scrollHeight-innerHeight)')
      await nextFrame()
      return ok('مرّر. ' + pos)
    }
  },
  {
    name: 'browser_wait',
    parallel: true,
    phase: 'testing',
    description: 'Wait for a CSS selector or visible text to appear (timeout_ms default 8000), or just sleep for ms.',
    schema: schema({ selector: { type: 'string' }, text: { type: 'string' }, ms: { type: 'number' }, timeout_ms: { type: 'number' } }),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      if (!i.selector && !i.text && !i.ms)
        return fail('حدّد ما تنتظره: selector أو text يظهران (أو ms للنوم الثابت). مثال: {"selector":"#results"} أو {"text":"تم النشر"}.')
      if (i.ms) {
        await sleep(Math.min(Number(i.ms), 20000), ctx.signal)
        return ok('انتظر.')
      }
      const timeout = Number(i.timeout_ms) || 8000
      const end = Date.now() + timeout
      const js = i.selector ? `!!document.querySelector(${JSON.stringify(i.selector)})` : `document.body.innerText.includes(${JSON.stringify(String(i.text ?? ''))})`
      const t0 = Date.now()
      while (Date.now() < end) {
        if (await preview.exec<boolean>(js)) return ok('ظهر.')
        // استطلاع متدرج: سريع أول ثانيتين ثم أهدأ — رحلات IPC أقل
        await sleep(Date.now() - t0 < 2000 ? 250 : 500, ctx.signal)
      }
      const what = i.selector ? `المحدد "${i.selector}"` : `النص "${i.text}"`
      return fail(`لم يظهر ${what} خلال ${timeout}ms. تحقق من الإملاء، أو خذ browser_snapshot للتحقق من وجوده، أو زد timeout_ms وأعد المحاولة.`)
    }
  },
  {
    name: 'browser_console',
    parallel: true,
    description: 'Read Console messages (errors/warnings/logs) and failed network requests for the current page. clear=true empties the buffers afterwards.',
    schema: schema({ clear: { type: 'boolean' }, level: { type: 'string', enum: ['all', 'error', 'warn'] } }),
    async run(i) {
      const l = preview.getLogs(!!i.clear)
      const f = l.console.filter((c) => (i.level === 'error' ? c.level === 'error' : i.level === 'warn' ? c.level === 'error' || c.level === 'warn' : true))
      const txt = f.slice(-40).map((c) => `[${c.level}] ${c.text}  (${c.source})`).join('\n')
      return ok(`Console (${f.length}):\n${txt || '✓ نظيف'}\n\nالشبكة (${l.network.length}):\n${l.network.join('\n') || '✓ لا إخفاقات'}`)
    }
  },
  {
    name: 'browser_resize',
    parallel: true,
    phase: 'testing',
    description: 'Switch the preview viewport: mobile (390px), tablet (820px) or desktop (full width). Use when the user asks about responsiveness or while testing on explicit request.',
    schema: schema({ device: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] } }, ['device']),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      preview.setDevice(i.device)
      await preview.settle(ctx.signal, 1500) // تحجيم: إعادة رسم محلية بلا شبكة غالباً
      const sz = await preview.exec<string>('innerWidth+"×"+innerHeight')
      return ok(`الحجم الآن ${i.device} (${sz})`)
    }
  },
  {
    name: 'browser_eval',
    parallel: true,
    phase: 'testing',
    description: 'Evaluate a JavaScript expression in the page and return the JSON result (read game state, computed styles, DOM facts). Wrap statements in an IIFE.',
    schema: schema({ js: { type: 'string' } }, ['js']),
    async run(i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      try {
        const r = await preview.exec<unknown>(String(i.js))
        return ok(clip(typeof r === 'string' ? r : JSON.stringify(r, null, 1) ?? 'undefined', 8000))
      } catch (e) {
        return fail(`خطأ في تنفيذ JS (${(e as Error).message}). غلّف العبارات في IIFE تُرجع JSON — مثال: (()=>document.title)() — وصحح بناء الجملة ثم أعد المحاولة.`)
      }
    }
  },
  {
    name: 'browser_audit',
    parallel: true,
    phase: 'testing',
    description: 'Run an automated DOM/layout/asset health audit on the open preview page (broken images/links/fonts, horizontal overflow, console/network errors).',
    schema: schema({}),
    async run(_i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      await dismissOverlays()
      try {
        const r = await preview.exec<string>(AUDIT_JS)
        const logs = preview.getLogs()
        const e = logs.console.filter((c) => c.level === 'error').length
        const summary = `${r}\n${e ? `✗ أخطاء Console: ${e}` : '✓ لا أخطاء Console'}${logs.network.length ? `\n✗ إخفاقات شبكة: ${logs.network.length}` : ''}`
        // T4.3: Visual signal — if screenshot tool has vision, also suggest a screenshot for image diff
        return ok(summary)
      } catch (e) {
        return fail(`فشل الفحص (${(e as Error).message}). أعد تحميل الصفحة عبر preview_reload وحاول مجدداً، أو افحص browser_console للأخطاء الحية.`)
      }
    }
  },
  {
    name: 'visual_check',
    phase: 'testing',
    description: 'Capture a screenshot and run browser_audit together in a single call.',
    schema: schema({}),
    async run(_i, ctx) {
      const n = need(ctx)
      if (n) return fail(n)
      await dismissOverlays()
      await nextFrame()
      let shot: { mediaType: string; data: string; width: number; height: number } | null = null
      let audit = ''
      try {
        const [s, a] = await Promise.all([
          preview.screenshot().catch((e) => { throw e }),
          preview.exec<string>(AUDIT_JS).catch(() => '(audit failed)')
        ])
        shot = s
        audit = a
      } catch (e) {
        return fail(`تعذّر الفحص البصري (${(e as Error).message}). استخدم browser_snapshot + browser_audit بديلاً نصياً، أو أعد فتح الصفحة وحاول مجدداً.`)
      }
      const logs = preview.getLogs()
      const errs = logs.console.filter((c) => c.level === 'error').length
      const summary = `لقطة ${shot.width}×${shot.height} (${preview.state.device})\n${audit}\n${errs ? `✗ أخطاء Console: ${errs}` : '✓ لا أخطاء Console'}${logs.network.length ? `\n✗ إخفاقات شبكة: ${logs.network.length}` : ''}`
      if (!ctx.vision) return ok(summary + '\n— نموذجك لا يدعم الصور؛ استخدم browser_snapshot + browser_audit للفحص النصي.')
      return ok(summary, [{ mediaType: shot.mediaType, data: shot.data }])
    }
  }
]
