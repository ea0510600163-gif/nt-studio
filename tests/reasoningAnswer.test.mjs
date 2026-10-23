import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promoteReasoningAnswer, toChatItems } from '../src/main/agent/chatItems.ts'

/*
 * نماذج الاستدلال بنمط Responses (مؤكَّد حياً: deepseek-v4.1-flash على OpenCode Go)
 * قد تُخرج جوابها كاملاً على قناة التفكير: كتلة thinking بلا text (responses.ts:63-64).
 * كان الجواب يبقى محتجزاً في بطاقة «تفكّر» مطويّة. المسار الحيّ (loop.ts) يرقّيه عبر
 * promoteReasoningAnswer، ومسار إعادة الفتح (toChatItems) يرقّيه أيضاً. يُختبر الاثنان
 * هنا مباشرة على المشروع الحقيقي. chatItems.ts نقية (بلا electron) فتُستورد تحت Node.
 */

/* ───────── promoteReasoningAnswer: المسار الحيّ في loop.ts ───────── */

test('promoteReasoningAnswer: كتلة thinking وحيدة غير فارغة تصير كتلة نصّ وحيدة', () => {
  assert.deepEqual(promoteReasoningAnswer([{ type: 'thinking', text: 'الجواب' }]), [{ type: 'text', text: 'الجواب' }])
})

test('promoteReasoningAnswer: كتلتا thinking تُدمجان بسطر فارغ بينهما', () => {
  const content = [{ type: 'thinking', text: 'a' }, { type: 'thinking', text: 'b' }]
  assert.deepEqual(promoteReasoningAnswer(content), [{ type: 'text', text: 'a\n\nb' }])
})

test('promoteReasoningAnswer: نصّ مفيد موجود ⇒ بلا ترقية (الحالة الطبيعية السليمة لا تتغيّر)', () => {
  const content = [{ type: 'thinking', text: 'x' }, { type: 'text', text: 'y' }]
  assert.deepEqual(promoteReasoningAnswer(content), content)
})

test('promoteReasoningAnswer: وجود tool_use ⇒ بلا ترقية (سرد أثناء العمل يبقى تفكيراً)', () => {
  const content = [{ type: 'thinking', text: 'x' }, { type: 'tool_use', id: 'c1', name: 'read_file', input: {} }]
  assert.deepEqual(promoteReasoningAnswer(content), content)
})

test('promoteReasoningAnswer: كتلة thinking فارغة/مسافات ⇒ بلا ترقية', () => {
  const content = [{ type: 'thinking', text: '   ' }]
  assert.deepEqual(promoteReasoningAnswer(content), content)
})

test('promoteReasoningAnswer: [] ⇒ []', () => {
  assert.deepEqual(promoteReasoningAnswer([]), [])
})

test('promoteReasoningAnswer: يُقصّ المسافات حول النصّ المرفوع', () => {
  assert.deepEqual(promoteReasoningAnswer([{ type: 'thinking', text: '  الجواب  ' }]), [{ type: 'text', text: 'الجواب' }])
})

test('promoteReasoningAnswer: كتلة تفكير أطول من MAX_ITEM_CHARS لا تُقصّ بالترقية (القطع مسألة عرض في toChatItems)', () => {
  const long = 'x'.repeat(7000)
  const out = promoteReasoningAnswer([{ type: 'thinking', text: long }])
  assert.deepEqual(out, [{ type: 'text', text: long }])
  assert.equal(out[0].text.length, 7000)
})

/* ───────── toChatItems: مسار إعادة الفتح ───────── */

test('toChatItems: رسالة تفكير وحيد غير فارغ بلا غيره ⇒ عنصر مساعد واحد بالنصّ الكامل', () => {
  const items = toChatItems([{ role: 'assistant', content: [{ type: 'thinking', text: 'الجواب الكامل' }] }])
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'assistant')
  assert.equal(items[0].text, 'الجواب الكامل')
})

test('toChatItems: تفكير + نصّ ⇒ عنصر تفكير ثم مساعد، بلا ترقية لكليهما', () => {
  const items = toChatItems([{ role: 'assistant', content: [{ type: 'thinking', text: 'تفكير' }, { type: 'text', text: 'جواب' }] }])
  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'thinking')
  assert.equal(items[0].text, 'تفكير')
  assert.equal(items[1].kind, 'assistant')
  assert.equal(items[1].text, 'جواب')
})

test('toChatItems: تفكير + tool_use (ونتيجته في رسالة لاحقة) ⇒ التفكير يبقى thinking والأداة تُعرض tool؛ لا ترقية', () => {
  const items = toChatItems([
    { role: 'assistant', content: [{ type: 'thinking', text: 'أفكّر ثم أقرأ' }, { type: 'tool_use', id: 'call1', name: 'read_file', input: { path: 'a.ts' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: 'محتويات', is_error: false }] }
  ])
  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'thinking')
  assert.equal(items[0].text, 'أفكّر ثم أقرأ')
  assert.equal(items[1].kind, 'tool')
  assert.equal(items[1].id, 'call1')
  assert.equal(items[1].status, 'ok')
})

test('toChatItems: كتلة تفكير فارغة/مسافات وحدها ⇒ لا عنصر (السلوك الحالي محفوظ)', () => {
  const items = toChatItems([{ role: 'assistant', content: [{ type: 'thinking', text: '   ' }] }])
  assert.equal(items.length, 0)
})

test('toChatItems: ترقية في إعادة الفتح تُقصّ عند MAX_ITEM_CHARS', () => {
  const long = 'x'.repeat(7000)
  const items = toChatItems([{ role: 'assistant', content: [{ type: 'thinking', text: long }] }])
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'assistant')
  assert.equal(items[0].text.startsWith('x'.repeat(6000)), true)
  assert.equal(items[0].text.endsWith('…'), true)
  assert.ok(items[0].text.length <= 6001)
})
