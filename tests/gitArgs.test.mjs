import { test } from 'node:test'
import assert from 'node:assert/strict'
// نستورد الدالة النقية من المصدر نفسه. لا نستطيع استيراد projects.ts تحت Node
// (يفشل عند `../store/db` قبل أن يصل إلى electron — انظر التقرير)، فاختصار
// رسالة commit الوحيد المُختبَر هنا هو المسار المشارك: checkpoint ينادي
// safeCommitMessage(message) بالـ max=120 الافتراضي، فنفس العقد يُطبَّق على حقل
// الرسالة الذي يصل إلى git.
import { safeCommitMessage } from '../src/main/util.ts'

/* ───────────── العربية والمسافات تمرّ سالمة ───────────── */

test('safeCommitMessage: النص العربي يمرّ كما هو بلا تغيير', () => {
  assert.equal(safeCommitMessage('نهاية المهمة'), 'نهاية المهمة')
  assert.equal(safeCommitMessage('بعد المرحلة'), 'بعد المرحلة')
})

test('safeCommitMessage: تشغيلات المسافات/الأسطر/التبويبات تُ collapse إلى مسافة واحدة', () => {
  assert.equal(safeCommitMessage('a\t\t b\n\n c'), 'a b c')
  assert.equal(safeCommitMessage('line1\r\n\r\n\tline2'), 'line1 line2')
  // بلا محارف خطر: كل شيء مسافة، فلا يبقى إلّا فراغات تُقصّ إلى نص فارغ
  assert.equal(safeCommitMessage('  \n\t  '), 'checkpoint')
})

/* ───────────── لا ينجو أي محرف من محارفّ الصدفة ───────────── */

test('safeCommitMessage: a & calc & b => a calc b، بلا محرف خطر ناجٍ', () => {
  const out = safeCommitMessage('a & calc & b')
  assert.equal(out, 'a calc b') // & أُزيلت والمسافة المزدوجة عُولمت
  assert.ok(!/[&|<>^"'`$;(){}[\]!*?~\\#%]/.test(out))
})

test('safeCommitMessage: 23 محرف خطر متشابكة مع 23 حرفًا = الحروف فقط باقية بترتيبها', () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVW' // 23
  const metas = ['"', "'", '`', '$', '&', '|', '>', '<', '^', '%', ';', '(', ')', '{', '}', '[', ']', '!', '*', '?', '~', '\\', '#'] // 23
  assert.equal(letters.length, 23)
  assert.equal(metas.length, 23)
  let mixed = ''
  for (let i = 0; i < letters.length; i++) mixed += letters[i] + metas[i]
  // المجموعة المطلوبة في المهمة (plus المكمّلة) كلها حاضرة في المدخل
  for (const ch of ['"', "'", '`', '$', '|', '>', '<', '^', '%', ';']) assert.ok(mixed.includes(ch), `missing ${ch} in input`)
  const out = safeCommitMessage(mixed)
  assert.equal(out, letters) // كل الحروف باقية، لا محرف خطر ناجٍ
  assert.ok(!/[&|<>^"'`$;%(){}[\]!*?~\\#]/.test(out), `metachar survived: ${out}`)
})

test('safeCommitMessage: سلسلة من محارفّ الخطر فقط = fallback «checkpoint» لا نص فارغ', () => {
  assert.equal(safeCommitMessage('&|<>^"\'`$;'), 'checkpoint')
  assert.equal(safeCommitMessage('| | |'), 'checkpoint')
  assert.equal(safeCommitMessage('%%%$$$'), 'checkpoint')
  assert.ok(safeCommitMessage('&&&').length > 0)
})

/* ───────────── الاقتطاع بعدد النقاط البرمجية (آمن مع العربية والفوق-BMP) ───────────── */

test('safeCommitMessage: رسالة 300 حرف ASCII تُقتطع إلى 120 نقطة برمجية', () => {
  const s = 'x'.repeat(300)
  const out = safeCommitMessage(s)
  assert.equal([...out].length, 120)
  assert.equal(out, 'x'.repeat(120))
})

test('safeCommitMessage: رسالة 300 حرف عربي تُقتطع إلى 120 نقطة برمجية (لا قطع وسط محرف)', () => {
  const s = 'ع'.repeat(300)
  const out = safeCommitMessage(s)
  assert.equal([...out].length, 120)
  assert.equal(out, 'ع'.repeat(120))
})

test('safeCommitMessage: النقاط البرمجية الفوق-BMP (إيموجي/زوج بديل) لا تُقطع وسط الزوج', () => {
  const s = '😀'.repeat(300) // كل إيموجي نقطتان برمجيتان عبر UTF-16
  const out = safeCommitMessage(s)
  assert.equal([...out].length, 120) // 120 نقطة برمجية
  assert.equal(out.length, 240) // 240 وحدة UTF-16 => لم يُشقّ أي زوج بديل
  // معامل max مخصّص يعمل أيضًا بالنقاط البرمجية
  const few = safeCommitMessage('😀'.repeat(300), 50)
  assert.equal([...few].length, 50)
  assert.equal(few.length, 100)
})

/* ───────────── عقد checkpoint: حقل الرسالة لا يتجاوز 120 نقطة برمجية ───────────── */

test('checkpoint: رسالة تعسّفية/ضخمة لا تتجاوز 120 نقطة برمجية بعد التنقية', () => {
  // checkpoint ينادي safeCommitMessage(message) بلا max ⇒ الافتراضي 120.
  const hostile = ('أمر ضار & del /f & ' + 'x'.repeat(400) + ' | calc ; (){}[]`$').repeat(3)
  const out = safeCommitMessage(hostile)
  assert.ok([...out].length <= 120)
  assert.ok(!/[&|<>^"'`$;(){}[\]!*?~\\#%]/.test(out))
})
