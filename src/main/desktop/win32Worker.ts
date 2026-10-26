import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface Win32WindowInfo {
  hwnd: number
  title: string
  process: string
  pid: number
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  maximized: boolean
}

export interface Win32CursorState {
  x: number
  y: number
  screenW: number
  screenH: number
  activeTitle: string
  activeProc?: string
}

export interface Win32FocusResult {
  ok: boolean
  found: boolean
  focused: boolean
  activeTitle: string
  activeProc: string
}

export interface Win32UiElement {
  id: number
  role: string
  name: string
  cx: number
  cy: number
  x: number
  y: number
  width: number
  height: number
}

export interface Win32HitResult {
  role: string
  name: string
  cx: number
  cy: number
  x: number
  y: number
  width: number
  height: number
}

export function windowMatchesQuery(title: string, proc: string, query: string): boolean {
  let q = String(query ?? '').trim().toLowerCase()
  if (!q) return false
  if (q.endsWith('.exe')) q = q.slice(0, -4)
  const t = String(title ?? '').toLowerCase()
  const p = String(proc ?? '').toLowerCase()
  return (p.length > 0 && p.includes(q)) || t.includes(q)
}

import { PS_WORKER_SCRIPT } from './workerScript.ts'

interface PendingReq {
  resolve: (val: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class Win32Worker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private readyPromise: Promise<void> | null = null
  private seq = 0
  private bootId = 0
  private pending = new Map<number, PendingReq>()
  private buf = ''
  private scriptPath: string | null = null

  async ensure(): Promise<void> {
    if (this.proc && !this.proc.killed && this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise<void>((resolve, reject) => {
      try {
        const scriptPath = join(tmpdir(), `nt-studio-win32-worker-${process.pid}-${++this.bootId}.ps1`)
        writeFileSync(scriptPath, '\uFEFF' + PS_WORKER_SCRIPT, 'utf8')
        this.scriptPath = scriptPath
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
        )
        this.proc = child
        this.buf = ''
        let settled = false

        const bootTimer = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error('انتهت مهلة تشغيل محرك سطح المكتب Win32'))
            try { child.kill() } catch {}
          }
        }, 12000)

        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          this.buf += chunk
          let idx: number
          while ((idx = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, idx).trim()
            this.buf = this.buf.slice(idx + 1)
            if (!line || !line.startsWith('{')) continue
            try {
              const msg = JSON.parse(line)
              if (msg.ready && !settled) {
                settled = true
                clearTimeout(bootTimer)
                resolve()
                continue
              }
              if (typeof msg.id === 'number') {
                const p = this.pending.get(msg.id)
                if (p) {
                  this.pending.delete(msg.id)
                  clearTimeout(p.timer)
                  if (msg.ok === false) p.reject(new Error(msg.error || 'فشل أمر Win32'))
                  else p.resolve(msg)
                }
              }
            } catch {}
          }
        })

        child.stderr.setEncoding('utf8')
        child.stderr.on('data', () => {})

        child.on('error', (e) => {
          if (!settled) {
            settled = true
            clearTimeout(bootTimer)
            reject(e)
          }
          if (this.proc === child) {
            this.proc = null
            this.readyPromise = null
            this.rejectPending('تعذّر الاتصال بمحرك Win32')
          }
        })

        child.on('exit', () => {
          const ownsCurrent = this.proc === child
          if (this.scriptPath === scriptPath) this.scriptPath = null
          try { unlinkSync(scriptPath) } catch {}
          if (ownsCurrent) {
            this.proc = null
            this.readyPromise = null
            this.rejectPending('أُغلق محرك Win32')
          }
          if (!settled) {
            settled = true
            clearTimeout(bootTimer)
            reject(new Error('توقف محرك Win32 أثناء الإقلاع'))
          }
        })
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    return this.readyPromise
  }

  async call<T = any>(cmd: string, payload: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
    await this.ensure()
    if (!this.proc || this.proc.killed) throw new Error('محرك Win32 غير متاح')
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`انتهت مهلة أمر سطح المكتب (${cmd})`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const line = JSON.stringify({ id, cmd, ...payload }) + '\n'
      const failWrite = (e: Error) => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        clearTimeout(pending.timer)
        pending.reject(e)
      }
      try {
        this.proc!.stdin.write(line, 'utf8', (e) => { if (e) failWrite(e) })
      } catch (e) {
        failWrite(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  private rejectPending(message: string) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(message))
    }
    this.pending.clear()
  }

  private cleanupScript() {
    const f = this.scriptPath
    this.scriptPath = null
    if (f) { try { unlinkSync(f) } catch {} }
  }

  destroy() {
    this.rejectPending('أُوقف محرك Win32')
    this.cleanupScript()
    const child = this.proc
    this.proc = null
    this.readyPromise = null
    if (child) {
      try { child.stdin?.write('{"id":0,"cmd":"exit"}\n') } catch {}
      try { child.stdin?.end() } catch {}
      try { child.stdout?.removeAllListeners() } catch {}
      try { child.stderr?.removeAllListeners() } catch {}
      try { child.unref() } catch {}
      try { child.kill() } catch {}
    }
  }
}

export const win32Worker = new Win32Worker()
