import { execFile } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { isAbsolute, join, resolve } from 'path'

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal?.aborted) return rej(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      res()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      rej(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export function abortError(): Error {
  const e = new Error('aborted')
  e.name = 'AbortError'
  return e
}
export const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'

export function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Z0-9]|\r(?!\n)/g
export const stripAnsi = (s: string) => s.replace(ANSI, '')

export function clip(text: string, max = 24000, headRatio = 0.4): string {
  if (text.length <= max) return text
  const head = Math.floor(max * headRatio)
  const tail = max - head
  return `${text.slice(0, head)}\n\n[... ${text.length - max} حرفاً مقتطعاً ...]\n\n${text.slice(text.length - tail)}`
}

export function resolvePath(base: string, p: string): string {
  const clean = p.replace(/^["']|["']$/g, '')
  return isAbsolute(clean) ? resolve(clean) : resolve(base, clean)
}

export function underDir(dir: string, cwd: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const base = norm(dir)
  const c = norm(cwd)
  return c === base || c.startsWith(`${base}/`)
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

function resolveWinCmd(cmd: string): string {
  if (process.platform !== 'win32') return cmd
  if (/^[A-Za-z]:[\\/]/.test(cmd) || cmd.startsWith('\\\\')) return cmd
  if (cmd === 'git') return cmd
  const candidates: Record<string, string> = {
    powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    cmd: 'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe': 'C:\\Windows\\System32\\cmd.exe',
    node: 'node',
    npm: 'npm',
    npx: 'npx'
  }
  const low = cmd.toLowerCase()
  if (candidates[low]) {
    try {
      if (existsSync(candidates[low])) return candidates[low]
    } catch {}
  }
  return cmd
}

export function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number; shell?: boolean } = {}
): Promise<ExecResult> {
  return new Promise((res) => {
    const realCmd = resolveWinCmd(cmd)
    execFile(
      realCmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? 30000,
        shell: opts.shell,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8'
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
        res({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err ? err.message : '') })
      }
    )
  })
}

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export function slugify(s: string): string {
  const x = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return x || 'project'
}

export function safeCommitMessage(s: string, max = 120): string {
  const cleaned = s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[&|<>^"'`$;(){}[\]!*?~\\#%]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const out = [...cleaned].slice(0, max).join('')
  return out || 'checkpoint'
}

export function commitMessageArgs(s: string, max = 200): { args: string[]; cleanup?: () => void } {
  const trimmed = [...s.trim()].slice(0, max).join('') || 'checkpoint'
  try {
    const f = join(tmpdir(), `nt-commit-${process.pid}-${Date.now()}.txt`)
    writeFileSync(f, trimmed, 'utf8')
    return {
      args: ['-F', f],
      cleanup: () => { try { unlinkSync(f) } catch {} }
    }
  } catch {
    return { args: ['-m', safeCommitMessage(trimmed, max)] }
  }
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
