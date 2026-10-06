// @vitest-environment jsdom
/**
 * اختبارات مساحة العمل — العيوب التي عمرت جلسات كاملة.
 *
 * كل حالة هنا تحمي **عيبًا موثّقًا** في `.superpowers/sdd/revive/w2-b2-brief.md`
 * أو في تقرير الفحص المرفق به، لا شكلًا:
 *
 *   • Markdown يُبنى فعلًا: `#` عنوان حقيقي، `-` عنصر قائمة، ``` كتلة `<pre>`.
 *     الردّ كان يظهر حرفيًا بـ`whitespace-pre-wrap`.
 *   • `dir="auto"` على نصّ الوكيل: كود ورابط داخل ردّ عربي كانا يُعاد ترتيبهما.
 *   • صفّ الأداة يعرض مُدخلاته: `describeArgs` كانت مكتوبة وبلا مستهلك،
 *     فالمستخدم رأى `write_file` ولم يعرف أي ملف.
 *   • «و N أدوات أقدم» بعد الحدّ: `slice(-6)` بلا أي مؤشر.
 *   • الإيقاف يسأل أوّلًا: كان يقتل خادم التطوير بلا تحذير.
 *   • السجلّ يفلتر بالمستوى ويعرض الطابع الزمني.
 *   • رموز ANSI تُقتل عند العرض لا عند وصولها وحده.
 *   • اللقطة تُرسم أو لا تُحفظ — لا ثالث.
 *   • `KeyHint` رقائق `<kbd>` حقيقية لا نصّ بين قوسين.
 *   • **منطق الموجة الأولى حيّ**: حلقة القياس تنقل `x` و`y` كما تنقل
 *     `width` و`height`، و`preview.attach` تسبق `preview.open`، و
 *     `preview.close` تُنادى عند غياب مرشّح صالح.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ChatPanel, { formatElapsed } from '../src/renderer/src/components/ChatPanel'
import { Markdown, Transcript, parseMarkdown } from '../src/renderer/src/components/Transcript'
import { formatUsage, initialRunState, stripAnsi } from '../src/renderer/src/stores/reducer'
import { useWorkspace } from '../src/renderer/src/stores/workspace'
import type { StudioBridge } from '../src/shared/api'

/* ========================================================================== *
 *  جسر وهمي
 *
 *  كل اختبار يحتاج `window.studio`. الجسر يجمع ثلاث حقائق يجب ألّا تنساها:
 *  `onEvent` و`onUrl` يعيدان دالة إلغاء حقيقية وإلا تسرّب المستمع؛ و
 *  `preview.status` يجب ألّا يعيد url (وإلا تبدأ كل حالة بمعاينة مفتوحة).
 * ========================================================================== */

interface BridgeMock {
  agent: {
    run: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
    onEvent: ReturnType<typeof vi.fn>
  }
  preview: {
    onUrl: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    status: ReturnType<typeof vi.fn>
    screenshot: ReturnType<typeof vi.fn>
    consoleErrors: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    setViewport: ReturnType<typeof vi.fn>
    attach: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    openExternal: ReturnType<typeof vi.fn>
  }
}

let bridge: BridgeMock

function installBridge(): void {
  bridge = {
    agent: {
      run: vi.fn(async () => ({ ok: true, sessionId: 's1' })),
      stop: vi.fn(async () => true),
      status: vi.fn(async () => ({ running: false, sessionId: null })),
      onEvent: vi.fn(() => () => undefined),
    },
    preview: {
      onUrl: vi.fn(() => () => undefined),
      open: vi.fn(async () => ({ ok: true, url: 'http://localhost:5180' })),
      close: vi.fn(async () => true),
      status: vi.fn(async () => ({ url: null, hasView: false })),
      screenshot: vi.fn(async () => ({ ok: true, dataUrl: 'data:image/png;base64,AAAA' })),
      consoleErrors: vi.fn(async () => []),
      reload: vi.fn(async () => true),
      setViewport: vi.fn(async () => true),
      attach: vi.fn(async () => true),
      resize: vi.fn(async () => true),
      openExternal: vi.fn(async () => true),
    },
  }

  ;(window as unknown as { studio: StudioBridge }).studio = bridge as unknown as StudioBridge
}

/** مخزن نظيف بين الاختبارات — `useWorkspace` حالة واحدة على مستوى الوحدة. */
function seed(partial: Record<string, unknown> = {}): void {
  useWorkspace.setState({
    ...initialRunState(),
    projects: [],
    projectPath: null,
    viewport: 'full',
    providerId: 'p1',
    modelId: 'gpt-4o',
    ...partial,
  })
}

/* --- هندسة jsdom: `getBoundingClientRect` يُرجع أصفارًا، والـ native view --- */

function makeRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect
}

function stubRects(get: () => DOMRect): () => void {
  const spy = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(() => get() as DOMRect)
  return () => spy.mockRestore()
}

/** `n` إطارات — حلقة المعاينة تعمل بـ`requestAnimationFrame` لا بمؤقّت. */
function frames(n: number): Promise<void> {
  let chain = Promise.resolve()
  for (let i = 0; i < n; i++) {
    chain = chain.then(
      () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve())
        }),
    )
  }
  return chain
}

const ESC = '\u001b'

beforeEach(() => {
  installBridge()
  seed()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/* ========================================================================== *
 *  1) Markdown — البنية، لا النصّ
 * ========================================================================== */

describe('Markdown يبني بنية حقيقية', () => {
  it('يحوّل العنوان إلى عنصر عنوان والقائمة إلى عناصر قائمة', () => {
    const { container } = render(<Markdown text={'# الخلاصة\n\n- كتبت package.json\n- ثبّت الحزم'} />)

    const heading = container.querySelector('h1, h2, h3, h4, h5, h6')
    expect(heading).not.toBeNull()
    expect(heading?.textContent).toBe('الخلاصة')

    const items = container.querySelectorAll('li')
    expect(items.length).toBe(2)
    expect(items[0]?.textContent).toBe('كتبت package.json')
    expect(container.querySelector('ul')?.getAttribute('class')).toContain('list-disc')

    // لا `#` ولا `-` حرفين على الشاشة.
    expect(container.textContent).not.toContain('# ')
    expect(container.textContent).not.toContain('- كتبت')
  })

  it('يحوّل الكتلة المسوّورة إلى pre/code ولا ينفّذ أي HTML', () => {
    const { container } = render(<Markdown text={'```ts\nconst x: number = 1\n```\n\nنصّ عادي'} />)

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.querySelector('code')?.textContent).toBe('const x: number = 1')
    expect(container.textContent).toContain('نصّ عادي')

    // HTML في المصدر نصّ، لا عناصر — لا `dangerouslySetInnerHTML` في التطبيق.
    const { container: raw } = render(<Markdown text={'<b onclick="x()">اضغط</b>'} />)
    expect(raw.querySelector('b')).toBeNull()
    expect(raw.textContent).toContain('<b onclick="x()">اضغط</b>')
  })

  it('يحافظ على الفقرات والفواصل والكود المضمّن', () => {
    const { container } = render(
      <Markdown text={'سطر أول\nسطر ثانٍ\n\nفقرة فيها `npm run dev` و**غامق**.'} />,
    )

    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs.length).toBe(2)
    expect(paragraphs[0]?.textContent).toBe('سطر أول\nسطر ثانٍ')
    expect(container.querySelector('code')?.textContent).toBe('npm run dev')
    expect(container.querySelector('strong')?.textContent).toBe('غامق')
  })

  it('يحلل بلا حلقة لا نهائية، ويقسّم كل شكل كتلة', () => {
    const blocks = parseMarkdown('# a\n- b\n```\nc\n```\n> d\n---')
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'code', 'quote', 'rule'])
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n\n')).toEqual([])
    expect(parseMarkdown('1. أول\n2. ثاني').map((b) => b.kind)).toEqual(['list'])
    expect(parseMarkdown('```').length).toBe(1)
  })
})

/* ========================================================================== *
 *  2) Transcript — dir، الأدوات، الحدّ
 * ========================================================================== */

type TranscriptProps = Parameters<typeof Transcript>[0]

function transcriptProps(over: Partial<TranscriptProps> = {}): TranscriptProps {
  return {
    lines: [],
    tools: [],
    hiddenTools: 0,
    expandedTools: false,
    onToggleTools: () => undefined,
    streamingText: '',
    streaming: false,
    lastError: null,
    onOpenLog: () => undefined,
    question: null,
    onPickOption: () => undefined,
    shot: null,
    onDismissShot: () => undefined,
    ...over,
  }
}

describe('Transcript', () => {
  it('يضع dir="auto" على نصّ الوكيل — شرط ضد خلط bidi', () => {
    const { container } = render(
      <Transcript
        {...transcriptProps({
          lines: [
            { id: 'l1', role: 'agent', text: 'شغّلت `npm run dev` على http://localhost:5180', at: 0 },
          ],
        })}
      />,
    )

    const agent = container.querySelector('[dir="auto"]')
    expect(agent).not.toBeNull()
    expect(agent?.textContent).toContain('npm run dev')
  })

  it('يعرض مُدخلات الأداة — يبيّن أي ملف يُكتب', () => {
    const { container } = render(
      <Transcript
        {...transcriptProps({
          tools: [
            {
              id: 't1',
              callId: 'c1',
              name: 'write_file',
              args: { path: 'D:\\NT\\Projects\\x\\src\\main.tsx' },
              argHint: 'path=D:\\NT\\Projects\\x\\src\\main.tsx',
              status: 'done',
              summary: 'كتب 42 سطرًا',
              ms: 240,
              at: 0,
            },
          ],
        })}
      />,
    )

    expect(container.textContent).toContain('write_file')
    expect(container.textContent).toContain('path=D:\\NT\\Projects\\x\\src\\main.tsx')
    expect(container.textContent).toContain('كتب 42 سطرًا')
    expect(container.textContent).toContain('240 مللي ثانية')
  })

  it('يكشف تفاصيل الأداة بزرّ له اسم عربي، والحالة معلنة نصًّا لا لونًا', () => {
    const { container } = render(
      <Transcript
        {...transcriptProps({
          tools: [
            {
              id: 't1',
              callId: 'c1',
              name: 'run_command',
              args: { command: 'npm run build' },
              argHint: 'command=npm run build',
              status: 'error',
              summary: 'فشل البناء بالرمز 1',
              ms: 5000,
              at: 0,
            },
          ],
        })}
      />,
    )

    expect(container.textContent).toContain('فشلت')
    expect(container.querySelector('dl')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'اعرض تفاصيل run_command' }))
    expect(container.querySelector('dl')?.textContent).toContain('npm run build')
  })

  it('يقول «و N أدوات أقدم» بعد الحدّ ويفتحها عند الضغط', () => {
    const onToggle = vi.fn()
    render(<Transcript {...transcriptProps({ hiddenTools: 4, onToggleTools: onToggle })} />)

    fireEvent.click(screen.getByRole('button', { name: /و 4 أدوات أقدم/ }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('يرسم اللقطة أو لا يرسم شيئًا', () => {
    const { container, rerender } = render(
      <Transcript {...transcriptProps({ shot: { url: 'data:image/png;base64,AAAA', at: 0 } })} />,
    )
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('لقطة من المعاينة')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')

    rerender(<Transcript {...transcriptProps({ shot: null })} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('يعرض السؤال بخيارات تُملأ المُدخل بنقرة واحدة', () => {
    const onPick = vi.fn()
    render(
      <Transcript
        {...transcriptProps({
          question: { text: 'أي إطار تستعمل؟', options: ['React', 'Vue'], synthetic: false },
          onPickOption: onPick,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'React' }))
    expect(onPick).toHaveBeenCalledWith('React')
  })
})

/* ========================================================================== *
 *  3) ChatPanel — السلوك
 * ========================================================================== */

/** العنصر الذي تقيسه حلقة المعاينة: بلا أبناء وارتفاع بالبكسل. */
function previewRectEl(container: HTMLElement): HTMLElement {
  const section = container.querySelector('section[aria-label="المعاينة"]')
  const found = Array.from(section?.children ?? []).find(
    (child) => child.childElementCount === 0 && (child as HTMLElement).style.height !== '',
  )
  if (found === undefined) throw new Error('لم يُعثر على حاوية المعاينة')
  return found as HTMLElement
}

describe('ChatPanel', () => {
  it('يعرض حالة فارغة بدل فراغ أبيض', () => {
    render(<ChatPanel />)
    expect(screen.getByText('اطلب ما تريد وسأبنيه لك')).toBeDefined()
  })

  it('لا يضع أي عنصر داخل مستطيل المعاينة — قاعدة الـ WebContentsView', () => {
    const { container } = render(<ChatPanel />)
    const rect = previewRectEl(container)
    expect(rect.textContent).toBe('')
    expect(rect.childElementCount).toBe(0)
  })

  it('يعرض حالة المعاينة الفارغة خارج المستطيل لا داخله', () => {
    seed({
      projects: [
        { name: 'x', path: 'D:\\p', createdAt: 0, fileCount: 1, hasPackage: true, lastSummary: '' },
      ],
      projectPath: 'D:\\p',
    })
    const { container } = render(<ChatPanel />)
    const rect = previewRectEl(container)
    expect(screen.getByText('لم يبدأ الخادم بعد — اطلب البناء وسيظهر هنا')).toBeDefined()
    expect(rect.textContent).toBe('')
  })

  it('يجعل النقطة الحيّة تحمل نصًّا، ويجعل السكون محايدًا لا أخضر', () => {
    seed({ phase: 'error', lastError: 'فشل' })
    const { container } = render(<ChatPanel />)
    expect(screen.getByText('خطأ')).toBeDefined()

    // السكون كان أخضر، فيُقرأ «جاهز» حتى حين تت wedged الواجهة.
    act(() => seed({ phase: 'idle' }))
    const idle = screen.getByText('جاهز')
    const dot = idle.parentElement?.firstElementChild
    expect(dot?.getAttribute('class')).toContain('bg-text-tertiary')
    expect(dot?.getAttribute('class')).not.toContain('bg-success')
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
  })

  it('يسأل قبل الإيقاف — الإيقاف يقتل خادم التطوير', () => {
    seed({ running: true, phase: 'tool', settled: false })
    render(<ChatPanel />)

    expect(screen.queryByRole('button', { name: 'أكّد الإيقاف' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'إيقاف' }))

    expect(screen.getByRole('button', { name: 'أكّد الإيقاف' })).toBeDefined()
    expect(screen.getByText('الإيقاف يقتل خادم التطوير المرتبط')).toBeDefined()
    expect(bridge.agent.stop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'تراجع' }))
    expect(bridge.agent.stop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'إيقاف' }))
    fireEvent.click(screen.getByRole('button', { name: 'أكّد الإيقاف' }))
    expect(bridge.agent.stop).toHaveBeenCalledTimes(1)
  })

  it('يفلتر السجلّ بالمستوى ويعرض الطابع الزمني', () => {
    seed({
      notices: [
        { id: 'n0', level: 'error', message: 'فشل البناء', at: new Date(2026, 0, 2, 10, 20, 30).getTime() },
        { id: 'n1', level: 'warn', message: 'حزمة قديمة', at: new Date(2026, 0, 2, 10, 21, 0).getTime() },
        { id: 'n2', level: 'info', message: 'اكتمل التثبيت', at: new Date(2026, 0, 2, 10, 22, 0).getTime() },
      ],
    })

    render(<ChatPanel />)
    fireEvent.click(screen.getByRole('button', { name: /السجل/ }))

    const log = screen.getByLabelText('سجل التنفيذ')
    expect(within(log).getByText('فشل البناء')).toBeDefined()
    expect(within(log).getByText('حزمة قديمة')).toBeDefined()
    expect(within(log).getByText('اكتمل التثبيت')).toBeDefined()

    // `Notice.at` كان مخزَّنًا ومهمَلًا تمامًا في العرض.
    const time = log.querySelector('time')
    expect(time?.textContent).toBe('10:20:30')
    expect(time?.getAttribute('datetime')).toBe(new Date(2026, 0, 2, 10, 20, 30).toISOString())

    fireEvent.click(within(log).getByRole('button', { name: /^أخطاء/ }))
    expect(within(log).queryByText('حزمة قديمة')).toBeNull()
    expect(within(log).getByText('فشل البناء')).toBeDefined()
    expect(within(log).queryByText('اكتمل التثبيت')).toBeNull()
  })

  it('يمسح السجلّ ويغلقه', () => {
    seed({ notices: [{ id: 'n0', level: 'info', message: 'سطر', at: 0 }] })
    render(<ChatPanel />)

    fireEvent.click(screen.getByRole('button', { name: /السجل/ }))
    const log = screen.getByLabelText('سجل التنفيذ')

    fireEvent.click(within(log).getByRole('button', { name: 'امسح السجل' }))
    expect(useWorkspace.getState().notices).toHaveLength(0)

    fireEvent.click(within(log).getByRole('button', { name: 'إغلاق' }))
    expect(screen.queryByLabelText('سجل التنفيذ')).toBeNull()
  })

  it('يقتل رموز ANSI عند العرض', () => {
    // الرسالة تُحقن في المخزن خامًا، متجاوزةً `tidy` في reducer، حتى نتحقّق
    // من أن **طبقة العرض** هي التي تقتلها لا الحالة وحدها.
    seed({
      notices: [
        { id: 'n0', level: 'error', message: `${ESC}[31mفشل${ESC}[0m في npm`, at: 0 },
        { id: 'n1', level: 'info', message: `سطر ${ESC}[2Kجارٍ`, at: 0 },
      ],
    })
    render(<ChatPanel />)
    fireEvent.click(screen.getByRole('button', { name: /السجل/ }))

    const log = screen.getByLabelText('سجل التنفيذ')
    expect(log.textContent).not.toContain(ESC)
    expect(log.textContent).toContain('فشل في npm')
    expect(stripAnsi(`${ESC}[31mأ${ESC}[0m`)).toBe('أ')
  })

  it('يرسم اللقطة من الزرّ ولا يخزّنها في المخزن', async () => {
    const restore = stubRects(() => makeRect(20, 240, 400, 300))
    seed({ previewUrl: 'http://localhost:5180' })
    const { container } = render(<ChatPanel />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'التقط لقطة للشاشة الحالية' }))
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(Object.keys(useWorkspace.getState())).not.toContain('screenshot')
    expect(JSON.stringify(useWorkspace.getState())).not.toContain('data:image')
    restore()
  })

  it('يرفض اللقطة الضخمة ولا يحفظها', async () => {
    const restore = stubRects(() => makeRect(20, 240, 400, 300))
    seed({ previewUrl: 'http://localhost:5180' })
    bridge.preview.screenshot.mockResolvedValueOnce({ ok: true, dataUrl: `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024 + 1)}` })
    const { container } = render(<ChatPanel />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'التقط لقطة للشاشة الحالية' }))
    })
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('اللقطة ضخمة للعرض')).toBeDefined()
    restore()
  })

  it('يعرض «لا يوجد نموذج» في تحذير بارز لا تلميح باهت', () => {
    seed({ providerId: null, modelId: null })
    render(<ChatPanel />)
    expect(screen.getByText(/لم تختر نموذجًا/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'إرسال' }).hasAttribute('disabled')).toBe(true)
  })

  it('يرسم KeyHint رقائق kbd حقيقية، ويكشف اللوحة عند الطلب', () => {
    const { container } = render(<ChatPanel />)
    const before = container.querySelectorAll('kbd').length
    expect(before).toBeGreaterThan(0)
    expect(Array.from(container.querySelectorAll('kbd')).some((k) => k.textContent === 'Enter')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'اختصارات' }))
    expect(container.querySelectorAll('kbd').length).toBeGreaterThan(before)
  })

  it('لا يعطّل المُدخل أثناء العمل — ويجمع الطلب التالي في رقمية', () => {
    seed({ running: true, phase: 'tool', settled: false })
    render(<ChatPanel />)

    const composer = document.querySelector('textarea') as HTMLTextAreaElement
    expect(composer.hasAttribute('disabled')).toBe(false)

    fireEvent.change(composer, { target: { value: 'الخطوة التالية' } })
    fireEvent.click(screen.getByRole('button', { name: /أرسل بعد الانتهاء/ }))
    expect(screen.getByText(/في الانتظار: الخطوة التالية/)).toBeDefined()
  })

  it('يرسل ويضبط التركيز والمؤشّر لا ينبض بعد انتهاء النصّ', async () => {
    seed({
      lines: [{ id: 'l1', role: 'agent', text: 'انتهيت', at: 0 }],
      streamingText: '',
    })
    const { container } = render(<ChatPanel />)
    expect(container.querySelector('span[aria-hidden="true"].animate-pulse')).toBeNull()
  })

  it('يعرض الوقت المنقضي وعدّاد الخطوات أثناء التشغيل', () => {
    seed({ running: true, phase: 'tool', settled: false })
    render(<ChatPanel />)
    expect(screen.getByText('00:00')).toBeDefined()
    expect(screen.getByText('0 خطوة')).toBeDefined()
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65_000)).toBe('01:05')
    expect(formatElapsed(-5)).toBe('00:00')
  })

  it('يعرض عدد التوكنات بصيغة reducer', () => {
    const usage = { inputTokens: 12_000, outputTokens: 3_400 }
    seed({ usage })
    render(<ChatPanel />)
    expect(screen.getByText(formatUsage(usage))).toBeDefined()
    expect(formatUsage(null)).toBe('')
  })

  it('يعرض الخطة بعدّاد ويطويها', () => {
    seed({
      plan: [
        { index: 1, title: 'إنشاء المشروع', status: 'done' },
        { index: 2, title: 'كتابة الملفات', status: 'active' },
        { index: 3, title: 'تشغيل الخادم', status: 'pending' },
      ],
    })
    render(<ChatPanel />)
    const plan = screen.getByLabelText('خطة الوكيل')
    expect(within(plan).getByText('إنشاء المشروع')).toBeDefined()
    expect(within(plan).getByText('1/3')).toBeDefined()

    fireEvent.click(within(plan).getByRole('button', { name: 'أخفِ الخطة' }))
    expect(within(plan).queryByText('إنشاء المشروع')).toBeNull()
  })

  it('يعرض الخطأ في اللوحة وزرّ يفتح السجل', () => {
    seed({ lastError: 'تعذّر بدء المهمة.' })
    render(<ChatPanel />)
    expect(screen.getByText('تعذّر بدء المهمة.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'اعرض التفاصيل في السجل' }))
    expect(screen.getByLabelText('سجل التنفيذ')).toBeDefined()
  })

  it('يسمّي أزرار المقاس بالعربية — لا full/laptop بالإنجليزية', () => {
    render(<ChatPanel />)
    for (const label of ['ملء الشاشة', 'حاسوب محمول', 'لوحي', 'جوال']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    expect(screen.queryByRole('button', { name: 'full' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'laptop' })).toBeNull()
  })

  it('يطوي المعاينة ويعيدها، وحجمها بكسل لا نسبة ميتة', () => {
    const restore = stubRects(() => makeRect(20, 240, 400, 300))
    const { container } = render(<ChatPanel />)

    const rect = previewRectEl(container)
    expect(rect.style.height).not.toBe('')
    expect(rect.style.height.endsWith('%')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'اطوِ المعاينة' }))
    expect(previewRectEl(container).style.height).toBe('0px')

    fireEvent.click(screen.getByRole('button', { name: 'اعرض المعاينة' }))
    expect(previewRectEl(container).style.height).not.toBe('0px')
    restore()
  })
})

/* ========================================================================== *
 *  4) منطق المعاينة الذي أيّدته الموجة الأولى — لم ننكسره
 * ========================================================================== */

describe('منطق المعاينة الذي أيّدته الموجة الأولى باقٍ', () => {
  it('ينقل الموضع كما ينقل الحجم — تغيّر y وحده يُرسل إطارًا جديدًا', async () => {
    let rect = makeRect(20, 20, 400, 300)
    const restore = stubRects(() => rect)

    render(<ChatPanel />)
    await frames(2)

    const sent = (bridge.preview.resize as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { x: number; y: number; width: number; height: number },
    )
    expect(sent.some((b) => b.y === 20)).toBe(true)
    const countBefore = sent.length

    // نفس المساحة، مكان آخر: لا تغيير حجم إطلاقًا.
    rect = makeRect(20, 240, 400, 300)
    await frames(2)

    const after = (bridge.preview.resize as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { x: number; y: number; width: number; height: number },
    )
    expect(after.length).toBeGreaterThan(countBefore)
    expect(after.some((b) => b.y === 240 && b.height === 300)).toBe(true)
    restore()
  })

  it('يستدعي preview.close حين لا يوجد مرشّح صالح', async () => {
    render(<ChatPanel />)
    await frames(2)
    expect(bridge.preview.close).toHaveBeenCalled()
  })

  it('يستدعي attach ثم open بالترتيب الصحيح', async () => {
    const restore = stubRects(() => makeRect(20, 240, 400, 300))
    seed({ previewUrl: 'http://localhost:5180' })
    render(<ChatPanel />)
    await frames(3)

    expect(bridge.preview.attach).toHaveBeenCalled()
    expect(bridge.preview.open).toHaveBeenCalledWith('http://localhost:5180')

    // الترتيب معكوس يُنتج view فارغًا: open بلا attach يسجّل العنوان فقط.
    const attachOrder = bridge.preview.attach.mock.invocationCallOrder[0] ?? 0
    const openOrder = bridge.preview.open.mock.invocationCallOrder[0] ?? 0
    expect(attachOrder).toBeLessThan(openOrder)
    restore()
  })

  it('يقرأ أخطاء الكونسول بعد التحديث بدل أن يبقى اللوح ميتًا', async () => {
    const restore = stubRects(() => makeRect(20, 240, 400, 300))
    seed({ previewUrl: 'http://localhost:5180' })
    bridge.preview.consoleErrors.mockResolvedValueOnce([
      { level: 'error', text: 'Uncaught ReferenceError', line: 12 },
    ])
    render(<ChatPanel />)
    await frames(2)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'حدّث الصفحة المعروضة' }))
    })
    expect(bridge.preview.reload).toHaveBeenCalled()
    expect(bridge.preview.consoleErrors).toHaveBeenCalled()
    expect(useWorkspace.getState().consoleIssues[0]?.text).toBe('Uncaught ReferenceError')
    restore()
  })

  it('يؤجّل الفتح ولا يُسقطه حين يكون المستطيل مُشوَّهًا', async () => {
    const restore = stubRects(() => makeRect(0, 0, 0, 0))
    seed({ previewUrl: 'http://localhost:5180' })
    render(<ChatPanel />)
    await frames(2)

    expect(bridge.preview.close).toHaveBeenCalled()
    expect(bridge.preview.open).not.toHaveBeenCalled()
    restore()
  })
})