import { BrowserWindow, WebContentsView } from 'electron'
import path from 'node:path'
import type { AppContext } from '../core/context'

/**
 * معاينة التطبيق عبر WebContentsView.
 *
 * لماذا WebContentsView وليس <iframe>؟
 *  - iframe داخل واجهتنا يشارك مساحة JavaScript ⇒ أي كود في المشروع المعروض
 *    يستطيع نداء window.studio وحذف ملفات على القرص. تلك ثغرة كنتها فعليًا.
 *  - WebContentsView عملية عرض منفصلة تمامًا: لا جسر، لا Node، لا وصول لـ IPC.
 *  - يعطينا capturePage() لقطات، وconsole-message لالتقاط أخطاء الصفحة،
 *    وexecuteJavaScript لفحص الـ DOM — كل ما يحتاجه الوكيل ليتحقق بنفسه.
 */

/** يُعيد مقاس المحتوى مع قيم افتراضية آمنة (الإصدار قد يعيد undefined). */
function contentSize(win: BrowserWindow): { width: number; height: number } {
  const [w, h] = win.getContentSize()
  return { width: w ?? 800, height: h ?? 600 }
}

interface ConsoleEntry {
  level: string
  text: string
  line?: number
  at: number
}

interface PreviewState {
  view: WebContentsView | null
  window: BrowserWindow | null
  url: string | null
  logs: ConsoleEntry[]
  viewport: { width: number; height: number } | null
  /** آخر حدود مرسلة من الواجهة — تُستخدم عند ضبط حجم النافذة. */
  bounds: { x: number; y: number; width: number; height: number } | null
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

export class PreviewController {
  private state: PreviewState = {
    view: null,
    window: null,
    url: null,
    logs: [],
    viewport: null,
    bounds: null,
  }

  constructor(private readonly ctx: AppContext) {}

  hasView(): boolean {
    return this.state.view !== null
  }

  currentUrl(): string | null {
    return this.state.url
  }

  /** ينشئ الـ view إن لم يكن موجودًا، ويضعه في النافذة عند الإحداثيات المعطاة. */
  attach(win: BrowserWindow, bounds: { x: number; y: number; width: number; height: number }): void {
    if (!this.state.view) {
      const view = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          experimentalFeatures: false,
          backgroundThrottling: false,
        },
      })
      view.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        this.state.logs.push({
          level: level === 3 ? 'error' : level === 2 ? 'warn' : 'info',
          text: `${message}${sourceId ? ` (${path.basename(sourceId)})` : ''}`,
          line: line > 0 ? line : undefined,
          at: Date.now(),
        })
        if (this.state.logs.length > 300) this.state.logs.splice(0, this.state.logs.length - 300)
      })
      view.webContents.on('render-process-gone', () => {
        this.push({ type: 'notice', level: 'warn', message: 'Preview process crashed - reloading' })
        void this.reload()
      })
      view.webContents.setWindowOpenHandler(({ url }) => {
        void this.open(url)
        return { action: 'deny' }
      })
      this.state.view = view
    }
    this.state.window = win
    // حدود الـ view تتبع موضع العنصر الذي ترسله الواجهة (بوحدات CSS)
    this.state.bounds = { ...bounds }
    win.contentView.addChildView(this.state.view)
    this.applyBounds(bounds)
  }

  detach(): void {
    const { view, window: win } = this.state
    if (view && win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(view)
      } catch {
        /* النافذة قد تكون مغلقة */
      }
      view.webContents.close()
    }
    this.state.view = null
    this.state.window = null
    this.state.bounds = null
  }

  /** يرسل عنوان URL الجديد للواجهة (المعاينة تعمل خارج نطاق React). */
  private broadcastUrl(url: string | null): void {
    const win = this.state.window
    if (!win || win.isDestroyed()) return
    win.webContents.send('preview:url', { url })
  }

  applyBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    if (!this.state.view) return
    // electrton's WebContentsView expects device-independent pixels with the
    // origin at the top-left of the window content area (same as CSS rects)
    this.state.view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(50, Math.round(bounds.width)),
      height: Math.max(50, Math.round(bounds.height)),
    })
  }

  /** يضبط حجم إطار العرض (محاكاة جهاز) داخل حدود العنصر المُمرَّر من الواجهة. */
  setViewport(size: { width: number; height: number } | null): void {
    this.state.viewport = size
    const win = this.state.window
    const view = this.state.view
    if (!view || !win || win.isDestroyed()) return

    const bounds = this.state.bounds ?? { x: 0, y: 0, ...contentSize(win) }
    if (size === null) {
      view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(50, Math.round(bounds.width)),
        height: Math.max(50, Math.round(bounds.height)),
      })
      return
    }
    // نحصر الحجم داخل حدود العنصر حتى لا يخرج عن الإطار المرسوم
    const width = Math.min(size.width, bounds.width)
    const height = Math.min(size.height, bounds.height)
    view.setBounds({
      x: Math.round(bounds.x + Math.max(0, (bounds.width - width) / 2)),
      y: Math.round(bounds.y),
      width: Math.max(50, Math.round(width)),
      height: Math.max(50, Math.round(height)),
    })
  }

  async open(url: string): Promise<{ ok: boolean; url: string }> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, url }
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, url }
    }
    const view = this.state.view
    if (!view) {
      this.state.url = url
      this.broadcastUrl(url)
      return { ok: true, url }
    }
    this.state.logs = []
    this.state.url = url
    await view.webContents.loadURL(url)
    this.broadcastUrl(url)
    return { ok: true, url }
  }

  close(): void {
    this.detach()
    this.state.url = null
    this.state.logs = []
  }

  async reload(): Promise<boolean> {
    const view = this.state.view
    if (!view) return false
    await view.webContents.reload()
    return true
  }

  async screenshot(): Promise<{ ok: boolean; dataUrl: string | null; error?: string }> {
    const view = this.state.view
    if (!view) return { ok: false, dataUrl: null, error: 'no preview open' }
    try {
      const image = await view.webContents.capturePage()
      const size = image.getSize()
      if (size.width === 0 || size.height === 0) {
        return { ok: false, dataUrl: null, error: 'preview has zero size - is it visible?' }
      }
      return { ok: true, dataUrl: image.toDataURL() }
    } catch (e) {
      return { ok: false, dataUrl: null, error: (e as Error).message }
    }
  }

  consoleErrors(): Array<{ level: string; text: string; line?: number }> {
    return this.state.logs
      .filter((l) => l.level === 'error' || l.level === 'warn')
      .map(({ level, text, line }) => ({ level, text, line }))
  }

  async evaluate(expression: string): Promise<{ ok: boolean; value: string | null; error?: string }> {
    const view = this.state.view
    if (!view) return { ok: false, value: null, error: 'no preview open' }
    try {
      const result = (await view.webContents.executeJavaScript(expression, true)) as unknown
      return { ok: true, value: typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? 'undefined' }
    } catch (e) {
      return { ok: false, value: null, error: (e as Error).message }
    }
  }

  async click(selector: string): Promise<{ ok: boolean; error?: string }> {
    const js = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not-found';
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        el.dispatchEvent(new MouseEvent(type, {bubbles:true, cancelable:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2, view:window}));
      }
      return 'clicked';
    })()`
    const res = await this.evaluate(js)
    if (!res.ok) return { ok: false, error: res.error ?? 'evaluate failed' }
    if (res.value === 'not-found') return { ok: false, error: `no element matched ${selector}` }
    return { ok: true }
  }

  async typeText(selector: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const js = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'not-found';
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      el.focus();
      if (setter) setter.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return 'typed';
    })()`
    const res = await this.evaluate(js)
    if (!res.ok) return { ok: false, error: res.error ?? 'evaluate failed' }
    if (res.value === 'not-found') return { ok: false, error: `no editable element matched ${selector}` }
    return { ok: true }
  }

  private push(event: unknown): void {
    for (const win of this.ctx.browserWindows()) {
      if (!win.isDestroyed()) win.webContents.send('agent:event', event)
    }
  }
}