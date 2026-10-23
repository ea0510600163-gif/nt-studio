import { LIMITS } from '../config.ts'
import { abortError, sleep } from '../util.ts'
import { LlmError } from './types.ts'
import { isHopelessWait, retryDelayMs, PERSISTENT_FAIL_CAP } from './retryPolicy.ts'

export interface RetryInfo {
  attempt: number
  delayMs: number
  error: LlmError
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { signal: AbortSignal; onRetry: (i: RetryInfo) => void; maxAttempts?: number }
): Promise<T> {
  const max = opts.maxAttempts ?? LIMITS.retryAttempts
  for (let attempt = 1; ; attempt++) {
    if (opts.signal.aborted) throw abortError()
    try {
      return await fn(attempt)
    } catch (e) {
      if (opts.signal.aborted) throw abortError()
      if (!(e instanceof LlmError) || !e.retryable || attempt >= max || attempt >= PERSISTENT_FAIL_CAP) throw e
      if (isHopelessWait(e.retryAfterMs)) throw e
      const delayMs = retryDelayMs(attempt, e.retryAfterMs)
      opts.onRetry({ attempt, delayMs, error: e })
      await sleep(delayMs, opts.signal)
    }
  }
}

export function classifyStatus(status: number): { retryable: boolean } {
  return { retryable: [408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529].includes(status) }
}

export function parseRetryAfter(h: Headers): number | undefined {
  const ms = h.get('retry-after-ms')
  if (ms && !isNaN(+ms)) return +ms
  const ra = h.get('retry-after')
  if (!ra) return undefined
  if (!isNaN(+ra)) return +ra * 1000
  const d = Date.parse(ra)
  return isNaN(d) ? undefined : Math.max(0, d - Date.now())
}
