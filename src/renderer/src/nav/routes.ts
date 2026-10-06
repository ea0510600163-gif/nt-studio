import type { ProjectInfo } from '../../../shared/api'
import type { ProviderPublic } from '../../../shared/providers'

/**
 * نموذج التنقّل — منطق خالص، بلا React وبلا `window` وبلا `ipcRenderer`.
 *
 * لماذا ملف منفصل؟ كل التنقّل كان مدفونًا داخل JSX في `App.tsx`، فكان
 * غير قابل للاختبار، وأهمّ من ذلك: كان **بتًا واحدًا** (`Screen = 'providers' | 'workspace'`)
 * منفصلًا تمامًا عن `projectPath`. منه انتجت الحالة الميتة
 * `screen='providers' + projectPath=<مضبوط>`: شاشة بلا مخرج.
 *
 * القاعدة الحاكمة هنا:
 *  1. `projectPath` يعيش **داخل المسار** لا خارجه — لا يمكن أن يتناقض مع الشاشة.
 *  2. كل شاشة لها مخرج صريح. لا يوجد مسار يُرفض: `workspace` مشروعه `null` مشروع
 *     شرعي (وهو بالضبط حالة "لم يُنشأ أول مشروع بعد" التي كان التطبيق يركسها).
 *  3. لا تنقّل من ردّ الـ API: تغيّر البيانات (حفظ مزوّد مثلًا) لا يمسّ المسار.
 *     التنقّل فعل للمستخدم وحده.
 */

/* ------------------------------------------------------------------ المسارات */

export type RouteName = 'projects' | 'workspace' | 'providers' | 'error'

export interface Route {
  name: RouteName
  /**
   * مسار المشروع المفتوح. `null` في مساحة العمل = "لم يُنشَأ مشروع بعد"،
   * وهي حالة صالحة عمدًا: `agent.run` يقبل `projectPath: null` و`create_project`
   * موجود لهذه الحالة بالذات.
   */
  projectPath: string | null
}

/** كل أسماء المسارات — تُستخدم في فحص النقاط الميتة آليًا. */
export const ROUTE_NAMES: readonly RouteName[] = ['projects', 'workspace', 'providers', 'error']

export const ROUTE_LABEL: Record<RouteName, string> = {
  projects: 'المشاريع',
  workspace: 'مساحة العمل',
  providers: 'المزوّدات',
  error: 'تعذّر الإقلاع',
}

export function projectsRoute(): Route {
  return { name: 'projects', projectPath: null }
}

export function workspaceRoute(projectPath: string | null): Route {
  return { name: 'workspace', projectPath }
}

export function providersRoute(): Route {
  return { name: 'providers', projectPath: null }
}

export function errorRoute(): Route {
  return { name: 'error', projectPath: null }
}

/* -------------------------------------------------------------- مكدّس المسارات */

export interface NavState {
  stack: Route[]
  /** المؤشّر الحالي داخل `stack`. ما بعده = "إلى الأمام". */
  index: number
}

/** الحالة الابتدائية قبل اكتمال الإقلاع — تُستبدل فور انتهاء القراءة. */
export function homeNav(route: Route = projectsRoute()): NavState {
  return { stack: [route], index: 0 }
}

export function currentRoute(nav: NavState): Route {
  return nav.stack[nav.index] ?? projectsRoute()
}

export function canGoBack(nav: NavState): boolean {
  return nav.index > 0 && nav.stack.length > 0
}

export function canGoForward(nav: NavState): boolean {
  return nav.index < nav.stack.length - 1
}

/** سلسلة المسارات حتى المسار الحالي — مصدر فتات الخبز. */
export function trail(nav: NavState): Route[] {
  return nav.stack.slice(0, nav.index + 1)
}

export function depth(nav: NavState): number {
  return nav.stack.length
}

/** أقصى عمق ممكن للسلسلة — كل الشاشات مجتمعة. */
export const MAX_DEPTH = ROUTE_NAMES.length

export function isSameRoute(a: Route, b: Route): boolean {
  return a.name === b.name && a.projectPath === b.projectPath
}

/** يضيف مسارًا. المسار المكرر واجهة واحدة لا يُسجَّل (سي.click مرتين = نقرة واحدة). */
export function push(nav: NavState, route: Route): NavState {
  if (isSameRoute(currentRoute(nav), route)) return nav
  return { stack: [...nav.stack.slice(0, nav.index + 1), route], index: nav.index + 1 }
}

/** يستبدل المسار الحالي ويمسح ما بعده. */
export function replace(nav: NavState, route: Route): NavState {
  if (isSameRoute(currentRoute(nav), route)) return nav
  return { stack: [...nav.stack.slice(0, nav.index), route], index: nav.index }
}

export function back(nav: NavState): NavState {
  if (!canGoBack(nav)) return nav
  return { stack: nav.stack, index: nav.index - 1 }
}

export function forward(nav: NavState): NavState {
  if (!canGoForward(nav)) return nav
  return { stack: nav.stack, index: nav.index + 1 }
}

/** قفز إلى أي مستوى في السلسلة (نقرة على فتات خبز). */
export function goToDepth(nav: NavState, index: number): NavState {
  if (index < 0 || index >= nav.stack.length || index === nav.index) return nav
  return { stack: nav.stack, index }
}

/* --------------------------------------------------- انتقالات جاهزة */

/**
 * الانتقال إلى قائمة المشاريع.
 * «استبدال» لا «دفع»: الخروج من مشروع يُغلق فرع مساحة العمل، فلا يعود المستخدم
 * إلى محادثة محوت. إن كانت القائمة هي أصلنا أصلًا نرجوع فقط بلا تكرار.
 */
export function goToProjects(nav: NavState): NavState {
  if (currentRoute(nav).name === 'projects') return nav
  if (nav.stack[nav.index - 1]?.name === 'projects') return back(nav)
  return replace(nav, projectsRoute())
}

/** الانتقال إلى شاشة المزوّدات — أو لا شيء إن كنا فيها أصلًا. */
export function goToProviders(nav: NavState): NavState {
  if (currentRoute(nav).name === 'providers') return nav
  if (nav.stack[nav.index - 1]?.name === 'providers') return back(nav)
  return push(nav, providersRoute())
}

/**
 * الانتقال إلى مساحة العمل.
 * هذا هو **إصلاح العيب الأول**: `projectPath = null` مشروع مسموح، فمساحة العمل
 * قابلة للوصول حتى مع صفر مشاريع، ويصير `create_project` في المتناول.
 */
export function goToWorkspace(nav: NavState, projectPath: string | null): NavState {
  return push(nav, workspaceRoute(projectPath))
}

/** أين نذهب بعد شاشة المزوّدات حين لا يوجد ما نرجع إليه (أول تشغيل)؟ */
export function continueTarget(projectCount: number): Route {
  return projectCount === 0 ? workspaceRoute(null) : projectsRoute()
}

/**
 * هل ينقل هذا الانتقال المستخدم خارج مساحة العمل جارحةً؟
 * الانتقال داخل مساحة العمل (مسار ← مسار) ليس خروجًا؛ أما الخروج منها فيمحو
 * المحادثة عبر `setProject` بينما تستمرّ المهمة في العملية الرئيسية وقد مات
 * اشتراك الأحداث — لذلك يحتاج تأكيدًا صريحًا.
 */
export function leavesWorkspace(nav: NavState, target: Route | undefined): boolean {
  if (currentRoute(nav).name !== 'workspace') return false
  return target === undefined || target.name !== 'workspace'
}

/* ------------------------------------------------------------ مزامنة المخزن */

export type StoreSync = { sync: true; projectPath: string | null } | { sync: false }

/**
 * ما الذي يجب أن يراه مخزن `workspace` في كل مسار؟
 *  - `workspace(P)` → `P`  (افتحنا مشروعًا)
 *  - `projects`    → `null` (خرجنا عمدًا: `setProject(null)` يمحو المحادثة)
 *  - `providers`   → لا شيء (العودة إلى مساحة العمل يجب ألّا تمحو المحادثة)
 *  - `error`       → لا شيء
 */
export function projectPathSync(nav: NavState): StoreSync {
  const route = currentRoute(nav)
  if (route.name === 'workspace') return { sync: true, projectPath: route.projectPath }
  if (route.name === 'projects') return { sync: true, projectPath: null }
  return { sync: false }
}

/* ------------------------------------------------------------------- الإقلاع */

export type ProvidersLoad =
  | { ok: true; list: ProviderPublic[] }
  | { ok: false; message: string }

export interface BootInput {
  providers: ProvidersLoad
  projects: ProjectInfo[]
  /** آخر مشروع مفتوح — يُستأنف إن كان ما زال موجودًا. */
  resumePath: string | null
}

/**
 * مسار الإقلاع. **لا يوجد حالة "جارٍ التحميل" هنا أبدًا**: كل وعد يُترجم
 * إلى مسار، ورفضُ القراءة يُترجم إلى مسار خطأ لا إلى مؤشر تحميل أبدي.
 */
export function bootNav(input: BootInput): NavState {
  if (!input.providers.ok) return homeNav(errorRoute())

  // بلا مزوّد لا يمكن تشغيل الوكيل إطلاقًا ⇒ شاشة الإعداد هي الجذر الصحيح.
  if (input.providers.list.length === 0) return homeNav(providersRoute())

  const resume = resumeRoute(input.resumePath, input.projects)
  return homeNav(resume ?? projectsRoute())
}

/** المسار الذي يُستأنف، أو `null` إن لم يعد المشروع موجودًا. */
export function resumeRoute(resumePath: string | null, projects: ProjectInfo[]): Route | null {
  if (!resumePath) return null
  const stillThere = projects.some((p) => p.path === resumePath)
  return stillThere ? workspaceRoute(resumePath) : null
}

/* -------------------------------------------------------------- لوحة المفاتيح */

export interface KeyLike {
  key: string
  altKey?: boolean
}

export type NavIntent = 'back' | 'forward' | 'escape' | 'none'

/**
 * خريطة المفاتيح.
 *  - `Esc`   → رجوع (وإن لم يكن هناك رجوع: لا شيء — لا قفزة عشوائية).
 *  - `Alt+→` → رجوع (السهم الأيمن في تخطيط RTL هو "السابق").
 *  - `Alt+←` → تقدّم.
 *
 * ملاحظة: `Esc` نفسه يُعيد `escape` دائمًا لا `none`، ليبتلعه المكوّن الأقرب
 * (حقل البحث مثلًا) قبل أن يتحوّل إلى رجوع.
 */
export function intentForKey(_nav: NavState, e: KeyLike): NavIntent {
  if (e.altKey) {
    if (e.key === 'ArrowRight') return 'back'
    if (e.key === 'ArrowLeft') return 'forward'
    return 'none'
  }
  if (e.key === 'Escape') return 'escape'
  return 'none'
}

export function applyIntent(nav: NavState, intent: NavIntent): NavState {
  if (intent === 'back' || intent === 'escape') return back(nav)
  if (intent === 'forward') return forward(nav)
  return nav
}

/* --------------------------------------------------------- استئناف آخر مشروع */

export const LAST_PROJECT_KEY = 'nt-studio:last-project'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** قراءة آمنة: تخزين محجوب (وضع خاص) أو تالف ⇒ لا استئناف ولا انهيار. */
export function readResumePath(storage: StorageLike | null | undefined): string | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(LAST_PROJECT_KEY)
    const value = raw?.trim()
    return value ? value : null
  } catch {
    return null
  }
}

export function writeResumePath(storage: StorageLike | null | undefined, projectPath: string | null): void {
  if (!storage) return
  try {
    if (projectPath) storage.setItem(LAST_PROJECT_KEY, projectPath)
    else storage.removeItem(LAST_PROJECT_KEY)
  } catch {
    /* التخزين ليس ميزة أساسية — تجاهُل */
  }
}

/* ------------------------------------------------------- عروض النصوص (خالصة) */

/**
 * قصّ المنتصف لا قصّ الذيل: ذيل مسار مطلق هو **الجزء الوحيد المفيد**.
 * `D:\NT\Projects\my-app\src` ⇒ `D:\NT\Projects\…\my-app\src`
 */
export function middleTruncate(value: string, max: number): string {
  const text = value ?? ''
  if (max <= 1 || text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

/** صيغة عربية صحيحة للعدد (ملف واحد / ملفان / ٣ ملفات / ١١ ملفًا). */
export function fileCountLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return 'بلا ملفات'
  const n = Math.floor(count)
  if (n === 1) return 'ملف واحد'
  if (n === 2) return 'ملفان'
  if (n === 11) return '١١ ملفًا'
  if (n <= 10) return `${n} ملفات`
  return `${n} ملفًا`
}

export function searchResultsLabel(shown: number, total: number): string {
  if (shown === total) return `${total} مشروع`
  return `${shown} من ${total}`
}

/** تاريخ مختصر بالعربية. يعود `''` عند غياب الطابع الزمني. */
export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  try {
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(timestamp),
    )
  } catch {
    return ''
  }
}

/**
 * جذر المشاريع مستنتَج من مسار أول مشروع.
 * الجذر الحقيقي (`state.projectsRoot`) لا يُعرَّض عبر الجسر بعد — انظر التقرير.
 */
export function projectsRootHint(projects: ProjectInfo[]): string | null {
  const first = projects[0]
  if (!first) return null
  const cut = Math.max(first.path.lastIndexOf('\\'), first.path.lastIndexOf('/'))
  if (cut <= 0) return null
  return first.path.slice(0, cut)
}
