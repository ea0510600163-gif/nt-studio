import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

/**
 * رسالة التحقق من معطيات الأداة + حارس الخطة الفارغة في todo_write.
 *
 * الانحدار المستهدف: لقطة المستخدم تُظهر الوكيل يكرّر نداء todo_write بلا
 * `items` ثلاث مرات («معطيات مطلوبة مفقودة: items»)، فكل تكرار دورة نموذج
 * كاملة بلا تقدّم حتى يتدخّل حارس الحلقات. الرسالة القديمة كانت تُسمّي الحقل
 * الناقص فقط؛ الجديدة تُظهر الشكل المتوقع + مثال نداء صحيح، وأداة الخطة
 * ترفض القائمة الفارغة بنفس المثال.
 *
 * نفس لفّ تحميل الوحدات المستعمل في filesGuard.test.mjs: امتدادات + `@shared/*`
 * + مجسّمات electron/store/db/store/providers. الكود المُختبَر هو الكود الحقيقي.
 */

const ROOT = new URL('..', import.meta.url).href

const TYPE_ONLY = new Set(['Tool', 'ToolContext', 'ToolResult', 'Settings', 'ProjectInfo', 'ModelInfo', 'TodoItem', 'FileDiff', 'ImageData', 'Phase'])

const stub = (code) => ({ url: 'data:text/javascript,' + encodeURIComponent(code), format: 'module', shortCircuit: true })

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return stub('export default {}')
    if (specifier === '../store/db' || specifier === './db') return stub('export function db(){ throw new Error("db stub") }')
    if (specifier === '../store/providers' || specifier === './providers') return stub('export function getSettings(){ return { workspaceRoot: process.cwd(), approvalMode: false, maxOutputTokens: 64000 } }')
    let s = specifier
    if (s.startsWith('@shared/')) s = ROOT + '/src/shared/' + s.slice('@shared/'.length) + '.ts'
    else if (s.startsWith('.') && !/\.(ts|mjs|js|json|cjs)$/.test(s)) s = new URL(s + '.ts', context.parentURL).href
    return nextResolve(s, context)
  },
  load(url, context, nextLoad) {
    const r = nextLoad(url, context)
    const raw = r.source
    const src = raw == null ? null : typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
    if (src == null || !url.startsWith('file:') || !url.endsWith('.ts')) return r
    const fixed = src.replace(/import\s*\{([^}]*)\}\s*from\s*'(\.\/types|\.\/providers\/types)'/g, (_m, names, spec) => {
      const keep = names.split(',').map((n) => n.trim()).filter(Boolean).filter((n) => !TYPE_ONLY.has(n.replace(/^type\s+/, '')))
      return keep.length ? `import { ${keep.join(', ')} } from '${spec}'` : ''
    })
    return fixed === src ? r : { format: r.format, source: fixed, shortCircuit: true }
  }
})

const { toolValidationError } = await import(ROOT + '/src/main/tools/types.ts')
const { projectTools } = await import(ROOT + '/src/main/tools/project.ts')

const todo = projectTools.find((t) => t.name === 'todo_write')
assert.ok(todo, 'todo_write موجود في projectTools')

/** سياق وهميّ يحقّق ToolContext — بلا مشروع حتى لا تُلمس قاعدة البيانات */
function ctx() {
  return {
    sessionId: 'v-test',
    signal: new AbortController().signal,
    vision: false,
    project: () => null,
    cwd: () => process.cwd(),
    model: () => ({ id: 'test', tools: true, vision: false, contextWindow: 200000 }),
    bind() {},
    ask: async () => '',
    plan: () => [],
    setPlan() {},
    setPhase() {},
    settings: () => ({ workspaceRoot: process.cwd(), approvalMode: false, maxOutputTokens: 64000 })
  }
}

/* ───────────── 1) رسالة التحقق: قابلة للتنفيذ، لا مجرّد تسمية ───────────── */

test('نداء بلا items: رسالة تسمّي الأداة والحقل الناقص وتُعيد مثال نداء صحيح', () => {
  const msg = toolValidationError(todo, {})
  assert.ok(msg, 'نداء ناقص ⇒ رسالة خطأ')
  assert.match(msg, /نداء ناقص/)
  assert.match(msg, /«todo_write»/)
  assert.match(msg, /- items: array/)
  // المثال الجاهز للنسخ — same shape the model must emit
  assert.match(msg, /\{"name":"todo_write","arguments":\{"items":\[\{"text":"<نص>","status":"pending"\}\]\}\}/)
  assert.match(msg, /لا تُعد إرسال النداء نفسه/)
})

test('نداء ناقص بمفتاح واحد فقط (model emitted the tool name with empty arguments)', () => {
  const msg = toolValidationError(todo, { name: 'todo_write' })
  assert.ok(msg)
  assert.match(msg, /items/)
})

test('نداء مكتمل ⇒ بلا خطأ (لا false positive)', () => {
  assert.equal(toolValidationError(todo, { items: [{ text: 'بناء الواجهة', status: 'doing' }] }), null)
  assert.equal(toolValidationError(todo, { items: [] }), null, 'الفراغ مسؤولية الأداة لا الفحص العام')
})

test('المثال مشتق من المخطط: enum و object متداخلان، لا قيم مخترعة', () => {
  const msg = toolValidationError(todo, {})
  assert.ok(msg)
  // status مثال من enum الحقيقي (الترتيب as-is من المخطط)
  assert.match(msg, /"status":"pending"/)
  assert.match(msg, /"text":"<نص>"/)
})

/* ───────────── 2) todo_write: خطة فارغة تُرفض بمثال بدل «0 بنود» ───────────── */

test('todo_write بقائمة فارغة ⇒ فشل صريح مع مثال، لا تحديث بلا أثر', async () => {
  const r = await todo.run({ items: [] }, ctx())
  assert.equal(r.isError, true)
  assert.match(r.content, /غير فارغة/)
  assert.match(r.content, /\{"items":\[\{"text":/)
})

test('todo_write بـ items نصي (نوع خاطئ) ⇒ فشل صريح', async () => {
  const r = await todo.run({ items: 'النصوص' }, ctx())
  assert.equal(r.isError, true)
})

test('todo_write بعنصر صحيح وبلا مشروع ⇒ ينجح ويحدّث الخطة', async () => {
  const r = await todo.run({ items: [{ text: 'بناء الواجهة', status: 'doing' }, { text: 'فحص البناء', status: 'pending' }] }, ctx())
  assert.equal(r.isError, undefined)
  assert.match(r.content, /0\/2 منجز/) // بلا عناصر منجزة: العدّ صادق
})

/* ───────────── 3) الأداة نفسها: حقل items مصفوفة في المخطط ───────────── */

test('مخطط todo_write يفرض items كمصفوفة — الحارس والرسالة على نفس المرجع', () => {
  const props = todo.schema.properties
  assert.equal(props.items.type, 'array')
  assert.ok(todo.schema.required.includes('items'))
})

/* ───────────── 4) إعادة إرسال الخطة نفسها = نداء بلا أثر ───────────── */

test('todo_write بنفس الخطة الحالية ⇒ رفض صريح بلا إعادة كتابة', async () => {
  const plan = [{ id: '1', text: 'بناء الواجهة', status: 'doing' }, { id: '2', text: 'فحص البناء', status: 'pending' }]
  const c = ctx()
  c.plan = () => plan
  const r = await todo.run({ items: plan }, c)
  assert.equal(r.isError, true)
  assert.match(r.content, /مطابقة للحالية/)
  assert.match(r.content, /لا تُعِد كتابتها/)
})

test('todo_write بتغيير حقيقي (حالة أو نص) ⇒ يمرّ (الحارس لا يمنع التقدّم)', async () => {
  const plan = [{ id: '1', text: 'بناء الواجهة', status: 'doing' }]
  const c = ctx()
  c.plan = () => plan
  const done = await todo.run({ items: [{ text: 'بناء الواجهة', status: 'done' }] }, c)
  assert.equal(done.isError, undefined)
  // إضافة بند جديد أيضاً تغيير حقيقي
  const extended = await todo.run({ items: [{ text: 'بناء الواجهة', status: 'done' }, { text: 'فحص', status: 'pending' }] }, ctx())
  assert.equal(extended.isError, undefined)
})

test('todo_write بترتيب مختلف للبنود ⇒ تغيير (لا يُقارن كنصّ)', async () => {
  const plan = [{ id: '1', text: 'أ', status: 'pending' }, { id: '2', text: 'ب', status: 'pending' }]
  const c = ctx()
  c.plan = () => plan
  const r = await todo.run({ items: [{ text: 'ب', status: 'pending' }, { text: 'أ', status: 'pending' }] }, c)
  assert.equal(r.isError, undefined)
})
