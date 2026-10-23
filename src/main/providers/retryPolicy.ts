export const RETRY_WAIT_CAP_MS = 120_000

const BASE_MS = 2_000
const MAX_BASE_MS = 30_000

export function retryDelayMs(attempt: number, retryAfterMs?: number, rand: () => number = Math.random): number {
  const base = Math.min(BASE_MS * attempt, MAX_BASE_MS)
  const jittered = base * (0.8 + rand() * 0.2)
  return Math.min(Math.max(jittered, retryAfterMs ?? 0), RETRY_WAIT_CAP_MS)
}

export function isHopelessWait(retryAfterMs?: number): boolean {
  return retryAfterMs !== undefined && retryAfterMs > RETRY_WAIT_CAP_MS
}

export const PERSISTENT_FAIL_CAP = 10
