import { app } from 'electron'
import { join } from 'path'
import { send } from '../bus'
import { deleteSkill, ensureSkillsDir, getSkill, listSkills, saveSkill } from '../agent/skills'
import { Tool, fail, ok, schema } from './types'

export const skillsDir = () => ensureSkillsDir(join(app.getPath('userData'), 'skills'))

export const skillTools: Tool[] = [
  {
    name: 'skill_read',
    parallel: true,
    description: 'Read one domain guide by id from the skills folder (returns its full markdown content).',
    schema: schema({ id: { type: 'string', description: 'Skill id (file name without .md)' } }, ['id']),
    async run(i) {
      const dir = skillsDir()
      const id = String(i.id ?? '').trim().toLowerCase()
      const s = getSkill(dir, id)
      if (!s) {
        const ids = listSkills(dir).map((x) => x.id)
        return fail(`مهارة غير موجودة: "${id}". المتاح: ${ids.join(', ') || '(لا مهارات بعد)'}\nالمجلد: ${dir}`)
      }
      return ok(`# Skill: ${s.id} — ${s.label}\n${s.content}`)
    }
  },
  {
    name: 'skill_list',
    parallel: true,
    description: 'List all skills available in the skills folder.',
    schema: schema({}),
    async run() {
      const dir = skillsDir()
      const skills = listSkills(dir)
      if (!skills.length) return ok(`لا مهارات بعد — المجلد: ${dir}`)
      return ok(`${skills.map((s) => `- ${s.id} (${s.label}): ${s.description}`).join('\n')}\n\nالمجلد: ${dir}`)
    }
  },
  {
    name: 'skill_save',
    phase: 'acting',
    description: 'Create or update a reusable skill in the application skills library so the user and agent can use it anytime.',
    schema: schema(
      {
        id: { type: 'string', description: 'English kebab-case skill identifier (e.g. "cyber-ui-design")' },
        label: { type: 'string', description: 'Display title of the skill (e.g. "تصميم واجهات هندسية فاخرة")' },
        description: { type: 'string', description: 'Concise 1-line summary of what the skill does' },
        content: { type: 'string', description: 'Full markdown guide/instructions of the skill' }
      },
      ['id', 'label', 'description', 'content']
    ),
    async run(i) {
      const dir = skillsDir()
      const saved = saveSkill(dir, {
        id: String(i.id ?? ''),
        label: String(i.label ?? ''),
        description: String(i.description ?? ''),
        content: String(i.content ?? '')
      })
      send('skills:changed', null)
      return ok(`✓ حُفظت المهارة في التطبيق: ${saved.label} (${saved.id})\nالمسار: ${join(dir, `${saved.id}.md`)}`)
    }
  },
  {
    name: 'skill_delete',
    phase: 'acting',
    description: 'Delete a skill by id from the application skills library.',
    schema: schema({ id: { type: 'string', description: 'Skill id to remove' } }, ['id']),
    async run(i) {
      const dir = skillsDir()
      const id = String(i.id ?? '').trim()
      const removed = deleteSkill(dir, id)
      if (!removed) return fail(`لم يُعثر على مهارة بالمعرّف "${id}".`)
      send('skills:changed', null)
      return ok(`✓ حُذفت المهارة: ${id}`)
    }
  }
]
