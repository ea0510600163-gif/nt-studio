import { Bot, Code2, LayoutPanelLeft, MessageSquare, Minus, PanelLeft, Sparkles, Square, X } from 'lucide-react'
import type { WorkspaceLayout } from './WorkspaceRail'
import type { SessionMode } from '@shared/types'
import { useEffect, useState } from 'react'


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

export default function TopBar({ layout, onLayout, mode, onMode }: { layout: WorkspaceLayout; onLayout: (value: WorkspaceLayout) => void; mode: SessionMode; onMode: (m: SessionMode) => void }) {
  return (
    <header
      className="studio-topbar drag"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button, [role=button], input, select')) return
        void window.nt.window.toggleMaximize()
      }}
    >
      <div className="studio-brand no-drag">
        <span className="brand-symbol"><Sparkles size={17} /></span>
        <span className="brand-wordmark" dir="ltr">NT<span>STUDIO</span></span>
        <span className="brand-edition">PRO</span>
      </div>

      <div className="layout-switch no-drag" role="group" aria-label="وضع العمل">
        {([['studio', Code2, 'وضع Studio — برمجة ومشاريع'], ['agent', Bot, 'إيجنت — تحكم كامل بالكمبيوتر']] as const).map(([m, Icon, label]) => (
          <button key={m} className="icon-btn" data-active={mode === m} aria-pressed={mode === m} aria-label={label} title={label} onClick={() => onMode(m)}>
            <Icon size={15} />
          </button>
        ))}
      </div>

      <div className="layout-switch no-drag" role="group" aria-label="تخطيط مساحة العمل">
        {([['split', LayoutPanelLeft, 'مساحة متكاملة'], ['chat', MessageSquare, 'تركيز المحادثة'], ['stage', PanelLeft, 'تركيز مساحة العمل']] as const).map(([m, Icon, label]) => (
          <button key={m} className="icon-btn" data-active={layout === m} aria-pressed={layout === m} aria-label={label} title={label} onClick={() => onLayout(m)}>
            <Icon size={15} />
          </button>
        ))}
      </div>
      <span className="flex-1" />
      <span className="divider my-auto" data-dir="v" style={{ height: 'var(--sp-5)' }} />
      <WindowControls />
    </header>
  )
}
