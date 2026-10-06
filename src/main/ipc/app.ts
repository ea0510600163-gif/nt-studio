import { app } from 'electron'
import { z } from 'zod'
import type { AppContext } from '../core/context'
import { createRouter } from './router'
import type { AppInfo } from '../../shared/api'

/**
 * قنوات التطبيق. كل قناة تمرّ عبر الموجّه: تحقق من المُرسِل + مخطط zod.
 * لا يوجد أي مُدخل من الواجهة — معلومات البيئة تُقرأ في العملية الرئيسية فقط.
 */
export function registerAppHandlers(ctx: AppContext): void {
  const router = createRouter(ctx.root.child('ipc:app'))

  router.handle({
    channel: 'app:info',
    input: z.undefined().optional(),
    handler: (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
    }),
  })
}