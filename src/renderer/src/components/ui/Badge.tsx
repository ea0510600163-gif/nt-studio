import type { JSX, ReactNode } from 'react'
import { cx } from './cx'
import { TONE_CHIP, type Tone } from './parts'

/**
 * وسم — جملة واحدة فوق سطر، بلا تفاعل.
 *
 * كان الوسم قبل هذا `<span>` بـ`text-[10.5px]` ولون `mute` على سطح غامض:
 * متّسع التباين وصعب القراءة. الآن: الأدوار الثلاثة معًا (سطح + حدّ + نص)
 * بأحجام من سلم الطباعة لا من قيمة عشوائية.
 */

export interface BadgeProps {
  tone?: Tone
  size?: 'sm' | 'md'
  icon?: ReactNode
  children: ReactNode
  /** أرقام تُعرض في عمود — `240ms`، `12 ملف`. */
  num?: boolean
  className?: string
  title?: string
}

const SIZE = {
  sm: 'gap-1 px-1.5 py-0.5 text-xs',
  md: 'gap-1.5 px-2 py-1 text-sm',
} as const

export function Badge({
  tone = 'neutral',
  size = 'md',
  icon,
  children,
  num = false,
  className,
  title,
}: BadgeProps): JSX.Element {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex max-w-full items-center rounded-md border font-medium whitespace-nowrap',
        TONE_CHIP[tone],
        SIZE[size],
        num && 'num tabular-nums',
        className,
      )}
    >
      {icon === undefined || icon === null ? null : (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      <span className="truncate">{children}</span>
    </span>
  )
}

export default Badge
