import { z } from 'zod'
import type { AppContext } from '../core/context'
import type { PreviewController } from '../preview/controller'
import { createRouter } from './router'

const urlSchema = z.string().min(1).max(2000)

export function registerPreviewHandlers(ctx: AppContext, preview: PreviewController): void {
  const router = createRouter(ctx.root.child('ipc:preview'))

  router.handle({
    channel: 'preview:open',
    input: z.object({ url: urlSchema }),
    handler: async ({ url }, { window }) => {
      if (!preview.hasView()) {
        // لا بُعد لـ view بعد: الواجهة ستطلب attach بعد الرسم
        const res = await preview.open(url)
        void window
        return res
      }
      return preview.open(url)
    },
  })

  router.handle({
    channel: 'preview:close',
    input: z.undefined().optional(),
    handler: () => {
      preview.close()
      return true
    },
  })

  router.handle({
    channel: 'preview:status',
    input: z.undefined().optional(),
    handler: () => ({ url: preview.currentUrl(), hasView: preview.hasView() }),
  })

  router.handle({
    channel: 'preview:attach',
    input: z.object({ bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }) }),
    handler: ({ bounds }, { window }) => {
      preview.attach(window, bounds)
      return true
    },
  })

  router.handle({
    channel: 'preview:resize',
    input: z.object({ bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }) }),
    handler: ({ bounds }) => {
      preview.applyBounds(bounds)
      return true
    },
  })

  router.handle({
    channel: 'preview:screenshot',
    input: z.undefined().optional(),
    handler: () => preview.screenshot(),
  })

  router.handle({
    channel: 'preview:console',
    input: z.undefined().optional(),
    handler: () => preview.consoleErrors(),
  })

  router.handle({
    channel: 'preview:evaluate',
    input: z.object({ expression: z.string().min(1).max(4000) }),
    handler: ({ expression }) => preview.evaluate(expression),
  })

  router.handle({
    channel: 'preview:click',
    input: z.object({ selector: z.string().min(1).max(500) }),
    handler: ({ selector }) => preview.click(selector),
  })

  router.handle({
    channel: 'preview:type',
    input: z.object({ selector: z.string().min(1).max(500), text: z.string().max(2000) }),
    handler: ({ selector, text }) => preview.typeText(selector, text),
  })

  router.handle({
    channel: 'preview:reload',
    input: z.undefined().optional(),
    handler: () => preview.reload(),
  })

  router.handle({
    channel: 'preview:setViewport',
    input: z.object({ size: z.object({ width: z.number(), height: z.number() }).nullable() }),
    handler: ({ size }) => {
      preview.setViewport(size)
      return true
    },
  })

  router.handle({
    channel: 'preview:openExternal',
    input: z.object({ url: urlSchema }),
    handler: async ({ url }) => {
      const { shell } = await import('electron')
      if (/^https?:\/\//i.test(url)) {
        await shell.openExternal(url)
        return true
      }
      return false
    },
  })
}