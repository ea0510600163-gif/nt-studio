import { ChevronDown, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '@/lib/store'

export default function ModelPicker() {
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

  const flat = useMemo(() => providers.flatMap((pr) => pr.models.map((m) => ({ providerId: pr.id, modelId: m.id }))), [providers])
  const many = providers.some((pr) => pr.models.length > 12)
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
  const shown = useMemo(() => groups.flatMap((g) => g.models.map((m) => ({ providerId: g.id, modelId: m.id }))), [groups])
  const activeId = open && act >= 0 && act < shown.length ? `mp-opt-${act}` : undefined

  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', f)
    return () => window.removeEventListener('mousedown', f)
  }, [])
  useEffect(() => { if (open && many) filter.current?.focus() }, [open, many])
  useEffect(() => {
    if (!open || act < 0) return
    ref.current?.querySelector<HTMLElement>(`[data-i="${act}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, act])

  const openList = () => {
    setQ('')
    setOpen(true)
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
      if (document.activeElement === filter.current) return
      e.preventDefault()
      if (many) {
        setQ((v) => v + e.key)
        filter.current?.focus()
      } else {
        const i = shown.findIndex((m) => m.modelId.toLowerCase().startsWith(e.key.toLowerCase()))
        if (i >= 0) setAct(i)
      }
    }
  }

  return (
    <div ref={ref} className="no-drag relative">
      <button
        ref={btn}
        className="model-pill"
        onClick={() => (open ? close() : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={activeId}
        aria-label={cur ? `النموذج: ${cur.modelId}` : 'اختر نموذجاً'}
        title={cur ? `النموذج الحالي: ${cur.modelId}` : 'اختر نموذجاً'}
        onKeyDown={onKey}
      >
        <Sparkles size={12} className="shrink-0 text-brass-hi" />
        <span className="mono max-w-[150px] truncate t-xs">{cur ? cur.modelId : 'اختر نموذجاً'}</span>
        <ChevronDown size={12} className={`shrink-0 text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="pop rise absolute end-0 top-full z-50 mt-[var(--sp-2)] w-80 r-4">
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
                      data-on={on}
                      onMouseEnter={() => setAct(m.k)}
                      onClick={() => pick(g.id, m.id)}
                      className="mono menu-item flex w-full items-center r-2 px-2.5 py-1.5 text-start t-xs"
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
