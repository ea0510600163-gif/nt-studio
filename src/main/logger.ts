import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

const secrets = new Set<string>()
export const registerSecret = (s: string) => { if (s && s.length > 8) secrets.add(s) }

export function redact(text: string): string {
  let out = text
  for (const secret of secrets) out = out.split(secret).join('[redacted]')
  return out
}

let dir = ''
const MAX = 2 * 1024 * 1024
let writeCounter = 0

function file() {
  if (!dir) {
    dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
  }
  const f = join(dir, 'app.log')
  writeCounter++
  if (writeCounter % 50 === 0) {
    try {
      if (existsSync(f) && statSync(f).size > MAX) {
        for (let i = 3; i >= 1; i--) {
          const from = i === 1 ? f : join(dir, `app.${i - 1}.log`)
          const to = join(dir, `app.${i}.log`)
          if (existsSync(to) && i === 3) unlinkSync(to)
          if (existsSync(from)) renameSync(from, to)
        }
      }
    } catch {}
  }
  return f
}

function writeStdout(line: string) {
  try { process.stdout.write(line) } catch {}
}

function write(level: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} [${level}] ${redact(msg)}${extra !== undefined ? ' ' + redact(safeJson(extra)) : ''}\n`
  try { appendFileSync(file(), line) } catch {}
  if (!app.isPackaged) writeStdout(line)
}

const safeJson = (x: unknown) => { try { return typeof x === 'string' ? x : JSON.stringify(x) } catch { return String(x) } }

export const log = {
  info: (m: string, x?: unknown) => write('info', m, x),
  warn: (m: string, x?: unknown) => write('warn', m, x),
  error: (m: string, x?: unknown) => write('error', m, x)
}
