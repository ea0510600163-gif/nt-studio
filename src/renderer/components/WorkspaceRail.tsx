import { Code2, Command, Eye, FolderKanban, History, MessageSquare, PanelLeftClose, Plus, Settings2, TerminalSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { trapDialogFocus } from './ConfirmDialog'
import { useStore, type Tab } from '@/lib/store'

export type WorkspaceLayout = 'split' | 'chat' | 'stage'

export default function WorkspaceRail({ layout, onLayout, onCommands, onClose }: {
  layout: WorkspaceLayout
  onLayout: (layout: WorkspaceLayout) => void
  onCommands: () => void
  onClose: () => void
}) {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const setOverlay = useStore((s) => s.setOverlay)
  const sessions = useStore((s) => s.sessions)
  const sessionId = useStore((s) => s.sessionId)
  const mode = useStore((s) => s.mode)
  // السجل مفصول حسب الوضع: جلسات النشر لا تختلط بجلسات البرمجة
  const shown = sessions.filter((s) => (s.mode ?? 'studio') === mode)
  const running = useStore((s) => s.running)
  const [busy, setBusy] = useState(false)
  const history = useStore((s) => s.overlay === 'sessions')
  const setHistory = (open: boolean) => setOverlay(open ? 'sessions' : null)
  const historyPanel = useRef<HTMLElement>(null)
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
  const select = (next: Tab) => { setTab(next); if (layout === 'chat' || window.matchMedia('(max-width: 720px)').matches) onLayout('stage') }

  return (
    <aside className="workspace-rail" aria-label="التنقل الرئيسي">
      <button className="rail-action rail-create" aria-label={mode === 'agent' ? 'شات وكيل جديد' : 'محادثة جديدة'} title={mode === 'agent' ? 'شات وكيل جديد' : 'محادثة جديدة'} disabled={busy || running} onClick={() => void act(() => useStore.getState().newSession())}><Plus size={20} /></button>
      <span className="rail-divider" />
      <button className="rail-action" data-active={layout !== 'stage'} aria-label="المحادثة" title="المحادثة" onClick={() => onLayout(layout === 'chat' ? 'split' : 'chat')}><MessageSquare size={19} /><span>الشات</span></button>
      <button className="rail-action" data-active={layout !== 'chat' && tab === 'preview'} aria-label="المعاينة" title="المعاينة" onClick={() => select('preview')}><Eye size={19} /><span>المعاينة</span></button>
      {mode === 'studio' && (
        <>
          <button className="rail-action" data-active={layout !== 'chat' && tab === 'code'} aria-label="الكود" title="الكود" onClick={() => select('code')}><Code2 size={19} /><span>الكود</span></button>
          <button className="rail-action" data-active={layout !== 'chat' && tab === 'terminal'} aria-label="الطرفية" title="الطرفية" onClick={() => select('terminal')}><TerminalSquare size={19} /><span>الطرفية</span></button>
          <span className="rail-divider" />
          <button className="rail-action" aria-label="المشاريع" title="المشاريع" onClick={() => setOverlay('projects')}><FolderKanban size={19} /><span>المشاريع</span></button>
        </>
      )}
      <div className="rail-history-wrap">
        <button className="rail-action" data-active={history} aria-label="المحادثات المحفوظة" aria-expanded={history} onClick={() => { setHistory(!history); if (!history) void useStore.getState().refreshSessions().catch(() => useStore.getState().notify('تعذّر تحديث المحادثات', 'error')) }}><History size={18} /><span>السجل</span></button>
      </div>
      <div className="rail-spacer" />
      <button className="rail-action" aria-label="لوحة الأوامر" title="لوحة الأوامر · Ctrl+K" onClick={onCommands}><Command size={19} /></button>
      <button className="rail-action" aria-label="الإعدادات" title="الإعدادات" onClick={() => setOverlay('settings')}><Settings2 size={19} /></button>
      <button className="rail-action" aria-label="إخفاء الشريط الجانبي" title="إخفاء الشريط الجانبي واستعادة المساحة" onClick={onClose}><PanelLeftClose size={19} /></button>
      {history && (
        <div className="history-backdrop" onClick={() => setHistory(false)} onKeyDown={(e) => { if (e.key === 'Escape') setHistory(false) }}>
          <section ref={historyPanel} tabIndex={-1} role="dialog" aria-modal="true" className="history-panel pop rise" aria-label="المحادثات المحفوظة" onClick={(e) => e.stopPropagation()}>
            <header><strong>{mode === 'agent' ? 'شاتات الوكيل' : 'محادثاتك'}</strong><button className="btn btn-ghost" onClick={() => setHistory(false)}>إغلاق</button></header>
            <p className="text-mute t-xs">{running ? 'أوقف التنفيذ قبل تبديل المحادثة.' : mode === 'agent' ? 'سجل النشر والتصفح.' : 'تابع العمل من حيث توقفت.'}</p>
            <div className="history-list">
              {!shown.length && <p className="text-mute">{mode === 'agent' ? 'لا شاتات وكيل بعد.' : 'لا محادثات محفوظة بعد.'}</p>}
              {shown.map((s) => <button key={s.id} className="history-item" data-active={s.id === sessionId} disabled={busy || running} onClick={() => void act(() => useStore.getState().loadSession(s.id))}><MessageSquare size={16} /><span>{s.title || 'محادثة بلا عنوان'}</span>{s.running && <span className="status-dot" />}</button>)}
            </div>
          </section>
        </div>
      )}
    </aside>
  )
}
