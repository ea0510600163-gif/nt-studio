import type { Block } from '../providers/types'

export function callSignature(name: string, input: unknown): string {
  const norm = (v: unknown, d = 0): unknown => {
    if (d > 3) return '…'
    if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) : v
    if (typeof v === 'bigint') return `${v}n`
    if (typeof v === 'function' || typeof v === 'symbol') return typeof v
    if (Array.isArray(v)) return v.slice(0, 8).map((x) => norm(x, d + 1))
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, norm(x, d + 1)])
      )
    return v
  }
  try {
    return `${name}:${JSON.stringify(norm(input ?? {}))}`
  } catch {
    return name
  }
}

export interface LoopVerdict {
  warning: string | null
  fatal: boolean
}

export interface ToolOutcome {
  isError?: boolean
  content?: unknown
}

export type OutcomesInput =
  | Map<string, ToolOutcome>
  | Record<string, ToolOutcome>
  | Extract<Block, { type: 'tool_result' }>[]

export const READ_TOOL_LIMIT = 24
export const WRITE_TOOL_LIMIT = 18
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'delete_path',
  'move_path',
  'make_dir',
  'run_command',
  'browser_upload'
])

const PROBE_TOOLS: ReadonlySet<string> = new Set([
  'browser_snapshot',
  'browser_screenshot',
  'browser_console',
  'browser_audit'
])

const BROWSER_STUCK_REPEATS = 4
export const STREAK_LIMIT = 5
export const ALTERNATION_CYCLES = 3
export const OUTCOME_REPEAT = 5
export const ERROR_PREFIX_LEN = 80
const ERR_KEY_SEP = ' | '

export function normalizeTarget(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const raw = o.path ?? o.from ?? o.to
  if (typeof raw === 'string') {
    const t = raw.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
    if (t) return t.toLowerCase()
  }
  if (o.ref != null && (typeof o.ref === 'number' || typeof o.ref === 'string')) {
    const r = String(o.ref).trim()
    if (r) return `browser:ref=${r.toLowerCase()}`
  }
  if (typeof o.selector === 'string' && o.selector.trim())
    return `browser:sel=${o.selector.trim().toLowerCase().slice(0, 80)}`
  if (typeof o.text === 'string' && o.text.trim())
    return `browser:text=${o.text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`
  if (typeof o.url === 'string' && o.url.trim())
    return `browser:url=${o.url.trim().toLowerCase().slice(0, 120)}`
  if (typeof o.target === 'string' && o.target.trim())
    return `browser:target=${o.target.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80)}`
  if (o.dir === 'back' || o.dir === 'forward') return `browser:nav=${o.dir}`
  return null
}

export function errorPrefix(content: unknown): string | null {
  if (typeof content !== 'string') return null
  const t = content.trim().replace(/\s+/g, ' ')
  if (!t) return null
  return t.slice(0, ERROR_PREFIX_LEN)
}

function toOutcomeMap(outcomes?: OutcomesInput): Map<string, ToolOutcome> {
  const m = new Map<string, ToolOutcome>()
  if (!outcomes) return m
  if (Array.isArray(outcomes)) {
    for (const b of outcomes) m.set(b.tool_use_id, { isError: b.is_error, content: b.content })
    return m
  }
  if (outcomes instanceof Map) return outcomes as Map<string, ToolOutcome>
  for (const [k, v] of Object.entries(outcomes)) m.set(k, v as ToolOutcome)
  return m
}

interface HistEntry {
  name: string
  target: string | null
  page: string | null
}

export function readPageKey(name: string, input: unknown): string | null {
  if (name !== 'read_file' || !input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const s = Math.max(1, Number(o.start_line) || 1)
  const e = Number(o.end_line) || s + 3999
  return `${s}-${e}`
}

function findAlternation(hist: HistEntry[]): { a: string; b: string; target: string; cycles: number } | null {
  const n = hist.length
  if (n < ALTERNATION_CYCLES * 2) return null
  const tail = hist[n - 1]
  const target = tail.target
  if (!target) return null
  const names = new Set<string>([tail.name])
  let len = 1
  for (let i = n - 2; i >= 0; i--) {
    const cur = hist[i]
    const nxt = hist[i + 1]
    if (cur.target !== target || cur.name === nxt.name) break
    names.add(cur.name)
    if (names.size > 2) break
    len++
  }
  if (names.size !== 2) return null
  const cycles = Math.floor(len / 2)
  if (cycles < ALTERNATION_CYCLES) return null
  const pagesByName = new Map<string, Set<string>>()
  for (let i = n - len; i < n; i++) {
    const e = hist[i]
    let set = pagesByName.get(e.name)
    if (!set) {
      set = new Set()
      pagesByName.set(e.name, set)
    }
    set.add(e.page ?? '')
  }
  for (const set of pagesByName.values()) if (set.size > 1) return null
  const b = tail.name
  const a = [...names].find((x) => x !== b) as string
  return { a, b, target, cycles }
}

export class LoopGuard {
  private sigs: string[] = []
  private hist: HistEntry[] = []
  private errKeys: (string | null)[] = []
  private nameCounts = new Map<string, number>()
  private errCounts = new Map<string, number>()
  private strikes = 0
  private window = 60
  static readonly FATAL_AFTER = 4

  check(calls: Extract<Block, { type: 'tool_use' }>[], outcomes?: OutcomesInput): LoopVerdict {
    const outcomeById = toOutcomeMap(outcomes)
    const pass: string[] = []
    const batchErrKeys: string[] = []
    for (const c of calls) {
      const sig = callSignature(c.name, c.input)
      this.sigs.push(sig)
      pass.push(sig)
      this.hist.push({ name: c.name, target: normalizeTarget(c.input), page: readPageKey(c.name, c.input) })
      this.nameCounts.set(c.name, (this.nameCounts.get(c.name) ?? 0) + 1)
      const o = outcomeById.get(c.id)
      const prefix = o?.isError ? errorPrefix(o.content) : null
      const key = prefix ? `${c.name}${ERR_KEY_SEP}${prefix}` : null
      this.errKeys.push(key)
      if (key) {
        this.errCounts.set(key, (this.errCounts.get(key) ?? 0) + 1)
        batchErrKeys.push(key)
      }
    }
    if (this.sigs.length > this.window) {
      const drop = this.sigs.length - this.window
      const droppedSigs = this.sigs.splice(0, drop)
      this.hist.splice(0, drop)
      const droppedErr = this.errKeys.splice(0, drop)
      for (const sig of droppedSigs) {
        const name = sig.slice(0, sig.indexOf(':'))
        const n = (this.nameCounts.get(name) ?? 0) - 1
        if (n <= 0) this.nameCounts.delete(name)
        else this.nameCounts.set(name, n)
      }
      for (const key of droppedErr) {
        if (!key) continue
        const n = (this.errCounts.get(key) ?? 0) - 1
        if (n <= 0) this.errCounts.delete(key)
        else this.errCounts.set(key, n)
      }
    }

    const last = pass[pass.length - 1]
    let streak = 0
    if (last) for (let i = this.sigs.length - 1; i >= 0 && this.sigs[i] === last; i--) streak++
    if (streak >= STREAK_LIMIT) {
      this.reset()
      return this.penalize(
        `كرّرتَ الاستدعاء نفسه (${last.slice(0, 90)}) ${streak} مرات وحصلتَ على النتيجة نفسها. ` +
          `توقّف فوراً عن تكراره. افحص الحالة الفعلية أولاً: read_file/list_dir لمصدر الحقيقة، browser_snapshot إن كان الأمر واجهة، system_info للبيئة. ` +
          `ثم غيّر النهج كلياً: قسّم المهمة، استخدم grep للبحث بدل القراءة المتكررة، أو أعد صياغة الطلب.`
      )
    }

    const alt = findAlternation(this.hist)
    if (alt) {
      this.reset()
      if (alt.target.startsWith('browser:')) {
        return this.penalize(
          `تناوب ${alt.a}↔${alt.b} على العنصر نفسه (${alt.target}) ${alt.cycles} دورات دون تقدّم. ` +
            `توقّف فوراً: خذ browser_snapshot جديدة وتحقق أن الأرقام ما زالت تشير للعناصر المقصودة (الأرقام القديمة قد تُعيد الترقيم لعناصر مختلفة)، ` +
            `ثم غيّر الاستراتيجية: محدد CSS مختلف، أو مطابقة نصية، أو نهج آخر — ولا تعِد الدورة نفسها.`
        )
      }
      return this.penalize(
        `تناوب ${alt.a}↔${alt.b} على الملف نفسه (${alt.target}) ${alt.cycles} دورات دون تقدّم. ` +
          `توقّف عن حلقة القراءة-التعديل: اقرأ المقطع المطلوب مرة واحدة بتمعّن، ثم نفّذ تغييراً واحداً مدروساً، ` +
          `واستخدم grep للتحقق قبل التعديل بدل التناوب الأعمى.`
      )
    }

    const tailEntry = this.hist[this.hist.length - 1]
    if (tailEntry?.target?.startsWith('browser:')) {
      let reps = 0
      for (let i = this.hist.length - 1; i >= 0; i--) {
        const e = this.hist[i]
        if (e.name === tailEntry.name && e.target === tailEntry.target) {
          reps++
          continue
        }
        if (e.target === null && PROBE_TOOLS.has(e.name)) continue
        break
      }
      if (reps >= BROWSER_STUCK_REPEATS) {
        this.reset()
        return this.penalize(
          `كرّرت ${tailEntry.name} على ${tailEntry.target} ${reps} مرات تتخللها لقطات فقط دون تقدّم. ` +
            `توقّف فوراً: خذ browser_snapshot جديدة وتحقق أن الرقم ما زال يشير للعنصر المقصود، ` +
            `ثم غيّر الاستراتيجية (محدد مختلف أو نهج آخر) — ولا تعِد الفعل نفسه.`
        )
      }
    }

    for (const key of batchErrKeys) {
      const n = this.errCounts.get(key) ?? 0
      if (n >= OUTCOME_REPEAT) {
        const sep = key.indexOf(ERR_KEY_SEP)
        const name = key.slice(0, sep)
        const prefix = key.slice(sep + ERR_KEY_SEP.length)
        this.reset()
        return this.penalize(
          `الأداة ${name} فشلت ${n} مرات بالخطأ نفسه (${prefix}…). ` +
            `اقرأ نص الخطأ كاملاً أولاً ثم غيّر الاستراتيجية جذرياً بدل إعادة المحاولة نفسها: ` +
            `تحقق من المسار والمعطيات، أو جرّب نهجاً مختلفاً تماماً، أو قسّم المهمة.`
        )
      }
    }

    for (const [name, n] of this.nameCounts)
      if (n >= (WRITE_TOOLS.has(name) ? WRITE_TOOL_LIMIT : READ_TOOL_LIMIT)) {
        this.reset()
        return this.penalize(`استدعيتَ ${name} ${n} مرة دون نتيجة جديدة — أنت في حلقة ولا تتقدّم.`)
      }
    return { warning: null, fatal: false }
  }

  private reset(): void {
    this.sigs.length = 0
    this.hist.length = 0
    this.errKeys.length = 0
    this.nameCounts.clear()
    this.errCounts.clear()
  }

  private penalize(msg: string): LoopVerdict {
    this.strikes++
    return { warning: `تنبيه من النظام: ${msg}`, fatal: this.strikes >= LoopGuard.FATAL_AFTER }
  }
}
