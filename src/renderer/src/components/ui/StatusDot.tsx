import type { JSX } from 'react'
import { cx } from './cx'
import { TONE_FILL, type Tone } from './parts'

/**
 * نقطة حالة — الإشارة الحيّة الأولى في التطبيق.
 *
 * اليوم هي دائرة 6px ملوّنة **بلا نصّ** في `ChatPanel.tsx:540`، ومعها جملة
 * عربية في عنصر مجاور. قارئ الشاشة يقرأ «نقطة» فقط، وبعيدًا عن النافذة يقرأ
 * ما لا معنى له.
 *
 * هنا `label` **إلزامي**. مرئيٌّ افتراضيًا (وهو المطلوب: نقطة لا تُقرأ)،
 * و`hideLabel` يبقيه في شجرة الوصول فقط (`sr-only`) حين تكون الجملة العربية
 * مكتوبة في عنصر مجاور أصلًا ولا نريد تكرارًا مرئيًا.
 *
 * `pulse` هي حلقة `animate-pulse` — وهي بالضبط ما تعبّر عنه `Spinner`، لكن
 * `Spinner` لشيء *ينتظر*. الفرق مقصود: نقطة = حالة، دوّارة = عمل جارٍ.
 */

export interface StatusDotProps {
  tone?: Tone
  /** النصّ العربي الذي يصف الحالة. إلزامي — لا نقطة بلا تفسير. */
  label: string
  /** نبض خفيف أثناء العمل. */
  pulse?: boolean
  size?: 'sm' | 'md'
  /** يُبقي النصّ في شجرة الوصول دون عرضه. */
  hideLabel?: boolean
  className?: string
}

const SIZE = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
} as const

export function StatusDot({
  tone = 'neutral',
  label,
  pulse = false,
  size = 'md',
  hideLabel = false,
  className,
}: StatusDotProps): JSX.Element {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className={cx('inline-block shrink-0 rounded-full', SIZE[size], TONE_FILL[tone], pulse && 'animate-pulse')}
      />
      <span className={hideLabel ? 'sr-only' : 'text-sm text-text-secondary'}>{label}</span>
    </span>
  )
}

export default StatusDot
