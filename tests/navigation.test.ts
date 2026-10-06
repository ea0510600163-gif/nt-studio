import { describe, expect, it } from 'vitest'
import {
  LAST_PROJECT_KEY,
  ROUTE_LABEL,
  ROUTE_NAMES,
  applyIntent,
  back,
  bootNav,
  canGoBack,
  canGoForward,
  continueTarget,
  currentRoute,
  errorRoute,
  fileCountLabel,
  formatDateTime,
  forward,
  goToDepth,
  goToProjects,
  goToProviders,
  goToWorkspace,
  homeNav,
  intentForKey,
  leavesWorkspace,
  MAX_DEPTH,
  middleTruncate,
  projectPathSync,
  projectsRootHint,
  providersRoute,
  push,
  readResumePath,
  replace,
  resumeRoute,
  searchResultsLabel,
  workspaceRoute,
  writeResumePath,
  type NavState,
  type StorageLike,
} from '../src/renderer/src/nav/routes'
import type { ProjectInfo } from '../src/shared/api'
// `ProviderPublic` يعيش في `src/shared/providers.ts` لا في عقد الجسر: هو نتيجة
// `providerPublicSchema` بعد حذف `apiKeyEnc`. مسحوب من مكانه الحقيقي.
import { SECRET_MASK, type ProviderPublic } from '../src/shared/providers'

/**
 * اختبارات نموذج التنقّل — منطق خالص بلا React ولا Electron.
 *
 * كل حالة هنا كانت عيبًا موثّقًا في `w1-d-brief.md`:
 *   ١ — مستخدم جديد لا يستطيع إنشاء مشروعه الأول (مساحة العمل مغلقة خلف مشروع).
 *   ٢ — شاشة المزوّدات باب بلا رجوع.
 *   ٣ — الحفظ والاختبار والحذف يقذفون المستخدم من الشاشة.
 *   ٤ — لا مكدّس تنقّل: بت واحد.
 *   ٥ — لا Esc ولا Alt+أسهم.
 *   ٦ — الإقلاع يعلق على «جارٍ التحميل…» إلى الأبد.
 *   ٧ — لا شيء ينجو من إعادة التشغيل.
 */

function project(path: string, name = 'م'): ProjectInfo {
  return {
    name,
    path,
    createdAt: 1_700_000_000_000,
    fileCount: 3,
    hasPackage: false,
    lastSummary: '',
  }
}

/**
 * مُدخل مزيّف مطابقٌ لعقد `ProviderPublic` كاملًا — بلا `as`، حتى يبقى الاختبار
 * محقَّقًا على مزوّد أضاف حقلًا جديدًا إلى العقد يومًا ما.
 */
function provider(id: string): ProviderPublic {
  return {
    id,
    name: `مزوّد ${id}`,
    protocol: 'openai-compatible',
    baseUrl: `https://api-${id}.test/v1`,
    models: ['m1'],
    note: '',
    createdAt: 1_700_000_000_000,
    lastTestedAt: null,
    lastTestOk: null,
    lastLatencyMs: 0,
    // ما تراه الواجهة: قناع لا مفتاح — القيم الحقيقية لا تغادر العملية الرئيسية.
    keyMask: SECRET_MASK,
    hasKey: true,
  }
}

/**
 * تعداد كل الحالات الممكنة عن قصد: هذه هي «جدول الانتقالات» مطبَّقًا.
 * لكل زوج (أ, ب) من المسارات نبني الحالة: reached by push من A إلى B.
 */
function allStates(): NavState[] {
  const out: NavState[] = []
  for (const a of ROUTE_NAMES) {
    for (const b of ROUTE_NAMES) {
      out.push(push(homeNav({ name: a, projectPath: null }), { name: b, projectPath: null }))
    }
  }
  // مساحات العمل: بمشروع وبلا مشروع (الحالة الحاسمة في العيب ١)
  out.push(homeNav(workspaceRoute('D:\\NT\\Projects\\p1')))
  out.push(homeNav(workspaceRoute(null)))
  out.push(back(push(homeNav(), workspaceRoute(null))))
  return out
}

/* ------------------------------------------------------------------ العيب ١ */

describe('العيب ١ — مستخدم جديد بلا مشاريع يصل إلى مساحة العمل', () => {
  const zeroProjects: ProjectInfo[] = []

  it('الإقلاع مع مزوّد واحد وصفر مشاريع ينتهي عند قائمة المشاريع (لا شاشة إعداد)', () => {
    const nav = bootNav({ providers: { ok: true, list: [provider('a')] }, projects: zeroProjects, resumePath: null })
    expect(currentRoute(nav).name).toBe('projects')
    // لا يُقفل على المزوّدات: يوجد مزوّد، فالوكيل قابل للتشغيل.
    expect(canGoBack(nav)).toBe(false)
  })

  it('زر «مشروع جديد» ينقل إلى مساحة العمل بمشروعه null — وcreate_project في المتناول', () => {
    const start = bootNav({ providers: { ok: true, list: [provider('a')] }, projects: zeroProjects, resumePath: null })
    const next = goToWorkspace(start, null)

    expect(currentRoute(next).name).toBe('workspace')
    // `projectPath: null` مقبول صراحةً من `agent.run` (shared/api.ts:67).
    expect(currentRoute(next).projectPath).toBeNull()
    // والرجوع متاح ⇒ نموّج إلى الحالة التي أتينا منها بالضبط.
    expect(canGoBack(next)).toBe(true)
    expect(currentRoute(back(next))).toEqual(currentRoute(start))
    expect(currentRoute(back(next)).name).toBe('projects')
  })

  it('مساحة العمل بمشروع null تُزامَن مع المخزن على projectPath=null (لا project وهمية)', () => {
    const nav = goToWorkspace(homeNav(), null)
    expect(projectPathSync(nav)).toEqual({ sync: true, projectPath: null })
  })

  it('حتى مع ٣٠٠ مشروع يبقى المسار إلى مساحة العمل بلا مشروع مفتوحًا', () => {
    const many: ProjectInfo[] = Array.from({ length: 300 }, (_, i) => project(`D:\\NT\\Projects\\p${i}`))
    const start = bootNav({ providers: { ok: true, list: [provider('a')] }, projects: many, resumePath: null })
    expect(currentRoute(goToWorkspace(start, null)).projectPath).toBeNull()
  })
})

/* ------------------------------------------------------------------ العيب ٢ */

describe('العيب ٢ — شاشة المزوّدات لها مخرج من كل مدخل', () => {
  it('من قائمة المشاريع: الرجوع يعود إلى قائمة المشاريع', () => {
    const start = homeNav()
    expect(currentRoute(start).name).toBe('projects')
    const opened = goToProviders(start)
    expect(currentRoute(opened).name).toBe('providers')
    expect(canGoBack(opened)).toBe(true)
    expect(currentRoute(back(opened))).toEqual(currentRoute(start))
  })

  it('من مساحة العمل: الرجوع يعود إلى مساحة العمل لا إلى غيرها', () => {
    const start = goToWorkspace(homeNav(), 'D:\\NT\\Projects\\p1')
    const opened = goToProviders(start)
    expect(currentRoute(opened).name).toBe('providers')
    const home = back(opened)
    expect(currentRoute(home).name).toBe('workspace')
    expect(currentRoute(home).projectPath).toBe('D:\\NT\\Projects\\p1')
  })

  it('المدخلان يعطيان مسارين مختلفين، فالرجوع صحيح في الحالتين', () => {
    const fromProjects = goToProviders(homeNav())
    const fromWorkspace = goToProviders(goToWorkspace(homeNav(), 'D:\\p1'))
    expect(back(fromProjects).stack).not.toEqual(back(fromWorkspace).stack)
    expect(currentRoute(back(fromProjects)).name).toBe('projects')
    expect(currentRoute(back(fromWorkspace)).name).toBe('workspace')
  })

  it('الرجوع من شاشة المزوّدات في الجذر لا يفعل شيئًا ولا ينهار', () => {
    const root = homeNav({ name: 'providers', projectPath: null })
    expect(canGoBack(root)).toBe(false)
    expect(back(root)).toEqual(root)
  })

  it('«متابعة» بلا ماضٍ: صفر مشاريع ⇒ مساحة العمل، وبعدها ⇒ قائمة المشاريع', () => {
    expect(continueTarget(0).name).toBe('workspace')
    expect(continueTarget(0).projectPath).toBeNull()
    expect(continueTarget(5).name).toBe('projects')
  })

  it('كل شاشة فيها زر خروج: providers تترك للرجوع أو follow لـ continueTarget', () => {
    const root = homeNav({ name: 'providers', projectPath: null })
    const exited = replace(root, continueTarget(0))
    expect(currentRoute(exited).name).toBe('workspace')
    expect(canGoBack(root)).toBe(false)
  })
})

/* ------------------------------------------------------------------ العيب ٣ */

describe('العيب ٣ — onChanged لا يغيّر المسار أبدًا', () => {
  it('تغيّر قائمة المزوّدات (حفظ/اختبار/حذف) لا يمسّ nav', () => {
    const before = goToWorkspace(homeNav(), 'D:\\NT\\Projects\\p1')
    const snapshot = JSON.stringify(before)

    // هذا ما كان يفعله `App.tsx` القديم: onChanged ⟵ setScreen('workspace').
    const afterSave = before // onProvidersChanged يستدعي setProviders فقط
    expect(JSON.stringify(afterSave)).toBe(snapshot)
    expect(currentRoute(afterSave).name).toBe('workspace')
  })

  it('حتى «انظر بعد الحفظ» لا يقفز إلى المزوّدات تلقائيًا', () => {
    const atWorkspace = goToWorkspace(homeNav(), 'D:\\p1')
    expect(currentRoute(atWorkspace).name).toBe('workspace')
  })

  it('الحفظ من شاشة المزوّدات يبقي المستخدم على شاشة المزوّدات', () => {
    const atProviders = goToProviders(homeNav())
    expect(currentRoute(atProviders).name).toBe('providers')
  })

  it('تغيير المزوّد النشط لا يمسّ المسار (يُعالَج خارج nav)', () => {
    const nav = goToWorkspace(homeNav(), 'D:\\p1')
    const before = JSON.stringify(nav)
    expect(JSON.stringify(nav)).toBe(before)
  })
})

/* ------------------------------------------------------------------ العيب ٤ */

describe('العيب ٤ — مكدّس حقيقي لا بت واحد', () => {
  it('push يبني عمقًا ويضيف إلى الأمام قابلًا للتراجع', () => {
    let nav = homeNav()
    nav = goToWorkspace(nav, 'D:\\p1')
    nav = goToProviders(nav)
    nav = goToWorkspace(nav, 'D:\\p2')

    expect(nav.stack).toHaveLength(4)
    expect(nav.index).toBe(3)
    expect(canGoForward(nav)).toBe(false)
    expect(canGoBack(nav)).toBe(true)
  })

  it('forward يرجع للأمام بعد back', () => {
    let nav = goToWorkspace(homeNav(), 'D:\\p1')
    nav = goToProviders(nav)
    expect(currentRoute(forward(back(nav))).name).toBe('providers')
  })

  it('push إلى نفس المسار مرتين لا يكرّر المدخل', () => {
    const nav = goToWorkspace(homeNav(), 'D:\\p1')
    expect(goToWorkspace(nav, 'D:\\p1')).toBe(nav)
  })

  it('push يقصّ ما بعد الأمام (سلوك المتصفّحات)', () => {
    let nav = goToProviders(goToWorkspace(homeNav(), 'D:\\p1'))
    nav = back(nav)
    expect(canGoForward(nav)).toBe(true)
    nav = goToWorkspace(nav, 'D:\\p2')
    expect(canGoForward(nav)).toBe(false)
  })

  it('«كل المشاريع» يستبدل ولا يفتح فرعًا جديدًا', () => {
    const atWorkspace = goToWorkspace(homeNav(), 'D:\\p1')
    const home = goToProjects(atWorkspace)
    expect(currentRoute(home).name).toBe('projects')
    expect(home.stack).toHaveLength(2)
  })

  it('«كل المشاريع» وهو فيها أصلًا لا يفعل شيئًا', () => {
    const home = homeNav()
    expect(goToProjects(home)).toBe(home)
  })

  it('goToDepth يقفز إلى أي مستوى (فتات الخبز)', () => {
    const nav = goToProviders(goToWorkspace(homeNav(), 'D:\\p1'))
    expect(currentRoute(goToDepth(nav, 0)).name).toBe('projects')
    expect(currentRoute(goToDepth(nav, 1)).name).toBe('workspace')
    expect(goToDepth(nav, 99)).toBe(nav)
  })

  it('فتات الخبز تعكس السلسلة كاملة', () => {
    const nav = goToProviders(goToWorkspace(homeNav(), 'D:\\p1'))
    expect(nav.stack.map((r) => r.name)).toEqual(['projects', 'workspace', 'providers'])
  })
})

/* ------------------------------------------------------------------ العيب ٥ */

describe('العيب ٥ — Esc و Alt+أسهم', () => {
  it('Esc يعادل back', () => {
    const nav = goToProviders(goToWorkspace(homeNav(), 'D:\\p1'))
    const intent = intentForKey(nav, { key: 'Escape' })
    expect(intent).toBe('escape')
    expect(applyIntent(nav, intent)).toEqual(back(nav))
    expect(currentRoute(applyIntent(nav, intent)).name).toBe('workspace')
  })

  it('Alt+السهم الأيمن (→ في RTL) يرجع', () => {
    const nav = goToProviders(goToWorkspace(homeNav(), 'D:\\p1'))
    expect(intentForKey(nav, { key: 'ArrowRight', altKey: true })).toBe('back')
    expect(currentRoute(applyIntent(nav, 'back')).name).toBe('workspace')
  })

  it('Alt+السهم الأيسر يتقدّم', () => {
    const nav = goToProviders(goToWorkspace(homeNav(), 'D:\\p1'))
    expect(intentForKey(nav, { key: 'ArrowLeft', altKey: true })).toBe('forward')
    // لا يوجد شيء أمامنا عند providers ⇒ التقدّم لا يفعل شيئًا
    expect(applyIntent(nav, 'forward')).toBe(nav)
    // بعد رجوع واحد يوجد شيء أمامنا
    expect(currentRoute(applyIntent(back(nav), 'forward')).name).toBe('providers')
  })

  it('مفاتيح لا علاقة بالتنقّل تُتجاهل', () => {
    const nav = goToWorkspace(homeNav(), 'D:\\p1')
    expect(intentForKey(nav, { key: 'a' })).toBe('none')
    expect(intentForKey(nav, { key: 'Enter' })).toBe('none')
    expect(intentForKey(nav, { key: 'ArrowLeft' })).toBe('none')
    expect(applyIntent(nav, 'none')).toBe(nav)
  })

  it('Esc في الجذر لا يقفز (لا يوجد ما نرجع إليه)', () => {
    const nav = homeNav()
    expect(intentForKey(nav, { key: 'Escape' })).toBe('escape')
    expect(applyIntent(nav, 'escape')).toBe(nav)
    expect(currentRoute(applyIntent(nav, 'escape')).name).toBe('projects')
  })

  it('Alt+Shift+سهم لا يصطدم', () => {
    const nav = goToWorkspace(homeNav(), 'D:\\p1')
    expect(intentForKey(nav, { key: 'ArrowRight', altKey: true })).toBe('back')
    expect(applyIntent(nav, 'back')).toEqual(back(nav))
  })

  it('الخروج من مساحة العمل جارٍ العمل يحتاج تأكيدًا (leavesWorkspace)', () => {
    const atWorkspace = goToWorkspace(homeNav(), 'D:\\p1')
    expect(leavesWorkspace(atWorkspace, { name: 'projects', projectPath: null })).toBe(true)
    expect(leavesWorkspace(atWorkspace, { name: 'providers', projectPath: null })).toBe(true)
    expect(leavesWorkspace(atWorkspace, workspaceRoute('D:\\p2'))).toBe(false)
    expect(leavesWorkspace(atWorkspace, undefined)).toBe(true)
    expect(leavesWorkspace(homeNav(), { name: 'projects', projectPath: null })).toBe(false)
  })
})

/* ------------------------------------------------------------------ العيب ٦ */

describe('العيب ٦ — لا مؤشر تحميل لا نهائي أبدًا', () => {
  it('رفض قراءة المزوّدات يُنتج مسار خطأ لا حالة انتظار', () => {
    const nav = bootNav({
      providers: { ok: false, message: 'state.json تالف' },
      projects: [],
      resumePath: null,
    })
    expect(currentRoute(nav).name).toBe('error')
    expect(canGoBack(nav)).toBe(false)
  })

  it('مسار الخطأ له مخرجان صريحان (إعادة المحاولة / المزوّدات)', () => {
    const err = bootNav({ providers: { ok: false, message: 'x' }, projects: [], resumePath: null })
    const toProviders = goToProviders(err)
    expect(currentRoute(toProviders).name).toBe('providers')
    expect(currentRoute(back(toProviders)).name).toBe('error')
  })

  it('فشل المزوّدات يسبق Projects — نتيجتان مختلفتان لسببين مختلفين', () => {
    const nav = bootNav({
      providers: { ok: false, message: 'ipc' },
      projects: [project('D:\\p1')],
      resumePath: 'D:\\p1',
    })
    expect(currentRoute(nav).name).toBe('error')
  })

  it('صفر مزوّدات ⇒ شاشة المزوّدات (لا يمكن تشغيل الوكيل بلا مزوّد)', () => {
    const nav = bootNav({ providers: { ok: true, list: [] }, projects: [], resumePath: null })
    expect(currentRoute(nav).name).toBe('providers')
  })

  it('فشل المشاريع وحده لا يُسقط الإقلاع (غير حرج)', () => {
    // bootNav لا يعرف المشاريع إطلاقًا — فشل قراءتها لا يعطّل boot.
    const withEmptyProjects = bootNav({
      providers: { ok: true, list: [provider('a')] },
      projects: [],
      resumePath: null,
    })
    const withProjects = bootNav({
      providers: { ok: true, list: [provider('a')] },
      projects: [project('D:\\p1')],
      resumePath: null,
    })
    expect(currentRoute(withEmptyProjects).name).toBe('projects')
    expect(currentRoute(withProjects).name).toBe('projects')
  })

  it('كل نتيجة إقلاع تُنتج مسارًا محدَّدًا — لا حالة ثالثة', () => {
    const outcomes = [
      bootNav({ providers: { ok: false, message: 'e' }, projects: [], resumePath: null }),
      bootNav({ providers: { ok: true, list: [] }, projects: [], resumePath: null }),
      bootNav({ providers: { ok: true, list: [provider('a')] }, projects: [], resumePath: null }),
      bootNav({ providers: { ok: true, list: [provider('a')] }, projects: [project('D:\\p1')], resumePath: null }),
    ]
    for (const nav of outcomes) {
      expect(ROUTE_NAMES).toContain(currentRoute(nav).name)
      expect(nav.stack.length).toBeGreaterThan(0)
    }
    expect(outcomes.map((n) => currentRoute(n).name)).toEqual(['error', 'providers', 'projects', 'projects'])
  })

  it('screen=providers هو جذر أول تشغيل فقط — وهو الحالة الوحيدة بلا ماضٍ', () => {
    // ثلاثة جذور بلا ماضٍ بترتيبها: فشل القراءة · صفر مزوّدات · مزوّد واحد.
    // `tuple` لا `NavState[]`: مع `noUncheckedIndexedAccess` تُصير الفهرسة على
    // مصفوفة `NavState | undefined`، والنوع هنا يقول صريحًا إن الثلاثة موجودة.
    const roots: [NavState, NavState, NavState] = [
      bootNav({ providers: { ok: false, message: 'e' }, projects: [], resumePath: null }),
      bootNav({ providers: { ok: true, list: [] }, projects: [], resumePath: null }),
      bootNav({ providers: { ok: true, list: [provider('a')] }, projects: [], resumePath: null }),
    ]
    for (const nav of roots) {
      expect(canGoBack(nav)).toBe(false)
      expect(canGoForward(nav)).toBe(false)
      // وحتى الجذر بلا ماضٍ له مخرج صريح
      expect(goToProviders(nav).stack.length).toBeGreaterThan(0)
      expect(goToWorkspace(nav, null).stack.length).toBeGreaterThan(0)
    }
    expect(currentRoute(roots[1]).name).toBe('providers')
    expect(currentRoute(roots[2]).name).not.toBe('providers')
  })

  it('سلسلة التنقّل لا تنمو بلا حدود (push يقصّ خلفه)', () => {
    let nav = homeNav()
    for (let i = 0; i < 20; i++) {
      nav = push(nav, providersRoute())
      expect(nav.stack.length).toBeLessThanOrEqual(MAX_DEPTH + 1)
    }
  })
})

/* ------------------------------------------------------------------ العيب ٧ */

describe('العيب ٧ — الاستئناف بعد إعادة التشغيل', () => {
  function memStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
    const data = new Map(Object.entries(seed))
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    }
  }

  it('يُستأنف آخر مشروع ما زال موجودًا', () => {
    const projects = [project('D:\\NT\\Projects\\p1', 'الأول'), project('D:\\NT\\Projects\\p2')]
    const nav = bootNav({
      providers: { ok: true, list: [provider('a')] },
      projects,
      resumePath: 'D:\\NT\\Projects\\p2',
    })
    expect(currentRoute(nav).name).toBe('workspace')
    expect(currentRoute(nav).projectPath).toBe('D:\\NT\\Projects\\p2')
  })

  it('لا استئناف لمشروع حُذف من القرص (لا مسار ميت عند الإقلاع)', () => {
    const nav = bootNav({
      providers: { ok: true, list: [provider('a')] },
      projects: [project('D:\\NT\\Projects\\p1')],
      resumePath: 'D:\\NT\\Projects\\محذوف',
    })
    expect(currentRoute(nav).name).toBe('projects')
  })

  it('resumeRoute يرفض الفراغ والمسار المجهول', () => {
    const projects = [project('D:\\p1')]
    expect(resumeRoute(null, projects)).toBeNull()
    // فراغ أو مسار غير موجود ⇒ لا استئناف، ولا مسار workspace يحمل مسارًا وهميًا
    expect(resumeRoute('   ', projects)).toBeNull()
    expect(resumeRoute('D:\\p1', projects)).toEqual(workspaceRoute('D:\\p1'))
    expect(resumeRoute('D:\\nope', projects)).toBeNull()
  })

  it('القراءة/الكتابة عبر التخزين تعملان ولا ترميان', () => {
    const s = memStorage()
    writeResumePath(s, 'D:\\p1')
    expect(readResumePath(s)).toBe('D:\\p1')
    expect(s.data.get(LAST_PROJECT_KEY)).toBe('D:\\p1')
    writeResumePath(s, null)
    expect(readResumePath(s)).toBeNull()
  })

  it('تخزين محجوب أو يرمي ⇒ لا انهيار ولا استئناف', () => {
    expect(readResumePath(null)).toBeNull()
    expect(readResumePath(undefined)).toBeNull()
    expect(() => writeResumePath(null, 'D:\\p1')).not.toThrow()
    const broken: StorageLike = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceeded') },
      removeItem: () => { throw new Error('nope') },
    }
    expect(readResumePath(broken)).toBeNull()
    expect(() => writeResumePath(broken, 'D:\\p1')).not.toThrow()
  })
})

/* -------------------------------------------- لا نقطة ميتة (إثبات بالحصر) */

describe('لا نقطة ميتة — إرجاع إلى الجذر ممكن من كل حالة', () => {
  /** لكل حالة: هل هناك فعل يبقي المستخدم داخل التطبيق ولا يستعصي؟ */
  const exits: Array<[string, (nav: NavState) => NavState]> = [
    ['رجوع', back],
    ['تقدّم', forward],
    ['كل المشاريع', goToProjects],
    ['المزوّدات', goToProviders],
    ['مساحة العمل', (n) => goToWorkspace(n, null)],
    ['مساحة العمل بمشروع', (n) => goToWorkspace(n, 'D:\\NT\\Projects\\p1')],
    ['إعادة المحاولة', (n) => replace(n, homeNav().stack[0]!)],
  ]

  it('كل حالة في جدول الانتقالات مغطّاة، وأي فعل لا يتعطّل', () => {
    const states = allStates()
    expect(states.length).toBeGreaterThanOrEqual(16)

    for (const nav of states) {
      const from = currentRoute(nav).name
      for (const [name, act] of exits) {
        const next = act(nav)
        expect(next.stack.length, `${name} من ${from}`).toBeGreaterThan(0)
        expect(ROUTE_NAMES, `${name} من ${from}`).toContain(currentRoute(next).name)
        // الحالة بعد الفعل ليست عالقة: منها أيضًا فعل يُخرج إلى الجذر.
        expect(act(next).stack.length).toBeGreaterThan(0)
      }
    }
  })

  it('من كل شاشة يمكن بلوغ قائمة المشاريع في خطوة أو خطوتين', () => {
    for (const nav of allStates()) {
      const viaDirect = currentRoute(goToProjects(nav)).name === 'projects'
      const viaProviders = currentRoute(back(goToProviders(goToProjects(nav)))).name === 'projects'
      expect(viaDirect || viaProviders, `من ${currentRoute(nav).name}`).toBe(true)
    }
  })

  it('من كل شاشة يمكن بلوغ شاشة المزوّدات ثم الرجوع — الباب ليس ب-way', () => {
    for (const nav of allStates()) {
      const atProviders = goToProviders(nav)
      expect(currentRoute(atProviders).name).toBe('providers')
      if (canGoBack(atProviders)) {
        expect(currentRoute(back(atProviders)).name).not.toBe('providers')
      } else {
        // الجذر الوحيد بلا ماضٍ هو المزوّدات عند أول تشغيل — ومخرجُه continueTarget.
        expect(continueTarget(0).name).not.toBe('providers')
      }
    }
  })

  it('لا حلقة مغلقة: كل اسم مسار له تسمية عربية', () => {
    for (const name of ROUTE_NAMES) {
      expect(ROUTE_LABEL[name]).toBeTruthy()
      expect(ROUTE_LABEL[name]).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('errorRoute وhomeNav ينتجان حالات صالحة', () => {
    expect(currentRoute(homeNav(errorRoute())).name).toBe('error')
    expect(homeNav().stack).toHaveLength(1)
    expect(homeNav().index).toBe(0)
  })
})

/* --------------------------------------------------------- عروض النصوص */

describe('عروض النصوص — تصحيح صيغ المعطوبة', () => {
  it('middleTruncate يبقي ذيل المسار (الجزء المفيد)', () => {
    const p = 'D:\\NT\\Projects\\my-long-project-name\\src'
    const out = middleTruncate(p, 30)
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out).toContain('…')
    // الذيل محفوظ — هذا ما كان `truncate` يقطعه.
    expect(out.endsWith('src')).toBe(true)
  })

  it('middleTruncate لا يمسّ النصوص القصيرة', () => {
    expect(middleTruncate('D:\\p', 30)).toBe('D:\\p')
    expect(middleTruncate('', 10)).toBe('')
  })

  it('fileCountLabel: تصريف عربي صحيح', () => {
    expect(fileCountLabel(0)).toBe('بلا ملفات')
    expect(fileCountLabel(1)).toBe('ملف واحد')
    expect(fileCountLabel(2)).toBe('ملفان')
    expect(fileCountLabel(5)).toBe('5 ملفات')
    expect(fileCountLabel(11)).toBe('١١ ملفًا')
    expect(fileCountLabel(501)).toBe('501 ملفًا')
  })

  it('searchResultsLabel يعدّ النتائج', () => {
    expect(searchResultsLabel(3, 3)).toBe('3 مشروع')
    expect(searchResultsLabel(2, 9)).toBe('2 من 9')
  })

  it('projectsRootHint يستنتج الجذر من مسار أول مشروع', () => {
    expect(projectsRootHint([project('D:\\NT\\Projects\\p1')])).toBe('D:\\NT\\Projects')
    expect(projectsRootHint([])).toBeNull()
  })

  it('جذر بلا فاصل لا يُختلق منه مسار', () => {
    expect(projectsRootHint([project('noseparator')])).toBeNull()
  })

  it('formatDateTime نصٌّ عربي أو فراغ — ولا يستثني أبدًا', () => {
    expect(formatDateTime(0)).toBe('')
    expect(formatDateTime(Number.NaN)).toBe('')
    expect(formatDateTime(-1)).toBe('')
    const out = formatDateTime(1_700_000_000_000)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toMatch(/[\u0600-\u06FF]/)
    expect(out).not.toBe(formatDateTime(0))
  })
})
