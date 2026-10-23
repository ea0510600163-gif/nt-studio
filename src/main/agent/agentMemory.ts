export interface AgentFileMemo {
  path: string
  action: 'write' | 'edit'
  step: number
}

export interface ActionMemo {
  step: number
  label: string
  result: string
  ok: boolean
}

export interface AgentMemory {
  goal: string
  previousGoals: string[]
  files: AgentFileMemo[]
  actions: ActionMemo[]
  updatedAt: number
}

export const MEMORY_FILES_CAP = 20
export const GOAL_CAP = 2000
export const PREVIOUS_GOALS_CAP = 12
export const ACTIONS_CAP = 30

const clip = (s: unknown, n: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function createAgentMemory(goal: string, now = Date.now()): AgentMemory {
  return {
    goal: clip(goal, GOAL_CAP),
    previousGoals: [],
    files: [],
    actions: [],
    updatedAt: now
  }
}

export function normalizeMemory(raw: unknown, now = Date.now()): AgentMemory | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<AgentMemory>
  const m = createAgentMemory(String(r.goal ?? ''), now)
  if (Array.isArray(r.files)) m.files = r.files.filter((f) => f && typeof f.path === 'string').slice(-MEMORY_FILES_CAP)
  if (Array.isArray(r.previousGoals)) m.previousGoals = r.previousGoals.map((g) => clip(g, 300)).filter(Boolean).slice(-PREVIOUS_GOALS_CAP)
  if (Array.isArray(r.actions)) {
    m.actions = r.actions
      .filter((a) => a && typeof a.label === 'string')
      .map((a) => ({ step: Number(a.step) || 0, label: clip(a.label, 120), result: clip(a.result, 140), ok: a.ok !== false }))
      .slice(-ACTIONS_CAP)
  }
  m.updatedAt = Number(r.updatedAt) || now
  return m
}

export function setAgentGoal(mem: AgentMemory, goal: string, now = Date.now()): void {
  const next = clip(goal, GOAL_CAP)
  if (mem.goal && mem.goal !== next) {
    mem.previousGoals.push(clip(mem.goal, 300))
    if (mem.previousGoals.length > PREVIOUS_GOALS_CAP) mem.previousGoals.splice(0, mem.previousGoals.length - PREVIOUS_GOALS_CAP)
  }
  mem.goal = next
  mem.updatedAt = now
}

export function recordAgentFile(mem: AgentMemory, path: string, action: 'write' | 'edit', step: number, now = Date.now()): void {
  const p = String(path ?? '').trim()
  if (!p) return
  const idx = mem.files.findIndex((f) => f.path === p)
  if (idx >= 0) {
    mem.files[idx] = { path: p, action, step }
    mem.files.push(mem.files.splice(idx, 1)[0])
  } else {
    mem.files.push({ path: p, action, step })
    if (mem.files.length > MEMORY_FILES_CAP) mem.files.splice(0, mem.files.length - MEMORY_FILES_CAP)
  }
  mem.updatedAt = now
}

export function agentMemorySection(mem: AgentMemory): string {
  const lines = [`الهدف الحالي: ${mem.goal || '(غير محدد)'}`]
  if (mem.previousGoals.length) {
    lines.push('طلبات سابقة في هذه الجلسة (للسياق فقط — قد يكون بعضها لم يكتمل؛ راجع المحادثة والملفات قبل أن تفترض أنه أُنجز):')
    for (const g of mem.previousGoals.slice(-5)) lines.push(`- ${g}`)
  }
  if (mem.files.length) {
    lines.push('ملفات أنشأتها أو عدّلتها (لا تُعِد إنشاء ما هو موجود — تحقق بـ read_file عند الشك):')
    for (const f of mem.files) lines.push(`- ${f.path} (${f.action === 'write' ? 'كتابة/إنشاء' : 'تعديل'}، خطوة ${f.step})`)
  } else {
    lines.push('لم تنشئ أي ملفات بعد في هذه المهمة.')
  }
  return `# STATE MEMORY (ذاكرة الحالة الحية — أبقِها في اعتبارك)\n${lines.join('\n')}`
}

export function recordAction(mem: AgentMemory, step: number, label: string, result: string, ok = true, now = Date.now()): void {
  const l = clip(label, 120)
  if (!l) return
  mem.actions.push({ step, label: l, result: clip(result, 140), ok })
  if (mem.actions.length > ACTIONS_CAP) mem.actions.splice(0, mem.actions.length - ACTIONS_CAP)
  mem.updatedAt = now
}

export function actionsDigest(mem: AgentMemory, max = ACTIONS_CAP): string {
  if (!mem.actions.length) return ''
  const rows = mem.actions.slice(-max).map((a) => `#${a.step} ${a.ok ? '' : '✗ '}${a.label} → ${a.result || '—'}`)
  return `[ذاكرة العمل — آخر ${rows.length} حركة نُفّذت (الأحدث آخراً)]\n${rows.join('\n')}`
}

export type NoteKind = 'user' | 'machine' | 'lesson'
export const NOTE_KINDS: readonly NoteKind[] = ['user', 'machine', 'lesson']

export interface Note {
  id: string
  kind: NoteKind
  text: string
  pinned: boolean
  ts: number
  uses: number
}

export interface JournalEntry {
  ts: number
  goal: string
  result: string
  files: string[]
}

export interface LongTermStore {
  v: 1
  seq: number
  notes: Note[]
  journal: JournalEntry[]
  apps: Record<string, string>
}

export const NOTE_TEXT_CAP = 500
export const NOTES_CAP = 300
export const JOURNAL_CAP = 100
export const APPS_CAP = 60
export const LONG_TERM_BUDGET = 3500

export const emptyStore = (): LongTermStore => ({ v: 1, seq: 0, notes: [], journal: [], apps: {} })

export function normalizeStore(raw: unknown): LongTermStore {
  const s = emptyStore()
  if (!raw || typeof raw !== 'object') return s
  const r = raw as Partial<LongTermStore>
  s.seq = Number(r.seq) || 0
  if (Array.isArray(r.notes)) {
    s.notes = r.notes
      .filter((n) => n && typeof n.text === 'string' && n.text.trim() && NOTE_KINDS.includes(n.kind))
      .map((n) => ({ id: String(n.id), kind: n.kind, text: clip(n.text, NOTE_TEXT_CAP), pinned: !!n.pinned, ts: Number(n.ts) || 0, uses: Number(n.uses) || 0 }))
      .slice(-NOTES_CAP)
  }
  if (Array.isArray(r.journal)) {
    s.journal = r.journal
      .filter((j) => j && typeof j.goal === 'string')
      .map((j) => ({ ts: Number(j.ts) || 0, goal: clip(j.goal, 200), result: clip(j.result, 300), files: Array.isArray(j.files) ? j.files.map(String).slice(0, 8) : [] }))
      .slice(-JOURNAL_CAP)
  }
  if (r.apps && typeof r.apps === 'object') {
    for (const [k, v] of Object.entries(r.apps)) if (k && typeof v === 'string' && v) s.apps[k] = v
  }
  return s
}

function noteKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function similarity(a: string, b: string): number {
  const A = new Set(a.split(' ').filter((w) => w.length > 1))
  const B = new Set(b.split(' ').filter((w) => w.length > 1))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

export interface AddNoteResult {
  note: Note
  status: 'added' | 'updated'
}

export function addNote(store: LongTermStore, input: { kind: NoteKind; text: string; pinned?: boolean }, now = Date.now()): AddNoteResult | null {
  const text = clip(input.text, NOTE_TEXT_CAP)
  if (!text) return null
  const kind: NoteKind = NOTE_KINDS.includes(input.kind) ? input.kind : 'lesson'
  const key = noteKey(text)
  const dup = store.notes.find((n) => {
    const nk = noteKey(n.text)
    return nk === key || (n.kind === kind && similarity(nk, key) >= 0.8)
  })
  if (dup) {
    dup.text = text
    dup.kind = kind
    dup.pinned = dup.pinned || !!input.pinned
    dup.ts = now
    return { note: dup, status: 'updated' }
  }
  const note: Note = { id: `n${++store.seq}`, kind, text, pinned: !!input.pinned, ts: now, uses: 0 }
  store.notes.push(note)
  if (store.notes.length > NOTES_CAP) {
    const victims = store.notes
      .filter((n) => !n.pinned && n.id !== note.id)
      .sort((a, b) => a.uses - b.uses || a.ts - b.ts)
      .slice(0, store.notes.length - NOTES_CAP)
    const gone = new Set(victims.map((v) => v.id))
    store.notes = store.notes.filter((n) => !gone.has(n.id))
  }
  return { note, status: 'added' }
}

export function forgetNotes(store: LongTermStore, query: string): number {
  const q = String(query ?? '').trim()
  if (!q) return 0
  const byId = store.notes.filter((n) => n.id === q)
  if (byId.length) {
    store.notes = store.notes.filter((n) => n.id !== q)
    return byId.length
  }
  const k = noteKey(q)
  if (k.length < 2) return 0
  const hit = store.notes.filter((n) => noteKey(n.text).includes(k))
  if (!hit.length) return 0
  const gone = new Set(hit.map((n) => n.id))
  store.notes = store.notes.filter((n) => !gone.has(n.id))
  return hit.length
}

export function searchNotes(store: LongTermStore, query: string, limit = 15): Note[] {
  const words = noteKey(String(query ?? '')).split(' ').filter(Boolean)
  const scored = store.notes
    .map((n) => {
      const k = noteKey(n.text)
      const score = words.length ? words.reduce((a, w) => a + (k.includes(w) ? 1 : 0), 0) : 1
      return { n, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.n.ts - a.n.ts)
    .slice(0, limit)
    .map((x) => x.n)
  for (const n of scored) n.uses++
  return scored
}

export function addJournal(store: LongTermStore, goal: string, result: string, files: string[] = [], now = Date.now()): void {
  const g = clip(goal, 200)
  if (!g) return
  store.journal.push({ ts: now, goal: g, result: clip(result, 300), files: files.map(String).slice(0, 8) })
  if (store.journal.length > JOURNAL_CAP) store.journal.splice(0, store.journal.length - JOURNAL_CAP)
}

export function setApp(store: LongTermStore, name: string, target: string): void {
  const k = String(name ?? '').trim().toLowerCase()
  const t = String(target ?? '').trim()
  if (!k || !t || k.length > 60) return
  store.apps[k] = t
  const keys = Object.keys(store.apps)
  if (keys.length > APPS_CAP) for (const old of keys.slice(0, keys.length - APPS_CAP)) delete store.apps[old]
}

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10)

export function renderLongTerm(store: LongTermStore, budget = LONG_TERM_BUDGET): string {
  const head = '# LONG-TERM MEMORY (ذاكرتك الدائمة — تبقى بعد إغلاق البرنامج؛ اقرأها قبل البدء، وحدّثها بأداة memory)'
  if (!store.notes.length && !store.journal.length && !Object.keys(store.apps).length) {
    return `${head}\n(فارغة بعد — احفظ فيها بأداة memory كل ما تتعلمه: تفضيلات المستخدم، أماكن الأشياء على جهازه، دروسك.)`
  }
  const out: string[] = [head]
  let used = head.length
  const push = (line: string): boolean => {
    if (used + line.length + 1 > budget) return false
    out.push(line)
    used += line.length + 1
    return true
  }
  const label: Record<NoteKind, string> = { user: 'المستخدم', machine: 'الجهاز', lesson: 'درس' }
  const pinned = store.notes.filter((n) => n.pinned).sort((a, b) => b.ts - a.ts)
  const recent = store.notes.filter((n) => !n.pinned).sort((a, b) => b.ts - a.ts)

  if (pinned.length) {
    push('## ثوابت (لا تُنسى)')
    for (const n of pinned) if (!push(`- [${n.id}|${label[n.kind]}] ${n.text}`)) break
  }
  if (recent.length) {
    push('## ملاحظات')
    for (const n of recent) if (!push(`- [${n.id}|${label[n.kind]}] ${n.text}`)) break
  }
  const apps = Object.entries(store.apps).slice(-15)
  if (apps.length) {
    push('## تطبيقات تعرف مساراتها')
    for (const [k, v] of apps) if (!push(`- ${k} → ${v}`)) break
  }
  if (store.journal.length) {
    push('## آخر المهام المنجزة (الأحدث آخراً)')
    for (const j of store.journal.slice(-6)) if (!push(`- ${day(j.ts)}: ${j.goal} → ${j.result || 'تم'}`)) break
  }
  return out.join('\n')
}
