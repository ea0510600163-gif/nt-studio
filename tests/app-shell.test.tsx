// @vitest-environment jsdom
/**
 * اختبارات الهيكل — قشرة التطبيق واحدة على كل مسار.
 *
 * كل حالة هنا تحمي عيبًا مقروءًا من `App.tsx` و`ProjectPicker.tsx`:
 *   • الهيكل كان `return <شاشة/>` لكل مسار — الشريط العلوي والتصفّح كلاهما
 *     يُمحى عند كل انتقال؛ صار شجرة واحدة والشاشة تُختار بجدول.
 *   • الرجوع كان سهمًا يشير لليسار: الاتجاه الخاطئ في RTL (الرجوع يمينًا).
 *   • الفاصل بين فتات الخبز كان `<div>` بعرض 1px على حدّ 1.29:1 — لا يُرى.
 *   • خطأ الإقلاع كان شاشة وحده؛ صار داخل الهيكل مع زرّ إعادة المحاولة.
 *   • أربع حالات قائمة المشاريع كانت واحدة (خطأ القراءة = «لا مشاريع»).
 *   • الجمع العربي كان `{N} ملف` دائمًا.
 *   • المسار كان يُقصّ من ذيله — والذيل هو الجزء المفيد.
 *   • البطاقة لم تكن تبدي أي دلالة أنها تُفتح.
 *   • «المزوّدات» كان محصورًا داخل الشاشة فيُعتبر آخر تبويب رغم أنه أعلى الشاشة.
 *   • الصفر من القيم العشوائية والاتجاهات الفيزيائية في المخرجات المرسومة.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../src/renderer/src/App'
import ProjectPicker from '../src/renderer/src/components/ProjectPicker'
import {
  IconChevronLeft,
  IconChevronRight,
} from '../src/renderer/src/components/ui'
import { LAST_PROJECT_KEY, middleTruncate } from '../src/renderer/src/nav/routes'
import { initialRunState } from '../src/renderer/src/stores/reducer'
import { useWorkspace } from '../src/renderer/src/stores/workspace'
import type { ProjectInfo } from '../src/shared/api'
import type { ProviderPublic, Protocol } from '../src/shared/providers'

/* ========================================================================== *
 *  جسر وهمي — كل IPC هنا يحلّ بوعد، وإلا علق الإقلاع عند «جارٍ الإقلاع»
 * ========================================================================== */

function makeProvider(over: Partial<ProviderPublic> = {}): ProviderPublic {
  return {
    id: 'p1',
    name: 'مزوّد رئيسي',
    protocol: 'openai-compatible' as Protocol,
    baseUrl: 'https://api.example.com/v1',
    models: ['gpt-4o'],
    note: '',
    createdAt: 1_700_000_000_000,
    lastTestedAt: null,
    lastTestOk: null,
    lastLatencyMs: null,
    apiStyle: 'chat-completions',
    headers: {},
    queryParams: {},
    keyMask: '••••••••',
    hasKey: true,
    ...over,
  }
}

function makeProject(over: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    name: 'مشروع تجريبي',
    path: 'D:\\NT\\Projects\\demo',
    createdAt: Date.now() - 86_400_000,
    fileCount: 12,
    hasPackage: true,
    lastSummary: 'آخر خلاصة للجلسة',
    ...over,
  }
}

interface Bridge {
  app: { info: ReturnType<typeof vi.fn> }
  providers: Record<string, ReturnType<typeof vi.fn>>
  agent: Record<string, ReturnType<typeof vi.fn>>
  preview: Record<string, ReturnType<typeof vi.fn>>
}

function installBridge(over: { providersList?: () => Promise<ProviderPublic[]>; projectsList?: () => Promise<ProjectInfo[]> } = {}): Bridge {
  const bridge: Bridge = {
    app: { info: vi.fn(async () => ({ name: 'NT Studio', version: '0.1.0', electron: '44', chrome: '130', node: '22', platform: 'win32' })) },
    providers: {
      list: vi.fn(over.providersList ?? (async () => [makeProvider()])),
      listProjects: vi.fn(over.projectsList ?? (async () => [])),
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      probe: vi.fn(),
      testSaved: vi.fn(),
      fetchModels: vi.fn(),
      setActive: vi.fn(async () => true),
    },
    agent: {
      run: vi.fn(async () => ({ ok: true, sessionId: 's1' })),
      stop: vi.fn(async () => true),
      status: vi.fn(async () => ({ running: false, sessionId: null })),
      onEvent: vi.fn(() => () => undefined),
    },
    preview: {
      onUrl: vi.fn(() => () => undefined),
      open: vi.fn(async () => ({ ok: true, url: '' })),
      close: vi.fn(async () => true),
      status: vi.fn(async () => ({ url: null, hasView: false })),
      screenshot: vi.fn(),
      consoleErrors: vi.fn(async () => []),
      reload: vi.fn(async () => true),
      setViewport: vi.fn(async () => true),
      attach: vi.fn(async () => true),
      resize: vi.fn(async () => true),
      openExternal: vi.fn(async () => true),
    },
  }
  Object.defineProperty(window, 'studio', {
    value: bridge,
    writable: true,
    configurable: true,
  })
  return bridge
}

/** مخزن نظيف بين الاختبارات — `useWorkspace` حالة واحدة على مستوى الوحدة. */
function seedStore(): void {
  useWorkspace.setState({ ...initialRunState(), projects: [], projectPath: null, viewport: 'full', providerId: null, modelId: null })
}

beforeEach(() => {
  window.localStorage.clear()
  seedStore()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

/** انتظر حتى يظهر محتوى الشاشة (بعد اكتمال الإقلاع). */
async function settle(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector('header[aria-label="شريط التطبيق"]')).not.toBeNull()
  })
  await waitFor(() => {
    // الإقلاع انتهى ⇒ خانة المحتوى ليست «جارٍ إقلاع التطبيق»
    expect(document.body.textContent).not.toContain('جارٍ إقلاع')
  })
}

function topBar(): HTMLElement {
  const el = document.querySelector('header[aria-label="شريط التطبيق"]')
  if (el === null) throw new Error('الشريط العلوي غير موجود')
  return el as HTMLElement
}

function backButton(): HTMLButtonElement {
  return within(topBar()).getByRole('button', { name: 'رجوع' }) as HTMLButtonElement
}

function currentCrumb(): HTMLElement {
  // البطاقة النشطة قد تحمل aria-current="true" — نحن نريد الفتات.
  const crumb = Array.from(document.querySelectorAll('[aria-current="page"]')).find(
    (node) => node.closest('nav[aria-label="مسار التنقّل"]') !== null,
  )
  if (crumb === undefined) throw new Error('فتّات الخبز الحالي غير موجود')
  return crumb as HTMLElement
}

/* ========================================================================== *
 *  1) الهيكل واحد على كل مسار
 * ========================================================================== */

describe('الهيكل شجرة واحدة على كل مسار', () => {
  it('الشريط العلوي والجانبي وفمّة الخبز موجودون على مسار المشاريع', async () => {
    installBridge({ projectsList: async () => [makeProject()] })
    render(<App />)
    await settle()

    expect(topBar()).toBeDefined()
    expect(document.querySelector('nav[aria-label="التنقّل الرئيسي"]')).not.toBeNull()
    expect(document.querySelector('nav[aria-label="مسار التنقّل"]')).not.toBeNull()
    expect(screen.getByText('مشاريعك')).toBeDefined()
  })

  it('الشريط العلوي لا يختفي على مسار المزوّدات', async () => {
    installBridge({ providersList: async () => [] })
    render(<App />)
    await settle()

    expect(topBar()).toBeDefined()
    expect(currentCrumb().textContent).toContain('المزوّدات')
    expect(document.body.textContent).toContain('المزوّد')
  })

  it('الشريط العلوي لا يختفي على مسار مساحة العمل — وهو التحوّل من return مبكّر إلى شجرة واحدة', async () => {
    const project = makeProject()
    window.localStorage.setItem(LAST_PROJECT_KEY, project.path)
    installBridge({ projectsList: async () => [project] })
    render(<App />)
    await settle()

    // ChatPanel هي التي تتكلّم: «اطلب ما تريد» سطرها الفارغ.
    await screen.findByText('اطلب ما تريد وسأبنيه لك')
    expect(topBar()).toBeDefined()
    expect(document.querySelector('nav[aria-label="التنقّل الرئيسي"]')).not.toBeNull()
  })

  it('خطأ الإقلاع يُعرض داخل الهيكل مع إعادة المحاولة', async () => {
    installBridge({
      providersList: async () => {
        throw new Error('ملف الحالة تالف')
      },
    })
    render(<App />)
    await settle()

    // الهيكل ما زال حيًا — الفتات والرجوع موجودان رغم مسار الخطأ.
    expect(topBar()).toBeDefined()
    // عنوان حالة الإقلاع داخل خانة المحتوى (فتات الخبز تحمل الاسم نفسه أيضًا).
    expect(screen.getAllByText('تعذّر الإقلاع').length).toBeGreaterThanOrEqual(2)
    expect(document.body.textContent).toContain('ملف الحالة تالف')

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    // إعادة المحاولة نادى الجسر مرة ثانية، والخطأ بقي (الرفض دائم هنا).
    await waitFor(() => {
      expect(screen.getAllByText('تعذّر الإقلاع').length).toBeGreaterThanOrEqual(2)
    })
  })

  it('إعادة المحاولة تنجح فعليًا بعد زوال السبب', async () => {
    let fail = true
    installBridge({
      providersList: async () => {
        if (fail) throw new Error('القرص مقفول')
        return [makeProvider()]
      },
      projectsList: async () => [],
    })
    render(<App />)
    await settle()
    expect(screen.getAllByText('تعذّر الإقلاع').length).toBeGreaterThanOrEqual(2)

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    // النجاح يُسقط شاشة الخطأ ويعيدنا إلى قائمة المشاريع.
    await waitFor(() => {
      expect(screen.getByText('مشاريعك')).toBeDefined()
    })
    expect(document.body.textContent).not.toContain('ملف الحالة')
    // فتات الخبز لم تعد على مسار الخطأ.
    expect(document.body.textContent).not.toContain('تعذّر الإقلاع')
  })

  it('لا `return <شاشة/>` مبكّر: جدول `screens` هو وحده الذي يختار', async () => {
    const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.(
      'node:fs',
    ) as { readFileSync: (p: string, e: string) => string } | undefined
    const source = fs?.readFileSync('src/renderer/src/App.tsx', 'utf8') ?? ''
    expect(source.length).toBeGreaterThan(5_000)
    // كل ذكر لـ`return <شاشة/>` في الملف يجب أن يكون داخل تعليق يشرح القرار.
    const codeLines = source.split('\n').filter((line) => !/^\s*(\*|\/\/)/.test(line))
    for (const line of codeLines) {
      expect(line).not.toMatch(/return <\s*(ProvidersScreen|ProjectPicker|ChatPanel|BootError|Booting)/)
    }
  })
})

/* ========================================================================== *
 *  2) الرجوع: معطّل في العمق 1، يعمل فوقه، والسهم يشير يمينًا
 * ========================================================================== */

describe('زرّ الرجوع', () => {
  it('معطّل في عمق 1 وينشط فوقه', async () => {
    installBridge({ projectsList: async () => [makeProject()] })
    render(<App />)
    await settle()

    expect(backButton().hasAttribute('disabled')).toBe(true)

    // ندفع مسارًا ثانيًا: المشاريع ثم المزوّدات.
    fireEvent.click(within(topBar()).getByRole('button', { name: 'المزوّدات' }))
    await waitFor(() => {
      expect(document.body.textContent).toContain('المزوّد')
    })
    expect(backButton().hasAttribute('disabled')).toBe(false)

    fireEvent.click(backButton())
    await waitFor(() => {
      expect(screen.getByText('مشاريعك')).toBeDefined()
    })
    expect(backButton().hasAttribute('disabled')).toBe(true)
  })

  it('سهم رجوعه `chevron-right` — الاتجاه الصحيح في RTL — لا سهمًا يسارًا', async () => {
    installBridge()
    render(<App />)
    await settle()

    const inside = backButton().querySelector('svg')
    expect(inside).not.toBeNull()
    const right = render(<IconChevronRight size={15} />)
    const left = render(<IconChevronLeft size={15} />)
    const dOf = (svg: Element | null): string => svg?.querySelector('path')?.getAttribute('d') ?? ''
    expect(dOf(inside)).toBe(dOf(right.container.querySelector('svg')))
    expect(dOf(inside)).not.toBe(dOf(left.container.querySelector('svg')))
  })
})

/* ========================================================================== *
 *  3) فتات الخبز: الحالي يحمل aria-current="page" والأجداد ينقّلون
 * ========================================================================== */

describe('فتات الخبز', () => {
  it('الحالي يحمل aria-current="page"، والجدّ ينقّل عند النقر', async () => {
    installBridge({ projectsList: async () => [makeProject()] })
    render(<App />)
    await settle()

    expect(currentCrumb().textContent).toContain('المشاريع')

    fireEvent.click(within(topBar()).getByRole('button', { name: 'المزوّدات' }))
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المزوّدات')
    })

    // الجدّ زرّ حقيقي، والحالي نصّ لا زرّ.
    const crumbNav = document.querySelector('nav[aria-label="مسار التنقّل"]') as HTMLElement
    const ancestor = within(crumbNav).getByRole('button', { name: 'المشاريع' })
    fireEvent.click(ancestor)
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المشاريع')
    })
  })
})

/* ========================================================================== *
 *  4) لوحة المفاتيح: Esc وAlt+الأسهم تبقى تقود الرجوع/التقدّم
 * ========================================================================== */

describe('اختصارات التنقّل', () => {
  it('Esc يرجع، Alt+السهم الأيسر يقدّم، Alt+السهم الأيمن يرجع', async () => {
    installBridge({ projectsList: async () => [makeProject()] })
    render(<App />)
    await settle()

    fireEvent.click(within(topBar()).getByRole('button', { name: 'المزوّدات' }))
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المزوّدات')
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المشاريع')
    })

    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المزوّدات')
    })

    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المشاريع')
    })
  })

  it('Esc داخل حقل البحث يمسحه ولا ينسحب إلى الرجوع', async () => {
    installBridge({ projectsList: async () => [makeProject()] })
    render(<App />)
    await settle()

    // ندفع مسارًا عميقًا حتى لا يكون Esc رجوعًا بلا عمق.
    fireEvent.click(within(topBar()).getByRole('button', { name: 'المزوّدات' }))
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المزوّدات')
    })
    fireEvent.click(backButton())
    await waitFor(() => {
      expect(currentCrumb().textContent).toContain('المشاريع')
    })

    const search = screen.getByLabelText('ابحث باسم المشروع')
    fireEvent.change(search, { target: { value: 'xyz' } })
    expect(screen.getByText('لا نتائج مطابقة')).toBeDefined()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByText('لا نتائج مطابقة')).toBeNull()
    // الرجوع ما زال على المشاريع: Esc ابتُلِع في الحقل.
    expect(currentCrumb().textContent).toContain('المشاريع')
  })
})

/* ========================================================================== *
 *  5) ProjectPicker — أربع حالات لا تندمج
 * ========================================================================== */

function renderPicker(over: Partial<Parameters<typeof ProjectPicker>[0]> = {}): void {
  render(
    <ProjectPicker
      projects={[]}
      loading={false}
      error={null}
      root={null}
      onRetry={() => undefined}
      onOpen={() => undefined}
      onNewProject={() => undefined}
      {...over}
    />,
  )
}

describe('ProjectPicker يميّز الحالات', () => {
  it('جارٍ القراءة', () => {
    renderPicker({ loading: true, projects: [] })
    expect(screen.getByText(/جارٍ القراءة/)).toBeDefined()
    expect(screen.queryByText('لا توجد مشاريع بعد')).toBeNull()
  })

  it('فشل القراءة مع زرّ إعادة المحاولة — ليس «لا مشاريع»', () => {
    const onRetry = vi.fn()
    renderPicker({ error: 'القرص ممتلئ', onRetry })
    expect(screen.getByText('تعذّرت قراءة المشاريع')).toBeDefined()
    expect(document.body.textContent).toContain('القرص ممتلئ')
    expect(screen.queryByText('لا توجد مشاريع بعد')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('لا مشاريع', () => {
    renderPicker({ projects: [] })
    expect(screen.getByText('لا توجد مشاريع بعد')).toBeDefined()
  })

  it('لا نتائج بحث', () => {
    renderPicker({ projects: [makeProject()] })
    fireEvent.change(screen.getByLabelText('ابحث باسم المشروع'), { target: { value: 'لا-يطابق-شيئًا' } })
    expect(screen.getByText('لا نتائج مطابقة')).toBeDefined()
  })
})

/* ========================================================================== *
 *  6) الجمع العربي لعدد الملفات
 * ========================================================================== */

describe('عدد الملفات بجمع عربي صحيح', () => {
  const cases: [number, string][] = [
    [1, 'ملف واحد'],
    [2, 'ملفان'],
    [3, '3 ملفات'],
    [10, '10 ملفات'],
    // n=11 استثناء مقروء في routes.ts: يُكتب بالأرقام الهندية «١١ ملفًا».
    [11, '١١ ملفًا'],
    [150, '150 ملفًا'],
  ]

  it.each(cases)('%i ⇐ %s', (count, label) => {
    renderPicker({ projects: [makeProject({ fileCount: count })] })
    expect(screen.getByText(label)).toBeDefined()
    cleanup()
  })

  it('السقف 501 لا يُقدَّم كعدد دقيق', () => {
    renderPicker({ projects: [makeProject({ fileCount: 501 })] })
    expect(screen.getByText('501+ ملف')).toBeDefined()
  })

  it('صفر ملفات له نصّه', () => {
    renderPicker({ projects: [makeProject({ fileCount: 0 })] })
    expect(screen.getByText('بلا ملفات')).toBeDefined()
  })
})

/* ========================================================================== *
 *  7) المسار يُقصّ من الوسط، والبطاقة تبدي أنها تُفتح
 * ========================================================================== */

describe('بطاقة المشروع', () => {
  it('المسار يُقصّ من المنتصف فيحفظ الذيل وينزع الوسط', () => {
    const path = 'D:\\NT\\Projects\\some-very-long-project-folder\\src\\components\\deep\\nested\\main.tsx'
    renderPicker({ projects: [makeProject({ path })] })

    const expected = middleTruncate(path, 56)
    expect(expected).toContain('…')
    expect(expected.endsWith('main.tsx')).toBe(true)
    const shown = screen.getByText(expected)
    expect(shown).toBeDefined()
    // القصّ الجديد يحفظ البداية والذيل، لا البداية فقط.
    expect(shown.textContent).not.toBe(path)
  })

  it('البطاقة زرّ حقيقي وفيه سهم دخول باتجاه RTL', () => {
    const { container } = render(
      <ProjectPicker
        projects={[makeProject()]}
        loading={false}
        error={null}
        root={null}
        onRetry={() => undefined}
        onOpen={() => undefined}
        onNewProject={() => undefined}
      />,
    )
    const card = container.querySelector('button')
    expect(card).not.toBeNull()

    const forward = render(<IconChevronLeft size={16} />)
    const dForward = forward.container.querySelector('svg path')?.getAttribute('d') ?? ''
    const svgs = Array.from(card?.querySelectorAll('svg path') ?? []).map((p) => p.getAttribute('d'))
    // «التقدّم» في RTL هو chev-left — وجوده داخل البطاقة يعني دلالة «ادخل».
    expect(svgs).toContain(dForward)
  })
})

/* ========================================================================== *
 *  8) ترتيب التبويب يطابق ترتيب القراءة في RTL
 * ========================================================================== */

describe('ترتيب التركيز', () => {
  it('«المزوّدات» في الشريط العلوي تسبق حقل البحث في شجرة DOM', async () => {
    installBridge({ projectsList: async () => [makeProject()] })
    render(<App />)
    await settle()

    const providers = within(topBar()).getByRole('button', { name: 'المزوّدات' })
    const search = screen.getByLabelText('ابحث باسم المشروع')
    const position = providers.compareDocumentPosition(search)
    // FOLLOWING = البحث يأتي بعد أزرار الشريط — ترتيب التركيز = ترتيب القراءة.
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })
})

/* ========================================================================== *
 *  9) المخرجات المرسومة: صفر قيمة عشوائية وصفر خاصية فيزيائية
 * ========================================================================== */

describe('نظافة المخرجات المرسومة', () => {
  it('صفر قيمةArbitrary وصفر خاصية فيزيائية في DOM الناتج', async () => {
    installBridge({ projectsList: async () => [makeProject()] })
    render(<App />)
    await settle()

    const html = document.body.innerHTML
    expect(html).not.toMatch(/text-\[/)
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(html).not.toMatch(/rgb\(/)
    expect(html).not.toContain('outline-none')
    expect(html).not.toMatch(/\b(pl|pr|ml|mr)-/)
    expect(html).not.toMatch(/\b(left|right)-/)
    expect(html).not.toMatch(/text-(left|right)\b/)
    // لا قيم arbitrary من نوع الأحجام ولا الألوان ولا الأنصاف: لا `text-[13px]`
    // ولا `h-[46%]` ولا `bg-[#fff]` في أي صنف مرسوم. استثناء هندسي معروف:
    // `top-[calc(...)]` في `Tooltip` (موضع مرجع لا قيمة نظام).
    expect(html).not.toMatch(/-\[(?:\d|#|rgb|hsl)/)
    expect(html).not.toMatch(/\b(text|bg|border|h|w|min-h|max-w|max-h|p|px|py|m|mx|my|gap|rounded|inset|z|top|bottom|start|end)-\[(?!calc)/)
  })
})
