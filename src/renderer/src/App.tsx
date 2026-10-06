import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppInfo, ProjectInfo } from '../../shared/api'
import type { ProviderPublic } from '../../shared/providers'
import ProvidersScreen from './components/ProvidersScreen'
import ProjectPicker from './components/ProjectPicker'
import ChatPanel from './components/ChatPanel'
import { phaseLabel, useWorkspace } from './stores/workspace'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconFolder,
  IconPlug,
  IconRotate,
  IconTerminal,
  Spinner,
  StatusDot,
  Tooltip,
  cx,
  type Tone,
} from './components/ui'
import {
  ROUTE_LABEL,
  applyIntent,
  back,
  bootNav,
  canGoBack,
  canGoForward,
  continueTarget,
  currentRoute,
  errorRoute,
  goToDepth,
  goToProjects,
  goToProviders,
  goToWorkspace,
  homeNav,
  intentForKey,
  leavesWorkspace,
  projectPathSync,
  projectsRootHint,
  projectsRoute,
  readResumePath,
  replace,
  trail,
  writeResumePath,
  type NavState,
  type ProvidersLoad,
  type Route,
  type RouteName,
  type StorageLike,
} from './nav/routes'

/**
 * جذر التطبيق — **الهيكل** (shell) والمضيف الوحيد للتنقّل.
 *
 * ## لماذا شجرة واحدة
 *
 * كان الجذر `return <شاشة/>` لكل مسار: أربعة أشجار منفصلة، فيُزال الشريط
 * العلوي وتُعاد أولويّات التركيز ويُصفَّر التمرير عند كل انتقال، وتنطفئ معاينة
 * الوكيل لأن `ChatPanel` يقيس مستطيلها في `requestAnimationFrame` مرة واحدة
 * (`ChatPanel.tsx:300-343`) — وهو مستطيل صفر إن كان المُركَّب غير مرئي.
 * الآن الهيكل شجرة واحدة: شريط علوي ثابت + شريط جانبي + خانة محتوى، والشاشة
 * **مُحدَّدة بجدول** لا بـ`if` مبكّر، فلا يُعاد تركيب الهيكل ولا يُمحى عنه.
 *
 * الشاشات الثلاث تُبنى كأقران داخل `screens`، فتُقرأ الشجرة كلها في مكان واحد:
 * أينما كان `ChatPanel` فلن يكون هناك شيء يرسم فوق مستطيل المعاينة.
 *
 * ## ثلاث قواعد لا تُكسر
 *  1. لا تنقّل من ردّ الـ API: `onChanged` يحدّث الحالة فقط. التنقّل فعل مستخدم.
 *  2. لا مؤشر تحميل أبدي: كل وعد يُترجم إلى مسار، والفشل إلى مسار خطأ فيه زر.
 *  3. `projectPath` داخل المسار — فالتناقض بين الشاشة والمشروع مستحيل.
 */

/* ------------------------------------------------------- ثابتا الهيكل */

/**
 * ارتفاع الشريط العلوي = 36px.
 * سلم المسافات يتوقف عند 32/28/34/40 فلا درجة تطابق 36، و`h-9` درجة قياسية
 * في Tailwind (0.25rem×9) لا قيمة مخترعة ولا قيمة خارج السلم.
 */
const BAR_HEIGHT = 'h-9'

/** عرض الشريط الجانبي — يستهلك الفراغ الميت بين حافة النافذة ومحتوى 768px. */
const RAIL_WIDTH = 'w-14'

/**
 * شريط النافذة القابل للسحب.
 *
 * `-webkit-app-region` ليس صنفًا في Tailwind 4 ولا اسمًا في `@theme`، وقيمته
 * (`drag` / `no-drag`) ليست لونًا ولا قياسًا — فكتابته في `style` هي الطريق
 * الصادق، لا محاولة اختلاق صنف. جاهزة لتطبيق `titleBarStyle: 'hidden'` في
 * `src/main/index.ts` (انظر تقرير هذه المرحلة).
 */
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

function errText(e: unknown, fallback: string): string {
  const raw = (e as Error | undefined)?.message ?? String(e ?? '')
  const text = String(raw).trim()
  return text.length > 0 ? text : fallback
}

/** التخزين المحلي قد يكون محجوبًا (سياق خصوصية) — لا نفترض وجوده. */
function localStore(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

interface PendingExit {
  /** أين سيذهب المستخدم — يُعرض في رسالة التأكيد. */
  route: Route
  /** ما يُنفَّذ بعد التأكيد. */
  apply: () => void
}

/* ------------------------------------------------------------ الشريط العلوي */

interface Crumb {
  route: Route
  label: string
  /** هو هذا الموضع الحالي؟ */
  current: boolean
}

interface TopBarProps {
  ready: boolean
  nav: NavState
  crumbs: Crumb[]
  providerText: string
  statusLabel: string
  statusTone: Tone
  statusBusy: boolean
  version: string
  onBack: () => void
  onForward: () => void
  onCrumb: (index: number) => void
  onHome: () => void
  onProviders: () => void
}

/**
 * شريط علوي واحد لكل التطبيق: من اليمين (البداية في RTL) زرّ الرجوع ثم اسم
 * المنتج ثم فتات الخبز، ومن اليسار (النهاية) مؤشّر المزوّد وحالة الوكيل
 * والأزرار والإصدار.
 *
 * **الرجوع يشير إلى اليمين**: في `dir="rtl"` الرجوع يمينًا، فالسهم `←` القديم
 * كان يشير إلى التقدّم موقنًا بنفسه. `IconChevronRight` هو اتساع الرجوع ولا
 * يُقلب (قاعدة نظام الأيقونات في `ui/icons.tsx`).
 *
 * كل عنصر تفاعلي يحمل `no-drag`، فلا يبتلع السحبَ ولا يفصل بين موضع الزر
 * وموضع إشارته: ترتيب `Tab` هنا هو نفسه ترتيب القراءة (يمين ← يسار).
 */
function TopBar(props: TopBarProps): React.JSX.Element {
  const { nav, crumbs, ready } = props
  const route = currentRoute(nav)

  return (
    <header
      aria-label="شريط التطبيق"
      style={DRAG}
      className={cx(
        'flex shrink-0 select-none items-center gap-2 border-b border-line bg-surface-1 px-2',
        BAR_HEIGHT,
      )}
    >
      <Tooltip content="رجوع — Esc أو Alt + السهم الأيمن" side="bottom">
        <IconButton
          icon={<IconChevronRight size={15} />}
          label="رجوع"
          size="sm"
          disabled={!ready || !canGoBack(nav)}
          style={NO_DRAG}
          onClick={props.onBack}
        />
      </Tooltip>

      <Tooltip content="تقدّم — Alt + السهم الأيسر" side="bottom">
        <IconButton
          icon={<IconChevronLeft size={15} />}
          label="تقدّم"
          size="sm"
          disabled={!ready || !canGoForward(nav)}
          style={NO_DRAG}
          onClick={props.onForward}
        />
      </Tooltip>

      <span aria-hidden="true" className="h-4 w-px bg-line" />

      <span className="font-mono text-sm font-medium text-text-primary" dir="ltr">
        NT Studio
      </span>

      <nav aria-label="مسار التنقّل" style={NO_DRAG} className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((crumb, i) => (
          <span key={`${i}-${crumb.route.name}`} className="flex min-w-0 items-center gap-1.5">
            {/* الفاصل أيقونة لا `<div>` بعرض 1px على حدّ 1.29:1 — أي لا يُرى. */}
            {i > 0 ? <IconChevronRight size={12} className="text-text-disabled" /> : null}
            {crumb.current ? (
              <span aria-current="page" className="truncate text-sm font-medium text-text-primary">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => props.onCrumb(i)}
                className="focus-ring truncate rounded-sm px-1 text-sm text-text-secondary transition-ui hover:bg-surface-2 hover:text-text-primary"
              >
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      <div style={NO_DRAG} className="flex min-w-0 items-center gap-2">
        <Badge
          tone="neutral"
          size="sm"
          icon={<IconPlug size={11} />}
          className="min-w-0 shrink"
          title={props.providerText}
        >
          {props.providerText}
        </Badge>

        <StatusDot tone={props.statusTone} label={props.statusLabel} pulse={props.statusBusy} />

        <Button
          size="sm"
          variant="secondary"
          style={NO_DRAG}
          disabled={!ready || route.name === 'providers'}
          onClick={props.onProviders}
        >
          المزوّدات
        </Button>

        {route.name === 'workspace' ? (
          <Button size="sm" variant="secondary" style={NO_DRAG} onClick={props.onHome}>
            كل المشاريع
          </Button>
        ) : null}

        <span
          className="font-mono text-xs text-text-muted"
          dir="ltr"
          aria-label={`الإصدار ${props.version || 'غير معروف'}`}
        >
          {props.version !== '' ? `v${props.version}` : '—'}
        </span>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------- الشريط الجانبي */

interface RailProps {
  route: Route
  ready: boolean
  refreshing: boolean
  onRoute: (name: RouteName) => void
  onRefreshProjects: () => void
}

/** الوجهات الثلاث — تُبنى مرة واحدة وتُشارَك كمرجع لا كمكوّنات منفصلة. */
const RAIL_ITEMS: ReadonlyArray<{ name: RouteName; label: string; icon: ReactNode }> = [
  { name: 'projects', label: 'المشاريع', icon: <IconFolder size={17} /> },
  { name: 'workspace', label: 'مساحة العمل', icon: <IconTerminal size={17} /> },
  { name: 'providers', label: 'المزوّدات', icon: <IconPlug size={17} /> },
]

/**
 * شريط جانبي بدل الفراغ الميت.
 *
 * المؤشّر النشط حافة منطقية `border-s-2` لا `border-r-2`: في RTL البداية هي
 * اليمين، فحافة البداية يجب أن تتبع الاتجاه لا أن تُكتب فيزيائيًا وتكسر عند قلب
 * اللغة. `aria-current="page"` على الزر نفسه، والشرح يأتي من `Tooltip`
 * لا من `title` (الاسم يبقى عربيًا في شجرة الوصول).
 */
function SideRail(props: RailProps): React.JSX.Element {
  const current = props.route.name

  return (
    <nav
      aria-label="التنقّل الرئيسي"
      className={cx(
        'flex shrink-0 flex-col items-center gap-1 border-e border-line bg-surface-1 py-2',
        RAIL_WIDTH,
      )}
    >
      {RAIL_ITEMS.map((item) => {
        const active = current === item.name
        return (
          <span
            key={item.name}
            className={cx(
              'flex w-full flex-col items-center border-s-2 transition-ui',
              active ? 'border-accent bg-accent-bg' : 'border-transparent hover:bg-surface-2',
              !props.ready && 'pointer-events-none opacity-45',
            )}
          >
            <Tooltip content={item.label} side="start">
              <IconButton
                icon={item.icon}
                label={item.label}
                tone={active ? 'accent' : 'neutral'}
                aria-current={active ? 'page' : undefined}
                onClick={() => props.onRoute(item.name)}
              />
            </Tooltip>
          </span>
        )
      })}

      <span aria-hidden="true" className="my-1 h-px w-6 bg-line" />

      <span className="mt-auto flex w-full flex-col items-center">
        <Tooltip content="إعادة قراءة قائمة المشاريع من القرص" side="start">
          <IconButton
            icon={<IconRotate size={16} />}
            label="تحديث قائمة المشاريع"
            loading={props.refreshing}
            onClick={props.onRefreshProjects}
          />
        </Tooltip>
      </span>
    </nav>
  )
}

/* -------------------------------------------------------------- حالات المحتوى */

function Booting(): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center px-gutter py-gutter" aria-busy="true" aria-live="polite">
      <span className="flex items-center gap-2 text-base text-text-secondary">
        <Spinner size={16} label={null} />
        <span>جارٍ إقلاع التطبيق…</span>
      </span>
    </div>
  )
}

interface BootErrorProps {
  message: string
  onRetry: () => void
  onProviders: () => void
}

/**
 * خطأ الإقلاع داخل الهيكل لا فوقه: شريط التنقّل يبقى حيًّا، فالمستخدم يرى
 * أين هو ولا تختفي الشاشة كاملة ثم تعود.
 */
function BootError(props: BootErrorProps): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center px-gutter py-gutter">
      <div className="w-full max-w-lg">
        <EmptyState
          icon={<IconAlertTriangle size={22} />}
          title="تعذّر الإقلاع"
          description="لم نتمكن من قراءة مزوّداتك المحفوظة. ملفاتك سليمة غالبًا — جرّب القراءة مجددًا."
          action={
            <Button variant="primary" onClick={props.onRetry}>
              إعادة المحاولة
            </Button>
          }
          secondaryAction={
            <Button variant="secondary" onClick={props.onProviders}>
              الذهاب لشاشة المزوّدات
            </Button>
          }
        />
        <p className="mt-3 text-center font-mono text-xs text-text-muted" dir="auto">
          {props.message}
        </p>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- الجذر */

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [providers, setProviders] = useState<ProviderPublic[]>([])
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null)
  const [nav, setNav] = useState<NavState>(() => homeNav())

  const projects = useWorkspace((s) => s.projects)
  const storePath = useWorkspace((s) => s.projectPath)
  const running = useWorkspace((s) => s.running)
  const phase = useWorkspace((s) => s.phase)
  const providerId = useWorkspace((s) => s.providerId)
  const modelId = useWorkspace((s) => s.modelId)
  const setProjects = useWorkspace((s) => s.setProjects)
  const setProject = useWorkspace((s) => s.setProject)
  const setActive = useWorkspace((s) => s.setActive)

  // مرايا محدَّثة للمُستمع العام على window (يُثبَّت مرة واحدة)
  const navRef = useRef(nav)
  navRef.current = nav
  const runningRef = useRef(running)
  runningRef.current = running
  const pendingRef = useRef(pendingExit)
  pendingRef.current = pendingExit

  /* --------------------------------------------------------------- المزوّدات */

  /**
   * يضمن وجود مزوّد نشط — لكن **لا ينقّل**. الحفظ والاختبار والحذف يجب ألّا
   * يقذف المستخدم من الشاشة (كان `setScreen('workspace')` يفعل ذلك، فكانت
   * رسالة «تم الحفظ» تُكتب إلى مكوّن أُزيل تركيبه ولا يراها أحد).
   */
  const ensureActiveProvider = (list: ProviderPublic[]): void => {
    const state = useWorkspace.getState()
    const alive = state.providerId !== null && list.some((p) => p.id === state.providerId)
    if (alive) return
    const first = list[0]
    if (!first) {
      setActive(null, null)
      return
    }
    const model = first.models[0] ?? null
    setActive(first.id, model)
    if (model) void window.studio.providers.setActive(first.id, model).catch(() => undefined)
  }

  const onProvidersChanged = (list: ProviderPublic[]): void => {
    setProviders(list)
    ensureActiveProvider(list)
    // لا setNav هنا. أبدًا.
  }

  /* ---------------------------------------------------------------- المشاريع */

  const refreshProjects = useCallback((): Promise<void> => {
    setProjectsLoading(true)
    setProjectsError(null)
    return window.studio.providers.listProjects().then(
      (list) => {
        setProjects(list)
        setProjectsLoading(false)
      },
      (e: unknown) => {
        setProjectsError(errText(e, 'تعذّر قراءة قائمة المشاريع من القرص'))
        setProjectsLoading(false)
      },
    )
  }, [setProjects])

  /* ----------------------------------------------------------------- الإقلاع */

  const boot = useCallback((): Promise<void> => {
    setReady(false)
    setPendingExit(null)

    const providersLoad: Promise<ProvidersLoad> = window.studio.providers.list().then(
      (list): ProvidersLoad => ({ ok: true, list }),
      (e: unknown): ProvidersLoad => ({
        ok: false,
        message: errText(e, 'تعذّر قراءة المزوّدات المحفوظة'),
      }),
    )

    const projectsLoad = window.studio.providers.listProjects().then(
      (list): { ok: true; list: ProjectInfo[] } => ({ ok: true, list }),
      (e: unknown): { ok: false; message: string } => ({
        ok: false,
        message: errText(e, 'تعذّر قراءة قائمة المشاريع من القرص'),
      }),
    )

    return Promise.all([providersLoad, projectsLoad]).then(([providersOutcome, projectsOutcome]) => {
      const list = providersOutcome.ok ? providersOutcome.list : []
      setProviders(list)

      if (providersOutcome.ok) {
        setBootError(null)
        ensureActiveProvider(list)
      } else {
        // فشل حرج: بلا المزوّدات لا معنى للتطبيق، وننتقل إلى **مسار خطأ** فيه
        // «إعادة المحاولة» — لا مؤشر تحميل أبد بلا نهاية.
        setBootError(providersOutcome.message)
      }

      // فشل المشاريع غير حرج: القائمة تُعرض خطأً خاصًا بها، والتطبيق يبقى قابلًا
      // للاستخدام (الوكيل ينشئ المشروع الأول بنفسه).
      if (projectsOutcome.ok) {
        setProjects(projectsOutcome.list)
        setProjectsError(null)
      } else {
        setProjectsError(projectsOutcome.message)
      }
      setProjectsLoading(false)

      setNav(
        bootNav({
          providers: providersOutcome,
          projects: projectsOutcome.ok ? projectsOutcome.list : [],
          resumePath: readResumePath(localStore()),
        }),
      )
      setReady(true)
      void window.studio.app.info().then(setInfo).catch(() => undefined)
    })
  }, [setProjects, setActive])

  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void boot().catch((e: unknown) => {
      setBootError(errText(e, 'تعذّر بدء التطبيق'))
      setNav(homeNav(errorRoute()))
      setReady(true)
    })
  }, [boot])

  /* ------------------------------------------- مزامنة `projectPath` مع المسار */

  const sync = projectPathSync(nav)
  const shouldSync = sync.sync
  const syncPath = sync.sync ? sync.projectPath : null
  useEffect(() => {
    if (!shouldSync) return
    if (storePath === syncPath) return
    setProject(syncPath)
  }, [shouldSync, syncPath, storePath, setProject])

  /* ------------------------------------------------------- أفعال المستخدم */

  const routeLabel = useCallback(
    (r: Route): string => {
      if (r.name !== 'workspace') return ROUTE_LABEL[r.name]
      if (r.projectPath === null) return 'مشروع جديد'
      return projects.find((p) => p.path === r.projectPath)?.name ?? 'مشروع'
    },
    [projects],
  )

  /** أي انتقال يخرج من مساحة العمل والمهمة جارية يحتاج تأكيدًا: محادثة تُمحى
   *  والعملية الرئيسية تبقى تعمل بينما اشتراك الأحداث سيُغلق. */
  const guardExit = (target: Route | undefined, apply: () => void): void => {
    if (leavesWorkspace(navRef.current, target) && runningRef.current) {
      setPendingExit({ route: target ?? projectsRoute(), apply })
      return
    }
    setPendingExit(null)
    apply()
  }

  const openProject = (path: string): void => {
    guardExit({ name: 'workspace', projectPath: path }, () => {
      writeResumePath(localStore(), path)
      setNav((s) => goToWorkspace(s, path))
    })
  }

  const startNewProject = (): void => {
    guardExit({ name: 'workspace', projectPath: null }, () => {
      writeResumePath(localStore(), null)
      setNav((s) => goToWorkspace(s, null))
    })
  }

  const goHome = (): void => {
    guardExit({ name: 'projects', projectPath: null }, () => {
      writeResumePath(localStore(), null)
      setNav((s) => goToProjects(s))
    })
  }

  const goProviders = (): void => {
    guardExit({ name: 'providers', projectPath: null }, () => {
      setNav((s) => goToProviders(s))
    })
  }

  /** الشريط الجانبي — وجهة واحدة تُترجم إلى فعل واحد، فلا منطق مكرّر. */
  const goRoute = (name: RouteName): void => {
    if (name === 'projects') {
      goHome()
      return
    }
    if (name === 'providers') {
      goProviders()
      return
    }
    const here = currentRoute(navRef.current)
    const path = here.name === 'workspace' ? here.projectPath : storePath
    guardExit({ name: 'workspace', projectPath: path }, () => {
      writeResumePath(localStore(), path)
      setNav((s) => goToWorkspace(s, path))
    })
  }

  const confirmExit = (): void => {
    const pending = pendingExit
    setPendingExit(null)
    pending?.apply()
  }

  /** انتقال داخل السلسلة: لا نطلب تأكيدًا إن كان الفعل لا أثر له (عند الحافة). */
  const stepWithinStack = (intent: 'back' | 'forward', index: number): void => {
    const state = navRef.current
    const target = state.stack[index]
    guardExit(target, () => {
      if (target === undefined || target.name !== 'workspace') writeResumePath(localStore(), null)
      setNav((s) => applyIntent(s, intent))
    })
  }

  const goBack = (): void => {
    const state = navRef.current
    if (!canGoBack(state)) return
    stepWithinStack('back', state.index - 1)
  }

  const goForward = (): void => {
    const state = navRef.current
    if (!canGoForward(state)) return
    stepWithinStack('forward', state.index + 1)
  }

  const goCrumb = (index: number): void => {
    const state = navRef.current
    if (index === state.index || index < 0 || index >= state.stack.length) return
    guardExit(state.stack[index], () => {
      const target = state.stack[index]
      if (target === undefined || target.name !== 'workspace') writeResumePath(localStore(), null)
      setNav((s) => goToDepth(s, index))
    })
  }

  /** «متابعة» من شاشة المزوّدات: ترجع لمصدرها، وإن لم يكن هناك مصدر فإلى الوجهة
   *  الطبيعية (مع صفر مشاريع ⇒ مساحة العمل، لأن `create_project` تعمل بلا مشروع). */
  const closeProviders = (): void => {
    setNav((s) =>
      canGoBack(s) ? back(s) : replace(s, continueTarget(projects.length)),
    )
  }

  /* ------------------------------------------------ Esc / Alt + الأسهم */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const state = navRef.current
      const intent = intentForKey(state, e)
      if (intent === 'none') return

      // تأكيد معلّق: Esc يلغيه.
      if (intent === 'escape' && pendingRef.current !== null) {
        e.preventDefault()
        setPendingExit(null)
        return
      }

      // شاشة الخطأ مخرجانها صريحان (إعادة المحاولة / المزوّدات) — لا زر رجوع.
      if (currentRoute(state).name === 'error') return

      if (intent === 'back' || intent === 'escape') {
        e.preventDefault()
        goBack()
        return
      }
      if (intent === 'forward') {
        e.preventDefault()
        goForward()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /* ------------------------------------------------------------- المشتقّات */

  const route = currentRoute(nav)
  const crumbs: Crumb[] = trail(nav).map((r, i) => ({
    route: r,
    label: routeLabel(r),
    current: i === nav.index,
  }))

  const activeProvider = providers.find((p) => p.id === providerId) ?? null
  const providerText = activeProvider
    ? modelId
      ? `${activeProvider.name} · ${modelId}`
      : `${activeProvider.name} · بلا نموذج مختار`
    : 'بلا مزوّد'

  const statusTone: Tone =
    route.name === 'error'
      ? 'danger'
      : running
        ? 'accent'
        : phase === 'error'
          ? 'danger'
          : phase === 'done'
            ? 'success'
            : 'neutral'

  /* ------------------------------------------------------------- خانة المحتوى */

  /**
   * الشاشات **أقران في جدول** لا `return <شاشة/>` مبكّر.
   *
   * العنصر الذي لا يُختار لا يُركَّب أصلًا (لا تُنفَّذ له `useEffect` ولا يُقاس
   * مستطيله)، فيبقى حفظ المعاينة آمنًا؛ والفائدة الحقيقية أن الهيكل نفسه
   * (الشريطان) لا يُزال تركيبه عند أي انتقال.
   */
  const screens: Record<RouteName, ReactNode> = {
    providers: (
      <ProvidersScreen
        providers={providers}
        onChanged={onProvidersChanged}
        onClose={closeProviders}
      />
    ),
    projects: (
      <ProjectPicker
        projects={projects}
        loading={projectsLoading}
        error={projectsError}
        root={projectsRootHint(projects)}
        onRetry={() => void refreshProjects()}
        onOpen={openProject}
        onNewProject={startNewProject}
      />
    ),
    workspace: <ChatPanel />,
    error: (
      <BootError
        message={bootError ?? 'خطأ غير معروف'}
        onRetry={() => void boot()}
        onProviders={() => setNav((s) => goToProviders(s))}
      />
    ),
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <TopBar
        ready={ready}
        nav={nav}
        crumbs={crumbs}
        providerText={providerText}
        statusLabel={phaseLabel(phase)}
        statusTone={statusTone}
        statusBusy={running}
        version={info?.version ?? ''}
        onBack={goBack}
        onForward={goForward}
        onCrumb={goCrumb}
        onHome={goHome}
        onProviders={goProviders}
      />

      <div className="flex min-h-0 flex-1">
        <SideRail
          route={route}
          ready={ready}
          refreshing={projectsLoading}
          onRoute={goRoute}
          onRefreshProjects={() => void refreshProjects()}
        />

        <main aria-label="محتوى الشاشة" className="min-h-0 min-w-0 flex-1 bg-bg">
          {ready ? screens[route.name] : <Booting />}
        </main>
      </div>

      <ConfirmDialog
        open={pendingExit !== null}
        onCancel={() => setPendingExit(null)}
        onConfirm={confirmExit}
        title="الوكيل يعمل الآن"
        confirmLabel="خروج ومحو المحادثة"
        tone="danger"
      >
        <p className="text-base leading-relaxed text-text-secondary">
          الانتقال إلى «{pendingExit ? routeLabel(pendingExit.route) : ''}» يمحو نصّ المحادثة من
          الشاشة، وتتوقّف الواجهة عن استقبال أحداث المهمة. المهمة نفسها{' '}
          <strong className="font-semibold text-text-primary">تستمرّ في العملية الرئيسية</strong> —
          لن تتوقّف، لكن لن ترى آخر ما فعله الوكيل بعدها.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          سجلّ الجلسات يبقى محفوظًا على القرص داخل مجلد <span className="font-mono">.agent</span> في
          المشروع، لكنه لا يُستأنت تلقائيًا عند العودة.
        </p>
      </ConfirmDialog>
    </div>
  )
}
