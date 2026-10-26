import type { ModelCost } from '../../shared/types.ts'
import type { LlmUsage } from './types.ts'

const MILLION = 1_000_000

export function stepCost(u: LlmUsage, c: ModelCost | undefined): number | undefined {
  if (!c) return undefined
  const at = (tokens: number, price: number) => (tokens / MILLION) * price
  return (
    at(u.input || 0, c.input) +
    at(u.output || 0, c.output) +
    at(u.cachedRead || 0, c.cacheRead ?? c.input) +
    at(u.cacheWrite || 0, c.cacheWrite ?? c.input)
  )
}

export function addCost(s: { cost?: number }, u: LlmUsage, c: ModelCost | undefined): number | undefined {
  const add = stepCost(u, c)
  if (add === undefined) return s.cost ?? undefined
  s.cost = Math.round(((s.cost ?? 0) + add) * 1e6) / 1e6
  return s.cost
}
