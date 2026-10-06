import { z } from 'zod'
import type { AppContext } from '../core/context'
import { AgentRunner } from '../agent/session'
import type { AgentEvent } from '../agent/types'
import { createRouter } from './router'

/**
 * قنوات الوكيل.
 *
 * أحداث التقدّم تُبثّ من العملية الرئيسية إلى الواجهة عبر قناة push واحدة
 * (agent:event) بدل قناة لكل نوع — أبسط وأقل تسريبًا.
 */

/** اسم قناة بث الأحداث (يشترك فيه main و preload). */
export const eventChannel = 'agent:event'

export function registerAgentHandlers(ctx: AppContext, runner: AgentRunner): void {
  const router = createRouter(ctx.root.child('ipc:agent'))
  const log = ctx.root.child('agent')

  const broadcast = (event: AgentEvent): void => {
    for (const win of ctx.browserWindows()) {
      if (!win.isDestroyed()) win.webContents.send(eventChannel, event)
    }
  }

  router.handle({
    channel: 'agent:run',
    input: z.object({
      prompt: z.string().min(1),
      providerId: z.string().min(1),
      modelId: z.string().min(1),
      projectPath: z.string().nullable(),
    }),
    handler: async (input): Promise<{ ok: boolean; sessionId: string | null; message?: string }> => {
      if (runner.isRunning()) {
        return { ok: false, sessionId: null, message: 'there is already a running task' }
      }
      const promise = runner.run({
        prompt: input.prompt,
        providerId: input.providerId,
        modelId: input.modelId,
        projectPath: input.projectPath,
        onEvent: broadcast,
      })
      // لا ننتظر: الواجهة تتابع عبر الأحداث
      void promise.catch((e: unknown) => {
        log.error('run failed', e)
        broadcast({ type: 'failed', message: (e as Error).message })
      })
      return { ok: true, sessionId: runner.currentSession() }
    },
  })

  router.handle({
    channel: 'agent:stop',
    input: z.undefined().optional(),
    handler: () => runner.stop(),
  })

  router.handle({
    channel: 'agent:status',
    input: z.undefined().optional(),
    handler: () => ({ running: runner.isRunning(), sessionId: runner.currentSession() }),
  })

  router.handle({
    channel: 'agent:history',
    input: z.object({ projectPath: z.string(), limit: z.number().optional() }),
    handler: ({ projectPath, limit }) => runner.history(projectPath, limit ?? 20),
  })
}

