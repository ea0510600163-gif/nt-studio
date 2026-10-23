import type { ModelRef } from '@shared/types'

export function pickModelRef<T>(
  candidates: (ModelRef | null | undefined)[],
  resolve: (ref: ModelRef | null | undefined) => T | null
): T | null {
  for (const c of candidates) {
    const hit = resolve(c)
    if (hit) return hit
  }
  return null
}
