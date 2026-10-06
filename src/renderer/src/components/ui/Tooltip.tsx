import { cloneElement, useCallback, useEffect, useId, useRef, useState, type JSX, type ReactElement, type ReactNode } from 'react'
import { cx } from './cx'

/**
 * تلميح — يستبدل `title={}`.
 *
 * اليوم `title` هو ما يُعرّف أزرار المعاينة الأربعة، وقارئ الشاشة يقرأه اسمًا
 * وحيدًا فينطق `full` / `laptop` / `tablet` / `mobile` بالإنجليزية فوق أزرار
 * عربية. الحلّ ليس حذف `title` بل **فصل الاسمين**:
 *
 *   • **الاسم** ← `IconButton`'s `label` الإلزامي (عربي، في `aria-label`)
 *   • **الشرح المرئي** ← `Tooltip` هنا، بعربية وبمظهر التطبيق
 *
 * WCAG 1.4.13 يشترط في محتوى التمرير/التركيز ثلاثة أشياء: أن يظهر، أن يبقى
 * قابلًا للتمرير فوقه (وهنا `_pointerleave_` لا يُطلَق عند الانتقال إلى ابن
 * من أبنائه، فالفقاعة تبقى)، وأن **يُغلَق بـEscape** (وهذا مُنفَّذ).
 *
 * الفقاعة تبقى في شجرة الوصول وهي مغلقة (تُخفى بـ`opacity` لا
 * بـ`visibility`)، وإلا صار `aria-describedby` يشير إلى عقدة مخفيّة فلا يُقرأ
 * الوصف أصلًا.
 *
 * `aria-describedby` يُضاف للابن عبر `cloneElement` إن لم يكن له واحد — فيكفي
 * أن يكون الابن زرًّا أو حقلًا أو رابطًا دون أن يطلب spread خصائص.
 */

export interface TooltipProps {
  /** نصّ التلميح. */
  content: ReactNode
  /** عنصر واحد يُغلَّف ويأخذ `aria-describedby`. */
  children: ReactElement
  side?: 'top' | 'bottom' | 'start' | 'end'
  /** ms قبل الفتح. الافتراضي 250 يمنع وميض التلميح أثناء مرور المؤشّر. */
  delay?: number
  disabled?: boolean
  className?: string
}

/**
 * `top` و`bottom`تمدّ الفقاعة بعرض الغلاف وتس=centered — فلا نحتاج
 * `translate-x` الفيزيائي الذي ينقلب خطأً في RTL.
 */
const SIDE: Record<'top' | 'bottom' | 'start' | 'end', string> = {
  top: 'bottom-[calc(100%+6px)] inset-x-0 text-center',
  bottom: 'top-[calc(100%+6px)] inset-x-0 text-center',
  start: 'end-[calc(100%+8px)] top-1/2 -translate-y-1/2 text-start',
  end: 'start-[calc(100%+8px)] top-1/2 -translate-y-1/2 text-start',
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 250,
  disabled = false,
  className,
}: TooltipProps): JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const bubbleId = `tt-${uid}`
  const [open, setOpen] = useState(false)
  const timerRef = useRef(0)

  const clear = useCallback((): void => {
    if (timerRef.current !== 0) {
      window.clearTimeout(timerRef.current)
      timerRef.current = 0
    }
  }, [])

  const show = useCallback((): void => {
    if (disabled) return
    clear()
    if (delay === 0) {
      setOpen(true)
      return
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      setOpen(true)
    }, delay)
  }, [clear, delay, disabled])

  const hide = useCallback((): void => {
    clear()
    setOpen(false)
  }, [clear])

  useEffect(() => clear, [clear])
  useEffect(() => {
    if (disabled) hide()
  }, [disabled, hide])

  const existing = (children.props as { 'aria-describedby'?: string })['aria-describedby']
  const describedBy =
    existing === undefined || existing === '' ? bubbleId : `${existing} ${bubbleId}`

  // props of a bare ReactElement are `unknown` in @types/react 19, so the cast
  // is what lets `cloneElement` accept the extra aria-* attribute.
  const described = cloneElement(children as ReactElement<Record<string, unknown>>, {
    'aria-describedby': describedBy,
  })

  return (
    <span
      className={cx('relative inline-flex', className)}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          hide()
        }
      }}
    >
      {described}
      <span
        id={bubbleId}
        role="tooltip"
        data-state={open ? 'open' : 'closed'}
        data-side={side}
        className={cx(
          'absolute z-tooltip w-max max-w-64 rounded-md border border-line-strong',
          'bg-overlay px-2 py-1 text-xs leading-relaxed text-text-secondary shadow-pop',
          'transition-ui',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
          SIDE[side],
        )}
      >
        {content}
      </span>
    </span>
  )
}

export default Tooltip
