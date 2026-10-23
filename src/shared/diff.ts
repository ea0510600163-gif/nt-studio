import type { FileDiff } from './types'

export type DiffKind = 'ctx' | 'add' | 'del'
export interface DiffLine {
  kind: DiffKind
  text: string
  oldNo: number | null
  newNo: number | null
}
export interface DiffStats {
  added: number
  removed: number
}

export const DIFF_MAX_CHARS = 100_000

const LCS_CELL_LIMIT = 4_000_000

const splitLines = (s: string): string[] => (s === '' ? [] : s.split('\n'))

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  if (!a.length && !b.length) return []
  if (!a.length) return b.map((text, n) => ({ kind: 'add' as const, text, oldNo: null, newNo: n + 1 }))
  if (!b.length) return a.map((text, n) => ({ kind: 'del' as const, text, oldNo: n + 1, newNo: null }))

  if (a.length * b.length > LCS_CELL_LIMIT) {
    const out: DiffLine[] = a.map((text, n) => ({ kind: 'del' as const, text, oldNo: n + 1, newNo: null }))
    for (let n = 0; n < b.length; n++) out.push({ kind: 'add', text: b[n], oldNo: null, newNo: n + 1 })
    return out
  }

  const w = b.length + 1
  const dp = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let oldNo = 0
  let newNo = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      oldNo++
      newNo++
      out.push({ kind: 'ctx', text: a[i], oldNo, newNo })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      oldNo++
      out.push({ kind: 'del', text: a[i], oldNo, newNo: null })
      i++
    } else {
      newNo++
      out.push({ kind: 'add', text: b[j], oldNo: null, newNo })
      j++
    }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++], oldNo: ++oldNo, newNo: null })
  while (j < b.length) out.push({ kind: 'add', text: b[j++], oldNo: null, newNo: ++newNo })
  return out
}

export function diffStats(lines: readonly DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.kind === 'add') added++
    else if (l.kind === 'del') removed++
  }
  return { added, removed }
}

export function makeDiff(path: string, kind: FileDiff['kind'], before: string, after: string): FileDiff | null {
  if (before.length + after.length > DIFF_MAX_CHARS) return null
  const { added, removed } = diffStats(diffLines(before, after))
  return { path, kind, before, after, added, removed }
}
