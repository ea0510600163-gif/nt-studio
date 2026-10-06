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
  type ClassifiedError,
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

/** مُدخل `settle` — ما يحدّد الحدث الطرفي المُبثّ. */
interface SettleInput {
  reason: FinishReason
  summary?: string
  verified?: boolean
  error?: string
}

const DEFAULTS = {
  maxSteps: 40,
  maxTokens: 400_000,
  maxDurationMs: 30 * 60_000,
}

/** نص النتيجة البديل للنداءات التي لم تُنفَّذ (إعادة تخطيط / إيقاف). */
const SKIPPED_RESULT = 'لم تُنفَّذ هذه الأداة — أُعيدت صياغة الخطوة. اقرأ state المشروع ثم نفّذ نهجًا مختلفًا.'

export async function runAgent(ctx: AppContext, opts: RunOptions): Promise<RunResult> {
  const started = Date.now()
  const maxSteps = opts.maxSteps ?? DEFAULTS.maxSteps
  const maxTokens = opts.maxTokens ?? DEFAULTS.maxTokens
  const maxDurationMs = opts.maxDurationMs ?? DEFAULTS.maxDurationMs

  const record = findProvider(ctx, opts.providerId)
  if (!record) throw new Error('المزوّد غير موجود')
  const apiKey = decryptKeyOf(ctx, record)
  const model = buildModel(record, apiKey, opts.modelId)

  /**
   * مانع تكرار الحدث الطرفي.
   *
   * `loop.ts` هو المصدر الوحيد لأحداث `done`/`failed` — نُسقط أي حدث طرفي
   * تحرّكه الأدوات نفسها (مثل `ask_user`) حتى لا تصل الواجهة حدثَّينِ نهاية،
   * ونتأكّد أن كل مخرج من الحلقة يبثّ واحدًا فقط مهما كان عدد مخارجها.
   */
  let terminalSent = false
  const emit = (event: AgentEvent): void => {
    if (event.type === 'done' || event.type === 'failed') {
      if (terminalSent) return
      terminalSent = true
    }
    opts.emit(event)
  }
  const emitFromTool = (event: AgentEvent): void => {
    if (event.type === 'done' || event.type === 'failed') return
    opts.emit(event)
  }

  const toolContext: ToolContext = {
    ctx,
    projectRoot: opts.projectRoot,
    sessionId: opts.sessionId,
    signal: opts.signal,
    emit: emitFromTool,
  }

  const tools: ToolSpec[] = toolCatalog()
  const toolSet: ToolSet = buildToolSet(tools)
  const tracker = new ErrorTracker()

  // خريطة: مُعرِّف النداء ← اسم الأداة. `ChatMessage` في recovery.ts لا يحمل
  // اسم الأداة، بينما جزء `tool-result` في ai@7 يشترط `toolName` — فنبنيه هنا.
  const toolNames = new Map<string, string>()

  // موجّه النظام أولًا، ثم **طلب المستخدم**. بدون الرسالة الثانية كانت
  // messages.slice(1) فارغة في أول دورة فيرمي SDK:
  // AI_InvalidPromptError: messages must not be empty — أي أن التطبيق لم يكن
  // يستطيع تنفيذ أي مهمة إطلاقًا.
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: opts.prompt },
  ]

  let inputTokens = 0
  let outputTokens = 0
  let steps = 0
  let lastText = ''
  let compacted = false
  let replanInjected = false

  const tokensUsed = (): number => inputTokens + outputTokens
  const elapsed = (): number => Date.now() - started

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal.aborted) return settle({ reason: 'aborted' })

    if (steps >= maxSteps) {
      emit({
        type: 'notice',
        level: 'warn',
        message: `وصلت للحد الأقصى للخطوات (${maxSteps}).`,
      })
      return settle({ reason: 'max-steps' })
    }
    if (tokensUsed() >= maxTokens) {
      emit({
        type: 'notice',
        level: 'warn',
        message: `وصلت لحد التوكنات (${Math.round(tokensUsed() / 1000)}k).`,
      })
      return settle({ reason: 'max-steps' })
    }
    if (elapsed() >= maxDurationMs) {
      emit({ type: 'notice', level: 'warn', message: 'انتهى الوقت المخصص للمهمة.' })
      return settle({ reason: 'max-steps' })
    }

    // تصغير السياق قبل الانتظار إذا تجاوز الحد
    const estimated = estimateTokens(JSON.stringify(messages))
    if (estimated > 120_000 && !compacted) {
      const compactedMessages = summarizeOldMessages(messages, 8)
      messages.length = 0
      messages.push(...compactedMessages)
      compacted = true
      emit({ type: 'notice', level: 'info', message: 'تم ضغط السجل للحفاظ على السياق.' })
    }

    emit({ type: 'status', phase: 'thinking' })

    let attempt = 0
    let result: Awaited<ReturnType<typeof generateText>> | null = null

    // إعادة المحاولة مع الاسترداد
    while (attempt < 4) {
      try {
        result = await generateText({
          model,
          system: messages[0]?.content,
          messages: toModelMessages(messages.slice(1), toolNames),
          tools: toolSet,
          // الأدوات بلا execute ⇒ التنفيذ الوحيد هو runOne أدناه
          stopWhen: stepCountIs(1),
          // ضغط السياق وإعادة التخطيط يحقنّان رسائل system وسط الحوار،
          // و ai@7 يرفضها افتراضيًا بـ AI_InvalidPromptError.
          allowSystemInMessages: true,
          // إعادة المحاولة اليدوية المصنّفة أعلاه هي المسؤولة الوحيدة؛
          // ترك maxRetries الافتراضي (2) يضاعف عدد الطلبات.
          maxRetries: 0,
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
        const classified = classifyModelError(e)
        emit({ type: 'notice', level: 'warn', message: `خطأ النموذج: ${classified.message.slice(0, 200)}` })

        if (!classified.retryable || attempt >= 3) {
          return settle({ reason: 'error', summary: '', verified: false, error: classified.message })
        }

        if (opts.signal.aborted) return settle({ reason: 'aborted' })

        if (classified.cls === 'context') {
          const compactedMessages = summarizeOldMessages(messages, 6)
          messages.length = 0
          messages.push(...compactedMessages)
          compacted = true
          emit({ type: 'notice', level: 'info', message: 'تجاوز السياق → ضغط السجل.' })
          attempt++
          continue
        }

        const wait = backoffMs(attempt)
        emit({ type: 'notice', level: 'info', message: `إعادة محاولة ${attempt + 1}/3 بعد ${wait}ms…` })
        await sleep(wait, opts.signal)
        attempt++
      }
    }

    if (!result) return settle({ reason: 'error', summary: '', verified: false, error: 'no response' })
    steps++

    const text = typeof result.text === 'string' ? result.text : ''
    if (text.trim()) {
      lastText = text
      emit({ type: 'text', delta: text })
    }

    // تنفيذ الأدوات
    const calls = result.toolCalls ?? []
    if (calls.length === 0) {
      return settle({ reason: 'stop', summary: text || lastText })
    }

    // رسالة المساعد تحمل نصّها ونداءاتها معًا. الصيغة القديمة
    // (`content: string` + `toolCalls`) ليست ModelMessage صالحة في ai@7.
    messages.push({
      role: 'assistant',
      content: text,
      toolCalls: calls.map((c) => ({
        id: c.toolCallId,
        name: c.toolName,
        args: JSON.stringify(c.input ?? {}),
      })),
    })
    for (const c of calls) toolNames.set(c.toolCallId, c.toolName)

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
          emit({ type: 'tool_start', callId: call.toolCallId, name: call.toolName, args: call.input as Record<string, unknown> })
          try {
            const res = await runOne(tools, call.toolName, call.input as Record<string, unknown>, toolContext)
            tracker.recordCall(call.toolName, call.input, res.ok)
            emit({
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
            emit({ type: 'tool_end', callId: call.toolCallId, name: call.toolName, ok: false, summary: msg.slice(0, 160), ms: Date.now() - start })
            return { call, res: { ok: false, text: `ERROR: ${msg}` }, ms: Date.now() - start }
          }
        }),
      )
      for (const { call, res } of results) {
        messages.push({ role: 'tool', toolCallId: call.toolCallId, content: res.text })
        const terminal = terminalFromTool(call.toolName, res.text)
        if (terminal) return settle(terminal)
      }
    }

    // الكتابة/التنفيذ بالتسلسل
    for (let i = 0; i < serial.length; i++) {
      const call = serial[i]
      if (!call) continue
      if (opts.signal.aborted) return settle({ reason: 'aborted' })
      const start = Date.now()
      emit({ type: 'tool_start', callId: call.toolCallId, name: call.toolName, args: call.input as Record<string, unknown> })

      if (tracker.isStuck() && tracker.strategy() !== 'retry') {
        const strategy = tracker.strategy()
        if (strategy === 'ask_user') {
          return settle({ reason: 'needs-input', summary: tracker.stuckMessage() })
        }
        if (strategy === 'replan' && !replanInjected) {
          replanInjected = true
          // نُغلق كل النداءات المعلّقة بنتيجة بديلة: المزوّد يرفض رسالة
          // فيها tool_call بلا tool-result مقابل. ونُرسل tool_end لكلٍّ منها
          // حتى لا يبقى في الواجهة صفّ أدارة دائم.
          for (const skipped of serial.slice(i)) {
            emit({
              type: 'tool_end',
              callId: skipped.toolCallId,
              name: skipped.toolName,
              ok: false,
              summary: 'أُعيدت التخطيط — لم تُنفَّذ',
              ms: 0,
            })
            messages.push({ role: 'tool', toolCallId: skipped.toolCallId, content: SKIPPED_RESULT })
          }
          messages.push({
            role: 'system',
            content: `[REPLAN REQUIRED] ${tracker.stuckMessage()} اقرأ state المشروع من جديد، حدّث الخطة عبر update_plan، ثم نفّذ نهجًا مختلفًا كليًا.`,
          })
          emit({ type: 'notice', level: 'warn', message: 'إعادة تخطيط إجبارية — النهج السابق لم ينجح.' })
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

      emit({
        type: 'tool_end',
        callId: call.toolCallId,
        name: call.toolName,
        ok: res.ok,
        summary: res.ui ?? res.text.slice(0, 120),
        ms: Date.now() - start,
      })

      messages.push({ role: 'tool', toolCallId: call.toolCallId, content: res.text })
      const terminal = terminalFromTool(call.toolName, res.text)
      if (terminal) return settle(terminal)
    }
  }

  return settle({ reason: 'max-steps', summary: lastText })

  /* ------------------------------------------------------------------ */

  /**
   * المخرج الوحيد من الحلقة.
   *
   * يبني `RunResult` **ويبثّ الحدث الطرفي نفسه**، فيضمن واحدًا بالضبط:
   * `failed` عند `reason === 'error'`، و`done` في كل حالة أخرى. قبل هذا لم
   * يكن أي فرع يُبثّ شيئًا، فبقيت الواجهة تدور على "يفكّر" إلى الأبد.
   */
  function settle(input: SettleInput): RunResult {
    const summary = input.summary ?? lastText
    const verified = input.verified === true
    const result: RunResult = {
      ...base(input.reason),
      summary,
      verified,
      ...(input.error === undefined ? {} : { error: input.error }),
    }
    if (input.reason === 'error') {
      emit({ type: 'status', phase: 'error' })
      emit({ type: 'failed', message: input.error || summary || 'فشل التنفيذ' })
    } else {
      emit({ type: 'status', phase: 'done' })
      emit({ type: 'done', reason: input.reason, summary, verified })
    }
    return result
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

/**
 * `ChatMessage` شكلٌ داخلي بسيط (نص + بيانات نداءات) لأن `recovery.ts` يقرأه
 * هكذا. `generateText` يطلب `ModelMessage[]` صارمة، وهذه هي الجسر:
 * رسالة `tool` يجب أن يكون محتواها **مصفوفة** أجزاء `tool-result` لا نصًّا،
 * وكل جزء يشترط `toolName` الذي لا يحمله `ChatMessage`.
 */
function toModelMessages(transcript: ChatMessage[], toolNames: Map<string, string>): ModelMessage[] {
  const out: ModelMessage[] = []

  for (const m of transcript) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: m.content })
      continue
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
      > = []
      if (m.content.trim()) parts.push({ type: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        parts.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.name,
          input: parseArgs(tc.args),
        })
      }
      if (parts.length > 0) out.push({ role: 'assistant', content: parts })
      continue
    }
    if (!m.toolCallId) continue
    out.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: m.toolCallId,
          toolName: toolNames.get(m.toolCallId) ?? 'unknown',
          output: { type: 'text', value: m.content },
        },
      ],
    })
  }

  return out
}

function parseArgs(args: string): unknown {
  try {
    return JSON.parse(args) as unknown
  } catch {
    return {}
  }
}

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
    const classified = classifyError(e, statusOf(e))
    return {
      ok: false,
      text: `ERROR (${classified.cls}): ${msg}\nHint: ${classified.hint ?? 'صحّح المُدخلات أو جرّب نهجًا مختلفًا.'}`,
    }
  }
}

/** استخراج رمز HTTP من أخطاء الـ SDK حتى تُصنَّف 401/403/429/5xx بدقّة. */
function statusOf(e: unknown): number | null {
  const err = e as { statusCode?: unknown; response?: { status?: unknown } } | null
  if (typeof err?.statusCode === 'number') return err.statusCode
  if (typeof err?.response?.status === 'number') return err.response.status
  return null
}

/**
 * تصنيف خطأ النموذج للقرار فقط.
 *
 * `classifyError` يمرَّر بلا رمز HTTP فيتمنّع عن تمييز 401 من 5xx، والأخطر أن
 * `AI_InvalidPromptError` (خطأ مُدخلات لا يُصلَحه التكرار إطلاقًا) يقع في
 * الافتراضي `transient` ⇒ أربع محاولات و~7 ثوانٍ backoff قبل الفشل.
 * لذلك نمرّر الرمز، ونقصر إعادة المحاولة على أخطاء الاتصال/الخدمة وحدها.
 */
function classifyModelError(e: unknown): ClassifiedError {
  const base = classifyError(e, statusOf(e))
  if (!isRetryableSdkError(e)) {
    return { ...base, cls: base.cls === 'context' ? 'context' : 'logic', retryable: false }
  }
  return base
}

/** أخطاء الـ SDK التي تستحق إعادة المحاولة: نداء شبكة أو خدمة فقط. */
function isRetryableSdkError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? ''
  if (name === 'AI_APICallError') return true
  // أي خطأ SDK آخر (رسالة غير صالحة، أداة غير موجودة، مُدخل أداة غير صالح)
  // خطأ في صيغة الطلب لا في الخدمة — إعادة المحاولة تعيد الطلب نفسه حرفيًا.
  return !name.startsWith('AI_')
}

/** الأدوات التي تُنهي التكرار (finish / ask_user) ⇒ تُترجم إلى حدث طرفي. */
function terminalFromTool(name: string, text: string): SettleInput | null {
  if (name === 'finish') {
    try {
      const parsed = JSON.parse(text) as { summary?: string; verified?: boolean; caveats?: string }
      const caveat = parsed.caveats ? `\n\nملاحظات: ${parsed.caveats}` : ''
      return {
        reason: 'stop',
        summary: `${parsed.summary ?? ''}${caveat}`,
        verified: parsed.verified === true,
      }
    } catch {
      return { reason: 'stop', summary: text, verified: false }
    }
  }
  if (name === 'ask_user') {
    try {
      const parsed = JSON.parse(text) as { question?: string; options?: string[] }
      const optsText = parsed.options?.length ? `\n\nالخيارات: ${parsed.options.join(' · ')}` : ''
      return { reason: 'needs-input', summary: `${parsed.question ?? ''}${optsText}`, verified: false }
    } catch {
      return { reason: 'needs-input', summary: text, verified: false }
    }
  }
  return null
}

function findProvider(ctx: AppContext, id: string): ProviderRecord | undefined {
  return (ctx.state.get().providers as ProviderRecord[]).find((r) => r.id === id)
}

export type { PlanStep }