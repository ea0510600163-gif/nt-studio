import type { Bounds } from '@shared/types'

export const MIN_SIZE = 20

export type ClampReason = 'ok' | 'invalid' | 'offscreen' | 'degenerate'

export interface ClampResult {
  bounds: Bounds | null
  reason: ClampReason
}

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function isBounds(b: unknown): b is Bounds {
  if (!b || typeof b !== 'object') return false
  const r = b as Bounds
  return num(r.x) && num(r.y) && num(r.width) && num(r.height)
}

export function clampToContent(raw: unknown, contentW: number, contentH: number): ClampResult {
  if (!isBounds(raw)) return { bounds: null, reason: 'invalid' }
  if (!num(contentW) || !num(contentH) || contentW <= 0 || contentH <= 0) return { bounds: null, reason: 'offscreen' }

  const x = Math.max(0, Math.min(Math.round(raw.x), contentW))
  const y = Math.max(0, Math.min(Math.round(raw.y), contentH))
  const width = Math.max(0, Math.min(Math.round(raw.width), contentW - x))
  const height = Math.max(0, Math.min(Math.round(raw.height), contentH - y))
  if (width < MIN_SIZE || height < MIN_SIZE) return { bounds: null, reason: 'degenerate' }
  return { bounds: { x, y, width, height }, reason: 'ok' }
}

export function sameBounds(a: Bounds | null, b: Bounds | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export class BoundsSync {
  private seq = -1
  private epoch = 0
  private area: Bounds = { x: 0, y: 0, width: 0, height: 0 }

  accept(raw: unknown, seq?: number, epoch?: number): Bounds | null {
    if (epoch !== undefined && epoch !== this.epoch) return null
    if (num(seq)) {
      if (seq <= this.seq) return null
      this.seq = seq
    }
    if (!isBounds(raw)) return null
    this.area = { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
    return this.area
  }

  current(): Bounds {
    return this.area
  }

  reset(epoch = this.epoch): void {
    this.epoch = epoch
    this.seq = -1
    this.area = { x: 0, y: 0, width: 0, height: 0 }
  }
}
