import { useCallback, useEffect, useRef, type JSX, type ReactNode } from 'react'
import { cx } from './cx'
import { TONE_ALERT, TONE_TEXT, type Tone } from './parts'
import { IconClose } from './icons'
import { IconButton } from './IconButton'

/**
 * إشعار عابر.
 *
 * العيب الذي يعالجه: الأخطاء اليوم لا تظهر إلا داخل لوحة السجل المنسدلة
 * **المطويّة افتراضيًا بلا شارة عدّاد** في `ChatPanel.tsx:567`. أسوأ من ذلك:
 * `pushNotice` تُخزَّن ولا تُعرض إلا إن فتح المستخدم السجل بنفسه.
 *
 * لذلك الإشعار يحمل `role="alert"` (danger/warn) أو `role="status"` مع
 * `aria-live` صريح — فقارئ الشاشة يُنبّه فورًا لا عند فتح لوحة.
 *
 * `duration` بالمللي ثانية؛ `0` يُبقيه معلقًا (يستعمله Caller حين يكون
 * الإخفاء قرارًا لا وقتًا). تمرير المؤشّر أو التركيز يوقف العدّاد، فلا يختفي
 * إشعارٌ يقرأه المستخدم الآن.
 */

export interface ToastProps {
  tone?: Tone
  /** سطر واحد عريض. */
  title?: ReactNode
  children?: ReactNode
  /** ms حتى الإخفاء التلقائي. `0` = لا إخفاء تلقائي. الافتراضي 6000. */
  duration?: number
  onDismiss?: () => void
  /** اسم زرّ الإخفاء لقارئ الشاشة. الافتراضي «إخفاء». */
  dismissLabel?: string
  /** عنصر إجراء (زرّ «إعادة المحاولة» مثلًا). */
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

const ALERTED: readonly Tone[] = ['danger', 'warn']

export function Toast({
  tone = 'neutral',
  title,
  children,
  duration = 6_000,
  onDismiss,
  dismissLabel = 'إخفاء',
  action,
  icon,
  className,
}: ToastProps): JSX.Element {
  const urgent = ALERTED.includes(tone)
  const timerRef = useRef(0)
  const heldRef = useRef(false)

  const stop = useCallback((): void => {
    if (timerRef.current !== 0) {
      window.clearTimeout(timerRef.current)
      timerRef.current = 0
    }
  }, [])

  const start = useCallback((): void => {
    stop()
    if (duration <= 0 || onDismiss === undefined) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      onDismiss()
    }, duration)
  }, [stop, duration, onDismiss])

  useEffect(() => {
    start()
    return stop
  }, [start, stop])

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      onPointerEnter={() => {
        heldRef.current = true
        stop()
      }}
      onPointerLeave={() => {
        heldRef.current = false
        start()
      }}
      onFocusCapture={stop}
      onBlurCapture={() => {
        if (!heldRef.current) start()
      }}
      className={cx(
        'pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-3 shadow-pop',
        'transition-ui',
        TONE_ALERT[tone],
        className,
      )}
    >
      {icon === undefined || icon === null ? null : (
        <span aria-hidden="true" className={cx('mt-0.5 inline-flex', TONE_TEXT[tone])}>
          {icon}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {title === undefined || title === null ? null : (
          <p className={cx('text-sm font-semibold', TONE_TEXT[tone])}>{title}</p>
        )}
        {children === undefined || children === null ? null : (
          <div className="mt-0.5 text-sm leading-relaxed text-text-secondary">{children}</div>
        )}
        {action === undefined || action === null ? null : <div className="mt-2 flex gap-2">{action}</div>}
      </div>

      {onDismiss === undefined ? null : (
        <IconButton
          icon={<IconClose size={14} />}
          label={dismissLabel}
          size="sm"
          onClick={onDismiss}
          className="-me-1 -mt-0.5"
        />
      )}
    </div>
  )
}

export default Toast

/* ---------------------------------------------------------------------------
 * ToastRegion — الحيّز الذي يحمل الإشعارات.
 *
 * واحد في التطبيق كله، `fixed` على `start`/`end` مع `z-toast`. لا مخزن ولا
 * `Context`: `children` يتحكّم فيه صاحب الشاشة، فيبقى اتّجاه البيانات واحدًا
 * (مبدأ «لا مصدر حقيقة ثانٍ» المطبَّق في هذا المشروع).
 * ------------------------------------------------------------------------ */

export interface ToastRegionProps {
  children?: ReactNode
  /** عرض الشريط. `sm` = 320px (تستعمله Workspace) · `md` = 420px. */
  size?: 'sm' | 'md'
  className?: string
}

export function ToastRegion({ children, size = 'sm', className }: ToastRegionProps): JSX.Element {
  return (
    <div
      className={cx(
        'pointer-events-none fixed bottom-4 end-4 z-toast flex flex-col gap-2',
        size === 'sm' ? 'w-80' : 'w-[26rem]',
        className,
      )}
    >
      {children}
    </div>
  )
}
