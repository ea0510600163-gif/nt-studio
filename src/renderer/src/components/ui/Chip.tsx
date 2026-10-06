import type { JSX, ReactNode } from 'react'
import { cx } from './cx'
import { TONE_CHIP, type Tone } from './parts'
import { IconClose } from './icons'

/**
 * رقاقة — عنصر قائمة يمكن إزالته، مثل «نموذج مضاف».
 *
 * `removable` يرسم زر `<button>` حقيقيًا باسم عربي إجباري (`removeLabel`)، لا
 * حرف `×` بنصّ. الحرف كان يُقرأ كحرف واحد («ضرب» أو «times») أو لا يُقرأ
 * إطلاقًا حسب الخط الذي حلّ محله.
 *
 * `dir="auto"` افتراضيًا: أسماء النماذج لاتينية (`gpt-4o`) بينما التلميح
 * عربي، و`dir="auto"` يخلطهما بالاتجاه الصحيح بلا `dir="ltr"` متكرّر.
 */

export interface ChipProps {
  tone?: Tone
  children: ReactNode
  /** يضيف زرّ إزالة. */
  removable?: boolean
  /** يُستدعى عند الضغط على ×. */
  onRemove?: () => void
  /** اسم زرّ الإزالة لقارئ الشاشة. الافتراضي «إزالة». */
  removeLabel?: string
  /** يجعل الرقاقة نفسها زرًّا (نقر على الرقاقة، لا على ×). */
  onClick?: () => void
  icon?: ReactNode
  mono?: boolean
  num?: boolean
  dir?: 'ltr' | 'rtl' | 'auto'
  className?: string
  title?: string
}

export function Chip({
  tone = 'neutral',
  children,
  removable = false,
  onRemove,
  removeLabel = 'إزالة',
  onClick,
  icon,
  mono = false,
  num = false,
  dir = 'auto',
  className,
  title,
}: ChipProps): JSX.Element {
  const inner = (
    <>
      {icon === undefined || icon === null ? null : (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      <span className="truncate">{children}</span>
      {removable ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={(event) => {
            event.stopPropagation()
            onRemove?.()
          }}
          className={cx(
            'focus-ring -me-1 ms-0.5 grid h-4 w-4 place-items-center rounded-sm',
            'text-text-muted transition-ui hover:bg-surface-3 hover:text-danger',
          )}
        >
          <IconClose size={12} />
        </button>
      ) : null}
    </>
  )

  const classes = cx(
    'inline-flex max-w-full items-center gap-1.5 rounded-md border py-1 pe-2 ps-2',
    'text-xs leading-normal',
    TONE_CHIP[tone],
    mono && 'font-mono',
    num && 'tabular-nums',
    onClick === undefined ? null : 'focus-ring cursor-pointer transition-ui hover:border-line-strong hover:bg-surface-3',
    className,
  )

  if (onClick === undefined) {
    return (
      <span dir={dir} title={title} className={classes}>
        {inner}
      </span>
    )
  }

  return (
    <button type="button" dir={dir} title={title} onClick={onClick} className={classes}>
      {inner}
    </button>
  )
}

export default Chip
