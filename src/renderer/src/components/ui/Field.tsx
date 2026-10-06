import { useId, type JSX, type ReactNode } from 'react'
import { cx } from './cx'

/**
 * الحقل: يضمن أن كل مُدخل في التطبيق **له اسم**، وهذا ليس صحيحًا اليوم.
 *
 * عيب حقيقي: حقل «النماذج» في `ProvidersScreen.tsx:273-275` عبارة عن
 * `div` و`span` فقط، فليس له اسم يمكن الوصول إليه اطلاقًا، لا `label`
 * ولا `aria-label`. قارئات الشاشة تقرأ عبارة «حقل نصّ» بلا سياق.
 *
 * الحل هنا ليس حكمة بل بنية: `Field` يولّد `id`، ويضع `label` بـ`htmlFor`،
 * ويمنح المكوّن child ما يحتاج من `aria-describedby` و`aria-invalid`
 * و`aria-required` جاهزًا. فلا مجال للنسيان، فالمهمّة الوحيدة هي النسخ.
 */

export interface FieldControlProps {
  /** يجب أن يُمرَّر إلى `id` العنصر. */
  id: string
  /** hint وerror معًا إن وُجدا. `undefined` إن لم يكن أيٌّ منهما. */
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

export interface FieldProps {
  /** نصّ التسمية المرئي. إلزامي؛ التسمية المخفيّة تبقى في شجرة الوصول. */
  label: ReactNode
  /** شرح أسفل التسمية، يُقرأ قبل الحقل. */
  hint?: ReactNode
  /** رسالة خطأ. وجودها يفعّل `aria-invalid` تلقائيًا ويُعلَن بـ`role="alert"`. */
  error?: ReactNode
  required?: boolean
  /** معرّف صريح إن أردت ربطه من الخارج؛ وإلا يُولَّد من `useId`. */
  id?: string
  /** يخفي التسمية بصريًا مع إبقائها في شجرة الوصول. */
  hideLabel?: boolean
  /** يرسم المحتوى أفقيًا بدل رأسي، لزرّ مجاور للحقل. */
  inline?: boolean
  className?: string
  /** يستقبل كل المعرّفات والخصائص التي يجب أن يَنشرها الحقل. */
  children: (control: FieldControlProps) => ReactNode
}

export function Field({
  label,
  hint,
  error,
  required = false,
  id,
  hideLabel = false,
  inline = false,
  className,
  children,
}: FieldProps): JSX.Element {
  // `useId` يعيد `:r0:` — النقطتان تُربكان `querySelector` في بعض الأدوات.
  const generated = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const base = id ?? `f-${generated}`
  const labelId = `${base}-label`
  const hintId = `${base}-hint`
  const errorId = `${base}-error`

  const hasHint = hint !== undefined && hint !== null
  const hasError = error !== undefined && error !== null

  // `aria-describedby` يأخذ معرّفات لا نصوص: hint أولًا (دائمًا يُقرأ)،
  // ثم error أخيرًا (أعلى ما في الحقل صوتًا).
  const described =
    [hasHint ? hintId : null, hasError ? errorId : null]
      .filter((x): x is string => x !== null)
      .join(' ') || undefined

  const control: FieldControlProps = {
    id: base,
    'aria-describedby': described,
    'aria-invalid': hasError ? true : undefined,
    'aria-required': required || undefined,
  }

  return (
    <div className={cx(inline ? 'flex items-center gap-3' : 'grid gap-1.5', className)}>
      <label
        id={labelId}
        htmlFor={base}
        className={cx(hideLabel ? 'sr-only' : 'text-sm text-text-secondary', inline && 'shrink-0')}
      >
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ms-1 text-danger">
              *
            </span>
            <span className="sr-only"> (مطلوب)</span>
          </>
        ) : null}
      </label>

      {children(control)}

      {hasHint ? (
        <p id={hintId} className="text-xs leading-relaxed text-text-muted">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} role="alert" className="text-xs leading-relaxed text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default Field
