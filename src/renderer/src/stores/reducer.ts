import type { AgentEvent, AgentPhase, PlanStep } from '../../../shared/api'

/**
 * منطق انتقالات حالة مساحة العمل — نقيّ بالكامل.
 *
 * لماذا ملف منفصل؟ لأن `ChatPanel.tsx` كان يحتوي منطق الحالة مدمجًا مع React،
 * فكان:
 *  - `running: true` في `finally` ⇒ أي فشل يجمّد الواجهة إلى الأبد،
 *  - `done:needs-input` غير idempotent ⇒ السؤال الحقيقي يُستبدل بنص بديل،
 *  - `phaseDetail` لا يُمسح أبدًا ⇒ يبقى رابط قديم في الترويسة.
 *
 * كل انتقال هنا دالة نقية `(state, action, now) => state` بلا React وبلا zustand
 * وبلا `Date.now()` داخلي (الوقت يُمرَّر)، فيمكن اختبارها كلها.
 *
 * عقد الدفتر (انظر `AgentEvent` في src/shared/api.ts):
 *  - لا يُسقط أي حدث: نوع غير معروف يُسجَّل في السجل كـ notice مع عدّاد.
 *  - الأحداث الطرفية idempotent: التكرار لا يُفسد الحالة.
 *  - `running: true` لا يحدث في أي مسار فشل إطلاقًا. الطريقان الوحيدان هما
 *    `run/started` (طلب جديد) و `run/resumed` (عملية الرئيسية قالت إن الوكيل يعمل
 *    بعد إعادة تركيب اللوحة). لا `finally` في الواجهة يضبطه.
 */

/* -------------------------------------------------------------------------- */
/* الأنواع                                                                      */
/* -------------------------------------------------------------------------- */

export type ToolStatus = 'running' | 'done' | 'error'
export type NoticeLevel = 'info' | 'warn' | 'error'
export type ViewportName = 'full' | 'laptop' | 'tablet' | 'mobile'

export interface ToolActivity {
  /** معرّف داخلي من عدّاد تصاعدي — لا يعتمد على طول المصفوفة، فلا تصادم عند 120. */
  id: string
  /** معرّف الاستدعاء كما بُثّ من العملية الرئيسية — قد يكون '' اليوم. */
  callId: string
  name: string
  /** مُدخلات مقلّصة (بلا محتوى الملفات أو الأسرار) لعرضها للمستخدم. */
  args: Record<string, unknown>
  /** وصف عربي قصير للمُدخلات — يخبر المستخدم أي ملف يُكتب فعلًا. */
  argHint: string
  status: ToolStatus
  summary: string
  ms: number
  at: number
}

export interface ChatLine {
  id: string
  role: 'user' | 'agent'
  text: string
  at: number
}

export interface Notice {
  id: string
  level: NoticeLevel
  message: string
  at: number
}

export interface ConsoleIssue {
  id: string
  level: string
  text: string
  line?: number
}

export interface Question {
  text: string
  options: string[]
  /** true عندما لا يحمل الحدث سؤالًا حقيقيًا فنعرض نصًا بديلًا. */
  synthetic: boolean
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

/** سجل مفتوح لـ tool_start بلا callId — نحتاجه لمطابقة tool_end المقابل. */
interface OpenStart {
  name: string
  key: string
  rowId: string | null
}

export interface RunState {
  lines: ChatLine[]
  /** الكتلة التي تُكتب الآن. تُغسل (تصير سطرًا) عند أول حدث غير نصّي. */
  streamingText: string
  tools: ToolActivity[]
  plan: PlanStep[]
  notices: Notice[]

  running: boolean
  /** استدعاء agent:run لم يُجب بعد — يمنع الإرسال المزدوج. */
  dispatching: boolean
  /** زر الإيقاف مضغوط ولم يُجب agent:stop بعد. */
  stopping: boolean
  /** وصل حدث طرفي لهذا التشغيل — يجعل تكرارEventsreshid idempotent. */
  settled: boolean

  phase: AgentPhase
  phaseDetail: string
  awaitingQuestion: Question | null
  /** آخر خطأ مرئي — يظهر داخل اللوحة لا في السجل المطوي فقط. */
  lastError: string | null
  usage: Usage | null
  previewUrl: string | null
  /** أخطاء كونسول الصفحة المعروضة في المعاينة. */
  consoleIssues: ConsoleIssue[]

  lineSeq: number
  noticeSeq: number
  toolSeq: number
  /** عدّاد الأحداث غير المعروفة — دليل على أن العقد لا يزال يتوسّع. */
  unknownEvents: number
  openStarts: OpenStart[]
}

/* -------------------------------------------------------------------------- */
/* الحدود                                                                      */
/* -------------------------------------------------------------------------- */

export const MAX_TOOLS = 120
export const MAX_NOTICES = 200
export const MAX_LINES = 300
export const MAX_OPEN_STARTS = 60
export const MAX_NOTICE_LEN = 4_000
export const MAX_ARG_VALUE = 400
export const MAX_SUMMARY_LEN = 240

/** أقل مستطيل مقبول لمعاينة native. أصغر ⇒ لا نرسل ونضمن ألّا يغطي المحادثة. */
export const MIN_PREVIEW_SIDE = 24

/* -------------------------------------------------------------------------- */
/* أدوات قراءة دفاعية                                                           */
/* -------------------------------------------------------------------------- */

/** يقرأ حقلًا كنص مهما كان شكله — لا يرمي على قيمة غريبة من العملية الرئيسية. */
export function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function rec(event: unknown): Record<string, unknown> {
  return event && typeof event === 'object' ? (event as Record<string, unknown>) : {}
}

const PHASES: readonly AgentPhase[] = [
  'idle',
  'thinking',
  'tool',
  'installing',
  'starting',
  'inspecting',
  'fixing',
  'done',
  'error',
]

export function isPhase(value: unknown): value is AgentPhase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value)
}

const LEVELS: readonly NoticeLevel[] = ['info', 'warn', 'error']

export function isLevel(value: unknown): value is NoticeLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqy=><~]/g

/** يزيل رموز ANSI التي تصل خامًا من exec.ts وdevserver (FORCE_COLOR=1). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function tidy(text: string, max: number): string {
  return stripAnsi(text)
    .replace(/\r/g, '')
    .replace(/\s+$/, '')
    .slice(0, max)
}

/* -------------------------------------------------------------------------- */
/* حالة أولية                                                                   */
/* -------------------------------------------------------------------------- */

export function initialRunState(): RunState {
  return {
    lines: [],
    streamingText: '',
    tools: [],
    plan: [],
    notices: [],
    running: false,
    dispatching: false,
    stopping: false,
    settled: true,
    phase: 'idle',
    phaseDetail: '',
    awaitingQuestion: null,
    lastError: null,
    usage: null,
    previewUrl: null,
    consoleIssues: [],
    lineSeq: 0,
    noticeSeq: 0,
    toolSeq: 0,
    unknownEvents: 0,
    openStarts: [],
  }
}

/* -------------------------------------------------------------------------- */
/* أدوات مُدخلات الأدوات                                                        */
/* -------------------------------------------------------------------------- */

/** تحويل ثابت (مفاتيح مرتّبة) حتى لا يختلف البصمة بسبب ترتيب الكائن. */
function stableStringify(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return ''
  if (depth > 3) return '…'
  if (Array.isArray(value)) return `[${value.slice(0, 5).map((v) => stableStringify(v, depth + 1)).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys
      .slice(0, 24)
      .map((k) => `${k}:${stableStringify((value as Record<string, unknown>)[k], depth + 1)}`)
      .join(',')}}`
  }
  if (typeof value === 'string') return value.slice(0, 120)
  return String(value)
}

/** بصمة الأداة + مُدخلاتها — تُستعمل لمطابقة بثّ مكرّر بلا callId. */
export function toolKey(name: string, args: unknown): string {
  return `${name}|${stableStringify(args)}`
}

const HIDDEN_ARG = /^(content|contents|apiKey|key|token|secret|password|text|body|script|source|patch)$/i

const HINT_KEYS = [
  'path',
  'file_path',
  'filePath',
  'source',
  'destination',
  'target',
  'dir',
  'cwd',
  'command',
  'url',
  'query',
  'pattern',
  'selector',
  'question',
  'name',
  'port',
  'title',
]

/** وصف قصير لمُدخلات الأداة: «أي ملف؟ أي أمر؟» — أهم ما يراه المستخدم أثناء البناء. */
export function describeArgs(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ''
  const source = args as Record<string, unknown>
  const parts: string[] = []
  for (const key of HINT_KEYS) {
    const value = source[key]
    if (value === undefined || value === null || typeof value === 'object') continue
    const text = tidy(stableStringify(value), 80)
    if (!text) continue
    parts.push(`${key}=${text}`)
    if (parts.length === 2) break
  }
  if (parts.length === 0) {
    const keys = Object.keys(source)
    for (let i = 0; i < keys.length && parts.length < 2; i++) {
      const key = keys[i]
      if (key === undefined || HIDDEN_ARG.test(key)) continue
      const value = source[key]
      if (value === undefined || value === null || typeof value === 'object') continue
      const text = tidy(stableStringify(value), 60)
      if (!text) continue
      parts.push(`${key}=${text}`)
    }
  }
  return parts.join(' · ')
}

/** مُدخلات مقلّصة للعرض: بلا محتويات ملفات ولا أسرار، وبطول محدود. */
export function compactArgs(args: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) return out
  let budget = 4_000
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (HIDDEN_ARG.test(key)) continue
    if (budget <= 0) break
    if (typeof value === 'string') {
      const text = value.slice(0, Math.min(MAX_ARG_VALUE, budget))
      out[key] = text.length < value.length ? `${text}…` : text
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    } else if (Array.isArray(value)) {
      out[key] = `${value.length} عنصر`
    } else if (value === null || value === undefined) {
      /* تجاهُل */
    } else {
      out[key] = '…'
    }
    budget -= 200
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* استخراج رابط المعاينة                                                        */
/* -------------------------------------------------------------------------- */

const LOOPBACK_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'`\\<>)]*)?/i

/**
 * يستخرج أول رابط loopback من نص.
 * devserver.ts يبثّ `{type:'status',phase:'starting',detail:url}` ثم مخرجات
 * الخادم كـ notices، فيكفي البحث في detail والمخرجات — لا نحتاج قناة جديدة.
 */
export function extractLoopbackUrl(text: string): string | null {
  const m = LOOPBACK_RE.exec(stripAnsi(text))
  const found = m?.[0]
  if (!found) return null
  return found.replace(/[.,;:)\]]+$/, '').replace(/\/+$/, '') || null
}

/* -------------------------------------------------------------------------- */
/* مساعدات الحالة                                                               */
/* -------------------------------------------------------------------------- */

function addNotices(s: RunState, level: NoticeLevel, raw: unknown, now: number): Notice[] {
  const message = tidy(str(raw), MAX_NOTICE_LEN)
  if (!message) return s.notices
  const last = s.notices[s.notices.length - 1]
  // devserver/exec يبثّات نفس الشريحة مرتين أحيانًا — لا نضخّم السجل
  if (last && last.level === level && last.message === message) return s.notices
  const notice: Notice = { id: `n${s.noticeSeq}`, level, message, at: now }
  return [...s.notices, notice].slice(-MAX_NOTICES)
}

function withNotice(s: RunState, level: NoticeLevel, raw: unknown, now: number): RunState {
  const notices = addNotices(s, level, raw, now)
  return notices === s.notices ? s : { ...s, notices, noticeSeq: s.noticeSeq + 1 }
}

function pushLine(s: RunState, role: ChatLine['role'], text: string, now: number): RunState {
  const body = tidy(text, 20_000)
  if (!body) return s
  const line: ChatLine = { id: `l${s.lineSeq}`, role, text: body, at: now }
  return {
    ...s,
    lines: [...s.lines, line].slice(-MAX_LINES),
    lineSeq: s.lineSeq + 1,
  }
}

/** يفرّغ الكتلة الحالية في السجل — يفصل الأدوار فلا تصير فقرة واحدة متّصلة. */
function flush(s: RunState, now: number): RunState {
  if (!s.streamingText.trim()) return s.streamingText === '' ? s : { ...s, streamingText: '' }
  return pushLine({ ...s, streamingText: '' }, 'agent', s.streamingText, now)
}

function sanitizePlan(steps: unknown): PlanStep[] {
  if (!Array.isArray(steps)) return []
  return steps.slice(0, 40).map((raw, i) => {
    const r = rec(raw)
    const status = str(r.status)
    return {
      index: num(r.index, i + 1) || i + 1,
      title: tidy(str(r.title) || `خطوة ${i + 1}`, 160),
      status: (['pending', 'active', 'done', 'failed'] as const).includes(status as PlanStep['status'])
        ? (status as PlanStep['status'])
        : 'pending',
    }
  })
}

/* -------------------------------------------------------------------------- */
/* الأدوات: بداية ونهاية                                                         */
/* -------------------------------------------------------------------------- */

function openToolRow(s: RunState, name: string, args: unknown, callId: string, now: number): RunState {
  const key = toolKey(name, args)
  const row: ToolActivity = {
    id: `t${s.toolSeq}`,
    callId,
    name,
    args: compactArgs(args),
    argHint: describeArgs(args),
    status: 'running',
    summary: '',
    ms: 0,
    at: now,
  }
  const tools = [...s.tools, row].slice(-MAX_TOOLS)
  return { ...s, tools, toolSeq: s.toolSeq + 1, openStarts: appendOpen(s, { name, key, rowId: row.id }) }
}

function appendOpen(s: RunState, entry: OpenStart): OpenStart[] {
  return [...s.openStarts, entry].slice(-MAX_OPEN_STARTS)
}

function onToolStart(s: RunState, event: Record<string, unknown>, now: number): RunState {
  const name = tidy(str(event.name), 80) || 'أداة'
  const args = rec(event.args)
  const callId = str(event.callId)

  if (callId) {
    // بثّ حقيقي من الحلقة — إن سبق بثّه فلا نكرّر الصف.
    if (s.tools.some((t) => t.callId === callId)) return s
    return openToolRow(s, name, args, callId, now)
  }

  // بثّ بلا callId من غلاف الأدوات. اليوم يُرسل الاثنان ⇒ صفّان لنفس العمل.
  // نربطه بالصفّ الموجود (المعروف بـ callId حقيقي) بدل إنشاء صفّ ثانٍ.
  const key = toolKey(name, args)
  const twin = [...s.tools].reverse().find((t) => t.status === 'running' && t.callId !== '' && toolKey(t.name, t.args) === key)
  const rowId = twin ? twin.id : `t${s.toolSeq}`
  const next = twin ? s : openToolRow(s, name, args, '', now)
  return { ...next, openStarts: appendOpen(next, { name, key, rowId: twin ? twin.id : rowId }) }
}

function settleTool(s: RunState, rowId: string, ok: boolean, summary: string, ms: number, now: number): RunState {
  let index = -1
  for (let i = s.tools.length - 1; i >= 0; i--) {
    if (s.tools[i]?.id === rowId && s.tools[i]?.status === 'running') {
      index = i
      break
    }
  }
  if (index === -1) return s // لا يوجد صفّ مفتوح بهذا المعرّف (بثّ مكرّر أو خارج النافذة)
  const tools = [...s.tools]
  const target = tools[index]
  if (!target) return s
  tools[index] = {
    ...target,
    status: ok ? 'done' : 'error',
    summary: tidy(summary, MAX_SUMMARY_LEN),
    ms: Math.max(0, Math.round(ms)),
    at: target.at || now,
  }
  return { ...s, tools }
}

function onToolEnd(s: RunState, event: Record<string, unknown>): RunState {
  const name = tidy(str(event.name), 80)
  const callId = str(event.callId)
  const ok = event.ok === true
  const summary = str(event.summary)
  const ms = num(event.ms, 0)

  if (callId) {
    // البثّ الحقيقي. إن كان الصفّ سُوِّي من البثّ المكمَّل فالتكرار لا أثر له.
    const index = [...s.tools].reverse().findIndex((t) => t.callId === callId)
    const target = index === -1 ? undefined : s.tools[s.tools.length - 1 - index]
    if (!target || target.status !== 'running') return s
    return settleTool(s, target.id, ok, summary, ms, target.at)
  }

  // بثّ بلا callId — نطابقه بأقدم pair مفتوح لنفس الأداة ما زال قيد التنفيذ.
  for (let i = 0; i < s.openStarts.length; i++) {
    const open = s.openStarts[i]
    if (!open || open.rowId === null) continue
    if (open.name !== name) continue
    const row = s.tools.find((t) => t.id === open.rowId)
    if (!row || row.status !== 'running') continue
    const openStarts = [...s.openStarts]
    openStarts[i] = { ...open, rowId: null }
    return settleTool({ ...s, openStarts }, row.id, ok, summary, ms, row.at)
  }
  return s
}

/* -------------------------------------------------------------------------- */
/* الأحداث                                                                      */
/* -------------------------------------------------------------------------- */

/** flush ثم استدعاء المعالج — يحافظ على ترتيب «الكتلة السابقة ثم الحدث». */
function flushed(s: RunState, now: number, next: (x: RunState) => RunState): RunState {
  return next(flush(s, now))
}

function readQuestion(event: Record<string, unknown>): Question | null {
  const text = tidy(str(event.question) || str(event.prompt), 2_000)
  if (!text) return null
  const raw = event.options
  const options = Array.isArray(raw) ? raw.map((o) => tidy(str(o), 120)).filter(Boolean).slice(0, 8) : []
  return { text, options, synthetic: false }
}

/** نفسِّر كل مسارات الإنهاء في مكان واحد: يوقف التشغيل ويمسح تفصيل المرحلة. */
function terminal(s: RunState): RunState {
  return { ...s, running: false, dispatching: false, stopping: false, settled: true, phaseDetail: '', streamingText: '' }
}

function onDone(s: RunState, event: Record<string, unknown>, now: number): RunState {
  const reason = str(event.reason)
  const question = readQuestion(event)

  // حدث طرفي مكرّر (control.ts و loop.ts يبثّان needs-input معًا):
  // لا نكرّر أسطرًا ولا نستبدل سؤالًا حقيقيًا بسؤال بديل.
  if (s.settled) {
    if (question && s.awaitingQuestion?.synthetic) {
      return {
        ...s,
        awaitingQuestion: question,
        lines: pushLine(s, 'agent', question.text, now).lines,
        lineSeq: s.lineSeq + 1,
      }
    }
    return s
  }

  const summary = tidy(str(event.summary), 4_000)
  let next = terminal(flush(s, now))
  next = { ...next, phase: 'done', awaitingQuestion: null, lastError: null }

  if (reason === 'needs-input') {
    const q = question ?? { text: 'الوكيل ينتظر ردّك على سؤال.', options: [], synthetic: true }
    next = {
      ...next,
      phase: 'idle',
      awaitingQuestion: q,
      lines: pushLine(next, 'agent', q.text, now).lines,
      lineSeq: next.lineSeq + 1,
    }
    return next
  }

  if (reason === 'aborted') {
    return { ...next, phase: 'idle' }
  }

  if (reason === 'error') {
    const message = tidy(str(event.error) || str(event.message), 1_000) || 'انتهت المهمة بخطأ.'
    next = withNotice({ ...next, phase: 'error', lastError: message }, 'error', message, now)
    return next
  }

  if (reason === 'max-steps') {
    return withNotice(next, 'warn', 'وصل الوكيل للحد الأقصى للخطوات قبل إنهاء المهمة.', now)
  }

  if (summary) return pushLine(next, 'agent', summary, now)
  return next
}

function onFailed(s: RunState, event: Record<string, unknown>, now: number): RunState {
  const message = tidy(str(event.message), 2_000) || 'فشلت المهمة.'
  if (s.settled) {
    // مكرّر — نحدّث النص إن كان أطول لكنه لا نكرّر السطر ولا نغيّر phase
    return s.lastError === message ? s : { ...s, lastError: message }
  }
  const next = terminal(flush(s, now))
  return withNotice({ ...next, phase: 'error', lastError: message, awaitingQuestion: null }, 'error', message, now)
}

/** يلتقط رابط المعاينة من أي مصدر ممكن — لا نعتمد على حقل واحد من main. */
function scanPreviewUrl(s: RunState, text: string): string | null {
  const url = extractLoopbackUrl(text)
  if (!url || url === s.previewUrl) return null
  return url
}

function onStatus(s: RunState, event: Record<string, unknown>, now: number): RunState {
  const phase = isPhase(event.phase) ? event.phase : s.phase
  const detail = tidy(str(event.detail), 200)
  let next: RunState = { ...s, phase, phaseDetail: detail }

  const url = scanPreviewUrl(s, detail)
  if (url) next = { ...next, previewUrl: url }

  if (phase === 'error') {
    const message = detail || 'حصل خطأ أثناء التنفيذ — افتح السجل للتفاصيل.'
    next = withNotice({ ...next, lastError: message }, 'error', message, now)
  }
  return next
}

function onText(s: RunState, event: Record<string, unknown>): RunState {
  const delta = str(event.delta)
  if (!delta) return s
  const pending = s.streamingText + delta
  // إن أرسل main فقرات مفصولة بأسطر فارغة نُغلقها فورًا؛ نُبقي الذيل ككتلة جارية.
  const parts = pending.split(/\n{2,}/)
  const tail = parts.pop() ?? ''
  let next: RunState = { ...s, streamingText: tail }
  for (const part of parts) next = pushLine(next, 'agent', part, Date.now())
  return next
}

function onNotice(s: RunState, event: Record<string, unknown>, now: number): RunState {
  const level = isLevel(event.level) ? event.level : 'info'
  let next = withNotice(s, level, event.message, now)

  const url = scanPreviewUrl(next, str(event.message))
  if (url) next = { ...next, previewUrl: url }

  // خطأ صريح أثناء التشغيل يجب أن يُرى في اللوحة لا في السجل المطوي.
  if (level === 'error' && s.running) {
    next = { ...next, phase: 'error', lastError: tidy(str(event.message), 1_000) || 'خطأ من الوكيل.' }
  }
  return next
}

function onUsage(s: RunState, event: Record<string, unknown>): RunState {
  const inputTokens = Math.max(0, num(event.inputTokens, 0))
  const outputTokens = Math.max(0, num(event.outputTokens, 0))
  if (inputTokens === 0 && outputTokens === 0) return s
  const prev = s.usage ?? { inputTokens: 0, outputTokens: 0 }
  return { ...s, usage: { inputTokens: prev.inputTokens + inputTokens, outputTokens: prev.outputTokens + outputTokens } }
}

function summarizeUnknown(event: unknown): string {
  try {
    const text = JSON.stringify(event)
    return tidy(text, 400) || '(تعذّر تمثيل الحدث)'
  } catch {
    return '(حدث غير قابل للقراءة)'
  }
}

/**
 * يطبّق حدثًا من العملية الرئيسية — أو يسجّله إن كان مجهولًا.
 * هذا هو contract الوحيد مع main: لا يُسقط أي `type` مهما كان.
 */
export function applyAgentEvent(s: RunState, event: AgentEvent, now = Date.now()): RunState {
  const type = str(rec(event).type)
  // أول حدث من main يعني أن الاستدعاء قُبل — نغلق نافذة الإرسال المزدوج.
  const head: RunState = s.dispatching ? { ...s, dispatching: false } : s

  switch (type) {
    case 'status':
      return flushed(head, now, (x) => onStatus(x, rec(event), now))
    case 'text':
      return onText(head, event)
    case 'tool_start':
      return flushed(head, now, (x) => onToolStart(x, rec(event), now))
    case 'tool_end':
      return onToolEnd(head, rec(event))
    case 'notice':
      return onNotice(head, rec(event), now)
    case 'plan':
      return flushed(head, now, (x) => ({ ...x, plan: sanitizePlan(rec(event).steps) }))
    case 'usage':
      return onUsage(head, rec(event))
    case 'done':
      return onDone(head, rec(event), now)
    case 'failed':
      return onFailed(head, rec(event), now)
    default: {
      const logged = flushed(head, now, (x) => withNotice(x, 'warn', `حدث غير معروف (${type || 'بلا نوع'}): ${summarizeUnknown(event)}`, now))
      return { ...logged, unknownEvents: s.unknownEvents + 1 }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* الأفعال                                                                     */
/* -------------------------------------------------------------------------- */

export type RunAction =
  /** بدأ الإرسال — الطريق الوحيد الذي يجعل running = true. */
  | { type: 'run/started' }
  /** agent:run رجّع ok:false أو رمى استثناءً. */
  | { type: 'run/rejected'; message: string }
  /** agent:status قال إن الوكيل توقّف ولم يصل أي حدث طرفي. */
  | { type: 'run/lost'; message: string }
  | { type: 'run/stopping' }
  | { type: 'run/stopped' }
  /** صُدّر run/resumed للوحة عبر resumption بعد إعادة التركيب. */
  | { type: 'run/resumed' }
  | { type: 'question/cleared' }
  | { type: 'log/cleared' }
  /** ملاحظة من الواجهة نفسها (فشل جسر مثلًا) — تدخل السجل بنفس قواعد التنظيف. */
  | { type: 'log/note'; level: NoticeLevel; message: string }
  | { type: 'preview/url'; url: string | null }
  | { type: 'event'; event: AgentEvent }

export const NO_MODEL = 'لم تختر نموذجًا بعد — افتح «المزوّدات» من الشريط العلوي ثم عدّ إلى هنا.'

export function runReducer(s: RunState, action: RunAction, now = Date.now()): RunState {
  switch (action.type) {
    /* لا مسار فشل يضبط running = true — ولا finally في الواجهة يضبطه. */
    case 'run/started':
      return {
        ...flush(s, now),
        running: true,
        dispatching: true,
        stopping: false,
        settled: false,
        phase: 'thinking',
        phaseDetail: '',
        streamingText: '',
        awaitingQuestion: null,
        lastError: null,
        usage: null,
      }

    case 'run/rejected':
      return withNotice(
        { ...terminal(s), phase: 'error', lastError: tidy(action.message, 1_000) || 'تعذّر بدء المهمة.', awaitingQuestion: null },
        'error',
        action.message,
        now,
      )

    case 'run/lost':
      return withNotice(
        { ...terminal(s), phase: 'error', lastError: tidy(action.message, 1_000) || 'انقطعت المهمة.', awaitingQuestion: null },
        'error',
        action.message,
        now,
      )

    case 'run/stopping':
      return s.stopping ? s : { ...s, stopping: true }

    case 'run/stopped':
      return withNotice(
        { ...terminal(s), phase: 'idle', awaitingQuestion: null, lastError: null },
        'warn',
        'أوقفتَ المهمة. أُوقف خادم التطوير المرتبط بها إن كان يعمل.',
        now,
      )

    case 'run/resumed':
      // العملية الرئيسية كانت تعمل بينما اللوحة غير مركّبة — نعيد الصدق عند العودة.
      return s.running ? s : { ...s, running: true, dispatching: false, settled: false }

    case 'question/cleared':
      return s.awaitingQuestion === null ? s : { ...s, awaitingQuestion: null }

    case 'log/cleared':
      return s.notices.length === 0 ? s : { ...s, notices: [] }

    case 'log/note':
      return withNotice(s, action.level, action.message, now)

    case 'preview/url': {
      const url = action.url ? extractLoopbackUrl(action.url) ?? str(action.url) : null
      return url === s.previewUrl ? s : { ...s, previewUrl: url }
    }

    case 'event':
      return applyAgentEvent(s, action.event, now)

    default:
      return s
  }
}

/* -------------------------------------------------------------------------- */
/* مساعدات العرض (نقية وقابلة للاختبار)                                         */
/* -------------------------------------------------------------------------- */

/** هل نُبقي التمرير ملتصقًا بالقاع؟ السحب القسري كان: `scrollTop = scrollHeight` عند أي تغيير. */
export function shouldAutoScroll(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = 56,
): boolean {
  const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
  if (distance <= 0) return true
  return distance <= threshold
}

/** آخر max أداة فقط — الهوية تتبع السطر لا الموضع، فلا نفهرس. */
export function visibleTools(tools: ToolActivity[], max = 6): ToolActivity[] {
  return tools.length <= max ? tools : tools.slice(-max)
}

export function noticeCounts(notices: Notice[]): { total: number; errors: number; warns: number } {
  let errors = 0
  let warns = 0
  for (const n of notices) {
    if (n.level === 'error') errors++
    else if (n.level === 'warn') warns++
  }
  return { total: notices.length, errors, warns }
}

export function filterNotices(notices: Notice[], level: NoticeLevel | 'all'): Notice[] {
  if (level === 'all') return notices
  return notices.filter((n) => n.level === level)
}

/** بصمة رخيصة لdependencies التمرير — تشمل تغيّر حالة الأدوات لا عددها فقط. */
export function transcriptSignature(s: RunState): string {
  let sig = `${s.lines.length}|${s.streamingText.length}|${s.tools.length}|${s.plan.length}|${s.phaseDetail.length}|${s.awaitingQuestion ? 1 : 0}`
  for (const t of s.tools) sig += `${t.id}:${t.status}:${t.summary.length}`
  return sig
}

/** وقت محلي HH:MM:SS — Notice.at كان مخزَّنًا ومهمَلًا. */
export function formatTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function formatUsage(usage: Usage | null): string {
  if (!usage) return ''
  const total = usage.inputTokens + usage.outputTokens
  if (total < 1000) return `${total} رمز`
  return `${(total / 1000).toFixed(1)}k رمز`
}