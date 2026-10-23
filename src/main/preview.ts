import { BrowserWindow, WebContentsView, shell } from 'electron'
import { request } from 'http'
import type { Bounds, DeviceKind, PreviewState } from '@shared/types'
import { send } from './bus'
import { log } from './logger'
import { BoundsSync, clampToContent, sameBounds } from './preview/bounds'
import { hardenPreviewLogins, releasePreviewLogins, LOGIN_PARTITION } from './preview/logins'
import { abortError, sleep } from './util'

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
  source: string
}

const DEVICE_W: Record<DeviceKind, number> = { mobile: 390, tablet: 820, desktop: 100000 }
const LEVELS = ['debug', 'info', 'warn', 'error'] as const
const deadLogged = new WeakSet<object>()
const SETTLE_QUIET_MS = 90
const SETTLE_MAX_MS = 4000

const KEYMAP: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Esc: 'Escape', Return: 'Enter', ' ': 'Space', Space: 'Space'
}

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
  private popup: BrowserWindow | null = null
  private bounds = new BoundsSync()
  private applied: Bounds | null = null
  private shown = false
  private suppressed = false
  private logs: ConsoleEntry[] = []
  private net: string[] = []
  private lastActivity = 0
  state: PreviewState = { url: '', title: '', loading: false, device: 'desktop', open: false, errors: 0, boundsEpoch: 0 }

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

  detach() {
    this.unwatch?.()
    this.unwatch = null
    this.unwatchNavigation?.()
    this.unwatchNavigation = null
    this.destroyView()
    this.win = null
    this.bounds.reset()
    this.state = { ...this.state, open: false, url: '', title: '', loading: false, errors: 0 }
  }

  private destroyView() {
    const v = this.view
    if (!v) {
      this.closePopup()
      return
    }
    releasePreviewLogins()
    this.view = null
    this.applied = null
    this.shown = false
    this.closePopup()
    try {
      if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(v)
      if (!v.webContents.isDestroyed()) v.webContents.close()
    } catch (e) {
      log.warn('تعذّر إغلاق طبقة المعاينة', String(e))
    }
  }

  private mainWc(): Electron.WebContents | null {
    try {
      const v = this.view
      if (!v) return null
      const wc = v.webContents
      if (!wc || wc.isDestroyed()) {
        if (!deadLogged.has(v)) {
          deadLogged.add(v)
          log.warn(`طبقة معاينة بلا WebContents حي (view موجود، webContents=${wc ? 'مدمّر' : 'معدوم'}) — ستُعاد الإنشاء عند الحاجة`)
        }
        return null
      }
      return wc
    } catch {
      return null
    }
  }

  private activeWc(): Electron.WebContents | null {
    try {
      const p = this.popup
      if (p && !p.isDestroyed() && p.webContents && !p.webContents.isDestroyed()) return p.webContents
      if (p && p.isDestroyed()) this.popup = null
    } catch {
      this.popup = null
    }
    return this.mainWc()
  }

  hasPopup(): boolean {
    try {
      return !!this.popup && !this.popup.isDestroyed()
    } catch {
      return false
    }
  }

  closePopup() {
    try {
      const p = this.popup
      this.popup = null
      if (p && !p.isDestroyed()) p.close()
    } catch {
      this.popup = null
    }
  }

  private trackPopup(child: BrowserWindow) {
    try {
      if (this.popup && !this.popup.isDestroyed() && this.popup !== child) {
        try { this.popup.close() } catch {}
      }
      this.popup = child
      this.touch()
      child.setMenuBarVisibility(false)
      try { child.setAlwaysOnTop(false) } catch {}
      try {
        child.webContents.setWindowOpenHandler(({ url }) => {
          try {
            if (url && url !== 'about:blank') void child.webContents.loadURL(url)
          } catch {}
          return { action: 'deny' }
        })
      } catch {}
      child.on('closed', () => {
        if (this.popup === child) this.popup = null
        this.touch()
        try {
          if (this.win && !this.win.isDestroyed()) this.win.focus()
        } catch {}
        this.push()
      })
      child.webContents.on('did-start-loading', () => this.touch())
      child.webContents.on('did-stop-loading', () => this.touch())
    } catch (e) {
      log.warn('تعذّر تتبّع نافذة الدخول', String(e))
    }
  }

  private popupOptions(features: string): Electron.BrowserWindowConstructorOptions {
    let w = 500, h = 650
    try {
      const mW = /width=(\d+)/i.exec(features)
      const mH = /height=(\d+)/i.exec(features)
      if (mW) w = Math.min(Math.max(parseInt(mW[1], 10), 360), 900)
      if (mH) h = Math.min(Math.max(parseInt(mH[1], 10), 400), 1000)
    } catch {}
    let x: number | undefined
    let y: number | undefined
    try {
      if (this.win && !this.win.isDestroyed()) {
        const [wx, wy] = this.win.getPosition()
        const [ww, wh] = this.win.getSize()
        x = Math.round(wx + Math.max(0, (ww - w) / 2))
        y = Math.round(wy + Math.max(0, (wh - h) / 2))
      }
    } catch {}
    const opts: Electron.BrowserWindowConstructorOptions = {
      width: w, height: h, show: true, autoHideMenuBar: true, resizable: true, minimizable: false,
      maximizable: false, fullscreenable: false, alwaysOnTop: false,
      backgroundColor: '#ffffff', title: 'تسجيل الدخول',
      webPreferences: { partition: LOGIN_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    }
    if (x !== undefined && y !== undefined) { opts.x = x; opts.y = y }
    try {
      if (this.win && !this.win.isDestroyed()) opts.parent = this.win
    } catch {}
    return opts
  }

  isOpen() {
    try {
      return !!this.view && !this.view.webContents.isDestroyed() && this.state.open
    } catch {
      return false
    }
  }
  private push() {
    send('preview:state', this.state)
  }
  private touch() {
    this.lastActivity = Date.now()
  }

  private ensureView(): WebContentsView {
    try {
      if (this.view && !this.view.webContents.isDestroyed()) return this.view
    } catch {}
    try {
      const old = this.view
      this.view = null
      if (old && this.win && !this.win.isDestroyed()) {
        try { this.win.contentView.removeChildView(old) } catch {}
      }
    } catch {}
    if (!this.win || this.win.isDestroyed()) throw new Error('النافذة غير جاهزة')
    const v = new WebContentsView({
      webPreferences: { partition: 'persist:nt-preview', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    v.setBackgroundColor('#ffffff')
    this.win.contentView.addChildView(v)
    this.touch()
    const wc = v.webContents
    wc.setWindowOpenHandler(({ url, features }) => {
      try {
        if (!url || url === 'about:blank') {
          return { action: 'allow' as const, overrideBrowserWindowOptions: this.popupOptions(features ?? '') }
        }
        return { action: 'allow' as const, overrideBrowserWindowOptions: this.popupOptions(features ?? '') }
      } catch {
        return { action: 'deny' as const }
      }
    })
    try {
      wc.on('did-create-window' as any, (child: BrowserWindow) => {
        try {
          if (child && !child.isDestroyed()) this.trackPopup(child)
        } catch {}
      })
    } catch {}
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
      try {
        if (!wc.isDestroyed()) {
          this.state.url = wc.getURL()
          this.state.title = wc.getTitle()
        }
      } catch {}
      this.push()
    })
    wc.on('did-navigate-in-page', () => {
      this.touch()
      try {
        if (!wc.isDestroyed()) this.state.url = wc.getURL()
      } catch {}
      this.push()
    })
    wc.on('page-title-updated', (_e, t) => ((this.state.title = t), this.push()))
    wc.on('render-process-gone', (_e, d) => {
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
    hardenPreviewLogins(wc)
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
    return this.activeWc()
  }

  setBounds(b: Bounds) {
    if (b?.boundsEpoch !== this.state.boundsEpoch) return
    const f = this.zoomFactor()
    const scaled = f === 1 ? b : { ...b, x: b.x * f, y: b.y * f, width: b.width * f, height: b.height * f }
    if (!this.bounds.accept(scaled, b.seq, b.boundsEpoch)) return
    this.layout()
  }

  private zoomFactor(): number {
    try {
      const wc = this.win && !this.win.isDestroyed() ? this.win.webContents : null
      return wc && !wc.isDestroyed() ? wc.getZoomFactor() : 1
    } catch {
      return 1
    }
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

  private layout() {
    let v: WebContentsView | null = null
    try {
      v = this.view
      if (!v || v.webContents.isDestroyed()) return
    } catch {
      return
    }
    let win: BrowserWindow | null = null
    try {
      win = this.win
      if (!win || win.isDestroyed()) return v!.setVisible(false)
    } catch {
      return
    }

    let cw = 0, ch = 0
    try {
      ;[cw, ch] = win!.getContentSize()
    } catch {
      return
    }
    const r = clampToContent(this.bounds.current(), cw, ch)
    const show = this.state.open && !this.suppressed && r.bounds !== null
    if (!show) {
      if (this.shown) {
        this.shown = false
        this.applied = null
        try { v!.setVisible(false) } catch {}
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
    if (sameBounds(this.applied, next)) {
      if (!this.shown) {
        this.shown = true
        try { v!.setVisible(true) } catch {}
      }
      return
    }
    this.applied = next
    this.shown = true
    try {
      v!.setVisible(true)
      v!.setBounds(next)
    } catch {}
  }

  async load(url: string, timeoutMs = 25000, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    if (signal?.aborted) return { ok: false, message: 'أُلغي فتح المعاينة: أوقفتَ العملية قبل أن يبدأ التحميل.' }
    this.closePopup()
    const v = this.ensureView()
    this.state.open = true
    this.layout()
    send('ui:focus', 'preview')
    const wc = v.webContents
    this.touch()
    const r = await new Promise<{ ok: boolean; message: string }>((resolve) => {
      let done = false
      const onAbort = () => {
        try { if (!wc.isDestroyed()) wc.stop() } catch {}
        fin({ ok: false, message: 'أُلغي تحميل المعاينة: أوقفتَ العملية أثناء التحميل.' })
      }
      const fin = (r: { ok: boolean; message: string }) => {
        if (done) return
        done = true
        clearTimeout(timer)
        try {
          wc.removeListener('did-finish-load', onFinish)
          wc.removeListener('did-fail-load', onFail)
        } catch {}
        signal?.removeEventListener('abort', onAbort)
        resolve(r)
      }
      const onFinish = () => fin({ ok: true, message: 'تم التحميل' })
      const onFail = (_e: unknown, code: number, desc: string, _u: string, isMain: boolean) => {
        if (isMain && code !== -3) fin({ ok: false, message: `${desc} (${code})` })
      }
      const timer = setTimeout(() => {
        let loading = false
        try { loading = !wc.isDestroyed() && wc.isLoading() } catch { loading = false }
        fin({ ok: !loading, message: 'انتهت مهلة التحميل' })
      }, timeoutMs)
      wc.on('did-finish-load', onFinish)
      wc.on('did-fail-load', onFail)
      signal?.addEventListener('abort', onAbort, { once: true })
      wc.loadURL(url).catch(() => {})
    })
    if (r.ok && !signal?.aborted) await this.settle(signal)
    return r
  }

  async settle(signal?: AbortSignal, maxMs = SETTLE_MAX_MS): Promise<void> {
    const end = Date.now() + Math.min(Math.max(maxMs, 500), SETTLE_MAX_MS)
    while (Date.now() < end) {
      if (signal?.aborted) {
        try { this.activeWc()?.stop() } catch {}
        return
      }
      const wc = this.activeWc()
      if (!wc) return
      let loading = false
      try { loading = wc.isLoading() } catch { return }
      const quiet = Date.now() - this.lastActivity >= SETTLE_QUIET_MS
      if (quiet && !loading) {
        const drawn = await wc.executeJavaScript(
          'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))',
          true
        ).catch(() => false)
        if (drawn) return
      }
      await sleep(40, signal).catch(() => undefined)
    }
  }

  async reloadAndSettle(signal?: AbortSignal): Promise<void> {
    const wc = this.activeWc()
    if (!wc) return
    try {
      if (wc.isDestroyed()) return
    } catch { return }
    this.touch()
    try { wc.reloadIgnoringCache() } catch { return }
    await this.settle(signal)
  }

  reload() {
    this.touch()
    try {
      const wc = this.activeWc()
      if (wc && !wc.isDestroyed()) wc.reload()
    } catch {}
  }

  close() {
    this.destroyView()
    this.state = { ...this.state, open: false, url: '', title: '', loading: false, errors: 0 }
    this.push()
  }

  external() {
    if (this.state.url) void shell.openExternal(this.state.url).catch(() => {})
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
    const wc = this.activeWc()
    if (!wc) {
      throw new Error(
        this.hasPopup()
          ? 'نافذة الدخول مفتوحة لكنها غير جاهزة بعد — انتظر لحظة ثم أعد المحاولة.'
          : 'المعاينة غير مفتوحة'
      )
    }
    try {
      if (wc.isDestroyed()) throw new Error('المعاينة غير مفتوحة')
    } catch (e) {
      if ((e as Error).message === 'المعاينة غير مفتوحة') throw e
      throw new Error('المعاينة غير مفتوحة')
    }
    return wc.executeJavaScript(code, true) as Promise<T>
  }

  async screenshot(): Promise<{ mediaType: string; data: string; width: number; height: number }> {
    const wc = this.activeWc()
    if (!wc) throw new Error('المعاينة غير مفتوحة')
    try {
      if (wc.isDestroyed()) throw new Error('المعاينة غير مفتوحة')
    } catch {
      throw new Error('المعاينة غير مفتوحة')
    }
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
    const wc = this.activeWc()
    if (!wc) throw new Error('المعاينة غير مفتوحة')
    try {
      if (wc.isDestroyed()) throw new Error('المعاينة غير مفتوحة')
      wc.sendInputEvent({ type: 'mouseMove', x, y })
      for (let n = 1; n <= (double ? 2 : 1); n++) {
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: n })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: n })
      }
    } catch (e) {
      if ((e as Error).message === 'المعاينة غير مفتوحة') throw e
      throw new Error('المعاينة غير مفتوحة')
    }
  }

  async key(key: string, holdMs = 0) {
    const wc = this.activeWc()
    if (!wc) throw new Error('المعاينة غير مفتوحة')
    try {
      if (wc.isDestroyed()) throw new Error('المعاينة غير مفتوحة')
      const code = KEYMAP[key] ?? key
      wc.sendInputEvent({ type: 'keyDown', keyCode: code })
      if (key.length === 1 || key === 'Space') wc.sendInputEvent({ type: 'char', keyCode: key === 'Space' ? ' ' : key })
      if (holdMs > 0) await sleep(Math.min(holdMs, 5000))
      if (!wc.isDestroyed()) wc.sendInputEvent({ type: 'keyUp', keyCode: code })
    } catch (e) {
      if ((e as Error).message === 'المعاينة غير مفتوحة') throw e
      throw new Error('المعاينة غير مفتوحة')
    }
  }

  insertText(text: string) {
    try {
      const wc = this.activeWc()
      if (wc && !wc.isDestroyed()) void wc.insertText(text)
    } catch {}
  }
}

export const preview = new PreviewManager()

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
