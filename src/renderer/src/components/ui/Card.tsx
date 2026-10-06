import type { ElementType, HTMLAttributes, JSX, ReactNode } from 'react'
import { cx } from './cx'

/**
 * البطاقة.
 *
 * **لا تستعمل `@utility card` مع `variant`s.** Tailwind لا يستطيع تركيب
 * `@utility` مع أصناف تلمس نفس الخاصية، وأي `tone` يمسّ `background-color`
 * سيتعارض مع `card` hemithe way يُقصد. لذلك يبني هذا المكوّن أسلوبه بنفسه،
 * و`@utility card` باقٍ فقط للشاشات الثلاث غير المُرحَّلة.
 *
 * `variant="interactive"` يرسم `<button type="button">` حقيقيًا — لا `div`
 * بـ`onClick` — فيأخذ التركيز، ويُنشَّط بـEnter وSpace، ويُفتح لقارئ الشاشة.
 */

export type CardVariant = 'static' | 'interactive'
export type CardTone = 'default' | 'raised' | 'inset' | 'danger' | 'accent'
export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  variant?: CardVariant
  tone?: CardTone
  padding?: CardPadding
  /** الوسم الناتج: `div` · `button` · `li` · `section` · `article`. */
  as?: ElementType
  children?: ReactNode
}

/** نفس قيم `@utility card` في theme.css — مقصود التكرار، انظر التعليق. */
const BASE =
  'rounded-xl border border-line shadow-card transition-colors ' +
  'transition-duration-fast'

const TONE: Record<CardTone, string> = {
  default: 'bg-surface-1',
  raised: 'bg-surface-2',
  inset: 'bg-inset',
  accent: 'border-accent-border bg-accent-bg',
  danger: 'border-danger-border bg-danger-bg',
}

const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

const INTERACTIVE =
  'focus-ring cursor-pointer text-start hover:border-line-strong hover:bg-surface-2 ' +
  'active:bg-surface-3 disabled:pointer-events-none disabled:opacity-45'

export function Card({
  variant = 'static',
  tone = 'default',
  padding = 'md',
  as,
  children,
  className,
  ...rest
}: CardProps): JSX.Element {
  const Tag: ElementType = as ?? (variant === 'interactive' ? 'button' : 'div')

  return (
    <Tag
      {...(variant === 'interactive' ? { type: 'button' } : null)}
      className={cx(BASE, TONE[tone], PADDING[padding], variant === 'interactive' && INTERACTIVE, className)}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export default Card
