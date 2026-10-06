import type { JSX, ReactNode, Ref, TextareaHTMLAttributes } from 'react'
import { cx } from './cx'
import { CONTROL_TEXT, type ControlSize } from './parts'

/**
 * حقل نصّ متعدّد الأسطر — مُدخل المحادثة.
 *
 * `resize-none` افتراضيًا: السحب لتغيير الحجم يكسر التخطيط في RTL ويفصل
 * الأيقونات عن حوافها. `className="resize-y"` يعيدها إن لزم.
 *
 * نفس قواعد `Input`: `focus-ring` + `control-border` دائمًا، ولا `outline-none`
 * أبدًا. الحدّ هو ما يعرّف الحقل، لا التعبئة.
 */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: ControlSize
  invalid?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  mono?: boolean
  /** عِرف عادي في React 19 — لمُدخل المحادثة الذي يُعاد التركيز إليه. */
  ref?: Ref<HTMLTextAreaElement>
}

const PAD: Record<ControlSize, string> = {
  sm: 'px-2.5 py-1.5',
  md: 'px-3 py-2',
  lg: 'px-3.5 py-2.5',
}

export function Textarea({
  size = 'md',
  invalid = false,
  leading,
  trailing,
  mono = false,
  className,
  rows = 3,
  ...rest
}: TextareaProps): JSX.Element {
  const hasLeading = leading !== undefined && leading !== null
  const hasTrailing = trailing !== undefined && trailing !== null

  return (
    <div className={cx('relative inline-flex w-full items-start', className)}>
      {hasLeading ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-0 grid w-9 place-items-center text-text-muted"
        >
          {leading}
        </span>
      ) : null}

      <textarea
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cx(
          'focus-ring control-border w-full resize-none rounded-lg border bg-inset leading-relaxed text-text-primary',
          'placeholder:text-text-muted caret-accent',
          'transition-ui disabled:cursor-not-allowed disabled:opacity-45',
          invalid && 'focus-visible:[--ring-focus-color:var(--color-danger)]',
          PAD[size],
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

export default Textarea
