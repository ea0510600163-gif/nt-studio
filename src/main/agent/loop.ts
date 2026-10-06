import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'
import type { AppContext } from '../core/context'
import { decryptKeyOf } from '../core/providers'
import type { ProviderRecord } from '../../shared/providers'
import { buildModel } from '../core/providers'
import {
  ErrorTracker,
  backoffMs,
  classifyError,
  estimateTokens,
  sleep,
  summarizeOldMessages,
  type ChatMessage,
} from './recovery'
import { buildToolSet, toolCatalog } from './tools/index'
import { SYSTEM_PROMPT } from './prompt'
import type { AgentEvent, FinishReason, PlanStep, ToolContext, ToolSpec } from './types'

/**
 * محرك الوكيل.
 *
 * الحلقة: استدعاء النموذج ← تنفيذ الأدوات ← تغذية النتيجة ← تكرار.
 * على عكس "while(true)" البسيط، هنا:
 *  - ميزانيات (خطوات/توكنات/وقت) قابلة للإيقاف
 *  - استرداد مصنّف لكل خطأ (لا تكرار أعمى)
 *  - كشف تعطّل بسلّم تصعيد
 *  - تصغير سياق تلقائي عند التجاوز
 *  - أدوات قراءة متوازية وأدوات كتابة متسلسلة
 *  - لا يمكن الإنهاء إلا بـ finish أو ask_user
 */

export interface RunOptions {
  providerId: string
  modelId: string
  prompt: string
  projectRoot: string | null
  sessionId: string
  maxSteps?: number
  maxTokens?: number
  maxDurationMs?: number
  signal: AbortSignal
  emit: (event: AgentEvent) => void
}

export interface RunResult {
  reason: FinishReason
  summary: string
  verified: boolean
  steps: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  error?: string
}

const DEFAULTS = {
  maxSteps: 40,
  maxTokens: 400_000,
  maxDurationMs: 30 * 60_000,
}

export async function runAgent(ctx: AppContext, opts: RunOptions): Promise<RunResult> {
  const started = Date.now()
  const maxSteps = opts.maxSteps ?? DEFAULTS.maxSteps
  const maxTokens = opts.maxTokens ?? DEFAULTS.maxTokens
  const maxDurationMs = opts.maxDurationMs ?? DEFAULTS.maxDurationMs

  const record = findProvider(ctx, opts.providerId)
  if (!record) throw new Error('المزوّد غير موجود')
  const apiKey = decryptKeyOf(ctx, record)
  const model = buildModel(record, apiKey, opts.modelId)

  const toolContext: ToolContext = {
    ctx,
    projectRoot: opts.projectRoot,
    sessionId: opts.sessionId,
    signal: opts.signal,
    emit: opts.emit,
  }

  const tools: ToolSpec[] = toolCatalog()
  const toolSet: ToolSet = buildToolSet(tools, toolContext)
  const tracker = new ErrorTracker()

  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]

  let inputTokens = 0
  let outputTokens = 0
  let steps = 0
  let lastText = ''
  let compacted = false
  let replanInjected = false

  const tokensUsed = (): number => inputTokens + outputTokens
  const elapsed = (): number => Date.now() - started

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal.aborted) return finish('aborted')

    if (steps >= maxSteps) {
      opts.emit({
        type: 'notice',
        level: 'warn',
        message: `وصلت للحد الأقصى للخطوات (${maxSteps}).`,
      })
      return finish('max-steps')
    }
    if (tokensUsed() >= maxTokens) {
      opts.emit({
        type: 'notice',
        level: 'warn',
        message: `وصلت لحد التوكنات (${Math.round(tokensUsed() / 1000)}k).`,
      })
      return finish('max-steps')
    }
    if (elapsed() >= maxDurationMs) {
      opts.emit({ type: 'notice', level: 'warn', message: 'انتهى الوقت المخصص للمهمة.' })
      return finish('max-steps')
    }

    // تصغير السياق قبل الانتظار길 إذا تجاوز الحد
    const estimated = estimateTokens(JSON.stringify(messages))
    if (estimated > 120_000 && !compacted) {
      const compactedMessages = summarizeOldMessages(messages, 8)
      messages.length = 0
      messages.push(...compactedMessages)
      compacted = true
      opts.emit({ type: 'notice', level: 'info', message: 'تم ضغط السجل للحفاظ على السياق.' })
    }

    opts.emit({ type: 'status', phase: 'thinking' })

    let attempt = 0
    let result: Awaited<ReturnType<typeof generateText>> | null = null

    // إعادة المحاولة مع الاسترداد
    while (attempt < 4) {
      try {
        result = await generateText({
          model,
          system: messages[0]?.content,
          messages: messages.slice(1) as ModelMessage[],
          tools: toolSet,
          stopWhen: stepCountIs(1),
          abortSignal: opts.signal,
          onStepFinish: (s) => {
            const usage = s.usage
            if (usage) {
              inputTokens += usage.inputTokens ?? 0
              outputTokens += usage.outputTokens ?? 0
            }
          },
        })
        break
      } catch (e) {
        const classified = classifyError(e)
        opts.emit({ type: 'notice', level: 'warn', message: `خطأ النموذج: ${classified.message.slice(0, 200)}` })

        if (!classified.retryable || attempt >= 3) {
          return {
            ...base('error'),
            summary: '',
            verified: false,
            error: classified.message,
          }
        }

        if (classified.cls === 'context') {
          const compactedMessages = summarizeOldMessages(messages, 6)
          messages.length = 0
          messages.push(...compactedMessages)
          compacted = true
          opts.emit({ type: 'notice', level: 'info', message: 'تجاوز السياق → ضغط السجل.' })
          attempt++
          continue
        }

        const wait = backoffMs(attempt)
        opts.emit({ type: 'notice', level: 'info', message: `إعادة محاولة ${attempt + 1}/3 بعد ${wait}ms…` })
        await sleep(wait, opts.signal)
        attempt++
      }
    }

    if (!result) return { ...base('error'), summary: '', verified: false, error: 'no response' }
    steps++

    const text = typeof result.text === 'string' ? result.text : ''
    if (text.trim()) {
      lastText = text
      opts.emit({ type: 'text', delta: text })
      messages.push({ role: 'assistant', content: text })
    }

    // تنفيذ الأدوات
    const calls = result.toolCalls ?? []
    if (calls.length === 0) {
      return { ...base('stop'), summary: text || lastText, verified: false }
    }

    messages.push({
      role: 'assistant',
      content: text,
      toolCalls: calls.map((c) => ({ id: c.toolCallId, name: c.toolName, args: JSON.stringify(c.input) })),
    })

    const readOnly = calls.filter((c) => {
      const spec = tools.find((t) => t.name === c.toolName)
      return spec?.parallelSafe === true
    })
    const serial = calls.filter((c) => {
      const spec = tools.find((t) => t.name === c.toolName)
      return spec?.parallelSafe !== true
    })

    // القراءة بالتوازي
    if (readOnly.length > 0) {
      const results = await Promise.all(
        readOnly.map(async (call) => {
          const start = Date.now()
          opts.emit({ type: 'tool_start', callId: call.toolCallId, name: call.toolName, args: call.input as Record<string, unknown> })
          try {
            const res = await runOne(tools, call.toolName, call.input as Record<string, unknown>, toolContext)
            tracker.recordCall(call.toolName, call.input, res.ok)
            opts.emit({
              type: 'tool_end',
              callId: call.toolCallId,
              name: call.toolName,
              ok: res.ok,
              summary: res.ui ?? res.text.slice(0, 120),
              ms: Date.now() - start,
            })
            return { call, res, ms: Date.now() - start }
          } catch (e) {
            const msg = (e as Error).message
            tracker.recordCall(call.toolName, call.input, false, msg)
            opts.emit({ type: 'tool_end', callId: call.toolCallId, name: call.toolName, ok: false, summary: msg.slice(0, 160), ms: Date.now() - start })
            return { call, res: { ok: false, text: `ERROR: ${msg}` }, ms: Date.now() - start }
          }
        }),
      )
      for (const { call, res } of results) {
        messages.push({ role: 'tool', toolCallId: call.toolCallId, content: res.text })
        if (handled(call.toolName, res, opts.emit)) return specialFinish(call.toolName, res, base)
      }
    }

    // الكتابة/التنفيذ بالتسلسل
    for (const call of serial) {
      if (opts.signal.aborted) return finish('aborted')
      const start = Date.now()
      opts.emit({ type: 'tool_start', callId: call.toolCallId, name: call.toolName, args: call.input as Record<string, unknown> })

      if (tracker.isStuck() && tracker.strategy() !== 'retry') {
        const strategy = tracker.strategy()
        if (strategy === 'ask_user') {
          opts.emit({ type: 'done', reason: 'needs-input' })
          return { ...base('needs-input'), summary: tracker.stuckMessage(), verified: false }
        }
        if (strategy === 'replan' && !replanInjected) {
          replanInjected = true
          messages.push({
            role: 'system',
            content: `[REPLAN REQUIRED] ${tracker.stuckMessage()} اقرأ state المشروع من جديد، حدّث الخطة عبر update_plan، ثم نفّذ نهجًا مختلفًا كليًا.`,
          })
          opts.emit({ type: 'notice', level: 'warn', message: 'إعادة تخطيط إجبارية — النهج السابق لم ينجح.' })
          tracker.reset()
          break
        }
      }

      let res: { ok: boolean; text: string; ui?: string }
      try {
        res = await runOne(tools, call.toolName, call.input as Record<string, unknown>, toolContext)
        tracker.recordCall(call.toolName, call.input, res.ok)
      } catch (e) {
        const msg = (e as Error).message
        res = { ok: false, text: `ERROR: ${msg}` }
        tracker.recordCall(call.toolName, call.input, false, msg)
      }

      opts.emit({
        type: 'tool_end',
        callId: call.toolCallId,
        name: call.toolName,
        ok: res.ok,
        summary: res.ui ?? res.text.slice(0, 120),
        ms: Date.now() - start,
      })

      messages.push({ role: 'tool', toolCallId: call.toolCallId, content: res.text })
      if (handled(call.toolName, res, opts.emit)) return specialFinish(call.toolName, res, base)
    }
  }

  return { ...base('max-steps'), summary: lastText, verified: false }

  /* ------------------------------------------------------------------ */

  function finish(reason: FinishReason): RunResult {
    return { ...base(reason), summary: lastText, verified: false }
  }

  function base(reason: FinishReason): Omit<RunResult, 'summary' | 'verified'> {
    return {
      reason,
      steps,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
    }
  }
}

/* -------------------------------------------------------------------------- */

async function runOne(
  tools: ToolSpec[],
  name: string,
  args: Record<string, unknown>,
  toolContext: ToolContext,
): Promise<{ ok: boolean; text: string; ui?: string }> {
  const spec = tools.find((t) => t.name === name)
  if (!spec) return { ok: false, text: `Unknown tool: ${name}` }
  try {
    const res = await spec.execute(args, toolContext)
    return { ok: res.ok, text: res.text, ui: res.ui }
  } catch (e) {
    const msg = (e as Error).message
    const classified = classifyError(e)
    return {
      ok: false,
      text: `ERROR (${classified.cls}): ${msg}\nHint: ${classified.hint ?? 'صحّح المُدخلات أو جرّب نهجًا مختلفًا.'}`,
    }
  }
}

/** أدوات تُنهي التكرار (finish / ask_user). */
function handled(name: string, res: { ok: boolean; text: string }, emit: (e: AgentEvent) => void): boolean {
  if (name === 'finish') {
    emit({ type: 'status', phase: 'done' })
    return true
  }
  if (name === 'ask_user') {
    emit({ type: 'done', reason: 'needs-input' })
    return true
  }
  void res
  return false
}

function specialFinish(
  name: string,
  res: { ok: boolean; text: string },
  base: (reason: FinishReason) => Omit<RunResult, 'summary' | 'verified'>,
): RunResult {
  if (name === 'finish') {
    try {
      const parsed = JSON.parse(res.text) as { summary?: string; verified?: boolean; caveats?: string }
      const caveat = parsed.caveats ? `\n\nملاحظات: ${parsed.caveats}` : ''
      return {
        ...base('stop'),
        summary: `${parsed.summary ?? ''}${caveat}`,
        verified: parsed.verified === true,
      }
    } catch {
      return { ...base('stop'), summary: res.text, verified: false }
    }
  }
  try {
    const parsed = JSON.parse(res.text) as { question?: string; options?: string[] }
    const optsText = parsed.options?.length ? `\n\nالخيارات: ${parsed.options.join(' · ')}` : ''
    return { ...base('needs-input'), summary: `${parsed.question ?? ''}${optsText}`, verified: false }
  } catch {
    return { ...base('needs-input'), summary: res.text, verified: false }
  }
}

function findProvider(ctx: AppContext, id: string): ProviderRecord | undefined {
  return (ctx.state.get().providers as ProviderRecord[]).find((r) => r.id === id)
}

export type { PlanStep }