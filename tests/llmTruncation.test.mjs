import { test } from 'node:test'
import assert from 'node:assert/strict'
import { truncationVerdict } from '../src/main/providers/truncation.ts'

/**
 * قاعدة الإقطاع في `runOpenai` (llm.ts): ردّ المزوّد العابر لـ OpenAI قد ينتهي
 * بـ [DONE] بلا `finish_reason` إطلاقاً. لو اكتفينا بـ finish==='length' لَمُرَّ
 * ردٌّ مبتور كأنه كامل، فيعتقد الوكيل أنه كتب الملف كاملاً وهو كتب نصفه.
 *
 * القاعدة المحافظّة: عند غياب `finish_reason` نعتبر الرد مبتوراً فقط إذا
 *   (أ) بلغ الإخراج المتراكم حدّ رموز الطلب أو قاربه (90%)، أو
 *   (ب) فشل تحليل وسائط نداء أداة (كائن JSON لم يُغلق = علامة قطع مباشرة).
 *
 * `truncationVerdict` هو نفس الاستدعاء الذي يستعمله `runOpenai` بعد الاستخراع،
 * فنعني عن الحاجة إلى مزوّد حيّ.
 */

const base = { finish: '', usageOutput: 0, estimatedChars: 0, maxTokens: 0, toolArgs: false }

test('finish === length ⇒ مبتور (الإشارة الصريحة تكفي)', () => {
  assert.equal(truncationVerdict({ ...base, finish: 'length', usageOutput: 1 }), true)
})

test('finish === max_tokens ⇒ مبتور أيضاً (بعض البوابات تستخدم الاسم الآخر)', () => {
  assert.equal(truncationVerdict({ ...base, finish: 'max_tokens', usageOutput: 1 }), true)
})

test('finish === stop مع إخراج منخفض ⇒ ليس مبتوراً', () => {
  assert.equal(truncationVerdict({ ...base, finish: 'stop', usageOutput: 42, maxTokens: 100000 }), false)
})

test('finish صريح (stop) يتقدّم على بلوغ حدّ الرموز', () => {
  assert.equal(truncationVerdict({ ...base, finish: 'stop', usageOutput: 999, maxTokens: 1000 }), false)
})

test('بلا finish_reason وبلوغ 90% من ميزانية الطلب ⇒ مبتور', () => {
  assert.equal(truncationVerdict({ ...base, usageOutput: 950, maxTokens: 1000 }), true)
})

test('بلا finish_reason وإخراج منخفض جداً ⇒ ليس مبتوراً', () => {
  assert.equal(truncationVerdict({ ...base, usageOutput: 12, maxTokens: 100000 }), false)
})

test('بلا finish_reason وفشل تحليل وسائط أداة ⇒ مبتور', () => {
  assert.equal(truncationVerdict({ ...base, usageOutput: 3, maxTokens: 100000, toolArgs: true }), true)
})

test('usage.output المُعلن يتقدّم على تقدير حجم النص', () => {
  // تقدير ضخم (100000 حرف) لكن المزوّد أعلن 10 رموز فقط ⇒ ليس مبتوراً
  assert.equal(truncationVerdict({ ...base, estimatedChars: 100000, usageOutput: 10, maxTokens: 1000 }), false)
  // والعكس: المزوّد أعلن 950 رمزاً ونصّه قصير ⇒ مبتور
  assert.equal(truncationVerdict({ ...base, estimatedChars: 10, usageOutput: 950, maxTokens: 1000 }), true)
})

test('بلا usage معلوم يُستخدم تقدير حجم النص (3.2 حرف/رمز)', () => {
  // 2880 حرفاً / 3.2 = 900 = حدّ الـ90% لميزانية 1000
  assert.equal(truncationVerdict({ ...base, usageOutput: 0, estimatedChars: 2880, maxTokens: 1000 }), true)
  // 2876 / 3.2 = 898.75 ⇒ 899 رمزاً: تحت الحدّ
  assert.equal(truncationVerdict({ ...base, usageOutput: 0, estimatedChars: 2876, maxTokens: 1000 }), false)
})

test('حدّ الـ90% بالضبط: ≤ floor(0.9×budget) ليس مبتوراً', () => {
  const budget = 2000
  const limit = Math.floor(budget * 0.9)
  assert.equal(truncationVerdict({ ...base, usageOutput: limit, maxTokens: budget }), true)
  assert.equal(truncationVerdict({ ...base, usageOutput: limit - 1, maxTokens: budget }), false)
})

test('بلا ميزانية رموز في الجسم (maxTokens=0) لا يُعتبر الرد مبتوراً بلا سبب', () => {
  assert.equal(truncationVerdict({ ...base, usageOutput: 999999, maxTokens: 0 }), false)
  // ولو كانت الوسائط مكسورة يكفي ذلك وحده
  assert.equal(truncationVerdict({ ...base, usageOutput: 999999, maxTokens: 0, toolArgs: true }), true)
})
