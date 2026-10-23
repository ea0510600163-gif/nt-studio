import { Bot, CircleStop, Code2, FolderPlus, MessageSquare, MessageSquarePlus, MonitorPlay, Moon, OctagonX, ScrollText, Search, Settings, Sparkles, Sun, TerminalSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from '@/lib/store'
import { useTheme } from '@/lib/theme'

interface Entry {
  id: string
  label: string
  kw?: string
  hint?: string
  icon: ReactNode
  g: 'cmd' | 'nav' | 'sess'
  run: () => void
}

const GROUPS: { k: Entry['g']; name: string }[] = [
  { k: 'cmd', name: 'الأوامر والتخصيص' },
  { k: 'nav', name: 'التنقّل' },
  { k: 'sess', name: 'جلسات المحادثة' }
]

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'الآن'
  const m = Math.round(s / 60)
  if (m < 60) return m === 1 ? 'قبل دقيقة' : m === 2 ? 'قبل دقيقتين' : m <= 10 ? `قبل ${m} دقائق` : `قبل ${m} دقيقة`
  const h = Math.round(m / 60)
  if (h < 24) return h === 1 ? 'قبل ساعة' : h === 2 ? 'قبل ساعتين' : h <= 10 ? `قبل ${h} ساعات` : `قبل ${h} ساعة`
  const d = Math.round(h / 24)
  if (d < 30) return d === 1 ? 'قبل يوم' : d === 2 ? 'قبل يومين' : d <= 10 ? `قبل ${d} أيام` : `قبل ${d} يوماً`
  const mo = Math.round(d / 30)
  if (mo < 12) return mo === 1 ? 'قبل شهر' : mo === 2 ? 'قبل شهرين' : mo <= 10 ? `قبل ${mo} أشهر` : `قبل ${mo} شهراً`
  return `قبل ${Math.round(mo / 12)} سنة`
}

const results = (n: number) => (n === 1 ? 'نتيجة واحدة' : n === 2 ? 'نتيجتان' : n <= 10 ? `${n} نتائج` : `${n} نتيجة`)

const norm = (s: string) => s.toLowerCase().trim()

export default function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate?: () => void }) {
  const [q, setQ] = useState('')
  const [act, setAct] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)

  const running = useStore((s) => s.running)
  const sessions = useStore((s) => s.sessions)
  const tab = useStore((s) => s.tab)
  const { effective, toggle } = useTheme()

  useEffect(() => { void useStore.getState().refreshSessions().catch(() => {}) }, [])

  useEffect(() => {
    prevFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => {
      const el = prevFocus.current
      if (el && document.contains(el)) el.focus()
    }
  }, [])

  const entries = useMemo<Entry[]>(() => {
    const s = useStore.getState()
    const list: Entry[] = [
      { id: 'new-chat', g: 'cmd', label: 'شات جديد على نفس المشروع', kw: 'شات جلسة جديدة conversation new chat', icon: <MessageSquarePlus size={16} />, run: () => void s.newChatForProject() },
      { id: 'new-project', g: 'cmd', label: 'مشروع جديد / المشاريع', kw: 'مشروع project درج drawer', icon: <FolderPlus size={16} />, run: () => s.setOverlay('projects') },
      { id: 'skills', g: 'cmd', label: 'إدارة المهارات وصنع مهارة جديدة', kw: 'مهارات skills صانع مهارة', icon: <Sparkles size={16} />, run: () => s.openSettingsTab('skills') },
      { id: 'prompts', g: 'cmd', label: 'تخصيص برومنت الوكلاء (Studio & Computer)', kw: 'برومنت prompt وكيل تخصيص', icon: <Bot size={16} />, run: () => s.openSettingsTab('prompts') },
      { id: 'settings', g: 'cmd', label: 'الإعدادات والمزوّدون', kw: 'إعدادات settings مزود نموذج افتراضي model', icon: <Settings size={16} />, run: () => s.openSettingsTab('providers') },
      { id: 'theme', g: 'cmd', label: effective === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي', kw: 'مظهر theme نهاري ليلي light dark', icon: effective === 'dark' ? <Sun size={16} /> : <Moon size={16} />, run: toggle },
      { id: 'tab-preview', g: 'nav', label: 'تبديل إلى المعاينة / الإيجنت', kw: 'معاينة preview بروزر browser متصفح إيجنت', icon: <MonitorPlay size={16} />, run: () => s.focusTab('preview') },
      { id: 'tab-code', g: 'nav', label: 'تبديل إلى الكود', kw: 'كود code محرر editor ملفات files', icon: <Code2 size={16} />, run: () => s.focusTab('code') },
      { id: 'tab-terminal', g: 'nav', label: 'تبديل إلى الطرفية', kw: 'طرفية terminal أوامر shell cmd', icon: <TerminalSquare size={16} />, run: () => s.focusTab('terminal') },
      { id: 'tab-log', g: 'nav', label: 'تبديل إلى سجل الوكيل', kw: 'سجل log وكيل agent notices', icon: <ScrollText size={16} />, run: () => s.focusTab('log') }
    ]
    const others = sessions.filter((x) => x.running && x.id !== s.sessionId)
    if (running || others.length) {
      if (running) list.push({ id: 'stop', g: 'cmd', label: 'إيقاف الوكيل', kw: 'إيقاف توقف stop agent دورته الحالية', icon: <CircleStop size={16} />, run: () => void s.stop() })
      for (const x of others)
        list.push({
          id: `stop-${x.id}`,
          g: 'cmd',
          label: `إيقاف: ${x.title || 'جلسة بلا عنوان'}`,
          kw: `إيقاف توقف stop ${x.title ?? ''}`,
          icon: <CircleStop size={16} />,
          run: () => {
            void window.nt.agent.stop(x.id)
              .catch(() => {})
              .finally(() => void useStore.getState().refreshSessions().catch(() => {}))
          }
        })
      list.push({ id: 'emergency', g: 'cmd', label: 'إيقاف طارئ', kw: 'إيقاف طارئ قتل كل العمليات emergency kill', icon: <OctagonX size={16} />, run: () => void window.nt.agent.emergencyStop() })
    }
    for (const ss of [...s.sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)) {
      list.push({
        id: `s-${ss.id}`,
        g: 'sess',
        label: ss.title || 'جلسة بلا عنوان',
        kw: `جلسة session ${ss.id}`,
        hint: relTime(ss.updatedAt),
        icon: <MessageSquare size={16} />,
        run: () => void s.loadSession(ss.id)
      })
    }
    return list
  }, [running, sessions, effective, toggle])

  const shown = useMemo(() => {
    const t = norm(q)
    if (!t) return entries
    return entries.filter((e) => norm(e.label).includes(t) || norm(e.kw ?? '').includes(t) || norm(e.id).includes(t))
  }, [entries, q])

  const idx = shown.length ? Math.min(act, shown.length - 1) : -1

  useEffect(() => {
    if (idx < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx, q])

  const run = (e: Entry) => {
    e.run()
    if (e.g === 'nav') onNavigate?.()
    onClose()
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Tab') { ev.preventDefault(); return }
    const n = shown.length
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setAct(n ? (idx + 1) % n : 0) }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setAct(n ? (idx - 1 + n) % n : 0) }
    else if (ev.key === 'Home') { ev.preventDefault(); setAct(0) }
    else if (ev.key === 'End') { ev.preventDefault(); setAct(Math.max(0, n - 1)) }
    else if (ev.key === 'Enter') { ev.preventDefault(); const e = shown[idx]; if (e) run(e) }
    else if (ev.key === 'Escape') { ev.preventDefault(); onClose() }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/45 p-4 backdrop-blur-sm"
      style={{ paddingTop: '20vh' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label="لوحة الأوامر" className="pop rise flex w-full max-w-[560px] flex-col overflow-hidden r-4">
        <div className="flex items-center gap-2 border-b border-hair px-3">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setAct(0) }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded
            aria-controls="cp-list"
            aria-activedescendant={idx >= 0 ? `cp-opt-${idx}` : undefined}
            aria-label="ابحث عن أمر أو جلسة"
            autoComplete="off"
            placeholder="ابحث عن أمر أو مهارة أو جلسة…"
            className="w-full bg-transparent py-2.5 t-md outline-none placeholder:text-faint"
          />
          <kbd className="kbd">Ctrl K</kbd>
        </div>

        <div ref={listRef} id="cp-list" role="listbox" aria-label="الأوامر والجلسات" className="max-h-[min(60vh,380px)] overflow-auto p-1.5">
          {shown.length === 0 && <p className="px-3 py-6 text-center t-sm text-mute">لا نتائج مطابقة</p>}
          {GROUPS.map(({ k, name }) => {
            const items = shown.map((e, i) => ({ e, i })).filter(({ e }) => e.g === k)
            if (!items.length) return null
            return (
              <div key={k} role="group" aria-label={name}>
                <p className="px-3 pb-1 pt-2 t-2xs text-faint">{name}</p>
                {items.map(({ e, i }) => {
                  const on = i === idx
                  const tv = e.id.startsWith('tab-') ? (e.id.slice(4) as typeof tab) : null
                  return (
                    <button
                      key={e.id}
                      id={`cp-opt-${i}`}
                      data-i={i}
                      role="option"
                      aria-selected={on}
                      tabIndex={-1}
                      onMouseEnter={() => setAct(i)}
                      onClick={() => run(e)}
                      className="row-hover mb-1 flex w-full items-center gap-2.5 r-4 px-3 py-2 text-start"
                    >
                      <span className="shrink-0 text-faint">{e.icon}</span>
                      <span className="min-w-0 flex-1 truncate t-sm font-medium">{e.label}</span>
                      {e.hint && <span className="num t-2xs text-faint">{e.hint}</span>}
                      {tv && tab === tv && <span className="badge" data-tone="mute">الحالي</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <footer className="flex items-center gap-1.5 border-t border-hair px-3 py-2 t-2xs text-faint">
          <span className="kbd">↑</span><span className="kbd">↓</span><span className="me-2">تنقّل</span>
          <span className="kbd">Enter</span><span className="me-2">تشغيل</span>
          <span className="kbd">Esc</span><span>إغلاق</span>
          <span className="flex-1" />
          <span className="num">{results(shown.length)}</span>
        </footer>
      </div>
    </div>
  )
}
