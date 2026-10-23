import type { ChatItem } from '@shared/types'
import type { Block, Msg } from '../providers/types'

const MAX_ITEM_CHARS = 6000

export function promoteReasoningAnswer(content: Block[]): Block[] {
  if (content.some((b) => b.type === 'tool_use')) return content
  if (content.some((b) => b.type === 'text' && b.text.trim())) return content
  const joined = content
    .filter((b): b is Extract<Block, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => b.text)
    .filter((t) => t.trim())
    .join('\n\n')
    .trim()
  return joined ? [{ type: 'text', text: joined }] : content
}

export function toChatItems(msgs: Msg[]): ChatItem[] {
  const results = new Map<string, { content: string; is_error?: boolean }>()
  for (const m of msgs) for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b)
  const items: ChatItem[] = []
  let n = 0
  let curTask: string | undefined
  let curTaskText = ''
  const applyPlan = (rawItems: unknown) => {
    const list = Array.isArray(rawItems) ? (rawItems as { text: string; status: string }[]) : []
    const doingIdx = list.findIndex((x) => x.status === 'doing')
    const nextKey = doingIdx >= 0 ? `t${doingIdx}` : curTask
    const nextText = doingIdx >= 0 ? list[doingIdx].text : curTaskText
    if (curTask && nextKey !== curTask) {
      items.push({ kind: 'task', id: `k${n++}`, text: curTaskText, status: 'done' })
      if (nextText) items.push({ kind: 'task', id: `k${n++}`, text: nextText, status: 'start' })
    }
    curTask = nextKey
    curTaskText = nextText
  }
  for (const m of msgs) {
    if (m.role === 'user') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim()
      if (!text) continue
      if (text.startsWith('[ملخص تلقائي')) items.push({ kind: 'notice', id: `n${n++}`, level: 'info', text: 'جرى تلخيص الجزء القديم من المحادثة لتوفير السياق.', task: curTask, taskText: curTaskText })
      else items.push({ kind: 'user', id: `u${n++}`, text: text.replace(/^\[توجيه من المستخدم[^\]]*\]\s*/, ''), at: m.at })
    } else {
      const hasThinking = m.content.some((b) => b.type === 'thinking' && b.text.trim())
      const hasText = m.content.some((b) => b.type === 'text' && b.text.trim())
      const hasToolUse = m.content.some((b) => b.type === 'tool_use')
      const promoteThinking = hasThinking && !hasText && !hasToolUse
      for (const b of m.content) {
        if (b.type === 'thinking' && b.text.trim()) {
          const text = b.text.length > MAX_ITEM_CHARS ? `${b.text.slice(0, MAX_ITEM_CHARS)}…` : b.text
          if (promoteThinking) items.push({ kind: 'assistant', id: `a${n++}`, text, task: curTask, taskText: curTaskText })
          else items.push({ kind: 'thinking', id: `h${n++}`, text, task: curTask, taskText: curTaskText })
        } else if (b.type === 'text' && b.text.trim()) items.push({ kind: 'assistant', id: `a${n++}`, text: b.text, task: curTask, taskText: curTaskText })
        else if (b.type === 'tool_use') {
          const r = results.get(b.id)
          items.push({ kind: 'tool', id: b.id, name: b.name, input: b.input, status: r ? (r.is_error ? 'error' : 'ok') : 'error', output: r?.content.slice(0, 6000) ?? 'لم تكتمل', task: curTask, taskText: curTaskText })
          if (b.name === 'todo_write') applyPlan((b.input as { items?: unknown } | undefined)?.items)
        }
      }
    }
  }
  return items
}
