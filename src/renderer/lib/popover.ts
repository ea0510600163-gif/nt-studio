import type { CSSProperties } from 'react'

const PAD = 8
const WIDTH = 320
const MIN = 160

export function popStyle(el: HTMLElement | null, width = WIDTH): CSSProperties {
  if (!el) return {}
  const r = el.getBoundingClientRect()
  const host = el.closest<HTMLElement>('.chat-column')?.getBoundingClientRect()
  const low = Math.max(PAD, (host?.left ?? 0) + PAD)
  const high = Math.min(window.innerWidth - PAD, (host?.right ?? window.innerWidth) - PAD)
  const w = Math.max(MIN, Math.min(width, high - low))
  const top = r.bottom + 6
  return {
    position: 'fixed',
    left: Math.min(Math.max(low, r.right - w), Math.max(low, high - w)),
    top,
    width: w,
    maxHeight: Math.max(96, window.innerHeight - top - PAD),
    overflowY: 'auto'
  }
}
