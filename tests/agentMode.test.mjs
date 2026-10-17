import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_TOOL_NAMES, selectModeTools } from '../src/main/tools/agentTools.ts'
import { AGENT_CORE } from '../src/main/agent/agentPrompt.ts'

/** وحدات وضع الـ Agent النقية — بلا استيرادات وقت التشغيل، فلا تنحيات لازمة. */

const fake = (name) => ({ name })

test('studio تُرجع القائمة كما هي (نفس المرجع)', () => {
  const all = [fake('run_command'), fake('web_open')]
  assert.equal(selectModeTools('studio', all), all)
})

test('agent تُبقي أدوات المتصفح والنشر فقط', () => {
  const out = selectModeTools(
    'agent',
    ['web_open', 'browser_nav', 'browser_snapshot', 'browser_click', 'browser_upload', 'web_search', 'ask_user', 'todo_write'].map(fake)
  ).map((t) => t.name)
  assert.deepEqual(out, ['web_open', 'browser_nav', 'browser_snapshot', 'browser_click', 'browser_upload', 'web_search', 'ask_user', 'todo_write'])
})

test('agent تستبعد أدوات البرمجة والجهاز', () => {
  const out = selectModeTools(
    'agent',
    ['run_command', 'write_file', 'read_file', 'create_project', 'open_project', 'memory_write', 'web_open'].map(fake)
  ).map((t) => t.name)
  assert.deepEqual(out, ['web_open'])
})

test('اسم في القائمة بلا أداة مسجلة يُتجاهل بصمت', () => {
  const out = selectModeTools('agent', [fake('web_open')]).map((t) => t.name)
  assert.deepEqual(out, ['web_open'])
})

test('AGENT_TOOL_NAMES تحوي أساسيات النشر', () => {
  for (const n of ['web_open', 'browser_nav', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_upload', 'browser_screenshot', 'ask_user', 'todo_write']) {
    assert.ok(AGENT_TOOL_NAMES.has(n), `${n} في القائمة`)
  }
  for (const n of ['run_command', 'write_file', 'read_file', 'create_project', 'open_project']) {
    assert.ok(!AGENT_TOOL_NAMES.has(n), `${n} مستبعد`)
  }
})

test('AGENT_CORE: مشغّل متصفح لا مبرمج', () => {
  assert.match(AGENT_CORE, /browser operator/)
  assert.match(AGENT_CORE, /browser_upload/)
  assert.match(AGENT_CORE, /ask_user/)
  assert.match(AGENT_CORE, /NEVER log out/)
  assert.match(AGENT_CORE, /browser-only/)
  assert.doesNotMatch(AGENT_CORE, /run_command/)
  assert.doesNotMatch(AGENT_CORE, /write_file/)
})
