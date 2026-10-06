import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { output, ZodType } from 'zod'
import type { ScopedLogger } from '../core/logger'

/**
 * موجّه IPC: البوابة الوحيدة بين الواجهة وعملية Node.
 *
 * كل قناة تمرّ عبر ثلاث طبقات إلزامية:
 *   1) ثقة المُرسِل  — لا يُقبل إلا إطار من حزمة التطبيق أو خادم Vite في التطوير.
 *   2) مخطط المُدخل  — لا يمرّ شيء بلا zod، فلا يحدّد النموذج ولا الواجهة شكل البيانات.
 *   3) المعالج       — منطق محلّي، يستقبل قيمة مُتحقَّق منها فقط.
 *
 * لا يُكشف ipcRenderer للواجهة إطلاقًا (قاعدة Electron الأمنية رقم 20).
 */

export class IpcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcError'
  }
}

export interface IpcContext {
  window: BrowserWindow
}

export interface IpcDef<S extends ZodType> {
  channel: string
  input?: S
  handler: (value: output<S>, ctx: IpcContext) => unknown | Promise<unknown>
}

function trustedPrefixes(): string[] {
  const list = ['file://']
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) list.push(dev)
  return list
}

/** يتحقق أن الرسالة جاءت من إطار تابع لتطبيقنا، ويعيد نافذته. */
export function assertTrustedSender(event: IpcMainInvokeEvent): BrowserWindow {
  const frame = event.senderFrame
  if (!frame) throw new IpcError('IPC: لا يوجد إطار مرسل')
  const url = frame.url
  if (!trustedPrefixes().some((p) => url.startsWith(p))) {
    throw new IpcError(`IPC: مرسل غير موثوق (${url.slice(0, 120)})`)
  }
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new IpcError('IPC: النافذة غير صالحة')
  return win
}

function formatIssues(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((i) => `${i.path.length ? i.path.join('.') : '(جذر)'}: ${i.message}`)
    .join(' | ')
}

export function createRouter(log: ScopedLogger) {
  return {
    handle<S extends ZodType>(def: IpcDef<S>): void {
      const { channel, input, handler } = def
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, raw: unknown) => {
        const window = assertTrustedSender(event)
        let value: unknown = raw
        if (input) {
          const parsed = input.safeParse(raw)
          if (!parsed.success) {
            const detail = formatIssues(parsed.error as unknown as { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> })
            log.warn(`IPC ${channel}: مُدخل مرفوض — ${detail}`)
            throw new IpcError(`مُدخل غير صالح: ${detail}`)
          }
          value = parsed.data
        }
        try {
          return await handler(value as output<S>, { window })
        } catch (e) {
          log.error(`IPC ${channel}: فشل المعالج`, e)
          throw e
        }
      })
    },
  }
}

export type Router = ReturnType<typeof createRouter>