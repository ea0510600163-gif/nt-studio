import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  transcriptSignature,
  visibleTools,
  type NoticeLevel,
  type ViewportName,
} from '../stores/reducer'
import { VIEWPORT_SIZES, phaseLabel, useWorkspace } from '../stores/workspace'

/**
 * مساحة العمل: ما يراه المستخدم أثناء بناء الوكيل لمشروعه.
 *
 * ثلاث قواعد تحكم هذا الملف:
 *
 * 1) مصدر الحقيقة هو أحداث العملية الرئيسية. لا نُخزّن نسخة ثانية من حالة
 *    الوكيل، وكل انتقال يمرّ عبر `dispatch` في reducer.ts.
 *
 * 2) نبدأ العمليات غير المتزامنة بجدار أمان. `run()` قد تفشل، والحدث الطرفي قد
 *    لا يصل أبدًا، والـ view الأصلي قد لا يظهر. في كل حالة: لا نُبقي الواجهة
 *    تدّعي أنها تعمل، ونترك path رجوع ظاهرًا للمستخدم.
 *
 * 3) المعاينة عملية عرض منفصلة فوق هذه الصفحة، فلا يظهر شيء نرسمه فوق مستطيلها.
 *    لذلك كل لوح متداخل (سؤال، خطأ، تنبيه) خارج نطاقها لا فوقها.
 */

const FIELD =
  'w-full bg-inset border border-line rounded-lg px-3 py-2.5 text-[13px] text-main placeholder:text-faint outline-none focus:border-accent resize-none transition-colors'

/** theme.css يمنع التحديد على body؛ نعيده داخل Markup الخاص بنا. */
const PICKABLE = 'select-text'

const VIEWPORTS: Array<{ id: ViewportName; label: string; glyph: string }> = [
  { id: 'full', label: 'ملء الشاشة', glyph: '⛶' },
  { id: 'laptop', label: 'حاسوب محمول', glyph: '▭' },
  { id: 'tablet', label: 'لوحي', glyph: '▯' },
  { id: 'mobile', label: 'جوال', glyph: '▮' },
]

const LOG_LEVELS: Array<{ id: NoticeLevel | 'all'; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'error', label: 'أخطاء' },
  { id: 'warn', label: 'تحذيرات' },
]

/** أول فحص للوكيل بعد قبول run(). إن كان حيًا ننتظر، وإن كان ميتًا نُعلنها. */
const FIRST_PROBE_MS = 4_000
/** فترة إعادة الفحص أثناء صمت الوكيل. */
const ALIVE_PROBE_MS = 7_000
/** صمت طويل مع بقاء الوكيل حيًّا: ننبّه ولا نقتل — الحالة صادقة. */
const SILENCE_WARN_MS = 5 * 60_000
/** مهلة زر تأكيد الإيقاف قبلعودته إلى حالته الأصلية. */
const CONFIRM_STOP_MS = 4_000
/** أقصى حجم للّقطة المحفوظة — أكبر من ذلك نطلب من الوكيل التقاطها بنفسه. */
const MAX_SHOT_BYTES = 4 * 1024 * 1024

const LOST_MESSAGE =
  'توقّفت المهمة في العملية الرئيسية دون وصول حدث نهائي. افتح السجل للتفاصيل ثم أعد الطلب.'

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '')
  return m.trim() || 'خطأ غير معروف'
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

export default function ChatPanel(): React.JSX.Element {
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
  const [showLog, setShowLog] = useState(false)
  const [logLevel, setLogLevel] = useState<NoticeLevel | 'all'>('all')
  const [confirmStop, setConfirmStop] = useState(false)
  const [previewFault, setPreviewFault] = useState<string | null>(null)
  const [shot, setShot] = useState<{ url: string; at: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  /** آخر مرة وصلنا فيها حدث من main — أساس حارس الصمت. */
  const lastEventAt = useRef(0)
  const probedEventAt = useRef(0)
  const probeTimer = useRef(0)
  const confirmTimer = useRef(0)
  const mounted = useRef(true)
  /** هل المستخدم قريب من القاع؟ إن لا، لا نلمس التمرير. */
  const pinnedRef = useRef(true)
  const logPinnedRef = useRef(true)

  const active = useMemo(
    () => projects.find((p) => p.path === projectPath) ?? null,
    [projects, projectPath],
  )

  const recentTools = useMemo(() => visibleTools(tools, 6), [tools])
  const logRows = useMemo(
    () => filterNotices(notices, logLevel).slice(-120),
    [notices, logLevel],
  )
  const counts = useMemo(() => noticeCounts(notices), [notices])
  const transcript = useMemo(() => transcriptSignature({ ...useWorkspace.getState() }), [lines, streamingText, tools, plan, phaseDetail, awaitingQuestion])
  const hasModel = Boolean(providerId && modelId)

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
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
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
  }, [transcript, showLog])

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
    let last: PreviewBounds | null = null
    let lastGood: PreviewBounds | null = null

    const send = (b: PreviewBounds): void => {
      void window.studio.preview.resize(b).catch(() => undefined)
    }

    const measure = (): void => {
      frame = 0
      if (!mounted.current) return
      const next = boundsOf(el)
      if (sameBounds(last, next)) return
      last = next

      if (next.width < MIN_PREVIEW_SIDE || next.height < MIN_PREVIEW_SIDE) {
        // مستطيل مُشوَّه (طيّ السجل، تصغير النافذة). لا نرسله — نبقي آخر
        // مستطيل صحيح بدل أن يطير الـ view فوق المحادثة.
        if (lastGood) send(lastGood)
        else void window.studio.preview.close().catch(() => undefined)
        return
      }
      lastGood = next
      send(next)
    }

    const loop = (): void => {
      frame = window.requestAnimationFrame(loop)
      measure()
    }
    loop()

    const onResize = (): void => measure()
    window.addEventListener('resize', onResize)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  /**
   * فتح المعاينة: نربط الـ view أولًا (main ينشئه) ثم نفتح العنوان (main يحمّله).
   * الترتيب معكوس يُنتج view فارغًا، لأن open بلا view يسجّل العنوان فقط.
   */
  const openPreview = useCallback(
    async (url: string): Promise<void> => {
      const el = previewRef.current
      if (!el) return
      const bounds = boundsOf(el)
      if (bounds.width < MIN_PREVIEW_SIDE || bounds.height < MIN_PREVIEW_SIDE) return

      setPreviewFault(null)
      try {
        await window.studio.preview.attach(bounds)
      } catch (e) {
        setPreviewFault(`تعذّر ربط المعاينة: ${errText(e)}`)
        return
      }
      try {
        const res = await window.studio.preview.open(url)
        if (!res.ok) setPreviewFault('رفضت المعاينة هذا العنوان.')
        else window.setTimeout(() => {
          void window.studio.preview
            .consoleErrors()
            .then(setConsoleIssues)
            .catch(() => undefined)
        }, 1_200)
      } catch (e) {
        setPreviewFault(`تعذّر فتح المعاينة: ${errText(e)}`)
      }
    },
    [setConsoleIssues],
  )

  useEffect(() => {
    if (!previewUrl) return
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

  /* ------------------------------- التشغيل -------------------------------- */

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || running || dispatching) return
    if (!providerId || !modelId) {
      dispatch({ type: 'log/note', level: 'error', message: NO_MODEL })
      return
    }

    const sentText = text
    pushUserLine(sentText)
    setDraft('')
    setShot(null)
    setPreviewFault(null)
    setConfirmStop(false)
    lastEventAt.current = 0
    probedEventAt.current = 0
    dispatch({ type: 'run/started' })

    try {
      const res = await window.studio.agent.run({
        prompt: sentText,
        providerId,
        modelId,
        projectPath,
      })
      if (!res.ok) {
        // الرسالة قد تكون بالإنجليزية من main — نعرضها كما هي داخل سجل عربي.
        dispatch({ type: 'run/rejected', message: res.message || 'تعذّر بدء المهمة.' })
        setDraft(sentText)
        return
      }
      // قُبل الطلب. إن لم يصل أي حدث خلال نافذة قصيرة، نسأل main عن الحقيقة.
      scheduleProbe(FIRST_PROBE_MS)
    } catch (e) {
      dispatch({ type: 'run/rejected', message: errText(e) })
      setDraft(sentText)
    }
  }

  const doStop = async (): Promise<void> => {
    dispatch({ type: 'run/stopping' })
    try {
      await window.studio.agent.stop()
    } catch (e) {
      pushNotice('error', `تعذّر الإيقاف: ${errText(e)}`)
    }
    dispatch({ type: 'run/stopped' })
  }

  const stop = (): void => {
    if (stopping) return
    if (!confirmStop) {
      setConfirmStop(true)
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => setConfirmStop(false), CONFIRM_STOP_MS)
      return
    }
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    setConfirmStop(false)
    void doStop()
  }

  // بعد انتهاء المهمة أو ورود سؤال: أعد التركيز إلى المُدخل.
  useEffect(() => {
    if (!running || awaitingQuestion) composerRef.current?.focus()
  }, [running, awaitingQuestion])

  /* -------------------------------- المعاينة: أدوات ------------------------ */

  const openExternal = async (): Promise<void> => {
    if (!previewUrl) return
    try {
      await window.studio.preview.openExternal(previewUrl)
    } catch (e) {
      pushNotice('error', `تعذّر الفتح في المتصفح: ${errText(e)}`)
    }
  }

  const reload = async (): Promise<void> => {
    try {
      await window.studio.preview.reload()
      setConsoleIssues(await window.studio.preview.consoleErrors())
    } catch (e) {
      pushNotice('error', `تعذّر التحديث: ${errText(e)}`)
    }
  }

  /**
   * اللقطة: PNG بحجم ميغابايت. لا نخزّنه في المخزن (كان تسريب ذاكرة بلا فائدة)،
   * بل نحتفظ به محليًا ونعرضه في عمود المحادثة — وهو خارج مستطيل الـ view.
   */
  const refreshShot = async (): Promise<void> => {
    try {
      const res = await window.studio.preview.screenshot()
      if (!res.ok || !res.dataUrl) {
        pushNotice('warn', res.error ? `تعذّرت اللقطة: ${res.error}` : 'تعذّرت اللقطة.')
        return
      }
      if (res.dataUrl.length > MAX_SHOT_BYTES) {
        setShot(null)
        pushNotice('warn', 'اللقطة ضخمة جدًا للعرض — اطلب من الوكيل استخدام take_screenshot بدلها.')
      }
      setShot({ url: res.dataUrl, at: Date.now() })
    } catch (e) {
      pushNotice('error', `تعذّرت اللقطة: ${errText(e)}`)
    }
  }

  const changeViewport = (v: ViewportName): void => {
    setViewport(v)
    void window.studio.preview.setViewport(VIEWPORT_SIZES[v]).catch(() => undefined)
  }

  const canSend =
    draft.trim().length > 0 && !running && !dispatching && !stopping && hasModel

  const question: string = awaitingQuestion?.text ?? ''

  return (
    <div className="flex h-full min-w-0 flex-col bg-panel">
      {/* الحالة */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            running ? 'bg-accent animate-pulse' : phase === 'error' ? 'bg-danger' : 'bg-success'
          }`}
        />
        <span className="text-[12px] text-dim">{phaseLabel(phase)}</span>
        {phaseDetail && (
          <span className={`min-w-0 truncate font-mono text-[11px] text-faint ${PICKABLE}`} dir="ltr">
            {phaseDetail}
          </span>
        )}
        <div className="flex-1" />
        {usage && (
          <span className="shrink-0 font-mono text-[10.5px] text-faint">{formatUsage(usage)}</span>
        )}
        {running && (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            title="الإيقاف يوقف المهمة ويقتل خادم التطوير المرتبط بها"
            className={`h-7 shrink-0 rounded-lg border px-2.5 text-[11.5px] hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60 ${
              confirmStop ? 'border-danger bg-danger/15 text-danger' : 'border-danger/40 text-danger'
            }`}
          >
            {stopping ? 'جارٍ الإيقاف…' : confirmStop ? 'تأكيد الإيقاف؟' : 'إيقاف'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowLog((s) => !s)}
          className="relative h-7 shrink-0 rounded-lg border border-line px-2.5 text-[11.5px] text-mute hover:bg-panel2 hover:text-main"
        >
          السجل
          {counts.errors + counts.warns > 0 && (
            <span className="absolute -top-1 -left-1 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-[9.5px] font-medium text-app">
              {counts.errors + counts.warns}
            </span>
          )}
        </button>
      </div>

      {/* الخطة — ملاحظة: كل لوح متداخل يجب أن يبقى خارج مستطيل المعاينة */}
      {plan.length > 0 && (
        <div className={`shrink-0 border-b border-line bg-panel2 px-3 py-2 ${PICKABLE}`}>
          <div className="mb-1 text-[10.5px] text-faint">الخطة</div>
          <ol className="grid gap-0.5">
            {plan.map((step) => (
              <li key={`${step.index}-${step.title}`} className="flex items-start gap-2 text-[11.5px]">
                <span
                  className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    step.status === 'done'
                      ? 'bg-success'
                      : step.status === 'active'
                        ? 'bg-accent'
                        : step.status === 'failed'
                          ? 'bg-danger'
                          : 'bg-line2'
                  }`}
                />
                <span
                  className={
                    step.status === 'done'
                      ? 'text-faint line-through'
                      : step.status === 'active'
                        ? 'text-main'
                        : 'text-mute'
                  }
                >
                  {step.title}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* المحادثة */}
      <div
        ref={scrollRef}
        className={`min-h-0 flex-1 overflow-auto px-3 py-3 ${PICKABLE}`}
        role="log"
        aria-label="المحادثة"
      >
        {lines.length === 0 && !streamingText && tools.length === 0 && (
          <div className="pt-8 text-center">
            <p className="text-[13px] text-mute">اطلب ما تريد وسأبنيه لك</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
              موقع · لعبة · أداة · أي شيء يعمل في المتصفح
            </p>
          </div>
        )}

        <div className="grid gap-3">
          {lines.map((line) => (
            <div key={line.id}>
              {line.role === 'user' ? (
                <div className="rounded-lg border border-line bg-inset px-3 py-2 text-[12.5px] text-main">
                  {line.text}
                </div>
              ) : (
                <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-dim">
                  {line.text}
                </div>
              )}
            </div>
          ))}

          {/* الأدوات — المفتاح من id الداخلي لا من Date.now */}
          {recentTools.map((tool) => (
            <div key={tool.id} className="text-[11.5px]">
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    tool.status === 'running'
                      ? 'bg-accent animate-pulse'
                      : tool.status === 'done'
                        ? 'bg-success'
                        : 'bg-danger'
                  }`}
                />
                <span className="shrink-0 font-mono text-faint" dir="ltr">
                  {tool.name}
                </span>
                {tool.argHint && (
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mute" dir="ltr">
                    {tool.argHint}
                  </span>
                )}
                {tool.ms > 0 && (
                  <span className="shrink-0 font-mono text-faint">{tool.ms}ms</span>
                )}
              </div>
              {tool.summary && (
                <div
                  className={`mt-0.5 truncate pr-3.5 ${
                    tool.status === 'error' ? 'text-danger/80' : 'text-faint'
                  }`}
                >
                  {tool.summary}
                </div>
              )}
            </div>
          ))}

          {/* الكتلة الجارية — المؤشّر لا يظهر إلا أثناء العمل فعلًا */}
          {streamingText && (
            <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-dim">
              {streamingText}
              {running && (
                <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />
              )}
            </div>
          )}

          {/* لقطة ما زالت معروضة */}
          {shot && (
            <div className="rounded-lg border border-line bg-inset p-2">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-faint">
                <span>لقطة {formatTime(shot.at)}</span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setShot(null)}
                  className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-mute hover:text-main"
                >
                  إخفاء
                </button>
              </div>
              <img src={shot.url} alt="لقطة من المعاينة" className="max-h-40 w-full rounded" />
            </div>
          )}

          {/* خطأ مرئي — لا يختفي داخل السجل المطوي */}
          {lastError && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
              {lastError}
              <button
                type="button"
                onClick={() => setShowLog(true)}
                className="mt-1 block text-[11.5px] text-danger/80 underline"
              >
                اعرض التفاصيل في السجل
              </button>
            </div>
          )}

          {/* سؤال للمستخدم */}
          {awaitingQuestion && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
              {question}
              {awaitingQuestion.options.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {awaitingQuestion.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft(opt)}
                      className="rounded border border-warn/40 px-2 py-0.5 text-[11.5px] hover:bg-warn/10"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* المعاينة */}
      <div className="flex shrink-0 flex-col border-t border-line">
        <div className="flex h-9 shrink-0 items-center gap-1.5 px-3">
          <span className="text-[11px] text-faint">المعاينة</span>
          <div className="flex-1" />
          {VIEWPORTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => changeViewport(v.id)}
              title={v.label}
              aria-label={v.label}
              className={`grid h-6 w-6 place-items-center rounded text-[10px] transition-colors ${
                viewport === v.id ? 'bg-panel3 text-main' : 'text-faint hover:text-main'
              }`}
            >
              {v.glyph}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void reload()}
            disabled={!previewUrl}
            title="تحديث الصفحة"
            className="h-6 rounded border border-line px-2 text-[10.5px] text-mute hover:bg-panel2 hover:text-main disabled:opacity-40"
          >
            تحديث
          </button>
          <button
            type="button"
            onClick={() => void refreshShot()}
            disabled={!previewUrl}
            title="التقاط لقطة للشاشة الحالية"
            className="h-6 rounded border border-line px-2 text-[10.5px] text-mute hover:bg-panel2 hover:text-main disabled:opacity-40"
          >
            لقطة
          </button>
          <button
            type="button"
            onClick={() => void openExternal()}
            disabled={!previewUrl}
            title="فتح في المتصفح الافتراضي"
            className="h-6 rounded border border-line px-2 text-[10.5px] text-mute hover:bg-panel2 hover:text-main disabled:opacity-40"
          >
            خارجي
          </button>
        </div>

        {/*
          حاوية الـ WebContentsView. يجب أن تكون فارغة تمامًا: أي عنصر داخلها
          لن يُرى لأن الـ view عملية منفصلة تُركّب فوق الصفحة.arsk message
          نستطيع عرضه فحسب نستطيع وضعه خارج المستطيل — فوقه مباشرة.
        */}
        <div
          ref={previewRef}
          className="relative min-h-0 w-full flex-[0_0_38%] max-h-[520px] min-h-[200px] bg-inset"
        >
          {!previewUrl && (
            <div className="grid h-full place-items-center px-4 text-center">
              <p className={`text-[11.5px] ${previewFault ? 'text-danger' : 'text-faint'}`}>
                {previewFault
                  ? previewFault
                  : active
                    ? 'لم يبدأ الخادم بعد — اطلب البناء وسيظهر هنا'
                    : 'لا يوجد مشروع مفتوح'}
              </p>
            </div>
          )}
        </div>

        {consoleIssues.length > 0 && (
          <div
            className={`max-h-24 shrink-0 overflow-auto border-t border-line bg-panel2 px-3 py-1.5 font-mono text-[10.5px] text-danger/80 ${PICKABLE}`}
          >
            {consoleIssues.slice(-6).map((issue) => (
              <div key={issue.id} className="truncate" dir="ltr">
                {issue.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* السجل */}
      {showLog && (
        <div className="flex max-h-40 shrink-0 flex-col border-t border-line bg-inset">
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line px-2">
            <span className="text-[11px] text-mute">السجل</span>
            <span className="font-mono text-[10.5px] text-faint">{logRows.length}</span>
            <div className="flex-1" />
            {LOG_LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLogLevel(l.id)}
                className={`h-5 rounded border px-1.5 text-[10px] ${
                  logLevel === l.id
                    ? 'border-line2 bg-panel3 text-main'
                    : 'border-line text-faint hover:text-main'
                }`}
              >
                {l.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => dispatch({ type: 'log/cleared' })}
              className="h-5 rounded border border-line px-1.5 text-[10px] text-faint hover:text-main"
            >
              مسح
            </button>
            <button
              type="button"
              onClick={() => setShowLog(false)}
              className="h-5 rounded border border-line px-1.5 text-[10px] text-faint hover:text-main"
            >
              إغلاق
            </button>
          </div>
          <div ref={logRef} className={`min-h-0 flex-1 overflow-auto px-3 py-1.5 ${PICKABLE}`}>
            {logRows.length === 0 ? (
              <p className="text-[11px] text-faint">لا يوجد سجل</p>
            ) : (
              logRows.map((n) => (
                <div
                  key={n.id}
                  className={`flex gap-1.5 font-mono text-[10.5px] leading-relaxed ${
                    n.level === 'error' ? 'text-danger' : n.level === 'warn' ? 'text-warn' : 'text-faint'
                  }`}
                  dir="auto"
                >
                  <span className="shrink-0 opacity-60">{formatTime(n.at)}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-all">{n.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* المُدخل */}
      <div className="shrink-0 border-t border-line p-3">
        <textarea
          ref={composerRef}
          className={FIELD}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={
            awaitingQuestion
              ? 'اكتب ردّك… (Ctrl+Enter للإرسال)'
              : 'اكتب ما تريد بناءه… (Ctrl+Enter للإرسال)'
          }
          autoFocus
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            title={hasModel ? 'ابدأ المهمة' : NO_MODEL}
            className="h-9 shrink-0 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'يعمل…' : 'إرسال'}
          </button>
          <span className="truncate font-mono text-[10.5px] text-faint">
            {modelId ?? 'لم تختر نموذجًا'}
          </span>
        </div>
        {!hasModel && (
          <p className="mt-1.5 text-[11px] text-warn">{NO_MODEL}</p>
        )}
        {running && (
          <p className="mt-1.5 text-[11px] text-faint">
            يمكنك كتابة الطلب التالي الآن — سنرسله بعد انتهاء المهمة.
          </p>
        )}
      </div>
    </div>
  )
}