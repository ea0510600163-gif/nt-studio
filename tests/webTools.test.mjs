import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

/**
 * دخانية تسجيل أدوات الويب الجديدة (web_open/browser_nav) + مسارات الفشل
 * التي لا تلمس Electron — بنفس نمط tests/toolValidation.test.mjs.
 */
const ROOT = new URL('..', import.meta.url).href

/** أسماء أنواع بلا وجود وقت التشغيل — تُجرَّد من استيرادات './types' (نمط toolValidation) */
const TYPE_ONLY = new Set(['Tool', 'ToolContext', 'ToolResult', 'Settings', 'ProjectInfo', 'ModelInfo', 'TodoItem', 'FileDiff', 'ImageData', 'Phase'])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron')
      return {
        url: 'data:text/javascript,export const BrowserWindow={};export const WebContentsView={};export const shell={};export const session={};export const app={};export default {};',
        format: 'module',
        shortCircuit: true
      }
    let s = specifier
    if (s.startsWith('.') && !/\.(ts|mjs|js|json|cjs)$/.test(s)) s = new URL(s + '.ts', context.parentURL).href
    return nextResolve(s, context)
  },
  load(url, context, nextLoad) {
    const r = nextLoad(url, context)
    const raw = r.source
    const src = raw == null ? null : typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
    if (src == null || !url.startsWith('file:') || !url.endsWith('.ts')) return r
    const fixed = src.replace(/import\s*\{([^}]*)\}\s*from\s*'(\.\/types|\.\/providers\/types)'/g, (_m, names, spec) => {
      const keep = names
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .filter((n) => !TYPE_ONLY.has(n.replace(/^type\s+/, '')))
      return keep.length ? `import { ${keep.join(', ')} } from '${spec}'` : ''
    })
    return fixed === src ? r : { format: r.format, source: fixed, shortCircuit: true }
  }
})

const { webTools } = await import(ROOT + '/src/main/tools/web.ts')

const byName = Object.fromEntries(webTools.map((t) => [t.name, t]))
const ctx = () => ({ signal: AbortSignal.timeout(5000) })

test('web_open و browser_nav مسجلتان بلا تصادم أسماء', () => {
  const names = webTools.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
  assert.ok(byName.web_open, 'web_open موجودة')
  assert.ok(byName.browser_nav, 'browser_nav موجودة')
  assert.ok(byName.web_search, 'web_search القديمة باقية')
  assert.ok(byName.web_fetch, 'web_fetch القديمة باقية')
})

test('مخطط web_open: target مطلوب', () => {
  assert.deepEqual(byName.web_open.schema.required, ['target'])
  assert.equal(byName.web_open.schema.properties.target.type, 'string')
})

test('مخطط browser_nav: dir مطلوب بمفردات back/forward', () => {
  assert.deepEqual(byName.browser_nav.schema.required, ['dir'])
  assert.deepEqual(byName.browser_nav.schema.properties.dir.enum, ['back', 'forward'])
})

test('الأداتان تسلسليتان (لا parallel) — منع سباق التنقل', () => {
  assert.equal(!!byName.web_open.parallel, false)
  assert.equal(!!byName.browser_nav.parallel, false)
})

test('web_open ترفض البروتوكول المرفوض قبل لمس المتصفح', async () => {
  const r = await byName.web_open.run({ target: 'file:///etc/passwd' }, ctx())
  assert.equal(r.isError, true)
})

test('web_open ترفض الوجهة الفارغة', async () => {
  const r = await byName.web_open.run({ target: '   ' }, ctx())
  assert.equal(r.isError, true)
})

test('browser_nav بلا معاينة مفتوحة ⇒ فشل عربي صريح', async () => {
  const r = await byName.browser_nav.run({ dir: 'back' }, ctx())
  assert.equal(r.isError, true)
  assert.match(r.content, /غير مفتوحة/)
})
