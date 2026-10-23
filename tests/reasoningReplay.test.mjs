import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toAnthropic, toOpenAi } from '../src/main/providers/llm.ts'
import { newAnthropicState, reduceAnthropic, anthropicBlocks } from '../src/main/providers/anthropicParse.ts'

test('ط±ط³ط§ظ„ط© ظ…ط³ط§ط¹ط¯ ظپظٹظ‡ط§ طھظپظƒظٹط± ظˆط§ط³طھط¯ط¹ط§ط، ط£ط¯ط§ط© طھط¹ظٹط¯ reasoning_content ظ„ظ„ظ…ط²ظˆظ‘ط¯', () => {
  const out = toOpenAi('sys', [
    { role: 'user', content: [{ type: 'text', text: 'ط§ظ‚ط±ط£ ط§ظ„ظ…ظ„ظپ' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'ط£ط­طھط§ط¬ ظ‚ط±ط§ط،ط© package.json' },
        { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'package.json' } }
      ]
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{}' }] }
  ], false)
  const assistant = out.find((m) => m.role === 'assistant')
  assert.equal(assistant.reasoning_content, 'ط£ط­طھط§ط¬ ظ‚ط±ط§ط،ط© package.json')
  assert.equal(assistant.tool_calls[0].id, 'call_1')
})

test('ط±ط³ط§ظ„ط© ظ…ط³ط§ط¹ط¯ ظ†طµظٹط© ط¨ظ„ط§ ط£ط¯ظˆط§طھ ظ„ط§ طھط­ظ…ظ„ reasoning_content', () => {
  const out = toOpenAi('sys', [
    { role: 'assistant', content: [{ type: 'thinking', text: 'طھظپظƒظٹط±' }, { type: 'text', text: 'طھظ…' }] }
  ], false)
  const assistant = out.find((m) => m.role === 'assistant')
  assert.equal(assistant.content, 'طھظ…')
  assert.equal('reasoning_content' in assistant, false)
})

test('ط±ط³ط§ظ„ط© ظ…ط³ط§ط¹ط¯ ط¨ط£ط¯ظˆط§طھ ط¨ظ„ط§ طھظپظƒظٹط± ظ„ط§ طھط¶ظٹظپ reasoning_content', () => {
  const out = toOpenAi('sys', [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'grep', input: { pattern: 'x' } }] }
  ], false)
  const assistant = out.find((m) => m.role === 'assistant')
  assert.equal('reasoning_content' in assistant, false)
  assert.equal(assistant.tool_calls.length, 1)
})

test('Anthropic: التقاط التوقيع (signature_delta) مع كتلة التفكير', () => {
  const st = newAnthropicState()
  const noop = () => {}
  reduceAnthropic(st, { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, noop, noop)
  reduceAnthropic(st, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'أفكّر' } }, noop, noop)
  reduceAnthropic(st, { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG123' } }, noop, noop)
  assert.deepEqual(anthropicBlocks(st)[0], { type: 'thinking', text: 'أفكّر', signature: 'SIG123' })
})

test('Anthropic: كتلة التفكير الموقّعة تُعاد قبل tool_use في رسالة المساعد', () => {
  const out = toAnthropic([
    {
      role: 'assistant',
      content: [
        { type: 'thinking', text: 'أحتاج الملف', signature: 'SIG123' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a' } }
      ]
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] }
  ], false)
  assert.deepEqual(out[0].content[0], { type: 'thinking', thinking: 'أحتاج الملف', signature: 'SIG123' })
  assert.equal(out[0].content[1].type, 'tool_use')
})

test('Anthropic: كتلة تفكير بلا توقيع لا تُعاد (لا تُرسل كتلة غير صالحة)', () => {
  const out = toAnthropic([
    { role: 'assistant', content: [{ type: 'thinking', text: 'بلا توقيع' }, { type: 'text', text: 'رد' }] }
  ], false)
  assert.deepEqual(out[0].content, [{ type: 'text', text: 'رد' }])
})

