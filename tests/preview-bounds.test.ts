import { describe, expect, it } from 'vitest'
import {
  MAX_CONSOLE_ISSUES,
  MIN_VISIBLE_EDGE,
  clampToContent,
  keepNewest,
  readRect,
  readSeq,
  resolveBounds,
  sameResolution,
  shouldIgnore,
} from '../src/main/preview/bounds'
import { PreviewController } from '../src/main/preview/controller'

/** حاوية مساحة العمل في نافذة 1520x940. */
const CONTAINER = { x: 300, y: 120, width: 1200, height: 780 }

/** سياق فارغ: لا نوافذ لبثّ الأحداث إليها. */
function ctxStub(): { browserWindows: () => never[] } {
  return { browserWindows: () => [] }
}

function rect(res: ReturnType<typeof resolveBounds>): { x: number; y: number; width: number; height: number } {
  if (!res.visible) throw new Error(`expected a visible rect, got ${res.reason}`)
  return res.rect
}

describe('resolveBounds - المصدر الوحيد لموضع الـ view', () => {
  it('يضع الـ view على حدود الحاوية كما أرسلتها الواجهة', () => {
    expect(rect(resolveBounds(CONTAINER, null))).toEqual({ x: 300, y: 120, width: 1200, height: 780 })
  })

  it('لا يخمّن شيئًا حين لا توجد حاوية', () => {
    expect(resolveBounds(null, null)).toEqual({ visible: false, reason: 'no-container' })
  })

  it('يرفض الحاويات المشوّهة بدل رسم أرقام', () => {
    expect(resolveBounds({ x: 0, y: 0, width: NaN, height: 400 }, null).visible).toBe(false)
    expect(resolveBounds({ x: 0, y: 0, width: 400, height: Infinity }, null).visible).toBe(false)
    // إحداثي مشوّه ⇒ لا حاوية صالحة إطلاقًا
    expect(resolveBounds({ x: NaN, y: 0, width: 400, height: 400 }, null)).toEqual({
      visible: false,
      reason: 'no-container',
    })
    expect(resolveBounds(null, null).visible).toBe(false)
  })

  it('مستطيل متناقص (<10x10) يُخفي الـ view ولا يُنتج مربّعًا 50x50', () => {
    const cases = [
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 0, y: 0, width: 9, height: 900 },
      { x: 0, y: 0, width: 900, height: 9 },
      { x: 300, y: 120, width: 1, height: 1 },
    ]
    for (const rect of cases) {
      const r = resolveBounds(rect, null)
      expect(r.visible).toBe(false)
      if (r.visible) throw new Error(`unexpectedly visible: ${JSON.stringify(r)}`)
      expect(r.reason).toBe('degenerate')
    }
    // ولا حتى مع محاكاة جهاز: يبقى مخفيًا
    expect(resolveBounds({ x: 0, y: 0, width: 5, height: 5 }, { width: 390, height: 844 }).visible).toBe(false)
  })

  it('يقبل الحدّ الأدنى بالضبط (10x10) فهو مقاس حقيقي لا خطأ', () => {
    expect(rect(resolveBounds({ x: 5, y: 5, width: MIN_VISIBLE_EDGE, height: MIN_VISIBLE_EDGE }, null))).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 10,
    })
  })

  it('يقرّب الإحداثيات السالبة إلى الصفر فلا يخرج الـ view عن النافذة', () => {
    const r = rect(resolveBounds({ x: -40, y: -12, width: 200, height: 300 }, null))
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })
})

describe('resolveBounds - محاكاة الجهاز', () => {
  const PHONE = { width: 390, height: 844 }

  it('يوسّط الجهاز أفقيًا ويلصقه بأعلى الحاوية', () => {
    expect(rect(resolveBounds(CONTAINER, PHONE))).toEqual({
      x: 300 + (1200 - 390) / 2,
      y: 120,
      width: 390,
      height: 780,
    })
  })

  it('تنجو المحاكاة من تصغير الحاوية وتبقى داخلها', () => {
    const first = resolveBounds(CONTAINER, PHONE)
    expect(first.visible).toBe(true)

    const shrunk = { x: 300, y: 120, width: 420, height: 500 }
    const second = rect(resolveBounds(shrunk, PHONE))

    // المحاكاة باقية: لم نرجع إلى مستطيل الحاوية كاملًا
    expect(second.width).toBe(390)
    expect(second.height).toBe(500)
    // وداخل الحاوية الجديدة تمامًا
    expect(second.x).toBeGreaterThanOrEqual(shrunk.x)
    expect(second.y).toBeGreaterThanOrEqual(shrunk.y)
    expect(second.x + second.width).toBeLessThanOrEqual(shrunk.x + shrunk.width)
    expect(second.y + second.height).toBeLessThanOrEqual(shrunk.y + shrunk.height)
  })

  it('يقلّص الجهاز إذا كانت الحاوية أصغر منه ولا يفيض خارجها', () => {
    const tiny = { x: 40, y: 60, width: 200, height: 200 }
    expect(rect(resolveBounds(tiny, PHONE))).toEqual({ x: 40, y: 60, width: 200, height: 200 })
  })

  it('محاكاة بلا معنى (أصغر من الحد) تُهمَل وتُعرض الحاوية', () => {
    expect(rect(resolveBounds(CONTAINER, { width: 4, height: 4 }))).toEqual(CONTAINER)
  })

  it('رفض المحاكاة يعيد الحاوية كما هي', () => {
    expect(rect(resolveBounds(CONTAINER, null))).toEqual(CONTAINER)
    expect(rect(resolveBounds(CONTAINER, null))).not.toEqual(rect(resolveBounds(CONTAINER, PHONE)))
  })
})

describe('clampToContent - إعادة تطبيق الحدود بعد تغيير مقاس النافذة', () => {
  const clip = { width: 900, height: 600 }

  it('يقصّ حدودًا فاتت إطار المحتوى', () => {
    const clipped = clampToContent(CONTAINER, clip)
    expect(clipped).toEqual({ x: 300, y: 120, width: 600, height: 480 })
    const r = rect(resolveBounds(clipped, null))
    expect(r.x + r.width).toBeLessThanOrEqual(clip.width)
    expect(r.y + r.height).toBeLessThanOrEqual(clip.height)
  })

  it('حاوية خرجت عن الإطار أفقيًا تصبح صفرية العرض ثم مخفية', () => {
    const clipped = clampToContent({ x: 5000, y: 100, width: 300, height: 300 }, clip)
    // العرض يختفي (الموضع خارج الإطار) والارتفاع يبقى: النتيجة متناقضة ⇒ مخفية
    expect(clipped).toEqual({ x: 5000, y: 100, width: 0, height: 300 })
    expect(resolveBounds(clipped, null).visible).toBe(false)
  })

  it('يمرّر المستطيل كما هو بلا مقاس محتوى', () => {
    expect(clampToContent(CONTAINER, null)).toEqual(CONTAINER)
    expect(clampToContent(null, clip)).toBeNull()
  })
})

describe('shouldIgnore - ترتيب الرسائل غير المتزامنة', () => {
  it('يتجاهل الرسالة ذات التسلسل القديم', () => {
    expect(shouldIgnore(7, 12)).toBe(true)
  })

  it('يقبل الرسالة الجديدة، والتساوي أيضًا (إعادة إرسال نفس الإحداثيات)', () => {
    expect(shouldIgnore(13, 12)).toBe(false)
    expect(shouldIgnore(12, 12)).toBe(false)
  })

  it('بلا تسلسل لا يُرفض شيء: توافق كامل مع الشكل القديم', () => {
    expect(shouldIgnore(undefined, 12)).toBe(false)
    expect(shouldIgnore(null, 12)).toBe(false)
    expect(shouldIgnore(3, undefined)).toBe(false)
    expect(shouldIgnore(undefined, undefined)).toBe(false)
    expect(shouldIgnore(NaN, 12)).toBe(false)
  })

  it('readSeq يقرأ الأرقام فقط', () => {
    expect(readSeq(4)).toBe(4)
    expect(readSeq('4')).toBeUndefined()
    expect(readSeq(undefined)).toBeUndefined()
    expect(readSeq(Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe('readRect', () => {
  it('يقبل السالب والكسر ويرفض ما ليس رقمًا', () => {
    expect(readRect({ x: -5, y: 1.4, width: 10, height: 10 })).toEqual({ x: -5, y: 1.4, width: 10, height: 10 })
    expect(readRect({ x: 0, y: 0, width: '10' as unknown as number, height: 10 })).toBeNull()
    expect(readRect(undefined)).toBeNull()
  })
})

describe('sameResolution / keepNewest', () => {
  it('sameResolution يميّز تغيّر الموضع لا تغيّر الحجم وحده', () => {
    const a = resolveBounds(CONTAINER, null)
    const moved = resolveBounds({ ...CONTAINER, y: 400 }, null)
    const sameSizeNewTop = resolveBounds({ ...CONTAINER, y: 400 }, null)
    expect(sameResolution(a, moved)).toBe(false)
    expect(sameResolution(a, sameSizeNewTop)).toBe(false)
    expect(sameResolution(a, resolveBounds(CONTAINER, null))).toBe(true)
    expect(sameResolution(a, { visible: false, reason: 'degenerate' })).toBe(false)
    expect(sameResolution(a, { visible: false, reason: 'no-container' })).toBe(false)
  })

  it('keepNewest يحتفظ بالأحدث ويعيد نسخة', () => {
    const items = [1, 2, 3, 4, 5]
    expect(keepNewest(items, 3)).toEqual([3, 4, 5])
    expect(keepNewest(items, 9)).toEqual(items)
    expect(keepNewest(items, 9)).not.toBe(items)
    expect(keepNewest(items, 0)).toEqual([])
  })
})

describe('PreviewController - قبل preview:open لا view ولا مستطيل غريب', () => {
  it('attach بلا رابط لا ينشئ view ولا يلمس Electron', () => {
    const preview = new PreviewController(ctxStub() as never)
    const win = {
      isDestroyed: () => false,
      contentView: {
        addChildView: () => {
          throw new Error('must not mount before a URL exists')
        },
      },
    }
    preview.attach(win as never, CONTAINER)
    expect(preview.hasView()).toBe(false)
    expect(preview.currentUrl()).toBeNull()
  })

  it('applyBounds بلا view لا يرمي ولا ينشئ شيئًا', () => {
    const preview = new PreviewController(ctxStub() as never)
    expect(() => preview.applyBounds(CONTAINER)).not.toThrow()
    expect(preview.hasView()).toBe(false)
  })

  it('open برابط صالح بلا نافذة: يُحفظ العنوان ويبقى بلا view', async () => {
    const preview = new PreviewController(ctxStub() as never)
    expect(await preview.open('http://127.0.0.1:5173/')).toEqual({ ok: true, url: 'http://127.0.0.1:5173/' })
    expect(preview.currentUrl()).toBe('http://127.0.0.1:5173/')
    expect(preview.hasView()).toBe(false)
  })

  it('open يرفض البروتوكولات الممنوعة قبل أي أثر', async () => {
    const preview = new PreviewController(ctxStub() as never)
    expect(await preview.open('javascript:alert(1)')).toEqual({ ok: false, url: 'javascript:alert(1)' })
    expect(await preview.open('data:text/html,<h1>x</h1>')).toEqual({ ok: false, url: 'data:text/html,<h1>x</h1>' })
    expect(await preview.open('ليس رابطًا')).toEqual({ ok: false, url: 'ليس رابطًا' })
    expect(preview.currentUrl()).toBeNull()
    expect(preview.hasView()).toBe(false)
  })

  it('close وdetach آمنة قبل أي تشغيل', () => {
    const preview = new PreviewController(ctxStub() as never)
    expect(() => preview.close()).not.toThrow()
    expect(preview.hasView()).toBe(false)
    expect(preview.consoleErrors()).toEqual([])
  })

  it('أدوات الوكيل ترفض العمل بلا view بدل نتيجة غامضة', async () => {
    const preview = new PreviewController(ctxStub() as never)
    expect((await preview.screenshot()).ok).toBe(false)
    expect((await preview.evaluate('1+1')).ok).toBe(false)
    expect((await preview.click('button')).ok).toBe(false)
    expect((await preview.typeText('input', 'x')).ok).toBe(false)
    expect(await preview.reload()).toBe(false)
  })

  it('onHostResize بلا view لا يخمّن مستطيل النافذة كاملة', () => {
    const preview = new PreviewController(ctxStub() as never)
    const win = {
      isDestroyed: () => false,
      getContentSize: () => [1520, 940],
      contentView: {
        addChildView: () => {
          throw new Error('must not mount before a URL exists')
        },
      },
    }
    preview.attach(win as never, CONTAINER)
    expect(() => preview.onHostResize()).not.toThrow()
    expect(preview.hasView()).toBe(false)
  })

  it('setViewport بلا view لا يرمي', () => {
    const preview = new PreviewController(ctxStub() as never)
    expect(() => preview.setViewport({ width: 390, height: 844 })).not.toThrow()
    expect(() => preview.setViewport(null)).not.toThrow()
  })
})

describe('PreviewController - سجلّ الكونسول', () => {
  interface Log {
    level: string
    text: string
    marker?: string
    at: number
  }

  it('لا يعيد إلا الأحدث ضمن حدّ ثابت', () => {
    const preview = new PreviewController(ctxStub() as never)
    const logs = (preview as unknown as { state: { logs: Log[] } }).state.logs
    for (let i = 0; i < MAX_CONSOLE_ISSUES + 50; i += 1) {
      logs.push({ level: 'error', text: `e${i}`, at: i })
    }
    const issues = preview.consoleErrors()
    expect(issues.length).toBe(MAX_CONSOLE_ISSUES)
    expect(issues[0]?.text).toBe('e50')
    expect(issues[issues.length - 1]?.text).toBe(`e${MAX_CONSOLE_ISSUES + 49}`)
  })

  it('يحافظ على المستوى: التحذير لا يُسطَّح إلى خطأ', () => {
    const preview = new PreviewController(ctxStub() as never)
    const logs = (preview as unknown as { state: { logs: Log[] } }).state.logs
    logs.push({ level: 'warn', text: 'w', at: 1 }, { level: 'error', text: 'e', at: 2 })
    expect(preview.consoleErrors()).toEqual([
      { level: 'warn', text: 'w', line: undefined },
      { level: 'error', text: 'e', line: undefined },
    ])
  })

  it('إعادة التحميل تضع فاصلًا ولا تمحو الدليل السابق', () => {
    const preview = new PreviewController(ctxStub() as never)
    const logs = (preview as unknown as { state: { logs: Log[] } }).state.logs
    logs.push({ level: 'error', text: 'خطأ قبل التحديث', at: 1 })
    ;(preview as unknown as { markBoundary: (r: string) => void }).markBoundary('إعادة تحميل المعاينة')
    expect(preview.consoleErrors().map((i) => i.text)).toEqual(['خطأ قبل التحديث', 'إعادة تحميل المعاينة'])
  })
})