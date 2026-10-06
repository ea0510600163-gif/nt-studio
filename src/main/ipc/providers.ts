import { z } from 'zod'
import type { AppContext } from '../core/context'
import {
  addProvider,
  fetchModels,
  listProviders,
  probeConnection,
  recordTest,
  removeProvider,
  updateProvider,
} from '../core/providers'
import type { TestResult } from '../../shared/providers'
import { createRouter } from './router'

/**
 * قنوات المزوّدات. كل مُدخل يمرّ بمخطط zod، والمفتاح يُخزَّن مشفّرًا
 * ولا يعود للواجهة أبدًا — الواجهة ترى قناعًا فقط.
 */
export function registerProviderHandlers(ctx: AppContext): void {
  const router = createRouter(ctx.root.child('ipc:providers'))

  router.handle({
    channel: 'providers:list',
    input: z.undefined().optional(),
    handler: () => listProviders(ctx),
  })

  router.handle({
    channel: 'providers:add',
    input: z.object({
      name: z.string(),
      protocol: z.enum(['openai-compatible', 'anthropic', 'google']),
      baseUrl: z.string(),
      apiKey: z.string(),
      models: z.array(z.string()),
      note: z.string(),
    }),
    handler: (input) => addProvider(ctx, input),
  })

  router.handle({
    channel: 'providers:update',
    input: z.object({
      id: z.string(),
      name: z.string(),
      protocol: z.enum(['openai-compatible', 'anthropic', 'google']),
      baseUrl: z.string(),
      apiKey: z.string(),
      models: z.array(z.string()),
      note: z.string(),
    }),
    handler: (input) => updateProvider(ctx, input.id, input, input.apiKey.length > 0),
  })

  router.handle({
    channel: 'providers:remove',
    input: z.object({ id: z.string() }),
    handler: ({ id }) => {
      removeProvider(ctx, id)
      return true
    },
  })

  router.handle({
    channel: 'providers:probe',
    input: z.object({
      name: z.string(),
      protocol: z.enum(['openai-compatible', 'anthropic', 'google']),
      baseUrl: z.string(),
      apiKey: z.string(),
      models: z.array(z.string()),
    }),
    handler: async (input): Promise<TestResult> => {
      const result = await probeConnection(input)
      ctx.root.child('ipc:providers').info(
        `فحص اتصال: ${result.ok ? 'ناجح' : 'فاشل'} (${result.latencyMs}ms) — ${result.message.slice(0, 160)}`,
      )
      return result
    },
  })

  router.handle({
    channel: 'providers:fetchModels',
    input: z.object({
      baseUrl: z.string(),
      protocol: z.enum(['openai-compatible', 'anthropic', 'google']),
      apiKey: z.string(),
    }),
    handler: async ({ baseUrl, protocol, apiKey }) => {
      try {
        const models = await fetchModels(baseUrl, protocol, apiKey)
        return { ok: true as const, models }
      } catch (e) {
        const err = e as Error
        return { ok: false as const, models: [] as string[], error: err.message }
      }
    },
  })

  router.handle({
    channel: 'providers:setActive',
    input: z.object({ id: z.string(), model: z.string() }),
    handler: ({ id, model }) => {
      ctx.state.patch({ activeProviderId: id, activeModel: model })
      return true
    },
  })

  router.handle({
    channel: 'providers:testSaved',
    input: z.object({ id: z.string() }),
    handler: async ({ id }): Promise<TestResult> => {
      const { findProvider, decryptKeyOf } = await import('../core/providers')
      const record = findProvider(ctx, id)
      if (!record) throw new Error('المزوّد غير موجود')
      const apiKey = decryptKeyOf(ctx, record)
      const result = await probeConnection({
        name: record.name,
        protocol: record.protocol,
        baseUrl: record.baseUrl,
        apiKey,
        models: record.models,
      })
      recordTest(ctx, id, result)
      return result
    },
  })
}