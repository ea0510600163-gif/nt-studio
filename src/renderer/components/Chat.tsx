import { AlertTriangle, ArrowDown, Bot, Check, ChevronDown, ChevronLeft, CircleAlert, Clock3, Copy, FilePlus2, FileText, FolderOpen, FolderPlus, ImagePlus, Info, Layers3, LoaderCircle, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, RotateCcw, SendHorizontal, Settings2, Sparkles, Square, TerminalSquare, WandSparkles, X } from 'lucide-react'
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem, Phase, PickedFile, PickedFolder, SkillInfo } from '@shared/types'
import ProjectPicker from './ProjectPicker'
import { Md } from '@/lib/md'
import { flowOf, formatDuration, groupTasks, groupTurns, type Block } from '@/lib/groups'
import { useStore } from '@/lib/store'
import ModelPicker from './ModelPicker'
import PermissionPicker from './PermissionPicker'
import PlanCard from './PlanCard'
import ExecutionFlow from './ExecutionFlow'
import ThinkPill from './ThinkPill'
import { CATS, toolMeta } from '@/lib/toolMeta'

const PHASE: Record<Phase, string> = {
  idle: 'جاهز',
  thinking: 'يفكّر',
  acting: 'ينفّذ',
  testing: 'يفحص النتيجة',
  compacting: 'يلخّص السياق',
  waiting: 'بانتظارك',
  retrying: 'يعيد المحاولة',
  stopping: 'جارٍ الإيقاف…'
}

const clockOf = (ts: number): string =>
  new Date(ts).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' })

const compactNum = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n)

const sameItems = (a: readonly ChatItem[], b: readonly ChatItem[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

const ACTIVE_CHIP = 'active:scale-[0.98]'

function AskCard({ item }: { item: Extract<ChatItem, { kind: 'ask' }> }) {
  const answer = useStore((s) => s.answer)
  const [text, setText] = useState('')
  const bead = item.answered == null ? 'running' : 'ok'
  return (
    <div className="relative rise r-5 border border-brass/50 bg-brass/5 p-3.5">
      <span className="bead" data-s={bead} />
      <p className="mb-2.5 whitespace-pre-wrap font-medium">{item.question}</p>
      {item.answered != null ? (
        <p className="text-mute">إجابتك: <span className="text-ink">{item.answered || '—'}</span></p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {item.options?.map((o) => <button key={o} className={`chip ${ACTIVE_CHIP}`} onClick={() => void answer(item.id, o)}>{o}</button>)}
          </div>
          <div className="flex gap-2">
            <input className="field" placeholder="أو اكتب إجابتك…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && void answer(item.id, text.trim())} />
            <button className="btn btn-brass" disabled={!text.trim()} onClick={() => void answer(item.id, text.trim())}>إرسال</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PendingAgent() {
  return (
    <div className="pending-agent rise" role="status" aria-label="الوكيل يحضّر الرد">
      <span className="pending-orb"><Bot size={13} strokeWidth={1.9} /></span>
      <span className="pending-dots" aria-hidden><i /><i /><i /></span>
    </div>
  )
}

function UserText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (open) return
    const el = ref.current
    if (!el) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, text])
  return (
    <>
      <p ref={ref} dir="auto" className="message-user-text" data-clamped={!open}>
        {text}
      </p>
      {clamped && (
        <button type="button" className="message-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'عرض أقل' : 'عرض المزيد'}
          <ChevronDown size={11} />
        </button>
      )}
    </>
  )
}

const Item = memo(function Item({ item, streaming, plain, regenerable }: { item: ChatItem; streaming: boolean; plain?: boolean; regenerable?: boolean }) {
  const [copied, setCopied] = useState(false)
  const regenerate = useStore((s) => s.regenerate)
  const running = useStore((s) => s.running)
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true) }
    catch { useStore.getState().notify('تعذّر النسخ إلى الحافظة', 'error') }
  }
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer) }, [copied])
  switch (item.kind) {
    case 'user':
      return (
        <div className="message-user-wrap rise">
          <div className="message-user">
            {item.images?.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {item.images.map((src, i) => <img key={i} src={src} alt="مرفق" className="max-h-32 r-2 border border-hair object-cover" />)}
              </div>
            ) : null}
            {item.text && <UserText text={item.text} />}
          </div>
          <div className="message-meta">
            {item.at ? <span className="num t-2xs text-faint">{clockOf(item.at)}</span> : null}
            <button
              type="button"
              className="message-action"
              title={copied ? 'تم النسخ' : 'نسخ الطلب'}
              aria-label={copied ? 'تم النسخ' : 'نسخ الطلب'}
              disabled={!item.text}
              onClick={() => void copy(item.text)}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      )
    case 'assistant':
      if (plain) return <div className="message-plain rise"><Md text={item.text} rtl /></div>
      return (
        <div className="message-assistant rise">
          <div className="message-label">
            <span>{streaming && item.streaming ? 'يكتب الآن' : 'الوكيل'}</span>
            <span className="message-actions">
              <button className="message-action" title={copied ? 'تم النسخ' : 'نسخ الرد'} aria-label={copied ? 'تم النسخ' : 'نسخ الرد'} disabled={!item.text} onClick={() => void copy(item.text)}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
              {regenerable && (
                <button
                  className="message-action"
                  title="إعادة توليد الرد"
                  aria-label="إعادة توليد الرد"
                  disabled={running}
                  onClick={() => void regenerate()}
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </span>
          </div>
          <div className={streaming && item.streaming ? 'cursor' : ''}><Md text={item.text} /></div>
        </div>
      )
    case 'task':
    case 'tool':
      return null
    case 'ask':
      return <AskCard item={item} />
    case 'thinking':
      return <ThinkPill item={item} />
    case 'notice': {
      const c = item.level === 'error' ? 'text-coral border-coral/35 bg-coral/8' : item.level === 'warn' ? 'text-brass-hi border-brass/35 bg-brass/8' : 'text-mute border-hair/60 bg-bg/50'
      const I = item.level === 'error' ? CircleAlert : item.level === 'warn' ? AlertTriangle : Info
      return (
        <div className={`relative rise flex items-start gap-2 rounded-lg border px-2.5 py-1.5 t-xs ${c}`}>
          <I size={13} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{item.text}</span>
        </div>
      )
    }
  }
})

function TurnBlock({ block, running, regenerableId }: { block: Extract<Block, { type: 'turn' }>; running: boolean; regenerableId: string | null }) {
  const [open, setOpen] = useState(false)
  const flow = useMemo(() => flowOf(block.work), [block.work])
  const tools = flow.reduce((n, e) => n + (e.type === 'row' && e.row.type === 'tool' ? 1 : 0), 0)
  const hasExec = flow.some((e) => e.type !== 'item')
  const usedTools = useMemo(() => {
    const names = new Set<string>()
    for (const e of flow) if (e.type === 'row' && e.row.type === 'tool') names.add(e.row.item.name)
    return [...names].slice(0, 5).map((name) => toolMeta(name, {}))
  }, [flow])
  useEffect(() => { if (!block.live) setOpen(false) }, [block.live])
  const itemNode = (item: ChatItem, plain: boolean) => (
    <Item item={item} plain={plain} streaming={running} regenerable={item.kind === 'assistant' && item.id === regenerableId} />
  )
  const tail = block.tail ? itemNode(block.tail, false) : null

  if (!hasExec) {
    return (
      <div className="turn">
        {flow.map((e) => (e.type === 'item' ? <Fragment key={e.item.id}>{itemNode(e.item, false)}</Fragment> : null))}
        {tail}
      </div>
    )
  }
  if (tools === 0) {
    return (
      <div className="turn">
        <ExecutionFlow entries={flow} live={block.live} renderItem={(item) => itemNode(item, true)} />
        {tail}
      </div>
    )
  }
  const bodyId = `turn-${block.id}`
  const expanded = block.live || open
  return (
    <div className="turn">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="turn-head flex w-fit max-w-full items-center gap-3 text-start"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          {block.live ? (
            <>
              <LoaderCircle size={16} className="spin shrink-0 text-brass-hi" />
              <span className="t-base font-semibold text-brass-hi">سير التنفيذ النشط</span>
            </>
          ) : (
            <>
              <span className="turn-tag mono t-3xl tracking-wide" dir="ltr">work</span>
              <span className="turn-tag t-xs"><span className="num">{tools}</span> أداة</span>
              <span className="turn-tag turn-icons t-xs flex items-center gap-1">
                {usedTools.map((m, i) => {
                  const Icon = m.icon
                  return <Icon key={i} size={12} strokeWidth={2} style={{ color: CATS[m.cat].color }} aria-hidden />
                })}
              </span>
              <span className="turn-tag turn-time num t-2xs">{formatDuration(block.ms)}</span>
            </>
          )}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-sky transition ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div id={bodyId} role="region" aria-label="سجل العمل" className="turn-body">
          <ExecutionFlow entries={flow} live={block.live} renderItem={(item) => itemNode(item, true)} />
        </div>
      )}
      {tail}
    </div>
  )
}

interface PendingImage {
  mediaType: string
  data: string
  url: string
}

interface SlashCommand {
  id: string
  label: string
  hint: string
  run: () => void
}

const MAX_IMAGE_MB = 4

function Composer({ sessionId }: { sessionId: string | null }) {
  const running = useStore((s) => s.running)
  const anyRunning = useStore((s) => s.running || s.sessions.some((x) => x.running))
  const phase = useStore((s) => s.phase)
  const phaseLabel = useStore((s) => s.phaseLabel)
  const needsResume = useStore((s) => s.needsResume)
  const send = useStore((s) => s.send)
  const stop = useStore((s) => s.stop)
  const resume = useStore((s) => s.resume)
  const notify = useStore((s) => s.notify)
  const noModel = useStore((s) => !s.providers.length || !s.settings?.defaultModel)
  const mode = useStore((s) => s.mode)
  const hasMessages = useStore((s) => s.items.length > 0)
  const providers = useStore((s) => s.providers)
  const defaultModel = useStore((s) => s.settings?.defaultModel ?? null)
  const skills = useStore((s) => s.skills)
  const usage = useStore((s) => s.usage)
  const activeSkill = useStore((s) => s.activeSkill)
  const setActiveSkill = useStore((s) => s.setActiveSkill)
  const openSettingsTab = useStore((s) => s.openSettingsTab)

  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([])
  const [pickedFolder, setPickedFolder] = useState<PickedFolder | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuView, setMenuView] = useState<'main' | 'skills'>('main')
  const [reading, setReading] = useState(0)
  const [slash, setSlash] = useState<string | null>(null)
  const [slashActive, setSlashActive] = useState(0)

  const readingRef = useRef(0)
  const submitting = useRef(false)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const fileRef = useRef<HTMLInputElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const menuWrap = useRef<HTMLDivElement>(null)

  const vision = useMemo(() => {
    if (!defaultModel) return true
    const m = providers.find((p) => p.id === defaultModel.providerId)?.models.find((x) => x.id === defaultModel.modelId)
    return m ? m.vision : true
  }, [providers, defaultModel])

  const slashCommands = useMemo<SlashCommand[]>(() => {
    const all: SlashCommand[] = [
      { id: 'skills', label: 'إدارة المهارات', hint: 'مكتبة المهارات وإنشاء مهارة جديدة', run: () => openSettingsTab('skills') },
      { id: 'prompt', label: 'تخصيص برومنت الوكلاء', hint: 'برومنت الوكيل الباني والمتحكّم بالكمبيوتر', run: () => openSettingsTab('prompts') },
      { id: 'settings', label: 'الإعدادات', hint: 'المزوّدون والنماذج والحدود', run: () => openSettingsTab('providers') },
      { id: 'projects', label: 'المشاريع', hint: 'فتح درج المشاريع', run: () => useStore.getState().setOverlay('projects') },
      { id: 'new', label: 'محادثة جديدة', hint: 'بدء شات فارغ', run: () => void useStore.getState().newSession() },
      { id: 'preview', label: 'المعاينة', hint: 'فتح لوحة المعاينة الحيّة', run: () => useStore.getState().focusTab('preview') },
      { id: 'code', label: 'الكود', hint: 'فتح شجرة الملفات', run: () => useStore.getState().focusTab('code') },
      { id: 'terminal', label: 'الطرفية', hint: 'فتح طرفية العمليات', run: () => useStore.getState().focusTab('terminal') },
      { id: 'log', label: 'سجل الوكيل', hint: 'فتح سجل الأدوات والتنبيهات', run: () => useStore.getState().focusTab('log') }
    ]
    const q = (slash ?? '').trim().toLowerCase()
    if (!q) return all
    return all.filter((c) => c.id.startsWith(q) || c.label.toLowerCase().includes(q))
  }, [slash, openSettingsTab])

  const slashSkills = useMemo(() => {
    const q = (slash ?? '').trim().toLowerCase()
    if (!q) return skills
    return skills.filter((s) => s.id.toLowerCase().includes(q) || s.label.toLowerCase().includes(q))
  }, [slash, skills])

  const slashOpen = slash !== null
  const slashIndex = Math.max(0, Math.min(slashActive, slashCommands.length + slashSkills.length - 1))

  const applySlashCommand = (c: SlashCommand) => {
    setText('')
    setSlash(null)
    c.run()
    ta.current?.focus()
  }

  const applySlashSkill = (s: SkillInfo) => {
    setActiveSkill(s)
    setText('')
    setSlash(null)
    notify(`فُعّلت مهارة «${s.label}»`, 'info')
    ta.current?.focus()
  }

  useEffect(() => {
    setText('')
    setImages([])
    setPickedFiles([])
    setPickedFolder(null)
    setMenuOpen(false)
    setSlash(null)
  }, [sessionId])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuWrap.current?.contains(e.target as Node)) {
        setMenuOpen(false)
        setMenuView('main')
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setMenuView('main')
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [text])

  const pickImageFiles = async (files: File[]) => {
    const pickedSession = sessionRef.current
    readingRef.current += 1
    setReading(readingRef.current)
    const next: PendingImage[] = []
    try {
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue
        if (f.size > MAX_IMAGE_MB * 1024 * 1024) {
          notify(`«${f.name}» أكبر من ${MAX_IMAGE_MB}MB — لم تُرفق`, 'warn')
          continue
        }
        const data = await new Promise<string>((res) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result).split(',')[1] ?? '')
          r.onerror = () => res('')
          r.readAsDataURL(f)
        })
        if (data) next.push({ mediaType: f.type, data, url: `data:${f.type};base64,${data}` })
      }
      if (next.length && pickedSession === sessionRef.current) setImages((cur) => [...cur, ...next].slice(0, 6))
    } finally {
      readingRef.current -= 1
      setReading(readingRef.current)
    }
  }

  const handlePickNativeFiles = async () => {
    setMenuOpen(false)
    setMenuView('main')
    try {
      const list = await window.nt.fs.pickFiles()
      if (!list.length) return
      const newImgs: PendingImage[] = []
      const newFiles: PickedFile[] = []
      for (const item of list) {
        if (item.image) {
          newImgs.push({
            mediaType: item.image.mediaType,
            data: item.image.data,
            url: `data:${item.image.mediaType};base64,${item.image.data}`
          })
        } else {
          newFiles.push(item)
        }
      }
      if (newImgs.length) setImages((cur) => [...cur, ...newImgs].slice(0, 6))
      if (newFiles.length) {
        setPickedFiles((cur) => {
          const map = new Map(cur.map((f) => [f.path, f]))
          for (const f of newFiles) map.set(f.path, f)
          return [...map.values()].slice(0, 10)
        })
      }
      ta.current?.focus()
    } catch (e) {
      notify(`تعذّر إرفاق الملف: ${(e as Error).message}`, 'error')
    }
  }

  const handlePickNativeFolder = async () => {
    setMenuOpen(false)
    setMenuView('main')
    try {
      const folder = await window.nt.fs.pickFolder()
      if (folder) {
        setPickedFolder(folder)
        ta.current?.focus()
      }
    } catch (e) {
      notify(`تعذّر إرفاق المجلد: ${(e as Error).message}`, 'error')
    }
  }

  const handleSelectSkill = (skill: SkillInfo) => {
    setActiveSkill(skill)
    setMenuOpen(false)
    setMenuView('main')
    ta.current?.focus()
  }

  const hasAttachments = images.length > 0 || pickedFiles.length > 0 || !!pickedFolder || !!activeSkill
  const canSubmit = !noModel && !!sessionId && reading === 0 && !(images.length > 0 && !vision) && (!!text.trim() || hasAttachments)

  const submit = async () => {
    if (submitting.current || !canSubmit) return
    submitting.current = true
    const parts: string[] = []
    if (activeSkill) {
      parts.push(`[المهارة المفعّلة: ${activeSkill.label} (${activeSkill.id})]\n${activeSkill.content}`)
    }
    if (pickedFolder) {
      parts.push(`[المجلد المرفق: ${pickedFolder.path}]\nمحتويات المجلد: ${pickedFolder.entries.join(', ') || '(فارغ)'}`)
    }
    for (const f of pickedFiles) {
      parts.push(
        f.preview
          ? `[الملف المرفق: ${f.path} (${f.size}B)]\n\`\`\`\n${f.preview}\n\`\`\``
          : `[الملف المرفق: ${f.path} (${f.size}B)]`
      )
    }
    if (text.trim()) {
      parts.push(text.trim())
    } else if (activeSkill) {
      parts.push(activeSkill.id === 'skill-creator' ? 'ساعدني في تصميم وإنشاء مهارة احترافية جديدة وحفظها في التطبيق.' : `نفّذ المطلوب وفق مهارة «${activeSkill.label}».`)
    } else if (pickedFolder || pickedFiles.length) {
      parts.push('افحص المرفقات وابدأ العمل عليها.')
    }

    const finalMessage = parts.join('\n\n')
    const payload = images.map((im) => ({ mediaType: im.mediaType, data: im.data }))
    setText('')
    setImages([])
    setPickedFiles([])
    setPickedFolder(null)
    setActiveSkill(null)
    try {
      await send(finalMessage, payload)
    } finally {
      submitting.current = false
      ta.current?.focus()
    }
  }

  return (
    <div className="composer-shell">
      <PlanCard />
      <div
        className="composer-box"
        data-running={running}
      >
        {needsResume && !running && (
          <button onClick={() => void resume()} className="btn btn-brass mb-2 w-full justify-center">
            <RotateCcw size={15} /> استئناف العمل من آخر حالة محفوظة
          </button>
        )}

        {images.length > 0 && !vision && (
          <div role="status" className="mb-2 flex items-start gap-1.5 r-2 border border-brass/45 bg-brass/10 px-[var(--sp-2)] py-[var(--sp-1)] t-xs text-brass-hi">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>نموذجك لا يدعم الصور؛ أزلها أو اختر نموذجاً يدعم الرؤية</span>
          </div>
        )}

        {(activeSkill || pickedFolder || pickedFiles.length > 0 || images.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {activeSkill && (
              <span className="composer-chip" data-kind="skill">
                <Sparkles size={12} className="shrink-0" />
                <span className="truncate">مهارة: {activeSkill.label}</span>
                <button
                  type="button"
                  aria-label="إزالة المهارة"
                  onClick={() => setActiveSkill(null)}
                  className="ms-0.5 grid size-4 place-items-center rounded-full hover:bg-black/20"
                >
                  <X size={10} strokeWidth={3} />
                </button>
              </span>
            )}
            {pickedFolder && (
              <span className="composer-chip">
                <FolderOpen size={12} className="shrink-0" />
                <span className="mono truncate" dir="ltr">{pickedFolder.name}</span>
                <button
                  type="button"
                  aria-label="إزالة المجلد"
                  onClick={() => setPickedFolder(null)}
                  className="ms-0.5 grid size-4 place-items-center rounded-full hover:bg-black/20"
                >
                  <X size={10} strokeWidth={3} />
                </button>
              </span>
            )}
            {pickedFiles.map((f) => (
              <span key={f.path} className="composer-chip" title={f.path}>
                <FileText size={12} className="shrink-0" />
                <span className="mono truncate" dir="ltr">{f.name}</span>
                <button
                  type="button"
                  aria-label="إزالة الملف"
                  onClick={() => setPickedFiles((cur) => cur.filter((x) => x.path !== f.path))}
                  className="ms-0.5 grid size-4 place-items-center rounded-full hover:bg-black/20"
                >
                  <X size={10} strokeWidth={3} />
                </button>
              </span>
            ))}
            {images.map((im, i) => (
              <span key={i} className="relative">
                <img src={im.url} alt="مرفق" className="h-14 r-2 border border-hair object-cover" />
                <button
                  type="button"
                  aria-label="إزالة الصورة"
                  onClick={() => setImages((cur) => cur.filter((_, k) => k !== i))}
                  className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center r-full border border-hair bg-raised text-mute transition hover:text-coral active:scale-90"
                >
                  <X size={11} strokeWidth={3} />
                </button>
              </span>
            ))}
          </div>
        )}

        {slashOpen && (
          <div className="slash-menu rise" role="listbox" aria-label="أوامر ومهارات سريعة">
            {slashCommands.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-0.5 t-2xs text-faint">أوامر</p>
                {slashCommands.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={i === slashIndex}
                    data-active={i === slashIndex}
                    className="slash-item"
                    onMouseEnter={() => setSlashActive(i)}
                    onClick={() => applySlashCommand(c)}
                  >
                    <span className="slash-icon"><TerminalSquare size={13} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{c.label}</span>
                      <span className="block truncate t-2xs text-mute">{c.hint}</span>
                    </span>
                    <span className="mono shrink-0 t-2xs text-faint">/{c.id}</span>
                  </button>
                ))}
              </>
            )}
            {slashSkills.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-1.5 t-2xs text-faint">مهارات</p>
                {slashSkills.map((s, i) => {
                  const idx = slashCommands.length + i
                  const isCreator = s.id === 'skill-creator'
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={idx === slashIndex}
                      data-active={idx === slashIndex}
                      className="slash-item"
                      onMouseEnter={() => setSlashActive(idx)}
                      onClick={() => applySlashSkill(s)}
                    >
                      <span className="slash-icon" style={isCreator ? { color: 'var(--color-brass-hi)' } : undefined}>
                        {isCreator ? <WandSparkles size={13} /> : <Sparkles size={12} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{s.label}</span>
                        <span className="block truncate t-2xs text-mute">{s.description}</span>
                      </span>
                      {isCreator && <span className="badge !h-4 !px-1.5 !text-[9px]" data-tone="jade">افتراضية</span>}
                    </button>
                  )
                })}
              </>
            )}
            {slashCommands.length === 0 && slashSkills.length === 0 && (
              <p className="px-2 py-3 text-center t-xs text-mute">لا نتيجة مطابقة</p>
            )}
          </div>
        )}

        <textarea
          ref={ta}
          rows={1}
          dir="auto"
          value={text}
          aria-label="اكتب طلبك للوكيل"
          disabled={noModel}
          onChange={(e) => {
            const v = e.target.value
            setText(v)
            if (v.startsWith('/') && !v.slice(1).includes(' ')) {
              setSlash(v.slice(1))
              setSlashActive(0)
            } else setSlash(null)
          }}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))?.getAsFile()
            if (file) {
              e.preventDefault()
              void pickImageFiles([file])
            }
          }}
          onKeyDown={(e) => {
            if (slashOpen) {
              const total = slashCommands.length + slashSkills.length
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSlashActive((a) => (total ? (a + 1) % total : 0))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSlashActive((a) => (total ? (a - 1 + total) % total : 0))
                return
              }
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                const command = slashCommands[slashIndex]
                const skill = slashSkills[slashIndex - slashCommands.length]
                if (command) { e.preventDefault(); applySlashCommand(command); return }
                if (skill) { e.preventDefault(); applySlashSkill(skill); return }
              }
              if (e.key === 'Escape') { e.preventDefault(); setSlash(null); return }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={
            noModel
              ? 'اختر نموذجاً من الأعلى أولاً'
              : activeSkill?.id === 'skill-creator'
                ? 'صف المهارة الاحترافية التي تريد من الوكيل صناعتها وحفظها في التطبيق…'
                : activeSkill
                  ? `اكتب طلبك لتنفيذه بمهارة «${activeSkill.label}»…`
                  : running
                    ? 'اكتب توجيهاً يصل للوكيل في خطوته القادمة…'
                    : mode === 'agent'
                      ? 'اطلب من الإيجنت فتح أي برنامج أو تنفيذ مهمة على جهازك…'
                      : 'اكتب رسالتك هنا…'
          }
          className={`block max-h-[200px] w-full resize-none bg-transparent pb-1 pt-0.5 outline-none placeholder:text-faint disabled:cursor-not-allowed disabled:bg-bg/40 disabled:opacity-45 ${text ? '' : 'text-right'}`}
        />

        <div className="flex items-center gap-2 pt-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void pickImageFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />

          <div ref={menuWrap}>
            <button
              type="button"
              className="composer-plus-btn disabled:cursor-not-allowed disabled:opacity-45"
              data-open={menuOpen}
              title="إضافة صورة، ملف، مجلد، أو مهارة"
              aria-label="قائمة الإضافات والمهارات"
              aria-expanded={menuOpen}
              disabled={noModel}
              onClick={() => {
                setMenuOpen((o) => !o)
                setMenuView('main')
                if (!menuOpen) void useStore.getState().refreshSkills().catch(() => {})
              }}
            >
              <Plus size={16} strokeWidth={2.4} />
            </button>

            {menuOpen && (
              <div className="composer-menu rise" role="menu" aria-label="إضافات المحادثة">
                {menuView === 'main' ? (
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      onClick={() => {
                        setMenuOpen(false)
                        fileRef.current?.click()
                      }}
                    >
                      <span className="composer-menu-icon"><ImagePlus size={12} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">إضافة صورة</div>
                        <div className="t-2xs text-mute">إرفاق صور أو لقطات شاشة (أو الصق بـ Ctrl+V)</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      onClick={() => void handlePickNativeFiles()}
                    >
                      <span className="composer-menu-icon"><FilePlus2 size={12} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">إضافة ملف</div>
                        <div className="t-2xs text-mute">إرفاق أي ملف من جهازك ليقرأه الوكيل ويعمل عليه</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      onClick={() => void handlePickNativeFolder()}
                    >
                      <span className="composer-menu-icon"><FolderPlus size={12} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">إضافة مجلد</div>
                        <div className="t-2xs text-mute">توجيه الوكيل للعمل مباشرة على مجلد كامل</div>
                      </div>
                    </button>

                    <div className="my-1 h-px bg-hair/80" />

                    <button
                      type="button"
                      role="menuitem"
                      className="composer-menu-item"
                      onClick={() => setMenuView('skills')}
                    >
                      <span className="composer-menu-icon">
                        <Sparkles size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span>استخدام مهارة</span>
                          <span className="badge !h-4 !px-1.5 !text-[9.5px]" data-tone="sky">{skills.length}</span>
                        </div>
                        <div className="t-2xs text-mute">اختر مهارة جاهزة أو مهارة صنع المهارات الافتراضية</div>
                      </div>
                      <ChevronLeft size={14} className="shrink-0 text-faint" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between border-b border-hair/70 px-2 pb-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setMenuView('main')}
                        className="inline-flex items-center gap-1 t-xs font-semibold text-mute hover:text-ink"
                      >
                        <ChevronLeft size={13} className="rotate-180" />
                        <span>رجوع</span>
                      </button>
                      <span className="t-2xs font-bold text-brass-hi">المهارات المتاحة</span>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false)
                          setMenuView('main')
                          openSettingsTab('skills')
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-hair bg-raised px-2 py-0.5 t-2xs text-mute hover:text-ink"
                        title="إدارة وإنشاء المهارات في الإعدادات"
                      >
                        <Settings2 size={11} />
                        <span>إدارة</span>
                      </button>
                    </div>

                    <div className="max-h-60 space-y-1 overflow-auto py-0.5">
                      {skills.map((s) => {
                        const isCreator = s.id === 'skill-creator'
                        const selected = activeSkill?.id === s.id
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleSelectSkill(s)}
                            className={`composer-menu-item !items-start ${selected ? 'bg-raised border border-brass/40' : ''}`}
                          >
                            <span
                              className="composer-menu-icon mt-0.5"
                            >
                              {isCreator ? <WandSparkles size={14} /> : <Sparkles size={13} />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate font-semibold text-ink">{s.label}</span>
                                {isCreator && <span className="badge !h-4 !px-1.5 !text-[9px]" data-tone="jade">افتراضية</span>}
                              </div>
                              <p className="line-clamp-2 t-2xs text-mute">{s.description}</p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <span className="flex min-w-0 items-center gap-2 t-xs text-mute">
            {phase === 'retrying'
              ? <span className="retry-dot" aria-hidden />
              : running ? <LoaderCircle size={13} className="spin shrink-0 text-brass" /> : <span className="size-1.5 shrink-0 r-full bg-jade" />}
            <span className={`truncate ${phase === 'retrying' ? 'retry-live' : ''}`}>{phaseLabel || PHASE[phase]}{
              phase === 'retrying' ? <span className="retry-ellipsis" aria-hidden><i>.</i><i>.</i><i>.</i></span> : null
            }</span>
          </span>
          <span className="flex-1" />
          {usage && usage.window > 0 && (
            <span className="composer-gauge num" title={`استهلاك السياق: ${usage.tokens.toLocaleString()} من ${usage.window.toLocaleString()} رمز`}>
              {compactNum(usage.tokens)} / {compactNum(usage.window)}
            </span>
          )}
          {anyRunning && (
            <button className="btn btn-danger h-[var(--sp-8)]! px-[var(--sp-3)]!" onClick={() => void stop()} title="إيقاف فوري">
              <Square size={12} fill="currentColor" /> إيقاف
            </button>
          )}
          <button className="btn btn-brass composer-send" disabled={!canSubmit} onClick={() => void submit()}>
            {running ? 'توجيه' : 'إرسال'} <SendHorizontal size={14} className="-scale-x-100" />
          </button>
        </div>
      </div>
      {mode === 'studio' && !hasMessages && <div className="composer-dock"><ProjectPicker /></div>}
    </div>
  )
}

export default function Chat({ railOpen, onRail }: { railOpen: boolean; onRail: () => void }) {
  const items = useStore((s) => s.items)
  const running = useStore((s) => s.running)
  const mode = useStore((s) => s.mode)
  const newSession = useStore((s) => s.newSession)
  const sessionId = useStore((s) => s.sessionId)
  const [away, setAway] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const raf = useRef(0)
  const segCache = useRef<{ items: readonly ChatItem[]; running: boolean; out: Block[] } | null>(null)

  const blocks = useMemo(() => {
    const prev = segCache.current
    if (prev && prev.running === running && sameItems(prev.items, items)) return prev.out
    const out = groupTurns(groupTasks(items, running), running)
    segCache.current = { items, running, out }
    return out
  }, [items, running])

  const regenerableId = useMemo(() => {
    let lastUser = -1
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k]
      if (b.type === 'item' && b.item.kind === 'user') { lastUser = k; break }
    }
    if (lastUser < 0) return null
    for (let k = lastUser + 1; k < blocks.length; k++) {
      const b = blocks[k]
      if (b.type === 'item') {
        if (b.item.kind === 'assistant') return b.item.id
        continue
      }
      if (b.tail && b.tail.kind === 'assistant') return b.tail.id
    }
    return null
  }, [blocks])

  const pending = useMemo(() => {
    if (!running) return false
    return !items.some((i) =>
      ((i.kind === 'assistant' || i.kind === 'thinking') && i.streaming) ||
      (i.kind === 'tool' && i.status === 'running') ||
      (i.kind === 'ask' && i.answered == null))
  }, [items, running])

  const toBottom = useCallback(() => {
    const el = box.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  useLayoutEffect(() => {
    stick.current = true
    setAway(false)
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [sessionId])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!stick.current || raf.current) return
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        toBottom()
      })
    })
    ro.observe(el)
    if (thread.current) ro.observe(thread.current)
    return () => {
      ro.disconnect()
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [toBottom, items.length === 0])

  useEffect(() => {
    if (!stick.current) return
    toBottom()
  }, [items.length, toBottom])

  return (
    <section className="chat-workspace">
      <header className="chat-header">
        <button
          type="button"
          className="icon-btn me-2"
          data-active={railOpen}
          aria-pressed={railOpen}
          aria-label={railOpen ? 'إخفاء الشريط الجانبي' : 'إظهار الشريط الجانبي'}
          title={railOpen ? 'إخفاء الشريط الجانبي واستعادة المساحة' : 'إظهار الشريط الجانبي'}
          onClick={onRail}
        >
          {railOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <h2>محادثة البناء</h2>
        <button
          type="button"
          className="icon-btn ms-2"
          disabled={running}
          aria-label={mode === 'agent' ? 'شات وكيل جديد' : 'محادثة جديدة'}
          title={mode === 'agent' ? 'شات وكيل جديد' : 'محادثة جديدة'}
          onClick={() => void newSession().catch(() => useStore.getState().notify('تعذّر فتح المحادثة', 'error'))}
        >
          <Plus size={14} />
        </button>
        <span className="flex-1" />
        <div className="flex items-center gap-2">
          <PermissionPicker />
          <ModelPicker />
        </div>
      </header>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
          stick.current = isNearBottom
          setAway(!isNearBottom)
        }}
        className="chat-scroll grid-bg"
      >
        {items.length > 0 && (
          <>
            <div ref={thread} className="thread mt-2" role="log" aria-label="رسائل المحادثة" aria-live="off">
              {blocks.map((b) =>
                b.type === 'turn' ? (
                  <TurnBlock key={b.id} block={b} running={running} regenerableId={regenerableId} />
                ) : (
                  <Item
                    key={b.item.id}
                    item={b.item}
                    streaming={b.item.kind === 'assistant' ? running : false}
                    regenerable={b.item.kind === 'assistant' && b.item.id === regenerableId}
                  />
                )
              )}
              {pending && <PendingAgent />}
            </div>
          </>
        )}
        {items.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-mark ai-ring"><Layers3 size={26} strokeWidth={1.2} /></div>
          </div>
        )}
      </div>
      {away && (
        <button
          className="back-to-latest"
          onClick={() => {
            stick.current = true
            setAway(false)
            toBottom()
          }}
        >
          <ArrowDown size={14} />العودة إلى آخر رسالة
        </button>
      )}
      <Composer sessionId={sessionId} />
    </section>
  )
}

