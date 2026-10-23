import { Check, ChevronDown, Code2, Compass, Copy, LoaderCircle, TerminalSquare, X, Zap } from 'lucide-react'
import { Fragment, memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import type { ChatItem } from '@shared/types'
import { type AssistantItem, type FlowEntry, type Row, type ToolItem } from '@/lib/groups'
import { useStore } from '@/lib/store'
import { CATS, parseSearchSources, toolMeta } from '@/lib/toolMeta'
import DiffView from './DiffView'
import ThinkPill from './ThinkPill'

const MAX_ROWS = 200
const FILE_NAV_TOOLS = new Set(['read_file', 'write_file', 'edit_file'])
const SHELL_NAV_TOOLS = new Set(['run_command', 'read_process_output'])

const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

function SubAgentCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const raw = (item.input ?? {}) as Record<string, unknown>
  const isExec = raw.agent === 'execute'
  const title = String(raw.title || (isExec ? 'مهمة تنفيذ' : 'مهمة استكشاف')).trim()
  const promptText = String(raw.prompt || '').trim()
  const running = item.status === 'running'
  const isErr = item.status === 'error'

  const lines = useMemo(() => (item.output ?? '').split('\n').filter(Boolean), [item.output])
  const lastLiveLine = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('▸') || lines[i].startsWith('✓') || lines[i].startsWith('✗') || lines[i].startsWith('⚡')) return lines[i]
    }
    return lines[lines.length - 1] ?? ''
  }, [lines])

  const opCount = useMemo(() => lines.filter((l) => l.startsWith('✓') || l.startsWith('✗')).length, [lines])

  return (
    <div className="subagent-card" data-kind={isExec ? 'execute' : 'explore'} data-status={item.status}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="subagent-head flex w-full items-center gap-2.5 text-start transition"
      >
        <span className="subagent-orb">
          {running ? (
            <LoaderCircle size={13} className="spin" />
          ) : isExec ? (
            <Zap size={13} />
          ) : (
            <Compass size={13} />
          )}
        </span>
        <span className="subagent-badge">
          {isExec ? 'وكيل التنفيذ' : 'وكيل الاستكشاف'}
        </span>
        <span className="min-w-0 flex-1 truncate t-xs font-semibold text-ink">
          {title}
        </span>
        {opCount > 0 && (
          <span className="num shrink-0 rounded-full bg-bg/70 px-2 py-0.5 t-2xs text-mute">
            {opCount} خطوة
          </span>
        )}
        {running ? (
          <span className="subagent-live-pill">نشط الآن</span>
        ) : isErr ? (
          <X size={12} strokeWidth={3} className="shrink-0 text-mute" />
        ) : (
          <Check size={12} strokeWidth={2.8} className="shrink-0 text-jade" />
        )}
        {item.ms != null && !running && (
          <span className="num shrink-0 t-2xs text-faint">{fmtMs(item.ms)}</span>
        )}
        <ChevronDown size={12} className={`shrink-0 text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {running && lastLiveLine && !open && (
        <div className="subagent-ticker mono truncate" dir="auto">
          {lastLiveLine}
        </div>
      )}

      {open && (
        <div className="subagent-body">
          {promptText && (
            <div className="subagent-mission">
              <span className="t-2xs font-semibold text-faint">المهمة الموكلة:</span>
              <p className="mt-0.5 whitespace-pre-wrap t-xs text-mute">{promptText}</p>
            </div>
          )}
          {item.output && (
            <pre className="subagent-output mono max-h-72 overflow-auto whitespace-pre-wrap break-words t-xs">
              {item.output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolDetails({ item }: { item: ToolItem }) {
  const [showInput, setShowInput] = useState(false)
  const [copied, setCopied] = useState(false)
  const openFileInStage = useStore((s) => s.openFileInStage)
  const setTab = useStore((s) => s.setTab)

  const sources = useMemo(() => (item.name === 'web_search' ? parseSearchSources(item.output ?? '') : []), [item.name, item.output])

  const filePath = useMemo(() => {
    if (!FILE_NAV_TOOLS.has(item.name) || !item.input || typeof item.input !== 'object') return ''
    const p = (item.input as { path?: unknown }).path
    return typeof p === 'string' ? p.trim() : ''
  }, [item.name, item.input])

  const copyOut = async () => {
    if (!item.output) return
    try {
      await navigator.clipboard.writeText(item.output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="mt-1 mb-1.5 space-y-2 rounded-lg border border-hair/60 bg-bg/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
        <span className="mono">{item.name}</span>
        <span className="flex-1" />
        {filePath && (
          <button
            type="button"
            onClick={() => openFileInStage(filePath)}
            className="inline-flex items-center gap-1 rounded-md border border-hair bg-surface px-2 py-0.5 text-[11px] text-mute transition hover:border-brass/50 hover:text-ink"
          >
            <Code2 size={11} /> فتح في الكود
          </button>
        )}
        {SHELL_NAV_TOOLS.has(item.name) && (
          <button
            type="button"
            onClick={() => setTab('terminal')}
            className="inline-flex items-center gap-1 rounded-md border border-hair bg-surface px-2 py-0.5 text-[11px] text-mute transition hover:border-brass/50 hover:text-ink"
          >
            <TerminalSquare size={11} /> عرض في الطرفية
          </button>
        )}
        {item.output && (
          <button
            type="button"
            onClick={() => void copyOut()}
            className="inline-flex items-center gap-1 rounded-md border border-hair bg-surface px-2 py-0.5 text-[11px] text-mute transition hover:text-ink"
          >
            {copied ? <Check size={11} className="text-jade" /> : <Copy size={11} />}
            {copied ? 'نُسخ' : 'نسخ المخرجات'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowInput((v) => !v)}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-faint transition hover:bg-raised hover:text-mute"
        >
          {showInput ? 'إخفاء المعطيات' : 'المعطيات'}
        </button>
      </div>

      {showInput && (
        <pre className="mono max-h-36 overflow-auto rounded-md border border-hair/50 bg-surface/70 p-2 whitespace-pre-wrap break-all t-2xs text-faint">
          {JSON.stringify(item.input, null, 2)}
        </pre>
      )}

      {item.diff && <DiffView diff={item.diff} />}

      {sources.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {sources.map((s) => (
            <a key={s.n} className="source-chip" href={s.url} target="_blank" rel="noreferrer noopener" title={s.snippet}>
              <span className="source-chip-num num">{s.n}</span>
              <span className="min-w-0 flex-1">
                <span className="source-chip-title block truncate">{s.title || s.domain}</span>
                <span className="source-chip-domain block truncate" dir="ltr">{s.domain}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      {item.output && (
        <pre className="mono max-h-64 overflow-auto rounded-md border border-hair/40 bg-surface/50 p-2.5 whitespace-pre-wrap break-words t-xs text-mute">
          {item.output}
        </pre>
      )}

      {item.image && (
        <img src={item.image} alt="لقطة شاشة من المعاينة" className="max-h-64 w-full r-3 border border-hair/50 object-contain bg-surface" />
      )}
    </div>
  )
}

const shellWord = (item: ToolItem): string | null => {
  if (item.status === 'running') return null
  const out = item.output ?? ''
  const m = out.match(/exit code:\s*(-?\d+)/) ?? out.match(/انته[تى] برمز\s*(-?\d+)/)
  const code = m ? Number(m[1]) : null
  return (code === null ? item.status === 'ok' : code === 0) ? 'نجح' : 'فشل'
}

const FlowRow = memo(function FlowRow({ row, open, onToggle }: { row: Row; open: boolean; onToggle: (key: string) => void }) {
  if (row.type === 'think') {
    return <ThinkPill item={row.item} variant="row" open={open} onToggle={() => onToggle(row.key)} />
  }
  if (row.type !== 'tool') return null
  if (row.item.name === 'spawn_agent') return <SubAgentCard item={row.item} />
  const m = toolMeta(row.item.name, row.item.input)
  const Icon = m.icon
  const diff = row.item.diff
  const failWord = shellWord(row.item)
  const running = row.item.status === 'running'
  const isErr = row.item.status === 'error'
  const rowBodyId = `${row.key}-body`
  const expandable = !!(diff || row.item.output || row.item.image || row.item.input)
  return (
    <>
      <button
        type="button"
        onClick={() => expandable && onToggle(row.key)}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? rowBodyId : undefined}
        aria-disabled={!expandable}
        data-status={row.item.status}
        data-open={open}
        className={`ev-row ev-tool group flex w-full items-center gap-2 r-2 px-2 py-1 text-start transition ${expandable ? ' cursor-pointer' : 'cursor-default'}`}
      >
        <span className="ev-icon" style={{ color: CATS[m.cat].color }}>
          <Icon size={15} strokeWidth={1.9} />
        </span>
        <span className={`shrink-0 t-xs font-medium ${running ? 'stage-wave' : 'ev-label'}`}>{m.label}</span>
        {m.arg && (
          <span className="ev-arg mono min-w-0 truncate t-2xs" dir="ltr">
            {m.arg}
          </span>
        )}
        {diff && (diff.added > 0 || diff.removed > 0) && (
          <span className="ev-diff num shrink-0 t-2xs" dir="ltr">
            {diff.added > 0 && <span className="text-jade/90">+{diff.added}</span>}
            {diff.added > 0 && diff.removed > 0 && ' '}
            {diff.removed > 0 && <span className="text-coral/90">−{diff.removed}</span>}
          </span>
        )}
        {failWord && failWord !== 'نجح' && (
          <span className="shrink-0 t-2xs font-medium text-coral/90">{failWord}</span>
        )}
        <span className="flex-1" />
        {running ? (
          <LoaderCircle size={12} className="spin shrink-0 text-brass-hi" />
        ) : isErr ? (
          <X size={12} strokeWidth={2.8} className="shrink-0 text-coral" />
        ) : null}
        {row.item.ms != null && !running && (
          <span className="ev-time num shrink-0 t-2xs">{fmtMs(row.item.ms)}</span>
        )}
        {expandable && (
          <ChevronDown size={12} className={`ev-chevron shrink-0 transition ${open ? 'rotate-180 opacity-90' : ''}`} />
        )}
      </button>
      {open && (
        <div id={rowBodyId} role="region" aria-label="تفاصيل الأداة" className="ev-details">
          <ToolDetails item={row.item} />
        </div>
      )}
    </>
  )
})

function NodeHead({ done, active, kind, children }: { done: boolean; active: boolean; kind: 'stage' | 'text'; children: ReactNode }) {
  return (
    <div className="stage-head" data-done={done} data-active={active} data-kind={kind}>
      <span className="stage-node" aria-hidden>
        {done ? (
          <Check size={10} strokeWidth={3} className="text-jade" />
        ) : (
          <LoaderCircle size={11} className="spin text-brass-hi" />
        )}
      </span>
      {children}
    </div>
  )
}

const windowStart = (entries: FlowEntry[]): number => {
  let rows = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'row' && ++rows > MAX_ROWS) return i + 1
  }
  return 0
}

type Body = Exclude<FlowEntry, { type: 'stage' }>
type Head = Extract<FlowEntry, { type: 'stage' }> | { type: 'item'; item: AssistantItem }
type Branch = { head: Head | null; headIndex: number; body: Body[] }

const opensBranch = (e: FlowEntry): e is Head => e.type === 'stage' || (e.type === 'item' && e.item.kind === 'assistant')

const isRunningTool = (e: Body): boolean => e.type === 'row' && e.row.type === 'tool' && e.row.item.status === 'running'

const branchesOf = (entries: FlowEntry[], start: number): Branch[] => {
  const out: Branch[] = []
  for (let i = start; i < entries.length; i++) {
    const e = entries[i]
    if (opensBranch(e)) out.push({ head: e, headIndex: i, body: [] })
    else if (out.length) out[out.length - 1].body.push(e as Body)
    else out.push({ head: null, headIndex: i, body: [e as Body] })
  }
  return out
}

const bodyKey = (e: Body): string => (e.type === 'item' ? e.item.id : e.row.key)

export default function ExecutionFlow({ entries, live, renderItem }: { entries: FlowEntry[]; live: boolean; renderItem: (item: ChatItem) => ReactNode }) {
  const [openRows, setOpenRows] = useState<Readonly<Record<string, boolean>>>({})
  const [showAll, setShowAll] = useState(false)
  const toggle = useCallback((key: string) => setOpenRows((p) => ({ ...p, [key]: !p[key] })), [])
  const start = showAll ? 0 : windowStart(entries)
  const hiddenRows = entries.slice(0, start).filter((e) => e.type === 'row').length
  const branches = branchesOf(entries, start)
  const last = entries.length - 1

  const renderBody = (e: Body) => {
    if (e.type === 'item') return <Fragment key={e.item.id}>{renderItem(e.item)}</Fragment>
    const runningRow = isRunningTool(e)
    return (
      <div key={e.row.key} className="ev-item rise" data-running={runningRow}>
        <FlowRow row={e.row} open={!!openRows[e.row.key]} onToggle={toggle} />
      </div>
    )
  }

  return (
    <div className="ev-feed" data-live={live}>
      {start > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="t-2xs self-start rounded px-1.5 py-0.5 text-faint transition hover:bg-raised hover:text-mute"
        >
          عرض العمليات الأقدم (<span className="num">{hiddenRows}</span>)
        </button>
      )}
      {branches.map((b, bi) => {
        const head = b.head
        if (!head) {
          return (
            <div key={bodyKey(b.body[0])} className="stage-group" data-headless="true">
              <div className="stage-branch">{b.body.map(renderBody)}</div>
            </div>
          )
        }
        const done = head.type === 'stage'
          ? !live || head.status === 'done'
          : !(live && bi === branches.length - 1 && (b.body.length === 0 || b.body.some(isRunningTool)))
        const active = !done && bi === branches.length - 1
        return (
          <div key={head.type === 'stage' ? head.key : head.item.id} className="stage-group" data-done={done} data-active={active}>
            {head.type === 'stage' ? (
              <NodeHead done={done} active={active} kind="stage">
                <span className={`font-semibold ${!done && b.headIndex === last ? 'stage-wave' : 'text-ink/90'}`} dir="auto">
                  {head.text}
                </span>
              </NodeHead>
            ) : (
              <NodeHead done={done} active={active} kind="text">
                <div className="min-w-0 flex-1">{renderItem(head.item)}</div>
              </NodeHead>
            )}
            {b.body.length > 0 && <div className="stage-branch">{b.body.map(renderBody)}</div>}
          </div>
        )
      })}
    </div>
  )
}
