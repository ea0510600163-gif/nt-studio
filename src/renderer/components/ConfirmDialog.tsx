import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function trapDialogFocus(panel: HTMLElement | null, e: KeyboardEvent) {
  if (!panel) return
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const inside = active instanceof Node && panel.contains(active)
  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault()
      last.focus()
    }
  } else if (!inside || active === last) {
    e.preventDefault()
    first.focus()
  }
}

export type ConfirmTone = 'coral' | 'brass'

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  tone?: ConfirmTone
}

interface ConfirmEntry extends ConfirmRequest {
  id: number
  resolve: (v: boolean) => void
}

const pending: ConfirmEntry[] = []
const listeners = new Set<() => void>()
let seq = 0

const emit = () => { for (const l of listeners) l() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const current = (): ConfirmEntry | null => pending[0] ?? null

function answer(v: boolean) {
  const e = pending.shift()
  if (!e) return
  emit()
  e.resolve(v)
}

export function confirmAction(req: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    pending.push({ ...req, id: ++seq, resolve })
    emit()
  })
}

export function isConfirmOpen(): boolean {
  return pending.length > 0
}

export function ConfirmDialogHost() {
  const entry = useSyncExternalStore(subscribe, current, current)
  if (!entry) return null
  return <ConfirmPanel key={entry.id} entry={entry} />
}

function ConfirmPanel({ entry }: { entry: ConfirmEntry }) {
  const titleId = useId()
  const descId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const danger = entry.tone !== 'brass'

  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null
    cancel.current?.focus({ preventScroll: true })
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        answer(false)
      } else if (e.key === 'Tab') trapDialogFocus(panel.current, e)
    }
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('keydown', k)
      if (restore && document.contains(restore)) restore.focus({ preventScroll: true })
    }
  }, [entry])

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6 backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="pop rise r-5 w-full max-w-[420px] p-5"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 grid size-9 shrink-0 place-items-center r-3 border ${danger ? 'border-coral/40 bg-coral/10 text-coral' : 'border-brass/40 bg-brass/10 text-brass-hi'}`}>
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display t-lg font-bold">{entry.title}</h2>
            <p id={descId} className="t-sm mt-1 whitespace-pre-line text-mute">{entry.message}</p>
          </div>
          <button className="icon-btn -me-1 -mt-1 shrink-0" onClick={() => answer(false)} aria-label="إغلاق"><X size={16} /></button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancel} className="btn btn-ghost" onClick={() => answer(false)}>إلغاء</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-brass'}`} onClick={() => answer(true)}>{entry.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
