import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react'
// عقد الجسر نفسه هو مصدر شكل المستطيل: الحقول x/y/width/height. وهي نفس
// حقول `PreviewRect` في العملية الرئيسية (`src/main/preview/bounds.ts`)،
// ومخطّط zod في `src/main/ipc/preview.ts` مربوط به، فلا تحتاج الواجهة نسخة ثانية.
import type { PreviewBounds } from '../../../shared/api'
import {
  MIN_PREVIEW_SIDE,
  NO_MODEL,
  filterNotices,
  formatTime,
  formatUsage,
  noticeCounts,
  shouldAutoScroll,
  stripAnsi,
  transcriptSignature,
  visibleTools,
  type Notice,
  type NoticeLevel,
  type ViewportName,
} from '../stores/reducer'
import { VIEWPORT_SIZES, phaseLabel, useWorkspace } from '../stores/workspace'
import { Transcript } from './Transcript'
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  IconButton,
  IconCamera,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconInfo,
  IconLaptop,
  IconMonitor,
  IconRotate,
  IconSend,
  IconSmartphone,
  IconStop,
  IconTablet,
  IconTerminal,
  KeyHint,
  StatusDot,
  Textarea,
  Toast,
  Tooltip,
  cx,
  type Tone,
} from './ui'

/**
 * مساحة العمل: ما يراه المستخدم أثناء بناء الوكيل لمشروعه.
 *
 * أربع قواعد تحكم هذا الملف:
 *
 * 1) مصدر الحقيقة هو أحداث العملية الرئيسية. لا نُخزّن نسخة ثانية من حالة
 *    الوكيل، وكل انتقال يمرّ عبر `dispatch` في reducer.ts. المنطق النقيّ كله
 *    هناك: `visibleTools` · `describeArgs` · `formatUsage` · `stripAnsi` ·
 *    `filterNotices` · `noticeCounts` · `shouldAutoScroll`.
 *
 * 2) نبدأ العمليات غير المتزامنة بجدار أمان. `run()` قد تفشل، والحدث الطرفي قد
 *    لا يصل أبدًا، والـ view الأصلي قد لا يظهر. في كل حالة: لا نُبقي الواجهة
 *    تدّعي أنها تعمل، ونترك path رجوع ظاهرًا للمستخدم.
 *
 * 3) **المعاينة عملية عرض منفصلة تُركّبها النواة فوق واجهة React كاملة.**
 *    لا يمكن لـ React أن يرسم فوق مستطيلها ولا أن يتلقّى نقراته. لذلك لا
 *    يوضع أي Dialog ولا Toast ولا Tooltip ولا قائمة Select داخله. انظر
 *    التعليق على حاوية المعاينة أدناه.
 *
 * 4) لا نضع في الملف قيمة لونية ولا حجمًا بلا رمز. كل لون من `components/ui`
 *    وكل مقياس من سلّم الطباعة أو المسافات؛ ما يحتاج هندسة قياس (ارتفاع
 *    المعاينة) فهو ثابت مقروء في أعلى الملف.
 */

/* --------------------------- أرقام لا تملك رمزًا --------------------------- */

/** أقصى عدد أسطر أدوات يُعرض قبل زرّ «و N أدوات أقدم». */
const TOOL_CAP = 6
/** أقصى أسطر سجلّ تُرسم في لوح السجل (الباقي في المخزن كما هو). */
const LOG_ROWS = 120
/** أقصى أسطر مشاكل كونسول تُرسم تحت المعاينة. */
const CONSOLE_ROWS = 6

/**
 * هندسة المعاينة: بكسل لا نسبة مئوية.
 *
 * `h-[46%] min-h-[220px]` كان كودًا ميتًا: الأب `height: auto` فنسبة بلا
 * مرجع تُحَلّ `auto`، فالمعاينة 220px عند كل مقاس نافذة. البكسل يجعل
 * الحدّ قابلًا للسحب، والتكبير حقيقيًا، والقياس في `boundsOf` مطابقًا تمامًا
 * لما يَرسمه CSS.
 *
 * لا يوجد رمز `min-h` لهذا في `theme.css`، وهو **ملاحظة تصميم** (§ gaps في
 * التقرير): هذه هندسة تخطيط لا مقياس نظام.
 */
const PREVIEW_MIN_PX = 180
const PREVIEW_MAX_RATIO = 0.72
/** أقصى ارتفاع للسجلّ المنسدل — نفس الملاحظة. */
const LOG_MIN_PX = 120
const LOG_MAX_PX = 420

/* --------------------------------- توقيت --------------------------------- */

/** أول فحص للوكيل بعد قبول run(). إن كان حيًا ننتظر، وإن كان ميتًا نُعلنها. */
const FIRST_PROBE_MS = 4_000
/** فترة إعادة الفحص أثناء صمت الوكيل. */
const ALIVE_PROBE_MS = 7_000
/** صمت طويل مع بقاء الوكيل حيًّا: ننبّه ولا نقتل — الحالة صادقة. */
const SILENCE_WARN_MS = 5 * 60_000
/** مهلة التقاط أخطاء الكونسول بعد فتح صفحة — الصفحة تحمّل قبل أن تتكلّم. */
const CONSOLE_AFTER_OPEN_MS = 1_200
/** دقّة عدّاد الزمن المنقضي. */
const CLOCK_TICK_MS = 1_000
/** أقصى حجم للّقطة المحفوظة — أكبر من ذلك نطلب من الوكيل التقاطها بنفسه. */
const MAX_SHOT_BYTES = 4 * 1024 * 1024
/** مدى الإشعار العابر على الشاشة. */
const TOAST_MS = 6_000

const LOST_MESSAGE =
  'توقّفت المهمة في العملية الرئيسية دون وصول حدث نهائي. افتح السجل للتفاصيل ثم أعد الطلب.'

/* ========================================================================== *
 *  أدوات صغيرة
 * ========================================================================== */

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '')
  return m.trim() || 'خطأ غير معروف'
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function boundsOf(el: HTMLElement): PreviewBounds {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

function sameBounds(a: PreviewBounds | null, b: PreviewBounds): boolean {
  if (!a) return false
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  )
}

/** `mm:ss` — المدة تُقرأ أسرع من الثواني وحدها بعد الدقيقة الأولى. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** زرّ Ctrl أم Cmd — المعالج يقبل `metaKey` والواجهة كانت تكتب Ctrl دائمًا. */
function modifierKey(): string {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'Cmd' : 'Ctrl'
}

/**
 * سحب حدّي: يحوّل موضع المؤشّر إلى ارتفاع.
 *
 * المؤشّر يُلتقط بـ`setPointerCapture` على المقبض نفسه، فلا يسرق التمريرُ
 * Insider ولا حاويةُ المحادثة الحدثَ أثناء السحب.
 */
function startVerticalDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  panel: HTMLElement | null,
  apply: (height: number) => void,
  min: number,
  max: () => number,
): void {
  const handle = event.currentTarget
  try {
    handle.setPointerCapture(event.pointerId)
  } catch {
    /* jsdom لا يعرف الالتقاط — السحب يعمل بـpreventDefault وحده */
  }

  const onMove = (move: PointerEvent): void => {
    if (panel === null) return
    const box = panel.getBoundingClientRect()
    apply(clamp(box.bottom - move.clientY, min, max()))
  }
  const onUp = (): void => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
  }

  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
  event.preventDefault()
}

/* ========================================================================== *
 *  خرائط العرض
 * ========================================================================== */

const VIEWPORTS: ReadonlyArray<{ id: ViewportName; label: string; icon: JSX.Element }> = [
  { id: 'full', label: 'ملء الشاشة', icon: <IconMonitor size={14} /> },
  { id: 'laptop', label: 'حاسوب محمول', icon: <IconLaptop size={14} /> },
  { id: 'tablet', label: 'لوحي', icon: <IconTablet size={14} /> },
  { id: 'mobile', label: 'جوال', icon: <IconSmartphone size={14} /> },
]

const LOG_FILTERS: ReadonlyArray<{ id: NoticeLevel | 'all'; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'error', label: 'أخطاء' },
  { id: 'warn', label: 'تحذيرات' },
  { id: 'info', label: 'معلومات' },
]

const LEVEL_TONE: Record<NoticeLevel, Tone> = { info: 'neutral', warn: 'warn', error: 'danger' }
const LEVEL_LABEL: Record<NoticeLevel, string> = { info: 'معلومة', warn: 'تحذير', error: 'خطأ' }

/** نبرة النقطة الحيّة. `neutral` للسكون — لا أخضر: الأخضر يقرأ «جاهز» حتى حين يت wedged. */
function statusTone(running: boolean, phase: string): Tone {
  if (phase === 'error') return 'danger'
  if (phase === 'done') return 'success'
  if (running) return 'accent'
  return 'neutral'
}

interface ToastState {
  id: number
  tone: Tone
  title: string
  body?: string
}

/* ========================================================================== *
 *  اللوح
 * ========================================================================== */

export default function ChatPanel(): JSX.Element {
  /* شرائح منفصلة لكل منطقة — لا اشتراك بالمخزن كاملًا. */
  const lines = useWorkspace((s) => s.lines)
  const streamingText = useWorkspace((s) => s.streamingText)
  const tools = useWorkspace((s) => s.tools)
  const plan = useWorkspace((s) => s.plan)
  const notices = useWorkspace((s) => s.notices)
  const running = useWorkspace((s) => s.running)
  const dispatching = useWorkspace((s) => s.dispatching)
  const stopping = useWorkspace((s) => s.stopping)
  const phase = useWorkspace((s) => s.phase)
  const phaseDetail = useWorkspace((s) => s.phaseDetail)
  const awaitingQuestion = useWorkspace((s) => s.awaitingQuestion)
  const lastError = useWorkspace((s) => s.lastError)
  const usage = useWorkspace((s) => s.usage)
  const previewUrl = useWorkspace((s) => s.previewUrl)
  const consoleIssues = useWorkspace((s) => s.consoleIssues)
  const viewport = useWorkspace((s) => s.viewport)
  const providerId = useWorkspace((s) => s.providerId)
  const modelId = useWorkspace((s) => s.modelId)
  const projectPath = useWorkspace((s) => s.projectPath)
  const projects = useWorkspace((s) => s.projects)
  const dispatch = useWorkspace((s) => s.dispatch)
  const pushUserLine = useWorkspace((s) => s.pushUserLine)
  const pushNotice = useWorkspace((s) => s.pushNotice)
  const setPreviewUrl = useWorkspace((s) => s.setPreviewUrl)
  const setConsoleIssues = useWorkspace((s) => s.setConsoleIssues)
  const setViewport = useWorkspace((s) => s.setViewport)

  const [draft, setDraft] = useState('')
  const [queued, setQueued] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [logLevel, setLogLevel] = useState<NoticeLevel | 'all'>('all')
  const [confirmStop, setConfirmStop] = useState(false)
  const [previewFault, setPreviewFault] = useState<string | null>(null)
  const [shot, setShot] = useState<{ url: string; at: number } | null>(null)
  const [allTools, setAllTools] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(true)
  const [toast, setToast] = useState<ToastState | null>(null)

  /** ارتفاعا اللوحين في بكسل — يقودهما السحب لا النِسَب الميتة. */
  const [previewPx, setPreviewPx] = useState(PREVIEW_MIN_PX)
  const [logPx, setLogPx] = useState(0)
  const [previewFolded, setPreviewFolded] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  /** آخر مرة وصلنا فيها حدث من main — أساس حارس الصمت. */
  const lastEventAt = useRef(0)
  const probedEventAt = useRef(0)
  const probeTimer = useRef(0)
  const toastTimer = useRef(0)
  const consoleTimer = useRef(0)
  const toastSeq = useRef(0)
  const mounted = useRef(true)
  /** هل المستخدم قريب من القاع؟ إن لا، لا نلمس التمرير. */
  const pinnedRef = useRef(true)
  const logPinnedRef = useRef(true)

  /** url بانتظار مستطيل صالح — أول إطار يقيس الحاوية بعد تركيبها. */
  const pendingOpenRef = useRef<string | null>(null)
  /** آخر url فُتح فعلًا — يمنع فتحًا مزدوجًا من المؤقّت وحلقة القياس معًا. */
  const openedRef = useRef<string | null>(null)
  /** مرآة لـ`openPreview` تصل لحلقة القياس المغلقة على `[]`. */
  const openRef = useRef<(url: string) => Promise<void>>(async () => undefined)
  /** العنصر الذي كان عليه التركيز عند بدء التشغيل — شرط استعادة التركيز. */
  const focusBeforeRunRef = useRef<HTMLElement | null>(null)
  const startedAtRef = useRef(0)
  /** هل لمس المستخدم مقبض المعاينة؟ إن لا، يتبع تغيّر ارتفاع النافذة. */
  const sizedRef = useRef(false)
  const [tick, setTick] = useState(() => Date.now())

  const active = useMemo(
    () => projects.find((p) => p.path === projectPath) ?? null,
    [projects, projectPath],
  )

  const hasModel = Boolean(providerId && modelId)
  const toolRows = useMemo(() => (allTools ? tools : visibleTools(tools, TOOL_CAP)), [tools, allTools])
  const hiddenTools = tools.length - toolRows.length
  const counts = useMemo(() => noticeCounts(notices), [notices])
  const logRows = useMemo<Notice[]>(
    () => filterNotices(notices, logLevel).slice(-LOG_ROWS),
    [notices, logLevel],
  )
  const infoCount = Math.max(0, counts.total - counts.errors - counts.warns)
  const currentTool = useMemo(
    () => [...tools].reverse().find((t) => t.status === 'running') ?? null,
    [tools],
  )
  const planDone = plan.filter((s) => s.status === 'done').length
  const elapsed = startedAtRef.current === 0 ? 0 : Math.max(0, tick - startedAtRef.current)

  const transcript = useMemo(
    () => transcriptSignature({ ...useWorkspace.getState() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, streamingText, tools, plan, phaseDetail, awaitingQuestion],
  )

  /* ----------------------------- الإشعارات ------------------------------- */

  const pushToast = useCallback((tone: Tone, title: string, body?: string): void => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, tone, title, body })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  /* --------------------------- حارس الصمت (defensive) --------------------- */

  const clearProbe = useCallback((): void => {
    if (probeTimer.current) {
      window.clearTimeout(probeTimer.current)
      probeTimer.current = 0
    }
  }, [])

  const scheduleProbe = useCallback(
    (delay: number): void => {
      clearProbe()
      probeTimer.current = window.setTimeout(() => {
        probeTimer.current = 0
        void probeRef.current()
      }, delay)
    },
    [clearProbe],
  )

  /**
   * إن لم يصل أي حدث بعد قبول run(): نسأل main عن الحقيقة عبر جسر موجود.
   * main يقول «يعمل» ⇒ ننتظر (والإيقاف متاح). main يقول «توقّف» ⇒ نُنهي
   * التشغيل صراحةً بدل إبقائه يدّعي أنه يعمل.
   */
  const probeRef = useRef<() => Promise<void>>(async () => undefined)
  probeRef.current = async (): Promise<void> => {
    if (!mounted.current) return
    const st = useWorkspace.getState()
    if (!st.running) return

    if (lastEventAt.current !== probedEventAt.current) {
      // لا يزال هناك نشاط — نكتفي بإعادة الجدولة.
      probedEventAt.current = lastEventAt.current
      scheduleProbe(ALIVE_PROBE_MS)
      return
    }

    let alive = true
    try {
      const status = await window.studio.agent.status()
      alive = status.running === true
    } catch {
      scheduleProbe(ALIVE_PROBE_MS)
      return
    }
    if (!mounted.current) return

    if (alive) {
      if (Date.now() - lastEventAt.current > SILENCE_WARN_MS) {
        dispatch({ type: 'log/note', level: 'warn', message: 'الوكيل صامت منذ دقائق — انتظرنا، وما زال يعمل حسب العملية الرئيسية.' })
        lastEventAt.current = Date.now()
      }
      scheduleProbe(ALIVE_PROBE_MS)
      return
    }

    dispatch({ type: 'run/lost', message: LOST_MESSAGE })
  }

  // التشغيل انتهى ⇒ لا داعي لفحصٍ إضافي.
  useEffect(() => {
    if (running) return
    clearProbe()
  }, [running, clearProbe])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearProbe()
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      if (consoleTimer.current) window.clearTimeout(consoleTimer.current)
    }
  }, [clearProbe])

  /* -------------------------------- الأحداث ------------------------------- */

  useEffect(
    () =>
      window.studio.agent.onEvent((event) => {
        lastEventAt.current = Date.now()
        probedEventAt.current = 0
        dispatch({ type: 'event', event })
      }),
    [dispatch],
  )

  // عنوان المعاينة الذي تبثّه main. لا نعتمد عليه وحده — انظر openPreview.
  useEffect(
    () =>
      window.studio.preview.onUrl((url) => {
        setPreviewUrl(url)
      }),
    [setPreviewUrl],
  )

  /* ------------------------------- التمرير -------------------------------- */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (pinnedRef.current) el.scrollTop = el.scrollHeight
    // `transcript` يشمل حالة الأدوات لا عددها، فـ`tool_end` يُحرّك التمرير.
  }, [transcript, shot])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      pinnedRef.current = shouldAutoScroll({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    if (logPinnedRef.current) el.scrollTop = el.scrollHeight
  }, [logRows, showLog, logLevel])

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    const onScroll = (): void => {
      logPinnedRef.current = shouldAutoScroll({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [showLog])

  /* ------------------------------- المعاينة ------------------------------- */

  /**
   * هندسة المستطيل: الـ view يُركّب فوق الصفحة، فيجب أن يتبع الموضع لا الحجم.
   * عند ظهور شريط الخطة تتحرّك الحاوية ولا يتغيّر حجمها — وهذا ما كان يجعل الـ
   * view يطفو فوق المحادثة. لذلك نقيس كل إطار ونرسل عند أي فرق.
   */
  useEffect(() => {
    const el = previewRef.current
    if (!el) return undefined

    let frame = 0
    let alive = true
    let last: PreviewBounds | null = null
    let lastGood: PreviewBounds | null = null

    const send = (b: PreviewBounds): void => {
      void window.studio.preview.resize(b).catch(() => undefined)
    }

    const measure = (): void => {
      if (!alive || !mounted.current) return
      const next = boundsOf(el)
      if (sameBounds(last, next)) return
      last = next

      if (next.width < MIN_PREVIEW_SIDE || next.height < MIN_PREVIEW_SIDE) {
        // مستطيل مُشوَّه (طيّ السجل، تصغير النافذة). لا نرسله — نبقي آخر
        // مستطيل صحيح بدل أن يطير الـ view فوق المحادثة.
        if (lastGood) send(lastGood)
        else void window.studio.preview.close().catch(() => undefined)
        openedRef.current = null
        pendingOpenRef.current = useWorkspace.getState().previewUrl
        return
      }
      lastGood = next
      send(next)

      // إن كان هناك url ينتظر مستطيلًا صالحًا (أول إطار بعد التركيب، أو بعد
      // توسيع اللوح من طيّ) — نفتحه الآن، لا في إطارٍ لاحق بلا سبب.
      const pending = pendingOpenRef.current
      if (pending !== null && pending !== '') void openRef.current(pending)
    }

    const loop = (): void => {
      if (!alive) return
      measure()
      frame = window.requestAnimationFrame(loop)
    }
    loop()

    const onResize = (): void => measure()
    window.addEventListener('resize', onResize)

    return () => {
      alive = false
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  /**
   * فتح المعاينة: نربط الـ view أولًا (main ينشئه) ثم نفتح العنوان (main يحمّله).
   * الترتيب معكوس يُنتج view فارغًا، لأن open بلا view يسجّل العنوان فقط.
   *
   * إن لم يكن للحاوية مستطيل صالح بعد (أول إطار، أو اللوح مطويّ) لا نُسقط
   * الطلب: نحفظه ونترك حلقة القياس تفتحه أوّل إطار يُصبح فيه المرشّح سليما.
   */
  const openPreview = useCallback(
    async (url: string): Promise<void> => {
      const el = previewRef.current
      if (!el) {
        pendingOpenRef.current = url
        return
      }
      const bounds = boundsOf(el)
      if (bounds.width < MIN_PREVIEW_SIDE || bounds.height < MIN_PREVIEW_SIDE) {
        pendingOpenRef.current = url
        return
      }
      if (openedRef.current === url) return

      pendingOpenRef.current = null
      openedRef.current = url
      setPreviewFault(null)
      try {
        await window.studio.preview.attach(bounds)
      } catch (e) {
        openedRef.current = null
        setPreviewFault(`تعذّر ربط المعاينة: ${errText(e)}`)
        return
      }
      try {
        const res = await window.studio.preview.open(url)
        if (!res.ok) {
          openedRef.current = null
          setPreviewFault('رفضت المعاينة هذا العنوان.')
          return
        }
        // نقرأ أخطاء الكونسول بعد أن تُحمَّل الصفحة: أوّل فحص بعد فتحها يمرّ
        // على الصفحة الفارغة. المؤقّت يُلغى عند التفكيك — تسريب مؤقّت
        // يعني IPC بعد إزالة اللوحة، ونتيجة تعود إلى مخزن لا وجود له.
        if (consoleTimer.current) window.clearTimeout(consoleTimer.current)
        consoleTimer.current = window.setTimeout(() => {
          consoleTimer.current = 0
          void window.studio.preview
            .consoleErrors()
            .then((issues) => {
              if (mounted.current) setConsoleIssues(issues)
            })
            .catch(() => undefined)
        }, CONSOLE_AFTER_OPEN_MS)
      } catch (e) {
        openedRef.current = null
        setPreviewFault(`تعذّر فتح المعاينة: ${errText(e)}`)
      }
    },
    [setConsoleIssues],
  )
  openRef.current = openPreview

  useEffect(() => {
    if (!previewUrl) {
      pendingOpenRef.current = null
      openedRef.current = null
      return
    }
    void openPreview(previewUrl)
  }, [previewUrl, openPreview])

  // عند التركيب: هل هناك معاينة قائمة؟ وهل يعمل وكيل لم نره؟
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const st = await window.studio.preview.status()
        if (alive && st.url && !useWorkspace.getState().previewUrl) setPreviewUrl(st.url)
      } catch {
        /* main لا يعرف المعاينة — لا داعي لإزعاج المستخدم */
      }
      try {
        const st = await window.studio.agent.status()
        if (alive && st.running) dispatch({ type: 'run/resumed' })
      } catch {
        /* تجاهُل */
      }
    })()
    return () => {
      alive = false
    }
  }, [dispatch, setPreviewUrl])

  // المعاينة يجب أن لا تبقى بعد إزالة اللوحة، وإلا غطّت الشاشة التالية.
  useEffect(
    () => () => {
      void window.studio.preview.close().catch(() => undefined)
      useWorkspace.getState().setPreviewUrl(null)
    },
    [],
  )

  /** ارتفاع المعاينة الافتراضي — نسبة من اللوح الحقيقي، مقصوصة بسقفٍ يحفظ للترويسة. */
  const defaultPreviewPx = useCallback((): number => {
    const el = panelRef.current
    if (!el) return PREVIEW_MIN_PX
    const box = el.getBoundingClientRect().height
    if (!Number.isFinite(box) || box <= 0) return PREVIEW_MIN_PX
    return clamp(Math.round(box * 0.38), PREVIEW_MIN_PX, Math.round(box * PREVIEW_MAX_RATIO))
  }, [])

  const maxPreviewPx = useCallback((): number => {
    const el = panelRef.current
    const box = el?.getBoundingClientRect().height ?? 0
    return Math.max(PREVIEW_MIN_PX, Math.round((Number.isFinite(box) ? box : 0) * PREVIEW_MAX_RATIO))
  }, [])

  /**
   * القياس الأوّل يضبط الارتفاع قبل أول إطار مرسوم.
   *
   * `useLayoutEffect` لا `useEffect` هنا لسبب محدّد: لو بدأ بـ`useEffect` تكون
   * الحاوية قد رُسمت بارتفاع `PREVIEW_MIN_PX` مؤقتًا، فيقيسها حلقةُ المعاينة
   * ويبني الـ native على ذلك الرقم — ثم يقفز الـ view بعد إطارين. الضبط قبل
   * الرسم يجعل أوّل مستطيل مرسوم هو الصحيح.
   */
  useLayoutEffect(() => {
    const next = defaultPreviewPx()
    setPreviewPx(next)
    setLogPx(clamp(Math.round(next * 0.7), LOG_MIN_PX, LOG_MAX_PX))
    const onResize = (): void => {
      if (sizedRef.current) return
      setPreviewPx(defaultPreviewPx())
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [defaultPreviewPx])

  const onPreviewDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    sizedRef.current = true
    setPreviewFolded(false)
    startVerticalDrag(event, panelRef.current, setPreviewPx, PREVIEW_MIN_PX, maxPreviewPx)
  }

  const togglePreview = (): void => {
    if (previewFolded) {
      setPreviewFolded(false)
      sizedRef.current = false
      setPreviewPx(defaultPreviewPx())
      return
    }
    setPreviewFolded(true)
    sizedRef.current = true
    setPreviewPx(0)
  }

  /* ------------------------------- التشغيل -------------------------------- */

  const startRun = useCallback(
    async (text: string): Promise<void> => {
      if (!providerId || !modelId) {
        dispatch({ type: 'log/note', level: 'error', message: NO_MODEL })
        pushToast('warn', 'لا يوجد نموذج', NO_MODEL)
        return
      }

      pushUserLine(text)
      setDraft('')
      setShot(null)
      setPreviewFault(null)
      setConfirmStop(false)
      lastEventAt.current = 0
      probedEventAt.current = 0
      focusBeforeRunRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      startedAtRef.current = Date.now()
      dispatch({ type: 'run/started' })

      try {
        const res = await window.studio.agent.run({
          prompt: text,
          providerId,
          modelId,
          projectPath,
        })
        if (!res.ok) {
          // الرسالة قد تكون بالإنجليزية من main — نعرضها كما هي داخل سجل عربي.
          dispatch({ type: 'run/rejected', message: res.message || 'تعذّر بدء المهمة.' })
          setDraft(text)
          return
        }
        // قُبل الطلب. إن لم يصل أي حدث خلال نافذة قصيرة، نسأل main عن الحقيقة.
        scheduleProbe(FIRST_PROBE_MS)
      } catch (e) {
        dispatch({ type: 'run/rejected', message: errText(e) })
        setDraft(text)
      }
    },
    [dispatch, projectPath, modelId, providerId, pushToast, pushUserLine, scheduleProbe],
  )

  const onSend = (): void => {
    const text = draft.trim()
    if (text === '' || running || dispatching) return
    void startRun(text)
  }

  /**
   * أثناء العمل لا يُعطَّل المُدخل: مسودّة الطلب التالي تُكتب، والإرسال ينتظر.
   * الواجهة كانت تعد المستخدم بأن «سنرسله بعد انتهاء المهمة» ولم تفعل — فصار
   * الانتظار فعلًا مرئيًا (رقمية) وقابلًا للإلغاء.
   */
  const onQueue = (): void => {
    const text = draft.trim()
    if (text === '') return
    setQueued(text)
    setDraft('')
  }

  const doStop = async (): Promise<void> => {
    setConfirmStop(false)
    dispatch({ type: 'run/stopping' })
    try {
      await window.studio.agent.stop()
    } catch (e) {
      pushNotice('error', `تعذّر الإيقاف: ${errText(e)}`)
    }
    dispatch({ type: 'run/stopped' })
  }

  // انتهاء ⇒ نرسل ما كان في الانتظار، ونعيد التركيز إلى المُدخل.
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && running === false) {
      const pending = queued
      if (pending !== null && pending.trim() !== '') {
        setQueued(null)
        void startRun(pending)
      }
      const before = focusBeforeRunRef.current
      const active_ = document.activeElement
      if (before === null || active_ === null || active_ === before || active_ === document.body) {
        composerRef.current?.focus()
      }
      startedAtRef.current = 0
    }
    if (running) setTick(Date.now())
    wasRunning.current = running
  }, [running, queued, startRun])

  // العدّاد المنقضي — ثانية واحدة تكفي، ولا شيء يعمل بلاها.
  useEffect(() => {
    if (!running) return undefined
    const id = window.setInterval(() => setTick(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(id)
  }, [running])

  // السؤال يصل بعد حدث طرفي، فالتركيز يعود إلى المُدخل لإجابة سريعة.
  useEffect(() => {
    if (awaitingQuestion === null) return
    composerRef.current?.focus()
  }, [awaitingQuestion])

  /* ----------------------------- المعاينة: أدوات ------------------------ */

  const refreshConsole = useCallback(async (): Promise<void> => {
    try {
      setConsoleIssues(await window.studio.preview.consoleErrors())
    } catch {
      /* الجسر لا يعرف المعاينة بعد */
    }
  }, [setConsoleIssues])

  const openExternal = async (): Promise<void> => {
    if (!previewUrl) return
    try {
      await window.studio.preview.openExternal(previewUrl)
    } catch (e) {
      pushNotice('error', `تعذّر الفتح في المتصفح: ${errText(e)}`)
      pushToast('danger', 'تعذّر الفتح في المتصفح', errText(e))
    }
  }

  const reload = async (): Promise<void> => {
    try {
      await window.studio.preview.reload()
      await refreshConsole()
    } catch (e) {
      pushNotice('error', `تعذّر التحديث: ${errText(e)}`)
      pushToast('danger', 'تعذّر تحديث المعاينة', errText(e))
    }
  }

  /**
   * اللقطة: PNG بحجم ميغابايت. **لا تُخزَّن في المخزن** (كان تسريب ذاكرة بلا
   * فائدة)، بل تُحفظ محليًا وتُرسم داخل عمود المحادثة — وهو خارج مستطيل الـ
   * view، فلا يبتلعها الـ native ولا يبتلعها هو.
   */
  const refreshShot = async (): Promise<void> => {
    try {
      const res = await window.studio.preview.screenshot()
      if (!res.ok || !res.dataUrl) {
        pushNotice('warn', res.error ? `تعذّرت اللقطة: ${res.error}` : 'تعذّرت اللقطة.')
        pushToast('warn', 'تعذّرت اللقطة', res.error)
        return
      }
      if (res.dataUrl.length > MAX_SHOT_BYTES) {
        setShot(null)
        pushNotice('warn', 'اللقطة ضخمة جدًا للعرض — اطلب من الوكيل استخدام take_screenshot بدلها.')
        pushToast('warn', 'اللقطة ضخمة للعرض', 'اطلب من الوكيل التقاطها عبر take_screenshot بدل زرّ اللقطات.')
        return
      }
      setShot({ url: res.dataUrl, at: Date.now() })
    } catch (e) {
      pushNotice('error', `تعذّرت اللقطة: ${errText(e)}`)
      pushToast('danger', 'تعذّرت اللقطة', errText(e))
    }
  }

  const changeViewport = (v: ViewportName): void => {
    setViewport(v)
    void window.studio.preview
      .setViewport(VIEWPORT_SIZES[v])
      .then(() => refreshConsole())
      .catch(() => undefined)
  }

  /* --------------------------------- العرض -------------------------------- */

  const canSend = draft.trim().length > 0 && !running && !dispatching && !stopping && hasModel
  const canQueue = draft.trim().length > 0 && (running || dispatching)
  const dotTone = statusTone(running, phase)
  const mod = modifierKey()
  const consoleTail = consoleIssues.slice(-CONSOLE_ROWS)

  return (
    <div ref={panelRef} className="flex h-full min-w-0 flex-col bg-surface-1">
      {/* ============================ الترويسة ============================ */}
      <header className="z-header shrink-0 border-b border-line bg-surface-1">
        <div className="flex min-h-control-lg flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
          <StatusDot tone={dotTone} label={phaseLabel(phase)} pulse={running} size="sm" />

          {phaseDetail === '' ? null : (
            // التفصيل يُقصّ، فلن يُعرف طوله. `Tooltip` يُظهر النصّ كاملًا عند
            // المرور أو التركيز، و`side="bottom"` لأن `top` كان يخرج فوق حافة
            // النافذة: الترويسة في أعلى اللوح.
            <Tooltip content={phaseDetail} side="bottom">
              <span dir="auto" className="min-w-0 max-w-96 truncate font-mono text-xs text-text-muted">
                {phaseDetail}
              </span>
            </Tooltip>
          )}

          <span className="flex-1" />

          {usage === null ? null : (
            <Badge tone="neutral" size="sm" num>
              {formatUsage(usage)}
            </Badge>
          )}

          {confirmStop ? (
            <>
              <span className="text-xs text-danger">الإيقاف يقتل خادم التطوير المرتبط</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmStop(false)}>
                تراجع
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={stopping}
                loadingLabel="جارٍ الإيقاف"
                onClick={() => void doStop()}
              >
                أكّد الإيقاف
              </Button>
            </>
          ) : running ? (
            <Button
              variant="dangerSoft"
              size="sm"
              leading={<IconStop size={14} />}
              disabled={stopping}
              onClick={() => setConfirmStop(true)}
            >
              إيقاف
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            leading={<IconTerminal size={14} />}
            trailing={
              counts.errors + counts.warns > 0 ? (
                <Badge tone="warn" size="sm" num>
                  {counts.errors + counts.warns}
                </Badge>
              ) : null
            }
            aria-expanded={showLog}
            onClick={() => setShowLog((v) => !v)}
          >
            السجل
          </Button>
        </div>

        {/* صفّ القياس — كان غائبًا: نقطة + كلمة + نصّ مقصوص بلا رقم واحد. */}
        {running || plan.length > 0 || tools.length > 0 || usage !== null ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 text-xs text-text-muted">
            {running ? (
              <>
                <span className="num font-mono">{formatElapsed(elapsed)}</span>
                <span aria-hidden="true">·</span>
                <span className="num">{tools.length} خطوة</span>
                {currentTool === null ? null : (
                  <>
                    <span aria-hidden="true">·</span>
                    <span dir="auto" className="truncate font-mono">
                      {currentTool.name}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="num">{tools.length} خطوة في آخر مهمة</span>
            )}
            {plan.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="num">
                  الخطة {planDone}/{plan.length}
                </span>
              </>
            ) : null}
            <span className="flex-1" />
            {modelId === null ? null : <span dir="auto" className="truncate font-mono">{modelId}</span>}
          </div>
        ) : null}
      </header>

      {/* ============================== الخطة ============================== */}
      {plan.length === 0 ? null : (
        <section
          aria-label="خطة الوكيل"
          className="shrink-0 border-b border-line bg-surface-2"
        >
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="text-xs font-medium text-text-secondary">الخطة</span>
            <Badge tone="neutral" size="sm" num>
              {`${planDone}/${plan.length}`}
            </Badge>
            <span className="flex-1" />
            <IconButton
              size="sm"
              icon={planOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
              label={planOpen ? 'أخفِ الخطة' : 'اعرض الخطة'}
              aria-expanded={planOpen}
              onClick={() => setPlanOpen((v) => !v)}
            />
          </div>
          {planOpen ? (
            <ol className="grid gap-1 px-3 pb-2">
              {plan.map((step) => (
                <li key={`${step.index}-${step.title}`} className="flex items-start gap-2 text-xs">
                  <span aria-hidden="true" className="mt-1.5 shrink-0">
                    {step.status === 'done' ? (
                      <span className="grid size-3.5 place-items-center rounded-full bg-success-bg text-success">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                    ) : step.status === 'failed' ? (
                      <span className="grid size-3.5 place-items-center rounded-full bg-danger-bg text-danger">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </span>
                    ) : step.status === 'active' ? (
                      <span className="block size-3.5 shrink-0 rounded-full border-2 border-accent bg-accent/20" />
                    ) : (
                      <span className="block size-3.5 shrink-0 rounded-full border border-line-strong" />
                    )}
                  </span>
                  <span
                    className={cx(
                      'min-w-0',
                      step.status === 'done'
                        ? 'text-text-muted line-through'
                        : step.status === 'active'
                          ? 'font-medium text-text-primary'
                          : step.status === 'failed'
                            ? 'text-danger'
                            : 'text-text-tertiary',
                    )}
                  >
                    {step.title}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      )}

      {/* ============================ المحادثة ============================ */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto px-3 py-3"
        role="log"
        aria-label="المحادثة"
      >
        <Transcript
          lines={lines}
          tools={toolRows}
          hiddenTools={hiddenTools}
          expandedTools={allTools}
          onToggleTools={() => setAllTools((v) => !v)}
          streamingText={streamingText}
          streaming={running && streamingText !== ''}
          lastError={lastError}
          onOpenLog={() => setShowLog(true)}
          question={awaitingQuestion}
          onPickOption={(text) => {
            setDraft(text)
            composerRef.current?.focus()
          }}
          shot={shot}
          onDismissShot={() => setShot(null)}
        />
      </div>

      {/* ============================ المعاينة ============================ */}
      <section aria-label="المعاينة" className="flex shrink-0 flex-col border-t border-line">
        {/*
          مقبض الحجم. لوحُ Transcript فوقه، والمعاينة تحته — فالسحب يرفع
          حدود الـ native ويقرّبها من المحادثة.
        */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="غيّر ارتفاع المعاينة"
          aria-valuenow={previewPx}
          aria-valuemin={PREVIEW_MIN_PX}
          aria-valuemax={maxPreviewPx()}
          tabIndex={0}
          onPointerDown={onPreviewDrag}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              sizedRef.current = true
              const delta = event.key === 'ArrowUp' ? -24 : 24
              setPreviewPx((v) => clamp(v + delta, PREVIEW_MIN_PX, maxPreviewPx()))
            }
          }}
          className="group h-2 shrink-0 cursor-row-resize bg-surface-1 transition-ui hover:bg-surface-2 focus-visible:[--ring-focus-color:var(--color-accent)]"
        >
          <span aria-hidden="true" className="mx-auto mt-1 block h-0.5 w-10 rounded-full bg-line-strong group-hover:bg-accent" />
        </div>

        <div className="flex min-h-control-sm shrink-0 flex-wrap items-center gap-1 px-2">
          <IconButton
            size="sm"
            icon={previewFolded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            label={previewFolded ? 'اعرض المعاينة' : 'اطوِ المعاينة'}
            aria-expanded={!previewFolded}
            onClick={togglePreview}
          />
          <span className="text-xs font-medium text-text-secondary">المعاينة</span>
          {previewUrl === null ? null : (
            <Badge tone="success" size="sm">
              تعمل
            </Badge>
          )}
          {consoleIssues.length > 0 ? (
            <Badge tone="danger" size="sm" num>
              {`${consoleIssues.length} خطأ كونسول`}
            </Badge>
          ) : null}
          {previewFault === null ? null : (
            <Badge tone="danger" size="sm" title={previewFault}>
              المعاينة متوقفة
            </Badge>
          )}

          <span className="flex-1" />

          {VIEWPORTS.map((v) => (
            <Tooltip key={v.id} content={v.label}>
              <IconButton
                size="sm"
                icon={v.icon}
                label={v.label}
                active={viewport === v.id}
                disabled={previewUrl === null}
                onClick={() => changeViewport(v.id)}
              />
            </Tooltip>
          ))}

          <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />

          <Tooltip content="حدّث الصفحة المعروضة">
            <IconButton
              size="sm"
              icon={<IconRotate size={14} />}
              label="حدّث الصفحة المعروضة"
              disabled={previewUrl === null}
              onClick={() => void reload()}
            />
          </Tooltip>
          <Tooltip content="التقط لقطة للشاشة الحالية">
            <IconButton
              size="sm"
              icon={<IconCamera size={14} />}
              label="التقط لقطة للشاشة الحالية"
              disabled={previewUrl === null}
              onClick={() => void refreshShot()}
            />
          </Tooltip>
          <Tooltip content="افتحها في المتصفح الافتراضي">
            <IconButton
              size="sm"
              icon={<IconExternalLink size={14} />}
              label="افتحها في المتصفح الافتراضي"
              disabled={previewUrl === null}
              onClick={() => void openExternal()}
            />
          </Tooltip>
        </div>

        {/*
          ⚠️ قاعدة صارمة، لا تعليق تزييني:
          الـ `WebContentsView` عملية عرض منفصلة تركّبها النواة **فوق** واجهة
          React كاملة. لا يستطيع React أن يرسم داخل هذا المستطيل ولا فوقه، ولا
          يستقبل أي نقرة عليه. لذلك:
            1) هذا العنصر **فارغ تمامًا** — لا حالة فارغة، لا شعار، لا نص.
               الحالة الفارغة تُرسم في كتلة أخرى خارجه، وإلا اختفت أوّل ما
               تُحمَّل صفحة — وهو أوّل ما تحتاجه.
            2) لا `Dialog` ولا `Toast` ولا `Tooltip` ولا قائمة `Select` فوقه
               إطلاقًا. كل لوح متداخل في هذا الملف يُرسَم داخل عمود المحادثة
               أو مثبّتًا أعلى النافذة.
            3) أي تغيير في موضعه أو حجمه (ظهور الخطة، فتح السجل، السحب)
               لا يُلتقط إلا بحلقة القياس أدناه.
        */}
        <div
          ref={previewRef}
          style={previewFolded ? { height: 0 } : { height: previewPx }}
          className="w-full shrink-0 overflow-hidden bg-inset"
        />

        {/* خارج المستطيل: كل ما يُقال عن المعاينة يُرسم هنا. */}
        {previewFolded ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
            {previewFault !== null ? (
              <span className="text-danger">{previewFault}</span>
            ) : previewUrl === null ? (
              <span className="text-text-muted">
                {active === null ? 'لا يوجد مشروع مفتوح' : 'لم يبدأ الخادم بعد — اطلب البناء وسيظهر هنا'}
              </span>
            ) : (
              <span dir="ltr" className="truncate font-mono text-text-muted">
                {previewUrl}
              </span>
            )}
          </div>
        )}

        {consoleTail.length === 0 ? null : (
          <div className="max-h-24 shrink-0 overflow-auto border-b border-line bg-surface-2 px-3 py-1.5">
            <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
              <span>أخطاء الكونسول</span>
              <span className="num">{consoleIssues.length}</span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => void refreshConsole()}>
                أعِد الفحص
              </Button>
            </div>
            {consoleTail.map((issue) => (
              <p
                key={issue.id}
                dir="auto"
                className="truncate font-mono text-xs text-danger"
              >
                {stripAnsi(issue.text)}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* ============================= السجلّ ============================= */}
      {showLog ? (
        <section aria-label="سجل التنفيذ" className="flex shrink-0 flex-col border-t border-line bg-inset">
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="غيّر ارتفاع السجل"
            aria-valuenow={logPx}
            aria-valuemin={LOG_MIN_PX}
            aria-valuemax={LOG_MAX_PX}
            tabIndex={0}
            onPointerDown={(event) =>
              startVerticalDrag(event, panelRef.current, setLogPx, LOG_MIN_PX, () => LOG_MAX_PX)
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                const delta = event.key === 'ArrowUp' ? -24 : 24
                setLogPx((v) => clamp(v + delta, LOG_MIN_PX, LOG_MAX_PX))
              }
            }}
            className="h-2 shrink-0 cursor-row-resize bg-surface-1 transition-ui hover:bg-surface-2"
          >
            <span aria-hidden="true" className="mx-auto mt-1 block h-0.5 w-10 rounded-full bg-line-strong" />
          </div>

          <div className="flex min-h-control-sm shrink-0 flex-wrap items-center gap-1.5 px-2">
            <span className="text-xs font-medium text-text-secondary">سجل التنفيذ</span>
            <Badge tone="neutral" size="sm" num>
              {counts.total}
            </Badge>

            <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />

            {LOG_FILTERS.map((filter) => {
              const count =
                filter.id === 'all'
                  ? counts.total
                  : filter.id === 'error'
                    ? counts.errors
                    : filter.id === 'warn'
                      ? counts.warns
                      : infoCount
              const on = logLevel === filter.id
              return (
                <Button
                  key={filter.id}
                  variant={on ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={on}
                  onClick={() => setLogLevel(filter.id)}
                  trailing={<Badge tone={on ? 'accent' : 'neutral'} size="sm" num>{count}</Badge>}
                >
                  {filter.label}
                </Button>
              )
            })}

            <span className="flex-1" />

            <Button variant="ghost" size="sm" disabled={counts.total === 0} onClick={() => dispatch({ type: 'log/cleared' })}>
              امسح السجل
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowLog(false)}>
              إغلاق
            </Button>
          </div>

          <div
            ref={logRef}
            style={{ height: logPx }}
            className="min-h-0 shrink-0 overflow-auto px-3 py-1.5 select-text"
          >
            {logRows.length === 0 ? (
              <EmptyState
                variant="plain"
                size="sm"
                title={counts.total === 0 ? 'لا يوجد سجل بعد' : 'لا سطر في هذه الفئة'}
                description={
                  counts.total === 0
                    ? 'مخرجات الأوامر ورسائل الوكيل تظهر هنا فور وصولها.'
                    : 'بدّل المرشّح لترى بقية المستويات.'
                }
              />
            ) : (
              <ul className="grid gap-0.5">
                {logRows.map((notice) => (
                  <li key={notice.id} className="flex items-start gap-2 font-mono text-xs leading-relaxed">
                    <time
                      dateTime={new Date(notice.at).toISOString()}
                      className="num shrink-0 text-text-muted"
                    >
                      {formatTime(notice.at)}
                    </time>
                    <Badge tone={LEVEL_TONE[notice.level]} size="sm" className="shrink-0">
                      {LEVEL_LABEL[notice.level]}
                    </Badge>
                    <span
                      dir="auto"
                      className={cx(
                        'min-w-0 flex-1 whitespace-pre-wrap break-all',
                        notice.level === 'error'
                          ? 'text-danger'
                          : notice.level === 'warn'
                            ? 'text-warn'
                            : 'text-text-tertiary',
                      )}
                    >
                      {stripAnsi(notice.message)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {/* ============================= المُدخل ============================ */}
      <div className="shrink-0 border-t border-line p-3">
        {hasModel ? null : (
          <div
            role="status"
            className={cx(
              'mb-2 grid gap-1 rounded-lg border px-3 py-2 text-xs leading-relaxed',
              'border-warn-border bg-warn-bg text-warn',
            )}
          >
            <p className="flex items-start gap-2">
              <IconInfo size={14} className="mt-0.5 shrink-0" />
              {NO_MODEL}
            </p>
          </div>
        )}

        {shortcutsOpen ? (
          <dl className="mb-2 grid gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-text-secondary">
            <div className="flex items-center gap-2">
              <dt className="flex-1">إرسال الطلب</dt>
              <dd>
                <KeyHint keys={[mod, 'Enter']} />
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="flex-1">سطر جديد داخل الطلب</dt>
              <dd>
                <KeyHint keys={['Enter']} />
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="flex-1">فتح أو طيّ السجل</dt>
              <dd>
                <KeyHint keys={['السجل']} />
              </dd>
            </div>
          </dl>
        ) : null}

        <Textarea
          ref={composerRef}
          rows={3}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (canSend) onSend()
              else if (canQueue) onQueue()
            }
          }}
          placeholder={awaitingQuestion === null ? 'اكتب ما تريد بناءه…' : 'اكتب ردّك على سؤال الوكيل…'}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {running ? (
            <Button
              variant="primary"
              size="md"
              disabled={!canQueue}
              leading={<IconSend size={14} />}
              onClick={onQueue}
            >
              أرسل بعد الانتهاء
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              disabled={!canSend}
              loading={dispatching}
              loadingLabel="جارٍ الإرسال"
              leading={<IconSend size={14} />}
              onClick={onSend}
            >
              إرسال
            </Button>
          )}

          {queued === null ? null : (
            <Chip
              tone="accent"
              removable
              removeLabel="ألغِ الطلب المنتظر"
              onRemove={() => setQueued(null)}
              dir="auto"
            >
              {`في الانتظار: ${queued}`}
            </Chip>
          )}

          <span className="flex-1" />

          <KeyHint keys={[mod, 'Enter']} />
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={shortcutsOpen}
            onClick={() => setShortcutsOpen((v) => !v)}
          >
            اختصارات
          </Button>
        </div>

        {running ? (
          <p className="mt-1.5 text-xs text-text-muted">
            يمكنك كتابة الطلب التالي الآن — سنرسله فور انتهاء المهمة الحالية.
          </p>
        ) : null}
      </div>

      {/*
        ⚠️ الإشعارات مثبّتة أعلى النافذة لا أسفلها.
        `ToastRegion` في `components/ui` مثبّتة `bottom-4 end-4`، أي فوق مستطيل
        المعاينة بالضبط — فكانت ستختفي خلف الـ native. لذلك نلفّ `Toast` في
        حيّز خاص بنا. (**ملاحظة لنظام التصميم**: `ToastRegion` غير قابلة
        للاستعمال داخل هذه الشاشة.)
      */}
      <div className="pointer-events-none fixed top-3 end-3 z-toast flex w-80 flex-col gap-2">
        {toast === null ? null : (
          <Toast
            key={toast.id}
            tone={toast.tone}
            title={toast.title}
            duration={TOAST_MS}
            onDismiss={() => setToast(null)}
          >
            {toast.body}
          </Toast>
        )}
      </div>
    </div>
  )
}