import { clipboard, desktopCapturer, nativeImage, screen } from 'electron'
import type {
  ComputerActionTrace,
  ComputerAgentStatus,
  ComputerControlAction,
  ComputerPlanStep,
  ComputerState,
  ComputerStuckState
} from '@shared/types'
import { getWindow, send } from '../bus'
import { log } from '../logger'
import { sleep, uid } from '../util'
import { appQueryHint, launchApplication } from './appLaunch'
import { floatingHud } from './floatingHud'
import {
  drawCursorAndRulerOnBgra,
  fitLogical,
  mapZoomPointToLogical,
  planZoom,
  toLogicalPoint,
  toPhysicalPoint,
  type Size,
  type ZoomPlan
} from './geometry'
import {
  ActionCycleGuard,
  type FrameFingerprint,
  POINTER_ACTIONS,
  actionSignature,
  compareFingerprints,
  describeAction,
  fingerprintBitmap
} from './visualDiff'
import {
  win32Worker,
  windowMatchesQuery,
  type Win32FocusResult,
  type Win32HitResult,
  type Win32UiElement,
  type Win32WindowInfo
} from './win32Worker'

const DEFAULT_LOGICAL: Size = { w: 1366, h: 768 }


export interface ComputerStepInput {
  action: string
  coordinate?: [number, number]
  start_coordinate?: [number, number]
  x?: number
  y?: number
  start_x?: number
  start_y?: number
  target?: string
  window?: string
  text?: string
  key?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  duration?: number
  submit?: boolean
  clear?: boolean
  from_zoom?: boolean
  thought?: string
  region?: number[]
  steps?: ComputerStepInput[]
}

export class DesktopController {
  state: ComputerState = {
    status: 'idle',
    thought: '',
    stats: { clicks: 0, chars: 0, screenshots: 0, steps: 0, elapsedMs: 0 },
    plan: [],
    lastAction: null,
    lastActions: [],
    cursor: { x: 683, y: 384, nx: 0.5, ny: 0.5 },
    screenWidth: DEFAULT_LOGICAL.w,
    screenHeight: DEFAULT_LOGICAL.h,
    logicalWidth: DEFAULT_LOGICAL.w,
    logicalHeight: DEFAULT_LOGICAL.h,
    activeWindowTitle: '',
    activeWindowProcess: '',
    studioMinimized: false,
    stuck: null
  }

  private runStartedAt: number | null = null
  private pausedAccumMs = 0
  private pauseStartedAt: number | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private pauseResolvers: Array<() => void> = []
  private takeoverReturnedFlag = false
  private logical: Size = { ...DEFAULT_LOGICAL }
  private observed = false
  private stopCallback: ((sessionId?: string) => void) | null = null
  private activeSessionId: string | null = null
  private frameFp: FrameFingerprint | null = null
  private prevFp: FrameFingerprint | null = null
  private cycleGuard = new ActionCycleGuard()
  private lastZoom: ZoomPlan | null = null

  constructor() {
    floatingHud.setCommandHandler((action) => {
      void this.control(action, this.activeSessionId ?? undefined)
    })
  }

  setStopHandler(fn: (sessionId?: string) => void) {
    this.stopCallback = fn
  }

  startSession(sessionId: string) {
    this.activeSessionId = sessionId
    this.runStartedAt = Date.now()
    this.pausedAccumMs = 0
    this.pauseStartedAt = null
    this.takeoverReturnedFlag = false
    this.observed = false
    this.lastZoom = null
    this.cycleGuard.reset()
    this.frameFp = null
    this.state = {
      ...this.state,
      status: 'thinking',
      thought: 'يفحص سطح المكتب ويجهز خطة العمل…',
      stats: { clicks: 0, chars: 0, screenshots: 0, steps: 0, elapsedMs: 0 },
      plan: [],
      lastAction: null,
      lastActions: [],
      stuck: null,
      errorMessage: undefined
    }
    this.startTicker()
    this.syncScreenMetrics()
    this.broadcast()
  }

  endSession(reason: 'done' | 'stopped' | 'error' | 'max_steps', errorMessage?: string) {
    this.stopTicker()
    this.releasePauseWaiters()
    const nextStatus: ComputerAgentStatus =
      reason === 'done'
        ? 'done'
        : reason === 'error'
          ? 'error'
          : 'idle'
    const nextThought =
      reason === 'done'
        ? this.state.thought || 'اكتملت المهمة بنجاح على سطح المكتب ✅'
        : reason === 'stopped'
          ? 'أُوقف الوكيل بناءً على طلبك.'
          : reason === 'max_steps'
            ? 'وصل الوكيل إلى الحد الأقصى للخطوات.'
            : errorMessage || 'توقف الوكيل بسبب خطأ.'
    this.state = {
      ...this.state,
      status: nextStatus,
      thought: nextThought,
      errorMessage
    }
    this.broadcast()
  }

  private startTicker() {
    this.stopTicker()
    this.ticker = setInterval(() => {
      if (!this.runStartedAt) return
      if (
        this.state.status === 'paused' ||
        this.state.status === 'takeover' ||
        this.state.status === 'idle' ||
        this.state.status === 'done' ||
        this.state.status === 'error'
      ) {
        return
      }
      const elapsed = Math.max(0, Date.now() - this.runStartedAt - this.pausedAccumMs)
      this.state = {
        ...this.state,
        stats: { ...this.state.stats, elapsedMs: elapsed }
      }
      this.broadcast()
    }, 1000)
  }

  private stopTicker() {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }

  logicalSize(): Size {
    return { ...this.logical }
  }

  private applyScreenSize(sw: number, sh: number) {
    if (!(sw > 0 && sh > 0)) return
    this.logical = fitLogical(sw, sh)
    this.state.screenWidth = Math.round(sw)
    this.state.screenHeight = Math.round(sh)
    this.state.logicalWidth = this.logical.w
    this.state.logicalHeight = this.logical.h
  }

  private syncScreenMetrics() {
    try {
      const disp = screen.getPrimaryDisplay()
      const sf = disp.scaleFactor || 1
      this.applyScreenSize(disp.bounds.width * sf, disp.bounds.height * sf)
    } catch {}
  }

  private screenSize(): Size {
    return { w: Math.max(1, this.state.screenWidth), h: Math.max(1, this.state.screenHeight) }
  }

  toPhysical(x: number, y: number): { physX: number; physY: number; nx: number; ny: number; clampedX: number; clampedY: number } {
    return toPhysicalPoint(x, y, this.logical, this.screenSize())
  }

  toLogical(physX: number, physY: number): { x: number; y: number; nx: number; ny: number } {
    return toLogicalPoint(physX, physY, this.logical, this.screenSize())
  }

  setStatus(status: ComputerAgentStatus, thought?: string) {
    if (this.state.status === 'paused' || this.state.status === 'takeover') {
      if (thought) this.state.thought = thought
      this.broadcast()
      return
    }
    this.state = {
      ...this.state,
      status,
      ...(thought ? { thought: thought.trim() } : {})
    }
    this.broadcast()
  }

  setThought(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) return
    const firstLine = clean.split('\n')[0].slice(0, 140)
    this.state = { ...this.state, thought: firstLine }
    this.broadcast()
  }

  updatePlan(planTitles: string[], doneIndexes: number[]) {
    const doneSet = new Set(doneIndexes.map((n) => Number(n)))
    let activeAssigned = false
    const steps: ComputerPlanStep[] = planTitles.map((title, idx) => {
      if (doneSet.has(idx) || doneSet.has(idx + 1)) {
        return { title: String(title).trim(), state: 'done' as const }
      }
      if (!activeAssigned) {
        activeAssigned = true
        return { title: String(title).trim(), state: 'active' as const }
      }
      return { title: String(title).trim(), state: 'pending' as const }
    })
    this.state = { ...this.state, plan: steps }
    this.broadcast()
  }

  incrementStep() {
    this.state = {
      ...this.state,
      stats: { ...this.state.stats, steps: this.state.stats.steps + 1 }
    }
    this.broadcast()
  }

  consumeTakeoverReturned(): boolean {
    if (!this.takeoverReturnedFlag) return false
    this.takeoverReturnedFlag = false
    return true
  }

  async waitWhilePaused(signal?: AbortSignal): Promise<void> {
    while (this.state.status === 'paused' || this.state.status === 'takeover') {
      if (signal?.aborted) return
      await new Promise<void>((resolve) => {
        const onAbort = () => resolve()
        signal?.addEventListener('abort', onAbort, { once: true })
        this.pauseResolvers.push(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
    }
  }

  private releasePauseWaiters() {
    const list = this.pauseResolvers.splice(0)
    for (const r of list) r()
  }

  async control(action: ComputerControlAction, sessionId?: string): Promise<ComputerState> {
    switch (action) {
      case 'pause':
        if (this.state.status !== 'paused' && this.state.status !== 'takeover') {
          this.pauseStartedAt = Date.now()
          this.state = { ...this.state, status: 'paused', thought: 'متوقف مؤقتاً — بانتظار استئنافك.' }
          this.broadcast()
        }
        break

      case 'takeover':
        if (this.state.status !== 'takeover') {
          if (!this.pauseStartedAt) this.pauseStartedAt = Date.now()
          this.state = {
            ...this.state,
            status: 'takeover',
            thought: '✋ الجهاز بين يديك الآن — تحكّم بالماوس والكيبورد بحرية، ثم اضغط «أعد الإيجنت».'
          }
          this.broadcast()
        }
        break

      case 'resume':
        if (this.pauseStartedAt) {
          this.pausedAccumMs += Date.now() - this.pauseStartedAt
          this.pauseStartedAt = null
        }
        this.state = { ...this.state, status: 'thinking', thought: 'يستأنف العمل على سطح المكتب…' }
        this.releasePauseWaiters()
        this.broadcast()
        break

      case 'return':
        if (this.pauseStartedAt) {
          this.pausedAccumMs += Date.now() - this.pauseStartedAt
          this.pauseStartedAt = null
        }
        this.takeoverReturnedFlag = true
        this.state = {
          ...this.state,
          status: 'thinking',
          thought: 'يفحص التغييرات التي أجريتها على الشاشة ويكمل المهمة…'
        }
        this.releasePauseWaiters()
        this.broadcast()
        break

      case 'minimize_studio':
        this.minimizeStudio()
        break

      case 'restore_studio':
        this.restoreStudio()
        break

      case 'stop':
        this.releasePauseWaiters()
        this.stopCallback?.(sessionId ?? this.activeSessionId ?? undefined)
        this.endSession('stopped')
        break
    }
    return this.state
  }

  minimizeStudio() {
    try {
      const w = getWindow()
      if (w && !w.isDestroyed() && !w.isMinimized()) {
        w.minimize()
      }
      const minimized = !!w && !w.isDestroyed() && w.isMinimized()
      if (!minimized && w && !w.isDestroyed()) {
        w.minimize()
      }
      this.state = { ...this.state, studioMinimized: true }
      floatingHud.show(this.state)
      this.broadcast()
    } catch (e) {
      log.warn('تعذّر تصغير النافذة', String(e))
    }
  }

  restoreStudio() {
    try {
      const w = getWindow()
      if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      }
      this.state = { ...this.state, studioMinimized: false }
      if (this.state.status === 'idle' || this.state.status === 'done' || this.state.status === 'error') {
        floatingHud.hide()
      }
      this.broadcast()
    } catch (e) {
      log.warn('تعذّر استعادة النافذة', String(e))
    }
  }

  async screenshot(countStat = true): Promise<{
    mediaType: string
    data: string
    width: number
    height: number
    cursorX: number
    cursorY: number
    activeTitle: string
    unchanged?: boolean
  }> {
    try {
      const cursorInfo = await win32Worker.call<any>('cursor').catch(() => null)
      if (cursorInfo && cursorInfo.screenW && cursorInfo.screenH) {
        this.applyScreenSize(cursorInfo.screenW, cursorInfo.screenH)
        const logPos = this.toLogical(cursorInfo.x ?? 0, cursorInfo.y ?? 0)
        this.state.cursor = logPos
        this.state.activeWindowTitle = String(cursorInfo.activeTitle ?? '')
        this.state.activeWindowProcess = String(cursorInfo.activeProc ?? '')
      } else {
        this.syncScreenMetrics()
      }
    } catch {
      this.syncScreenMetrics()
    }

    const { w: LW, h: LH } = this.logical
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: LW, height: LH }
    })
    const primaryId = (() => {
      try {
        return String(screen.getPrimaryDisplay().id)
      } catch {
        return ''
      }
    })()
    const primary = sources.find((s) => s.display_id === primaryId) ?? sources[0]
    if (!primary) throw new Error('لم يُعثر على شاشة لالتقاطها')

    let img = primary.thumbnail
    const sz = img.getSize()
    if (sz.width !== LW || sz.height !== LH) {
      img = img.resize({ width: LW, height: LH, quality: 'best' })
    }

    let base64 = ''
    let unchanged = false
    try {
      const rawBmp = Buffer.from(img.toBitmap())
      this.frameFp = fingerprintBitmap(rawBmp, LW, LH)
      drawCursorAndRulerOnBgra(rawBmp, LW, LH, this.state.cursor.x, this.state.cursor.y)
      const annotated = nativeImage.createFromBitmap(rawBmp, { width: LW, height: LH })
      base64 = annotated.toJPEG(82).toString('base64')
    } catch {
      this.frameFp = null
      base64 = img.toJPEG(82).toString('base64')
    }

    if (this.frameFp && this.prevFp) {
      const d = compareFingerprints(this.prevFp, this.frameFp)
      unchanged = !d.changed
    }
    this.prevFp = this.frameFp

    this.observed = true
    this.state = {
      ...this.state,
      stats: countStat
        ? { ...this.state.stats, screenshots: this.state.stats.screenshots + 1 }
        : this.state.stats
    }
    this.broadcast()

    return {
      mediaType: 'image/jpeg',
      data: base64,
      width: LW,
      height: LH,
      cursorX: this.state.cursor.x,
      cursorY: this.state.cursor.y,
      activeTitle: this.state.activeWindowTitle,
      unchanged
    }
  }

  async inspectUiElements(maxItems = 35): Promise<Win32UiElement[]> {
    try {
      const res = await win32Worker.call<{ elements?: Win32UiElement[] }>('inspectUi', { maxItems })
      const raw = Array.isArray(res?.elements) ? res.elements : []
      return raw.map((el) => {
        const c = this.toLogical(el.cx, el.cy)
        const tl = this.toLogical(el.x, el.y)
        const br = this.toLogical(el.x + el.width, el.y + el.height)
        return {
          ...el,
          cx: c.x,
          cy: c.y,
          x: tl.x,
          y: tl.y,
          width: Math.max(1, br.x - tl.x),
          height: Math.max(1, br.y - tl.y)
        }
      })
    } catch {
      return []
    }
  }

  async findUiTarget(query: string): Promise<{
    physX: number
    physY: number
    clampedX: number
    clampedY: number
    nx: number
    ny: number
    role: string
    name: string
  } | null> {
    const q = String(query ?? '').trim()
    if (!q) return null
    try {
      const res = await win32Worker.call<{ element?: Win32HitResult | null }>('findTarget', { query: q })
      const el = res?.element
      if (!el || typeof el.cx !== 'number' || typeof el.cy !== 'number') return null
      const logPt = this.toLogical(el.cx, el.cy)
      return {
        physX: el.cx,
        physY: el.cy,
        clampedX: logPt.x,
        clampedY: logPt.y,
        nx: logPt.nx,
        ny: logPt.ny,
        role: el.role || 'Control',
        name: el.name || q
      }
    } catch {
      return null
    }
  }

  async ensureNoStuckDialog(): Promise<{ closed: boolean; dialogTitle: string }> {
    try {
      const res = await win32Worker.call<any>('ensureNoDialog')
      const r = typeof res?.result === 'string' ? JSON.parse(res.result) : res?.result
      return { closed: !!r?.closed, dialogTitle: String(r?.dialog ?? '') }
    } catch {
      return { closed: false, dialogTitle: '' }
    }
  }

  async focusUiTarget(query: string): Promise<boolean> {
    try {
      const res = await win32Worker.call<any>('focusTarget', { query })
      const el = res?.element
      return !!el && el.focused !== false
    } catch {
      return false
    }
  }

  async zoomShot(region?: number[]): Promise<{ image: Awaited<ReturnType<DesktopController['screenshot']>>; note: string }> {
    if (!Array.isArray(region) || region.length < 4 || region.slice(0, 4).some((v) => isNaN(Number(v)))) {
      throw new Error('zoom يتطلب region: [x1, y1, x2, y2] بإحداثيات اللقطة (الزاوية العليا اليسرى ثم السفلى اليمنى).')
    }
    const cur = await win32Worker.call<any>('cursor').catch(() => null)
    if (cur?.screenW && cur?.screenH) this.applyScreenSize(cur.screenW, cur.screenH)
    const scr = this.screenSize()
    const plan = planZoom(region, this.logical, scr)
    this.lastZoom = plan

    const primaryId = (() => {
      try {
        return String(screen.getPrimaryDisplay().id)
      } catch {
        return ''
      }
    })()
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: scr.w, height: scr.h } })
    const src = sources.find((x) => x.display_id === primaryId) ?? sources[0]
    if (!src) throw new Error('لم يُعثر على شاشة لالتقاطها')
    const full = src.thumbnail
    const fs = full.getSize()
    const kx = fs.width / scr.w
    const ky = fs.height / scr.h
    const crop = {
      x: Math.max(0, Math.min(fs.width - 1, Math.round(plan.crop.x * kx))),
      y: Math.max(0, Math.min(fs.height - 1, Math.round(plan.crop.y * ky))),
      width: Math.max(1, Math.round(plan.crop.width * kx)),
      height: Math.max(1, Math.round(plan.crop.height * ky))
    }
    crop.width = Math.min(crop.width, fs.width - crop.x)
    crop.height = Math.min(crop.height, fs.height - crop.y)
    const img = full.crop(crop).resize({ width: plan.out.w, height: plan.out.h, quality: 'best' })
    this.observed = true

    const [x1, y1, x2, y2] = plan.region
    const cxMid = Math.round((x1 + x2) / 2)
    const cyMid = Math.round((y1 + y2) / 2)

    const allUi = await this.inspectUiElements(45)
    const inRegion = allUi.filter((u) => u.cx >= x1 - 15 && u.cx <= x2 + 15 && u.cy >= y1 - 15 && u.cy <= y2 + 15)
    const uiLines = inRegion.length
      ? '\n🎯 عناصر قابلة للنقر مباشرة داخل هذه المنطقة (استعمل إحداثيات الشاشة الكاملة هذه مباشرة):\n' +
        inRegion.slice(0, 12).map((u) => `  • [${u.role}] «${u.name || 'عنصر'}» ← انقر مباشرة عند coordinate: [${u.cx}, ${u.cy}]`).join('\n')
      : ''

    const note =
      `🔍 تكبير المنطقة [${x1}, ${y1}, ${x2}, ${y2}] (مركزها في الشاشة الكاملة: [${cxMid}, ${cyMid}]).\n` +
      `انقر مباشرة بإحداثيات الشاشة الكاملة (${this.logical.w}×${this.logical.h}) بدون إعادة zoom مرة أخرى!${uiLines}`

    return {
      image: {
        mediaType: 'image/jpeg',
        data: img.toJPEG(88).toString('base64'),
        width: plan.out.w,
        height: plan.out.h,
        cursorX: this.state.cursor.x,
        cursorY: this.state.cursor.y,
        activeTitle: this.state.activeWindowTitle
      },
      note
    }
  }

  async executeComputerAction(
    input: ComputerStepInput,
    signal?: AbortSignal
  ): Promise<{ summary: string; shot: Awaited<ReturnType<DesktopController['screenshot']>>; blocked?: boolean }> {
    await this.waitWhilePaused(signal)
    if (signal?.aborted) throw new Error('أُوقفت العملية')

    const actionStartMs = Date.now()
    const kind = String(input.action || '').trim().toLowerCase()
    if (input.thought) this.setThought(String(input.thought))
    this.setStatus('acting')

    if ((kind === 'batch' || Array.isArray(input.steps)) && Array.isArray(input.steps) && input.steps.length > 0) {
      const stepSummaries: string[] = []
      let lastRes: { summary: string; shot: Awaited<ReturnType<DesktopController['screenshot']>>; blocked?: boolean } | null = null
      for (const sub of input.steps.slice(0, 25)) {
        if (signal?.aborted) break
        lastRes = await this.executeComputerAction({ ...sub, steps: undefined }, signal)
        stepSummaries.push(lastRes.summary.split(' | ')[0] || sub.action)
      }
      if (lastRes) {
        return {
          summary: `نُفّذت سلسلة أوامر (${stepSummaries.length}): ${stepSummaries.join(' ← ')} | المؤشر الآن: (${lastRes.shot.cursorX}, ${lastRes.shot.cursorY}) | النافذة النشطة: «${lastRes.shot.activeTitle || 'سطح المكتب'}»`,
          shot: lastRes.shot
        }
      }
    }

    if (kind === 'clipboard_read') {
      const text = String((await Promise.resolve(clipboard.readText())) ?? '')
      const shot = await this.screenshot(false)
      return {
        summary: `محتوى الحافظة (${text.length} حرف):\n${text || '(الحافظة فارغة)'}`,
        shot
      }
    }

    if (kind === 'clipboard_write') {
      const text = String(input.text ?? '')
      clipboard.writeText(text)
      const shot = await this.screenshot(false)
      return {
        summary: `نُسخ إلى الحافظة (${text.length} حرف): «${text.slice(0, 80)}»`,
        shot
      }
    }

    if (kind === 'inspect_ui' || kind === 'ui_map') {
      const els = await this.inspectUiElements(45)
      const shot = await this.screenshot(false)
      const formatted = els.length
        ? els.map((e) => `[#${e.id}] ${e.role} «${e.name || 'بلا عنوان'}» ← coordinate: [${e.cx}, ${e.cy}] (${e.width}×${e.height})`).join('\n')
        : '(لم تُكتشف عناصر UIA قياسية في هذه النافذة — اعتمد على الإحداثيات البصرية المباشرة من اللقطة)'
      return {
        summary: `🎯 الخريطة الهندسية للعناصر التفاعلية في «${shot.activeTitle || 'سطح المكتب'}» (${els.length} عنصر — بإحداثيات الشاشة ${shot.width}×${shot.height}):\n${formatted}`,
        shot
      }
    }

    let rawX = input.coordinate?.[0] ?? input.x
    let rawY = input.coordinate?.[1] ?? input.y
    const rawStartX = input.start_coordinate?.[0] ?? input.start_x
    const rawStartY = input.start_coordinate?.[1] ?? input.start_y

    if (input.from_zoom && this.lastZoom && rawX != null && rawY != null) {
      const mapped = mapZoomPointToLogical(Number(rawX), Number(rawY), this.lastZoom)
      rawX = mapped.x
      rawY = mapped.y
    }

    const hasXY = rawX != null && rawY != null && !isNaN(Number(rawX)) && !isNaN(Number(rawY))

    let windowNote = ''
    if (input.window && String(input.window).trim()) {
      const wq = String(input.window).trim()
      const fw = await this.focusWindow(wq, false, false)
      if (fw.ok) {
        windowNote = ` [🪟 تم تفعيل «${fw.activeTitle || wq}» أولاً]`
        await sleep(120, signal)
      } else {
        windowNote = ` [⚠ تعذّر تفعيل النافذة «${wq}» — النافذة النشطة: «${fw.activeTitle || 'سطح المكتب'}»]`
      }
    }

    let targetMatchedInfo = ''
    let target = hasXY ? this.toPhysical(Number(rawX), Number(rawY)) : null

    if (input.target && String(input.target).trim()) {
      const uiTarget = await this.findUiTarget(String(input.target))
      if (uiTarget) {
        target = {
          physX: uiTarget.physX,
          physY: uiTarget.physY,
          clampedX: uiTarget.clampedX,
          clampedY: uiTarget.clampedY,
          nx: uiTarget.nx,
          ny: uiTarget.ny
        }
        targetMatchedInfo = ` [🎯 UIA: ${uiTarget.role} «${uiTarget.name}» @(${uiTarget.clampedX},${uiTarget.clampedY})]`
      } else if (!target) {
        const candidates = await this.inspectUiElements(25)
        const near = candidates
          .map((c) => c.name)
          .filter(Boolean)
          .slice(0, 12)
        const shot = await this.screenshot(false)
        return {
          summary:
            `لم يُعثر على عنصر واجهة باسم «${String(input.target).trim()}» في النافذة «${this.state.activeWindowTitle || 'سطح المكتب'}».\n` +
            (near.length
              ? `العناصر التفاعلية المتاحة فعلياً الآن:\n` +
                near.map((n) => `  • ${n}`).join('\n') +
                `\nأو استعمل الإحداثيات المباشرة من اللقطة المرفقة (${this.logical.w}×${this.logical.h}).`
              : `لا توجد عناصر UIA قياسية في هذه النافذة — استعمل الإحداثيات المباشرة من اللقطة المرفقة (${this.logical.w}×${this.logical.h}).`),
          shot
        }
      }
    }

    const hasStart = rawStartX != null && rawStartY != null && !isNaN(Number(rawStartX)) && !isNaN(Number(rawStartY))
    const startTarget = hasStart ? this.toPhysical(Number(rawStartX), Number(rawStartY)) : null

    const recordTrace = (detail?: string, hit?: Win32HitResult | null) => {
      const trace: ComputerActionTrace = {
        id: uid('act_'),
        kind,
        x: target?.clampedX ?? this.state.cursor.x,
        y: target?.clampedY ?? this.state.cursor.y,
        nx: target?.nx ?? this.state.cursor.nx,
        ny: target?.ny ?? this.state.cursor.ny,
        startX: startTarget?.clampedX,
        startY: startTarget?.clampedY,
        startNx: startTarget?.nx,
        startNy: startTarget?.ny,
        text: input.text ?? input.key ?? input.target,
        detail,
        hitRole: hit?.role,
        hitName: hit?.name,
        ms: Date.now() - actionStartMs,
        ts: Date.now()
      }
      if (target) {
        this.state.cursor = { x: target.clampedX, y: target.clampedY, nx: target.nx, ny: target.ny }
      }
      this.state = { ...this.state, lastAction: trace }
      this.broadcast()
    }

    if (!this.observed && !['screenshot', 'cursor_position', 'zoom', 'wait'].includes(kind)) {
      await this.screenshot(true)
    }

    const sig = actionSignature(kind, {
      ...input,
      x: target?.clampedX ?? rawX,
      y: target?.clampedY ?? rawY
    })
    const beforeFp = this.frameFp

    const gate = this.cycleGuard.preflight(kind, target?.clampedX, target?.clampedY, sig)
    if (gate.blocked && POINTER_ACTIONS.has(kind)) {
      const where = describeAction(kind, target?.clampedX, target?.clampedY)
      log.warn(`[loop-guard] تكرر «${where}» في ${gate.unchangedRepeats} محاولات بلا تغيير مرئي`)
    }

    let summary = ''
    let lastHit: Win32HitResult | null = null

    switch (kind) {
      case 'screenshot': {
        const shot = await this.screenshot(true)
        return {
          summary: `لقطة شاشة 1:1 (${shot.width}×${shot.height}) | المؤشر: (${shot.cursorX}, ${shot.cursorY}) | النافذة النشطة: «${shot.activeTitle || 'سطح المكتب'}»`,
          shot
        }
      }

      case 'zoom': {
        const shot = await this.zoomShot(input.region)
        return { summary: shot.note, shot: shot.image }
      }

      case 'cursor_position': {
        const c = await win32Worker.call<any>('cursor')
        this.applyScreenSize(c.screenW || this.state.screenWidth, c.screenH || this.state.screenHeight)
        const logPos = this.toLogical(c.x, c.y)
        this.state.cursor = logPos
        this.state.activeWindowTitle = String(c.activeTitle || '')
        this.state.activeWindowProcess = String(c.activeProc || '')
        this.broadcast()
        const shot = await this.screenshot(false)
        return {
          summary: `موقع المؤشر الحالي: (${logPos.x}, ${logPos.y}) | النافذة النشطة: «${this.state.activeWindowTitle || 'سطح المكتب'}»${this.state.activeWindowProcess ? ` (${this.state.activeWindowProcess})` : ''}`,
          shot
        }
      }

      case 'mouse_move': {
        if (!target) throw new Error('أمر mouse_move يتطلب إحداثيات (x, y) أو coordinate: [x, y] أو target.')
        const res = await win32Worker.call<{ hit?: Win32HitResult | null }>('move', {
          x: target.physX,
          y: target.physY,
          durationMs: -1
        })
        lastHit = res?.hit ?? null
        recordTrace(`تحريك المؤشر إلى (${target.clampedX}, ${target.clampedY})`, lastHit)
        summary = `تحرّك المؤشر إلى (${target.clampedX}, ${target.clampedY})${targetMatchedInfo}`
        break
      }

      case 'left_click':
      case 'click': {
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        const res = await win32Worker.call<{ hit?: Win32HitResult | null }>('click', {
          button: 'left',
          x: px,
          y: py,
          count: 1,
          moveMs: -1
        })
        lastHit = res?.hit ?? null
        this.state.stats = { ...this.state.stats, clicks: this.state.stats.clicks + 1 }
        if (input.text != null && String(input.text).length > 0) {
          const txt = String(input.text)
          await sleep(35, signal)
          await win32Worker.call(
            'type',
            { text: txt, delayMs: 0, clear: !!input.clear },
            Math.max(12000, txt.length * 25 + 6000)
          )
          if (input.submit) {
            await sleep(25, signal)
            await win32Worker.call('key', { key: 'Return', holdMs: 25 })
          }
          this.state.stats = { ...this.state.stats, chars: this.state.stats.chars + txt.length }
          recordTrace(
            `نقر (${target?.clampedX ?? ''},${target?.clampedY ?? ''}) + كتابة «${txt.slice(0, 35)}»`,
            lastHit
          )
          summary = `نُقر عند (${target?.clampedX ?? this.state.cursor.x}, ${target?.clampedY ?? this.state.cursor.y})${targetMatchedInfo} وكُتب «${txt.slice(0, 50)}»${input.submit ? ' + Enter' : ''}`
        } else {
          recordTrace(
            target ? `نقر أيسر عند (${target.clampedX}, ${target.clampedY})` : 'نقر أيسر في الموضع الحالي',
            lastHit
          )
          summary = target
            ? `نُقر بالزر الأيسر عند (${target.clampedX}, ${target.clampedY})${targetMatchedInfo}`
            : 'نُقر بالزر الأيسر'
        }
        break
      }

      case 'double_click': {
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        const res = await win32Worker.call<{ hit?: Win32HitResult | null }>('click', {
          button: 'left',
          x: px,
          y: py,
          count: 2,
          moveMs: -1
        })
        lastHit = res?.hit ?? null
        recordTrace(target ? `نقر مزدوج عند (${target.clampedX}, ${target.clampedY})` : 'نقر مزدوج', lastHit)
        this.state.stats = { ...this.state.stats, clicks: this.state.stats.clicks + 2 }
        summary = target
          ? `نُقر نقراً مزدوجاً عند (${target.clampedX}, ${target.clampedY})${targetMatchedInfo}`
          : 'نُقر نقراً مزدوجاً'
        break
      }

      case 'triple_click': {
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        const res = await win32Worker.call<{ hit?: Win32HitResult | null }>('click', {
          button: 'left',
          x: px,
          y: py,
          count: 3,
          moveMs: -1
        })
        lastHit = res?.hit ?? null
        recordTrace(target ? `نقر ثلاثي عند (${target.clampedX}, ${target.clampedY})` : 'نقر ثلاثي', lastHit)
        this.state.stats = { ...this.state.stats, clicks: this.state.stats.clicks + 3 }
        if (input.text != null && String(input.text).length > 0) {
          const txt = String(input.text)
          await sleep(25, signal)
          await win32Worker.call('type', { text: txt, delayMs: 0 }, Math.max(12000, txt.length * 25 + 6000))
          if (input.submit) {
            await sleep(25, signal)
            await win32Worker.call('key', { key: 'Return', holdMs: 25 })
          }
          this.state.stats = { ...this.state.stats, chars: this.state.stats.chars + txt.length }
          summary = `نُقر ثلاثياً عند (${target?.clampedX ?? this.state.cursor.x}, ${target?.clampedY ?? this.state.cursor.y}) واستُبدل النص بـ «${txt.slice(0, 50)}»${input.submit ? ' + Enter' : ''}`
        } else {
          summary = target
            ? `نُقر نقراً ثلاثياً عند (${target.clampedX}, ${target.clampedY})${targetMatchedInfo}`
            : 'نُقر نقراً ثلاثياً'
        }
        break
      }

      case 'right_click': {
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        const res = await win32Worker.call<{ hit?: Win32HitResult | null }>('click', {
          button: 'right',
          x: px,
          y: py,
          count: 1,
          moveMs: -1
        })
        lastHit = res?.hit ?? null
        recordTrace(target ? `نقر أيمن عند (${target.clampedX}, ${target.clampedY})` : 'نقر أيمن', lastHit)
        this.state.stats = { ...this.state.stats, clicks: this.state.stats.clicks + 1 }
        summary = target
          ? `نُقر بالزر الأيمن عند (${target.clampedX}, ${target.clampedY})${targetMatchedInfo}`
          : 'نُقر بالزر الأيمن'
        break
      }

      case 'middle_click': {
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        const res = await win32Worker.call<{ hit?: Win32HitResult | null }>('click', {
          button: 'middle',
          x: px,
          y: py,
          count: 1,
          moveMs: -1
        })
        lastHit = res?.hit ?? null
        recordTrace(target ? `نقر أوسط عند (${target.clampedX}, ${target.clampedY})` : 'نقر أوسط', lastHit)
        this.state.stats = { ...this.state.stats, clicks: this.state.stats.clicks + 1 }
        summary = target
          ? `نُقر بالزر الأوسط عند (${target.clampedX}, ${target.clampedY})${targetMatchedInfo}`
          : 'نُقر بالزر الأوسط'
        break
      }

      case 'left_mouse_down': {
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        recordTrace('ضغط زر الماوس الأيسر باستمرار')
        await win32Worker.call('mouseButton', { button: 'left', down: true, x: px, y: py })
        summary = 'ضُغط زر الماوس الأيسر للأسفل'
        break
      }

      case 'left_mouse_up': {
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        recordTrace('إفلات زر الماوس الأيسر')
        await win32Worker.call('mouseButton', { button: 'left', down: false, x: px, y: py })
        summary = 'أُفلت زر الماوس الأيسر'
        break
      }

      case 'left_click_drag':
      case 'drag': {
        if (!target) throw new Error('أمر left_click_drag يتطلب إحداثيات النهاية (x, y) أو coordinate: [x, y].')
        const sx = startTarget ? startTarget.physX : -1
        const sy = startTarget ? startTarget.physY : -1
        recordTrace(`سحب إلى (${target.clampedX}, ${target.clampedY})`)
        await win32Worker.call('drag', { startX: sx, startY: sy, endX: target.physX, endY: target.physY })
        this.state.stats = { ...this.state.stats, clicks: this.state.stats.clicks + 1 }
        summary = startTarget
          ? `سُحب من (${startTarget.clampedX}, ${startTarget.clampedY}) إلى (${target.clampedX}, ${target.clampedY})`
          : `سُحب المؤشر إلى (${target.clampedX}, ${target.clampedY})`
        break
      }

      case 'type': {
        const txt = String(input.text ?? '')
        if (!txt) throw new Error('أمر type يتطلب حقل text غير فارغ.')
        const dialog = await this.ensureNoStuckDialog()
        if (dialog.closed) {
          windowNote += ` [↩ أُغلق حوار عالق: «${dialog.dialogTitle}»] `
        }
        if (target) {
          const res = await win32Worker.call<{ hit?: Win32HitResult | null }>('click', {
            button: 'left',
            x: target.physX,
            y: target.physY,
            count: 1,
            moveMs: -1
          })
          lastHit = res?.hit ?? null
          this.state.stats = { ...this.state.stats, clicks: this.state.stats.clicks + 1 }
          await sleep(35, signal)
          if (input.target) {
            const focused = await this.focusUiTarget(String(input.target))
            if (focused) windowNote += ' [🔒 تركيز مباشر على الحقل]'
          }
        }
        recordTrace(`كتابة: «${txt.slice(0, 40)}»`, lastHit)
        await win32Worker.call(
          'type',
          { text: txt, delayMs: 0, clear: !!input.clear },
          Math.max(12000, txt.length * 25 + 6000)
        )
        if (input.submit) {
          await sleep(25, signal)
          await win32Worker.call('key', { key: 'Return', holdMs: 25 })
        }
        this.state.stats = { ...this.state.stats, chars: this.state.stats.chars + txt.length }
        summary = `كُتب النص «${txt.slice(0, 60)}»${targetMatchedInfo}${windowNote}${input.clear ? ' (بعد مسح الحقل)' : ''}${input.submit ? ' + Enter' : ''}`
        break
      }

      case 'key':
      case 'hold_key': {
        const k = String(input.key ?? input.text ?? '').trim()
        if (!k) throw new Error('أمر key يتطلب اسم المفتاح في حقل key أو text (مثال: "Return" أو "ctrl+l").')
        const holdMs =
          kind === 'hold_key'
            ? Math.min(5000, Math.max(80, Number(input.duration || 0.5) * (Number(input.duration) < 20 ? 1000 : 1)))
            : 25
        const dialog = await this.ensureNoStuckDialog()
        if (dialog.closed) windowNote += ` [↩ أُغلق حوار عالق: «${dialog.dialogTitle}»] `
        await win32Worker.call('key', { key: k, holdMs })
        if (input.key && input.text && String(input.text).trim() && input.text !== input.key) {
          const txt = String(input.text)
          await sleep(40, signal)
          await win32Worker.call('type', { text: txt, delayMs: 0, clear: !!input.clear }, Math.max(12000, txt.length * 25 + 6000))
          if (input.submit) {
            await sleep(25, signal)
            await win32Worker.call('key', { key: 'Return', holdMs: 25 })
          }
          this.state.stats = { ...this.state.stats, chars: this.state.stats.chars + txt.length }
          recordTrace(`مفتاح ${k} + كتابة «${txt.slice(0, 35)}»`)
          summary = `ضُغط «${k}» ثم كُتب «${txt.slice(0, 50)}»${windowNote}${input.submit ? ' + Enter' : ''}`
        } else {
          if (input.submit && k.toLowerCase() !== 'return' && k.toLowerCase() !== 'enter') {
            await sleep(25, signal)
            await win32Worker.call('key', { key: 'Return', holdMs: 25 })
          }
          recordTrace(`مفتاح: ${k}`)
          summary = `ضُغط المفتاح «${k}»${windowNote}${input.submit ? ' + Enter' : ''}`
        }
        break
      }

      case 'scroll': {
        const dir = input.direction ?? 'down'
        const amt = Math.max(1, Math.min(60, Number(input.amount) || 3))
        const px = target ? target.physX : -1
        const py = target ? target.physY : -1
        recordTrace(`تمرير ${dir} (${amt})`)
        await win32Worker.call('scroll', { direction: dir, amount: amt, x: px, y: py })
        summary = `مُرّر بالاتجاه ${dir} بمقدار ${amt}`
        break
      }

      case 'wait': {
        const rawDur = Number(input.duration ?? 1)
        const waitMs = Math.min(60000, Math.max(100, rawDur <= 60 ? rawDur * 1000 : rawDur))
        recordTrace(`انتظار ${Math.round(waitMs / 100) / 10} ثانية`)
        await sleep(waitMs, signal)
        summary = `انتظر ${Math.round(waitMs / 100) / 10} ثانية`
        break
      }

      default:
        throw new Error(
          `نوع العملية غير معروف: "${kind}". القيم المدعومة: screenshot, inspect_ui, zoom, left_click, double_click, triple_click, right_click, middle_click, mouse_move, left_click_drag, left_mouse_down, left_mouse_up, type, key, hold_key, scroll, wait, cursor_position, batch, clipboard_read, clipboard_write.`
        )
    }

    const settleMs = kind === 'type' || kind === 'key' ? 75 : 60
    await sleep(settleMs, signal).catch(() => {})
    const shot = await this.screenshot(true)

    const delta = compareFingerprints(beforeFp, this.frameFp)
    const cycle = this.cycleGuard.observe(kind, delta.changed, { x: target?.clampedX, y: target?.clampedY, sig })

    const lastTrace = this.state.lastAction
    if (lastTrace) {
      lastTrace.changedScreen = delta.changed
      lastTrace.ms = Date.now() - actionStartMs
    }
    const stuckEligible = POINTER_ACTIONS.has(kind) ? 1 : 3
    const stuck: ComputerStuckState | null =
      !delta.changed && cycle.unchangedRepeats >= stuckEligible
        ? {
            kind,
            x: target?.clampedX,
            y: target?.clampedY,
            repeats: cycle.unchangedRepeats,
            since: this.state.stuck?.since ?? Date.now()
          }
        : null
    this.state = {
      ...this.state,
      lastActions: lastTrace ? [lastTrace, ...this.state.lastActions].slice(0, 6) : this.state.lastActions,
      stuck
    }
    this.broadcast()

    const hitNote =
      lastHit && (lastHit.name || lastHit.role)
        ? ` | العنصر تحت المؤشر: [${lastHit.role}${lastHit.name ? ` «${lastHit.name.slice(0, 45)}»` : ''}]`
        : ''
    const changeNote = delta.changed ? '' : ' | بلا تغيير مرئي على الشاشة'
    const hint = cycle.hint ? `\n${cycle.hint}` : ''
    return {
      summary:
        `${summary}${hitNote}${changeNote} | المؤشر الآن: (${shot.cursorX}, ${shot.cursorY}) | ` +
        `النافذة النشطة: «${shot.activeTitle || 'سطح المكتب'}»${this.state.activeWindowProcess ? ` (${this.state.activeWindowProcess})` : ''}${hint}`,
      shot
    }
  }

  async listWindows(): Promise<Win32WindowInfo[]> {
    const res = await win32Worker.call<{ windows: Win32WindowInfo[] }>('windows')
    return Array.isArray(res.windows) ? res.windows : []
  }

  async focusWindow(query: string, maximize = false, minimizeStudioFirst = true): Promise<Win32FocusResult> {
    if (minimizeStudioFirst) this.minimizeStudio()
    const res = await win32Worker.call<{
      ok: boolean
      found: boolean
      focused: boolean
      activeTitle: string
      activeProc: string
    }>('focusWindow', { query, maximize })
    const result: Win32FocusResult = {
      ok: !!res.focused,
      found: !!res.found,
      focused: !!res.focused,
      activeTitle: String(res.activeTitle || ''),
      activeProc: String(res.activeProc || '')
    }
    this.state.activeWindowTitle = result.activeTitle
    this.state.activeWindowProcess = result.activeProc
    if (result.ok) {
      if (!windowMatchesQuery(this.state.activeWindowTitle, this.state.activeWindowProcess, query)) {
        this.broadcast()
        return {
          ok: false,
          found: true,
          focused: false,
          activeTitle: this.state.activeWindowTitle,
          activeProc: this.state.activeWindowProcess
        }
      }
    }
    this.broadcast()
    return result
  }

  async ensureWindowFocus(query: string, maximize = false, attempts = 3, gapMs = 450): Promise<Win32FocusResult> {
    let last: Win32FocusResult = { ok: false, found: false, focused: false, activeTitle: '', activeProc: '' }
    for (let i = 0; i < Math.max(1, attempts); i++) {
      last = await this.focusWindow(query, maximize, false)
      if (last.ok) return last
      await sleep(gapMs)
    }
    return last
  }

  appQueryHint(appName: string): string {
    return appQueryHint(appName)
  }

  async launchApplication(
    appNameOrPath: string,
    args: string[] = [],
    minimizeStudioFirst = true
  ): Promise<{ ok: boolean; message: string }> {
    return launchApplication(appNameOrPath, args, minimizeStudioFirst, () => this.minimizeStudio())
  }

  broadcast() {
    send('computer:state', this.state)
    if (this.state.studioMinimized || (this.state.status !== 'idle' && this.state.status !== 'done')) {
      floatingHud.pushState(this.state)
    }
  }

  shutdown() {
    this.stopTicker()
    this.releasePauseWaiters()
    floatingHud.destroy()
    win32Worker.destroy()
  }
}

export const desktopController = new DesktopController()
