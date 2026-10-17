import { Bot, ChevronDown, Code2, FolderKanban, LayoutPanelLeft, MessageSquare, Minus, Moon, PanelLeft, PanelLeftClose, PanelLeftOpen, Sparkles, Square, Sun, X } from 'lucide-react'
import type { WorkspaceLayout } from './WorkspaceRail'
import type { SessionMode } from '@shared/types'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '@/lib/store'
import { useTheme } from '@/lib/theme'

/* ───────────── منتقي النموذج ─────────────
   نمط listbox كامل: الدور + الخيارات + aria-activedescendant متنقّل +
   أسهم/Home/End/Enter/Escape + تصفية نصّية عند كثرة النماذج. */
function ModelPicker() {
  const providers = useStore((s) => s.providers)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [act, setAct] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const filter = useRef<HTMLInputElement>(null)
  const cur = settings?.defaultModel

  /** كل النماذج بترتيب ثابت — لعدّها ولبذرة التحديد أوّل فتح */
  const flat = useMemo(() => providers.flatMap((pr) => pr.models.map((m) => ({ providerId: pr.id, modelId: m.id }))), [providers])
  /** عامل تصفية ظاهر حين يزيد نماذج أي مزود على 12 — وإلّا بقيت القائمة قصيرة بلا حاجة إليه */
  const many = providers.some((pr) => pr.models.length > 12)
  /** المجموعات المرسومة بعد التصفية — وكل نموذج يحمل فهرسه المرئي */
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    let i = 0
    return providers
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        models: pr.models
          .filter((m) => !t || m.id.toLowerCase().includes(t) || pr.name.toLowerCase().includes(t))
          .map((m) => ({ id: m.id, k: i++ }))
      }))
      .filter((g) => g.models.length > 0)
  }, [providers, q])
  /** المرئي فعلاً — act يدلّ عليه، والـ aria-activedescendant كذلك (filtering لا يُفضّ الواجهة) */
  const shown = useMemo(() => groups.flatMap((g) => g.models.map((m) => ({ providerId: g.id, modelId: m.id }))), [groups])
  const activeId = open && act >= 0 && act < shown.length ? `mp-opt-${act}` : undefined

  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', f)
    return () => window.removeEventListener('mousedown', f)
  }, [])
  // مع وجود عامل تصفية: القلم ينتقل إليه عند الفتح — وإلا بقي على الزناد ليعمل aria-activedescendant
  useEffect(() => { if (open && many) filter.current?.focus() }, [open, many])
  // أبقِ الخيار النشط مرئياً داخل القوائم الطويلة (80 نموذجاً)
  useEffect(() => {
    if (!open || act < 0) return
    ref.current?.querySelector<HTMLElement>(`[data-i="${act}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, act])

  const openList = () => {
    setQ('')
    setOpen(true)
    // ابدأ من النموذج المختار حالياً (q فارغ ⇒ المرئي =flat)، أو أوّل عنصر
    setAct(Math.max(0, flat.findIndex((m) => cur?.providerId === m.providerId && cur.modelId === m.modelId)))
  }

  const close = () => { setOpen(false); setQ(''); setAct(-1) }

  const pick = (providerId: string, modelId: string) => {
    void setSettings({ defaultModel: { providerId, modelId } })
    close()
    btn.current?.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList() }
      return
    }
    const n = shown.length
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setAct((a) => (a + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setAct((a) => (a - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setAct(0) }
    else if (e.key === 'End') { e.preventDefault(); setAct(Math.max(0, n - 1)) }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const m = shown[act]
      if (m) pick(m.providerId, m.modelId)
    } else if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // كتابة حرف على الزناد (أو داخل عامل التصفية حين يكون مركّزاً)
      e.preventDefault()
      if (many) {
        // قائمة طويلة: الحرف يذهب إلى عامل التصفية الظاهر وتُتابع الكتابة فيه
        setQ((v) => v + e.key)
        filter.current?.focus()
      } else {
        // قائمة قصيرة: لا تصفية مخفيّة — نمط listbox القياسي يقتضي القفز
        // إلى أوّل نموذج يبدأ بالحرف المكتوب (لا حالة تصفية بلا مرجع مرئي)
        const i = shown.findIndex((m) => m.modelId.toLowerCase().startsWith(e.key.toLowerCase()))
        if (i >= 0) setAct(i)
      }
    }
  }

  return (
    <div ref={ref} className="no-drag relative">
      <button
        ref={btn}
        className="btn model-trigger"
        onClick={() => (open ? close() : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={activeId}
        aria-label={cur ? `النموذج: ${cur.modelId}` : 'اختر نموذجاً'}
        onKeyDown={onKey}
      >
        {cur ? <span className="size-1.5 r-full bg-jade shadow-[0_0_8px_var(--color-jade)]" /> : <span className="size-1.5 r-full bg-faint" />}
        <span className="mono max-w-[200px] truncate t-xs">{cur ? cur.modelId : 'اختر نموذجاً'}</span>
        <ChevronDown size={13} className={`text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="pop rise absolute end-0 top-10 z-40 w-80 r-4">
          {many && (
            <div className="border-b border-hair p-1.5">
              <input
                ref={filter}
                value={q}
                onChange={(e) => { setQ(e.target.value); setAct(0) }}
                onKeyDown={onKey}
                placeholder="تصفية النماذج…"
                aria-label="تصفية النماذج"
                aria-controls="mp-list"
                aria-activedescendant={activeId}
                className="field t-xs"
              />
            </div>
          )}
          <div id="mp-list" role="listbox" aria-label="النماذج المتاحة" className="max-h-72 overflow-auto p-1.5">
            {groups.length === 0 && <p className="px-2.5 py-4 text-center t-xs text-faint">لا نموذج مطابق</p>}
            {groups.map((g) => (
              <div key={g.id} role="group" aria-label={g.name}>
                <p className="px-2.5 pb-1 pt-2 t-2xs text-faint">{g.name}</p>
                {g.models.map((m) => {
                  const on = cur?.providerId === g.id && cur.modelId === m.id
                  return (
                    <button
                      key={m.id}
                      id={`mp-opt-${m.k}`}
                      data-i={m.k}
                      role="option"
                      aria-selected={on}
                      data-active={m.k === act}
                      onMouseEnter={() => setAct(m.k)}
                      onClick={() => pick(g.id, m.id)}
                      className={`mono flex w-full items-center r-2 px-2.5 py-1.5 text-start t-xs transition hover:bg-raised ${m.k === act ? 'bg-raised text-brass-hi' : on ? 'text-brass-hi' : 'text-mute'}`}
                    >
                      <span className="truncate">{m.id}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────── أزرار النافذة (مخصّصة بالتصميم) ───────────── */
function WindowControls() {
  const [max, setMax] = useState(false)
  useEffect(() => {
    void window.nt.window.isMaximized().then(setMax).catch(() => {})
    return window.nt.on<{ maximized: boolean }>('window:state', (s) => setMax(s.maximized))
  }, [])
  return (
    <div className="no-drag flex h-full items-stretch">
      <button className="win-btn" title="تصغير" onClick={() => void window.nt.window.minimize()}><Minus size={15} /></button>
      <button className="win-btn" title={max ? 'استعادة' : 'تكبير'} onClick={() => { void window.nt.window.toggleMaximize().then(() => window.nt.window.isMaximized()).then(setMax).catch(() => {}) }}>
        <Square size={11} strokeWidth={2.4} />
      </button>
      <button className="win-btn" data-act="close" title="إغلاق" onClick={() => void window.nt.window.close()}><X size={15} /></button>
    </div>
  )
}

/* ───────────── الشريط العلوي ───────────── */
export default function TopBar({ layout, onLayout, railOpen, onRail, mode, onMode }: { layout: WorkspaceLayout; onLayout: (value: WorkspaceLayout) => void; railOpen: boolean; onRail: () => void; mode: SessionMode; onMode: (m: SessionMode) => void }) {
  const project = useStore((s) => s.project)
  const { effective, toggle } = useTheme()

  return (
    <header
      className="studio-topbar drag"
      onDoubleClick={(e) => {
        // نقر مزدوج على زرّ/حقل ليس طلب تكبير — وإلا لالتقط الاختصار كل ضغطة على «إيقاف طارئ»
        if ((e.target as HTMLElement).closest('button, [role=button], input, select')) return
        void window.nt.window.toggleMaximize()
      }}
    >
      {/* الهوية */}
      <div className="studio-brand no-drag">
        <span className="brand-symbol"><Sparkles size={17} /></span>
        <span className="brand-wordmark" dir="ltr">NT<span>STUDIO</span></span>
        <span className="brand-edition">WORKSPACE</span>
      </div>
      <span className="divider my-auto" data-dir="v" style={{ height: 'var(--sp-4)' }} />

      {/* المشروع الحالي — أو هوية وضع الـ Agent */}
      <div className="project-context no-drag max-w-[240px]" title={mode === 'agent' ? 'وضع Agent — مشغّل المتصفح' : project ? `المشروع الحالي: ${project.name}` : 'لا يوجد مشروع محدد'}>
        {mode === 'agent' ? <Bot size={13} className="shrink-0" /> : <FolderKanban size={13} className="shrink-0" />}
        <span className="truncate">{mode === 'agent' ? 'وكيل المتصفح' : project ? project.name : 'مشروع جديد'}</span>
      </div>

      <span className="flex-1" />

      {/* الوضع: Studio للبرمجة، Agent لتشغيل المتصفح — جلسة وأدوات وموجّه مستقلة لكل وضع */}
      <div className="layout-switch no-drag" role="group" aria-label="وضع العمل">
        {([['studio', Code2, 'وضع Studio — برمجة ومشاريع'], ['agent', Bot, 'وضع Agent — تشغيل المتصفح والنشر']] as const).map(([m, Icon, label]) => <button key={m} className="icon-btn" data-active={mode === m} aria-pressed={mode === m} aria-label={label} title={label} onClick={() => onMode(m)}><Icon size={15} /></button>)}
      </div>

      <div className="layout-switch no-drag" role="group" aria-label="تخطيط مساحة العمل">
        <button className="icon-btn" data-active={railOpen} aria-pressed={railOpen} aria-label={railOpen ? 'إخفاء الشريط الجانبي' : 'إظهار الشريط الجانبي'} title={railOpen ? 'إخفاء الشريط الجانبي واستعادة المساحة' : 'إظهار الشريط الجانبي'} onClick={onRail}>{railOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
        {([['split', LayoutPanelLeft, 'مساحة متكاملة'], ['chat', MessageSquare, 'تركيز المحادثة'], ['stage', PanelLeft, 'تركيز مساحة العمل']] as const).map(([mode, Icon, label]) => <button key={mode} className="icon-btn" data-active={layout === mode} aria-pressed={layout === mode} aria-label={label} title={label} onClick={() => onLayout(mode)}><Icon size={15} /></button>)}
      </div>
      <ModelPicker />

      <button className="icon-btn no-drag" title={effective === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'} onClick={toggle}>
        {effective === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <span className="divider my-auto" data-dir="v" style={{ height: 'var(--sp-5)' }} />
      <WindowControls />
    </header>
  )
}
