import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ToolResult, ToolSpec } from '../types'
import { truncate } from '../types'

/**
 * أدوات الذاكرة.
 *
 * الفكرة: الوكيل نسيج في كل طلب طويل. الذاكرة تحفظ القرارات (لا النتائج):
 * "لماذا اخترنا هذه الحزمة"، "ما القيد الذي اكتشفناه"، "المستخدم يريد Arabic RTL".
 * النتائج تُقرأ من الملفات دائمًا، والذاكرة توفّر إعادة الاشتقاق والتكرار.
 *
 * بنية المشروع:
 *   .agent/memory.json   ذاكرة المشروع (قرارات، تفضيلات، أخطاء متكررة)
 *   .agent/log.jsonl     سجل الأحداث (لاستئناف الجلسة)
 */

export interface ProjectMemory {
  facts: string[]
  decisions: string[]
  userPreferences: string[]
  gotchas: string[]
  updatedAt: number
}

const EMPTY: ProjectMemory = {
  facts: [],
  decisions: [],
  userPreferences: [],
  gotchas: [],
  updatedAt: 0,
}

const MAX_ITEMS = 40

async function memoryFile(root: string): Promise<string> {
  return path.join(root, '.agent', 'memory.json')
}

export async function readMemory(root: string): Promise<ProjectMemory> {
  try {
    const raw = await fs.readFile(await memoryFile(root), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectMemory>
    return {
      facts: parsed.facts ?? [],
      decisions: parsed.decisions ?? [],
      userPreferences: parsed.userPreferences ?? [],
      gotchas: parsed.gotchas ?? [],
      updatedAt: parsed.updatedAt ?? 0,
    }
  } catch {
    return { ...EMPTY }
  }
}

async function writeMemory(root: string, memory: ProjectMemory): Promise<void> {
  const file = await memoryFile(root)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const next: ProjectMemory = { ...memory, updatedAt: Date.now() }
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/** يضيف بندًا مع منع التكرار (نص متطابق) والحد الأقصى. */
function append(list: string[], value: string, max = MAX_ITEMS): string[] {
  const trimmed = value.trim().slice(0, 400)
  if (!trimmed) return list
  if (list.some((x) => x === trimmed)) return list
  const next = [...list, trimmed]
  return next.length > max ? next.slice(next.length - max) : next
}

export const memoryTools: ToolSpec[] = [
  {
    name: 'remember',
    category: 'memory',
    description: `Save durable knowledge about this project so future sessions skip re-discovery. Store DECISIONS and CONSTRAINTS, not file contents. Categories: fact, decision, preference, gotcha.`,
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['fact', 'decision', 'preference', 'gotcha'],
          description: 'fact=discovered reality, decision=why we chose X, preference=user taste, gotcha=trap to avoid',
        },
        content: { type: 'string', description: 'One concise sentence' },
      },
      required: ['category', 'content'],
    },
    async execute(args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const category = String(args.category)
      const content = String(args.content ?? '')
      const memory = await readMemory(root)

      const next: ProjectMemory = { ...memory }
      if (category === 'fact') next.facts = append(memory.facts, content)
      else if (category === 'decision') next.decisions = append(memory.decisions, content)
      else if (category === 'preference') next.userPreferences = append(memory.userPreferences, content)
      else next.gotchas = append(memory.gotchas, content)

      await writeMemory(root, next)
      const label =
        category === 'fact' ? 'حقيقة' : category === 'decision' ? 'قرار' : category === 'preference' ? 'تفضيل' : 'مِطبّ'
      return { ok: true, text: `Saved to project memory (${label}): ${content}`, ui: `ذاكرة: ${label}` }
    },
  },

  {
    name: 'recall',
    category: 'memory',
    parallelSafe: true,
    description: 'Read everything previously saved in this project memory. Call this at the start of work on an existing project.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const m = await readMemory(root)
      const sections: string[] = []
      if (m.decisions.length) sections.push(`DECISIONS:\n- ${m.decisions.join('\n- ')}`)
      if (m.facts.length) sections.push(`FACTS:\n- ${m.facts.join('\n- ')}`)
      if (m.userPreferences.length) sections.push(`USER PREFERENCES:\n- ${m.userPreferences.join('\n- ')}`)
      if (m.gotchas.length) sections.push(`GOTCHAS (avoid these):\n- ${m.gotchas.join('\n- ')}`)
      return {
        ok: true,
        text: sections.length ? sections.join('\n\n') : '(memory is empty — nothing learned yet)',
        ui: `ذاكرة: ${m.facts.length + m.decisions.length + m.gotchas.length} بند`,
      }
    },
  },

  {
    name: 'append_log',
    category: 'memory',
    description: 'Append a timestamped event to the project event log. Use to record milestones so a later session can reconstruct what happened.',
    inputSchema: {
      type: 'object',
      properties: { event: { type: 'string', description: 'Short event description' } },
      required: ['event'],
    },
    async execute(args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const file = path.join(root, '.agent', 'log.jsonl')
      await fs.mkdir(path.dirname(file), { recursive: true })
      const entry = JSON.stringify({ ts: Date.now(), event: String(args.event ?? ''), session: t.sessionId })
      await fs.appendFile(file, `${entry}\n`, 'utf8')
      return { ok: true, text: 'Logged.' }
    },
  },

  {
    name: 'read_log',
    category: 'memory',
    parallelSafe: true,
    description: 'Read recent project events (most recent last).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many recent entries. Default 40.' } },
    },
    async execute(args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const file = path.join(root, '.agent', 'log.jsonl')
      try {
        const raw = await fs.readFile(file, 'utf8')
        const lines = raw.trim().split('\n').filter(Boolean)
        const limit = Math.min(Number(args.limit ?? 40) || 40, 200)
        return { ok: true, text: truncate(lines.slice(-limit).join('\n'), 8_000) }
      } catch {
        return { ok: true, text: '(no log entries)' }
      }
    },
  },
]

