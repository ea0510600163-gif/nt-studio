import type { TodoItem } from '@shared/types'

export interface PlanProgress {
  total: number
  done: number
  doing: number
  blocked: number
  pending: number
  pct: number
  current: TodoItem | null
}

export function planProgress(plan: readonly TodoItem[]): PlanProgress {
  const count = (s: TodoItem['status']): number => plan.filter((i) => i.status === s).length
  const total = plan.length
  const done = count('done')
  return {
    total,
    done,
    doing: count('doing'),
    blocked: count('blocked'),
    pending: count('pending'),
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    current: plan.find((i) => i.status === 'doing') ?? null
  }
}
