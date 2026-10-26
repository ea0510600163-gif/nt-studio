import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enrichModel, mergeModelLists, metaFromItem, modelId, styleFromEndpoint } from '../src/shared/modelMeta.ts'
import { CODECRAFT, OPENCODE_GO, catalogFor } from '../src/shared/catalogs.ts'

test('modelId: يقرأ كل أشكال المعرّف ويقتلع بادئة models/', () => {
  assert.equal(modelId('models/claude-opus-5.5'), 'claude-opus-5.5')
  assert.equal(modelId({ id: 'gpt-5.5' }), 'gpt-5.5')
  assert.equal(modelId({ name: 'kimi-k3' }), 'kimi-k3')
  assert.equal(modelId({ model: 'glm-5.3' }), 'glm-5.3')
  assert.equal(modelId({ slug: 'grok-4.6' }), 'grok-4.6')
  assert.equal(modelId({}), '')
  assert.equal(modelId(null), '')
})

test('metaFromItem: تنسيق OpenRouter (context_length + top_provider + architecture)', () => {
  const meta = metaFromItem({
    id: 'qwen3.8-max',
    context_length: 200_000,
    top_provider: { max_completion_tokens: 8_000 },
    architecture: { input_modalities: ['text', 'image'] },
    provider: { api: 'https://opencode.ai/inference/go/anthropic/v1' }
  })
  assert.equal(meta.contextWindow, 200_000)
  assert.equal(meta.maxOutput, 8_000)
  assert.equal(meta.vision, true)
  assert.equal(meta.apiStyle, 'anthropic')
})

test('metaFromItem: تنسيق OpenAI الموسّع (context_window + capabilities)', () => {
  const meta = metaFromItem({ id: 'x', context_window: '128000', max_output_tokens: 16_000, capabilities: ['vision', 'tools'] })
  assert.equal(meta.contextWindow, 128_000)
  assert.equal(meta.maxOutput, 16_000)
  assert.equal(meta.vision, true)
  assert.equal(meta.tools, true)
})

test('metaFromItem: قائمة عارية بلا بيانات لا تخترع شيئاً', () => {
  assert.deepEqual(metaFromItem({ id: 'm', object: 'model', created: 1, owned_by: 'x' }), {})
  assert.deepEqual(metaFromItem('m'), {})
})

test('styleFromEndpoint: يميّز الأنماط الثلاثة', () => {
  assert.equal(styleFromEndpoint('https://opencode.ai/inference/go/anthropic/v1'), 'anthropic')
  assert.equal(styleFromEndpoint('@ai-sdk/anthropic'), 'anthropic')
  assert.equal(styleFromEndpoint('https://api.openai.com/v1'), 'openai')
  assert.equal(styleFromEndpoint('@ai-sdk/openai-compatible'), 'openai')
  assert.equal(styleFromEndpoint('https://x/v1/responses'), 'responses')
  assert.equal(styleFromEndpoint(''), undefined)
})

test('metaFromItem: تنسيق models.dev (limit + cost + modalities + provider.npm)', () => {
  const meta = metaFromItem({
    id: 'glm-5.3-flash',
    limit: { context: 1_000_000, output: 131_072 },
    modalities: { input: ['text', 'image'] },
    tool_call: true,
    cost: { input: 0.15, output: 0.5, cache_read: 0.03 },
    provider: { npm: '@ai-sdk/openai-compatible' }
  })
  assert.equal(meta.contextWindow, 1_000_000)
  assert.equal(meta.maxOutput, 131_072)
  assert.equal(meta.vision, true)
  assert.equal(meta.tools, true)
  assert.deepEqual(meta.cost, { input: 0.15, output: 0.5, cacheRead: 0.03 })
})

test('metaFromItem: نموذج مجاني بسعر صفر يُقرأ كما هو ولا يُحذف', () => {
  const meta = metaFromItem({
    id: 'beam-free',
    limit: { context: 1_048_576, output: 131_072 },
    cost: { input: 0, output: 0, cache_read: 0 }
  })
  assert.deepEqual(meta.cost, { input: 0, output: 0, cacheRead: 0 })
  assert.equal(meta.contextWindow, 1_048_576)
})

test('enrichModel: طبقة dev تسبق الكتالوج في الأسعار والحدود ولا تمسّ نمط النداء', () => {
  const catalog = { contextWindow: 1_000_000, maxOutput: 131_072, apiStyle: 'responses', cost: { input: 1, output: 1 } }
  const dev = { contextWindow: 1_050_000, apiStyle: 'openai', cost: { input: 0.1, output: 0.5, cacheRead: 0.01 } }
  const m = enrichModel('whatever-x', { catalog, dev })
  assert.equal(m.contextWindow, 1_050_000)
  assert.equal(m.apiStyle, 'responses')
  assert.deepEqual(m.cost, { input: 0.1, output: 0.5, cacheRead: 0.01 })
})

test('enrichModel: الأولوية للبيانات الحيّة ثم الكتالوج ثم نمط المزوّد', () => {
  const live = { contextWindow: 400_000 }
  const catalog = { contextWindow: 200_000, maxOutput: 64_000, vision: true }
  const provider = { apiStyle: 'anthropic' }
  const m = enrichModel('claude-opus-4.8', { live, catalog, provider })
  assert.equal(m.contextWindow, 400_000)
  assert.equal(m.maxOutput, 64_000)
  assert.equal(m.vision, true)
  assert.equal(m.apiStyle, 'anthropic')
  assert.equal(m.id, 'claude-opus-4.8')
  assert.equal(typeof m.tools, 'boolean')
})

test('enrichModel: بلا أي مصدر يعود إلى الاستنتاج الافتراضي', () => {
  const m = enrichModel('unknown-model-7b')
  assert.equal(m.id, 'unknown-model-7b')
  assert.equal(m.contextWindow, 128_000)
  assert.equal(m.maxOutput, 64_000)
})

test('خط أنابيب الجلب: قائمة حيّة عارية لـ CodeCraft تُثرى من الكتالوج', () => {
  const bare = [{ id: 'claude-opus-5.5', object: 'model', created: 1, owned_by: 'cleanapis' }, { id: 'brand-new-model' }]
  const catalog = catalogFor('https://codecraftapi.com/v1')
  assert.equal(catalog, CODECRAFT)
  const models = bare.map((item) =>
    enrichModel(modelId(item), { catalog: catalog.models.find((m) => m.id === modelId(item)), live: metaFromItem(item) })
  )
  assert.equal(models[0].contextWindow, 1_000_000)
  assert.equal(models[0].maxOutput, 128_000)
  assert.equal(models[0].vision, true)
  assert.equal(models[1].contextWindow, 128_000)
})

test('catalogFor: يطابق الرابطين ويتجاهل الشرطة الأخيرة وحالة الأحرف', () => {
  assert.equal(catalogFor('https://opencode.ai/inference/go/v1/'), OPENCODE_GO)
  assert.equal(catalogFor('HTTPS://CODECRAFTAPI.COM/V1'), CODECRAFT)
  assert.equal(catalogFor('https://api.openai.com/v1'), undefined)
})

test('mergeModelLists: يضيف الجديد ويحدّث البيانات ويحذف كتالوجياً اختفى', () => {
  const current = [
    { id: 'a', tools: true, vision: false, contextWindow: 1, maxOutput: 64_000, origin: 'catalog' },
    { id: 'gone', tools: true, vision: false, contextWindow: 1, maxOutput: 64_000, origin: 'catalog' },
    { id: 'mine', tools: true, vision: false, contextWindow: 1, maxOutput: 64_000, origin: 'manual' }
  ]
  const incoming = [
    { id: 'a', tools: true, vision: true, contextWindow: 999, maxOutput: 128_000 },
    { id: 'b', tools: true, vision: false, contextWindow: 2, maxOutput: 64_000 }
  ]
  const next = mergeModelLists(current, incoming)
  const ids = next.map((m) => m.id)
  assert.deepEqual(ids, ['a', 'b', 'mine'])
  assert.equal(next[0].contextWindow, 999)
  assert.equal(next[0].vision, true)
  assert.equal(next[0].origin, 'catalog')
  assert.equal(next[2].origin, 'manual')
  assert.equal(ids.includes('gone'), false)
})

test('mergeModelLists: النموذج اليدوي الموجود حيّاً يأخذ بياناته الحيّة', () => {
  const current = [{ id: 'mine', tools: true, vision: false, contextWindow: 1, maxOutput: 64_000, origin: 'manual' }]
  const incoming = [{ id: 'mine', tools: true, vision: true, contextWindow: 500, maxOutput: 32_000 }]
  const next = mergeModelLists(current, incoming)
  assert.equal(next.length, 1)
  assert.equal(next[0].contextWindow, 500)
  assert.equal(next[0].origin, 'catalog')
})
