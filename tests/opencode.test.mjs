import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newResponsesState, reduceResponses } from '../src/main/providers/responsesParse.ts'
import { OPENCODE_GO, OPENCODE_GO_BASE_URL, catalogIssues } from '../src/shared/catalogs.ts'

const feed = (events) => {
  const st = newResponsesState()
  const out = []
  for (const e of events) reduceResponses(st, e, (t) => out.push(t))
  return { st, out }
}

test('كتالوج OpenCode Go: العدد والتوجيه والمعلومات صحيحة', () => {
  // الرابط المنشور اليوم في وثائق Go: البادئة العامة التي يخدمها البوّاب للأنماط الثلاثة
  assert.equal(OPENCODE_GO_BASE_URL, 'https://opencode.ai/inference/go/v1')
  const by = (s) => OPENCODE_GO.models.filter((m) => m.apiStyle === s)
  // لقطة 2026-10-20: القائمة المنشورة (29 نموذجاً) — chat/completions 19 + messages 5 + responses 5
  assert.equal(OPENCODE_GO.models.length, 29)
  assert.equal(by('openai').length, 19)
  assert.equal(by('anthropic').length, 5)
  assert.equal(by('responses').length, 5)
  for (const m of OPENCODE_GO.models) {
    assert.ok(m.id && typeof m.contextWindow === 'number' && m.contextWindow > 0)
    assert.equal(typeof m.tools, 'boolean')
    assert.equal(typeof m.vision, 'boolean')
    // كل نموذج يحمل سقف إخراج واقعياً (64K على الأقل) — رفع Expectations
    assert.ok(m.maxOutput && m.maxOutput >= 64_000, `${m.id}: maxOutput=${m.maxOutput}`)
  }
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'grok-4.7').apiStyle, 'responses')
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'claude-haiku-5-5').apiStyle, 'anthropic')
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'glm-5.3-flash').apiStyle, 'openai')
  // إضافي (t9): كل نموذج يحمل نمط نداء معلوماً من الثلاثة — نموذج بلا apiStyle
  // يُوجَّه صامتاً حسب نمط المزوّد في callLlm، فنمط رابع غير مُدرج هنا = توجيه خاطئ
  assert.deepEqual(
    [...new Set(OPENCODE_GO.models.map((m) => m.apiStyle ?? 'openai'))].sort(),
    ['anthropic', 'openai', 'responses']
  )
  // إضافي (t9): الأقسام الثلاثة تحصي الكتالوج كله — لا نموذج بلا قسم
  assert.equal(by('openai').length + by('anthropic').length + by('responses').length, OPENCODE_GO.models.length)
})

test('كتالوج OpenCode Go: لا تناقض داخلي (catalogIssues)', () => {
  assert.deepEqual(catalogIssues(OPENCODE_GO), [])
})

test('كتالوج OpenCode Go: كل نموذج يرى الصور مُعلَّم vision=true وإلا فحلقة التحقّق صامتة', () => {
  // القيم من models.dev (المزوّد opencode-go) — عمود `modalities.input` يحتوي image
  const vision = {
    'beam-free': false, 'deepseek-v4.1-flash': true, 'deepseek-v4-pro': false,
    'gemini-4-argon': true, 'glm-5.2': false, 'glm-5.3': false, 'glm-5.3-flash': true,
    'hy3': false, 'hy4-preview': false, 'kimi-k2.7-code': true, 'kimi-k3': true, 'kimi-k3.1-pro': true,
    'longcat-2.0': false, 'mimo-v2.5': true, 'mimo-v2.5-pro': false,
    'mimo-v2.6-flash': true, 'mimo-v2.6-pro': true, 'minimax-m3.1-flash': true, 'step-5-preview': true,
    'claude-haiku-5-5': true, 'minimax-m3': true, 'qwen3.7-plus': true, 'qwen3.8-flash': true,
    'qwen3.8-max': true, 'gpt-5.6-luna': true, 'gpt-6-luna': true, 'grok-4.7': true,
    'muse-spark-1.2-contributor': true, 'muse-spark-1.3-contributor': true
  }
  // الجدول يغطّي الكتالوج كاملاً — نموذج غائب عن الجدول = صمت غير مقصود
  assert.deepEqual([...OPENCODE_GO.models.map((m) => m.id)].sort(), [...Object.keys(vision)].sort())
  for (const m of OPENCODE_GO.models) {
    assert.equal(m.vision, vision[m.id], `${m.id}: الكتالوج يقول ${m.vision ? '✓' : '—'} والصواب ${vision[m.id] ? '✓' : '—'}`)
  }
  // ما كان صامتاً: نموذج يرى الصور وكان vision=false فيُسقط الوكيل لقطاته
  for (const id of ['grok-4.7', 'muse-spark-1.2-contributor', 'muse-spark-1.3-contributor',
    'deepseek-v4.1-flash', 'kimi-k2.7-code', 'mimo-v2.5', 'qwen3.8-max', 'minimax-m3',
    'gemini-4-argon', 'step-5-preview'])
    assert.equal(OPENCODE_GO.models.find((m) => m.id === id).vision, true, `${id} يجب أن يرى الصور`)
})

test('كتالوج OpenCode Go: المعرّفات غير مكرّرة وقوائم الأنماط متطابقة', () => {
  for (const id of ['qwen3.8-flash', 'qwen3.8-max'])
    assert.equal(OPENCODE_GO.models.filter((m) => m.id === id).length, 1, `${id} مرة واحدة فقط`)
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'qwen3.8-flash').apiStyle, 'anthropic')
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'qwen3.8-max').apiStyle, 'anthropic')
})

test('كتالوج OpenCode Go: النماذج الجديدة في خطة الويب حاضرة بمسارها', () => {
  // أُضيفت بعد لقطة أكتوبر الأولى: Step 5 Preview (غير المجاني)، Beam Free، Kimi K3.1 Pro
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'step-5-preview')?.apiStyle, 'openai')
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'beam-free')?.apiStyle, 'openai')
  // الوثائق تنشر لـ Gemini النمط الرابع @ai-sdk/google؛ والعميل يعرف ثلاثة أنماط،
  // والبوّاب يقبل معرّفه على مسار openai-compatible ⇒ نوجّهه openai صراحةً ولا نتركه صامتاً
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'gemini-4-argon')?.apiStyle, 'openai')
  // إعادة تسمية 2026-10: MiniMax M3.1 Flash صار معرّفه الرسمي بلا لاحقة -free
  assert.equal(OPENCODE_GO.models.find((m) => m.id === 'minimax-m3.1-flash')?.apiStyle, 'openai')
})

test('كتالوج OpenCode Go: معرّفات خارج القائمة المنشورة لا تُدرج', () => {
  // تحقّق حيّ 2026-10-26: بواب Go لا يخدم ولا الوثائق تنشر المعرفات القديمة المصوبة
  // (وسابقاً: grok-4.5، space-bunny، step-5-preview-free يردّ عليها البوّاب بـ 400)
  for (const dead of ['grok-4.5', 'grok-4.6', 'glm-5.1', 'space-bunny', 'space-bunny-free', 'step-5-preview-free',
    'gemini-4-argon-contributor', 'minimax-m3.1-flash-free', 'longcat-2.5-preview-free', 'longcat-2.5'])
    assert.equal(OPENCODE_GO.models.find((m) => m.id === dead), undefined, `${dead} يجب ألا يُدرج`)
})

test('كتالوج OpenCode Go: نوافذ السياق وسقوف الإخراج مضبوطة من models.dev', () => {
  const cw = (id) => OPENCODE_GO.models.find((m) => m.id === id).contextWindow
  const mo = (id) => OPENCODE_GO.models.find((m) => m.id === id).maxOutput
  assert.equal(cw('hy4-preview'), 1_024_000)
  assert.equal(cw('minimax-m3'), 1_000_000)
  assert.equal(mo('minimax-m3'), 131_072)
  assert.equal(cw('mimo-v2.5'), 1_000_000)
  assert.equal(cw('kimi-k2.7-code'), 262_144)
  assert.equal(mo('kimi-k2.7-code'), 262_144)
  assert.equal(cw('grok-4.7'), 500_000)
  assert.equal(mo('grok-4.7'), 500_000)
  assert.equal(cw('gemini-4-argon'), 1_048_576)
  assert.equal(mo('gemini-4-argon'), 65_536)
  assert.equal(cw('minimax-m3.1-flash'), 1_000_000)
  assert.equal(mo('minimax-m3.1-flash'), 512_000)
})

test('كتالوج OpenCode Go: الأسعار مرفقة لكل نموذج وتطابق جدول الوثائق (دولار لكل مليون رمز)', () => {
  // القيم من جدول أسعار Go المنشور (2026-10-26) — نفس طابق العملة للمستوى الأول لكل نموذج
  const price = (id) => OPENCODE_GO.models.find((m) => m.id === id)?.cost
  const free = price('beam-free')
  assert.deepEqual(free, { input: 0, output: 0, cacheRead: 0 })
  assert.deepEqual(price('glm-5.3-flash'), { input: 0.15, output: 0.5, cacheRead: 0.03 })
  assert.deepEqual(price('glm-5.2'), { input: 1.4, output: 4.4, cacheRead: 0.26 })
  assert.deepEqual(price('gpt-6-luna'), { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 })
  assert.deepEqual(price('claude-haiku-5-5'), { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 })
  assert.deepEqual(price('kimi-k3'), { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 })
  assert.deepEqual(price('qwen3.7-plus'), { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 })
  assert.deepEqual(price('deepseek-v4.1-flash'), { input: 0.15, output: 0.6, cacheRead: 0.003 })
  for (const model of OPENCODE_GO.models) {
    assert.ok(model.cost, `${model.id}: بلا سعر`)
    assert.ok(Number.isFinite(model.cost.input) && model.cost.input >= 0, `${model.id}: سعر إدخال`)
    assert.ok(Number.isFinite(model.cost.output) && model.cost.output >= 0, `${model.id}: سعر إخراج`)
  }
})

test('Responses: نص متدفّق + استخدام + اكتمال', () => {
  const { st, out } = feed([
    { type: 'response.output_text.delta', delta: 'مرح' },
    { type: 'response.output_text.delta', delta: 'بت' },
    { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 3 } } }
  ])
  assert.equal(st.text, 'مرحبت')
  assert.deepEqual(out, ['مرح', 'بت'])
  assert.equal(st.usage.input, 12)
  assert.equal(st.usage.output, 3)
  assert.equal(st.done, true)
  assert.equal(st.error, undefined)
})

test('Responses: نداء أداة عبر added + deltas + done', () => {
  const { st } = feed([
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"pa' },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: 'th":"a.ts"}' },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.ts"}' } },
    { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 9 } } }
  ])
  const calls = [...st.calls.values()]
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 'call_1')
  assert.equal(calls[0].name, 'read_file')
  assert.equal(calls[0].args, '{"path":"a.ts"}')
  assert.equal(st.done, true)
})

test('Responses: احتياط من response.output عندما لا تصل deltas', () => {
  const { st, out } = feed([
    {
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'أهلاً' }] },
          { type: 'function_call', call_id: 'c9', name: 'list_dir', arguments: '{}' }
        ]
      }
    }
  ])
  assert.equal(st.text, 'أهلاً')
  assert.deepEqual(out, ['أهلاً'])
  const names = [...st.calls.values()].map((c) => c.name)
  assert.ok(names.includes('list_dir'))
})

test('Responses: incomplete بسبب حد الإخراج', () => {
  const { st } = feed([{ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }])
  assert.equal(st.maxTokens, true)
  assert.equal(st.done, true)
})

test('Responses: failed قابل لإعادة المحاولة عند overload', () => {
  const { st } = feed([{ type: 'response.failed', response: { error: { message: 'server overloaded, try again' } } }])
  assert.ok(st.error?.includes('overloaded'))
  assert.equal(st.retryable, true)
  assert.equal(st.done, false)
})

test('Responses: حدث error', () => {
  const { st } = feed([{ type: 'error', code: 'invalid_request', message: 'bad tool schema' }])
  assert.ok(st.error?.includes('bad tool schema'))
  assert.equal(st.retryable, false)
})
