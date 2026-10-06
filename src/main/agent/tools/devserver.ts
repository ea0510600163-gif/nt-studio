import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import type { AppContext } from '../../core/context'
import type { ToolContext } from '../types'
import { detectProjectKind, readPackageJson } from './fs-scan'

/**
 * مدير خادم التطوير.
 *
 * المشكلة التي يعاني منها كل وكيل مبسط: منافذ ثابتة (5180) تنكسر عند التشغيل
 * الثاني، وعدم انتظار الجاهزية يعني أن المعاينة تفتح على صفحة فارغة.
 * الحل هنا: منفذ حر يُحجز فعليًا، وانتظار حتى يردّ الخادم، وربط العملية
 * بـ previewController تلقائيًا.
 */

interface RunningServer {
  child: ChildProcess | null
  pid: number | undefined
  url: string
  port: number
  cwd: string
  command: string
  startedAt: number
}

const servers = new Map<string, RunningServer>()

/** يحجز منفذًا حرًّا فعليًا عبر الاستماع ثم الإغلاق (حجز حقيقي، لا تخمين). */
export function findFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', () => {
      if (preferred && preferred > 0) {
        // المفضّل محجوز — ابحث عن أي منفذ حر
        const any = createServer()
        any.unref()
        any.on('error', reject)
        any.listen(0, '127.0.0.1', () => {
          const port = (any.address() as { port: number }).port
          any.close(() => resolve(port))
        })
      } else {
        reject(new Error('no free port'))
      }
    })
    const tryPort = preferred && preferred > 0 ? preferred : 0
    probe.listen(tryPort, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })
}

/** ينتظر حتى يستجيب العنوان بحالة HTTP (أو يفشل). */
async function waitForReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2500) })
      // أي استجابة = الخادم يعمل (404 OK لأن المسار الجذر قد لا يوجد)
      if (res.status > 0) return true
    } catch {
      /* لم يجهز بعد */
    }
    await new Promise((r) => setTimeout(r, 600))
  }
  return false
}

const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/\S*)?)/i

export interface StartOptions {
  cwd: string
  command?: string
  preferredPort?: number
  ctx: AppContext
  signal: AbortSignal
  emit: ToolContext['emit']
}

export interface StartResult {
  url: string
  port: number
  pid: number | undefined
  command: string
}

export async function startDevServer(opts: StartOptions): Promise<StartResult> {
  await stopDevServer(opts.ctx)

  const kind = await detectProjectKind(opts.cwd)
  const pkg = await readPackageJson(opts.cwd)

  if (kind === 'static' || (!pkg && kind !== 'node')) {
    // مشروع ثابت بلا خادم: نخدمه عبر خادم محلي خفيف بدل file://
    // (file:// يمنع جلب الوحدات عبر ESM، ويفشل معه كل تطبيق حديث)
    const port = await findFreePort(opts.preferredPort)
    const url = `http://127.0.0.1:${port}`
    const { serveStatic } = await import('./static-server')
    const stop = await serveStatic(opts.cwd, port, opts.ctx)
    servers.set('static', {
      child: null,
      pid: undefined,
      url,
      port,
      cwd: opts.cwd,
      command: 'internal static server',
      startedAt: Date.now(),
    })
    opts.emit({ type: 'status', phase: 'starting', detail: url })
    opts.emit({ type: 'notice', level: 'info', message: `Static server on ${url} (${stop})` })
    return { url, port, pid: undefined, command: 'internal static server' }
  }

  const scripts = pkg?.scripts ?? {}
  const base = scripts.dev ?? scripts.start ?? scripts.serve
  const port = await findFreePort(opts.preferredPort)

  let command: string
  if (opts.command) {
    command = opts.command
  } else if (base) {
    command = withPort(base, port)
  } else {
    command = `npx --yes vite --port ${port} --strictPort`
  }

  opts.emit({ type: 'status', phase: 'starting', detail: command })

  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: opts.cwd,
    env: { ...process.env, FORCE_COLOR: '1', BROWSER: 'none', CI: '' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let detectedUrl: string | null = null
  let output = ''

  const scan = (chunk: string): void => {
    output += chunk
    if (output.length > 120_000) output = output.slice(-80_000)
    opts.emit({ type: 'notice', level: 'info', message: chunk })
    if (!detectedUrl) {
      const m = URL_RE.exec(output)
      if (m?.[1]) detectedUrl = m[1].replace(/\/+$/, '') || null
    }
  }
  child.stdout?.on('data', (d: Buffer) => scan(d.toString()))
  child.stderr?.on('data', (d: Buffer) => scan(d.toString()))

  const expected = `http://127.0.0.1:${port}`

  const ready = await waitForReady(detectedUrl ?? expected, 90_000)
  const url = detectedUrl ?? expected

  if (!ready) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
    throw new Error(
      `Dev server did not become ready within 90s.\ncommand: ${command}\nexpected: ${expected}\noutput:\n${output.slice(-3_000)}`,
    )
  }

  servers.set(opts.cwd, { child, pid: child.pid, url, port, cwd: opts.cwd, command, startedAt: Date.now() })
  opts.emit({ type: 'status', phase: 'starting', detail: url })

  const onAbort = (): void => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  opts.signal.addEventListener('abort', onAbort, { once: true })

  return { url, port, pid: child.pid, command }
}

export async function stopDevServer(ctx: AppContext): Promise<boolean> {
  const list = [...servers.values()]
  servers.clear()
  if (list.length === 0) return false
  for (const s of list) {
    try {
      if (s.pid) {
        spawn('taskkill', ['/pid', String(s.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      }
    } catch {
      /* ignore */
    }
  }
  void ctx
  return true
}

export function currentServer(cwd: string): RunningServer | undefined {
  return servers.get(cwd) ?? servers.get('static')
}

/** يضيف ‎--port‎ للأمر إن كان من نوع Vite/npm-run. */
function withPort(script: string, port: number): string {
  const trimmed = script.trim()
  if (/\s--port\b/.test(trimmed)) return trimmed.replace(/\s--port\s+\S+/, ` --port ${port}`)
  if (/\bvite\b/.test(trimmed)) return `${trimmed} -- --port ${port} --strictPort`
  if (/\bnext\b/.test(trimmed)) return `${trimmed} -- -p ${port}`
  if (/\bnuxt\b/.test(trimmed)) return `${trimmed} --port ${port}`
  if (/\bwebpack-dev-server\b|\breact-scripts\b|\bparcel\b/.test(trimmed)) return `${trimmed} --port ${port}`
  return trimmed
}

export const __testing = { servers }