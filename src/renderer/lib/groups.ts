import type { ChatItem } from '@shared/types'

export type ToolItem = Extract<ChatItem, { kind: 'tool' }>
export type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>
export type NoticeItem = Extract<ChatItem, { kind: 'notice' }>
export type ThinkingItem = Extract<ChatItem, { kind: 'thinking' }>

export type Row =
  | { type: 'tool'; key: string; item: ToolItem }
  | { type: 'note'; key: string; item: AssistantItem }
  | { type: 'think'; key: string; item: ThinkingItem }
  | { type: 'notice'; key: string; item: NoticeItem }

export const BOOT_TASK = '__boot'
export const BOOT_LABEL = 'التهيئة والاستكشاف'

export function groupTitle(rows: Row[], task: string): string {
  const first = rows[0]
  const text = first && 'taskText' in first.item ? first.item.taskText : undefined
  return text || (task === BOOT_TASK ? BOOT_LABEL : 'مهمة')
}

export type Segment =
  | { type: 'item'; item: ChatItem }
  | { type: 'group'; id: string; task: string; rows: Row[]; live: boolean }

const isBoundary = (i: ChatItem): boolean =>
  i.kind === 'user' ||
  i.kind === 'assistant' ||
  i.kind === 'ask' ||
  i.kind === 'task' ||
  i.kind === 'notice'

const isHardBreak = (i: ChatItem): boolean =>
  i.kind === 'user' || i.kind === 'ask' || i.kind === 'task' || (i.kind === 'notice' && i.level === 'error')

function rowOf(item: ChatItem): Row {
  if (item.kind === 'tool') return { type: 'tool', key: item.id, item }
  if (item.kind === 'assistant') return { type: 'note', key: item.id, item }
  if (item.kind === 'thinking') return { type: 'think', key: item.id, item }
  return { type: 'notice', key: item.id, item: item as NoticeItem }
}

const taskOf = (i: ChatItem): string => ('task' in i && i.task ? i.task : BOOT_TASK)

export function groupTasks(items: ChatItem[], running: boolean): Segment[] {
  const out: Segment[] = []
  let i = 0

  const emit = (span: ChatItem[]): void => {
    if (!span.some((x) => x.kind === 'tool')) {
      for (const item of span) out.push({ type: 'item', item })
      return
    }
    const id = (span.find((x) => x.kind === 'tool') ?? span[0]).id
    out.push({ type: 'group', id, task: taskOf(span[0]), rows: span.map(rowOf), live: false })
  }

  while (i < items.length) {
    if (isBoundary(items[i])) {
      out.push({ type: 'item', item: items[i++] })
      continue
    }
    const span: ChatItem[] = []
    const key = taskOf(items[i])
    while (i < items.length && !isBoundary(items[i]) && taskOf(items[i]) === key) span.push(items[i++])
    emit(span)
  }

  if (running) for (let n = out.length - 1; n >= 0; n--) {
    const s = out[n]
    if (s.type === 'group') { s.live = true; break }
    if (s.type === 'item' && isHardBreak(s.item)) break
  }
  return out
}

export type Block =
  | { type: 'item'; item: ChatItem }
  | { type: 'turn'; id: string; ms: number; live: boolean; work: Segment[]; tail: ChatItem | null }

const spanMs = (s: Segment): number =>
  s.type === 'group' ? s.rows.reduce((t, r) => (r.type === 'tool' ? t + (r.item.ms ?? 0) : t), 0) : 0

export function groupTurns(segs: Segment[], running: boolean): Block[] {
  const blocks: Block[] = []
  let cur: Segment[] = []
  let id = ''

  const flush = (live = false): void => {
    if (!cur.length) { id = ''; return }
    const hasGroup = cur.some((s) => s.type === 'group')
    let tail: ChatItem | null = null
    let work = cur
    if (hasGroup && !live) {
      const last = cur[cur.length - 1]
      if (last.type === 'item' && (last.item.kind === 'assistant' || last.item.kind === 'ask')) {
        tail = last.item
        work = cur.slice(0, -1)
      }
    }
    blocks.push({ type: 'turn', id, ms: cur.reduce((t, s) => t + spanMs(s), 0), live: false, work, tail })
    cur = []
    id = ''
  }

  for (const s of segs) {
    if (s.type === 'item' && s.item.kind === 'user') { flush(); blocks.push(s); continue }
    if (!id) id = s.type === 'group' ? s.id : s.item.id
    cur.push(s)
  }
  flush(running)

  if (running) for (let n = blocks.length - 1; n >= 0; n--) {
    const b = blocks[n]
    if (b.type === 'turn') { b.live = true; break }
  }
  return blocks
}

export type FlowEntry =
  | { type: 'stage'; key: string; text: string; status: 'running' | 'done' }
  | { type: 'row'; row: Row }
  | { type: 'item'; item: ChatItem }

export function flowOf(work: Segment[]): FlowEntry[] {
  const out: FlowEntry[] = []
  for (const s of work) {
    if (s.type === 'group') {
      for (const row of s.rows) out.push({ type: 'row', row })
      continue
    }
    if (s.item.kind === 'task') {
      if (s.item.status === 'done') {
        for (let n = out.length - 1; n >= 0; n--) {
          const e = out[n]
          if (e.type === 'stage') { e.status = 'done'; break }
        }
        continue
      }
      out.push({ type: 'stage', key: s.item.id, text: s.item.text, status: 'running' })
      continue
    }
    out.push({ type: 'item', item: s.item })
  }
  return out
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ث`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}ث` : `${Math.floor(s / 60)}د ${s % 60}ث`
}
