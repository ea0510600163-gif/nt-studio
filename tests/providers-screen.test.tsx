// @vitest-environment jsdom
/**
 * اختبارات شاشة المزوّدات — سلوك حقيقي، لا شكل.
 *
 * كل حالة هنا تحمي عيبًا مقيسًا أو مقروءًا من الشيفرة القديمة:
 *   • ترحيل كامل إلى `components/ui`: صفر قيمةArbitrary وصفر خاصية فيزيائية
 *   • «النماذج» كان `div` + `span` — **بلا اسم وصول إطلاقًا**
 *   • زرّ إظهار المفتاح كان **داخل** `<label>` فيصير جزءًا من اسم الحقل
 *   • `doTestSaved` بلا `catch` ومع `void` ⇒ رفضُ الـIPC **غير مرئيّ إطلاقًا**
 *   • `doRemove` بلا تأكيد ولا قفل ⇒ نقرتان تحذفان، والمفتاح المشفّر يُمحى
 *   • `doFetchModels` كان **يستبدل** القائمة فتمحو كل ما كتبه المستخدم يدويًا
 *   • الحقل المعروض والحقل المحفوظ يختلفان: التطبيع يُعرض **قبل** الحفظ
 *   • اختبار فاشل ⇒ `role="alert"` برمز الحالة ونصّ عربي مختلف لكل رمز
 *   • الحفظ يعرض `Toast` مرئيًا قابلًا للإخفاء **ولا ينتقل** إلى شاشة أخرى
 *   • `startEdit` كان لا يصفّر مسودة النموذج ⇒ تسريب من مزوّد إلى آخر
 *   • جمع عربي صحيح بدل `{N} نموذج` دائمًا
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProvidersScreen, { describeProbeFailure, previewBaseUrl } from '../src/renderer/src/components/ProvidersScreen'
import type { Protocol, ProviderInput, ProviderPublic, TestResult } from '../src/shared/providers'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/* ========================================================================== *
 *  جسر وهمي
 * ========================================================================== */

interface ProvidersStub {
  list: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  probe: ReturnType<typeof vi.fn>
  testSaved: ReturnType<typeof vi.fn>
  fetchModels: ReturnType<typeof vi.fn>
  setActive: ReturnType<typeof vi.fn>
  listProjects: ReturnType<typeof vi.fn>
}

function makeProvider(over: Partial<ProviderPublic> = {}): ProviderPublic {
  return {
    id: 'p1',
    name: 'مزوّد محفوظ',
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

function okProbe(over: Partial<TestResult> = {}): TestResult {
  return { ok: true, status: 200, latencyMs: 240, message: 'اتصال ناجح', modelsFound: 1, ...over }
}

function installStub(
  over: {
    list?: ProviderPublic[]
    probe?: TestResult
    fetchModels?: { ok: boolean; models: string[]; error?: string }
  } = {},
): ProvidersStub {
  const list = over.list ?? [makeProvider()]
  const stub: ProvidersStub = {
    list: vi.fn(async () => list),
    add: vi.fn(async (input: ProviderInput) => makeProvider({ ...input, id: 'new-1' })),
    update: vi.fn(async (input: ProviderInput & { id: string }) => makeProvider(input)),
    remove: vi.fn(async () => true),
    probe: vi.fn(async () => over.probe ?? okProbe()),
    testSaved: vi.fn(async () => over.probe ?? okProbe()),
    fetchModels: vi.fn(async () => over.fetchModels ?? { ok: true, models: ['a', 'b'] }),
    setActive: vi.fn(async () => true),
    listProjects: vi.fn(async () => []),
  }
  Object.defineProperty(window, 'studio', {
    value: { providers: stub, app: { info: vi.fn() }, agent: {}, preview: {} },
    writable: true,
    configurable: true,
  })
  return stub
}

interface Handlers {
  onChanged?: ReturnType<typeof vi.fn>
  onClose?: ReturnType<typeof vi.fn>
}

function renderScreen(handlers: Handlers = {}): { onChanged: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onChanged = handlers.onChanged ?? vi.fn()
  const onClose = handlers.onClose ?? vi.fn()
  render(
    <ProvidersScreen
      providers={[makeProvider()]}
      onChanged={onChanged as (next: ProviderPublic[]) => void}
      onClose={onClose as () => void}
    />,
  )
  return { onChanged, onClose }
}

/* أدوات إدخال */
function nameField(): HTMLElement {
  return screen.getByLabelText(/^الاسم/)
}
function urlField(): HTMLElement {
  return screen.getByLabelText(/^الرابط/)
}
function keyField(): HTMLElement {
  return screen.getByLabelText(/^المفتاح/)
}
function modelsField(): HTMLElement {
  return screen.getByLabelText('النماذج')
}

/** يملأ النموذج كاملًا ثم يعيد حقول الاختبار الأساسية. */
function fillForm(model = 'gpt-4o'): void {
  fireEvent.change(nameField(), { target: { value: 'تجريبي' } })
  fireEvent.change(urlField(), { target: { value: 'https://api.example.com/v1' } })
  fireEvent.change(keyField(), { target: { value: 'sk-test' } })
  fireEvent.change(modelsField(), { target: { value: model } })
}

const alertsText = (): string =>
  screen
    .queryAllByRole('alert')
    .map((node) => node.textContent ?? '')
    .join(' || ')

/* ========================================================================== *
 *  1) عقد التطبيع — المرآة تطابق العملية الرئيسية حرفيًا
 * ========================================================================== */

describe('previewBaseUrl — يعرض ما سيُحفظ فعلًا', () => {
  // القيم منحرفةً حرفيًا من tests/providers.test.ts وtests/provider-urls.test.ts
  const table: { input: string; protocol: Protocol; base: string }[] = [
    { input: 'api.example.com', protocol: 'openai-compatible', base: 'https://api.example.com/v1' },
    { input: 'https://api.example.com/v1', protocol: 'openai-compatible', base: 'https://api.example.com/v1' },
    {
      input: 'https://api.example.com/v1/chat/completions',
      protocol: 'openai-compatible',
      base: 'https://api.example.com/v1',
    },
    { input: 'http://127.0.0.1:11434', protocol: 'openai-compatible', base: 'http://127.0.0.1:11434/v1' },
    { input: 'localhost:11434', protocol: 'openai-compatible', base: 'http://localhost:11434/v1' },
    { input: 'https://a.com', protocol: 'anthropic', base: 'https://a.com/v1' },
    { input: 'https://a.com', protocol: 'google', base: 'https://a.com/v1beta' },
    { input: 'https://api.example.com/v1/', protocol: 'openai-compatible', base: 'https://api.example.com/v1' },
    {
      input: 'https://host/openai/deployments/gpt4o',
      protocol: 'openai-compatible',
      base: 'https://host/openai/deployments/gpt4o/v1',
    },
  ]

  it.each(table)('$input ⇐ $base', ({ input, protocol, base }) => {
    expect(previewBaseUrl(input, protocol).base).toBe(base)
  })

  it('نُطبَّق مرتين كمرة واحدة', () => {
    for (const row of table) {
      const once = previewBaseUrl(row.input, row.protocol)
      expect(previewBaseUrl(once.base, row.protocol).base).toBe(once.base)
    }
  })

  it('ينزع سلسلة الاستعلام إلى المعاملات ولا يقرنها بمسار الإصدار', () => {
    const out = previewBaseUrl('https://host?api-version=2024-06-01', 'openai-compatible')
    expect(out.base).toBe('https://host/v1')
    expect(out.params).toEqual([['api-version', '2024-06-01']])
  })

  it('يقصّ نقطة النهاية المرفقة بلاحقة /responses', () => {
    expect(previewBaseUrl('https://zen.example/api/v1/responses', 'openai-compatible').base).toBe(
      'https://zen.example/api/v1',
    )
  })

  it('رابط فارغ ⇐ لا قاعدة', () => {
    expect(previewBaseUrl('   ', 'openai-compatible')).toEqual({ base: '', params: [] })
  })
})

/* ========================================================================== *
 *  2) ترجمة نتيجة الاختبار — رمز مختلف ⇐ نصّ عربي مختلف
 * ========================================================================== */

describe('describeProbeFailure — كل رمز له معنى مكتوب', () => {
  const cases: { status: number | null; marker: string }[] = [
    { status: 401, marker: 'المفتاح مرفوض' },
    { status: 403, marker: 'الطلب محجوب' },
    { status: 404, marker: 'المسار غير موجود' },
    { status: 400, marker: 'طلب مرفوض' },
    { status: 429, marker: 'تجاوز الحدّ' },
    { status: 503, marker: 'خطأ من الخادم' },
  ]

  it.each(cases)('الحالة $status ⇐ «$marker»', ({ status, marker }) => {
    const copy = describeProbeFailure({ ok: false, status, latencyMs: 10, message: 'x', modelsFound: 0 })
    expect(copy.title).toContain(marker)
    expect(copy.title).toContain(String(status))
    expect(copy.reason.length).toBeGreaterThan(10)
    expect(copy.advice.length).toBeGreaterThan(10)
  })

  it('الرموز تُترجم إلى نصوص مختلفة فعلًا لا إلى نصّ واحد', () => {
    const titles = cases.map((c) => describeProbeFailure({ ok: false, status: c.status, latencyMs: 0, message: '', modelsFound: 0 }).title)
    expect(new Set(titles).size).toBe(cases.length)
  })

  it('بلا رمز ⇐ «تعذّر الاتصال» لا عنوانًا مضلِّلًا', () => {
    const copy = describeProbeFailure({ ok: false, status: null, latencyMs: 0, message: 'انتهت المهلة', modelsFound: 0 })
    expect(copy.title).toBe('تعذّر الاتصال بالمزوّد')
    expect(copy.reason).toContain('انتهت المهلة')
  })
})

/* ========================================================================== *
 *  3) الترحيل إلى نظام التصميم — صفر قيمة عشوائية وصفر خاصية فيزيائية
 * ========================================================================== */

describe('الترحيل إلى نظام التصميم', () => {
  type NodeLike = { getBuiltinModule?: (id: string) => unknown }
  const nodeFs = (
    (globalThis as { process?: NodeLike }).process?.getBuiltinModule?.('node:fs') as
      | { readFileSync: (p: string, e: string) => string }
      | undefined
  )
  const source = nodeFs?.readFileSync('src/renderer/src/components/ProvidersScreen.tsx', 'utf8') ?? ''

  it('الملف مقروء فعلًا (حارس ضد الفحص على سلسلة فارغة)', () => {
    expect(source.length).toBeGreaterThan(5_000)
  })

  it('صفر قيمةArbitrary: لا حجم خط بقوس مربّع ولا لون حرّ', () => {
    expect(source).not.toMatch(/text-\[/)
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgb\(/)
  })

  it('صفر outline-none — العيب الذي كان يُبطل حلقة التركيز في كل حقل', () => {
    expect(source).not.toContain('outline-none')
  })

  it('صفر خاصية فيزيائية (الحشوة والحواف كلها منطقية)', () => {
    expect(source).not.toMatch(/\b(pl|pr|ml|mr)-/)
    expect(source).not.toMatch(/\b(left|right)-/)
    expect(source).not.toMatch(/text-(left|right)\b/)
    expect(source).not.toMatch(/border-[lr](?![a-z-])/)
    expect(source).not.toMatch(/rounded-[lr](?![a-z-])/)
  })

  it('اسم المنتج بدل وسم المرحلة الداخلي S3', () => {
    expect(source).not.toMatch(/>S3</)
    renderScreen()
    expect(screen.getByText('NT Studio')).not.toBeNull()
  })

  it('يستعمل مكوّنات المكتبة لا عناصر مُدوية', () => {
    expect(source).toContain("from './ui'")
    for (const component of ['<Button', '<Input', '<Field', '<Select', '<Card', '<Badge', '<Chip', '<ConfirmDialog', '<Toast', '<EmptyState', '<Textarea', '<Spinner', '<Tooltip', '<KeyHint']) {
      expect(source).toContain(component)
    }
    expect(source).not.toMatch(/<select[\s>]/)
  })
})

/* ========================================================================== *
 *  4) الوصول: كل حقل له اسم، ولا زرّ بلا اسم
 * ========================================================================== */

describe('الوصول إلى عناصر التحكم', () => {
  it('حقل «النماذج» له اسم وصول حقيقي — لا div ولا span', () => {
    renderScreen()
    const field = modelsField()
    expect(field.tagName).toBe('INPUT')
    expect(field.getAttribute('id')).not.toBeNull()
    // النقر على نصّ التسمية يجب أن يركّز الحقل فعلًا
    const label = document.querySelector('label[for="' + field.getAttribute('id') + '"]')
    expect(label?.textContent).toContain('النماذج')
  })

  it('كل حقل في النموذج مسمّى', () => {
    renderScreen()
    for (const field of [nameField(), urlField(), keyField(), modelsField()]) {
      const id = field.getAttribute('id')
      expect(id).not.toBeNull()
      expect(document.querySelector('label[for="' + id + '"]')).not.toBeNull()
    }
  })

  it('زرّ إظهار المفتاح خارج <label> فلا يصير جزءًا من اسم الحقل', () => {
    renderScreen()
    const key = keyField()
    const toggle = screen.getByRole('button', { name: 'إظهار المفتاح' })
    expect(key.contains(toggle)).toBe(false)
    expect(key.getAttribute('type')).toBe('password')
    fireEvent.click(toggle)
    expect((keyField() as HTMLInputElement).type).toBe('text')
    expect(screen.getByRole('button', { name: 'إخفاء المفتاح' })).not.toBeNull()
  })

  it('كل زرّ له اسم ونوع صريح', () => {
    renderScreen()
    const buttons = Array.from(document.querySelectorAll('button'))
    expect(buttons.length).toBeGreaterThan(5)
    for (const button of buttons) {
      const name = (button.textContent ?? '').trim() || (button.getAttribute('aria-label') ?? '')
      expect(name.length).toBeGreaterThan(0)
      expect(button.getAttribute('type')).toBe('button')
    }
  })

  it('حالة الخطأ تحمل role="alert" وaria-invalid على الحقل', () => {
    renderScreen()
    fireEvent.change(nameField(), { target: { value: 'تجريبي' } })
    fireEvent.change(urlField(), { target: { value: 'https://api.example.com/v1' } })
    fireEvent.click(screen.getByRole('button', { name: /اختبار الاتصال/ }))

    expect(alertsText()).toContain('أضف اسم نموذج واحدًا على الأقل')
    expect(modelsField().getAttribute('aria-invalid')).toBe('true')
  })
})

/* ========================================================================== *
 *  5) كل الأزرار موصولة بمسمًى — لا زرّ بلا مسار
 * ========================================================================== */

describe('كل زرّ موصول بمسمًى', () => {
  it('لا زرّ بلا اسم ولا نوع صريح', () => {
    installStub()
    const { container } = render(
      <ProvidersScreen providers={[makeProvider()]} onChanged={vi.fn()} onClose={vi.fn()} />,
    )
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons.length).toBeGreaterThan(5)
    for (const button of buttons) {
      const name = (button.textContent ?? '').trim() || (button.getAttribute('aria-label') ?? '')
      expect(name.length).toBeGreaterThan(0)
      expect(button.getAttribute('type')).toBe('button')
    }
  })

  it('كل نداء IPC مرفوض يظهر للمستخدم ولا يُبتلع بصمت', async () => {
    // هذا هو الاختبار الذي يثبت إصلاح العيب الأصلي: `doTestSaved` و
    // `doRemove` كانا بلا `catch` ومعهما `void` ⇐ الرفض غير مرئيّ إطلاقًا.
    const stub = installStub()
    const boom = async (): Promise<never> => {
      throw new Error('الجسر رفض الطلب')
    }
    stub.list.mockRejectedValueOnce(new Error('الجسر رفض الطلب'))
    stub.probe.mockImplementation(boom)
    stub.fetchModels.mockImplementation(boom as unknown as () => Promise<never>)
    stub.testSaved.mockImplementation(boom)
    stub.add.mockImplementation(boom)
    stub.update.mockImplementation(boom)
    stub.remove.mockImplementation(boom)

    const { container } = render(
      <ProvidersScreen providers={[makeProvider()]} onChanged={vi.fn()} onClose={vi.fn()} />,
    )

    fillForm()
    const enabled = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.hasAttribute('disabled'),
    )
    expect(enabled.length).toBeGreaterThan(5)
    for (const button of enabled) {
      expect(() => {
        act(() => {
          fireEvent.click(button)
        })
      }).not.toThrow()
    }

    // «جلب النماذج» و«اختبار الاتصال» و«حذف» و«اختبار الصفّ»: كلٌّ منها
    // يرفض محليًّا، فيجب أن ينتهي إلى تنبيه مرئيّ لا إلى صمت.
    await waitFor(() => {
      expect(alertsText()).toContain('الجسر رفض الطلب')
    })
  })
})

/* ========================================================================== *
 *  6) الحذف — تأكيد، والإلغاء يبقي المزوّد سليمًا
 * ========================================================================== */

describe('الحذف', () => {
  it('يسأل أوّلًا، والإلغاء يُبقي المزوّد ولا ينادي remove', () => {
    const stub = installStub()
    const onChanged = vi.fn()
    render(
      <ProvidersScreen providers={[makeProvider()]} onChanged={onChanged as (n: ProviderPublic[]) => void} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /حذف$/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('حذف')
    expect(dialog.textContent).toContain('المفتاح')
    expect(stub.remove).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'إلغاء' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(stub.remove).not.toHaveBeenCalled()
    expect(screen.getByText('مزوّد محفوظ')).not.toBeNull()
  })

  it('التأكيد ينادي remove مرّة واحدة ثم يعرض إشعار نجاح', async () => {
    const stub = installStub({ list: [] })
    const onChanged = vi.fn()
    render(
      <ProvidersScreen providers={[makeProvider()]} onChanged={onChanged as (n: ProviderPublic[]) => void} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /حذف$/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /احذف نهائيًا/ }))

    await waitFor(() => {
      expect(stub.remove).toHaveBeenCalledTimes(1)
    })
    expect(stub.remove).toHaveBeenCalledWith('p1')
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('حُذف')
    })
  })

  it('رفض الحذف يُعلن ولا يختفي', async () => {
    const stub = installStub()
    stub.remove.mockRejectedValueOnce(new Error('المزوّد مفتوح في جلسة أخرى'))
    render(
      <ProvidersScreen providers={[makeProvider()]} onChanged={vi.fn() as (n: ProviderPublic[]) => void} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /حذف$/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /احذف نهائيًا/ }))

    await waitFor(() => {
      expect(alertsText()).toContain('تعذّر الحذف')
    })
    expect(alertsText()).toContain('المزوّد مفتوح في جلسة أخرى')
  })
})

/* ========================================================================== *
 *  7) اختبار فاشل ⇐ role="alert" برمز الحالة ونصّ عربي
 * ========================================================================== */

describe('الاختبار الفاشل يظهر للمستخدم', () => {
  it('رمز 401 يظهر مع نصّه العربي في تنبيه معلَن', async () => {
    installStub({
      probe: { ok: false, status: 401, latencyMs: 90, message: 'المفتاح مرفوض (401): invalid key', modelsFound: 0 },
    })
    renderScreen()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /اختبار الاتصال/ }))

    await waitFor(() => {
      expect(alertsText()).toContain('401')
    })
    const alert = screen.getAllByRole('alert')[0]
    expect(alert?.getAttribute('aria-live')).toBe('assertive')
    expect(alert?.textContent).toContain('المفتاح مرفوض')
    expect(alert?.textContent).toContain('رفض المزوّد المفتاح')
  })

  it('رمز 404 يعطي نصًّا مختلفًا عن 401', async () => {
    installStub({
      probe: { ok: false, status: 404, latencyMs: 70, message: 'المسار غير موجود (404)', modelsFound: 0 },
    })
    renderScreen()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /اختبار الاتصال/ }))

    await waitFor(() => {
      expect(alertsText()).toContain('404')
    })
    expect(alertsText()).toContain('المسار غير موجود')
    expect(alertsText()).not.toContain('رفض المزوّد المفتاح')
  })

  it('اختبار مزوّد محفوظ يرفضه الجسر يُعلن بدل أن يختفي', async () => {
    const stub = installStub()
    stub.testSaved.mockRejectedValueOnce(new Error('المزوّد غير موجود'))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /^اختبار$/ }))

    await waitFor(() => {
      expect(alertsText()).toContain('تعذّر اختبار')
    })
    expect(alertsText()).toContain('المزوّد غير موجود')
  })

  it('فشل الحفظ يُعلن ولا يختفي', async () => {
    const stub = installStub()
    stub.add.mockRejectedValueOnce(new Error('لا يوجد Secure Storage على هذا الجهاز'))
    renderScreen()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /حفظ المزوّد/ }))

    await waitFor(() => {
      expect(alertsText()).toContain('تعذّر حفظ المزوّد')
    })
    expect(alertsText()).toContain('لا يوجد Secure Storage')
  })

  it('فشل الجلب يُعلن ويُبقي ما كتبه المستخدم', async () => {
    const stub = installStub()
    stub.fetchModels.mockResolvedValueOnce({ ok: false, models: [], error: 'لا يوجد مسار /models على هذا المزوّد (404)' })
    renderScreen()
    fillForm('model-typed-by-hand')
    fireEvent.click(screen.getByRole('button', { name: /جلب النماذج/ }))

    await waitFor(() => {
      expect(alertsText()).toContain('لا يوجد مسار /models')
    })
    // الإدخال اليدوي مسار أول-درجة لا طريق مسدود
    expect(alertsText()).toContain('اكتب اسم النموذج')
    expect(screen.getByText('model-typed-by-hand')).not.toBeNull()
  })
})

/* ========================================================================== *
 *  8) الحفظ — Toast مرئي، بلا انتقال
 * ========================================================================== */

describe('الحفظ', () => {
  it('يعرض Toast نجاح قابلًا للإخفاء ولا يستدعي onClose', async () => {
    const stub = installStub({ list: [] })
    const { onChanged, onClose } = renderScreen()

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /حفظ المزوّد/ }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('حُفظ المزوّد')
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalled()

    const payload = stub.add.mock.calls[0]?.[0] as ProviderInput
    expect(payload.name).toBe('تجريبي')
    expect(payload.apiKey).toBe('sk-test') // بلا مسافة زائدة
    expect(payload.models).toEqual(['gpt-4o'])

    // قابل للإخفاء بزرّ باسم
    fireEvent.click(screen.getByRole('button', { name: 'إخفاء' }))
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  it('زرّ الحفظ لا ينشط قبل اكتمال الاسم والرابط ونموذج واحد', () => {
    renderScreen()
    const save = screen.getByRole('button', { name: /حفظ المزوّد/ })
    expect(save.hasAttribute('disabled')).toBe(true)
    fillForm()
    expect((screen.getByRole('button', { name: /حفظ المزوّد/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('يقطع الرابط الفارغ قبل أن يصل إلى الجسر — لا خطأ إنجليزي خام', () => {
    const stub = installStub()
    renderScreen()
    fillForm()
    fireEvent.change(urlField(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /اختبار الاتصال/ }))

    expect(stub.probe).not.toHaveBeenCalled()
    expect(alertsText()).toContain('اكتب رابط المزوّد')
  })

  it('اسم النماذج يُقصّ من مسافاته قبل الإرسال', async () => {
    const stub = installStub({ list: [] })
    renderScreen()
    fireEvent.change(nameField(), { target: { value: '  متباعد  ' } })
    fireEvent.change(urlField(), { target: { value: 'https://api.example.com/v1' } })
    fireEvent.change(keyField(), { target: { value: '  sk-spaced  ' } })
    fireEvent.change(modelsField(), { target: { value: 'gpt-4o' } })
    fireEvent.click(screen.getByRole('button', { name: /حفظ المزوّد/ }))

    await waitFor(() => {
      expect(stub.add).toHaveBeenCalled()
    })
    const payload = stub.add.mock.calls[0]?.[0] as ProviderInput
    expect(payload.name).toBe('متباعد')
    expect(payload.apiKey).toBe('sk-spaced')
  })

  it('فشل اختبار سابق يجعل زرّ الحفظ قرارًا واعيًا لا زرًّا عاديًا', async () => {
    installStub({ probe: { ok: false, status: 401, latencyMs: 10, message: 'مرفوض', modelsFound: 0 } })
    renderScreen()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /اختبار الاتصال/ }))
    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
    expect(alertsText()).toContain('آخر اختبار على هذا النموذج فشل')
    expect(screen.getByRole('button', { name: /احفظ رغم فشل الاختبار/ })).not.toBeNull()
  })
})

/* ========================================================================== *
 *  9) مسودة النماذج — تُعتمد، ولا تتسرّب بين مزوّدين
 * ========================================================================== */

describe('النماذج', () => {
  it('مسودة غير مضغوطة تُحفظ عند الضغط على «اختبار الاتصال»', async () => {
    const stub = installStub()
    renderScreen()
    fillForm('gpt-4')
    // بلا Enter: الكتابة فقط
    fireEvent.click(screen.getByRole('button', { name: /اختبار الاتصال/ }))
    await waitFor(() => {
      expect(stub.probe).toHaveBeenCalled()
    })
    const sent = stub.probe.mock.calls[0]?.[0] as { models: string[] }
    expect(sent.models).toEqual(['gpt-4'])
  })

  it('مسودة الكتابة تظهر صراحةً قبل الاعتماد فلا يبقى زرّ حفظ حيًّا بلا رقائق', () => {
    renderScreen()
    fillForm()
    fireEvent.change(modelsField(), { target: { value: 'مسودة-لم-تُعتمد' } })
    expect(screen.getByText('مسودة-لم-تُعتمد')).not.toBeNull()
    expect(screen.getByText(/سيُحفظ أيضًا/)).not.toBeNull()
  })

  it('Enter و«,» يضيفان النموذج رقاقة', () => {
    renderScreen()
    fillForm('')
    fireEvent.change(modelsField(), { target: { value: 'first-model' } })
    fireEvent.keyDown(modelsField(), { key: 'Enter' })
    expect(screen.getByText('first-model')).not.toBeNull()

    fireEvent.change(modelsField(), { key: 'k', target: { value: 'second' } })
    fireEvent.keyDown(modelsField(), { key: ',' })
    expect(screen.getByText('second')).not.toBeNull()
  })

  it('لصق «a, b, c» ينتج ثلاث رقائق لا رقاقةً واحدة اسمها «a, b, c»', () => {
    renderScreen()
    fillForm('')
    fireEvent.paste(modelsField(), { clipboardData: { getData: () => 'alpha, beta, gamma' } })
    for (const id of ['alpha', 'beta', 'gamma']) {
      expect(screen.getByText(id)).not.toBeNull()
    }
    expect(screen.queryByText('alpha, beta, gamma')).toBeNull()
  })

  it('تعديل مزوّد يصفّر مسودة النموذج فلا تتسرّب من مزوّد إلى آخر', () => {
    renderScreen()
    fillForm()
    fireEvent.change(modelsField(), { target: { value: 'مسودة-من-المزوّد-الأول' } })
    expect((modelsField() as HTMLInputElement).value).toBe('مسودة-من-المزوّد-الأول')

    fireEvent.click(screen.getByRole('button', { name: /تعديل/ }))
    expect((modelsField() as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('مسودة-من-المزوّد-الأول')).toBeNull()
  })

  it('تعديل مزوّد يُخفي المفتاح ولا يُبقيه مكشوفًا للمزوّد التالي', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'إظهار المفتاح' }))
    expect((keyField() as HTMLInputElement).type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: /تعديل/ }))
    expect((keyField() as HTMLInputElement).type).toBe('password')
    expect((keyField() as HTMLInputElement).value).toBe('')
  })

  it('زرّ إزالة الرقاقة مسمّى باسم النموذج لا بحرف ×', () => {
    renderScreen()
    fillForm()
    fireEvent.keyDown(modelsField(), { key: 'Enter' })
    expect(screen.getByText('gpt-4o')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'إزالة النموذج gpt-4o' }))
    expect(screen.queryByText('gpt-4o')).toBeNull()
  })

  it('تغيير البروتوكول يمسح الرابط والمفتاح والنماذج — لا يفحص OpenAI بترويسة Claude', () => {
    renderScreen()
    fillForm()
    fireEvent.click(screen.getByRole('combobox', { name: /البروتوكول/ }))
    fireEvent.click(screen.getByRole('option', { name: /Anthropic/ }))

    expect((urlField() as HTMLInputElement).value).toBe('')
    expect((keyField() as HTMLInputElement).value).toBe('')
    expect((modelsField() as HTMLInputElement).value).toBe('')
    expect(screen.getByText(/تغيّر البروتوكول/)).not.toBeNull()
  })
})

/* ========================================================================== *
 *  10) «جلب النماذج» لا يمحو ما كتبه المستخدم
 * ========================================================================== */

describe('جلب النماذج — دمج لا استبدال', () => {
  it('النماذج المكتوبة يدويًا تبقى بعد الجلب، ويظهر الفرق', async () => {
    const stub = installStub({ fetchModels: { ok: true, models: ['fetched-1', 'fetched-2'] } })
    renderScreen()
    fillForm('typed-by-hand')
    fireEvent.keyDown(modelsField(), { key: 'Enter' })
    expect(screen.getByText('typed-by-hand')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /جلب النماذج/ }))
    await waitFor(() => {
      expect(stub.fetchModels).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText('fetched-1')).not.toBeNull()
    })
    for (const id of ['typed-by-hand', 'fetched-1', 'fetched-2']) {
      expect(screen.getByText(id)).not.toBeNull()
    }
    const notice = screen.getByRole('status').textContent ?? ''
    expect(notice).toContain('أُضيف')
    expect(notice).toContain('لم يُحذف شيء')
  })

  it('لا تكرار: النموذج المكتوب يدويًا والمُجلب مرة واحدة فقط', async () => {
    installStub({ fetchModels: { ok: true, models: ['shared-model', 'only-fetched'] } })
    renderScreen()
    fillForm('shared-model')
    fireEvent.keyDown(modelsField(), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /جلب النماذج/ }))
    await waitFor(() => {
      expect(screen.getByText('only-fetched')).not.toBeNull()
    })
    expect(screen.getAllByText('shared-model')).toHaveLength(1)
  })
})

/* ========================================================================== *
 *  11) الرابط المُطبَّع يُعرض قبل الحفظ
 * ========================================================================== */

describe('الرابط المُطبَّع قبل الحفظ', () => {
  it('«api.example.com» يُعرض محوَّلًا إلى جذر /v1 قبل أي حفظ', () => {
    renderScreen()
    fireEvent.change(urlField(), { target: { value: 'api.example.com' } })
    expect(screen.getByText('سيُحفظ الرابط باسم')).not.toBeNull()
    // المهمّ أنه ظهر في تنبيه التطبيع (قبل الحفظ)
    expect(screen.getAllByText('https://api.example.com/v1').length).toBeGreaterThan(0)
  })

  it('«.../v1/chat/completions» يُعرض مقصوصًا إلى جذره', () => {
    renderScreen()
    fireEvent.change(urlField(), { target: { value: 'https://zen.example/api/v1/chat/completions' } })
    expect(screen.getByText('https://zen.example/api/v1')).not.toBeNull()
  })

  it('سلسلة الاستعلام تُعرض منفصلةً لأنها ستُنزع من العنوان', () => {
    renderScreen()
    fireEvent.change(urlField(), { target: { value: 'https://my.azure.com?api-version=2024-06-01' } })
    expect(screen.getByText('https://my.azure.com/v1')).not.toBeNull()
    expect(screen.getByText('api-version=2024-06-01')).not.toBeNull()
  })

  it('رابط مطابق تمامًا لا يعرض تنبيهًا بلا فائدة', () => {
    renderScreen()
    fireEvent.change(urlField(), { target: { value: 'https://api.example.com/v1' } })
    expect(screen.queryByText('سيُحفظ الرابط باسم')).toBeNull()
  })
})

/* ========================================================================== *
 *  12) حالة المزوّد المحفوظ — بيانات كانت مخزَّنة بلا عرض
 * ========================================================================== */

describe('صفّ المزوّد المحفوظ', () => {
  const renderWith = (p: ProviderPublic): void => {
    render(
      <ProvidersScreen providers={[p]} onChanged={vi.fn() as (n: ProviderPublic[]) => void} onClose={vi.fn()} />,
    )
  }

  it('حالة المفتاح تُعرض: hasKey كان مخزَّنًا بلا استعمال', () => {
    renderWith(makeProvider({ hasKey: true }))
    expect(screen.getByText('مفتاح محفوظ')).not.toBeNull()
    cleanup()
    renderWith(makeProvider({ hasKey: false, keyMask: '—' }))
    expect(screen.getByText('بلا مفتاح')).not.toBeNull()
  })

  it('lastTestedAt يُعرضRelative لا يُترك بلا تاريخ', () => {
    renderWith(makeProvider({ lastTestOk: true, lastLatencyMs: 240, lastTestedAt: Date.now() - 5 * 60_000 }))
    expect(screen.getByText(/قبل 5 دقائق/)).not.toBeNull()
    expect(screen.getByText(/240 مللي ثانية/)).not.toBeNull()
  })

  it('لم يُختبر بعد حالة مستقلة عن الفشل', () => {
    renderWith(makeProvider())
    expect(screen.getByText('لم يُختبر بعد')).not.toBeNull()
  })

  it('الجمع العربي صحيح: مفرد ومثنى وجمع قلّة وتمييز مفرد', () => {
    renderWith(makeProvider({ models: ['only-one'] }))
    expect(screen.getByText('نموذج واحد')).not.toBeNull()
    cleanup()
    renderWith(makeProvider({ models: ['a', 'b'] }))
    expect(screen.getByText('نموذجان')).not.toBeNull()
    cleanup()
    renderWith(makeProvider({ models: ['a', 'b', 'c', 'd', 'e'] }))
    expect(screen.getByText('5 نماذج')).not.toBeNull()
    cleanup()
    renderWith(makeProvider({ models: Array.from({ length: 15 }, (_, i) => `m${i}`) }))
    expect(screen.getByText('15 نموذجًا')).not.toBeNull()
  })

  it('الرابط داخل `<bdi>` فلا يعيد ترتيب النصّ العربي في جواره', () => {
    renderWith(makeProvider())
    const bdi = Array.from(document.querySelectorAll('bdi')).find((node) =>
      (node.textContent ?? '').includes('api.example.com'),
    )
    expect(bdi?.getAttribute('dir')).toBe('ltr')
  })

  it('صنف «لا يوجد مزوّد بعد» يميّزه عن الفشل في القراءة', () => {
    const stub = installStub({ list: [] })
    stub.list.mockRejectedValue(new Error('القرص ممتلئ'))
    render(<ProvidersScreen providers={[]} onChanged={vi.fn() as (n: ProviderPublic[]) => void} onClose={vi.fn()} />)
    // قبل وصول الرفض: حالة التحميل، لا صندوق فارغ
    expect(screen.getByText(/جارٍ قراءة المزوّدات المحفوظة/)).not.toBeNull()
    return waitFor(() => {
      expect(screen.getByText('تعذّر قراءة المزوّدات المحفوظة')).not.toBeNull()
      expect(screen.getByRole('button', { name: /أعد القراءة/ })).not.toBeNull()
    })
  })

  it('بلا مزوّدات: حالة فارغة موحّدة لا صندوق مختلف الشكل', () => {
    installStub({ list: [] })
    render(<ProvidersScreen providers={[]} onChanged={vi.fn() as (n: ProviderPublic[]) => void} onClose={vi.fn()} />)
    return waitFor(() => {
      expect(screen.getByText('لا يوجد مزوّد محفوظ بعد')).not.toBeNull()
    })
  })
})

/* ========================================================================== *
 *  13) عزل العمليات — زرّ واحد مشغول لا يعطّل الشاشة
 * ========================================================================== */

describe('عزل حالة الانشغال', () => {
  it('اختبار مزوّد محفوظ يجمّد صفّه فقط لا أزرار الشاشة الأخرى', async () => {
    const stub = installStub()
    stub.testSaved.mockImplementation(() => new Promise(() => undefined))
    render(
      <ProvidersScreen providers={[makeProvider()]} onChanged={vi.fn() as (n: ProviderPublic[]) => void} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^اختبار$/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^اختبار$/ }).hasAttribute('disabled')).toBe(true)
    })
    // زرّ «حفظ المزوّد» في النموذج ما زال متاحًا — لا `busy` عالمي
    fillForm()
    expect((screen.getByRole('button', { name: /حفظ المزوّد/ }) as HTMLButtonElement).disabled).toBe(false)
    // صفّ الاختبار يبني مؤشّره الخاص
    expect(document.body.textContent).toContain('جارٍ اختبار')
  })
})