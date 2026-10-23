import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CODECRAFT, CODECRAFT_BASE_URL, catalogIssues } from '../src/shared/catalogs.ts'
import { PRESETS } from '../src/shared/models.ts'

const LIVE_IDS = [
  'gemini-3.7-flash', 'deepseek-v4-flash-0731', 'seed-2.1-pro', 'glm-5.2', 'qwen3.8-27b',
  'claude-opus-4.8', 'grok-4.5', 'claude-opus-5.5', 'claude-opus-5', 'claude-mythos-preview',
  'claude-sonnet-5', 'gpt-5.5', 'grok-4.6', 'seed-2.1-turbo', 'claude-fable-5.1',
  'muse-spark-1.1', 'kimi-k3', 'claude-opus-4.7', 'kimi-k2.6', 'gemma-2-2b',
  'qwen3.8-max', 'gpt-5.6-terra', 'gpt-5.6-sol', 'claude-fable-5', 'gpt-5.6-luna',
  'claude-opus-4.6', 'gpt-5.5-pro', 'deepseek-v4-pro-max', 'glm-5.3', 'deepseek-v4-pro-0813',
  'qwen3.7-max', 'gemini-3.6-flash', 'gemini-3.1-pro'
]

test('كتالوج CodeCraft: مطابق لقائمة GET /v1/models الحيّة', () => {
  assert.equal(CODECRAFT_BASE_URL, 'https://codecraftapi.com/v1')
  assert.equal(CODECRAFT.models.length, LIVE_IDS.length)
  assert.deepEqual([...CODECRAFT.models.map((m) => m.id)].sort(), [...LIVE_IDS].sort())
})

test('كتالوج CodeCraft: لا تناقض داخلي', () => {
  assert.deepEqual(catalogIssues(CODECRAFT), [])
})

test('كتالوج CodeCraft: نمط نداء واحد openai لأن المزوّد لا يخدم /v1/responses', () => {
  assert.equal(CODECRAFT.apiStyle, 'openai')
  for (const m of CODECRAFT.models) assert.equal(m.apiStyle, 'openai', `${m.id}: نمط غير openai`)
})

test('كتالوج CodeCraft: الحدود الموثّقة تأتي من كتالوج المزوّد ثم من أصغر قيمة بين المستضيفين', () => {
  const at = (id) => CODECRAFT.models.find((m) => m.id === id)
  assert.equal(at('claude-opus-5.5').contextWindow, 1_000_000)
  assert.equal(at('claude-opus-5.5').maxOutput, 128_000)
  assert.equal(at('gpt-5.5-pro').contextWindow, 1_050_000)
  assert.equal(at('grok-4.6').maxOutput, 32_768)
  assert.equal(at('kimi-k3').contextWindow, 1_000_000)
  assert.equal(at('qwen3.8-max').maxOutput, 131_072)
  assert.equal(at('glm-5.3').contextWindow, 1_000_000)
  assert.equal(at('gemma-2-2b').contextWindow, 8_192)
  assert.equal(at('gemma-2-2b').tools, false)
  assert.equal(at('seed-2.1-pro').contextWindow, 128_000)
})

test('كتالوج CodeCraft: الرؤية معلّمة حيث يقبل النموذج الصور', () => {
  const at = (id) => CODECRAFT.models.find((m) => m.id === id)
  for (const id of ['claude-opus-5.5', 'gpt-5.5', 'gemini-3.7-flash', 'qwen3.8-max', 'grok-4.6', 'kimi-k3', 'muse-spark-1.1'])
    assert.equal(at(id).vision, true, `${id} يرى الصور`)
  for (const id of ['glm-5.3', 'deepseek-v4-pro-0813', 'gemma-2-2b'])
    assert.equal(at(id).vision, false, `${id} بلا رؤية`)
})

test('CodeCraft حاضر في الإعدادات الجاهزة بنماذجه كاملة', () => {
  const preset = PRESETS.find((p) => p.baseUrl === CODECRAFT_BASE_URL)
  assert.ok(preset, 'لا يوجد إعداد جاهز لـ CodeCraft')
  assert.equal(preset.name, 'CodeCraft API')
  assert.equal(preset.apiStyle, 'openai')
  assert.equal(preset.models.length, CODECRAFT.models.length)
  assert.equal(preset.opencode, undefined)
})
