import type { AppContext } from '../core/context'
import { buildModel } from '../core/providers'
import type { ProviderRecord } from '../../shared/providers'

/**
 * سجلّ الأخطاء والاسترداد.
 *
 * المنطق مأخوذ من الأنماط المتكرّرة في الأنوية الناضجة (Claude Code / Codex /
 * OpenHands): تصنيف الخطأ يحدّد الاستراتيجية. إعادة إرسال نفس الطلب بعد خطأ
 * دائمة هو إهدار توكنات لا إصلاح.
 *
 *   TRANSIENT (429/5xx/شبكة) → انتظار تصاعدي مع jitter  → إعادة المحاولة نفسها
 *   CONTEXT  (تجاوز النافذة)  → تصغير السياق فورًا        → إعادة المحاولة نفسها
 *   PERMANENT (401/403/400)    → لا إعادة                → передаيل للنموذج ليصحّح
 *   LOGIC     (خطأ في الأداة)  → لا إعادة                → ملاحظة تشرح للنموذج
 *   STUCK     (تكرار متطابق)   → تصعيد: بديل → إعادة تخطيط → سؤال المستخدم
 */

export type ErrorClass = 'transient' | 'context' | 'permanent' | 'logic' | 'stuck'

export interface ClassifiedError {
  cls: ErrorClass
  message: string
  status: number | null
  retryable: boolean
  hint?: string
}

export function classifyError(error: unknown, status?: number | null): ClassifiedError {
  const err = error as { message?: string; name?: string; cause?: { message?: string }; code?: string }
  const message = (err?.cause?.message ?? err?.message ?? String(error)).slice(0, 600)
  const lower = message.toLowerCase()
  const code: number = status ?? 0

  if (err?.name === 'AbortError') {
    return { cls: 'logic', message: 'aborted by user', status: status ?? null, retryable: false }
  }

  if (code === 429 || /rate.?limit|too many requests|quota|overloaded/.test(lower)) {
    return {
      cls: 'transient',
      message,
      status: status ?? null,
      retryable: true,
      hint: 'الخدمة مزدحمة. انتظر ثم أعد المحاولة.',
    }
  }

  if (code >= 500 || /econnreset|etimedout|econnrefused|socket hang up|network|fetch failed|terminated/.test(lower)) {
    return { cls: 'transient', message, status: status ?? null, retryable: true, hint: 'خطأ شبكة أو خادم مؤقت.' }
  }

  if (code === 400 && /context length|context_length|maximum context|too many tokens|reduce the length|prompt is too long|context_length_exceeded/.test(lower)) {
    return {
      cls: 'context',
      message,
      status: code,
      retryable: true,
      hint: 'تجاوز نافذة السياق — يجب تصغير السجل قبل المتابعة.',
    }
  }

  if (code === 401 || code === 403 || /invalid api key|unauthorized|forbidden|authentication/.test(lower)) {
    return {
      cls: 'permanent',
      message,
      status: code,
      retryable: false,
      hint: 'المفتاح أو الصلاحية مرفوضة — لا يمكن الإصلاح آليًا. أبلغ المستخدم.',
    }
  }

  if (code >= 400 && code < 500) {
    return {
      cls: 'permanent',
      message,
      status: code,
      retryable: false,
      hint: 'طلب مرفوض من المزوّد — راجع الصيغة أو اسم النموذج.',
    }
  }

  if (/not found|no such file|enoent|eisdir|permission denied|access is denied|invalid|missing/.test(lower)) {
    return { cls: 'logic', message, status: status ?? null, retryable: false }
  }

  return { cls: 'transient', message, status: status ?? null, retryable: true }
}

/** انتظار تصاعدي مع jitter — يمنع تكدّس الطلبات على خادم متعِب. */
export function backoffMs(attempt: number, base = 1000, cap = 20_000): number {
  const exponential = Math.min(base * 2 ** attempt, cap)
  const jitter = Math.random() * exponential * 0.3
  return Math.round(exponential + jitter)
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/* -------------------------------------------------------------------------- */
/* كشف التعطّل                                                                */
/* -------------------------------------------------------------------------- */

export interface ToolAttempt {
  name: string
  argsHash: string
  ok: boolean
  error: string
  at: number
}

export type RecoveryStrategy = 'retry' | 'alternative' | 'replan' | 'ask_user'

export class ErrorTracker {
  private history: ToolAttempt[] = []
  private stuckCount = 0

  constructor(
    private readonly windowSize = 10,
    private readonly stuckThreshold = 3,
  ) {}

  record(attempt: ToolAttempt): void {
    this.history.push(attempt)
    if (this.history.length > this.windowSize) this.history.shift()
  }

  private hash(args: unknown): string {
    return JSON.stringify(args ?? {}, Object.keys(args as object).sort()).slice(0, 200)
  }

  recordCall(name: string, args: unknown, ok: boolean, error = ''): void {
    this.record({ name, argsHash: this.hash(args), ok, error, at: Date.now() })
  }

  /** نفس الأداة + نفس الخطأ N مرات متتالية ⇒ تعطّل. */
  isStuck(): boolean {
    const recent = this.history.slice(-this.stuckThreshold)
    if (recent.length < this.stuckThreshold) return false

    const sameError = recent.every(
      (a) => !a.ok && a.error === recent[0]?.error && a.name === recent[0]?.name,
    )
    if (sameError && recent[0]?.error) return true

    // نفس المعطّل يتكرر عبر نافذة أوسع رغم نجاح خطوات بينهما
    const counts = new Map<string, number>()
    for (const a of this.history) {
      if (a.ok || !a.error) continue
      const key = `${a.name}::${a.error}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.values()].some((c) => c >= this.stuckThreshold)
  }

  /** سلّم تصعيد: بديل → إعادة تخطيط → سؤال المستخدم. */
  strategy(): RecoveryStrategy {
    if (!this.isStuck()) return 'alternative'
    this.stuckCount++
    if (this.stuckCount >= 3) return 'ask_user'
    if (this.stuckCount === 2) return 'replan'
    return 'alternative'
  }

  stuckMessage(): string {
    const last = this.history.at(-1)
    if (!last) return ''
    return [
      `الأداة "${last.name}" فشلت ${this.stuckThreshold} مرات متتالية بنفس الخطأ.`,
      `آخر خطأ: ${last.error.slice(0, 300)}`,
      'توقّف عن تكرار نفس المحاولة. اجمع معلومات جديدة (اقرأ ملفًا آخر، افحص أخطاء المتصفح، غيّر النهج كليًا) أو أعد التخطيط من الصفر.',
    ].join(' ')
  }

  recentErrors(): Array<{ name: string; error: string }> {
    return this.history.filter((h) => !h.ok).slice(-4).map((h) => ({ name: h.name, error: h.error.slice(0, 200) }))
  }

  reset(): void {
    this.history = []
    this.stuckCount = 0
  }
}

/* -------------------------------------------------------------------------- */
/* تصغير السياق                                                               */
/* -------------------------------------------------------------------------- */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; args: string }>
}

export function estimateTokens(text: string): number {
  // تقدير متحفّظ: ~3.5 حرف لكل توكن، مع حد أدنى
  return Math.ceil(text.length / 3.5)
}

/** يبني ملخّصًا نصيًا للرسائل القديمة بدل حذفها — المعلومة لا تضيع. */
export function summarizeOldMessages(messages: ChatMessage[], keepRecent: number): ChatMessage[] {
  if (messages.length <= keepRecent) return messages
  const head = messages[0]
  const tail = messages.slice(-keepRecent)
  const middle = messages.slice(1, -keepRecent)

  const lines: string[] = []
  const filesTouched: string[] = []
  const commands: string[] = []
  const toolCalls = new Map<string, number>()

  for (const m of middle) {
    if (m.role === 'tool') {
      const head40 = m.content.replace(/\s+/g, ' ').trim().slice(0, 160)
      lines.push(`  · ${m.role}: ${head40}`)
      continue
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        toolCalls.set(tc.name, (toolCalls.get(tc.name) ?? 0) + 1)
        if (tc.name === 'write_file' || tc.name === 'edit_file') filesTouched.push(tc.name)
        if (tc.name === 'run_command' || tc.name === 'install_dependencies') commands.push(tc.name)
      }
      continue
    }
    const short = m.content.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (short) lines.push(`  · ${m.role}: ${short}`)
  }

  const toolSummary = [...toolCalls.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}×${count}`)
    .join(', ')

  const digest: ChatMessage = {
    role: 'system',
    content: [
      '[CONTEXT COMPACTION] تم ضغط المحادثة السابقة للحفاظ على نافذة السياق. ما يلي ملخّص ما حدث:',
      ...lines.slice(-40),
      '',
      `Tools used: ${toolSummary || 'none'}`,
      `Files written/edited: ${filesTouched.length}`,
      `Commands run: ${commands.length}`,
      'Continue from here. Re-read any file you need exact contents from — the summary is not a substitute.',
    ].join('\n'),
  }

  return head ? [head, digest, ...tail] : [digest, ...tail]
}

/** يبني نموذج اللغة من المزوّد المحفوظ. */
export function resolveModel(ctx: AppContext, providerId: string | null, modelId: string | null) {
  if (!providerId || !modelId) {
    throw new Error('لم يتم اختيار مزوّد ونموذج. افتح شاشة المزوّدات أولًا.')
  }
  const records = ctx.state.get().providers as ProviderRecord[]
  const record = records.find((r) => r.id === providerId)
  if (!record) throw new Error('المزوّد المختار لم يعد موجودًا. اختر مزوّدًا صالحًا.')
  if (!record.models.includes(modelId)) {
    throw new Error(`النموذج "${modelId}" غير موجود ضمن نماذج هذا المزوّد.`)
  }
  return { record, model: buildModel(record, '', modelId) }
}

