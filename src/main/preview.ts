import { BrowserWindow, WebContentsView, shell } from 'electron'
import { request } from 'http'
import type { Bounds, DeviceKind, PreviewState } from '@shared/types'
import { send } from './bus'
import { log } from './logger'
import { BoundsSync, clampToContent, sameBounds } from './preview/bounds'
import { hardenPreviewLogins, releasePreviewLogins } from './preview/logins'
import { abortError, sleep } from './util'

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
  source: string
}

const DEVICE_W: Record<DeviceKind, number> = { mobile: 390, tablet: 820, desktop: 100000 }
const LEVELS = ['debug', 'info', 'warn', 'error'] as const
/** أقل مهلة انتظار بعد استقرار الصفحة قبل اعتبارها جاهزة للفحص */
const SETTLE_QUIET_MS = 90
const SETTLE_MAX_MS = 4000

const KEYMAP: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Esc: 'Escape', Return: 'Enter', ' ': 'Space', Space: 'Space'
}

/** كل حدث يمكن أن يغيّر حجم إطار المحتوى — لا بد من إعادة تطبيق الحدود عند كل واحد منها */
function watchWinResize(win: BrowserWindow, fn: () => void): () => void {
  const bind = () => {
    win.on('resize', fn)
    win.on('maximize', fn)
    win.on('unmaximize', fn)
    win.on('restore', fn)
    win.on('enter-full-screen', fn)
    win.on('leave-full-screen', fn)
  }
  const unbind = () => {
    if (win.isDestroyed()) return
    win.removeListener('resize', fn)
    win.removeListener('maximize', fn)
    win.removeListener('unmaximize', fn)
    win.removeListener('restore', fn)
    win.removeListener('enter-full-screen', fn)
    win.removeListener('leave-full-screen', fn)
  }
  bind()
  return unbind
}

export class PreviewManager {
  private win: BrowserWindow | null = null
  private view: WebContentsView | null = null
  private bounds = new BoundsSync()
  private applied: Bounds | null = null
  private shown = false
  private suppressed = false
  private logs: ConsoleEntry[] = []
  private net: string[] = []
  private lastActivity = 0
  state: PreviewState = { url: '', title: '', loading: false, device: 'desktop', open: false, errors: 0, boundsEpoch: 0 }

  /** يُستدعى عند تغيّر حجم النافذة: بلا هذا تتخطّى المعاينة حدودها */
  private readonly onWinResize = () => this.layout()

  private unwatch: (() => void) | null = null
  private unwatchNavigation: (() => void) | null = null

  attach(win: BrowserWindow) {
    if (this.win === win) return
    this.detach()
    this.win = win
    this.unwatch = watchWinResize(win, this.onWinResize)
    const onNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (!details.isMainFrame || details.isSameDocument) return
      // كل مستند جديد يبدأ عدّاده من الصفر؛ الجيل يرفض أي IPC قديم يصل متأخراً.
      this.state.boundsEpoch++
      this.bounds.reset(this.state.boundsEpoch)
      this.layout()
      this.push()
    }
    win.webContents.on('did-start-navigation', onNavigation)
    this.unwatchNavigation = () => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.removeListener('did-start-navigation', onNavigation)
      }
    }
  }

  /** فكّ الارتباط وتدمير طبقة العرض — بدونه تبقى الطبقة معلّقة على نافذة ميتة */
  detach() {
    this.unwatch?.()
    this.unwatch = null
    this.unwatchNavigation?.()
    this.unwatchNavigation = null
    // الترتيب مقصود: تدمير الطبقة أولاً والمعاينة ما زالت معلّقة على نافذة حيّة،
    // فينجح removeChildView. لو صار this.win = null قبل التدمير (كما كان) لقرأ
    // destroyView نافذة null فيتخطّى إزالة الابن وتُسرَّب طبقة WebContentsView.
    this.destroyView()
    this.win = null
    this.bounds.reset()
    this.state = { ...this.state, open: false, url: '', title: '', loading: false, errors: 0 }
  }

  private destroyView() {
    const v = this.view
    if (!v) return
    releasePreviewLogins() // فكّ مؤقت التفريغ/المستمع — يُعاد التثبيت في ensureView التالية
    this.view = null
    this.applied = null
    this.shown = false
    try {
      if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(v)
      if (!v.webContents.isDestroyed()) v.webContents.close()
    } catch (e) {
      log.warn('تعذّر إغلاق طبقة المعاينة', String(e))
    }
  }

  isOpen() {
    return !!this.view && this.state.open
  }
  private push() {
    send('preview:state', this.state)
  }
  private touch() {
    this.lastActivity = Date.now()
  }

  private ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    if (!this.win || this.win.isDestroyed()) throw new Error('النافذة غير جاهزة')
    const v = new WebContentsView({
      webPreferences: { partition: 'persist:nt-preview', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    v.setBackgroundColor('#ffffff')
    this.win.contentView.addChildView(v)
    this.touch()
    const wc = v.webContents
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url)
      return { action: 'deny' }
    })
    wc.on('console-message', (...args: any[]) => {
      const d = args[0]
      let level: string, text: string, source: string
      if (d && typeof d === 'object' && 'message' in d) {
        level = d.level
        text = d.message
        source = `${d.sourceId ?? ''}:${d.lineNumber ?? ''}`
      } else {
        level = LEVELS[Math.max(0, Math.min(3, Number(args[1])))] ?? 'log'
        text = String(args[2])
        source = `${args[4] ?? ''}:${args[3] ?? ''}`
      }
      const lv = level === 'warning' ? 'warn' : (level as ConsoleEntry['level'])
      this.logs.push({ level: lv, text: String(text).slice(0, 600), source })
      if (this.logs.length > 300) this.logs.shift()
      if (lv === 'error') {
        this.state.errors++
        this.push()
      }
    })
    wc.on('did-start-navigation', (_e: any, _url: string, _isInPlace: boolean, isMain: boolean) => {
      this.touch()
      if (isMain) {
        this.logs = []
        this.net = []
        this.state.errors = 0
      }
    })
    wc.on('did-start-loading', () => {
      this.touch()
      this.state.loading = true
      this.push()
    })
    wc.on('did-stop-loading', () => {
      this.touch()
      this.state.loading = false
      this.state.url = wc.getURL()
      this.state.title = wc.getTitle()
      this.push()
    })
    wc.on('did-navigate-in-page', () => {
      this.touch()
      this.state.url = wc.getURL()
      this.push()
    })
    wc.on('page-title-updated', (_e, t) => ((this.state.title = t), this.push()))
    wc.on('render-process-gone', (_e, d) => {
      // لا تُصفَّر this.view وحدها: الطبقة تبقى معلّقة على contentView، ثم يضيفها
      // ensureView طبقة ثانية فوق الجثّة فتتراكم العروض الميتة مع كل انهيار.
      this.destroyView()
      log.warn('انهارت عملية المعاينة', d.reason)
    })
    const ses = wc.session
    ses.webRequest.onCompleted((d) => {
      this.touch()
      if (d.webContentsId === wc.id && d.statusCode >= 400) this.pushNet(`${d.statusCode} ${d.method} ${d.url}`)
    })
    ses.webRequest.onErrorOccurred((d) => {
      this.touch()
      if (d.webContentsId === wc.id && d.error !== 'net::ERR_ABORTED') this.pushNet(`${d.error} ${d.method} ${d.url}`)
    })
    hardenPreviewLogins(wc) // تثبيت تسجيل الدخول: كوكيز الجلسة→دائمة + تفريغ دوري (fail-safe)
    this.view = v
    this.layout()
    return v
  }

  private pushNet(s: string) {
    this.net.push(s)
    if (this.net.length > 100) this.net.shift()
    this.state.errors++
    this.push()
  }

  get wc() {
    return this.view?.webContents ?? null
  }

  setBounds(b: Bounds & { seq?: number; boundsEpoch?: number }) {
    if (b?.boundsEpoch !== this.state.boundsEpoch) return
    if (!this.bounds.accept(b, b.seq, b.boundsEpoch)) return
    this.layout()
  }
  setSuppressed(v: boolean) {
    this.suppressed = v
    this.layout()
  }
  setDevice(d: DeviceKind) {
    this.state.device = d
    this.layout()
    this.push()
  }

  /**
   * التطبيق الوحيد لحدود المعاينة. يقصّها دائماً داخل إطار محتوى النافذة،
   * ويخفي الطبقة كلياً إن لم يبقَ منها ما يستحق العرض. لا path ثاني للتخطيط.
   */
  private layout() {
    const v = this.view
    if (!v || v.webContents.isDestroyed()) return
    const win = this.win
    if (!win || win.isDestroyed()) return v.setVisible(false)

    const [cw, ch] = win.getContentSize()
    const r = clampToContent(this.bounds.current(), cw, ch)
    const show = this.state.open && !this.suppressed && r.bounds !== null
    if (!show) {
      if (this.shown) {
        this.shown = false
        this.applied = null
        v.setVisible(false)
      }
      return
    }

    const width = Math.round(Math.min(DEVICE_W[this.state.device], r.bounds!.width))
    const next = {
      x: Math.round(r.bounds!.x + (r.bounds!.width - width) / 2),
      y: r.bounds!.y,
      width,
      height: r.bounds!.height
    }
    // نافذة بلا حركة = بلا setBounds: أحداث resize تصل عشرات المرات أثناء السحب
    if (sameBounds(this.applied, next)) {
      if (!this.shown) {
        this.shown = true
        v.setVisible(true)
      }
      return
    }
    this.applied = next
    this.shown = true
    v.setVisible(true)
    v.setBounds(next)
  }

  async load(url: string, timeoutMs = 25000, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    // إيقاف الوكيل (agent:stop) قبل البدء: لا تُنشئ طبقة ولا تبدأ تحميلاً لن يُرى
    if (signal?.aborted) return { ok: false, message: 'أُلغي فتح المعاينة: أوقفتَ العملية قبل أن يبدأ التحميل.' }
    const v = this.ensureView()
    this.state.open = true
    this.layout()
    send('ui:focus', 'preview')
    const wc = v.webContents
    this.touch()
    const r = await new Promise<{ ok: boolean; message: string }>((resolve) => {
      let done = false
      const onAbort = () => {
        // loadURL الجارية لا تُلغى وحدها: نوقفها صراحةً ونُرجِع النتيجة فوراً
        try { wc.stop() } catch { /* الـ WebContents قد يكون مدمّراً */ }
        fin({ ok: false, message: 'أُلغي تحميل المعاينة: أوقفتَ العملية أثناء التحميل.' })
      }
      const fin = (r: { ok: boolean; message: string }) => {
        if (done) return
        done = true
        clearTimeout(timer)
        wc.removeListener('did-finish-load', onFinish)
        wc.removeListener('did-fail-load', onFail)
        signal?.removeEventListener('abort', onAbort)
        resolve(r)
      }
      const onFinish = () => fin({ ok: true, message: 'تم التحميل' })
      const onFail = (_e: unknown, code: number, desc: string, _u: string, isMain: boolean) => {
        if (isMain && code !== -3) fin({ ok: false, message: `${desc} (${code})` })
      }
      const timer = setTimeout(() => fin({ ok: !wc.isLoading(), message: 'انتهت مهلة التحميل' }), timeoutMs)
      wc.on('did-finish-load', onFinish)
      wc.on('did-fail-load', onFail)
      signal?.addEventListener('abort', onAbort, { once: true })
      wc.loadURL(url).catch(() => { /* تُعالج عبر did-fail-load */ })
    })
    if (r.ok && !signal?.aborted) await this.settle(signal)
    return r
  }

  /**
   * انتظار استقرار الصفحة بالشرط لا بزمن ثابت: ينتهي فور هدوء الشبكة والرسم،
   * أو بعد سقف زمني — بدل النوم الثابت الذي كان يُثقل كل إعادة تحميل بلا داع.
   * maxMs سقف قابل للتخصيص حسب الفعل (ضغطة/تحجيم: ~1500؛ نقرة تنقّل: 4000).
   */
  async settle(signal?: AbortSignal, maxMs = SETTLE_MAX_MS): Promise<void> {
    const wc = this.wc
    if (!wc || wc.isDestroyed()) return
    const end = Date.now() + Math.min(Math.max(maxMs, 500), SETTLE_MAX_MS)
    while (Date.now() < end) {
      if (signal?.aborted) return
      const quiet = Date.now() - this.lastActivity >= SETTLE_QUIET_MS
      if (quiet && !wc.isLoading()) {
        // إطار رسم واحد يكفي ليصبح DOM قابلاً للقراءة
        const drawn = await wc.executeJavaScript(
          'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))',
          true
        ).catch(() => false)
        if (drawn) return
      }
      await sleep(40, signal).catch(() => undefined)
    }
  }

  /**
   * إعادة تحميل **حقيقية** تتجاهل الكاش، مع انتظار استقرار حقيقي.
   * prompt.ts يجعل الوكيل يتحقّق عبر preview_reload → browser_console، فلو حمّلت
   * من الكاش لخرجت نسخة قديمة نظيفة المظهر فتقرأها «لا أخطاء» ويكون التحقق كذباً.
   */
  async reloadAndSettle(signal?: AbortSignal): Promise<void> {
    const wc = this.wc
    if (!wc || wc.isDestroyed()) return
    this.touch()
    wc.reloadIgnoringCache()
    await this.settle(signal)
  }

  reload() {
    this.touch()
    this.wc?.reload()
  }

  close() {
    this.destroyView()
    this.state = { ...this.state, open: false, url: '', title: '', loading: false, errors: 0 }
    this.push()
  }

  external() {
    if (this.state.url) void shell.openExternal(this.state.url)
  }

  getLogs(clear = false) {
    const r = { console: [...this.logs], network: [...this.net] }
    if (clear) {
      this.logs = []
      this.net = []
      this.state.errors = 0
      this.push()
    }
    return r
  }

  exec<T = unknown>(code: string): Promise<T> {
    if (!this.wc) throw new Error('المعاينة غير مفتوحة')
    return this.wc.executeJavaScript(code, true) as Promise<T>
  }

  async screenshot(): Promise<{ mediaType: string; data: string; width: number; height: number }> {
    const wc = this.wc
    if (!wc || wc.isDestroyed()) throw new Error('المعاينة غير مفتوحة')
    let img = await wc.capturePage()
    let { width, height } = img.getSize()
    if (!width || !height) {
      const win = this.win
      const cw = win && !win.isDestroyed() ? win.getContentSize() : [0, 0]
      throw new Error(
        `اللقطة فارغة: المعاينة غير مرئية${this.suppressed ? ' (نافذة حوار مفتوحة)' : ''}. ` +
          `مساحة العرض ${Math.round(cw[0])}×${Math.round(cw[1])} والحاوية المطلوبة ${this.bounds.current().width}×${this.bounds.current().height}.`
      )
    }
    if (width > 1280) {
      img = img.resize({ width: 1280 })
      ;({ width, height } = img.getSize())
    }
    return { mediaType: 'image/jpeg', data: img.toJPEG(72).toString('base64'), width, height }
  }

  click(x: number, y: number, double = false) {
    const wc = this.wc!
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    for (let n = 1; n <= (double ? 2 : 1); n++) {
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: n })
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: n })
    }
  }

  async key(key: string, holdMs = 0) {
    const wc = this.wc!
    const code = KEYMAP[key] ?? key
    wc.sendInputEvent({ type: 'keyDown', keyCode: code })
    if (key.length === 1 || key === 'Space') wc.sendInputEvent({ type: 'char', keyCode: key === 'Space' ? ' ' : key })
    if (holdMs > 0) await sleep(Math.min(holdMs, 5000))
    wc.sendInputEvent({ type: 'keyUp', keyCode: code })
  }

  insertText(text: string) {
    void this.wc?.insertText(text)
  }
}

export const preview = new PreviewManager()

/** هل يستجيب المنفذ؟ أي استجابة HTTP (حتى 404) تعني أن الخادم يعمل */
function probe(port: number, host: string): Promise<boolean> {
  return new Promise((res) => {
    const r = request({ host, port, path: '/', method: 'GET', timeout: 1500 }, (resp) => {
      resp.resume()
      res(true)
    })
    r.on('error', () => res(false))
    r.on('timeout', () => { r.destroy(); res(false) })
    r.end()
  })
}

export async function waitForPort(port: number, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (signal.aborted) throw abortError()
    if ((await probe(port, '127.0.0.1')) || (await probe(port, '::1'))) return true
    await sleep(500, signal)
  }
  return false
}
