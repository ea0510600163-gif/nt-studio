import { Check, ChevronDown, FolderKanban, Plus, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'

export default function ProjectPicker() {
  const project = useStore((s) => s.project)
  const projects = useStore((s) => s.projects)
  const running = useStore((s) => s.running)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const openProject = useStore((s) => s.openProject)
  const newSession = useStore((s) => s.newSession)
  const applyLoaded = useStore((s) => s.applyLoaded)
  const notify = useStore((s) => s.notify)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrap = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (!open) return
    void refreshProjects().catch(() => notify('تعذّر تحديث المشاريع', 'error'))
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, refreshProjects, notify])

  const run = async (action: () => Promise<void>) => {
    close()
    try {
      await action()
    } catch (e) {
      notify(`تعذّر تبديل المشروع: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  const importFolder = () => run(async () => {
    const l = await window.nt.projects.import()
    if (!l) return
    applyLoaded(l)
    await refreshProjects()
  })

  const q = query.trim().toLowerCase()
  const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects
  const showNone = !q || 'بلا مشروع'.includes(q)

  return (
    <div ref={wrap} className="relative flex min-w-0 flex-1 items-center">
      <button
        type="button"
        className="composer-dock-btn"
        disabled={running}
        aria-haspopup="menu"
        aria-expanded={open}
        title={project ? `المشروع: ${project.name}` : 'محادثة بلا مشروع'}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <FolderKanban size={12} className={project ? 'text-brass' : 'text-faint'} />
        <span className="truncate">{project ? project.name : 'بلا مشروع'}</span>
        <ChevronDown size={11} className="text-faint" />
      </button>
      {open && (
        <div role="menu" aria-label="اختيار المشروع" className="composer-menu rise" style={{ width: 'min(100%, 220px)' }}>
          <div className="composer-menu-search">
            <Search size={11} className="shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن المشروع"
              aria-label="ابحث عن المشروع"
              autoFocus
              spellCheck={false}
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {showNone && (
              <button type="button" role="menuitemradio" aria-checked={!project} className="composer-menu-item" onClick={() => void run(() => newSession())}>
                <span className="composer-menu-icon">{!project && <Check size={11} strokeWidth={3} className="text-brass-hi" />}</span>
                <span className="min-w-0 flex-1 truncate">محادثة بلا مشروع</span>
              </button>
            )}
            {filtered.map((p) => (
              <button key={p.id} type="button" role="menuitemradio" aria-checked={project?.id === p.id} className="composer-menu-item" onClick={() => void run(() => openProject(p.id))}>
                <span className="composer-menu-icon">{project?.id === p.id && <Check size={11} strokeWidth={3} className="text-brass-hi" />}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            ))}
            {!showNone && filtered.length === 0 && <p className="px-2 py-2 text-center t-2xs text-faint">لا مشروع مطابق</p>}
          </div>
          <div className="composer-menu-sep" />
          <button type="button" role="menuitem" className="composer-menu-item" onClick={() => void importFolder()}>
            <span className="composer-menu-icon"><Plus size={11} /></span>
            <span className="min-w-0 flex-1">إضافة مجلد كمشروع</span>
          </button>
        </div>
      )}
    </div>
  )
}
