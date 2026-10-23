import { FolderKanban, History, MessageSquare, Moon, Settings2, Sparkles, Sun, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { confirmAction, trapDialogFocus } from './ConfirmDialog'
import { useStore } from '@/lib/store'
import { useTheme } from '@/lib/theme'

export type WorkspaceLayout = 'split' | 'chat' | 'stage'

export default function WorkspaceRail({ layout, onLayout }: {
  layout: WorkspaceLayout
  onLayout: (layout: WorkspaceLayout) => void
}) {
  const sessions = useStore((s) => s.sessions)
  const sessionId = useStore((s) => s.sessionId)
  const mode = useStore((s) => s.mode)
  const shown = sessions.filter((s) => (s.mode ?? 'studio') === mode)
  const running = useStore((s) => s.running)
  const [busy, setBusy] = useState(false)
  const history = useStore((s) => s.overlay === 'sessions')
  const setOverlay = useStore((s) => s.setOverlay)
  const openSettingsTab = useStore((s) => s.openSettingsTab)
  const setHistory = (open: boolean) => setOverlay(open ? 'sessions' : null)
  const historyPanel = useRef<HTMLElement>(null)
  const { effective, toggle } = useTheme()

  useEffect(() => {
    if (!history) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    historyPanel.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOverlay(null) }
      if (e.key === 'Tab') trapDialogFocus(historyPanel.current, e)
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [history, setOverlay])

  const act = async (action: () => Promise<void>) => {
    if (busy || running) return
    setBusy(true)
    try { await action(); setHistory(false); onLayout('split') }
    catch (e) { useStore.getState().notify(`تعذّر فتح المحادثة: ${e instanceof Error ? e.message : String(e)}`, 'error') }
    finally { setBusy(false) }
  }

  const wipe = async () => {
    const ok = await confirmAction({
      title: 'حذف كل الشاتات',
      message: 'سيُحذف سجل كل المحادثات دفعة واحدة — ما عدا الشات الجاري تنفيذه، ويُفتح شات جديد عِوضاً عن المحذوف المفتوح. لا يمكن التراجع عن الحذف.',
      confirmLabel: 'حذف الكل',
      tone: 'coral'
    })
    if (!ok) return
    await act(async () => {
      const n = await useStore.getState().deleteAllChats()
      useStore.getState().notify(
        n === 0 ? 'لا محادثات محفوظة للحذف' : n === 1 ? 'حُذفت محادثة واحدة' : n === 2 ? 'حُذفت محادثتان' : n <= 10 ? `حُذفت ${n} محادثات` : `حُذفت ${n} محادثة`,
        'info'
      )
    })
  }

  return (
    <aside className="workspace-rail" aria-label="التنقل الرئيسي">
      <div className="rail-spacer" />
      <button className="rail-action" aria-label="المشاريع" title="المشاريع" onClick={() => setOverlay('projects')}><FolderKanban size={18} /><span>المشاريع</span></button>
      <button className="rail-action" aria-label="المهارات" title="المهارات والبرومنت" onClick={() => openSettingsTab('skills')}><Sparkles size={18} /><span>المهارات</span></button>
      <div className="rail-history-wrap">
        <button className="rail-action" data-active={history} aria-label="المحادثات المحفوظة" aria-expanded={history} onClick={() => { setHistory(!history); if (!history) void useStore.getState().refreshSessions().catch(() => useStore.getState().notify('تعذّر تحديث المحادثات', 'error')) }}><History size={18} /><span>السجل</span></button>
      </div>
      <button className="rail-action" aria-label={effective === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'} title={effective === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'} onClick={toggle}>{effective === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      <button className="rail-action" aria-label="الإعدادات" title="الإعدادات" onClick={() => openSettingsTab('providers')}><Settings2 size={18} /></button>
      {history && (
        <div className="history-backdrop" onClick={() => setHistory(false)} onKeyDown={(e) => { if (e.key === 'Escape') setHistory(false) }}>
          <section ref={historyPanel} tabIndex={-1} role="dialog" aria-modal="true" className="history-panel pop rise" aria-label="المحادثات المحفوظة" onClick={(e) => e.stopPropagation()}>
            <header><strong>{mode === 'agent' ? 'مهام إيجنت الكمبيوتر' : 'محادثاتك'}</strong><button className="btn btn-ghost" onClick={() => setHistory(false)}>إغلاق</button></header>
            <p className="text-mute t-xs">{running ? 'أوقف التنفيذ قبل تبديل المحادثة.' : mode === 'agent' ? 'سجل جلسات التحكم الكامل بسطح المكتب.' : 'تابع العمل من حيث توقفت.'}</p>
            <div className="history-list flex-1 min-h-0">
              {!shown.length && <p className="text-mute">{mode === 'agent' ? 'لا شاتات وكيل بعد.' : 'لا محادثات محفوظة بعد.'}</p>}
              {shown.map((s) => <button key={s.id} className="history-item" data-active={s.id === sessionId} disabled={busy || running} onClick={() => void act(() => useStore.getState().loadSession(s.id))}><MessageSquare size={16} /><span>{s.title || 'محادثة بلا عنوان'}</span>{s.running && <span className="status-dot" />}</button>)}
            </div>
            <button className="btn btn-danger mt-2 w-full justify-center" disabled={busy || running} onClick={() => void wipe()}>
              <Trash2 size={14} /> حذف كل الشاتات
            </button>
          </section>
        </div>
      )}
    </aside>
  )
}
