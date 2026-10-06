import { spawn } from 'node:child_process'
import type { ToolContext } from '../types'
import { truncate } from '../types'

/**
 * تنفيذ الأوامر.
 *
 * مبادئ:
 *  - stdout/stderr يُبثّان حيًّا إلى لوحة الطرفية (شعور التقدّم).
 *  - المخرجات كبيرة ⇒ تُبتر من المنتصف لا من النهاية (النهاية فيها الخطأ عادةً).
 *  - الإيقاف يُنهي العملية فعلًا (SIGTERM ثم SIGKILL).
 *  - لا interactive stdin ⇒ npm لن يطلب موافقة.
 */

export interface ExecResult {
  code: number | null
  output: string
  timedOut: boolean
  aborted: boolean
}

export async function execCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  t: ToolContext,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        cwd,
        env: { ...process.env, FORCE_COLOR: '1', CI: '1', NO_COLOR: '' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let output = ''
    let timedOut = false
    let aborted = false
    let settled = false

    const emit = (type: 'stdout' | 'stderr', data: string): void => {
      output += data
      if (output.length > 200_000) output = output.slice(-150_000)
      t.emit({ type: 'notice', level: type === 'stderr' ? 'warn' : 'info', message: data })
    }

    child.stdout?.on('data', (d: Buffer) => emit('stdout', d.toString()))
    child.stderr?.on('data', (d: Buffer) => emit('stderr', d.toString()))

    const timer = setTimeout(() => {
      timedOut = true
      kill(child.pid)
    }, timeoutMs)

    const onAbort = (): void => {
      aborted = true
      kill(child.pid)
    }
    t.signal.addEventListener('abort', onAbort, { once: true })

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      t.signal.removeEventListener('abort', onAbort)
      resolve({ code, output, timedOut, aborted })
    }

    child.on('close', (code) => finish(code))
    child.on('error', (e) => {
      output += `\n[spawn error] ${e.message}`
      finish(-1)
    })

    function kill(pid: number | undefined): void {
      if (pid === undefined) return
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }
  })
}

/** نسخة مختصرة للاختبار. */
export function execForTest(command: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()))
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve({ code: -1, output: `${truncate(output)}\n[timed out]`, timedOut: true, aborted: false })
    }, timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output, timedOut: false, aborted: false })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, output: e.message, timedOut: false, aborted: false })
    })
  })
}