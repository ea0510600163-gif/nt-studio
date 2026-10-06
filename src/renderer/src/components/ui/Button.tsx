import type { ButtonHTMLAttributes, JSX, ReactNode, Ref } from 'react'
import { cx } from './cx'
import { CONTROL_TEXT } from './parts'
import { IconSpinner } from './icons'

/**
 * الزر — ست حالات مرئية، ولا يمكن أن تُخلط إحداها بأخرى.
 *
 *   default · hover · active · focus-visible · disabled · loading
 *
 * ثلاث قواعد هنا ليست ذوقًا:
 *
 * 1) **`primary` يستخدم حبر `--color-ink-accent` لا `text-white`.** الأبيض
 *    على `#4c8dff` يساوي 3.20:1 — إخفاق AA مقيس. الحبر الداكن يعطي 5.97:1،
 *    ويجعل الزر يبدو زرًا لا شريطًا مضيئًا.
 * 2) **`disabled` سِمة حقيقية لا `aria-disabled`.** الزر المعطَّل لا يقبل
 *    التركيز أصلًا، وهذا ما تتوقّعه WCAG وقارئات الشاشة.
 * 3) **`type="button"` افتراضيًا.** لا يوجد `<form>` في التطبيق اليوم، لكن هذا
 *    يمنع إرسالًا غير مقصود يومًا يُضاف نموذج.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft' | 'link'

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  /** `icon` = مربّع 32×32 بلا نصّ، لـ`IconButton` أو زر أيقونة واحد. */
  size?: ButtonSize
  loading?: boolean
  /**
   * ما يُعلنه قارئ الشاشة أثناء التحميل. الافتراضي: النصّ الأصلي إن كان نصًّا
   * (فلا يفقد الزر اسمه)، وإلا لا اسم يُضاف.
   */
  loadingLabel?: string
  /** عنصر قبل النصّ — أيقونة عادةً. */
  leading?: ReactNode
  /** عنصر بعد النصّ. */
  trailing?: ReactNode
  children?: ReactNode
  /** يمتدّ بعرض الأبّ. */
  fullWidth?: boolean
  /**
   * `ref` عِرف عادي في React 19 (لا حاجة إلى `forwardRef`).
   * ضروري لـ`Dialog initialFocusRef` ولتركيز حقل عند خطأ التحقّق.
   */
  ref?: Ref<HTMLButtonElement>
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-ink-accent font-semibold border border-transparent ' +
    'hover:bg-accent-hover active:bg-accent-active',
  secondary:
    'bg-surface-2 text-text-secondary border border-line ' +
    'hover:bg-surface-3 hover:text-text-primary active:bg-surface-3',
  ghost:
    'bg-transparent text-text-tertiary border border-transparent ' +
    'hover:bg-surface-2 hover:text-text-primary active:bg-surface-3',
  danger:
    'bg-danger text-ink-danger font-semibold border border-transparent ' +
    'hover:bg-danger-hover active:bg-danger-active',
  // زر حذف داخل قائمة: حدّ ملوّن وتلوين خفيف — لا سطح أحمر صاخب لكل صفّ.
  dangerSoft:
    'bg-transparent text-danger border border-danger-border ' +
    'hover:bg-danger-bg hover:border-danger active:bg-danger-bg',
  link:
    'bg-transparent text-accent border border-transparent underline decoration-transparent ' +
    'underline-offset-4 hover:text-accent-hover hover:decoration-current hover:underline',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-control-sm gap-1.5 rounded-sm px-2.5 text-sm',
  md: 'h-control-md gap-2 rounded-lg px-3.5 text-base',
  lg: 'h-control-lg gap-2 rounded-lg px-5 text-md',
  icon: 'h-control-xs w-control-xs shrink-0 justify-center rounded-lg',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingLabel,
  leading,
  trailing,
  children,
  fullWidth = false,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = disabled === true || loading
  const textChild = typeof children === 'string' ? children : null
  const announced = loading ? (loadingLabel ?? textChild) : null

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'focus-ring inline-flex items-center font-medium whitespace-nowrap select-none',
        'transition-ui disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full justify-center',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <IconSpinner size={16} />
          {announced === null ? null : <span className="sr-only">{announced}</span>}
        </>
      ) : (
        <>
          {leading === null || leading === undefined ? null : (
            <span className="-ms-0.5 inline-flex">{leading}</span>
          )}
          {children}
          {trailing === null || trailing === undefined ? null : (
            <span className="-me-0.5 inline-flex">{trailing}</span>
          )}
        </>
      )}
    </button>
  )
}

export default Button

/** يُصدَّر لأن `IconButton` والاختبارات يحتاجان خريطة حجم الزر نفسها. */
export { CONTROL_TEXT }
