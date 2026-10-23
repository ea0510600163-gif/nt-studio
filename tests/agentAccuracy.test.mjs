import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageDimensions } from '../src/main/tools/imageMeta.ts'
import { selectModeTools } from '../src/main/tools/agentTools.ts'
import { AGENT_CORE } from '../src/main/agent/agentPrompt.ts'
import { DEFAULT_SKILL_FILES, ensureSkillsDir, listSkills, saveSkill, deleteSkill } from '../src/main/agent/skills.ts'

test('أبعاد PNG تُقرأ من الترويسة', () => {
  const png = Buffer.alloc(32)
  png[0] = 0x89
  png[1] = 0x50
  png[2] = 0x4e
  png[3] = 0x47
  png.writeUInt32BE(1024, 16)
  png.writeUInt32BE(768, 20)
  const d = imageDimensions(png)
  assert.equal(d.w, 1024)
  assert.equal(d.h, 768)
  assert.equal(d.type, 'PNG')
})

test('أبعاد JPEG تُقرأ من marker SOF', () => {
  const jpg = Buffer.alloc(64)
  jpg[0] = 0xff
  jpg[1] = 0xd8
  jpg[2] = 0xff
  jpg[3] = 0xc0
  jpg.writeUInt16BE(16, 4)
  jpg.writeUInt16BE(600, 7)
  jpg.writeUInt16BE(800, 9)
  const d = imageDimensions(jpg)
  assert.equal(d.w, 800)
  assert.equal(d.h, 600)
  assert.equal(d.type, 'JPEG')
})

test('أدوات الإثبات والتحكم متاحة للنموذج في الوضعين', () => {
  const tools = ['verify_file', 'computer', 'desktop_app', 'edit_file', 'grep', 'skill_save'].map((name) => ({ name }))
  assert.equal(selectModeTools('agent', tools), tools)
  assert.equal(selectModeTools('studio', tools), tools)
})

test('الموجّه يعرّف الأدوات الميدانية بدل أن يأمر', () => {
  assert.match(AGENT_CORE, /verify_file/)
  assert.match(AGENT_CORE, /target:/)
  assert.match(AGENT_CORE, /inspect_ui/)
  assert.match(AGENT_CORE, /1:1/)
  assert.match(AGENT_CORE, /crosshair/)
})

test('نظام المهارات: يتضمّن مهارة صانع المهارات الافتراضية ويدعم الإنشاء والحذف', () => {
  assert.ok(DEFAULT_SKILL_FILES['skill-creator'])
  const dir = mkdtempSync(join(tmpdir(), 'nt-skills-'))
  try {
    ensureSkillsDir(dir)
    const list = listSkills(dir)
    assert.ok(list.length >= 6)
    assert.equal(list[0].id, 'skill-creator')
    assert.match(list[0].label, /صانع المهارات/)

    const created = saveSkill(dir, {
      id: 'custom-pro',
      label: 'مهارة مخصصة',
      description: 'وصف المهارة المخصصة',
      content: 'محتوى المهارة التفصيلي'
    })
    assert.equal(created.id, 'custom-pro')
    assert.equal(listSkills(dir).some((s) => s.id === 'custom-pro'), true)
    assert.equal(deleteSkill(dir, 'custom-pro'), true)
    assert.equal(listSkills(dir).some((s) => s.id === 'custom-pro'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
