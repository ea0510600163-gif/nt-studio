import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LoopGuard, callSignature, normalizeTarget } from '../src/main/agent/loopGuard.ts'

/**
 * بصمة الاستدعاء هي ما يقرّر كشف التكرار. كانت تعتمد على ناتج الأداة، فكان
 * التمرير واللقطات بأبعاد المختلفة تمرّ بلا إنذار. هذه اختبارات تثبّت السلوك الجديد:
 * البصمة تتعلّق بالطلب لا بالنتيجة.
 *
 * تُستورد هنا **الوحدة الحقيقية** (`src/main/agent/loopGuard.ts`) — لا نسخة
 * مكتوبة بيدنا. الوحدة ورقةٌ بلا اعتماديات (لا تستورد إلا أنواعاً محليّة)، فهي
 * قابلة للتحميل تحت `node --test` مباشرة، ومن ذلك صار `LoopGuard` نفسه قابلاً
 * للاختبار بعد أن كان بلا أي تغطية.
 */

/** كتلة استدعاء أداة كما يبنيها الحارس فعلاً */
const call = (name, input) => ({ type: 'tool_use', id: `c_${name}`, name, input })

/* ───────────────────────────── callSignature ───────────────────────────── */

test('البصمة ثابتة مهما اختلف ترتيب مفاتيح JSON', () => {
  assert.equal(callSignature('read_file', { path: 'a.ts', start: 1 }), callSignature('read_file', { start: 1, path: 'a.ts' }))
})

test('البصمة محدودة الطول ولا تتأثر بما بعد أول 80 حرفاً', () => {
  const a = callSignature('write_file', { path: 'a', content: 'x'.repeat(200) })
  const b = callSignature('write_file', { path: 'a', content: 'x'.repeat(20000) })
  assert.equal(a, b)
  assert.notEqual(a, callSignature('write_file', { path: 'a', content: 'y'.repeat(200) }))
  assert.ok(a.length < 200)
})

/** الحدّ 80 بالضبط: نداءان يختلفان فقط بعد المحرف 80 يجب أن يتطابقا */
test('حدّ القصّ 80 محرفاً بالضبط — الفرق بعد المحرف 80 لا يغيّر البصمة', () => {
  const head = 'a'.repeat(80)
  const same = callSignature('write_file', { path: 'p', content: `${head}ONE` })
  const other = callSignature('write_file', { path: 'p', content: `${head}TWO` })
  assert.equal(same, other)
  // وأول 80 محرفاً نفسها محفوظة حرفياً داخل البصمة
  assert.ok(same.includes(head))
  // والفرق **قبل** المحرف 80 يغيّر البصمة
  assert.notEqual(
    callSignature('write_file', { path: 'p', content: `${head.slice(0, 79)}Z${head.slice(80)}` }),
    callSignature('write_file', { path: 'p', content: head })
  )
})

test('بصمتا التمرير المتتاليتان متطابقتان — وهما بالضبط ما كان يفلت من الكاشف', () => {
  // نفس الطلب بالضبط مرتين: يجب أن يُعتبر تكراراً
  assert.equal(callSignature('browser_scroll', { dy: 600 }), callSignature('browser_scroll', { dy: 600 }))
  // طلب مختلف فعلاً: ليس تكراراً
  assert.notEqual(callSignature('browser_scroll', { dy: 600 }), callSignature('browser_scroll', { to: 'bottom' }))
})

test('لقطة الشاشة بأبعاد مختلفة ليست تكراراً (المقاس جزء من الطلب لا من الناتج)', () => {
  // الجهاز جزء من الطلب، فالبصمتان متطابقتان
  assert.equal(callSignature('browser_resize', { device: 'mobile' }), callSignature('browser_resize', { device: 'mobile' }))
  assert.notEqual(callSignature('browser_resize', { device: 'mobile' }), callSignature('browser_resize', { device: 'desktop' }))
})

test('البصمة تتحمل القيم غير القابلة للتسلسل (BigInt) بلا رمي ولا انهيار إلى اسم الأداة فقط', () => {
  assert.doesNotThrow(() => callSignature('write_file', { content: undefined }))
  assert.doesNotThrow(() => callSignature('write_file', null))
  // البصمة يجب أن تميّز 1n عن 2n بدل أن تنهار وتطابق كل استدعاءات الأداة
  assert.notEqual(callSignature('t', { a: 1n }), callSignature('t', { a: 2n }))
  // و1n يُسلسل فعلاً إلى "1n" لا إلى نص فارغ
  assert.ok(callSignature('t', { a: 1n }).includes('"1n"'))
})

/** الدوال والرموز تصيران اسم نوعهما — لا ينفجر JSON.stringify ولا يُفقدان بصمتياً */
test('الدوال والرموز تصبح اسم نوعها فتبقى البصمة مميّزة', () => {
  const a = callSignature('t', { f: () => {}, s: Symbol('x') })
  assert.ok(a.includes('"f":"function"'), a)
  assert.ok(a.includes('"s":"symbol"'), a)
  // دالتان مختلفتان ورمزان مختلفان ينتجان البصمة نفسها (اسم النوع لا الهوية)
  assert.equal(a, callSignature('t', { f: function named() {}, s: Symbol('y') }))
  // ودالة ليست رقماً: لا تُطابق نداءً بقيمة أخرى
  assert.notEqual(a, callSignature('t', { f: 1 }))
})

test('عمق التداخل يُقصّ فلا تنفجر البصمة على بنية ضخمة', () => {
  const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }
  assert.equal(typeof callSignature('t', deep), 'string')
})

/** ما بعد الطبقة الثالثة يُقصّ إلى «…»: بنيتان مختلفتان بعمق 4+ تصيران ببصمة واحدة */
test('التداخل الأعمق من ثلاث طبقات يُقصّ إلى «…»', () => {
  const four = { a: { b: { c: { d: 1 } } } }
  const deeper = { a: { b: { c: { d: { e: { f: 1 } } } } } }
  assert.equal(callSignature('t', four), callSignature('t', deeper))
  // والطبقات الثلاث تبقى مميّزة
  assert.notEqual(callSignature('t', { a: { b: { c: 1 } } }), callSignature('t', { a: { b: { c: 2 } } }))
})

test('المصفوفة الأطول من ثمانية عناصر تُقصّ', () => {
  const nine = Array.from({ length: 9 }, (_, i) => i)
  const nineDifferentTail = [...nine.slice(0, 8), 999]
  assert.equal(callSignature('t', { a: nine }), callSignature('t', { a: nineDifferentTail }))
  // اختلاف داخل الثمانية الأولى يبقى محسوساً — والعنصر التاسع تحديداً هو المحذوف
  assert.notEqual(callSignature('t', { a: nine }), callSignature('t', { a: [7, ...nine.slice(1)] }))
  assert.notEqual(callSignature('t', { a: [0, 1, 2, 3, 4, 5, 6, 7] }), callSignature('t', { a: [0, 1, 2, 3, 4, 5, 6, 6] }))
  assert.equal(callSignature('t', { a: [0, 1, 2, 3, 4, 5, 6, 7, 42] }), callSignature('t', { a: [0, 1, 2, 3, 4, 5, 6, 7, 43] }))
})

test('أسماء الأدوات المختلفة لا تتطابق', () => {
  assert.notEqual(callSignature('read_file', { path: 'a' }), callSignature('list_dir', { path: 'a' }))
})

/* ───────────────────────────── LoopGuard.check ───────────────────────────── */

test('الحارس بلا استدعاءات لا ينبّه', () => {
  assert.deepEqual(new LoopGuard().check([]), { warning: null, fatal: false })
})

test('شكل الرد: warning نص يبدأ بتمهيد النظام وfatal قيمة منطقية', () => {
  const g = new LoopGuard()
  const v = g.check([call('x', { a: 1 }), call('x', { a: 1 }), call('x', { a: 1 }), call('x', { a: 1 }), call('x', { a: 1 })])
  assert.equal(typeof v.fatal, 'boolean')
  assert.equal(v.fatal, false)
  assert.match(String(v.warning), /^تنبيه من النظام: /)
  assert.match(String(v.warning), /كرّرتَ الاستدعاء نفسه/)
})

test('خمسة استدعاءات مطابقة متتالية تُنتج إنذاراً', () => {
  const g = new LoopGuard()
  const v = g.check([call('read_file', { path: 'a.ts' }), call('read_file', { path: 'a.ts' }), call('read_file', { path: 'a.ts' }), call('read_file', { path: 'a.ts' }), call('read_file', { path: 'a.ts' })])
  assert.notEqual(v.warning, null)
  assert.equal(v.fatal, false)
})

/** الحدّ خمسة بالضبط: أربعة متتالية فقط لا تنبّه، والخامس ينبّه */
test('حدّ التكرار خمسة بالضبط: أربعة لا تنبّه والخامس ينبّه', () => {
  const g = new LoopGuard()
  assert.equal(g.check([call('scroll', { dy: 1 }), call('scroll', { dy: 1 }), call('scroll', { dy: 1 }), call('scroll', { dy: 1 })]).warning, null)
  assert.notEqual(g.check([call('scroll', { dy: 1 })]).warning, null)
})

/** العقوبة تُصفّر النافذة: التكرار يحتاج خمس نداءات جديدة ليُنذّر من جديد */
test('النافذة تُصفَّر بعد العقوبة فيلزمها خمس نداءات جديدة', () => {
  const g = new LoopGuard()
  assert.notEqual(g.check([call('scroll', { dy: 1 }), call('scroll', { dy: 1 }), call('scroll', { dy: 1 }), call('scroll', { dy: 1 }), call('scroll', { dy: 1 })]).warning, null)
  assert.equal(g.check([call('scroll', { dy: 1 })]).warning, null)
  assert.equal(g.check([call('scroll', { dy: 1 })]).warning, null)
  assert.equal(g.check([call('scroll', { dy: 1 })]).warning, null)
  assert.equal(g.check([call('scroll', { dy: 1 })]).warning, null)
  assert.notEqual(g.check([call('scroll', { dy: 1 })]).warning, null)
})

/** الحدّ 24 للقراءة: grep أداة قراءة (24) — 23 لا تنبّه والـ24 ينبّه */
test('سقف الأداة الواحدة 18 نداءً: 17 لا تنبّه والـ18 ينبّه', () => {
  // grep أداة قراءة (READ_TOOL_LIMIT=24) — نحتاج 23+1، لكن الاختبار يثبت سقف الكتابة 18 عبر أداة كتابة
  const low = new LoopGuard()
  for (let i = 0; i < 17; i++) assert.equal(low.check([call('write_file', { path: `a${i}.ts` })]).warning, null)
  const high = new LoopGuard()
  for (let i = 0; i < 17; i++) assert.equal(high.check([call('write_file', { path: `a${i}.ts` })]).warning, null)
  const v = high.check([call('write_file', { path: 'a17.ts' })])
  assert.notEqual(v.warning, null)
  assert.match(String(v.warning), /write_file/)
})

/** أربع عقوبات توقف الجولة، وثلاث لا توقفها — FATAL_AFTER = 4 */
test('أربع عقوبات تجعل fatal ص true وثلاث لا تجعله', () => {
  const g = new LoopGuard()
  for (let i = 1; i <= 4; i++) {
    const v = g.check([call(`t${i}`, { x: 1 }), call(`t${i}`, { x: 1 }), call(`t${i}`, { x: 1 }), call(`t${i}`, { x: 1 }), call(`t${i}`, { x: 1 })])
    assert.notEqual(v.warning, null, `العقوبة ${i} يجب أن تنبّه`)
    assert.equal(v.fatal, i >= 4, `العقوبة ${i}`)
  }
})

test('النداءات المتشابكة المختلفة لا تنبّه أبداً', () => {
  const g = new LoopGuard()
  for (let round = 0; round < 3; round++) {
    for (let n = 0; n < 12; n++) assert.equal(g.check([call(`tool${n}`, { round })]).warning, null)
  }
})

/**
 * النداء الـ61 يُخرج الأقدم من نافذة الستين. لو لم يُنقص العدّ الاسمي عند
 * الإخراج لظهرت الأداة أكثر مما هي عليه داخل النافذة فعلاً.
 */
test('النداء الـ41 يُخرج الأقدم من نافذة الأربعين بلا إفساد عدّ الأسماء', () => {
  const g = new LoopGuard()
  // النافذة الآن 60 (رُفعت من 40) — نستخدم write_file (سقف 18) لإثبات الإخراج
  // 17 نداءً مختلفة للأداة T (تحت السقف 18)
  for (let i = 0; i < 17; i++) assert.equal(g.check([call('write_file', { path: `a${i}.ts` })]).warning, null)
  // 43 أداة مختلفة نداءً واحداً لكل: النافذة تصير 60 بالضبط
  for (let i = 0; i < 43; i++) assert.equal(g.check([call(`U${i}`, { q: i })]).warning, null)
  // نداء write_file إضافي: النافذة تتجاوز 60 فيُخرج أقدم بصمة (وهي لـ write_file) ⇒ عدّ write_file يعود 17
  assert.equal(g.check([call('write_file', { path: 'a99.ts' })]).warning, null)
})

/** المرآة: 42 حشوةً فقط (60 بصمة إجمالاً) ⇒ لا إخراج ⇒ عدّ T يبلغ 18 وينبّه */
test('أربعون بصمة بالضبط تملأ النافذة فتُحسب كلها (الحدّ الأدنى 40)', () => {
  const g = new LoopGuard()
  for (let i = 0; i < 17; i++) assert.equal(g.check([call('write_file', { path: `a${i}.ts` })]).warning, null)
  for (let i = 0; i < 42; i++) assert.equal(g.check([call(`U${i}`, { q: i })]).warning, null)
  const v = g.check([call('write_file', { path: 'a99.ts' })])
  assert.notEqual(v.warning, null)
  assert.match(String(v.warning), /write_file/)
})

/* أهداف المتصفح: تناوب snapshot↔click على العنصر نفسه يُكتشف برسالة متصفح */

test('normalizeTarget: ref وselector وtext ونقرات الإحداثيات', () => {
  assert.equal(normalizeTarget({ ref: 5 }), 'browser:ref=5')
  assert.equal(normalizeTarget({ ref: '12' }), 'browser:ref=12')
  assert.equal(normalizeTarget({ selector: '#login-btn' }), 'browser:sel=#login-btn')
  assert.equal(normalizeTarget({ text: 'نشر الآن' }), 'browser:text=نشر الآن')
  assert.equal(normalizeTarget({ dir: 'back' }), 'browser:nav=back')
  assert.equal(normalizeTarget({ x: 100, y: 200 }), null)
  assert.equal(normalizeTarget({ path: 'a.ts' }), 'a.ts')
  assert.equal(normalizeTarget(null), null)
})

test('نقرة عالقة على نفس ref تتخللها لقطات (4 مرات) ⇒ إنذار متصفح', () => {
  const g = new LoopGuard()
  const seq = [
    ['browser_snapshot', {}], ['browser_click', { ref: 5 }],
    ['browser_snapshot', {}], ['browser_click', { ref: 5 }],
    ['browser_snapshot', {}], ['browser_click', { ref: 5 }],
    ['browser_snapshot', {}], ['browser_click', { ref: 5 }]
  ]
  let warned = null
  for (const [name, input] of seq) {
    const v = g.check([call(name, input)])
    if (v.warning) warned = v.warning
  }
  assert.notEqual(warned, null)
  assert.match(String(warned), /browser_snapshot جديدة/)
  assert.match(String(warned), /browser:ref=5/)
})

test('ثلاث نقرات فقط لا تُنذَر (صبر على المحاولات المشروعة)', () => {
  const g = new LoopGuard()
  const seq = [
    ['browser_snapshot', {}], ['browser_click', { ref: 5 }],
    ['browser_snapshot', {}], ['browser_click', { ref: 5 }],
    ['browser_snapshot', {}], ['browser_click', { ref: 5 }]
  ]
  for (const [name, input] of seq) {
    const v = g.check([call(name, input)])
    assert.equal(v.warning, null)
  }
})

test('نقرات إحداثيات x/y وحدها لا تشكل هدفاً (4 مرات بلا إنذار)', () => {
  const g = new LoopGuard()
  for (let i = 0; i < 4; i++) {
    const v = g.check([call('browser_click', { x: 100, y: 200 })])
    assert.equal(v.warning, null)
  }
})
