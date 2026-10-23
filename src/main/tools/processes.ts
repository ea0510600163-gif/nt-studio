import { spawn as cpSpawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { send } from '../bus'
import { log } from '../logger'
import { stripAnsi, uid, underDir } from '../util'
import type { ProcInfo } from '@shared/types'
import { buildShellPlan, decodeConsoleText } from './psScript'

const MAX_BUF = 400_000

export interface Proc {
  id: string
  name: string
  command: string
  cwd: string
  startedAt: number
  owner?: string
  buf: string
  total: number
  readPos: number
  exitCode: number | null
  running: boolean
  pid: number
  write(data: string): void
  kill(): void
}

let pty: any = null
if (process.platform !== 'win32') {
  try {
    pty = require('node-pty')
  } catch (e) {
    log.warn('node-pty fallback child_process', String(e))
  }
}

export function killTree(pid: number) {
  if (!pid) return
  try {
    if (process.platform === 'win32') cpSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
    else process.kill(-pid, 'SIGKILL')
  } catch {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
}

class ProcessManager {
  private procs = new Map<string, Proc>()
  private counter = 0

  list(): ProcInfo[] {
    return [...this.procs.values()].map((p) => ({ id: p.id, name: p.name, command: p.command, running: p.running, exitCode: p.exitCode }))
  }
  get(id: string) {
    return this.procs.get(id)
  }
  private broadcast() {
    send('term:procs', this.list())
  }

  spawn(command: string, cwd: string, name?: string, owner?: string): Proc {
    const plan = buildShellPlan(command)
    const { file, args } = plan
    const id = `p${++this.counter}`
    const p: Proc = {
      id, name: name || `عملية ${this.counter}`, command, cwd, startedAt: Date.now(), owner,
      buf: '', total: 0, readPos: 0, exitCode: null, running: true, pid: 0,
      write: () => {}, kill: () => {}
    }
    const push = (d: string) => {
      p.buf += d
      p.total += d.length
      if (p.buf.length > MAX_BUF) p.buf = p.buf.slice(p.buf.length - MAX_BUF)
      send('term:data', { id, data: d })
    }
    const done = (code: number | null) => {
      if (!p.running) return
      p.running = false
      p.exitCode = code ?? -1
      push(`\r\n\x1b[90m[انتهت العملية برمز ${p.exitCode}]\x1b[0m\r\n`)
      plan.cleanup?.()
      this.broadcast()
    }
    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', npm_config_yes: 'true' } as Record<string, string>
    push(`\x1b[38;5;179m❯ ${command}\x1b[0m\r\n`)
    p.readPos = p.total

    let started = false
    if (pty) {
      try {
        const t = pty.spawn(file, args, { name: 'xterm-color', cols: 160, rows: 40, cwd, env })
        p.pid = t.pid
        t.onData((d: string) => push(d))
        t.onExit((e: { exitCode: number }) => done(e.exitCode))
        p.write = (d) => t.write(d)
        p.kill = () => { killTree(t.pid); try { t.kill() } catch {} }
        started = true
      } catch (e) {
        log.warn('فشل node-pty، تحويل إلى child_process', String(e))
      }
    }
    if (!started) {
      let c: ChildProcess | null = null
      try {
        c = cpSpawn(file, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' })
      } catch (e) {
        push(`\r\n[خطأ تشغيل: ${(e as Error).message}]\r\n`)
        if (process.platform === 'win32' && file.toLowerCase().includes('powershell')) {
          try {
            const cmdFile = 'C:\\Windows\\System32\\cmd.exe'
            const realCmd = existsSync(cmdFile) ? cmdFile : 'cmd.exe'
            c = cpSpawn(realCmd, ['/d', '/s', '/c', `chcp 65001>nul & ${command}`], { cwd, env, windowsHide: true, detached: false })
          } catch (e2) {
            push(`\r\n[فشل حتى مع cmd.exe: ${(e2 as Error).message}]\r\n`)
            done(-1)
            this.procs.set(id, p)
            this.broadcast()
            return p
          }
        } else {
          done(-1)
          this.procs.set(id, p)
          this.broadcast()
          return p
        }
      }
      const proc = c!
      p.pid = proc.pid ?? 0
      const onData = (d: Buffer) => push(decodeConsoleText(d).replace(/\r?\n/g, '\r\n'))
      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)
      proc.on('error', (e) => { push(`\r\n[خطأ تشغيل: ${e.message}]\r\n`); done(-1) })
      let exitTimer: ReturnType<typeof setTimeout> | undefined
      proc.on('exit', (code) => {
        exitTimer = setTimeout(() => done(code), 250)
      })
      proc.on('close', (code) => {
        if (exitTimer) clearTimeout(exitTimer)
        done(code)
      })
      p.write = (d) => proc.stdin?.write(d)
      p.kill = () => killTree(proc.pid ?? 0)
    }
    this.procs.set(id, p)
    this.broadcast()
    return p
  }

  readNew(p: Proc, mark = true): string {
    const newChars = p.total - p.readPos
    const text = newChars > 0 ? p.buf.slice(Math.max(0, p.buf.length - newChars)) : ''
    if (mark) p.readPos = p.total
    return stripAnsi(text)
  }

  stop(id: string) {
    const p = this.procs.get(id)
    if (p?.running) p.kill()
  }
  killByOwner(owner: string) {
    for (const p of this.procs.values()) if (p.running && p.owner === owner) p.kill()
  }
  killUnder(dir: string) {
    for (const p of this.procs.values()) if (p.running && underDir(dir, p.cwd)) p.kill()
  }
  killAll() {
    for (const p of this.procs.values()) if (p.running) p.kill()
  }
}

export const processes = new ProcessManager()

export function detectUrls(text: string): string[] {
  const set = new Set<string>()
  const re = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[0-9a-f:.]+\]):(\d{2,5})[^\s'")\]]*/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stripAnsi(text)))) set.add(m[0].replace('0.0.0.0', 'localhost'))
  return [...set]
}

export { uid }
