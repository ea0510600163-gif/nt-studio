import { LIMITS } from '../config.ts'
import { abortError } from '../util.ts'
import { LlmError } from './types.ts'
import { classifyStatus, parseRetryAfter } from './retry.ts'

const NON_SSE_SNIFF_CHARS = 8192

async function readSome(res: Response, max = NON_SSE_SNIFF_CHARS): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let out = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out += dec.decode(value, { stream: true })
      if (out.length >= max) return out.slice(0, max)
    }
  } catch {} finally {
    try { await reader.cancel() } catch {}
  }
  return out
}

function bestEffortMessage(text: string): string {
  const raw = (text ?? '').trim()
  try {
    const j = JSON.parse(raw)
    const m = j?.error?.message ?? j?.error ?? j?.message
    if (typeof m === 'string' && m.trim()) return m.slice(0, 600)
    if (m !== undefined && m !== null) return JSON.stringify(m).slice(0, 600)
  } catch {}
  return raw ? raw.slice(0, 600) : 'بلا محتوى'
}

export function httpError(res: Response, text: string): LlmError {
  let msg = text.slice(0, 600)
  try {
    const j = JSON.parse(text)
    msg = j?.error?.message ?? j?.message ?? j?.error ?? msg
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
  } catch {}
  const CTX_WORDS = /context|too long|too large|maximum.*(token|length)|exceed|window|السياق|上下文|トークン/i
  const ctx = ([400, 413, 422, 429].includes(res.status)) && CTX_WORDS.test(msg)
  const kind = res.status === 401 || res.status === 403 ? 'auth' : ctx ? 'context' : 'other'
  return new LlmError(`HTTP ${res.status}: ${msg}`, res.status, classifyStatus(res.status).retryable, parseRetryAfter(res.headers), kind)
}

export async function postSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  onData: (data: string) => void,
  idleMs?: number,
  connectMs?: number
): Promise<void> {
  if (signal.aborted) throw abortError()
  const ctl = new AbortController()
  let phase: 'connect' | 'stream' = 'connect'
  let idleTimer: NodeJS.Timeout | undefined
  let connectTimer: NodeJS.Timeout | undefined
  const effIdleMs = idleMs ?? LIMITS.llmIdleMs
  const effConnectMs = connectMs ?? LIMITS.llmConnectMs
  const armIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      phase = 'stream'
      ctl.abort()
    }, effIdleMs)
  }
  const onAbort = () => ctl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const fail = (e: unknown): never => {
    if (signal.aborted) throw abortError()
    if (e instanceof LlmError) throw e
    const why =
      phase === 'connect'
        ? `لم تصل ترويسات الرد خلال ${effConnectMs / 1000} ثانية`
        : `انقطع البث: لا بيانات منذ ${effIdleMs / 1000} ثانية`
    throw new LlmError(`${why} (${(e as Error)?.message ?? e})`, undefined, true)
  }
  try {
    connectTimer = setTimeout(() => ctl.abort(), effConnectMs)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal
    }).catch(fail)
    clearTimeout(connectTimer)
    if (!res.ok) throw httpError(res, await res.text().catch(() => ''))
    const ct = res.headers.get('content-type')
    if (ct && !ct.includes('text/event-stream')) {
      const raw = await readSome(res)
      if (signal.aborted) throw abortError()
      const msg = bestEffortMessage(raw)
      const transient = classifyStatus(res.status).retryable || /overload|rate|busy|timeout|temporar|unavailable|try again|bad gateway|502|503|504/i.test(msg)
      throw new LlmError(
        `المزوّد أجاب بـ ${ct.slice(0, 80)} بدل بثّ SSE: ${msg}`,
        res.status,
        transient,
        parseRetryAfter(res.headers)
      )
    }
    if (!res.body) throw new LlmError('استجابة بلا محتوى', res.status, true)
    phase = 'stream'
    armIdle()
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const chunk = await reader.read().catch(fail)
      if (chunk.done) break
      armIdle()
      buf += dec.decode(chunk.value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line.startsWith('data:')) {
          const d = line.slice(5).trim()
          if (d) onData(d)
        }
      }
    }
    const rest = buf.trim()
    if (rest.startsWith('data:')) onData(rest.slice(5).trim())
  } finally {
    clearTimeout(idleTimer)
    clearTimeout(connectTimer)
    signal.removeEventListener('abort', onAbort)
  }
}

export function parseArgs(raw: string): any {
  const s = raw.trim()
  if (!s) return {}
  try {
    let v = JSON.parse(s)
    if (typeof v === 'string') v = JSON.parse(v)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
    return { __parse_error: 'يجب أن تكون المعطيات كائن JSON' }
  } catch (e) {
    return {
      __parse_error: `JSON غير صالح (${(e as Error).message}) بطول ${s.length} حرفاً. السبب المرجّح: الرد قُطع عند حد الإخراج قبل إغلاق الكائن. قسّم الملف على أجزاء (append=true) أو وزّعه على عدة ملفات.`,
      __raw_head: s.slice(0, 200)
    }
  }
}
