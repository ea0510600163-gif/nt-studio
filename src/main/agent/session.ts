import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppContext } from '../core/context'
import { runAgent, type RunResult } from './loop'
import type { AgentEvent } from './types'

/**
 * مدير الجلسات.
 *
 * لكل جلسة: سجل كامل على القرص (.agent/session-*.jsonl) يسمح بالاستئناف بعد
 * إغلاق التطبيق — وهذا ما يجعل المشروع "ذاكرته قويّة" فعليًا لا مجرد كلام.
 */

export interface SessionRecord {
  id: string
  projectPath: string | null
  providerId: string
  modelId: string
  prompt: string
  status: 'running' | 'done' | 'error' | 'aborted' | 'needs-input'
  startedAt: number
  endedAt: number | null
  summary: string
  verified: boolean
}

interface SessionRuntime {
  id: string
  projectPath: string | null
  abort: AbortController
  startedAt: number
  active: boolean
}

const runtimes = new Map<string, SessionRuntime>()

export class AgentRunner {
  private current: SessionRuntime | null = null

  constructor(private readonly ctx: AppContext) {}

  isRunning(): boolean {
    return this.current?.active === true
  }

  currentSession(): string | null {
    return this.current?.id ?? null
  }

  stop(): boolean {
    if (!this.current?.active) return false
    this.current.abort.abort()
    return true
  }

  async run(input: {
    prompt: string
    providerId: string
    modelId: string
    projectPath: string | null
    onEvent: (event: AgentEvent) => void
  }): Promise<RunResult> {
    if (this.current?.active) throw new Error('there is already a running task')

    const id = `s-${Date.now().toString(36)}`
    const abort = new AbortController()
    const runtime: SessionRuntime = {
      id,
      projectPath: input.projectPath,
      abort,
      startedAt: Date.now(),
      active: true,
    }
    this.current = runtime
    runtimes.set(id, runtime)

    const record: SessionRecord = {
      id,
      projectPath: input.projectPath,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: input.prompt,
      status: 'running',
      startedAt: runtime.startedAt,
      endedAt: null,
      summary: '',
      verified: false,
    }

    await this.appendEvent(input.projectPath, { kind: 'start', at: runtime.startedAt, prompt: input.prompt })

    let result: RunResult
    try {
      result = await runAgent(this.ctx, {
        providerId: input.providerId,
        modelId: input.modelId,
        prompt: input.prompt,
        projectRoot: input.projectPath,
        sessionId: id,
        signal: abort.signal,
        emit: input.onEvent,
      })
    } catch (e) {
      const message = (e as Error).message
      record.status = 'error'
      record.endedAt = Date.now()
      record.summary = message
      await this.appendEvent(input.projectPath, { kind: 'error', at: Date.now(), message })
      input.onEvent({ type: 'failed', message })
      runtime.active = false
      this.current = null
      return {
        reason: 'error',
        summary: message,
        verified: false,
        steps: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - runtime.startedAt,
        error: message,
      }
    }

    record.status =
      result.reason === 'aborted'
        ? 'aborted'
        : result.reason === 'error'
          ? 'error'
          : result.reason === 'needs-input'
            ? 'needs-input'
            : 'done'
    record.endedAt = Date.now()
    record.summary = result.summary
    record.verified = result.verified

    await this.appendEvent(input.projectPath, {
      kind: 'end',
      at: Date.now(),
      reason: result.reason,
      summary: result.summary,
      verified: result.verified,
      tokens: result.inputTokens + result.outputTokens,
      steps: result.steps,
    })

    runtime.active = false
    this.current = null
    return result
  }

  private async appendEvent(
    projectPath: string | null,
    event: Record<string, unknown>,
  ): Promise<void> {
    if (!projectPath) return
    try {
      const dir = path.join(projectPath, '.agent')
      await fs.mkdir(dir, { recursive: true })
      await fs.appendFile(path.join(dir, 'sessions.jsonl'), `${JSON.stringify(event)}\n`, 'utf8')
    } catch {
      /* السجل مساعد تشخيصي — لا يُسقط المهمة */
    }
  }

  /** يقرأ آخر جلسات المشروع لاستئناف العمل. */
  async history(projectPath: string, limit = 20): Promise<Array<Record<string, unknown>>> {
    try {
      const file = path.join(projectPath, '.agent', 'sessions.jsonl')
      const raw = await fs.readFile(file, 'utf8')
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    } catch {
      return []
    }
  }
}

