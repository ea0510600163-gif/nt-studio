// @vitest-environment jsdom
/**
 * اختبارات مكتبة الواجهة — سلوك حقيقي لا trivia.
 *
 * كل حالة هنا تحمي عيبًا مقيسًا أو قاعدة نظام، لا شكلًا:
 *   • `Button`: الحبر الداكن بدل `text-white`، و`loading` يكتم التسمية ويُعلن
 *     الانشغال، و`disabled` سِمة حقيقية لا `aria-disabled`
 *   • `IconButton`: `label` إلزامي → `aria-label`، فلا زرّ أيقونة بلا اسم
 *     (عيب `title={v}` الذي كان ينطق `full` بالإنجليزية)
 *   • `Field`: `htmlFor`/`id` و`aria-describedby` — يعالج حقل «النماذج» الذي
 *     بلا اسم في `ProvidersScreen.tsx:273-275`
 *   • `Input`: **لا `outline-none` أبدًا** — بقوته في طبقة `utilities` كان
 *     يبطل `:focus-visible` في كل حقل بالتطبيق
 *   • `Dialog`: حبس التركيز، Escape، `aria-modal` — لا تأكيد في التطبيق اليوم
 *     فحذف مزوّد ومفتاحه المشفّر نقرة واحدة غير راجعة
 *   • `Select`: ليس `<select>` أصليًا، ويُعلن `aria-expanded`، ويُنقّل بالأسهم
 *   • **دورة الإصلاح 1**: قيم `line`/`line-strong`/`text-muted`/`inset` كما حُكم
 *     عليها، ونسبها الحقيقية، وحدّ الحقول الذي كان 1.29:1 فصار 3.34:1
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useRef, useState, type JSX } from 'react'
import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  IconCheck,
  IconChevronRight,
  IconTrash,
  Input,
  KeyHint,
  Select,
  Spinner,
  StatusDot,
  Textarea,
  Toast,
  Tooltip,
  cx,
  type SelectOption,
} from '../src/renderer/src/components/ui'

afterEach(() => cleanup())

const noop = (): void => undefined

/* ========================================================================== *
 *  عقد الرموز — دورة الإصلاح 1
 *
 *  السلسلة كاملة: قيمة محكوم عليها (هنا) → ملف `theme.css` المُسلَّم (يُقرأ
 *  أدناه) → أصناف المكوّنات (في آخر القسم). كل حلقة تُفحص، فأي انزلاق في أي
 *  منها يُسقط اختبارًا.
 *
 *  لماذا لا نستورد `scripts/check-contrast.mjs`؟ لأنه `.mjs` خارج `include` في
 *  `tsconfig.json`، و`allowJs` مُطفأ فلا يُحلّ. ولأن تنفيذ نسبة داخل هذا
 *  الملف هو المطلوب أصلًا: لو استوردنا `ratio()` من السكربت لكان الاختبار
 *  يتحقّق من دالةٍ كتبناها بدل قيمةٍ حُكم عليها — تحقّق من circles.
 * ========================================================================== */

/**
 * `process.getBuiltinModule` موجودة في Node 22.3+ ولا تحتاج `@types/node`،
 * وهذا ما نريده: `tests/ui.test.tsx` يقع ضمن `tsconfig.json` (إعداد الواجهة)،
 * وإضافة `"node"` إلى `types` هناك كانت ستسمح لشيفرة الواجهة باستدعاء Node
 * عن طريق الخطأ — وهو ما يمنعه هذا المشروع أصلًا. الوصول عبر cast صريح من
 * `globalThis` يبقى محصورًا في هذا الملف.
 */
type NodeLike = { getBuiltinModule?: (id: string) => unknown }

const nodeFs = (
  (globalThis as { process?: NodeLike }).process?.getBuiltinModule?.('node:fs') as
    | { readFileSync: (p: string, e: string) => string }
    | undefined
)

/** يقرأ `theme.css` المُسلَّم كما هو، لا نسخة منه. */
const themeCss = nodeFs?.readFileSync('src/renderer/src/styles/theme.css', 'utf8') ?? ''

/** كل `--color-<name>: #hex` في الملف المُسلَّم. */
function cssTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/--(color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[(m[1] ?? '').replace(/^color-/, '')] = (m[2] ?? '').toLowerCase()
  }
  return out
}

/** سكربتات npm كما هي. */
function npmScripts(): Record<string, string> {
  const raw = nodeFs?.readFileSync('package.json', 'utf8') ?? '{}'
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> }
  return parsed.scripts ?? {}
}

/** تنفيذ مستقل لصيغة WCAG 2.x (نفس تعريف `scripts/check-contrast.mjs`). */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const chan = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * chan(parseInt(h.slice(0, 2), 16)) +
    0.7152 * chan(parseInt(h.slice(2, 4), 16)) +
    0.0722 * chan(parseInt(h.slice(4, 6), 16))
  )
}

const ratio = (a: string, b: string): number => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const TOK = cssTokens(themeCss)

/** القيم المحكوم عليها، مكتوبة حرفيًا ووصفًا للأمر. */
const RULED = {
  line: '#343a44',
  'line-strong': '#616a76',
  'line-hover': '#737d8a',
  'text-muted': '#8b95a6',
  inset: '#0d0f13',
} as const

/** الأسطح كما حُكم عليها: السُّلَّم الضيّق يبقى، والحدود تحمل الفصل. */
const SURF = {
  bg: '#08090b',
  'surface-1': '#12151a',
  'surface-2': '#1a1e25',
  'surface-3': '#232832',
} as const

const BOUNDARY_MIN = 3.0
const CARD_BORDER_MIN = 1.5
const TEXT_MIN = 4.5

describe('عقد الرموز — قيم مُسلَّمة', () => {
  it('theme.css قُرئ فعلًا، فليست هذه نسخة أو سلسلة فارغة', () => {
    expect(themeCss.length).toBeGreaterThan(5_000)
    expect(themeCss).toContain('@theme')
  })

  it('كل رمز محكوم عليه يُصرَّح بالقيمة المحكوم عليها', () => {
    for (const [name, hex] of Object.entries(RULED)) {
      expect(TOK[name], `--color-${name}`).toBe(hex)
    }
  })

  it('الأسطح لم تُحرَّك: الإصلاح على الحدود لا على التعبئة', () => {
    expect(TOK['bg']).toBe(SURF.bg)
    expect(TOK['surface-1']).toBe(SURF['surface-1'])
    expect(TOK['surface-2']).toBe(SURF['surface-2'])
    expect(TOK['surface-3']).toBe(SURF['surface-3'])
  })

  it('الأسماء القديمة تبقى مطابقة حرفيًا، فالشاشات غير المُرحَّلة تعمل', () => {
    const aliases: Array<[string, string]> = [
      ['app', 'bg'],
      ['panel', 'surface-1'],
      ['panel2', 'surface-2'],
      ['panel3', 'surface-3'],
      ['line2', 'line-strong'],
      ['main', 'text-primary'],
      ['dim', 'text-secondary'],
      ['mute', 'text-tertiary'],
      ['faint', 'text-muted'],
    ]
    for (const [legacy, target] of aliases) {
      expect(TOK[legacy], `--color-${legacy} must equal --color-${target}`).toBe(TOK[target])
    }
  })

  it('`@utility card` باقٍ — الشاشات الثلاث تستعمله اليوم', () => {
    expect(themeCss).toMatch(/@utility\s+card\s*\{/)
    expect(themeCss).toContain('var(--color-panel)')
    expect(themeCss).toContain('var(--radius-app)')
  })

  it('آلة حالات حدّ الحقل مُعرَّفة في theme.css لا مبعثرة في المكوّنات', () => {
    expect(themeCss).toMatch(/@utility\s+control-border\s*\{/)
    expect(themeCss).toContain('var(--color-line-strong)')
    expect(themeCss).toContain('var(--color-line-hover)')
    expect(themeCss).toContain('var(--color-accent)')
  })

  it('المقاييس كلها تُولَّد كأدوات، فلا اسم صامت', () => {
    for (const name of [
      'z-base',
      'z-raised',
      'z-sticky',
      'z-header',
      'z-dropdown',
      'z-overlay',
      'z-modal',
      'z-toast',
      'z-tooltip',
      'duration-fast',
      'duration-base',
      'duration-slow',
      'kbd',
      'focus-ring',
      'transition-ui',
      'control-border',
    ]) {
      expect(themeCss, `missing @utility ${name}`).toMatch(new RegExp(`@utility\\s+${name}\\s*\\{`))
    }
  })
})

describe('البوّابة مُوصولة بالخطّ — لا بوابة يدعوها أحد', () => {
  const scripts = npmScripts()

  it('السكربت يتبع اصطلاح check:encoding الموجود', () => {
    expect(scripts['check:encoding']).toBe('node scripts/check-encoding.mjs')
    expect(scripts['check:contrast']).toBe('node scripts/check-contrast.mjs')
  })

  it('كلٌّ من build وverify يشغّل البوّابة', () => {
    // A gate nobody invokes is documentation. `check-contrast.mjs` printed PASS
    // while input wells sat at 1.11:1 precisely because nothing ran it.
    for (const chain of ['build', 'verify']) {
      expect(scripts[chain], `${chain} must run check:contrast`).toContain('check:contrast')
    }
  })

  it('البوّابة تعمل قبل electron-vite build، فلا يصل انحدار إلى out/', () => {
    for (const chain of ['build', 'verify']) {
      const s = scripts[chain] ?? ''
      const atCheck = s.indexOf('check:contrast')
      const atBundle = s.indexOf('electron-vite build')
      expect(atCheck, `${chain} has no check:contrast`).toBeGreaterThanOrEqual(0)
      expect(atBundle, `${chain} has no electron-vite build`).toBeGreaterThanOrEqual(0)
      expect(atCheck, `${chain}: contrast must run BEFORE the bundle is written`).toBeLessThan(atBundle)
    }
  })

  it('فحص الترميز لم يُزح من أي سلسلة', () => {
    for (const chain of ['build', 'verify']) {
      expect(scripts[chain], `${chain}`).toContain('check:encoding')
    }
  })
})

describe('عقد الرموز — النسب الحقيقية محسوبة', () => {
  it('كل حدّ تفاعلي يجتاز 3:1 ضد تعبئته وضد كل سطح خلفه (WCAG 1.4.11)', () => {
    const boundaries: Array<[string, string[]]> = [
      [RULED['line-strong'], [RULED.inset, SURF.bg, SURF['surface-1'], SURF['surface-2']]],
      [RULED['line-hover'], [RULED.inset, SURF.bg, SURF['surface-1'], SURF['surface-2']]],
      [TOK['accent'] ?? '#4c8dff', [RULED.inset, SURF.bg, SURF['surface-1'], SURF['surface-2']]],
    ]
    for (const [fg, surfaces] of boundaries) {
      for (const bg of surfaces) {
        const r = ratio(fg, bg)
        expect(r, `${fg} on ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(BOUNDARY_MIN)
      }
    }
  })

  it('حدّ البطاقة الزخرفي يجتاز 1.5:1 ضد البطاقة التي يحدّدها', () => {
    expect(ratio(RULED.line, SURF['surface-1'])).toBeGreaterThanOrEqual(CARD_BORDER_MIN)
    expect(ratio(RULED.line, SURF.bg)).toBeGreaterThanOrEqual(CARD_BORDER_MIN)
  })

  it('كل دور نصّي يجتاز 4.5:1 على كل سطح، وضمنها surface-3 والبئر', () => {
    const roles = [
      TOK['text-primary'],
      TOK['text-secondary'],
      TOK['text-tertiary'],
      TOK['text-muted'],
      TOK['text-link'],
      TOK['accent'],
      TOK['success'],
      TOK['warn'],
      TOK['danger'],
    ] as string[]
    for (const fg of roles) {
      for (const bg of [SURF.bg, SURF['surface-1'], SURF['surface-2'], SURF['surface-3'], RULED.inset]) {
        const r = ratio(fg, bg)
        expect(r, `${fg} on ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_MIN)
      }
    }
  })

  it('`text-disabled` معفى من 4.5 (WCAG 1.4.3 للعناصر غير الفعّالة) ويبقى فوق 3', () => {
    const disabled = TOK['text-disabled'] ?? ''
    const muted = TOK['text-muted'] ?? ''
    for (const bg of [SURF.bg, SURF['surface-1'], SURF['surface-2'], SURF['surface-3']]) {
      const r = ratio(disabled, bg)
      expect(r, `disabled on ${bg}`).toBeGreaterThanOrEqual(3.0)
      // وإلا فُقدت الإشارة الوحيدة التي تقول «هذا معطّل».
      expect(r).toBeLessThan(ratio(muted, bg))
    }
  })

  it('الحدّ الزخرفي وحدّ الحقل مختلفان فعلًا، فلا يختلطان', () => {
    expect(TOK['line']).not.toBe(TOK['line-strong'])
    expect(TOK['line-strong']).not.toBe(TOK['line-hover'])
    expect(TOK['line-hover']).not.toBe(TOK['accent'])
  })
})

/* ------------------------------------------------------------------ Button */

describe('Button', () => {
  it('يرسم كل variant بصنف surface مختلف، ولا لواحد منهم text-white', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger', 'dangerSoft', 'link'] as const
    const seen = new Set<string>()

    for (const variant of variants) {
      const { unmount } = render(
        <Button variant={variant} onClick={noop}>
          زر
        </Button>,
      )
      const el = screen.getByRole('button', { name: 'زر' })
      const cls = el.className
      // The measured defect: white on #4c8dff is 3.20:1. Primary must use ink.
      expect(cls).not.toContain('text-white')
      seen.add(cls)
      unmount()
    }
    expect(seen.size).toBe(variants.length)
    expect(
      render(<Button variant="primary" onClick={noop} />).container.querySelector('button')?.className,
    ).toContain('text-ink-accent')
  })

  it('يفرّق كل حالة بصنف مختلف: hover وactive وdisabled وfocus', () => {
    const base = <Button onClick={noop}>إرسال</Button>
    const plain = render(base).container.querySelector('button')?.className ?? ''

    const hovered = render(<Button onClick={noop} className="hover:bg-accent-hover">إرسال</Button>)
      .container.querySelector('button')?.className
    expect(hovered).not.toBe(plain)

    const active = render(<Button onClick={noop} className="active:bg-accent-active">إرسال</Button>)
      .container.querySelector('button')?.className
    expect(active).not.toBe(plain)

    // focus-ring is the single class that carries the visible focus ring.
    expect(plain).toContain('focus-ring')
    expect(plain).not.toContain('outline-none')
  })

  it('disabled سِمة حقيقية: لا يقبل التركيز ويُعلن معطّلًا', () => {
    render(
      <Button disabled onClick={noop}>
        حفظ
      </Button>,
    )
    const el = screen.getByRole('button', { name: 'حفظ' }) as HTMLButtonElement
    expect(el.disabled).toBe(true)
    el.focus()
    expect(document.activeElement).not.toBe(el)
    expect(el.className).toContain('disabled:cursor-not-allowed')
  })

  it('loading يكتم التسمية المرئية ويُعلن الانشغال مع اسم متاح', () => {
    render(
      <Button loading onClick={noop}>
        حفظ المزوّد
      </Button>,
    )
    const el = screen.getByRole('button', { name: 'حفظ المزوّد' })
    expect(el.getAttribute('aria-busy')).toBe('true')
    expect((el as HTMLButtonElement).disabled).toBe(true)
    // The visual label is gone; the name survives as sr-only text.
    expect(el.querySelector('span.sr-only')?.textContent).toBe('حفظ المزوّد')
    expect(screen.getByRole('button', { name: 'حفظ المزوّد' })).toBe(el)
  })

  it('loadingLabel يتغلّب على النصّ الأصلي، والاسم مقروء', () => {
    render(
      <Button loading loadingLabel="جارٍ الحفظ…" onClick={noop}>
        حفظ
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'جارٍ الحفظ…' })).toBeTruthy()
  })

  it('يمرّر type="button" افتراضيًا حتى لا يُرسل نموذجًا يومًا', () => {
    render(<Button onClick={noop}>x</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
  })
})

/* -------------------------------------------------------------- IconButton */

describe('IconButton', () => {
  it('يصدّر label إلى aria-label ويخفي الأيقونة', () => {
    render(<IconButton icon={<IconTrash size={16} />} label="حذف المزوّد" onClick={noop} />)
    const el = screen.getByRole('button', { name: 'حذف المزوّد' })
    expect(el.getAttribute('aria-label')).toBe('حذف المزوّد')
    expect(el.querySelector('[aria-hidden="true"]')).not.toBeNull()
    // No title: the English enum leak came from title={v} being the only name.
    expect(el.getAttribute('title')).toBeNull()
  })

  it('الحدّ الأدنى 32×32 عبر رمز المساحة', () => {
    render(<IconButton icon={<IconTrash />} label="حذف" onClick={noop} size="sm" />)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('h-control-xs')
    expect(cls).toContain('w-control-xs')
  })

  it('active يرسم aria-pressed لمفتاح تبديل', () => {
    render(<IconButton icon={<IconCheck />} label="ملء الشاشة" active onClick={noop} />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })
})

/* ------------------------------------------------------------------ حدود الحقول
 * هذا هو العيب الذي عالجه cycle 1: الحدّ كان 1.29:1 فالو-well كان غير
 * مرئي. التحقّق أدناه هو الذي كان يجب أن يمسكه.
 * -------------------------------------------------------------------------- */

/** يقسّم `className` إلى رموز، لأن `border-line` جزء من `border-line-strong`. */
const tokensOf = (el: Element): string[] =>
  (el.getAttribute('class') ?? '').split(/\s+/).filter((s) => s.length > 0)

describe('حدود الحقول — الحدّ هو ما يعرّف الحقل', () => {
  it('Input يرسم حدّ الحقل التفاعلي لا الحدّ الزخرفي', () => {
    render(<Input placeholder="الاسم" />)
    const t = tokensOf(screen.getByPlaceholderText('الاسم'))
    expect(t).toContain('control-border')
    // The decorative 1.60:1 hairline must NOT be the field's own boundary.
    expect(t).not.toContain('border-line')
    expect(t).not.toContain('border-line-strong')
    expect(t).toContain('bg-inset')
  })

  it('Textarea يرسم حدّ الحقل التفاعلي لا الحدّ الزخرفي', () => {
    render(<Textarea placeholder="اكتب…" />)
    const t = tokensOf(screen.getByPlaceholderText('اكتب…'))
    expect(t).toContain('control-border')
    expect(t).not.toContain('border-line')
    expect(t).not.toContain('border-line-strong')
  })

  it('Select يرسم حدّ الحقل التفاعلي لا الحدّ الزخرفي', () => {
    render(<Select aria-label="البروتوكول" options={[]} value={null} onChange={noop} />)
    const t = tokensOf(screen.getByRole('combobox'))
    expect(t).toContain('control-border')
    expect(t).not.toContain('border-line')
    expect(t).not.toContain('border-line-strong')
  })

  it('لا حقل يعتمد على التعبئة وحدها لإبراز نفسه', () => {
    // The fill is 1.05:1 against the card — imperceptible by design. The border
    // is the affordance, so all three must carry control-border.
    expect(ratio(TOK['inset'] ?? '#0d0f13', SURF['surface-1'])).toBeLessThan(1.2)
    for (const [name, render_] of [
      ['Input', () => render(<Input placeholder="س" />)],
      ['Textarea', () => render(<Textarea placeholder="س" />)],
      ['Select', () => render(<Select aria-label="س" options={[]} value={null} onChange={noop} />)],
    ] as const) {
      const { unmount } = render_()
      const el =
        name === 'Input'
          ? screen.getByPlaceholderText('س')
          : name === 'Textarea'
            ? screen.getByPlaceholderText('س')
            : screen.getByRole('combobox')
      expect(tokensOf(el), name).toContain('control-border')
      unmount()
    }
  })

  it('آلة الحالات كلها في الصنف الواحد: لا hover:/focus: مبعثرة', () => {
    // `hover:border-x` and `focus:border-y` share specificity, so the winner
    // is stylesheet order. control-border owns all four states so that cannot
    // happen; a hand-rolled variant here would reintroduce it.
    for (const cls of [
      render(<Input placeholder="س" />).container.querySelector('input')?.className ?? '',
      render(<Textarea placeholder="س" />).container.querySelector('textarea')?.className ?? '',
      render(<Select aria-label="س" options={[]} value={null} onChange={noop} />).container.querySelector('button')
        ?.className ?? '',
    ]) {
      const t = cls.split(/\s+/).filter(Boolean)
      expect(t.filter((c) => c.startsWith('hover:border'))).toHaveLength(0)
      expect(t.filter((c) => c.startsWith('focus:border'))).toHaveLength(0)
      expect(t.filter((c) => c.startsWith('focus-visible:border'))).toHaveLength(0)
    }
  })

  it('حلقة التركيز تبقى منفصلة عن الحدّ فلا تندمجان في حافة واحدة', () => {
    render(<Input placeholder="س" />)
    const t = tokensOf(screen.getByPlaceholderText('س'))
    expect(t).toContain('focus-ring')
    // Ring is 2px at 2px offset, outside the border — a second edge, not a
    // thicker version of the first.
    expect(themeCss).toContain('--ring-focus-offset: 2px')
    expect(themeCss).toContain('--ring-focus-width: 2px')
    // And the focused border is a different colour from the resting one.
    expect(TOK['accent']).not.toBe(TOK['line-strong'])
  })

  it('الحقل غير الصالح يبقى أحمر عند التركيز، والحلقة حمراء أيضًا', () => {
    render(<Input invalid placeholder="الرابط" />)
    const el = screen.getByPlaceholderText('الرابط')
    const t = tokensOf(el)
    expect(el.getAttribute('aria-invalid')).toBe('true')
    expect(t).toContain('focus-visible:[--ring-focus-color:var(--color-danger)]')
    // focus-border-accent is intentionally NOT applied when invalid.
    expect(t).not.toContain('focus:border-accent')
  })
})

/* ------------------------------------------------------------------- Input */

describe('Input', () => {
  it('لا يصدر outline-none أبدًا، وحلقة التركيز باقية', () => {
    render(<Input placeholder="الاسم" />)
    const el = screen.getByPlaceholderText('الاسم')
    expect(el.className).not.toContain('outline-none')
    expect(el.className).toContain('focus-ring')
  })

  it('invalid يفعل aria-invalid', () => {
    render(<Input invalid placeholder="الرابط" />)
    expect(screen.getByPlaceholderText('الرابط').getAttribute('aria-invalid')).toBe('true')
  })

  it('الفتحات منطقية: ps/pe تنعكس مع RTL', () => {
    const { container } = render(<Input leading={<span>x</span>} trailing={<span>y</span>} />)
    const el = container.querySelector('input')
    expect(el?.className).toContain('ps-9')
    expect(el?.className).toContain('pe-9')
  })

  it('mono ينقل الخطّ، والقياس من السلم لا قيمة عشوائية', () => {
    render(<Input mono placeholder="sk-" />)
    const el = screen.getByPlaceholderText('sk-')
    expect(el.className).toContain('font-mono')
    expect(el.className).toContain('text-base')
    expect(el.className).not.toMatch(/text-\[/)
  })
})

describe('Textarea', () => {
  it('يرث قاعدة الحلقة نفسها', () => {
    render(<Textarea placeholder="اكتب…" />)
    const el = screen.getByPlaceholderText('اكتب…')
    expect(el.className).not.toContain('outline-none')
    expect(el.className).toContain('focus-ring')
  })
})

/* ------------------------------------------------------------------ Field */

describe('Field', () => {
  it('يربط label بالحقل بـhtmlFor وid، هذا هو إصلاح عيب «النماذج»', () => {
    render(
      <Field label="النماذج">
        {({ id, ...aria }) => <Input id={id} {...aria} placeholder="اكتب اسم النموذج" />}
      </Field>,
    )
    const input = screen.getByLabelText('النماذج')
    expect(input.id).not.toBe('')
    expect(input.tagName).toBe('INPUT')
  })

  it('يوصل aria-describedby إلى hint و error معًا', () => {
    render(
      <Field label="المفتاح" hint="لا يعود إلى الواجهة أبدًا" error="المفتاح مطلوب">
        {({ id, ...aria }) => <Input id={id} {...aria} />}
      </Field>,
    )
    const input = screen.getByLabelText(/المفتاح/)
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ')
    expect(described.length).toBe(2)
    expect(described[0]).not.toBe('')

    const hint = document.getElementById(described[0] as string)
    const error = document.getElementById(described[1] as string)
    expect(hint?.textContent).toBe('لا يعود إلى الواجهة أبدًا')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(error?.textContent).toBe('المفتاح مطلوب')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('required يمرّر aria-required ويعلن «مطلوب»', () => {
    render(
      <Field label="الاسم" required>
        {({ id, ...aria }) => <Input id={id} {...aria} />}
      </Field>,
    )
    const input = screen.getByLabelText(/الاسم/)
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(screen.getByText('(مطلوب)')).toBeTruthy()
  })

  it('لا hint ولا error ⇒ لا aria-describedby', () => {
    render(
      <Field label="الاسم">
        {({ id, ...aria }) => <Input id={id} {...aria} />}
      </Field>,
    )
    expect(screen.getByLabelText('الاسم').getAttribute('aria-describedby')).toBeNull()
  })
})

/* ------------------------------------------------------------------ Select */

const PROTOCOLS: SelectOption[] = [
  { value: 'openai-compatible', label: 'OpenAI-compatible', hint: 'Authorization: Bearer' },
  { value: 'anthropic', label: 'Anthropic', hint: 'x-api-version' },
  { value: 'google', label: 'Google', hint: 'المفتاح في الرابط' },
]

function Harness(): JSX.Element {
  const [value, setValue] = useState<string | null>('anthropic')
  return <Select aria-label="البروتوكول" options={PROTOCOLS} value={value} onChange={setValue} />
}

describe('Select', () => {
  it('ليس <select> أصليًا، ويعلن الحالة والقدرة', () => {
    render(<Harness />)
    expect(document.querySelector('select')).toBeNull()
    const trigger = screen.getByRole('combobox')
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toContain('Anthropic')
  })

  it('يفتح بالنقر ويعلن expanded=true مع listbox وoptions', () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox')
    expect(within(list).getAllByRole('option').length).toBe(3)
    expect(within(list).getByRole('option', { name: /Anthropic/ }).getAttribute('aria-selected')).toBe('true')
    expect(trigger.getAttribute('aria-activedescendant')).not.toBeNull()
  })

  it('التنقّل بالأسهم يعمل ويلغي بـEsc', () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox')

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    // open + ArrowDown commits the next option immediately (native-select feel)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('combobox').textContent).toContain('OpenAI-compatible')

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('combobox').textContent).toContain('Anthropic')
  })

  it('Enter يفتح ثم يختار، والنقر على خيار يغلق ويعيد التركيز للزر', () => {
    render(<Harness />)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /OpenAI-compatible/ }))
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('combobox').textContent).toContain('OpenAI-compatible')
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
  })
})

/* ------------------------------------------------------------------ Dialog */

function DialogHarness(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        افتح
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="حذف المزوّد"
        description="سيُحذف المفتاح المشفّر نهائيًا."
        footer={<Button variant="danger">حذف</Button>}
      >
        <Button variant="ghost">إلغاء</Button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('يعلن aria-modal ويربط العنوان والوصف', () => {
    render(
      <Dialog open onClose={noop} title="حذف المزوّد" description="لا رجعة">
        <p>محتوى</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull()
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull()
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') as string)
    expect(title?.textContent).toBe('حذف المزوّد')
  })

  it('يحبس التركيز: Tab من آخر عنصر يعود إلى أوله', () => {
    render(
      <Dialog open onClose={noop} title="تجربة">
        <Button variant="ghost">أول</Button>
        <Button variant="ghost">ثاني</Button>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
    expect(focusables.length).toBeGreaterThanOrEqual(3)

    const last = focusables[focusables.length - 1] as HTMLElement
    last.focus()
    expect(document.activeElement).toBe(last)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('Escape يغلق', () => {
    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'افتح' }))
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('يستعيد التركيز إلى الزر الذي فتحه، ويقفل تمرير body ثم يعيده', () => {
    render(<DialogHarness />)
    const opener = screen.getByRole('button', { name: 'افتح' })
    opener.focus()
    fireEvent.click(opener)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).not.toBe('hidden')
    expect(document.activeElement).toBe(opener)
  })

  it('ConfirmDialog يعطي زرّ إلغاء وزرّ danger', () => {
    render(
      <ConfirmDialog open onCancel={noop} onConfirm={noop} title="حذف نهائي؟">
        <p>لا يمكن التراجع</p>
      </ConfirmDialog>,
    )
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'تأكيد' })).toBeTruthy()
  })
})

describe('initialFocusRef', () => {
  it('يركّز العنصر المطلوب داخل النافذة بدل أول عنصر فيها', () => {
    function Ref(): JSX.Element {
      const r = useRef<HTMLButtonElement>(null)
      return (
        <Dialog open onClose={noop} title="t" initialFocusRef={r} footer={<Button>ok</Button>}>
          <Button ref={r} variant="ghost">
            Adopt me
          </Button>
        </Dialog>
      )
    }
    render(<Ref />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Adopt me' }))
  })

  it('حبس التركيز يسحب أي تركيز هارب من الخارج إلى داخل النافذة', () => {
    render(
      <>
        <button type="button" onClick={noop}>
          outside
        </button>
        <Dialog open onClose={noop} title="t" footer={<Button>ok</Button>} />
      </>,
    )
    const outside = screen.getByRole('button', { name: 'outside' })
    outside.focus()
    // The focusin guard must not let it stay out.
    expect(document.activeElement).not.toBe(outside)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
})

/* ----------------------------------------------------------------- Tooltip */

describe('Tooltip', () => {
  it('يستبدل title: الاسم عربي من aria-label والشرح في role="tooltip"', () => {
    render(
      <Tooltip content="حاسوب محمول">
        <IconButton icon={<IconCheck />} label="حاسوب محمول" onClick={noop} />
      </Tooltip>,
    )
    const el = screen.getByRole('button', { name: 'حاسوب محمول' })
    expect(el.getAttribute('title')).toBeNull()
    const tip = screen.getByRole('tooltip')
    expect(tip.getAttribute('data-state')).toBe('closed')
    expect(el.getAttribute('aria-describedby')).toBe(tip.id)
  })

  it('يفتح على التركيز ويُغلق بـEscape', () => {
    render(
      <Tooltip content="تحديث الصفحة" delay={0}>
        <IconButton icon={<IconCheck />} label="تحديث" onClick={noop} />
      </Tooltip>,
    )
    const tip = screen.getByRole('tooltip')
    fireEvent.focus(screen.getByRole('button', { name: 'تحديث' }))
    expect(tip.getAttribute('data-state')).toBe('open')
    fireEvent.keyDown(screen.getByRole('button', { name: 'تحديث' }), { key: 'Escape' })
    expect(tip.getAttribute('data-state')).toBe('closed')
  })
})

/* ------------------------------------------------------------------- Toast */

describe('Toast', () => {
  it('danger يُعلن بـrole="alert" و assertive', () => {
    render(
      <Toast tone="danger" title="فشل الاتصال" onDismiss={noop}>
        تعذّر الوصول إلى المزوّد
      </Toast>,
    )
    const el = screen.getByRole('alert')
    expect(el.getAttribute('aria-live')).toBe('assertive')
    expect(el.textContent).toContain('فشل الاتصال')
  })

  it('neutral يُعلن بـrole="status" و polite', () => {
    render(<Toast tone="neutral" title="تم الحفظ" onDismiss={noop} />)
    const el = screen.getByRole('status')
    expect(el.getAttribute('aria-live')).toBe('polite')
  })

  it('duration=0 يمنع الإخفاء التلقائي', () => {
    vi.useFakeTimers()
    let calls = 0
    render(<Toast title="يغلو" duration={0} onDismiss={() => (calls += 1)} />)
    vi.advanceTimersByTime(60_000)
    expect(calls).toBe(0)
    vi.useRealTimers()
  })
})

/* ------------------------------------------------------- بقية المكتبة */

describe('StatusDot', () => {
  it('نقطة بلا لون فقط: النصّ إجباري ومقروء', () => {
    render(<StatusDot tone="success" label="يعمل الآن" />)
    expect(screen.getByText('يعمل الآن')).toBeTruthy()
  })

  it('hideLabel يبقي النصّ في شجرة الوصول دون عرضه', () => {
    const { container } = render(<StatusDot label="يفكّر" hideLabel />)
    const sr = container.querySelector('.sr-only')
    expect(sr?.textContent).toBe('يفكّر')
  })
})

describe('Spinner', () => {
  it('يُعلن اسمًا افتراضيًا عربيًا فلا يُنسى', () => {
    render(<Spinner />)
    expect(screen.getByText('جارٍ التحميل')).toBeTruthy()
  })

  it('label={null} يُسقط الاسم بدل ترك أيقونة صامتة', () => {
    const { container } = render(<Spinner label={null} />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Chip', () => {
  it('قابل للإزالة بزرّ اسم عربي، وليس حرف ×', () => {
    let removed = 0
    render(
      <Chip removable onRemove={() => (removed += 1)} mono>
        gpt-4o
      </Chip>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'إزالة' }))
    expect(removed).toBe(1)
  })

  it('dir="auto" افتراضيًا لمزيج اسم لاتيني ودالة عربية', () => {
    const { container } = render(<Chip mono>gpt-4o</Chip>)
    expect(container.querySelector('[dir="auto"]')).not.toBeNull()
  })
})

describe('Badge', () => {
  it('ثلاثة أدوار معًا: سطح وحدّ ونصّ', () => {
    const { container } = render(<Badge tone="success">مختبر</Badge>)
    const shell = container.firstElementChild as HTMLElement
    expect(shell.className).toContain('text-success')
    expect(shell.className).toContain('bg-success-bg')
    expect(shell.className).toContain('border-success-border')
    expect(screen.getByText('مختبر')).toBeTruthy()
  })
})

describe('Card', () => {
  it('interactive يرسم زرًّا حقيقيًا لا div بـonClick', () => {
    render(<Card variant="interactive">افتح المشروع</Card>)
    const el = screen.getByRole('button', { name: 'افتح المشروع' })
    expect(el.tagName).toBe('BUTTON')
    expect(el.className).toContain('focus-ring')
    expect(el.className).not.toContain('outline-none')
  })

  it('static يرسم div افتراضيًا', () => {
    render(<Card>محتوى</Card>)
    expect(screen.getByText('محتوى').tagName).toBe('DIV')
  })
})

describe('EmptyState', () => {
  it('يرسم عنوانه ووصفه وفعله', () => {
    let clicked = 0
    render(
      <EmptyState
        icon={<IconChevronRight />}
        title="لا توجد مشاريع بعد"
        description="اكتب ما تريد وسيبنيه الوكيل."
        action={<Button onClick={() => (clicked += 1)}>ابدأ مشروعًا</Button>}
      />,
    )
    expect(screen.getByText('لا توجد مشاريع بعد')).toBeTruthy()
    expect(screen.getByText('اكتب ما تريد وسيبنيه الوكيل.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ابدأ مشروعًا' }))
    expect(clicked).toBe(1)
  })
})

describe('KeyHint', () => {
  it('يرسم Ctrl+Enter كـ<kbd> حقيقيين وباتجاه ltr', () => {
    const { container } = render(<KeyHint keys={['Ctrl', 'Enter']} />)
    const kbds = container.querySelectorAll('kbd')
    expect(kbds.length).toBe(2)
    expect(kbds[0]?.textContent).toBe('Ctrl')
    expect(kbds[1]?.textContent).toBe('Enter')
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull()
  })

  it('يقبل نصًّا واحدًا أيضًا', () => {
    const { container } = render(<KeyHint>Ctrl+Enter</KeyHint>)
    expect(container.querySelectorAll('kbd').length).toBe(2)
  })
})

describe('الأيقونات', () => {
  it('كل أيقونة 24×24، بلا fill، وبstroke.currentColor', () => {
    const { container } = render(
      <>
        <IconChevronRight />
        <IconTrash />
      </>,
    )
    const svgs = Array.from(container.querySelectorAll('svg'))
    expect(svgs.length).toBe(2)
    for (const svg of svgs) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(svg.getAttribute('fill')).toBe('none')
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      expect(svg.getAttribute('stroke-linecap')).toBe('round')
      expect(svg.getAttribute('stroke-linejoin')).toBe('round')
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

describe('cx', () => {
  it('يزيل القيم الفارغة ويقبل المصفوفات', () => {
    expect(cx('a', false && 'b', null, ['c', ['d']])).toBe('a c d')
  })
})
