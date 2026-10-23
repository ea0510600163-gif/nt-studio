import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ActionCycleGuard,
  actionSignature,
  compareFingerprints,
  fingerprintBitmap,
  stuckAlternatives
} from '../src/main/desktop/visualDiff.ts'
import { windowMatchesQuery, win32Worker } from '../src/main/desktop/win32Worker.ts'

/**
 * المشكلة 1: «24 نقرة على mostaql.com بلا تقدّم والنظام لم يتوقف».
 * السبب: حارس الحلقات العام يتجاهل نقرات الإحداثيات عمداً، ولا شيء يقارن
 * الشاشة قبل النقرة وبعدها. الحل: بصمة شاشة (32×24) + عدّاد فعل بصري.
 *
 * المشكلة 5: «ضياع التركيز بين Chrome و Explorer و NT Studio».
 * السبب: focusWindow كانت تُعيد ok:true بمجرد العثور على النافذة دون التحقق
 * من أنها صارت Foreground فعلاً. الحل: تحقق + إعادة محاولة، ومطابقة نقية قابلة للاختبار.
 */

/* ───────────── البصمة البصرية ───────────── */

/** صورة BGRA صناعية: لون واحد */
function solid(width, height, r, g, b) {
  const buf = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = b
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = r
    buf[i * 4 + 3] = 255
  }
  return buf
}

test('بصمة الشاشة: صورة مطابقة ⇒ لا تغيير (mad=0)', () => {
  const a = fingerprintBitmap(solid(320, 240, 30, 30, 30), 320, 240)
  const b = fingerprintBitmap(solid(320, 240, 30, 30, 30), 320, 240)
  const d = compareFingerprints(a, b)
  assert.equal(d.changed, false)
  assert.equal(d.mad, 0)
})

test('بصمة الشاشة: تغيّر واسع (نافذة/قائمة فُتحت) ⇒ تغيّر مُكتشف', () => {
  const before = fingerprintBitmap(solid(320, 240, 20, 20, 20), 320, 240)
  const after = solid(320, 240, 20, 20, 20)
  // نصف الصورة صار أبيض = قائمة/نافذة ظهرت
  for (let i = 320 * 120; i < 320 * 240; i++) {
    after[i * 4] = 255
    after[i * 4 + 1] = 255
    after[i * 4 + 2] = 255
  }
  const d = compareFingerprints(before, fingerprintBitmap(after, 320, 240))
  assert.equal(d.changed, true)
  assert.ok(d.mad > 100, `mad=${d.mad}`)
})

test('بصمة الشاشة: تذبذب ضجيجي صغير (تحرك مؤشر) ⇒ لا يُعدّ تغييراً', () => {
  const before = solid(320, 240, 120, 120, 120)
  const after = solid(320, 240, 120, 120, 120)
  // بقعة صغيرة 16×16 = أثر المؤشر — تغيّر محلي لا يوقف الحارس
  for (let y = 100; y < 116; y++) {
    for (let x = 100; x < 116; x++) {
      const i = (y * 320 + x) * 4
      after[i] = 200
      after[i + 1] = 200
      after[i + 2] = 200
    }
  }
  const d = compareFingerprints(fingerprintBitmap(before, 320, 240), fingerprintBitmap(after, 320, 240))
  assert.equal(d.changed, false, `mad=${d.mad} cells=${d.changedCells}`)
})

test('بصمة شاشة غائبة (أول فعل) ⇒ تُعدّ "تغيّرت" ولا تعاقب', () => {
  const d = compareFingerprints(null, fingerprintBitmap(solid(160, 120, 10, 10, 10), 160, 120))
  assert.equal(d.changed, true)
})

/* ───────────── توقيع الفعل ───────────── */

test('نفس النقرة = نفس التوقيع، ونقرة مختلفة الإحداثيات = توقيع مختلف', () => {
  const s1 = actionSignature('left_click', { coordinate: [406, 214] })
  const s2 = actionSignature('left_click', { x: 406, y: 214 })
  const s3 = actionSignature('left_click', { coordinate: [407, 214] })
  assert.equal(s1, s2)
  assert.notEqual(s1, s3)
  assert.notEqual(actionSignature('double_click', { coordinate: [406, 214] }), s1)
})

/* ───────────── حارس الحلقة البصرية ───────────── */

test('الحارس: منع الثالثة — نقرتان متطابقتان بلا تغيير ⇒ المرة الثالثة ممنوعة مع بدائل', () => {
  const g = new ActionCycleGuard()
  const sig = actionSignature('left_click', { coordinate: [406, 214] })

  // النقرة الأولى: نُفّذت، لا تغيير
  let v = g.observe('left_click', false, { x: 406, y: 214, sig })
  assert.equal(v.unchangedRepeats, 1)
  assert.equal(v.blocked, false)

  // النقرة الثانية: preflight يعطي تحذيراً ناعماً (لم يبلغ المنع بعد)
  const pre2 = g.preflight('left_click', 406, 214, sig)
  assert.equal(pre2.blocked, false)
  assert.match(pre2.hint ?? '', /ctrl\+l/)

  v = g.observe('left_click', false, { x: 406, y: 214, sig })
  assert.equal(v.unchangedRepeats, 2)
  assert.equal(v.blocked, true)

  // النقرة الثالثة: ممنوعة قبل التنفيذ وبالنص البديل الكامل
  const pre3 = g.preflight('left_click', 406, 214, sig)
  assert.equal(pre3.blocked, true)
  assert.match(pre3.hint ?? '', /ctrl\+l/)
  assert.match(pre3.hint ?? '', /Tab/)
  assert.match(pre3.hint ?? '', /\(406, 214\)/)
})

test('الحارس: تغيّر الشاشة يُصفّر العدّاد (نقرة نجحت بعد نقرات فاشلة)', () => {
  const g = new ActionCycleGuard()
  const sig = actionSignature('left_click', { coordinate: [10, 10] })
  g.observe('left_click', false, { x: 10, y: 10, sig })
  g.observe('left_click', false, { x: 10, y: 10, sig })
  assert.equal(g.preflight('left_click', 10, 10, sig).blocked, true)
  // إجراء مختلف يغيّر الشاشة (مثلاً ctrl+l ثم كتابة) ⇒ الحلقة انكسرت
  const other = actionSignature('key', { key: 'ctrl+l' })
  const v = g.observe('key', true, { x: 10, y: 10, sig: other })
  assert.equal(v.unchangedRepeats, 0)
  // النقرة الأصلية صارت مسموحة من جديد (عدّاد جديد)
  assert.equal(g.preflight('left_click', 10, 10, sig).blocked, false)
})

test('الحارس: فعل مختلف الإحداثيات لا يُمنع ولو تكرر (رسم/سحب مشروع)', () => {
  const g = new ActionCycleGuard()
  for (const x of [100, 120, 140, 160]) {
    const sig = actionSignature('left_click_drag', { coordinate: [x, 300], start_coordinate: [x - 20, 300] })
    const pre = g.preflight('left_click_drag', x, 300, sig)
    assert.equal(pre.blocked, false, `x=${x}`)
    g.observe('left_click_drag', false, { x, y: 300, sig })
  }
})

test('نص البدائل يوجّه صراحة إلى ctrl+l وكتابة الرابط و Tab (كما طلب المستخدم)', () => {
  const text = stuckAlternatives('left_click', 406, 214)
  assert.match(text, /ctrl\+l/)
  assert.match(text, /type/)
  assert.match(text, /Tab/)
  assert.match(text, /scroll/)
})

/* ───────────── مطابقة النوافذ (أساس تحقق التركيز) ───────────── */

test('مطابقة النافذة: اسم العملية أو العنوان، مع تجاهل .exe وحالة الأحرف', () => {
  assert.equal(windowMatchesQuery('New Tab - Google Chrome', 'chrome', 'chrome'), true)
  assert.equal(windowMatchesQuery('Untitled - Notepad', 'notepad', 'Notepad.exe'), true)
  assert.equal(windowMatchesQuery('ملف مستكشف — Explorer', 'explorer', 'مستكشف'), true)
  assert.equal(windowMatchesQuery('NT Studio', 'electron', 'chrome'), false)
  assert.equal(windowMatchesQuery('', '', ''), false)
})

/* ───────────── فحص حي (قراءة فقط — لا يسرق التركيز) ───────────── */

const WIN = process.platform === 'win32'
const QUICK = process.env.NT_VERIFY_QUICK === '1'

test(
  'فحص حي: foreground يقرأ النافذة النشطة، وfocusWindow لاسم غير موجود يُرجع نتيجة صريحة بلا ادعاء',
  { skip: !WIN || QUICK },
  async () => {
    try {
      const fg = await win32Worker.call('foreground')
      assert.equal(fg.ok, true)
      assert.equal(typeof fg.activeTitle, 'string')

      const miss = await win32Worker.call('focusWindow', { query: 'nt-studio-nonexistent-window-xyz', maximize: false })
      // عقد النقل: ok=true (لا خطأ تشغيل) لكن found/focused=false (بلا ادعاء نجاح)
      assert.equal(miss.ok, true)
      assert.equal(miss.found, false)
      assert.equal(miss.focused, false)
    } finally {
      win32Worker.destroy()
    }
  }
)
