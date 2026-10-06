import type { JSX } from 'react'
import { cx } from './cx'

/**
 * رقاقات مفاتيح لوحة المفاتيح — `<kbd>` حقيقي.
 *
 * اليوم «(Ctrl+Enter للإرسال)» نصّ عادي داخل `placeholder`. قارئ الشاشة
 * يقرؤه حرفيًا، ولا أحد يعرف أن السطر مثال وليس شرطًا.
 *
 * `dir="ltr"` على الغلاف إجباري: المفاتيح لاتينية، ورتيبها يبقى
 * Ctrl ثم Enter مهما كان اتجاه الصفحة.
 */

export interface KeyHintProps {
  /** مفاتيح مفصولة: `['Ctrl', 'Enter']`. */
  keys?: readonly string[]
  /** أو نصّ واحد يُقسَّم على `+`: `'Ctrl+Enter'`. */
  children?: string
  /** فاصل بين المفاتيح. الافتراضي `+`. */
  separator?: string
  className?: string
}

export function KeyHint({ keys, children, separator = '+', className }: KeyHintProps): JSX.Element {
  const list = keys ?? (children ?? '').split('+')

  return (
    <span dir="ltr" className={cx('inline-flex items-center gap-1 text-text-muted', className)}>
      {list.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index === 0 ? null : (
            <span aria-hidden="true" className="text-text-disabled">
              {separator}
            </span>
          )}
          <kbd className="kbd">{key}</kbd>
        </span>
      ))}
    </span>
  )
}

export default KeyHint
