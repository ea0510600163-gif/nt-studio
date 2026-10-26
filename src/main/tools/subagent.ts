import { send } from '../bus'
import { FALLBACK_ATTEMPTS, LIMITS, PRIMARY_ATTEMPTS, idleMsForAttempt } from '../config'
import { log } from '../logger'
import { callLlm } from '../providers/llm'
import { addCost } from '../providers/cost'
import { opencodeSessionKey } from '../providers/opencode/headers'
import { withRetry } from '../providers/retry'
import { Block, LlmError, Msg } from '../providers/types'
import { resolveModel } from '../store/providers'
import { abortError, abortable, clip, errMsg, isAbort } from '../util'
import { getSession } from '../agent/session'
import { getTool, toSchemas } from './registry'
import { Tool, fail, ok, schema } from './types'

const EXPLORE_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob',
  'grep',
  'system_info',
  'list_projects',
  'memory_read',
  'web_search',
  'web_fetch',
  'browser_snapshot',
  'browser_console',
  'browser_audit',
  'skill_list',
  'skill_read',
  'worktree_list',
  'list_processes',
  'read_process_output'
])

const EXECUTE_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'delete_path',
  'move_path',
  'make_dir',
  'list_dir',
  'glob',
  'grep',
  'run_command',
  'read_process_output',
  'send_process_input',
  'stop_process',
  'list_processes',
  'system_info',
  'free_port',
  'web_search',
  'web_fetch',
  'preview_open',
  'preview_reload',
  'browser_snapshot',
  'browser_screenshot',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_wait',
  'browser_console',
  'browser_eval',
  'browser_audit',
  'visual_check',
  'checkpoint',
  'memory_read',
  'memory_write',
  'skill_save',
  'skill_read',
  'skill_list'
])

const EXPLORE_PROMPT = `أنت وكيل استكشاف (Explore Sub-Agent) داخل NT Studio: أدواتك للقراءة والبحث فقط — ملفات، بحث في المحتوى، فحص النظام، الويب. تعيد للوكيل الرئيسي تقريراً منظماً يضم المسارات الدقيقة وأرقام الأسطر والخلاصة والنقاط المهمة.`

const EXECUTE_PROMPT = `أنت وكيل تنفيذ (Execute Sub-Agent) داخل NT Studio: تملك أدوات الملفات والأوامر والتحقق، وتُسلّم للوكيل الرئيسي ملخصاً بما أُنجز فعلاً والمسارات التي عدّلتها وما ثبت عمله.`

function shortArg(input: any): string {
  if (!input || typeof input !== 'object') return ''
  const v = input.path ?? input.command ?? input.pattern ?? input.query ?? input.url ?? input.target ?? input.section ?? ''
  const s = String(v).trim()
  return s.length > 65 ? s.slice(0, 65) + '…' : s
}

export const subagentTools: Tool[] = [
  {
    name: 'spawn_agent',
    parallel: true,
    phase: 'acting',
    description:
      'Spawn an autonomous specialized sub-agent ("explore" for fast deep codebase/system/web investigation, or "execute" for focused implementation, commands, and verification). Multiple spawn_agent calls in a single turn run in parallel.',
    schema: schema(
      {
        agent: {
          type: 'string',
          enum: ['explore', 'execute'],
          description: 'Sub-agent type: "explore" (discovery, search, analysis) or "execute" (coding, file edits, shell commands, verification)'
        },
        title: {
          type: 'string',
          description: 'Short clear title of the sub-agent mission displayed live in the UI'
        },
        prompt: {
          type: 'string',
          description: 'Complete instructions, target paths, and expected outcome for the sub-agent'
        }
      },
      ['agent', 'title', 'prompt']
    ),
    async run(i, ctx) {
      const kind = i.agent === 'execute' ? 'execute' : 'explore'
      const title = String(i.title || (kind === 'explore' ? 'استكشاف وتحليل' : 'تنفيذ المهمة')).trim()
      const taskPrompt = String(i.prompt || '').trim()
      if (!taskPrompt) return fail('حقل prompt مطلوب لتوجيه الوكيل الفرعي.')

      const settings = ctx.settings()
      const primary = resolveModel(settings.defaultModel)
      if (!primary) return fail('لا يوجد نموذج متاح لتشغيل الوكيل الفرعي.')
      const fallback = resolveModel(settings.fallbackModel)

      const allowedSet = kind === 'explore' ? EXPLORE_TOOLS : EXECUTE_TOOLS
      const allSchemas = toSchemas(
        Array.from(allowedSet)
          .map((n) => getTool(n))
          .filter((t): t is Tool => !!t)
      )

      const sys = `${kind === 'explore' ? EXPLORE_PROMPT : EXECUTE_PROMPT}\n\n# ENVIRONMENT\nWorking directory: ${ctx.cwd()}\nWorkspace root: ${settings.workspaceRoot}`
      const messages: Msg[] = [{ role: 'user', content: [{ type: 'text', text: taskPrompt }] }]
      const trace: string[] = []
      const maxSteps = kind === 'explore' ? 15 : 25
      const sessionKey = opencodeSessionKey(primary.provider.id, ctx.project()?.id ?? null)

      const owner = getSession(ctx.sessionId)
      const child = owner?.linkChild()
      const sig = child?.signal ?? ctx.signal

      const emitProgress = (statusLine?: string) => {
        if (!ctx.callId) return
        const lines = [...trace]
        if (statusLine) lines.push(statusLine)
        send('agent:event', {
          t: 'tool_progress',
          sessionId: ctx.sessionId,
          callId: ctx.callId,
          output: lines.join('\n')
        })
      }

      emitProgress(`⚡ بدأ ${kind === 'explore' ? 'وكيل الاستكشاف' : 'وكيل التنفيذ'}: ${title}`)

      let finalReport = ''
      try {
        for (let step = 1; step <= maxSteps; step++) {
          if (sig.aborted) throw abortError()

          let target = primary
          const callStep = async (t: typeof primary, maxAttempts: number) => {
            const r = await withRetry(
              async (attempt) =>
                callLlm(
                  {
                    system: sys,
                    messages,
                    tools: allSchemas,
                    target: t,
                    signal: sig,
                    maxTokens: Math.min(settings.maxOutputTokens, t.model.maxOutput ?? 32_000),
                    sessionId: sessionKey,
                    idleMs: idleMsForAttempt(attempt),
                    connectMs: LIMITS.llmConnectMs
                  },
                  { onText: () => {}, onThinking: () => {} }
                ),
              {
                signal: sig,
                maxAttempts,
                onRetry: ({ attempt }) => emitProgress(`↻ إعادة المحاولة (${attempt}/${maxAttempts})…`)
              }
            )
            if (owner) addCost(owner, r.usage, t.model.cost)
            return r
          }

          let res
          try {
            res = await callStep(target, PRIMARY_ATTEMPTS)
          } catch (e) {
            if (!isAbort(e) && e instanceof LlmError && fallback && fallback.model.id !== target.model.id) {
              target = fallback
              res = await callStep(target, FALLBACK_ATTEMPTS)
            } else throw e
          }

          const uses = res.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
          const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
          const think = res.content.map((b) => (b.type === 'thinking' ? b.text : '')).join('').trim()

          if (!uses.length) {
            finalReport = text || think || 'أُنجزت المهمة.'
            break
          }

          messages.push({ role: 'assistant', content: res.content })

          const results = new Map<string, { content: string; isError?: boolean }>()
          const runSubTool = async (u: Extract<Block, { type: 'tool_use' }>) => {
            const tool = getTool(u.name)
            const arg = shortArg(u.input)
            emitProgress(`▸ ${u.name}${arg ? ` (${arg})` : ''} …`)
            if (!tool || !allowedSet.has(u.name)) {
              trace.push(`✗ ${u.name}: أداة غير متاحة لهذا الوكيل`)
              results.set(u.id, { content: `الأداة ${u.name} غير متاحة.`, isError: true })
              return
            }
            const t0 = Date.now()
            try {
              const r = await abortable(tool.run(u.input ?? {}, { ...ctx, callId: undefined, signal: sig }), sig)
              const ms = Date.now() - t0
              trace.push(`${r.isError ? '✗' : '✓'} ${u.name}${arg ? ` · ${arg}` : ''} (${ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`})`)
              emitProgress()
              results.set(u.id, { content: clip(r.content, 30_000), isError: r.isError })
            } catch (e) {
              if (isAbort(e)) throw e
              trace.push(`✗ ${u.name}: ${errMsg(e)}`)
              emitProgress()
              results.set(u.id, { content: `خطأ: ${errMsg(e)}`, isError: true })
            }
          }

          const allParallel = uses.every((u) => !!getTool(u.name)?.parallel)
          if (allParallel && uses.length > 1) {
            await Promise.all(uses.map(runSubTool))
          } else {
            for (const u of uses) {
              if (sig.aborted) throw abortError()
              await runSubTool(u)
            }
          }

          const resultBlocks: Block[] = uses.map((u) => {
            const r = results.get(u.id) ?? { content: 'لم تنفذ', isError: true }
            return { type: 'tool_result', tool_use_id: u.id, content: r.content, is_error: !!r.isError }
          })
          messages.push({ role: 'user', content: resultBlocks })
        }

        if (!finalReport) finalReport = 'استكمل الوكيل الفرعي خطواته.'
        const header = `═══ ${kind === 'explore' ? 'تقرير وكيل الاستكشاف' : 'تقرير وكيل التنفيذ'}: ${title} (${trace.length} عملية) ═══`
        const logSection = trace.length ? `\n--- سجل العمليات ---\n${trace.join('\n')}\n` : ''
        return ok(`${header}${logSection}\n--- النتيجة النهائية ---\n${finalReport}`)
      } catch (e) {
        if (isAbort(e)) return fail('أُوقف الوكيل الفرعي.')
        log.error(`فشل الوكيل الفرعي (${kind})`, errMsg(e))
        return fail(`تعذّر إكمال مهمة الوكيل الفرعي (${errMsg(e)}).\nما تم إنجازه:\n${trace.join('\n')}`)
      } finally {
        if (owner && child) owner.unlinkChild(child)
      }
    }
  }
]
