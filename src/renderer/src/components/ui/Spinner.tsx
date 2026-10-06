import type { JSX } from 'react'
import { cx } from './cx'

/**
 * مؤشّر عمل جارٍ.
 *
 * يستبدل ثلاثة استعمالات لـ`animate-pulse` كان كلٌّ منها يعني شيئًا مختلفًا
 * (نقطة حالة · نقطة أداة · مؤشّر بثّ)؛ صار له معنًى واحد: «شيء يعمل».
 * والنصّ العربي «جارٍ التحميل…» كان مكتوبًا يدويًا في ثلاثة مواضع؛ صار هنا
 * افتراضيًا داخل `sr-only` فلا يستبدله أحد.
 *
 * `motion-reduce:animate-none` يوقف الدوران تحت `prefers-reduced-motion`.
 */

export interface SpinnerProps {
  /** ضلع الدائرة بالبكسل. */
  size?: number
  /** ما يُقرأ. الافتراضي «جارٍ التحميل». `null` يُسقط الاسم كليًا. */
  label?: string | null
  className?: string
}

export function Spinner({ size = 16, label = 'جارٍ التحميل', className }: SpinnerProps): JSX.Element {
  const named = typeof label === 'string' && label.trim() !== ''

  return (
    <span className={cx('inline-flex shrink-0 items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={named ? undefined : true}
        role={named ? 'img' : undefined}
        aria-label={named ? label : undefined}
        className="animate-spin text-current motion-reduce:animate-none"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      {named ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}

export default Spinner
