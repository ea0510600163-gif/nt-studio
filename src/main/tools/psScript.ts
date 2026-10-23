import { spawn } from 'child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const NON_ASCII_RE = /[^\x00-\x7F]/
const ASCII_PATH_RE = /^[\x20-\x7E]*$/

export const isAsciiPath = (p: string): boolean => ASCII_PATH_RE.test(String(p ?? ''))

export function needsScriptFile(command: string): boolean {
  const cmd = String(command ?? '')
  if (/[\r\n]/.test(cmd)) return true
  if (NON_ASCII_RE.test(cmd)) return true
  if ((cmd.match(/"/g) ?? []).length >= 2) return true
  if (/@'|@"/.test(cmd)) return true
  return false
}

export function scriptPrelude(): string {
  return [
    '$ErrorActionPreference = "Continue"',
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
    '$env:PYTHONIOENCODING = "utf-8"',
    '$env:PYTHONUTF8 = "1"',
    'try { & chcp.com 65001 > $null } catch { }',
    "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path",
    '$ProgressPreference = "SilentlyContinue"'
  ].join('\n')
}

interface PowerShellChoice {
  ok: boolean
  file: string
  switches: string[]
}

export function resolveWindowsPowerShell(): PowerShellChoice {
  const candidates = [
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe'
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) return { ok: true, file: p, switches: ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass'] }
    } catch {}
  }
  return { ok: true, file: 'powershell.exe', switches: ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass'] }
}

function writableDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const probe = join(dir, `nt-probe-${process.pid}-${Date.now()}.tmp`)
    writeFileSync(probe, 'ok', 'utf8')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

export function pickAsciiTempDir(preferred?: string): string {
  const base = preferred || tmpdir()
  if (isAsciiPath(base) && writableDir(base)) return base
  if (writableDir('C:\\Windows\\Temp')) return 'C:\\Windows\\Temp'
  return base
}

export interface ShellPlan {
  file: string
  args: string[]
  cleanup?: () => void
  usedScriptFile: boolean
}

let scriptSeq = 0

export function buildShellPlan(command: string, opts: { platform?: NodeJS.Platform; tmpDir?: string } = {}): ShellPlan {
  const platform = opts.platform ?? process.platform
  const cmd = String(command ?? '')
  if (platform !== 'win32') return { file: 'bash', args: ['-lc', cmd], usedScriptFile: false }

  const sh = resolveWindowsPowerShell()
  if (!sh.ok) {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `chcp 65001>nul & ${cmd}`], usedScriptFile: false }
  }

  const body = `${scriptPrelude()}\n${cmd}\n`
  if (needsScriptFile(cmd)) {
    try {
      const dir = pickAsciiTempDir(opts.tmpDir)
      const scriptPath = join(dir, `nt-cmd-${process.pid}-${++scriptSeq}-${Date.now().toString(36)}.ps1`)
      writeFileSync(scriptPath, '\uFEFF' + body, 'utf8')
      return {
        file: sh.file,
        args: [...sh.switches, '-File', scriptPath],
        usedScriptFile: true,
        cleanup: () => {
          try {
            unlinkSync(scriptPath)
          } catch {}
        }
      }
    } catch {}
  }
  return { file: sh.file, args: [...sh.switches, '-Command', body], usedScriptFile: false }
}

export function decodeConsoleText(buf: Buffer | string): string {
  if (typeof buf === 'string') return buf
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    const legacy = new TextDecoder('windows-1256').decode(buf)
    const bad = (s: string) => (s.match(/\uFFFD/g) ?? []).length
    return bad(legacy) < bad(utf8) ? legacy : utf8
  } catch {
    return utf8
  }
}

export interface SafeRunResult {
  code: number
  stdout: string
  stderr: string
  usedScriptFile: boolean
}

export function runShell(
  command: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; platform?: NodeJS.Platform } = {}
): Promise<SafeRunResult> {
  const plan = buildShellPlan(command, { platform: opts.platform })
  return new Promise((resolve) => {
    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...(opts.env ?? {}) } as Record<string, string>
    let child: ReturnType<typeof spawn> | null = null
    let settled = false
    const finish = (code: number, stdout: string, stderr: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      plan.cleanup?.()
      resolve({ code, stdout, stderr, usedScriptFile: plan.usedScriptFile })
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      child = spawn(plan.file, plan.args, { cwd: opts.cwd, env, windowsHide: true })
    } catch (e) {
      return finish(1, '', `تعذّر تشغيل الأوامر: ${(e as Error).message}`)
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (d: Buffer) => out.push(d))
    child.stderr?.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => finish(1, Buffer.concat(out).toString('utf8'), `تعذّر تشغيل الأوامر: ${e.message}`))
    child.on('close', (code: number | null) =>
      finish(code ?? 1, decodeConsoleText(Buffer.concat(out)), decodeConsoleText(Buffer.concat(err)))
    )
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child?.kill()
        } catch {}
        finish(124, decodeConsoleText(Buffer.concat(out)), `انتهت المهلة (${opts.timeoutMs}ms) — أُوقف الأمر.`)
      }, opts.timeoutMs)
    }
  })
}
