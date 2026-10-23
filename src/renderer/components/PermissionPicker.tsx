import { ChevronDown, ShieldCheck, ShieldOff, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PermissionMode } from '@shared/types'
import { useStore } from '@/lib/store'
import { confirmAction } from './ConfirmDialog'

export const PERMISSION_OPTIONS: { id: PermissionMode; label: string; short: string; hint: string; icon: LucideIcon }[] = [
  {
    id: 'ask',
    label: 'الأدوات الافتراضية',
    short: 'افتراضي',
    hint: 'تنفّذ القراءة والبحث والكتابة والماوس تلقائياً، وتسألك قبل الحذف وأوامر النظام والملفات الحساسة والنشر.',
    icon: ShieldCheck
  },
  {
    id: 'full',
    label: 'الوصول الكامل',
    short: 'وصول كامل',
    hint: 'ينفّذ كل أداة مباشرة بلا أي سؤال، بما في ذلك الحذف وأوامر النظام والملفات الحساسة والنشر العام.',
    icon: ShieldOff
  }
]

const WARNED_KEY = 'nt.fullAccessWarned'

export async function applyPermissionMode(mode: PermissionMode): Promise<boolean> {
  if ((useStore.getState().settings?.permissionMode ?? 'ask') === mode) return true
  if (mode === 'full' && !localStorage.getItem(WARNED_KEY)) {
    const ok = await confirmAction({
      title: 'تفعيل الوصول الكامل',
      message:
        'سينفّذ النموذج كل إجراء مباشرة بلا موافقتك: حذف الملفات والمجلدات، أوامر النظام، قراءة المفاتيح وكلمات السر، والنشر العام على الإنترنت.\nيمكنك العودة إلى «الأدوات الافتراضية» في أي وقت.',
      confirmLabel: 'تفعيل',
      tone: 'coral'
    })
    if (!ok) return false
    localStorage.setItem(WARNED_KEY, '1')
  }
  await useStore.getState().setSettings({ permissionMode: mode })
  return true
}

export default function PermissionPicker() {
  const mode = useStore((s) => s.settings?.permissionMode ?? 'ask')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = PERMISSION_OPTIONS.find((o) => o.id === mode) ?? PERMISSION_OPTIONS[0]
  const Icon = active.icon

  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', f)
    return () => window.removeEventListener('mousedown', f)
  }, [])

  const pick = async (id: PermissionMode) => {
    setOpen(false)
    await applyPermissionMode(id)
  }

  return (
    <div ref={ref} className="no-drag relative">
      <button
        className="model-pill"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`صلاحيات الأدوات: ${active.label}`}
        title={active.hint}
      >
        <Icon size={12} className={`shrink-0 ${mode === 'full' ? 'text-coral' : 'text-jade'}`} />
        <span className="max-w-[110px] truncate t-xs">{active.short}</span>
        <ChevronDown size={12} className={`shrink-0 text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="pop rise absolute end-0 top-full z-50 mt-[var(--sp-2)] w-80 p-1.5 r-4" role="listbox" aria-label="صلاحيات الأدوات">
          {PERMISSION_OPTIONS.map((o) => {
            const I = o.icon
            const on = o.id === mode
            return (
              <button
                key={o.id}
                role="option"
                aria-selected={on}
                onClick={() => void pick(o.id)}
                className={`flex w-full items-start gap-2.5 r-2 px-2.5 py-2 text-start transition hover:bg-raised ${on ? 'bg-raised' : ''}`}
              >
                <I size={14} className={`mt-0.5 shrink-0 ${o.id === 'full' ? 'text-coral' : 'text-jade'}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block t-xs font-medium ${on ? 'text-brass-hi' : 'text-mute'}`}>{o.label}</span>
                  <span className="mt-0.5 block t-2xs leading-[1.6] text-faint">{o.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
