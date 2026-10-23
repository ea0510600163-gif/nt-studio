import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { newResponsesState, reduceResponses } from '../src/main/providers/responsesParse.ts'
import { newAnthropicState, reduceAnthropic, anthropicBlocks } from '../src/main/providers/anthropicParse.ts'
import { toChatItems } from '../src/main/agent/chatItems.ts'
import { estimateTokens } from '../src/main/agent/context.ts'
import { groupTasks, groupTitle, BOOT_TASK } from '../src/renderer/lib/groups.ts'
import { send, setWindow } from '../src/main/bus.ts'

/* ───────── التقاط التفكير من Responses API ───────── */
test('reduceResponses يلتقط reasoning_summary_text.delta في st.thinking ويمرّره لـ onThinking', () => {
  const st = newResponsesState()
  const seen = []
  reduceResponses(st, { type: 'response.reasoning_summary_text.delta', delta: 'أفكّر في الملف' }, () => {}, (s) => seen.push(s))
  reduceResponses(st, { type: 'response.reasoning_summary_text.delta', delta: ' ثم أنفّذ' }, () => {}, (s) => seen.push(s))
  assert.equal(st.thinking, 'أفكّر في الملف' + ' ثم أنفّذ')
  assert.deepEqual(seen, ['أفكّر في الملف', ' ثم أنفّذ'])
})

test('reduceResponses يلتقط reasoning_text.delta (تفكير النماذج الخام)', () => {
  const st = newResponsesState()
  const seen = []
  reduceResponses(st, { type: 'response.reasoning_text.delta', delta: 'خطوة أولى' }, () => {}, (s) => seen.push(s))
  assert.equal(st.thinking, 'خطوة أولى')
  assert.deepEqual(seen, ['خطوة أولى'])
})

test('response.completed يحمل ملخص التفكير احتياطاً حين لم تصل دلتا', () => {
  const st = newResponsesState()
  reduceResponses(
    st,
    {
      type: 'response.completed',
      response: { output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'تفكير احتياطي' }] }] }
    },
    () => {},
    () => {}
  )
  assert.equal(st.thinking, 'تفكير احتياطي')
})

test('response.completed يمرّر ملخص التفكير الاحتياطي لـ onThinking (يظهر حياً)', () => {
  const st = newResponsesState()
  const seen = []
  reduceResponses(
    st,
    {
      type: 'response.completed',
      response: { output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'تفكير احتياطي' }] }] }
    },
    () => {},
    (s) => seen.push(s)
  )
  assert.deepEqual(seen, ['تفكير احتياطي'])
})

/* ───────── تحويل السجل إلى عناصر عرض ───────── */

test('toChatItems يحوّل كتلة thinking إلى عنصر تفكير في موضعها الصحيح قبل النص', () => {
  const items = toChatItems([
    { role: 'user', content: [{ type: 'text', text: 'ابنِ لي موقعاً' }] },
    { role: 'assistant', content: [{ type: 'thinking', text: 'أحتاج package.json أولاً' }, { type: 'text', text: 'سأبدأ الآن' }] }
  ])
  assert.equal(items.length, 3)
  assert.equal(items[0].kind, 'user')
  assert.equal(items[1].kind, 'thinking')
  assert.equal(items[1].text, 'أحتاج package.json أولاً')
  assert.equal(items[2].kind, 'assistant')
  assert.equal(items[2].text, 'سأبدأ الآن')
})

test('toChatItems يحذف كتلة thinking الفارغة', () => {
  const items = toChatItems([{ role: 'assistant', content: [{ type: 'thinking', text: '   ' }, { type: 'text', text: 'رد' }] }])
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'assistant')
})

/* ───────── تقدير الرموز ───────── */

test('estimateTokens لا يحسب التفكير: لا يُرسل للمزوّد فلا يستهلك سياقنا', () => {
  const msgs = [{ role: 'assistant', content: [{ type: 'thinking', text: 'x'.repeat(100000) }] }]
  const tokens = estimateTokens('', msgs)
  assert.equal(tokens, 0)
})

/* ───────── التجميع ───────── */

test('التفكير صفّ داخل مجموعة الأحداث — لا صندوق داخل صندوق', () => {
  const think = (id) => ({ kind: 'thinking', id, text: 'تفكير', task: 't1', taskText: 'مهمة t1' })
  const tool = (id) => ({ kind: 'tool', id, name: 'read_file', input: { path: 'a' }, status: 'ok', ms: 3, task: 't1', taskText: 'مهمة t1' })
  const segs = groupTasks([tool('x'), think('k1'), tool('y')], false)
  // دفعة أدوات واحدة = مجموعة أحداث واحدة، والتفكير صفّ بينها بترتيبه
  const gs = segs.filter((s) => s.type === 'group')
  assert.equal(gs.length, 1)
  assert.deepEqual(gs[0].rows.map((r) => r.type), ['tool', 'think', 'tool'])
  // تفكير منفرد بلا أدوات يبقى شريحة مستقلّة فوق الخلفية
  const lone = groupTasks([think('k2')], false)
  assert.equal(lone.filter((s) => s.type === 'item' && s.item.kind === 'thinking').length, 1)
})

test('المجموعة قبل تفكير متأخر تبقى حيّة أثناء العمل', () => {
  const think = { kind: 'thinking', id: 'k1', text: 'أفكّر', task: 't1', taskText: 'مهمة t1' }
  const tool = (id) => ({ kind: 'tool', id, name: 'read_file', input: {}, status: 'ok', ms: 3, task: 't1', taskText: 'مهمة t1' })
  const segs = groupTasks([tool('x'), think], true)
  const g = segs.find((s) => s.type === 'group')
  assert.equal(g.live, true)
})

test('groupTitle: صفّ think في المقدّمة لا يفقد عنوان المهمة', () => {
  const think = { type: 'think', key: 'k', item: { kind: 'thinking', id: 'k', text: 'ت', task: 't1', taskText: 'مهمة القهوة' } }
  const tool = { type: 'tool', key: 'x', item: { kind: 'tool', id: 'x', name: 'read_file', input: {}, status: 'ok', task: 't1', taskText: 'مهمة القهوة' } }
  assert.equal(groupTitle([think, tool], 't1'), 'مهمة القهوة')
  assert.equal(groupTitle([{ type: 'tool', key: 'b', item: { kind: 'tool', id: 'b', name: 'create_project', input: {}, status: 'ok' } }], BOOT_TASK), 'التهيئة والاستكشاف')
  assert.equal(groupTitle([{ type: 'notice', key: 'n', item: { kind: 'notice', id: 'n', level: 'info', text: 'ت' } }], 't9'), 'مهمة')
})

test('معرّف المجموعة ثابت: تفكير منفصل قبلها لا يغيّر مفتاحها', () => {
  const tool = (id) => ({ kind: 'tool', id, name: 'read_file', input: {}, status: 'ok', ms: 3, task: 't1', taskText: 'مهمة t1' })
  const think = (id) => ({ kind: 'thinking', id, text: '', task: 't1', taskText: 'مهمة t1' })
  const withThink = groupTasks([think('thk_1'), tool('x'), tool('y')], false).find((s) => s.type === 'group')
  const withoutThink = groupTasks([tool('x'), tool('y')], false).find((s) => s.type === 'group')
  assert.equal(withThink.id, withoutThink.id, 'المعرّف أول أداة لا أول عنصر')
})

/* ───────── الناقل: ترتيب الدلتا ───────── */

test('bus يحفظ ترتيب الدلتا: تفكير قبل نص حتى مع حدث فاصل', () => {
  const events = []
  setWindow({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (_ch, p) => events.push(p) } })
  try {
    send('agent:event', { t: 'thinking_delta', sessionId: 's1', id: 'thk_1', text: 'أفكّر' })
    send('agent:event', { t: 'text_delta', sessionId: 's1', text: 'نصّ' })
    send('agent:event', { t: 'assistant_done', sessionId: 's1' }) // يجبر التفريغ
    assert.deepEqual(events.map((e) => e.t), ['thinking_delta', 'text_delta', 'assistant_done'])
  } finally {
    setWindow(null)
  }
})

/* ───────── Anthropic: التقاط كتل التفكير ───────── */

test('reduceAnthropic يلتقط كتلة thinking ودلتاها', () => {
  const st = newAnthropicState()
  const seen = []
  reduceAnthropic(st, { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, () => {}, (s) => seen.push(s))
  reduceAnthropic(st, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'أفكّر' } }, () => {}, (s) => seen.push(s))
  reduceAnthropic(st, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' أكثر' } }, () => {}, (s) => seen.push(s))
  assert.deepEqual(anthropicBlocks(st)[0], { type: 'thinking', text: 'أفكّر أكثر' })
  assert.deepEqual(seen, ['أفكّر', ' أكثر'])
})

test('reduceAnthropic يتجاهل thinking_delta بلا حقل thinking (لا يكتب "undefined")', () => {
  const st = newAnthropicState()
  const seen = []
  reduceAnthropic(st, { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, () => {}, (s) => seen.push(s))
  reduceAnthropic(st, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta' } }, () => {}, (s) => seen.push(s))
  reduceAnthropic(st, { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta' } }, () => {}, (s) => seen.push(s))
  assert.deepEqual(seen, [], 'لا يُمرّر شيء للمعرض')
  assert.equal(anthropicBlocks(st).length, 0, 'كتلة فارغة ⇒ لا كتلة في الناتج (وبلا "undefined")')
})
