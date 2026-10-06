import { useCallback, useEffect, useId, useRef, type JSX, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx'
import { IconClose } from './icons'
import { IconButton } from './IconButton'
import { Button } from './Button'

/**
 * نافذة حوارية — **غير موجودة في التطبيق اليوم إطلاقًا**.
 *
 * الأثر: حذف مزوّد محفوظ (ومفتاحه المشفّر بـDPAPI) نقرة واحدة غير راجعة —
 * `doRemove` في `ProvidersScreen.tsx:182` تستدعي `remove()` بلا تأكيد، ولا
 * يمكن استرجاع المفتاح بعدها لأن الواجهة لا تستقبله أصلًا.
 *
 * ما يفعله هذا المكوّن:
 *   • `role="dialog"` + `aria-modal="true"` + `aria-labelledby` / `aria-describedby`
 *   • **حبس التركيز**: Tab وShift+Tab يدوران داخل النافذة، و`focusin` يعيد أي
 *     تركيز هارب إليها — وهذا ما يوقف خلفية الصفحة من السحب بالـTab
 *   • Escape يُغلق
 *   • قفل تمرير `document.body` مع **استعادة ما كان عليه** (لا تصفيره)
 *   • استعادة التركيز إلى العنصر الذي فتح النافذة
 *   • Portal إلى `document.body` كي لا يبتلعها `overflow: hidden` لأي أبّ
 *   • زرّ إغلاق في الركن **و** Escape، مع `z-modal` من سلم التراكب
 */

export type DialogSize = 'sm' | 'md' | 'lg'
export type DialogTone = 'default' | 'danger'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** أزرار الملاوات. زرّ `danger` واحد لا أكثر لكل نافذة تدمّر شيئًا. */
  footer?: ReactNode
  size?: DialogSize
  tone?: DialogTone
  /** اسم زرّ الإغلاق العلوي لقارئ الشاشة. الافتراضي «إغلاق». */
  closeLabel?: string
  /** النقر على الخلفية يُغلق. الافتراضي `true`. */
  closeOnBackdrop?: boolean
  /** يُركَّز هنا عند الفتح بدل أول عنصر. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

const WIDTH: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  tone = 'default',
  closeLabel = 'إغلاق',
  closeOnBackdrop = true,
  initialFocusRef,
}: DialogProps): JSX.Element | null {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const titleId = `d-${uid}-title`
  const descId = `d-${uid}-desc`
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  const focusables = useCallback((): HTMLElement[] => {
    const panel = panelRef.current
    if (panel === null) return []
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
  }, [])

  // Escape + حبس Tab.
  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (first === undefined || last === undefined) {
        event.preventDefault()
        return
      }
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose, focusables])

  // أي تركيز يخرج من النافذة يُسحَب إليها — يغطي الفأرة والـTab معًا.
  useEffect(() => {
    if (!open) return undefined
    const onFocusIn = (event: FocusEvent): void => {
      const panel = panelRef.current
      if (panel === null) return
      if (event.target instanceof Node && panel.contains(event.target)) return
      focusables()[0]?.focus()
    }
    document.addEventListener('focusin', onFocusIn, true)
    return () => document.removeEventListener('focusin', onFocusIn, true)
  }, [open, focusables])

  // التركيز عند الفتح، واستعادة التركيز وقفل التمرير عند الإغلاق.
  useEffect(() => {
    if (!open) return undefined
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const target = initialFocusRef?.current ?? focusables()[0]
    target?.focus()

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previous
      restoreRef.current?.focus()
    }
  }, [open, focusables, initialFocusRef])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-modal grid place-items-center p-gutter">
      {/* الخلفية نفسها هي هدف النقر — لا غلاف شفاف يخطف الحدث قبل المطابقة. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-scrim"
        onMouseDown={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined || description === null ? undefined : descId}
        className={cx(
          'relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border bg-overlay shadow-e4',
          tone === 'danger' ? 'border-danger-border' : 'border-line-strong',
          WIDTH[size],
        )}
      >
        <header
          className={cx(
            'flex shrink-0 items-start gap-3 border-b px-5 py-4',
            tone === 'danger' ? 'border-danger-border' : 'border-line',
          )}
        >
          <h2 id={titleId} className="min-w-0 flex-1 text-lg font-semibold text-text-primary">
            {title}
          </h2>
          <IconButton icon={<IconClose size={16} />} label={closeLabel} size="sm" onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {description === undefined || description === null ? null : (
            <p id={descId} className="mb-3 text-base leading-relaxed text-text-secondary">
              {description}
            </p>
          )}
          {children}
        </div>

        {footer === undefined || footer === null ? null : (
          <footer
            className={cx(
              'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-4',
              tone === 'danger' ? 'border-danger-border' : 'border-line',
            )}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default Dialog

/* ---------------------------------------------------------------------------
 * ConfirmDialog — لا يوجد أي تأكيد في التطبيق اليوم.
 *
 * غلاف جاهز فوق `Dialog` بنصوص عربية افتراضية. الغرض: ألّا تعيد كل شاشة كتابة
 * منطق التأكيد، وألّا يبدأ أحدهم نافذة تأكيد بزرّ إلغاء ناقص.
 * ------------------------------------------------------------------------ */

export interface ConfirmDialogProps {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  title: ReactNode
  description?: ReactNode
  /** نصّ زرّ التنفيذ. الافتراضي «تأكيد». */
  confirmLabel?: string
  tone?: DialogTone
  size?: DialogSize
  busy?: boolean
  children?: ReactNode
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'تأكيد',
  tone = 'danger',
  size = 'sm',
  busy = false,
  children,
}: ConfirmDialogProps): JSX.Element | null {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size={size}
      tone={tone}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            إلغاء
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            loadingLabel="جارٍ التنفيذ…"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
