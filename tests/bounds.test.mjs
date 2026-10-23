import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoundsSync, clampToContent, isBounds, sameBounds } from '../src/main/preview/bounds.ts'
import { appPorts } from '../src/main/ports.ts'
import { writeCallBudget } from '../src/main/config.ts'

/* ───────────── احتواء المعاينة داخل النافذة ───────────── */

const rect = (x, y, width, height) => ({ x, y, width, height })
const CONTENT = [1200, 800]

test('clampToContent: حدود سليمة داخل الإطار تمرّ كما هي', () => {
  const r = clampToContent(rect(300, 44, 900, 756), ...CONTENT)
  assert.equal(r.reason, 'ok')
  assert.deepEqual(r.bounds, rect(300, 44, 900, 756))
})

test('clampToContent: حد يتجاوز يمين/أسفل الإطار يُقصّ ولا يخرج أبداً', () => {
  const r = clampToContent(rect(900, 700, 800, 600), ...CONTENT)
  assert.equal(r.reason, 'ok')
  assert.deepEqual(r.bounds, rect(900, 700, 300, 100))
})

test('clampToContent: حد سالب يُزاح إلى داخل الإطار مع الاحتفاظ بحجمه', () => {
  const r = clampToContent(rect(-50, -30, 400, 300), ...CONTENT)
  assert.deepEqual(r.bounds, rect(0, 0, 400, 300))
})

test('clampToContent: حاوية مختفية (أبعاد صفرية) تُرفض بدل رسم مستطيل فوق الواجهة', () => {
  assert.equal(clampToContent(rect(0, 0, 0, 0), ...CONTENT).reason, 'degenerate')
  assert.equal(clampToContent(rect(0, 0, 19, 900), ...CONTENT).reason, 'degenerate')
  assert.equal(clampToContent(rect(0, 0, 900, 19), ...CONTENT).reason, 'degenerate')
})

test('clampToContent: حاوية خارج الإطار تماماً تُرفض', () => {
  assert.equal(clampToContent(rect(1300, 0, 400, 300), ...CONTENT).reason, 'degenerate')
})

test('clampToContent: إطارات NaN/Infinity أو ناقصة الحقول تُرفض كمدخلات تالفة', () => {
  for (const bad of [null, undefined, 'x', {}, rect(NaN, 0, 10, 10), rect(0, 0, Infinity, 10)])
    assert.equal(clampToContent(bad, ...CONTENT).reason, 'invalid', `expected invalid for ${JSON.stringify(bad)}`)
})

test('clampToContent: أبعاد سالبة تصل إلى صفر فتُرفض (degenerate لا invalid)', () => {
  assert.equal(clampToContent(rect(0, 0, 10, -5), ...CONTENT).reason, 'degenerate')
})

test('clampToContent: نافذة غير قابلة للقياس تُخفي لا ترسم', () => {
  assert.equal(clampToContent(rect(0, 0, 900, 700), 0, 0).reason, 'offscreen')
})

test('isBounds: تحقق صريح من النوع', () => {
  assert.equal(isBounds(rect(0, 0, 1, 1)), true)
  assert.equal(isBounds({ x: 0, y: 0, width: 1 }), false)
  assert.equal(isBounds(null), false)
})

/* ───────────── الأحدث يفوز (staleness) ───────────── */

test('BoundsSync: التحديث المتأخر (seq أصغر) يُرفض', () => {
  const s = new BoundsSync()
  assert.ok(s.accept({ ...rect(0, 0, 900, 700), seq: 5 }, 5))
  assert.equal(s.accept({ ...rect(0, 0, 100, 100), seq: 3 }, 3), null)
  // القيمة المحفوظة تبقى الأحدث
  assert.equal(s.current().width, 900)
})

test('BoundsSync: التحديث المتقدّم (seq أكبر) يُقبل', () => {
  const s = new BoundsSync()
  s.accept({ ...rect(0, 0, 900, 700), seq: 2 }, 2)
  assert.ok(s.accept({ ...rect(10, 10, 500, 500), seq: 9 }, 9))
  assert.deepEqual(s.current(), rect(10, 10, 500, 500))
})

test('BoundsSync: مدخلات تالفة تُرفض ولا تُخزَّن', () => {
  const s = new BoundsSync()
  assert.equal(s.accept({ x: 0, y: 0, width: 100 }, 1), null)
  assert.deepEqual(s.current(), rect(0, 0, 0, 0))
})

test('BoundsSync: بلا seq يُقبل كل تحديث صالح (سلوك الرفع اليدوي)', () => {
  const s = new BoundsSync()
  assert.ok(s.accept(rect(1, 2, 3, 4)))
  assert.ok(s.accept(rect(5, 6, 7, 8)))
  assert.deepEqual(s.current(), rect(5, 6, 7, 8))
})

test('BoundsSync: الجيل الجديد يرفض حدود المستند القديم ويقبل تسلسله من البداية', () => {
  const s = new BoundsSync()
  s.accept({ ...rect(0, 0, 900, 700), seq: 40, boundsEpoch: 0 }, 40, 0)
  s.reset(1)
  assert.deepEqual(s.current(), rect(0, 0, 0, 0))
  assert.equal(s.accept({ ...rect(900, 0, 900, 700), seq: 41, boundsEpoch: 0 }, 41, 0), null)
  assert.ok(s.accept({ ...rect(10, 20, 300, 200), seq: 1, boundsEpoch: 1 }, 1, 1))
  assert.deepEqual(s.current(), rect(10, 20, 300, 200))
})

/* ───────────── نفسBounds: منع setBounds بلا فائدة ───────────── */

test('sameBounds: متطابقة/متماثلة/مختلفة', () => {
  assert.equal(sameBounds(rect(0, 0, 10, 10), rect(0, 0, 10, 10)), true)
  assert.equal(sameBounds(rect(0, 0, 10, 10), rect(0, 0, 10, 11)), false)
  assert.equal(sameBounds(rect(1, 2, 3, 4), null), false)
  assert.equal(sameBounds(null, null), true)
  assert.equal(sameBounds(null, rect(0, 0, 1, 1)), false)
})

/* ───────────── ميزانية الكتابة ───────────── */

test('writeCallBudget: ميزانية أكبر = مسموح أكبر، ويبقى ضمن الجواب', () => {
  const small = writeCallBudget(16000)
  const big = writeCallBudget(64000)
  assert.ok(small > 4000 && small < big)
  assert.ok(big < 64000 * 3.2)
})

test('writeCallBudget: ميزانية تافهة لا تنزل تحت الحد الأدنى الآمن', () => {
  assert.ok(writeCallBudget(1) >= 4000)
})

/* ───────────── منافذ التطبيق ───────────── */

test('appPorts: يقرأ منفذ خادم الواجهة من بيئة التطوير', () => {
  const prev = process.env.ELECTRON_RENDERER_URL
  process.env.ELECTRON_RENDERER_URL = 'http://localhost:5199/'
  try {
    assert.deepEqual(appPorts(), [5199])
  } finally {
    if (prev === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = prev
  }
})

test('appPorts: عنوان غير صالح أو غائب = لا منافذ محجوزة', () => {
  const prev = process.env.ELECTRON_RENDERER_URL
  delete process.env.ELECTRON_RENDERER_URL
  try {
    assert.deepEqual(appPorts(), [])
    process.env.ELECTRON_RENDERER_URL = 'not a url'
    assert.deepEqual(appPorts(), [])
  } finally {
    if (prev === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = prev
  }
})