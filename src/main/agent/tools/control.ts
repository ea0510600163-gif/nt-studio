import type { Phase, PlanStep, ToolResult, ToolSpec } from '../types'
import { truncate } from '../types'
import { readPackageJson } from './fs-scan'
import { execCommand } from './exec'

/**
 * أدوات التحكّم.
 *
 * finish هي الطريقة الوحيدة التي ينهي بها الوكيل المهمة — تمنع الوكيل من
 * التوقّف في منتصف عمل. ask_user توقف التنفيذ وتنتظر ردًا حقيقيًا.
 */

export const controlTools: ToolSpec[] = [
  {
    name: 'update_plan',
    category: 'control',
    description:
      'Publish or update the step-by-step plan. Call this early for any multi-step task so the user sees the route. Keep titles short and in the user\'s language. Mark progress as you complete steps.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short step title' },
              status: { type: 'string', enum: ['pending', 'active', 'done', 'failed'] },
            },
            required: ['title', 'status'],
          },
          description: 'The full plan, always complete from the beginning',
        },
        note: { type: 'string', description: 'Optional one-line explanation of what changed' },
      },
      required: ['steps'],
    },
    async execute(args, t): Promise<ToolResult> {
      const raw = Array.isArray(args.steps) ? args.steps : []
      const steps: PlanStep[] = raw.map((s, i) => {
        const rec = s as { title?: unknown; status?: unknown }
        const status = String(rec.status ?? 'pending')
        return {
          index: i + 1,
          title: String(rec.title ?? `خطوة ${i + 1}`).slice(0, 120),
          status: (['pending', 'active', 'done', 'failed'] as const).includes(status as PlanStep['status'])
            ? (status as PlanStep['status'])
            : 'pending',
        }
      })
      t.emit({ type: 'plan', steps })
      const note = args.note ? `\n${String(args.note).slice(0, 300)}` : ''
      return {
        ok: true,
        text: `Plan updated (${steps.length} steps).${note}`,
        ui: `خطة: ${steps.filter((s) => s.status === 'done').length}/${steps.length}`,
      }
    },
  },

  {
    name: 'finish',
    category: 'control',
    description: `Declare the task COMPLETE. Call this only after you verified the result works. Summarise honestly: what was built, how it was verified, what is not done.`,
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '2-5 lines in the user language: what was built and how it was verified' },
        verified: {
          type: 'boolean',
          description: 'true only if you actually ran/inspected the result and saw it work',
        },
        caveats: { type: 'string', description: 'Anything not finished or uncertain. Empty string if none.' },
      },
      required: ['summary', 'verified'],
    },
    async execute(args, t): Promise<ToolResult> {
      const summary = String(args.summary ?? '').trim()
      const verified = args.verified === true
      const caveats = String(args.causes ?? args.caveats ?? '').trim()
      if (!summary) throw new Error('summary is required')

      t.emit({ type: 'status', phase: 'done' })
      return {
        ok: true,
        text: JSON.stringify({ finished: true, verified, summary, caveats }),
        ui: verified ? 'اكتمل · مُتحقَّق' : 'اكتمل',
      }
    },
  },

  {
    name: 'ask_user',
    category: 'control',
    description: `Ask the user a question and WAIT for the real answer. Use only when genuinely blocked by ambiguity that guessing wrong would waste significant work. Never use it for confirmation of work already requested.`,
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One clear question' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional suggested answers' },
      },
      required: ['question'],
    },
    async execute(args, t): Promise<ToolResult> {
      const question = String(args.question ?? '').trim()
      if (!question) throw new Error('question is required')
      const options = Array.isArray(args.options) ? args.options.map((o) => String(o)).filter(Boolean) : []
      t.emit({ type: 'done', reason: 'needs-input' })
      return {
        ok: true,
        text: JSON.stringify({
          needsInput: true,
          question,
          options,
          waiting: true,
        }),
        ui: 'بانتظار ردّك',
      }
    },
  },

  {
    name: 'report',
    category: 'control',
    description:
      'Send a progress note to the user mid-task ("now checking X", "found a bug and fixing it"). Use at meaningful moments, not after every action.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'One line in the user language' },
        phase: {
          type: 'string',
          enum: ['thinking', 'tool', 'installing', 'starting', 'inspecting', 'fixing'],
        },
      },
      required: ['message'],
    },
    async execute(args, t): Promise<ToolResult> {
      const message = String(args.message ?? '').trim()
      const phase = (args.phase ? String(args.phase) : 'thinking') as Phase
      t.emit({ type: 'status', phase, detail: message })
      return { ok: true, text: 'Reported.', ui: message.slice(0, 60) }
    },
  },

  {
    name: 'run_tests',
    category: 'control',
    description:
      'Run the project test suite if one exists (vitest/jest/npm test). Returns pass/fail counts and failures. Use before declaring done.',
    inputSchema: {
      type: 'object',
      properties: { timeoutMs: { type: 'number' } },
    },
    async execute(args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const pkg = await readPackageJson(root)
      const script = pkg?.scripts?.test
      if (!script) return { ok: true, text: 'No test script defined in package.json.', ui: 'لا اختبارات' }

      const timeoutMs = Math.min(Number(args.timeoutMs ?? 180_000) || 180_000, 600_000)
      t.emit({ type: 'status', phase: 'inspecting', detail: 'تشغيل الاختبارات' })
      const out = await execCommand(`npm test --silent`, root, timeoutMs, t)
      return {
        ok: out.code === 0,
        text: `exit: ${out.code}\n${truncate(out.output, 10_000)}`,
        ui: out.code === 0 ? 'الاختبارات ناجحة' : `الاختبارات فشلت (${out.code})`,
      }
    },
  },
]