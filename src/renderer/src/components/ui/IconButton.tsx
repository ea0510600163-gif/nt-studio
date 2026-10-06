import type { ButtonHTMLAttributes, JSX, ReactNode, Ref } from 'react'
import { cx } from './cx'
import type { Tone } from './parts'

/**
 * زر أيقونة فقط.
 *
 * `label` **إلزامي** ويذهب إلى `aria-label` مباشرة. السبب: التطبيق كله اليوم
 * يعتمد على `title` وحده، وقارئ الشاشة يقرأ `title` اسمًا وحيدًا — فيتلقّى
 * «full» أو «laptop» بالإنجليزية على أزرار المعاينة الأربعة. بخاصية `label`
 * إجبارية لا يمكن بناء زر أيقونة بلا اسم.
 *
 * الحدّ الأدنى 32×32 (`--spacing-control-xs`): أزرار المعاينة اليوم 24×24
 * (`h-6 w-6`)، وهو أصغر من أي حدّ لمس معقول.
 *
 * `active` يرسم `aria-pressed` تلقائيًا — ضروري لأزرار تبديل مقاس المعاينة.
 *
 * `title` محجوب من نوع الخصائص عمدًا: الشرح المرئي يجب أن يأتي عبر `Tooltip`
 * حقيقي، لا عبر تلميح المتصفح الخام.
 */

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> {
  /** الأيقونة: `<IconTrash size={16} />` أو أي `<svg>`. تُغلَّف بـ`aria-hidden`. */
  icon: ReactNode
  /** الاسم العربي الإلزامي → `aria-label`. */
  label: string
  /** `sm` = 32 · `md` = 34 (الافتراضي) · `lg` = 40. */
  size?: 'sm' | 'md' | 'lg'
  tone?: Tone
  /** حالة pressed لمفتاح تبديل → `aria-pressed`. */
  active?: boolean
  loading?: boolean
  /** عِرف عادي في React 19 — انظر `ButtonProps.ref`. */
  ref?: Ref<HTMLButtonElement>
}

const SIZE = {
  sm: 'h-control-xs w-control-xs rounded-sm',
  md: 'h-control-md w-control-md rounded-lg',
  lg: 'h-control-lg w-control-lg rounded-lg',
} as const

const TONE: Record<Tone, string> = {
  neutral: 'text-text-tertiary hover:bg-surface-2 hover:text-text-primary',
  accent: 'text-accent hover:bg-accent-bg',
  success: 'text-success hover:bg-success-bg',
  warn: 'text-warn hover:bg-warn-bg',
  danger: 'text-danger hover:bg-danger-bg',
}

export function IconButton({
  icon,
  label,
  size = 'md',
  tone = 'neutral',
  active = false,
  loading = false,
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        'focus-ring inline-grid shrink-0 place-items-center select-none',
        'transition-ui disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        SIZE[size],
        TONE[tone],
        active && 'bg-surface-3 text-text-primary',
        className,
      )}
      {...rest}
    >
      {/* `aria-hidden` على الأيقونة ضمانًا: لا اسم مزدوج، ولا نصّ يفلت كاسم. */}
      <span aria-hidden="true" className="inline-grid place-items-center">
        {icon}
      </span>
    </button>
  )
}

export default IconButton
