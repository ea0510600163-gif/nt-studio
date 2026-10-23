import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { TodoItem } from '@shared/types'
import { db } from '../store/db'
import { checkpoint, createProject, findBySlug, listProjects, readAgentFile, writeTodoFile } from '../workspace/projects'
import { uid } from '../util'
import { Tool, fail, ok, schema } from './types'

export const globalMemory = () => db().get<{ prefs: Record<string, string> }>('kv', 'globalMemory') ?? { prefs: {} }

export const projectTools: Tool[] = [
  {
    name: 'create_project',
    description: 'Initialize a new isolated project in {workspace}/{slug} with .agent/ memory and a Git repository, and bind the session to it.',
    schema: schema(
      {
        name: { type: 'string', description: 'Display name of the project' },
        slug: { type: 'string', description: 'English kebab-case directory name' },
        description: { type: 'string', description: 'Concise summary of the project goal' },
        stack: { type: 'string', description: 'Selected technical stack' }
      },
      ['name', 'slug', 'description', 'stack']
    ),
    async run(i, ctx) {
      const { project, git } = await createProject({ name: i.name, slug: i.slug, description: i.description, stack: i.stack })
      ctx.bind(project)
      return ok(`أُنشئ المشروع: ${project.dir}\nGit: ${git ? 'مفعّل' : 'غير متاح'}\nجميع المسارات النسبية تبدأ الآن من مجلد المشروع.`)
    }
  },
  {
    name: 'open_project',
    description: 'Bind the session to an existing project by its slug and return its .agent/PROJECT.md and TODO.md.',
    schema: schema({ slug: { type: 'string', description: 'Existing project slug' } }, ['slug']),
    async run(i, ctx) {
      const p = findBySlug(String(i.slug))
      if (!p) return fail(`لا يوجد مشروع بهذا الاسم. المتاح: ${listProjects().map((x) => x.slug).join(', ') || 'لا شيء'}`)
      ctx.bind(p)
      return ok(`فُتح: ${p.dir}\n\n--- PROJECT.md ---\n${readAgentFile(p.dir, 'PROJECT.md')}\n--- TODO.md ---\n${readAgentFile(p.dir, 'TODO.md')}`)
    }
  },
  {
    name: 'list_projects',
    parallel: true,
    description: 'List all projects in the workspace with their slug, name, stack, and description.',
    schema: schema({}),
    async run() {
      const l = listProjects()
      return ok(l.length ? l.map((p) => `${p.slug} — ${p.name} (${p.stack}): ${p.description.slice(0, 100)}`).join('\n') : 'لا مشاريع بعد.')
    }
  },
  {
    name: 'todo_write',
    description: 'Update the active task plan. Each newly completed ("done") milestone automatically creates a Git checkpoint.',
    schema: schema(
      {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Task milestone description' },
              status: { type: 'string', enum: ['pending', 'doing', 'done', 'blocked'] }
            },
            required: ['text', 'status']
          }
        }
      },
      ['items']
    ),
    async run(i, ctx) {
      if (!Array.isArray(i.items) || i.items.length === 0)
        return fail('todo_write يحتاج قائمة عناصر غير فارغة، مثل: {"items":[{"text":"...","status":"doing"},{"text":"...","status":"pending"}]} — أرسل الخطة الكاملة في نداء واحد.')
      const cur = ctx.plan()
      const same = cur.length === i.items.length && i.items.every((x: TodoItem, k: number) => cur[k].text === x.text && cur[k].status === x.status)
      if (same)
        return fail('الخطة المُرسلة مطابقة للحالية بلا أي تغيير — لا تُعِد كتابتها. انتقل للتنفيذ، أو أرسل تعديلاً حقيقياً.')
      const prev = new Set<string>()
      const items: TodoItem[] = (i.items as { text: string; status: TodoItem['status'] }[]).map((x, k) => ({ id: String(k + 1), text: x.text, status: x.status }))
      const p = ctx.project()
      ctx.plan().filter((x) => x.status === 'done').forEach((x) => prev.add(x.text))
      ctx.setPlan(items)
      let cp = ''
      if (p) {
        writeTodoFile(p.dir, items)
        const newlyDone = items.filter((x) => x.status === 'done' && !prev.has(x.text))
        if (newlyDone.length) cp = await checkpoint(p.dir, `أُنجز: ${newlyDone[newlyDone.length - 1].text}`)
      }
      const done = items.filter((x) => x.status === 'done').length
      return ok(`الخطة محدّثة: ${done}/${items.length} منجز.${cp ? '\n' + cp : ''}`)
    }
  },
  {
    name: 'checkpoint',
    description: 'Create a Git commit restore point in the active project.',
    schema: schema({ message: { type: 'string', description: 'Commit message' } }, ['message']),
    async run(i, ctx) {
      const dir = ctx.project()?.dir ?? ctx.cwd()
      return ok(await checkpoint(dir, String(i.message)))
    }
  },
  {
    name: 'memory_read',
    parallel: true,
    description: 'Read persistent memory (scope="project" for .agent/ files, or scope="global" for user preferences).',
    schema: schema({ scope: { type: 'string', enum: ['project', 'global'], description: 'Memory scope' } }, ['scope']),
    async run(i, ctx) {
      if (i.scope === 'global') return ok(JSON.stringify(globalMemory().prefs, null, 2))
      const dir = ctx.project()?.dir ?? ctx.cwd()
      return ok(`--- PROJECT.md ---\n${readAgentFile(dir, 'PROJECT.md', 12000)}\n--- TODO.md ---\n${readAgentFile(dir, 'TODO.md')}\n--- memory.json ---\n${readAgentFile(dir, 'memory.json')}`)
    }
  },
  {
    name: 'memory_write',
    description: 'Store a persistent key-value fact in project memory (.agent/memory.json) or global user preferences.',
    schema: schema(
      {
        scope: { type: 'string', enum: ['project', 'global'], description: 'Memory scope' },
        key: { type: 'string', description: 'Fact key' },
        value: { type: 'string', description: 'Fact value' }
      },
      ['scope', 'key', 'value']
    ),
    async run(i, ctx) {
      if (i.scope === 'global') {
        const m = globalMemory()
        m.prefs[String(i.key)] = String(i.value)
        db().put('kv', 'globalMemory', m)
        return ok('حُفظ في الذاكرة العامة.')
      }
      const dir = ctx.project()?.dir ?? ctx.cwd()
      const agentDir = join(dir, '.agent')
      mkdirSync(agentDir, { recursive: true })
      const f = join(agentDir, 'memory.json')
      let j: { facts: Record<string, string> } = { facts: {} }
      try { if (existsSync(f)) j = JSON.parse(readFileSync(f, 'utf8')) } catch {}
      j.facts[String(i.key)] = String(i.value)
      writeFileSync(f, JSON.stringify(j, null, 2))
      return ok('حُفظ في ذاكرة المشروع.')
    }
  },
  {
    name: 'ask_user',
    phase: 'waiting',
    description: 'Ask the user a clarifying question with optional multiple-choice answers and wait for their reply.',
    schema: schema(
      {
        question: { type: 'string', description: 'Question to ask the user' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional 2–4 quick-reply choices' }
      },
      ['question']
    ),
    async run(i, ctx) {
      const a = await ctx.ask(String(i.question), Array.isArray(i.options) ? i.options.slice(0, 4).map(String) : undefined)
      return ok(`إجابة المستخدم: ${a || '(لا إجابة)'}`)
    }
  }
]

export { uid }
