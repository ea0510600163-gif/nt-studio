import type { Block, Msg } from '../providers/types'

export function estimateTokens(system: string, msgs: Msg[], toolsChars = 0): number {
  let chars = system.length + toolsChars
  let images = 0
  for (const m of msgs)
    for (const b of m.content) {
      if (b.type === 'text') chars += b.text.length
      else if (b.type === 'thinking') {}
      else if (b.type === 'tool_use') chars += b.name.length + JSON.stringify(b.input ?? {}).length
      else if (b.type === 'tool_result') {
        chars += b.content.length
        images += b.images?.length ?? 0
      } else images++
    }
  return Math.ceil(chars / 3.2) + images * 1500
}

export const ERROR_RESULT_LIMIT = 4000
export const ERROR_RESULT_LIMIT_HARD = 1200
export const MAX_PRESERVED_ERROR_CHARS = 12000
export const SUMMARY_MIN_CHARS = 300
export const SUMMARY_MIN_PATHS = 2

const PATH_RE = /[A-Za-z0-9_~.\-][A-Za-z0-9_~.\-/]*\.[A-Za-z0-9]{1,5}\b/g

function extractPaths(text: string): string[] {
  return [...new Set(text.match(PATH_RE) ?? [])]
}

export function shrinkOld(msgs: Msg[], keepRecent = 8, hard = false): boolean {
  const limit = hard ? 1200 : 2500
  const errorLimit = hard ? ERROR_RESULT_LIMIT_HARD : ERROR_RESULT_LIMIT
  let errorBudget = MAX_PRESERVED_ERROR_CHARS
  const toolName = new Map<string, string>()
  for (const m of msgs)
    for (const b of m.content)
      if (b.type === 'tool_use') toolName.set(b.id, b.name)
  const cut = msgs.length - keepRecent
  let changed = false
  const cutNote = (i: number, id: string, n: number, kind: string): string =>
    `[... ${kind} (أداة ${toolName.get(id) ?? '؟'}، خطوة ${i}، ${n} حرفاً) ...]`
  const middleCut = (b: Extract<Block, { type: 'tool_result' }>, i: number, window: number, kind: string): void => {
    const orig = b.content
    const head = Math.floor(window * 0.6)
    const tail = Math.floor(window * 0.3)
    b.content = `${orig.slice(0, head)}\n${cutNote(i, b.tool_use_id, orig.length, kind)}\n${orig.slice(-tail)}`
    changed = true
  }
  for (let i = 0; i < cut; i++) {
    const effectiveLimit = hard
      ? Math.round(limit * (0.5 + 0.5 * (i / cut)))
      : limit
    for (const b of msgs[i].content) {
      if (b.type !== 'tool_result') continue
      if (b.images?.length) {
        b.images = undefined
        b.content += '\n[لقطة شاشة قديمة حُذفت من السياق]'
        changed = true
      }
      if (!b.is_error && b.content.length > effectiveLimit) {
        middleCut(b, i, effectiveLimit, 'نتيجة قديمة مقتطعة')
      }
    }
  }
  for (let i = 0; i < cut; i++) {
    for (const b of msgs[i].content) {
      if (b.type !== 'tool_result' || !b.is_error) continue
      if (b.content.length <= errorLimit && b.content.length <= errorBudget) {
        errorBudget -= b.content.length
        continue
      }
      middleCut(b, i, errorLimit, 'نتيجة خطأ قديمة مقتطعة — راجع السجل الكامل')
    }
  }
  return changed
}

export function dropStaleImages(msgs: Msg[]): boolean {
  let kept = 0
  let changed = false
  for (let i = msgs.length - 1; i >= 0; i--) {
    for (const b of msgs[i].content) {
      if (b.type === 'tool_result' && b.images?.length) {
        if (kept < 2) kept++
        else {
          b.images = undefined
          b.content += '\n[لقطة قديمة حُذفت]'
          changed = true
        }
      }
    }
  }
  return changed
}

export function persistable(m: Msg): Msg {
  return { role: m.role, at: m.at, content: m.content.map((b): Block => (b.type === 'tool_result' && b.images ? { ...b, images: undefined, content: b.images.length ? b.content + '\n[لقطة شاشة]' : b.content } : b)) }
}

export interface UserRequest {
  index: number
  text: string
  images: { mediaType: string; data: string }[]
}

export function lastUserRequest(msgs: Msg[]): UserRequest | null {
  for (let k = msgs.length - 1; k >= 0; k--) {
    const m = msgs[k]
    if (m.role !== 'user') continue
    return {
      index: k,
      text: m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
      images: m.content.flatMap((b) => (b.type === 'image' ? [{ mediaType: b.mediaType, data: b.data }] : []))
    }
  }
  return null
}

function transcript(msgs: Msg[], maxChars = 100000): string {
  const lines: string[] = []
  for (const m of msgs) {
    for (const b of m.content) {
      if (b.type === 'text') lines.push(`${m.role === 'user' ? 'المستخدم' : 'الوكيل'}: ${b.text.slice(0, 1500)}`)
      else if (b.type === 'tool_use') lines.push(`→ ${b.name}(${JSON.stringify(b.input).slice(0, 220)})`)
      else if (b.type === 'tool_result') lines.push(`← ${b.is_error ? '[خطأ] ' : ''}${b.content.slice(0, 350).replace(/\n+/g, ' ⏎ ')}`)
    }
  }
  const all = lines.join('\n')
  return all.length <= maxChars ? all : all.slice(0, maxChars * 0.35) + '\n[... جزء أوسط محذوف ...]\n' + all.slice(-maxChars * 0.65)
}

export const SUMMARY_PROMPT = `You compress the working history of an autonomous coding agent so it can continue seamlessly. Write a DENSE summary (max ~900 words) in the SAME language as the user's messages, as bullet sections:
1. الهدف: what the user asked + any later changes/preferences.
2. القرارات: stack, design identity, architecture decisions and WHY.
3. المنجز: files created/changed (exact paths), features done, commands that worked (exact).
4. الأخطاء: problems hit, root causes, what fixed them (so they are not repeated).
5. الحالة الحالية: what is running (processes, ports), what is verified, what is NOT.
6. الخطوة التالية: the concrete next actions.
Keep exact file paths, commands, ports, error messages that matter. No fluff.`

export function splitForCompaction(msgs: Msg[], keep = 10): { old: Msg[]; recent: Msg[] } | null {
  if (msgs.length <= keep + 2) return null
  for (let i = msgs.length - keep; i >= 2; i--) {
    if (msgs[i].role === 'assistant') return { old: msgs.slice(0, i), recent: msgs.slice(i) }
  }
  return null
}

export async function buildCompacted(msgs: Msg[], summarize: (prompt: string, text: string) => Promise<string>, keep = 10): Promise<Msg[] | null> {
  const parts = splitForCompaction(msgs, keep)
  if (!parts) return null
  const first = msgs[0].content.find((b) => b.type === 'text') as { text: string } | undefined
  const oldText = transcript(parts.old)
  const summary = await summarize(SUMMARY_PROMPT, oldText)
  const s = summary.trim()
  if (!s || s === '(ملخص فارغ)') return null
  const paths = extractPaths(oldText)
  if (paths.length >= SUMMARY_MIN_PATHS) {
    if (s.length < SUMMARY_MIN_CHARS) return null
    if (paths.filter((p) => s.includes(p)).length < 1) return null
  }
  const text = `[ملخص تلقائي لما سبق — ضُغط السياق]\nالطلب الأصلي: ${(first?.text ?? '').slice(0, 3000)}\n\n${summary}\n\n(تابع العمل من الحالة الحالية دون إعادة ما أُنجز. للتفاصيل راجع .agent/PROJECT.md وTODO.md.)`
  return [{ role: 'user', content: [{ type: 'text', text }] }, ...parts.recent]
}
