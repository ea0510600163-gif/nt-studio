import { clip, resolvePath, sleep, abortError } from '../util'
import { detectUrls, processes } from './processes'
import { arabicPathAdvice, commandNotFoundAdvice, installNote, powerShellParseAdvice } from './shellAdvice'
import { Tool, fail, ok, schema } from './types'

const waitFor = async (cond: () => boolean, ms: number, signal: AbortSignal, step = 150) => {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await sleep(step, signal)
}

export const shellTools: Tool[] = [
  {
    name: 'run_command',
    phase: 'acting',
    description:
      'Execute a PowerShell command with full privileges. Returns exit code and output for foreground commands, or process_id and initial output when background=true.',
    schema: schema(
      {
        command: { type: 'string', description: 'PowerShell command string (chain with ";")' },
        cwd: { type: 'string', description: 'Working directory (default: active project/workspace root)' },
        background: { type: 'boolean', description: 'Run as a background process (for dev servers or watchers)' },
        name: { type: 'string', description: 'Optional label for the process' },
        timeout_sec: { type: 'number', description: 'Foreground timeout in seconds (5–1800)' }
      },
      ['command']
    ),
    async run(i, ctx) {
      const cwd = resolvePath(ctx.cwd(), i.cwd ?? '.')
      const p = processes.spawn(String(i.command), cwd, i.name, ctx.sessionId)
      const onAbort = () => p.kill()
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      try {
        if (i.background) {
          await waitFor(() => !p.running || detectUrls(p.buf).length > 0, 5000, ctx.signal)
          const out = processes.readNew(p)
          const urls = detectUrls(p.buf)
          return ok(
            `process_id: ${p.id}  (${p.running ? 'يعمل' : `انتهى برمز ${p.exitCode}`})\n` +
              (urls.length ? `urls: ${urls.join(', ')}\n` : '') +
              `--- أول مخرجات ---\n${clip(out, 4000) || '(لا مخرجات بعد؛ استخدم read_process_output)'}`
          )
        }
        const limit = Math.min(Math.max(Number(i.timeout_sec) || ctx.settings().commandTimeoutSec, 5), 1800) * 1000
        await waitFor(() => !p.running, limit, ctx.signal, 100)
        if (ctx.signal.aborted) throw abortError()
        const out = clip(processes.readNew(p), 50000)
        if (p.running) {
          const urls = detectUrls(p.buf)
          p.kill()
          return fail(
            `⏱ تجاوز المهلة (${limit / 1000}ث) وتم إيقاف الأمر. إن كان خادماً مستمراً فاستخدم background=true. ${urls.length ? 'لوحظت الروابط: ' + urls.join(', ') : ''}\n--- المخرجات حتى الآن ---\n${out}`
          )
        }
        const body = `exit code: ${p.exitCode}\n--- output ---\n${out || '(لا مخرجات)'}`
        if (p.exitCode === 0) {
          const notes = [installNote(String(i.command)), arabicPathAdvice(String(i.command))].filter(Boolean)
          return ok(notes.length ? `${body}\n\n${notes.join('\n\n')}` : body)
        }
        const sections = [commandNotFoundAdvice(String(i.command), out), powerShellParseAdvice(String(i.command), out), arabicPathAdvice(String(i.command))].filter(Boolean)
        return fail(sections.length ? `${body}\n\n--- تشخيص ---\n${sections.join('\n\n')}` : body)
      } finally {
        ctx.signal.removeEventListener('abort', onAbort)
      }
    }
  },
  {
    name: 'read_process_output',
    parallel: true,
    description: 'Read new stdout/stderr output and status from a background process started by run_command.',
    schema: schema(
      {
        id: { type: 'string', description: 'process_id returned by run_command' },
        wait_ms: { type: 'number', description: 'Milliseconds to wait for new output (default 1000, max 30000)' }
      },
      ['id']
    ),
    async run(i, ctx) {
      const p = processes.get(String(i.id))
      if (!p) return fail(`لا توجد عملية بالمعرّف ${i.id}. استخدم list_processes.`)
      const start = p.total
      await waitFor(() => p.total > start || !p.running, Math.min(Number(i.wait_ms) || 1000, 30000), ctx.signal)
      const out = clip(processes.readNew(p), 30000)
      const urls = detectUrls(p.buf)
      return ok(`${p.running ? 'يعمل' : `انتهى برمز ${p.exitCode}`}${urls.length ? ' | ' + urls.join(', ') : ''}\n--- جديد ---\n${out || '(لا جديد)'}`)
    }
  },
  {
    name: 'send_process_input',
    description: 'Send stdin text to a running background process.',
    schema: schema(
      {
        id: { type: 'string', description: 'process_id' },
        input: { type: 'string', description: 'Text to send' },
        press_enter: { type: 'boolean', description: 'Append Enter key (default true)' }
      },
      ['id', 'input']
    ),
    async run(i, ctx) {
      if (ctx.signal.aborted) return fail('أُوقف: هذه الجلسة متوقفة.')
      const p = processes.get(String(i.id))
      if (!p || !p.running) return fail('العملية غير موجودة أو انتهت.')
      p.write(String(i.input) + (i.press_enter === false ? '' : '\r'))
      return ok('أُرسل.')
    }
  },
  {
    name: 'stop_process',
    description: 'Terminate a background process and its child tree.',
    schema: schema({ id: { type: 'string', description: 'process_id to stop' } }, ['id']),
    async run(i) {
      const p = processes.get(String(i.id))
      if (!p) return fail('عملية غير موجودة.')
      processes.stop(p.id)
      await sleep(300)
      return ok('أُوقفت.')
    }
  },
  {
    name: 'list_processes',
    parallel: true,
    description: 'List all processes started in this session with their id, running status, exit code, and command.',
    schema: schema({}),
    async run() {
      const l = processes.list()
      return ok(l.length ? l.map((p) => `${p.id}  ${p.running ? 'يعمل' : 'انتهى(' + p.exitCode + ')'}  ${p.name}  —  ${p.command.slice(0, 100)}`).join('\n') : 'لا عمليات.')
    }
  }
]
