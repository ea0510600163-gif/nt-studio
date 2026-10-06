import type { InputHTMLAttributes, JSX, ReactNode, Ref } from 'react'
import { cx } from './cx'
import { CONTROL_TEXT, type ControlSize } from './parts'

/**
 * حقل إدخال.
 *
 *   `leading` / `trailing`   فتحات **منطقية** (ps/pe)، فينعكسان تلقائيًا مع RTL.
 *   `invalid`                يُفعّل `aria-invalid` **و** يُبدّل لون حلقة التركيز
 *                            إلى `danger` عبر `--ring-focus-color` — بصنف واحد
 *                            لا بصنفَي `outline` متعارضين يختار CSS أحدهما.
 *   focus ring               `focus-ring` دائمًا. **`outline-none` ممنوع هنا**:
 *                            لأنه يسقط في طبقة `utilities` ويهزم `:focus-visible`
 *                            في `base` مهما زادت الأولوية، فيختفي التركيز في
 *                            كل حقل بالتطبيق (وهو ما يحدث اليوم فعلًا).
 *
 * الحدّ: `control-border` هي آلة الحالات كاملة — سكون `line-strong` (3.34:1)،
 * تمرير `line-hover` (4.38:1)، تركيز `accent` (5.72:1) + حلقة 2px، خطأ
 * `danger`. **الحدّ هو ما يعرّف الحقل**، لا التعبئة: تعبئة `bg-inset` تقيس
 * 1.05:1 فقط ولا يمكن أن تُميَّز بالعين.
 */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize
  invalid?: boolean
  /** أيقونة أو نصّ قصير قبل القيمة. */
  leading?: ReactNode
  /** أيقونة أو زرّ بعد القيمة (زر إظهار المفتاح مثلًا). */
  trailing?: ReactNode
  /** خط أحادي المسافة — للروابط والمفاتيح وأسماء النماذج. */
  mono?: boolean
  /** عِرف عادي في React 19 — لتركيز الحقل أو قراءته برمجيًا. */
  ref?: Ref<HTMLInputElement>
}

const SIZE: Record<ControlSize, string> = {
  sm: 'h-control-sm px-2.5 text-xs',
  md: 'h-control-md px-3 text-base',
  lg: 'h-control-lg px-3.5 text-base',
}

export function Input({
  size = 'md',
  invalid = false,
  leading,
  trailing,
  mono = false,
  className,
  ...rest
}: InputProps): JSX.Element {
  const hasLeading = leading !== undefined && leading !== null
  const hasTrailing = trailing !== undefined && trailing !== null

  return (
    <div className={cx('relative inline-flex w-full items-center', className)}>
      {hasLeading ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-0 grid w-9 place-items-center text-text-muted"
        >
          {leading}
        </span>
      ) : null}

      <input
        aria-invalid={invalid || undefined}
        className={cx(
          'focus-ring control-border w-full rounded-lg border bg-inset text-text-primary',
          'placeholder:text-text-muted caret-accent',
          'transition-ui disabled:cursor-not-allowed disabled:opacity-45',
          // Invalid keeps a red well AND a red ring: one variable, no cascade fight.
          invalid && 'focus-visible:[--ring-focus-color:var(--color-danger)]',
          SIZE[size],
          CONTROL_TEXT[size],
          mono && 'font-mono',
          hasLeading && 'ps-9',
          hasTrailing && 'pe-9',
        )}
        {...rest}
      />

      {hasTrailing ? (
        <span className="absolute inset-y-0 end-0 flex items-center pe-1.5 text-text-muted">{trailing}</span>
      ) : null}
    </div>
  )
}

export default Input
