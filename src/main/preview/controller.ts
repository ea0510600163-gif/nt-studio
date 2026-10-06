import { BrowserWindow, WebContentsView } from 'electron'
import path from 'node:path'
import type { AppContext } from '../core/context'
import {
  MAX_CONSOLE_ISSUES,
  MAX_LOG_ENTRIES,
  clampToContent,
  keepNewest,
  readRect,
  readSeq,
  resolveBounds,
  sameResolution,
  shouldIgnore,
  type BoundsResolution,
  type PreviewBoundsInput,
  type PreviewRect,
  type PreviewSize,
} from './bounds'

/**
 * معاينة التطبيق عبر WebContentsView.
 *
 * لماذا WebContentsView وليس <iframe>؟
 *  - iframe داخل واجهتنا يشارك مساحة JavaScript ⇒ أي كود في المشروع المعروض
 *    يستطيع نداء window.studio وحذف ملفات على القرص. تلك ثغرة كنتها فعليًا.
 *  - WebContentsView عملية عرض منفصلة تمامًا: لا جسر، لا Node، لا وصول لـ IPC.
 *  - يعطينا capturePage() لقطات، وconsole-message لالتقاط أخطاء الصفحة،
 *    وexecuteJavaScript لفحص الـ DOM — كل ما يحتاجه الوكيل ليتحقق بنفسه.
 *
 * قاعدة أعمدة هذه المعاينة: العملية الرئيسية **لا تخترع** موضعًا أبدًا. الواجهة
 * هي الوحيدة التي تعرف أين حاوية المعاينة على الشاشة، وكل ما هنا هو تطبيق حرفي
 * لما ترسله، أو إخفاء الـ view. أي تخمين هنا يعني مستطيلًا يغطي التطبيق كله
 * ويبتلع كل نقرة.
 */

export { resolveBounds, shouldIgnore, clampToContent, sameResolution, MIN_VISIBLE_EDGE } from './bounds'
export type { BoundsResolution, PreviewRect, PreviewSize } from './bounds'

/** يُعيد مقاس المحتوى مع قيم افتراضية آمنة (الإصدار قد يعيد undefined). */
function contentSize(win: BrowserWindow): PreviewSize {
  const [w, h] = win.getContentSize()
  return { width: w ?? 800, height: h ?? 600 }
}

interface ConsoleEntry {
  level: 'info' | 'warn' | 'error'
  text: string
  line?: number
  /** فاصل وضعناه عند كل إعادة تحميل حتى لا يُفهم السجلّ القديم كأنه خطأ حالي. */
  marker?: string
  at: number
}

interface PreviewState {
  view: WebContentsView | null
  window: BrowserWindow | null
  url: string | null
  logs: ConsoleEntry[]
  viewport: PreviewSize | null
  /** حدود الحاوية كما أرسلتها الواجهة — المصدر الوحيد للحقيقة. */
  bounds: PreviewRect | null
  /** آخر تسلسل حدود طُبِّق؛ يضمن ألا يسبقنا وصولٌ متأخر. */
  lastSeq: number | null
  /** هل حُمّلت صفحة فعليًا؟ قبل ذلك لا نعرض شيئًا، فلا مستطيل غريب فوق الواجهة. */
  loaded: boolean
  /** العنوان الذي قيد التحميل الآن — يمنع loadURL مزدوجًا. */
  loading: string | null
  /** انهيارات متتالية — نمنع حلقة إعادة تحميل لا نهائية. */
  crashes: number
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

/** أقصى عدد انهيارات متتالية قبل أن نتوقف عن إعادة التحميل التلقائية. */
const MAX_AUTO_RELOADS = 3

/** about:blank هي صفحة الـ view قبل أي تحميل — ليست محتوى حقيقيًا. */
const BLANK_URL = 'about:blank'

type LegacyConsoleArgs = {
  level?: number
  message?: string
  line?: number
  sourceId?: string
}

/** يوحّد رسالة الكونسول بين الواجهة القديمة (أرقام) والجديدة (نصوص). */
function readConsoleMessage(
  details: { message?: string; level?: string; lineNumber?: number; sourceId?: string } | undefined,
  legacy: LegacyConsoleArgs,
): { level: 'info' | 'warn' | 'error'; text: string; line?: number } {
  const message = typeof details?.message === 'string' ? details.message : String(legacy.message ?? '')
  const rawLevel =
    typeof details?.level === 'string'
      ? details.level
      : legacy.level === 3
        ? 'error'
        : legacy.level === 2
          ? 'warning'
          : 'info'
  const level: 'info' | 'warn' | 'error' =
    rawLevel === 'error' ? 'error' : rawLevel === 'warning' || rawLevel === 'warn' ? 'warn' : 'info'
  const source = typeof details?.sourceId === 'string' && details.sourceId ? details.sourceId : legacy.sourceId
  const line = typeof details?.lineNumber === 'number' ? details.lineNumber : legacy.line
  return {
    level,
    text: `${message}${source ? ` (${path.basename(source)})` : ''}`,
    line: typeof line === 'number' && line > 0 ? line : undefined,
  }
}

export class PreviewController {
  private state: PreviewState = {
    view: null,
    window: null,
    url: null,
    logs: [],
    viewport: null,
    bounds: null,
    lastSeq: null,
    loaded: false,
    loading: null,
    crashes: 0,
  }

  /** آخر نتيجة طُبِّقت على الـ view — لمنع setBounds بلا تغيير مرئي. */
  private applied: BoundsResolution | null = null
  private appliedVisible: boolean | null = null

  constructor(private readonly ctx: AppContext) {}

  hasView(): boolean {
    return this.state.view !== null
  }

  currentUrl(): string | null {
    return this.state.url
  }

  /**
   * الواجهة تُعلن أين حاوية المعاينة. نسجّل الحدود فقط ولا ننشئ الـ view:
   * الإنشاء قبل وجود رابط يعني مستطيلًا شفافًا فوق مساحة العمل.
   * إن كان هناك رابط مُجهَّز مسبقًا (open قبل attach) نبدأ التحميل الآن.
   */
  attach(win: BrowserWindow, bounds: PreviewBoundsInput, seq?: number): void {
    const previous = this.state.window
    if (this.state.view && previous && previous !== win && !previous.isDestroyed()) {
      try {
        previous.contentView.removeChildView(this.state.view)
      } catch {
        /* النافذة السابقة قد تكون مغلقة */
      }
    }
    this.state.window = win
    // attach إعلان كامل عن الحالة، فنبدأ منه ترتيبًا جديدًا. لولا ذلك تجمّدت
    // كل رسائل resize التالية لأن تسلسل الواجهة الجديد أصغر من تسلسل الجلسة السابقة.
    this.state.lastSeq = readSeq(seq) ?? null
    this.state.bounds = readRect(bounds)
    if (this.state.url) {
      this.mount(win)
      this.startLoading()
    }
    this.sync()
  }

  detach(): void {
    const { view, window: win } = this.state
    if (view) {
      try {
        view.setVisible(false)
      } catch {
        /* تجاهل */
      }
      if (win && !win.isDestroyed()) {
        try {
          win.contentView.removeChildView(view)
        } catch {
          /* النافذة قد تكون مغلقة */
        }
      }
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    this.state.view = null
    this.state.window = null
    this.state.bounds = null
    this.state.lastSeq = null
    this.state.loaded = false
    this.state.loading = null
    this.state.crashes = 0
    this.applied = null
    this.appliedVisible = null
  }

  /**
   * حدود جديدة من الواجهة. `seq` اختياري: إن غاب، تُقبل الرسالة دائمًا.
   *
   * نخزّن الحدود دائمًا — حتى المشوهة منها — لأن التصحيح يأتي في الرسالة التالية،
   * ولأن `setViewport` يحتاج آخر مستطيل صالح بعد أي resize.
   */
  applyBounds(bounds: PreviewBoundsInput, seq?: number): void {
    const explicit = readSeq(seq) ?? readSeq(bounds?.seq)
    if (shouldIgnore(explicit, this.state.lastSeq)) return
    if (explicit !== undefined) this.state.lastSeq = explicit
    this.state.bounds = readRect(bounds)
    this.sync()
  }

  /**
   * تُستدعى عند resize النافذة: تعيد تطبيق الحدود **المخزَّنة** مقصوصةً على
   * مقاس المحتوى الجديد. لا نخمّن مستطيل النافذة كاملة أبدًا — ذلك ما كان يغطي
   * التطبيق كله عند أي سحب أو تغيير حجم.
   */
  onHostResize(): void {
    this.sync()
  }

  /** يضبط حجم إطار العرض (محاكاة جهاز) داخل حدود العنصر المُخزَّنة. */
  setViewport(size: PreviewSize | null): void {
    const clean = size ? readRect({ x: 0, y: 0, width: size.width, height: size.height }) : null
    this.state.viewport = clean && clean.width > 0 && clean.height > 0 ? { width: clean.width, height: clean.height } : null
    this.sync()
  }

  /** يرسل عنوان URL الجديد للواجهة (المعاينة تعمل خارج نطاق React). */
  private broadcastUrl(url: string | null): void {
    const win = this.state.window
    if (!win || win.isDestroyed()) return
    win.webContents.send('preview:url', { url })
  }

  /** ينشئ الـ view عند الحاجة ويثبّته في النافذة، مخفيًا حتى يُحمَّل شيء. */
  private mount(win: BrowserWindow): WebContentsView | null {
    let view = this.state.view
    if (!view) {
      view = new WebContentsView({
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
      this.wire(view)
      this.state.view = view
    }
    try {
      win.contentView.addChildView(view)
    } catch {
      /* النافذة قد تكون مغلقة */
    }
    view.setVisible(false)
    // أزلنا الحفظ المؤقت: view.setVisible(false) أعلاه غيّر الحالة الفعلية،
    // فلو تركنا الحفظ القديم لآخَر sync لقفز فوق الاستدعاء ولم يُظهره.
    this.applied = null
    this.appliedVisible = null
    return view
  }

  private wire(view: WebContentsView): void {
    view.webContents.on('console-message', (details, level, message, line, sourceId) => {
      this.record(readConsoleMessage(details, { level, message, line, sourceId }))
    })
    view.webContents.on('did-finish-load', () => {
      // بعض إصدارات Electron تُطلق did-finish-load لصفحة about:blank الابتدائية.
      // إن صرنا لها «محمَّل» لظهر مستطيل أبيض فارغ فوق مساحة العمل — وهو تحديدًا
      // العيب الذي نصلحه. فلا نُعلن تحميلًا إلا لعنوان حقيقي طلبناه نحن.
      const current = view.webContents.getURL()
      if (!this.state.url || !current || current === BLANK_URL) return
      this.state.crashes = 0
      this.state.loaded = true
      this.sync()
    })
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      // -3 هو الإجهاض المعتاد (انتقال أسرع) وليس خطأ حقيقيًا.
      // لا نُخفي الـ view هنا: إن كان يعرض صفحة، فإخفاؤها عند فشل تحديث يُهمل
      // الدليل الوحيد المتاح. التحميل الأول يبقى مخفيًا أصلًا لأن loaded=false.
      if (!isMainFrame || errorCode === -3) return
      this.push({ type: 'notice', level: 'error', message: `تعذّر تحميل المعاينة — ${errorDescription}` })
    })
    view.webContents.on('render-process-gone', () => {
      this.state.loaded = false
      this.state.crashes += 1
      if (this.state.crashes > MAX_AUTO_RELOADS) {
        this.push({ type: 'notice', level: 'error', message: 'توقّفت المعاينة مرارًا — اضغط «تحديث» لاستئنافها' })
        this.sync()
        return
      }
      this.push({ type: 'notice', level: 'warn', message: 'توقّفت عملية المعاينة — جارٍ إعادة التحميل' })
      this.sync()
      void this.reload()
    })
    view.webContents.setWindowOpenHandler(({ url }) => {
      void this.open(url).catch(() => undefined)
      return { action: 'deny' }
    })
  }

  /**
 * يحمّل العنوان المطلوب إن لم يكن محمَّلًا أو قيد التحميل.
 *
 * العَلَم `loading` يمنع التحميل المزدوج: `open` يبثّ العنوان، فتعيد الواجهة
 * تشغيل تأثيرها فتستدعي `attach`، ولو بلا هذا العَلَم لحملنا الصفحة مرتين.
 */
  private startLoading(): void {
    const view = this.state.view
    const url = this.state.url
    if (!view || !url || this.state.loaded || this.state.loading) return
    this.state.loaded = false
    this.state.loading = url
    this.sync()
    void view.webContents
      .loadURL(url)
      .then(() => {
        if (this.state.loading === url) this.state.loading = null
      })
      .catch((e: Error) => {
        if (this.state.loading === url) this.state.loading = null
        this.push({ type: 'notice', level: 'error', message: `تعذّر تحميل المعاينة — ${e.message}` })
        this.sync()
      })
  }

  /** نقطة الكتابة الوحيدة على حدود الـ view ورؤيته. */
  private sync(): void {
    const view = this.state.view
    if (!view) {
      this.applied = null
      this.appliedVisible = null
      return
    }
    const win = this.state.window
    const clip = win && !win.isDestroyed() ? contentSize(win) : null
    const container = clampToContent(this.state.bounds, clip)
    const resolution = resolveBounds(container, this.state.viewport)
    const visible = resolution.visible && this.state.loaded
    if (sameResolution(this.applied, resolution) && this.appliedVisible === visible) return
    this.applied = resolution
    this.appliedVisible = visible
    if (resolution.visible) view.setBounds(resolution.rect)
    view.setVisible(visible)
  }

  private record(entry: { level: 'info' | 'warn' | 'error'; text: string; line?: number }): void {
    this.state.logs.push({ ...entry, at: Date.now() })
    this.state.logs = keepNewest(this.state.logs, MAX_LOG_ENTRIES)
  }

  /** فاصل في السجلّ بدل المسح: الوكيل يحتاج ما قبل إعادة التحميل أيضًا. */
  private markBoundary(reason: string): void {
    this.state.logs.push({ level: 'info', text: reason, marker: reason, at: Date.now() })
    this.state.logs = keepNewest(this.state.logs, MAX_LOG_ENTRIES)
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
    const previous = this.state.url
    this.state.url = url
    this.broadcastUrl(url)
    const win = this.state.window
    // بلا نافذة أو حاوية معروفة: نحفظ العنوان فقط، وattach سيبدأ التحميل.
    if (!win || win.isDestroyed() || !this.state.bounds) return { ok: true, url }
    if (previous === url && (this.state.loaded || this.state.loading)) return { ok: true, url }
    this.markBoundary(`فتح ${url}`)
    this.state.loaded = false
    this.state.loading = null
    this.mount(win)
    this.startLoading()
    return { ok: true, url }
  }

  close(): void {
    this.detach()
    this.state.url = null
    this.state.logs = []
    this.state.viewport = null
  }

  async reload(): Promise<boolean> {
    const view = this.state.view
    if (!view) return false
    this.markBoundary('إعادة تحميل المعاينة')
    // لا نمسح loaded: الصفحة الحالية تبقى دليلًا صالحًا أثناء إعادة التحميل،
    // وdid-finish-load سيؤكّد من جديد. إن كان الـ view مخفيًا أصلًا فبقي مخفيًا.
    this.state.loading = null
    try {
      await view.webContents.reload()
      return true
    } catch {
      return false
    }
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

  /**
   * التحذيرات والأخطاء التي رآها الوكيل، بترتيب زمني، مع فواصل إعادة التحميل،
   * وبحدّ يحفظ الأحدث. لا نُسقط INFO، ونترك الواجهة تقرّر التلوين.
   */
  consoleErrors(): Array<{ level: string; text: string; line?: number }> {
    const interesting = this.state.logs.filter((l) => l.level !== 'info' || l.marker)
    const tail = keepNewest(interesting, MAX_CONSOLE_ISSUES)
    return tail.map(({ level, text, line }) => ({ level, text, line }))
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