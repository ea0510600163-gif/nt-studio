import { Brain, ChevronDown } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import type { ThinkingItem } from '@/lib/groups'

const ThinkPill = memo(function ThinkPill({
  item,
  open: openProp,
  onToggle
}: {
  item: ThinkingItem
  variant?: 'thread' | 'row'
  open?: boolean
  onToggle?: () => void
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const controlled = openProp !== undefined && onToggle !== undefined
  const open = controlled ? openProp : innerOpen
  const live = !!item.streaming
  const trimmed = item.text.trim()
  const hasText = trimmed.length > 0

  const previewLine = useMemo(() => {
    if (!hasText) return ''
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)
    const last = lines[lines.length - 1] ?? ''
    return last.replace(/^[#*>-]+\s*/, '').slice(0, 120)
  }, [trimmed, hasText])

  const toggle = () => {
    if (!hasText) return
    if (controlled) onToggle()
    else setInnerOpen((v) => !v)
  }

  const bodyId = `think-body-${item.id}`
  return (
    <div className="think-flat">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={hasText ? open : undefined}
        aria-disabled={!hasText}
        aria-controls={hasText ? bodyId : undefined}
        aria-label="تفكير النموذج"
        data-open={open}
        className={`ev-row ev-tool group flex w-full items-center gap-2 r-2 px-2 py-1 text-start transition ${hasText ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className={`ev-icon ${live ? 'text-brass-hi' : 'text-faint'}`}>
          <Brain size={15} strokeWidth={1.8} />
        </span>
        <span className={`shrink-0 t-xs font-medium ${live ? 'stage-wave' : 'ev-label'}`}>{live ? 'يفكّر' : 'الاستدلال'}</span>
        {!open && previewLine && (
          <span className="ev-arg min-w-0 truncate t-2xs" dir="auto">
            {previewLine}
          </span>
        )}
        <span className="flex-1" />
        {hasText && (
          <span className="ev-time num shrink-0 t-2xs">
            {trimmed.length > 999 ? `${(trimmed.length / 1000).toFixed(1)}k` : `${trimmed.length}`}
          </span>
        )}
        {hasText && (
          <ChevronDown size={12} className={`ev-chevron shrink-0 transition ${open ? 'rotate-180 opacity-90' : ''}`} />
        )}
      </button>
      {hasText && open && (
        <div id={bodyId} role="region" aria-label="نصّ التفكير" dir="auto" className="ev-details max-h-64 overflow-auto rounded-lg border border-hair/50 bg-bg/60 px-3 py-2 t-xs leading-relaxed whitespace-pre-wrap text-mute">
          {trimmed}
        </div>
      )}
    </div>
  )
})

export default ThinkPill
