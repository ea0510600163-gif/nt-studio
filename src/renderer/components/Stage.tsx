import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Bot, Check, ChevronLeft, ChevronRight, CircleCheck, Code2, Copy, ExternalLink, Eye, File as FileIcon, Folder, Info, LoaderCircle, Monitor, RefreshCw, ScrollText, Smartphone, Square, Tablet, TerminalSquare, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { DeviceKind, FileNode, ProcInfo } from '@shared/types'
import { type LogEntry, type Tab, useStore } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { CATS, toolMeta } from '@/lib/toolMeta'
import AgentConsole from './computer/AgentConsole'

type Hljs = typeof import('highlight.js/lib/common').default

const ORDER: Tab[] = ['preview', 'code', 'terminal', 'log']
const HL_MAX = 400 * 1024

const TERM_DARK = '#0f0f0f'
const TERM_FALLBACK: ITheme = {
  background: TERM_DARK,
  foreground: '#f0f0f0',
  cursor: '#d6d6d6',
  selectionBackground: '#6ea1f044',
  black: TERM_DARK,
  red: '#e7828b',
  green: '#8bd694',
  yellow: '#f5a742',
  blue: '#6ea1f0',
  magenta: '#b19be0',
  cyan: '#63bfc9',
  white: '#f0f0f0'
}

function readTermTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement)
  const v = (k: keyof ITheme, cssVar: string): string => {
    const fb = TERM_FALLBACK[k]
    return cs.getPropertyValue(cssVar).trim() || (typeof fb === 'string' ? fb : TERM_DARK)
  }
  return {
    background: v('background', '--term-bg'),
    foreground: v('foreground', '--term-fg'),
    cursor: v('cursor', '--term-cursor'),
    selectionBackground: v('selectionBackground', '--term-selection'),
    black: v('black', '--term-black'),
    red: v('red', '--term-red'),
    green: v('green', '--term-green'),
    yellow: v('yellow', '--term-yellow'),
    blue: v('blue', '--term-blue'),
    magenta: v('magenta', '--term-magenta'),
    cyan: v('cyan', '--term-cyan'),
    white: v('white', '--term-white')
  }
}

const LOG_TIME = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type PreviewSequenceWindow = Window & { __ntPreviewBoundsSequence?: number }

function nextPreviewBoundsSequence(): number {
  const target = window as PreviewSequenceWindow
  target.__ntPreviewBoundsSequence = (target.__ntPreviewBoundsSequence ?? 0) + 1
  return target.__ntPreviewBoundsSequence
}

function compactUrl(raw: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return u.pathname === '/' ? u.host : `${u.host}${u.pathname}`
  } catch {
    return raw
  }
}

function logStatus(l: LogEntry): { icon: ReactNode; text: string } {
  if (l.kind === 'tool') return l.ok
    ? { icon: <CircleCheck size={12} className="shrink-0 text-jade" />, text: 'نجحت الأداة' }
    : { icon: <X size={12} strokeWidth={3} className="shrink-0 text-coral" />, text: 'فشلت الأداة' }
  if (l.level === 'error') return { icon: <X size={12} strokeWidth={3} className="shrink-0 text-coral" />, text: 'خطأ' }
  if (l.level === 'warn') return { icon: <TriangleAlert size={12} className="shrink-0 text-brass" />, text: 'تنبيه' }
  return { icon: <Info size={12} className="shrink-0 text-faint" />, text: 'معلومة' }
}

function ClosePreviewButton() {
  const preview = useStore((s) => s.preview)
  const closePreview = useStore((s) => s.closePreview)
  if (!preview.open) return null
  return (
    <button
      className="icon-btn no-drag shrink-0"
      onClick={() => void closePreview()}
      aria-label="إغلاق المعاينة"
      title="إغلاق المعاينة"
    >
      <X size={16} />
    </button>
  )
}

function PreviewToolbar() {
  const preview = useStore((s) => s.preview)
  const [devOpen, setDevOpen] = useState(false)
  const devWrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!devOpen) return
    const onDown = (e: PointerEvent) => { if (!devWrap.current?.contains(e.target as Node)) setDevOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDevOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [devOpen])

  const dev: { id: DeviceKind; icon: typeof Monitor; label: string }[] = [
    { id: 'mobile', icon: Smartphone, label: 'جوال' },
    { id: 'tablet', icon: Tablet, label: 'تابلت' },
    { id: 'desktop', icon: Monitor, label: 'ديسكتوب' }
  ]

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <div ref={devWrap} className="relative flex shrink-0 items-center gap-1.5">
        <div className="flex items-center gap-1.5 @max-[560px]:hidden">
          {dev.map((d) => (
            <button key={d.id} className="icon-btn" data-active={preview.device === d.id} title={d.label} aria-label={d.label} onClick={() => void window.nt.preview.setDevice(d.id)}>
              <d.icon size={16} />
            </button>
          ))}
        </div>
        <span className="@min-[561px]:hidden">
          <button className="icon-btn" aria-haspopup="menu" aria-expanded={devOpen} aria-label="نوع الجهاز" title="نوع الجهاز" onClick={() => setDevOpen((o) => !o)}>
            <Monitor size={16} />
          </button>
        </span>
        {devOpen && (
          <div role="menu" aria-label="نوع الجهاز" className="pop absolute start-0 top-full z-30 mt-1 min-w-[9rem] p-1">
            {dev.map((d) => (
              <button key={d.id} role="menuitemradio" aria-checked={preview.device === d.id} className="row-hover flex w-full items-center gap-2 px-2 py-1.5 text-start t-sm" onClick={() => { void window.nt.preview.setDevice(d.id); setDevOpen(false) }}>
                <d.icon size={14} className="shrink-0" />
                <span className="min-w-0 flex-1">{d.label}</span>
                {preview.device === d.id && <CircleCheck size={13} className="shrink-0 text-brass-hi" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="icon-btn shrink-0" title="إعادة التحميل" aria-label="إعادة التحميل" disabled={!preview.open} onClick={() => void window.nt.preview.reload()}>
        <RefreshCw size={15} className={preview.loading ? 'spin' : ''} />
      </button>
      <div className="mono mx-1 flex h-[26px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-hair bg-surface px-3 t-xs text-mute @max-[560px]:px-2">
        {preview.loading && <LoaderCircle size={12} className="spin shrink-0 text-brass" />}
        <span className="truncate @max-[560px]:hidden">{preview.url}</span>
        <span className="truncate @min-[561px]:hidden">{compactUrl(preview.url) || preview.title}</span>
      </div>
      {preview.errors > 0 && (
        <span className="badge shrink-0" data-tone="coral" title="أخطاء Console/شبكة في الصفحة" role="img" aria-label={`${preview.errors} أخطاء في الصفحة`}>
          <TriangleAlert size={12} />
          <span className="num">{preview.errors}</span>
        </span>
      )}
      <button className="icon-btn shrink-0" title="فتح في المتصفح" aria-label="فتح في المتصفح" disabled={!preview.open} onClick={() => void window.nt.preview.external()}><ExternalLink size={15} /></button>
      <ClosePreviewButton />
    </div>
  )
}

function PreviewPane({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const preview = useStore((s) => s.preview)
  const tab = useStore((s) => s.tab)
  const mode = useStore((s) => s.mode)
  const overlay = useStore((s) => s.overlay)
  const visible = active && tab === 'preview' && overlay === null && mode !== 'agent'

  const sync = useCallback(() => {
    const el = host.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return
    void window.nt.preview.setBounds({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), seq: nextPreviewBoundsSequence(), boundsEpoch: useStore.getState().preview.boundsEpoch })
  }, [])

  useEffect(() => {
    sync()
    const ro = new ResizeObserver(sync)
    if (host.current) ro.observe(host.current)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [sync])
  useEffect(() => { void window.nt.preview.setSuppressed(!visible); if (visible) sync() }, [visible, sync])
  useEffect(() => { sync() }, [preview.boundsEpoch, sync])

  if (mode === 'agent') {
    return <AgentConsole />
  }
  return (
    <div ref={host} className={`relative h-full ${preview.open ? 'bg-bg' : 'grid-bg'}`}>
      {!preview.open && <span className="stage-empty-label">المعاينة</span>}
    </div>
  )
}

function findDefaultFile(nodes: FileNode[]): string {
  const flat: string[] = []
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.dir) {
        if (n.name !== '.agent' && n.children) walk(n.children)
      } else {
        flat.push(n.path)
      }
    }
  }
  walk(nodes)
  const preferred = ['src/App.tsx', 'src/App.jsx', 'src/main.tsx', 'src/main.ts', 'index.html', 'main.py', 'package.json']
  for (const p of preferred) {
    if (flat.includes(p)) return p
  }
  return ''
}

function TreeView({
  nodes,
  depth,
  sel,
  onSel,
  collapsed,
  openDirs,
  onToggleDir
}: {
  nodes: FileNode[]
  depth: number
  sel: string
  onSel: (p: string) => void
  collapsed: boolean
  openDirs: Record<string, boolean>
  onToggleDir: (p: string) => void
}) {
  const sorted = [...nodes].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return (
    <>
      {sorted.map((n) => (
        <div key={n.path}>
          <button
            onClick={() => (n.dir ? onToggleDir(n.path) : onSel(n.path))}
            style={collapsed ? undefined : { paddingInlineStart: 8 + depth * 14 }}
            title={n.path}
            className={`flex w-full items-center gap-2 rounded-md py-1 pe-2 text-start t-sm transition hover:bg-raised hover:text-ink ${sel === n.path ? 'bg-raised text-ink' : n.dir ? 'text-ink' : 'text-mute'} ${collapsed ? 'justify-center' : ''}`}
          >
            {!collapsed && (n.dir ? <ChevronRight size={12} className={`shrink-0 text-faint transition ${openDirs[n.path] ? 'rotate-90' : ''}`} /> : <span className="w-3 shrink-0" />)}
            {n.dir ? <Folder size={13} className="shrink-0 text-brass" /> : <FileIcon size={13} className="shrink-0 text-faint" />}
            {!collapsed && <span className="mono min-w-0 truncate" style={{ unicodeBidi: 'plaintext' }}>{n.name}</span>}
          </button>
          {n.dir && openDirs[n.path] && n.children && (
            <TreeView nodes={n.children} depth={depth + 1} sel={sel} onSel={onSel} collapsed={collapsed} openDirs={openDirs} onToggleDir={onToggleDir} />
          )}
        </div>
      ))}
    </>
  )
}

function CodePane() {
  const sessionId = useStore((s) => s.sessionId)
  const project = useStore((s) => s.project)
  const treeRev = useStore((s) => s.treeRev)
  const selectedFile = useStore((s) => s.selectedFile)
  const [tree, setTree] = useState<FileNode[]>([])
  const [treeErr, setTreeErr] = useState('')
  const [sel, setSel] = useState('')
  const [src, setSrc] = useState('')
  const [readErr, setReadErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hl, setHl] = useState<Hljs | null>(null)
  const [sideOpen, setSideOpen] = useState(true)
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({ src: true })
  const [req, setReq] = useState(0)
  const loadedSelRef = useRef('')

  const expandParents = useCallback((filePath: string) => {
    const parts = filePath.replace(/\\/g, '/').split('/')
    if (parts.length <= 1) return
    setOpenDirs((prev) => {
      const next = { ...prev }
      let cur = ''
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i]
        next[cur] = true
      }
      return next
    })
  }, [])

  const pick = useCallback((p: string) => {
    const norm = p.replace(/\\/g, '/')
    if (norm !== loadedSelRef.current) {
      setSrc('')
      setLoading(true)
    }
    setSel(norm)
    setReadErr('')
    expandParents(norm)
    setReq((r) => r + 1)
  }, [expandParents])

  useEffect(() => {
    if (selectedFile) pick(selectedFile)
  }, [selectedFile, pick])

  useEffect(() => {
    setSel('')
    setSrc('')
    loadedSelRef.current = ''
  }, [sessionId, project?.id])

  const load = useCallback(async () => {
    if (!sessionId) {
      setTree([])
      return
    }
    try {
      const nextTree = await window.nt.fs.tree(sessionId)
      setTree(nextTree)
      setTreeErr('')
      setSel((curSel) => {
        if (curSel) return curSel
        const def = findDefaultFile(nextTree)
        if (def) expandParents(def)
        return def
      })
    } catch (e) {
      setTree([])
      setTreeErr(`تعذّر جلب شجرة ملفات المشروع: ${errText(e)}`)
    }
  }, [sessionId, expandParents])

  useEffect(() => { void load() }, [load, treeRev])

  useEffect(() => {
    if (!sel || !sessionId) {
      setLoading(false)
      return
    }
    let alive = true
    const isNewFile = loadedSelRef.current !== sel
    if (isNewFile) setLoading(true)
    window.nt.fs.read(sessionId, sel)
      .then((s) => {
        if (alive) {
          loadedSelRef.current = sel
          setSrc(s)
          setReadErr('')
          setLoading(false)
        }
      })
      .catch((e) => {
        if (alive) {
          setReadErr(`تعذّر قراءة الملف: ${errText(e)}`)
          setLoading(false)
        }
      })
    return () => { alive = false }
  }, [sel, sessionId, treeRev, req])

  useEffect(() => {
    let alive = true
    void import('highlight.js/lib/common').then((m) => alive && setHl(() => m.default))
    return () => { alive = false }
  }, [])

  const view = useMemo(() => {
    const lang = sel.split('.').pop()?.toLowerCase() ?? ''
    if (!hl) return { html: escapeHtml(src), degraded: false }
    if (src.length > HL_MAX) return { html: escapeHtml(src), degraded: true }
    try {
      return { html: hl.getLanguage(lang) ? hl.highlight(src, { language: lang }).value : hl.highlightAuto(src).value, degraded: false }
    } catch {
      return { html: escapeHtml(src), degraded: false }
    }
  }, [src, sel, hl])
  const lines = src ? src.split('\n').length : 0

  const copyCode = async () => {
    if (!src) return
    try {
      await navigator.clipboard.writeText(src)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="flex h-full flex-row-reverse @container">
      <aside className={`shrink-0 overflow-auto border-s border-hair py-2 [scrollbar-gutter:stable] ${sideOpen ? 'w-52' : 'w-11'} @max-[520px]:w-11`}>
        <div className={`flex items-center gap-1.5 px-2 pb-2 ${sideOpen ? '' : 'justify-center'}`}>
          <button className="icon-btn" onClick={() => setSideOpen((v) => !v)} aria-expanded={sideOpen} aria-controls="stage-tree" title={sideOpen ? 'طيّ الشجرة' : 'توسيع الشجرة'} aria-label={sideOpen ? 'طيّ الشجرة' : 'توسيع الشجرة'}>
            {sideOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </button>
          {sideOpen && <span className="t-xs font-medium text-faint">{project ? 'ملفات المشروع' : 'مساحة العمل'}</span>}
        </div>
        {treeErr && (
          <p className="toast m-2 t-xs" data-level="error">
            <TriangleAlert size={14} className="shrink-0" />
            <span>{treeErr}</span>
          </p>
        )}
        {!tree.length && !treeErr && <p className="px-3 py-2 t-xs text-faint">لا ملفات بعد.</p>}
        <div id="stage-tree" className={sideOpen ? 'px-1' : ''}>
          <TreeView
            nodes={tree}
            depth={0}
            sel={sel}
            onSel={pick}
            collapsed={!sideOpen}
            openDirs={openDirs}
            onToggleDir={(p) => setOpenDirs((prev) => ({ ...prev, [p]: !prev[p] }))}
          />
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]" aria-busy={loading}>
        {sel ? (
          <>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-hair bg-bg/95 px-4 py-2 backdrop-blur @max-[520px]:px-2">
              <FileIcon size={13} className="shrink-0 text-faint" />
              <span className="mono min-w-0 flex-1 truncate t-xs text-mute" dir="ltr">{sel}</span>
              {!loading && !readErr && (
                <>
                  <span className="num shrink-0 t-2xs text-faint">{lines} سطراً</span>
                  <button
                    type="button"
                    onClick={() => void copyCode()}
                    className="inline-flex items-center gap-1 rounded-md border border-hair bg-surface px-2 py-0.5 t-2xs text-mute transition hover:text-ink"
                    title="نسخ محتوى الملف"
                  >
                    {copied ? <Check size={11} className="text-jade" /> : <Copy size={11} />}
                    <span>{copied ? 'نُسخ' : 'نسخ'}</span>
                  </button>
                </>
              )}
            </div>
            {loading ? (
              <div className="flex flex-col gap-2 p-4" aria-hidden="true">
                <span className="skeleton h-3 w-2/3" />
                <span className="skeleton h-3 w-5/6" />
                <span className="skeleton h-3 w-1/2" />
              </div>
            ) : readErr ? (
              <p className="toast m-4 t-xs" data-level="error">
                <TriangleAlert size={14} className="shrink-0" />
                <span>{readErr}</span>
              </p>
            ) : (
              <>
                {view.degraded && (
                  <p className="mx-4 mt-3 flex items-center gap-1.5 t-xs text-mute">
                    <Info size={12} className="shrink-0" />
                    ملف كبير جداً — عُرض نصّاً مجرّداً بلا تلوين.
                  </p>
                )}
                <div className="code-view flex py-3">
                  <pre className="ln m-0 select-none">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
                  <pre className="m-0 flex-1 pe-6"><code dangerouslySetInnerHTML={{ __html: view.html }} /></pre>
                </div>
              </>
            )}
          </>
        ) : <Empty icon={Code2} text="اختر ملفاً من الشجرة لعرضه." />}
      </div>
    </div>
  )
}

function TerminalPane({ onProcsChange }: { onProcsChange?: (runningCount: number) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const [procs, setProcs] = useState<ProcInfo[]>([])
  const [cur, setCur] = useState('')
  const curRef = useRef('')
  curRef.current = cur
  const tab = useStore((s) => s.tab)
  const { effective } = useTheme()

  useEffect(() => {
    const t = new Terminal({
      fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12.5, cursorBlink: true, convertEol: false, scrollback: 5000,
      theme: readTermTheme()
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.open(el.current!)
    term.current = t
    fit.current = f
    t.onData((d) => curRef.current && void window.nt.term.input(curRef.current, d))
    const ro = new ResizeObserver(() => { try { f.fit() } catch {} })
    ro.observe(el.current!)
    const offData = window.nt.on<{ id: string; data: string }>('term:data', (m) => { if (m.id === curRef.current) t.write(m.data) })
    const applyList = (l: ProcInfo[]) => {
      setProcs(l)
      onProcsChange?.(l.filter((p) => p.running).length)
      if (!l.length) return
      const currentProc = l.find((p) => p.id === curRef.current)
      if (!currentProc || (!currentProc.running && l[l.length - 1].running)) {
        const latestRunning = [...l].reverse().find((p) => p.running)
        setCur((latestRunning ?? l[l.length - 1]).id)
      }
    }
    const offProcs = window.nt.on<ProcInfo[]>('term:procs', applyList)
    void window.nt.term.procs().then(applyList)
    return () => { ro.disconnect(); offData(); offProcs(); t.dispose() }
  }, [onProcsChange])

  useEffect(() => {
    const t = term.current
    if (!t) return
    t.options.theme = readTermTheme()
    t.refresh(0, t.rows - 1)
  }, [effective])

  useEffect(() => {
    const t = term.current
    if (!t || !cur) return
    t.reset()
    void window.nt.term.replay(cur).then((b) => t.write(b))
  }, [cur])
  useEffect(() => { if (tab === 'terminal') try { fit.current?.fit() } catch {} }, [tab])

  const active = procs.find((p) => p.id === cur)
  return (
    <div className="flex h-full flex-col" dir="ltr">
      <div className="flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-hair px-3 py-1.5" dir="rtl">
        {procs.length === 0 && <span className="t-sm text-faint">لا عمليات بعد — ستظهر أوامر الوكيل هنا فور تشغيلها.</span>}
        {procs.map((p) => {
          const state = p.running ? 'running' : p.exitCode === 0 ? 'ok' : 'fail'
          const stateText = p.running ? 'قيد التشغيل' : p.exitCode === 0 ? 'انتهت بنجاح' : `فشلت برمز ${p.exitCode ?? '—'}`
          return (
            <button key={p.id} className="chip shrink-0" data-on={p.id === cur} onClick={() => setCur(p.id)} title={`${p.command} — ${stateText}`} aria-label={`${p.name} — ${stateText}`}>
              <span role="img" aria-label={stateText} title={stateText} className="inline-flex shrink-0">
                {state === 'running' && <LoaderCircle size={11} className="spin text-brass" />}
                {state === 'ok' && <CircleCheck size={11} className="text-jade" />}
                {state === 'fail' && <X size={11} strokeWidth={3} className="text-coral" />}
              </span>
              <span className="min-w-0 max-w-[140px] truncate">{p.name}</span>
              {!p.running && p.exitCode !== null && <span className="num t-2xs text-faint" title={`رمز الخروج: ${p.exitCode}`}>{p.exitCode}</span>}
            </button>
          )
        })}
        <span className="flex-1" />
        {active?.running && (
          <button className="chip !border-coral/50 !text-coral shrink-0" onClick={() => void window.nt.term.stop(active.id)}>
            <Square size={10} fill="currentColor" />
            إيقاف العملية
          </button>
        )}
      </div>
      {active && (
        <div className="flex items-center gap-2 border-b border-hair/60 bg-surface/60 px-3 py-1 text-[11px] text-mute" dir="ltr">
          <TerminalSquare size={12} className="shrink-0 text-faint" />
          <span className="mono min-w-0 flex-1 truncate">{active.command}</span>
          <span className="num shrink-0 text-faint" dir="rtl">
            {active.running ? 'قيد التشغيل' : `رمز الخروج: ${active.exitCode ?? 0}`}
          </span>
        </div>
      )}
      <div ref={el} className="min-h-0 flex-1 bg-[var(--term-bg)]" />
    </div>
  )
}

type LogFilter = 'all' | 'tools' | 'notices' | 'errors'

function LogPane() {
  const log = useStore((s) => s.log)
  const tab = useStore((s) => s.tab)
  const [filter, setFilter] = useState<LogFilter>('all')
  const ref = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (filter === 'tools') return log.filter((l) => l.kind === 'tool')
    if (filter === 'notices') return log.filter((l) => l.kind === 'notice')
    if (filter === 'errors') return log.filter((l) => (l.kind === 'tool' && !l.ok) || l.level === 'error' || l.level === 'warn')
    return log
  }, [log, filter])

  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [filtered.length, tab])

  if (!log.length) return <Empty icon={ScrollText} text="سجل الأدوات والتنبيهات سيظهر هنا أثناء عمل الوكيل." />

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-hair px-3 py-1.5">
        {([
          ['all', 'الكل', log.length],
          ['tools', 'الأدوات', log.filter((l) => l.kind === 'tool').length],
          ['notices', 'التنبيهات', log.filter((l) => l.kind === 'notice').length],
          ['errors', 'الأخطاء والتحذيرات', log.filter((l) => (l.kind === 'tool' && !l.ok) || l.level === 'error' || l.level === 'warn').length]
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className="chip !h-7 !px-2.5 !text-xs"
            data-on={filter === id}
          >
            <span>{label}</span>
            <span className="num text-[10px] opacity-75">{count}</span>
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-auto p-3 [scrollbar-gutter:stable]"
      >
        {filtered.length === 0 ? (
          <p className="py-8 text-center t-sm text-faint">لا توجد عناصر تطابق هذا التصنيف.</p>
        ) : (
          <div className="space-y-1">
            {filtered.map((l) => {
              const st = logStatus(l)
              const m = l.kind === 'tool' ? toolMeta(l.text, {}) : null
              const Icon = m?.icon
              return (
                <div key={l.id} className="flex items-center gap-2.5 rounded-lg border border-hair/40 bg-surface/50 px-3 py-1.5 t-xs">
                  <span className="num mono shrink-0 text-[11px] text-faint">{LOG_TIME.format(l.ts)}</span>
                  <span role="img" aria-label={st.text} title={st.text} className="inline-flex shrink-0">{st.icon}</span>
                  {m && Icon ? (
                    <>
                      <Icon size={13} className="shrink-0" style={{ color: CATS[m.cat].color }} />
                      <span className="shrink-0 font-medium text-ink/90">{m.label}</span>
                      <span className="mono shrink-0 text-[11px] text-faint">({l.text})</span>
                      {l.arg && <span className="mono min-w-0 flex-1 truncate text-[11px] text-mute" dir="ltr">{l.arg}</span>}
                      {!l.arg && <span className="flex-1" />}
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-mute" style={{ unicodeBidi: 'plaintext' }}>{l.text}</span>
                  )}
                  {l.ms != null && (
                    <span className="num mono shrink-0 text-[11px] text-faint">{l.ms < 1000 ? `${l.ms}ms` : `${(l.ms / 1000).toFixed(1)}s`}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Empty({ icon: I, text }: { icon: typeof Eye; text: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center text-mute">
      <div><I size={22} className="mx-auto mb-3 text-faint" /><p className="max-w-[32ch]">{text}</p></div>
    </div>
  )
}

export default function Stage({ active = true }: { active?: boolean }) {
  const project = useStore((s) => s.project)
  const preview = useStore((s) => s.preview)
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const mode = useStore((s) => s.mode)
  const [runningProcs, setRunningProcs] = useState(0)
  const bar = useRef<HTMLDivElement>(null)

  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = ORDER.indexOf(tab)
    if (i < 0) return
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const nextKey = rtl ? 'ArrowLeft' : 'ArrowRight'
    const prevKey = rtl ? 'ArrowRight' : 'ArrowLeft'
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? ORDER.length - 1
        : e.key === nextKey ? (i + 1) % ORDER.length
          : e.key === prevKey ? (i - 1 + ORDER.length) % ORDER.length
            : -1
    if (next < 0) return
    e.preventDefault()
    setTab(ORDER[next])
    bar.current?.querySelector<HTMLButtonElement>(`#stage-tab-${ORDER[next]}`)?.focus()
  }

  return (
    <section className="stage-workspace">
      <header className="stage-heading @container">
        <div className="min-w-0">
          <span className="stage-eyebrow">{mode === 'agent' ? 'COMPUTER-USE AGENT' : 'WORKSPACE'}</span>
          <h2>{mode === 'agent' ? 'إيجنت — تحكم كامل بالكمبيوتر' : project?.name || 'مساحة البناء'}</h2>
        </div>
        <div ref={bar} role="tablist" aria-label="ألواح المسرح" onKeyDown={onTabKey} className="seg min-w-0 max-w-full overflow-x-auto">
          <button id="stage-tab-preview" role="tab" aria-selected={tab === 'preview'} aria-controls="stage-panel-preview" tabIndex={tab === 'preview' ? 0 : -1}
            className="seg-item shrink-0" title={mode === 'agent' ? 'لوحة الإيجنت' : 'المعاينة'} aria-label={mode === 'agent' ? 'لوحة الإيجنت' : 'المعاينة'} onClick={() => setTab('preview')}>
            {mode === 'agent' ? <Bot size={14} /> : <Eye size={14} />}
            <span className="@max-[420px]:hidden">{mode === 'agent' ? 'الإيجنت' : 'المعاينة'}</span>
            {preview.errors > 0 && <span className="size-1.5 rounded-full bg-coral" />}
          </button>
          <button id="stage-tab-code" role="tab" aria-selected={tab === 'code'} aria-controls="stage-panel-code" tabIndex={tab === 'code' ? 0 : -1}
            className="seg-item shrink-0" title="الكود" aria-label="الكود" onClick={() => setTab('code')}>
            <Code2 size={14} />
            <span className="@max-[420px]:hidden">الكود</span>
          </button>
          <button id="stage-tab-terminal" role="tab" aria-selected={tab === 'terminal'} aria-controls="stage-panel-terminal" tabIndex={tab === 'terminal' ? 0 : -1}
            className="seg-item shrink-0" title="الطرفية" aria-label="الطرفية" onClick={() => setTab('terminal')}>
            <TerminalSquare size={14} />
            <span className="@max-[420px]:hidden">الطرفية</span>
            {runningProcs > 0 && <span className="size-1.5 rounded-full bg-jade" />}
          </button>
          <button id="stage-tab-log" role="tab" aria-selected={tab === 'log'} aria-controls="stage-panel-log" tabIndex={tab === 'log' ? 0 : -1}
            className="seg-item shrink-0" title="سجل الوكيل" aria-label="سجل الوكيل" onClick={() => setTab('log')}>
            <ScrollText size={14} />
            <span className="@max-[420px]:hidden">سجل الوكيل</span>
          </button>
        </div>
        {tab === 'preview' && mode !== 'agent' && <PreviewToolbar />}
      </header>
      <div className="stage-panel-area min-h-0 flex-1">
        <div id="stage-panel-preview" role="tabpanel" aria-labelledby="stage-tab-preview" tabIndex={0} className="h-full" hidden={tab !== 'preview'}><PreviewPane active={active} /></div>
        <div id="stage-panel-code" role="tabpanel" aria-labelledby="stage-tab-code" tabIndex={0} className="h-full" hidden={tab !== 'code'}><CodePane /></div>
        <div id="stage-panel-terminal" role="tabpanel" aria-labelledby="stage-tab-terminal" tabIndex={0} className="h-full" hidden={tab !== 'terminal'}><TerminalPane onProcsChange={setRunningProcs} /></div>
        <div id="stage-panel-log" role="tabpanel" aria-labelledby="stage-tab-log" tabIndex={0} className="h-full" hidden={tab !== 'log'}><LogPane /></div>
      </div>
    </section>
  )
}
