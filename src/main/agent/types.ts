import type { AppContext } from '../core/context'

/**
 * طبقة الأدوات: العقود والمحتوى المشترك.
 *
 * كل أداة: (1) تتحقق من مُدخلاتها، (2) تُنفَّذ داخل العملية الرئيسية،
 * (3) تُعيد نصًا مضغوطًا صالحًا كملاحظة للنموذج. لا أداة تكتب في الواجهة.
 */

export type ToolCategory = 'fs' | 'exec' | 'project' | 'preview' | 'memory' | 'control'

export type Phase =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'installing'
  | 'starting'
  | 'inspecting'
  | 'fixing'
  | 'done'
  | 'error'

export type FinishReason = 'stop' | 'max-steps' | 'aborted' | 'error' | 'needs-input'

export interface PlanStep {
  index: number
  title: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

export type AgentEvent =
  | { type: 'status'; phase: Phase; detail?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; callId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; callId: string; name: string; ok: boolean; summary: string; ms: number }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'plan'; steps: PlanStep[] }
  /**
   * حدث طرفي — يُبثّ مرة واحدة بالضبط على كل مخرج من الحلقة.
   * `summary` و`verified` حقول اختيارية أُضيفت ليحمل الحدثُ الخلاصةَ نفسها
   * التي تُخزَّن في سجل الجلسة، دون أن تُكسر أي مستهلك للحدث.
   */
  | { type: 'done'; reason: FinishReason; summary?: string; verified?: boolean }
  | { type: 'failed'; message: string }

export interface ToolResult {
  /** نص يُعاد إلى النموذج كملاحظة. */
  text: string
  /** ملاحظة قصيرة مرئية في الواجهة. */
  ui?: string
  ok: boolean
}

export interface ToolContext {
  ctx: AppContext
  /** جذر المشروع الحالي (يُحدَّث فورًا عند create_project). */
  projectRoot: string | null
  sessionId: string
  signal: AbortSignal
  emit: (event: AgentEvent) => void
}

export interface ToolSpec {
  name: string
  category: ToolCategory
  description: string
  /** مخطط JSON للمُدخل — يُرسل للنموذج. */
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>, t: ToolContext) => Promise<ToolResult>
  /** أدوات القراءة يمكن تشغيلها بالتوازي. */
  parallelSafe?: boolean
  /** عملية قد تمسح شيئًا جوهريًا. */
  dangerous?: boolean
}

/* -------------------------------------------------------------------------- */
/* أدوات مساعدة مشتركة                                                         */
/* -------------------------------------------------------------------------- */

const MAX_TEXT = 20_000

/** يقصّ النص من المنتصف لا من النهاية — النهاية فيها الخطأ عادةً. */
export function truncate(text: string, max = MAX_TEXT): string {
  if (text.length <= max) return text
  const half = Math.floor(max / 2)
  return `${text.slice(0, half)}\n...[truncated ${text.length - max} chars]...\n${text.slice(-half)}`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function lineCount(text: string): number {
  return text.split('\n').length
}