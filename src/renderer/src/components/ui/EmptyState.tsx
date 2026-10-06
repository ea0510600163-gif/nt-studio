import type { JSX, ReactNode } from 'react'
import { cx } from './cx'

/**
 * حالة فارغة — توحيد ثلاث حالات فارغة مختلفة تمامًا اليوم:
 *
 *   • صندوق حدّه متقطّع   `ProvidersScreen.tsx:378` (لا يوجد مزوّد بعد)
 *   • بطاقة               `ProjectPicker.tsx:64`  (لا توجد مشاريع بعد)
 *   • نصّ موسّط عاري      `ChatPanel.tsx:244`      (اطلب ما تريد)
 *
 * الثلاثة كانت نفس المعنى بثلاث مخططات. `variant="card"` هو الموحَّد،
 * و`bordered` و`plain` باقيان للاستعمال داخل صفّ أو لوح مضغوط.
 *
 * الأيقونة لا تُلتفّ في زرّ ولا تأخذ `aria-label` — العنوان يحمل المعنى،
 * والأيقونة زخرفة تُخفى.
 */

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  /** الإجراء — زرّ واحد غالبًا. */
  action?: ReactNode
  /** 행동 ثانٍ (رابط نصّي مثل «امسح البحث»). */
  secondaryAction?: ReactNode
  icon?: ReactNode
  /** `card` = لوح كامل · `bordered` = حدّ متقطّع · `plain` = نصّ فقط. */
  variant?: 'card' | 'bordered' | 'plain'
  size?: 'sm' | 'md'
  className?: string
}

const SHELL = {
  card: 'rounded-xl border border-line bg-surface-1 px-6 py-10 text-center shadow-card',
  bordered: 'rounded-xl border border-dashed border-line px-6 py-10 text-center',
  plain: 'px-4 py-8 text-center',
} as const

const TITLE = {
  sm: 'text-base font-semibold',
  md: 'text-lg font-semibold',
} as const

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  icon,
  variant = 'card',
  size = 'md',
  className,
}: EmptyStateProps): JSX.Element {
  const hasActions =
    (action !== undefined && action !== null) || (secondaryAction !== undefined && secondaryAction !== null)

  return (
    <div className={cx('grid justify-items-center gap-2', SHELL[variant], className)}>
      {icon === undefined || icon === null ? null : (
        <span aria-hidden="true" className="mb-1 inline-flex text-text-muted">
          {icon}
        </span>
      )}

      <p className={cx('text-text-primary', TITLE[size])}>{title}</p>

      {description === undefined || description === null ? null : (
        <p className="max-w-md text-base leading-relaxed text-text-muted">{description}</p>
      )}

      {hasActions ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}

export default EmptyState
