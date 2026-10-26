import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addCost, stepCost } from '../src/main/providers/cost.ts'
import { newAnthropicState, reduceAnthropic } from '../src/main/providers/anthropicParse.ts'

test('stepCost: الأسعار لكل مليون رمز — الإدخال والإخراج', () => {
  const c = { input: 0.15, output: 0.5 }
  assert.equal(stepCost({ input: 1_000_000, output: 100_000 }, c), 0.15 + 0.05)
  assert.equal(stepCost({ input: 1_000, output: 1 }, c), 0.00015 + 0.0000005)
})

test('stepCost: الكاش المقروء بسعره والكاش المكتوب بسعره', () => {
  const c = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
  const u = { input: 1000, output: 240, cachedRead: 55_000, cacheWrite: 500 }
  const expected = (1000 / 1e6) * 0.1 + (240 / 1e6) * 0.5 + (55_000 / 1e6) * 0.01 + (500 / 1e6) * 0.125
  assert.equal(stepCost(u, c), expected)
})

test('stepCost: كاش بلا سعر معلوم يُحسب بسعر الإدخال، والمجاني صفر، وبلا سعر undefined', () => {
  assert.ok(Math.abs(stepCost({ input: 1_000_000, cachedRead: 500_000 }, { input: 0.2, output: 1 }) - 0.3) < 1e-12)
  assert.equal(stepCost({ input: 5_000_000, output: 100_000 }, { input: 0, output: 0 }), 0)
  assert.equal(stepCost({ input: 1, output: 1 }, undefined), undefined)
})

test('addCost: يتراكم عبر النداءات مع تقريب إلى جزء من السنت', () => {
  const s = {}
  const c = { input: 0.15, output: 0.5 }
  addCost(s, { input: 1_000_000, output: 1_000_000 }, c)
  addCost(s, { input: 2_000_000, output: 0 }, c)
  assert.equal(s.cost, Math.round((0.65 + 0.3) * 1e6) / 1e6)
  const untouched = {}
  assert.equal(addCost(untouched, { input: 5, output: 5 }, undefined), undefined)
  assert.equal(untouched.cost, undefined)
})

test('anthropic: رسالة مفتتحة تحمل كاش المقروء والمكتوب مع الإدخال', () => {
  const st = newAnthropicState()
  reduceAnthropic(st, { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 55_000, cache_creation_input_tokens: 500 } } }, () => {})
  reduceAnthropic(st, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 240, cache_read_input_tokens: 80_000 } }, () => {})
  assert.deepEqual(st.usage, { input: 10, output: 240, cachedRead: 80_000, cacheWrite: 500 })
  const c = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
  assert.equal(stepCost(st.usage, c) > 0, true)
})
