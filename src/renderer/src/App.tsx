import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppInfo, ProjectInfo } from '../../shared/api'
import type { ProviderPublic } from '../../shared/providers'
import ProvidersScreen from './components/ProvidersScreen'
import ProjectPicker from './components/ProjectPicker'
import ChatPanel from './components/ChatPanel'
import { useWorkspace } from './stores/workspace'
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
  type StorageLike,
} from './nav/routes'

/**
 * جذر التطبيق — المضيف الوحيد للتنقّل.
 *
 * كل المنطق هنا دوال خالصة في `nav/routes.ts`: مكدّس مسارات حقيقي بدل
 * بت `Screen = 'providers' | 'workspace'` كان معزلًا عن `projectPath`،
 * فأنتج شاشة بلا مخرج ومستخدمًا عالقًا عند أول مشروع.
 *
 * ثلاث قواعد لا تُكسر:
 *  1. لا تنقّل من ردّ الـ API: `onChanged` يحدّث الحالة فقط. التنقّل فعل مستخدم.
 *  2. لا مؤشر تحميل أبدي: كل وعد يُترجم إلى مسار، والفشل إلى مسار خطأ فيه زر.
 *  3. `projectPath` داخل المسار — فالتناقض بين الشاشة والمشروع مستحيل.
 */

const BTN = 'h-7 rounded-lg border border-line px-2.5 text-[11.5px] text-mute hover:bg-panel2 hover:text-main disabled:cursor-not-allowed disabled:opacity-40'

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

/* ------------------------------------------------------------- شريط التنقّل */

interface ChromeProps {
  nav: NavState
  label: (route: Route) => string
  onBack: () => void
  onForward: () => void
  onCrumb: (index: number) => void
  onProviders: () => void
  onHome: () => void
  pendingExit: PendingExit | null
  onConfirmExit: () => void
  onCancelExit: () => void
  version: string
}

function Chrome(props: ChromeProps): React.JSX.Element {
  const { nav, label, pendingExit } = props
  const route = currentRoute(nav)
  const crumbs = trail(nav)

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
      <button
        type="button"
        onClick={props.onBack}
        disabled={!canGoBack(nav)}
        title="رجوع — Esc أو Alt + →"
        aria-label="رجوع"
        className={BTN}
      >
        →
      </button>
      <button
        type="button"
        onClick={props.onForward}
        disabled={!canGoForward(nav)}
        title="تقدّم — Alt + ←"
        aria-label="تقدّم"
        className={BTN}
      >
        ←
      </button>

      <div className="h-3 w-px bg-line" />

      <nav aria-label="مسار التنقّل" className="flex min-w-0 items-center gap-1.5">
        {crumbs.map((r, i) => (
          <span key={`${i}-${r.name}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-[12px] text-faint">‹</span>}
            <button
              type="button"
              onClick={() => props.onCrumb(i)}
              disabled={i === nav.index}
              title={label(r)}
              className={`truncate text-[12.5px] ${
                i === nav.index ? 'text-main' : 'text-mute hover:text-main'
              }`}
            >
              {label(r)}
            </button>
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      {pendingExit ? (
        <>
          <span className="text-[12px] text-warn">
            الوكيل يعمل الآن — الرجوع إلى «{label(pendingExit.route)}» يمحو المحادثة
          </span>
          <button type="button" onClick={props.onCancelExit} className={BTN}>
            Esc · تراجع
          </button>
          <button
            type="button"
            onClick={props.onConfirmExit}
            className="h-7 rounded-lg border border-danger/40 px-2.5 text-[11.5px] text-danger hover:bg-danger/10"
          >
            خروج ومحو المحادثة
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={props.onProviders}
            disabled={route.name === 'providers'}
            className={BTN}
          >
            المزوّدات
          </button>
          {route.name === 'workspace' && (
            <button type="button" onClick={props.onHome} className={BTN}>
              كل المشاريع
            </button>
          )}
        </>
      )}

      <span className="font-mono text-[10.5px] text-faint" dir="ltr">
        {props.version ? `v${props.version}` : ''}
      </span>
    </header>
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

  /* ------------------------------------------------------------- العرض */

  if (!ready) {
    return <div className="grid h-full place-items-center bg-app text-[13px] text-faint">جارٍ التحميل…</div>
  }

  const route = currentRoute(nav)
  const chrome: ChromeProps = {
    nav,
    label: routeLabel,
    onBack: goBack,
    onForward: goForward,
    onCrumb: goCrumb,
    onProviders: goProviders,
    onHome: goHome,
    pendingExit,
    onConfirmExit: confirmExit,
    onCancelExit: () => setPendingExit(null),
    version: info?.version ?? '',
  }

  if (route.name === 'error') {
    return (
      <div className="grid h-full place-items-center bg-app px-6">
        <div className="card max-w-md px-6 py-6 text-center">
          <h1 className="text-[15px] font-medium text-main">تعذّر الإقلاع</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
            لم نتمكن من قراءة مزوّداتك المحفوظة. ملفاتك سليمة غالبًا — جرّب القراءة مجددًا.
          </p>
          <p className="mt-2 font-mono text-[11.5px] text-faint" dir="ltr">
            {bootError ?? 'خطأ غير معروف'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => void boot()}
              className="h-9 rounded-lg bg-accent px-5 text-[12.5px] font-medium text-white hover:opacity-90"
            >
              إعادة المحاولة
            </button>
            <button
              type="button"
              onClick={() => setNav((s) => goToProviders(s))}
              className="h-9 rounded-lg border border-line px-5 text-[12.5px] text-dim hover:bg-panel2 hover:text-main"
            >
              الذهاب لشاشة المزوّدات
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (route.name === 'providers') {
    return (
      <div className="flex h-full flex-col bg-app">
        <Chrome {...chrome} />
        <div className="min-h-0 flex-1">
          <ProvidersScreen
            providers={providers}
            onChanged={onProvidersChanged}
            onClose={closeProviders}
          />
        </div>
      </div>
    )
  }

  if (route.name === 'projects') {
    return (
      <div className="flex h-full flex-col bg-app">
        <Chrome {...chrome} />
        <div className="min-h-0 flex-1">
          <ProjectPicker
            projects={projects}
            version={info?.version ?? ''}
            loading={projectsLoading}
            error={projectsError}
            root={projectsRootHint(projects)}
            onRetry={() => void refreshProjects()}
            onOpen={openProject}
            onNewProject={startNewProject}
            onProviders={goProviders}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <Chrome {...chrome} />
      <div className="min-h-0 flex-1">
        <ChatPanel />
      </div>
    </div>
  )
}
