import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectModeTools } from '../src/main/tools/agentTools.ts'
import { AGENT_CORE } from '../src/main/agent/agentPrompt.ts'

/** وحدات وضع الـ Agent النقية (Computer-Use) — بلا استيرادات وقت التشغيل. */

const fake = (name) => ({ name })

test('الأدوات نفسها متاحة في الوضعين دون حجب — الوضع يحدد الموجّه والواجهة فقط', () => {
  const all = [fake('run_command'), fake('computer'), fake('edit_file'), fake('spawn_agent')]
  assert.equal(selectModeTools('studio', all), all)
  assert.equal(selectModeTools('agent', all), all)
})

test('AGENT_CORE: دليل تعريفي لتحكم الكمبيوتر', () => {
  assert.match(AGENT_CORE, /desktop operator/)
  assert.match(AGENT_CORE, /1:1/)
  assert.match(AGENT_CORE, /crosshair/)
  assert.match(AGENT_CORE, /inspect_ui/)
  assert.match(AGENT_CORE, /verify_file/)
  assert.match(AGENT_CORE, /desktop_app/)
  assert.match(AGENT_CORE, /progress/)
  assert.match(AGENT_CORE, /ask_user/)
  assert.match(AGENT_CORE, /ENVIRONMENT/)
})

test('حراسة الرؤية: لا قوانين ولا أمثلة تشغيلية ولا أرقام جهاز مصلّبة في الموجّه', () => {
  assert.doesNotMatch(AGENT_CORE, /THREE LAWS|THE THREE LAWS/)
  assert.doesNotMatch(AGENT_CORE, /Never wait|never wait/)
  assert.doesNotMatch(AGENT_CORE, /ONE turn|in ONE call whenever possible/)
  assert.doesNotMatch(AGENT_CORE, /1366x768|1024x768|1280x720/)
  assert.doesNotMatch(AGENT_CORE, /Arabic sentences|short Arabic steps/)
})
