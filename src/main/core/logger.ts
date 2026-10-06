import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * سجل مركزي: ملفات يومية + حلقة أخيرة في الذاكرة ترسل للواجهة.
 * كل ما يمر هنا يُنقّى من الأسرار قبل الكتابة أو الإرسال.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LogEntry {
  ts: number
  level: LogLevel
  scope: string
  msg: string
  data?: unknown
}

/** يبتلع الأسرار قبل أن تصل إلى القرص أو الواجهة. */
export function redact(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, '$1***')
    .replace(/("(?:apiKey|api_key|key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/gi, '$1***$2')
    .replace(/((?:apiKey|api_key|token|secret|password)\s*=\s*)[^\s&]+/gi, '$1***')
}

export interface LoggerOptions {
  dir: string
  minLevel?: LogLevel
  ringSize?: number
  /** يُستدعى عند كل سطر — تستخدمه العملية الرئيسية لبثّ الأحداث للواجهة. */
  sink?: (entry: LogEntry) => void
}

export class Logger {
  private readonly minLevel: LogLevel
  private readonly ringSize: number
  private readonly sink: ((entry: LogEntry) => void) | undefined
  readonly ring: LogEntry[] = []
  private fileFailed = false

  constructor(private readonly opts: LoggerOptions) {
    this.minLevel = opts.minLevel ?? 'info'
    this.ringSize = opts.ringSize ?? 500
    this.sink = opts.sink
    try {
      mkdirSync(opts.dir, { recursive: true })
    } catch {
      this.fileFailed = true
    }
  }

  child(scope: string): ScopedLogger {
    return new ScopedLogger(this, scope)
  }

  recent(): LogEntry[] {
    return [...this.ring]
  }

  write(level: LogLevel, scope: string, msg: string, data?: unknown): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return
    let safeMsg = redact(String(msg))
    let safeData = data
    if (data !== undefined) {
      let serialized: string
      try {
        serialized = JSON.stringify(data)
      } catch {
        serialized = String(data)
      }
      safeData = redact(serialized)
    }
    const entry: LogEntry = { ts: Date.now(), level, scope, msg: safeMsg, data: safeData }

    this.ring.push(entry)
    if (this.ring.length > this.ringSize) this.ring.shift()

    this.sink?.(entry)

    if (this.fileFailed) return
    const day = new Date(entry.ts).toISOString().slice(0, 10)
    const time = new Date(entry.ts).toISOString().slice(11, 23)
    const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${safeMsg}${
      safeData !== undefined ? ` ${safeData}` : ''
    }\n`
    try {
      appendFileSync(path.join(this.opts.dir, `studio-${day}.log`), line, 'utf8')
    } catch {
      this.fileFailed = true
    }
  }
}

export class ScopedLogger {
  constructor(
    private readonly parent: Logger,
    private readonly scope: string,
  ) {}

  child(scope: string): ScopedLogger {
    return new ScopedLogger(this.parent, `${this.scope}:${scope}`)
  }

  debug = (msg: string, data?: unknown): void => this.parent.write('debug', this.scope, msg, data)
  info = (msg: string, data?: unknown): void => this.parent.write('info', this.scope, msg, data)
  warn = (msg: string, data?: unknown): void => this.parent.write('warn', this.scope, msg, data)
  error = (msg: string, data?: unknown): void => this.parent.write('error', this.scope, msg, data)
}