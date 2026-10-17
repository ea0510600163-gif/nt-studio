import { AlertTriangle, ArrowDown, ArrowUpLeft, Check, ChevronDown, CircleAlert, Clock3, Code2, Copy, Globe2, Info, Layers3, ListChecks, LoaderCircle, Paperclip, Play, RotateCcw, SendHorizontal, Sparkles, Square, WandSparkles, X } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem, Phase } from '@shared/types'
import { Md } from '@/lib/md'
import { formatDuration, groupTasks, groupTurns, type Block, type Segment } from '@/lib/groups'
import { useStore } from '@/lib/store'
import PlanCard from './PlanCard'
import TaskGroup from './TaskGroup'
import ThinkPill from './ThinkPill'

const PHASE: Record<Phase, string> = {
  idle: 'جاهز',
  thinking: 'يفكّر',
  acting: 'ينفّذ',
  testing: 'يفحص النتيجة',
  compacting: 'يلخّص السياق',
  waiting: 'بانتظارك',
  retrying: 'يعيد المحاولة'
}

const sameItems = (a: readonly ChatItem[], b: readonly ChatItem[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

const ACTIVE = 'active:scale-[0.99] active:bg-raised'
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

const Item = memo(function Item({ item, streaming, plain }: { item: ChatItem; streaming: boolean; plain?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true) }
    catch { useStore.getState().notify('تعذّر النسخ إلى الحافظة', 'error') }
  }
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer) }, [copied])
  switch (item.kind) {
    case 'user':
      return (
        <div className="message-user rise">
          {item.images?.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {item.images.map((src, i) => <img key={i} src={src} alt="مرفق" className="max-h-32 r-2 border border-hair object-cover" />)}
            </div>
          ) : null}
          {item.text && <p dir="auto" className="whitespace-pre-wrap break-words">{item.text}</p>}
        </div>
      )
    case 'assistant':
      if (plain) return <div className="message-plain rise"><Md text={item.text} /></div>
      return (
        <div className="message-assistant rise">
          <div className="message-label">
            <span>{streaming && item.streaming ? 'يكتب الآن' : 'الوكيل'}</span>
            <button className="message-copy icon-btn" title={copied ? 'تم النسخ' : 'نسخ الرد'} aria-label={copied ? 'تم النسخ' : 'نسخ الرد'} disabled={!item.text} onClick={() => void copy(item.text)}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <div className={streaming && item.streaming ? 'cursor' : ''}><Md text={item.text} /></div>
        </div>
      )
    case 'task':
      return (
        <div className="rise flex items-center gap-2.5 px-1 py-1 t-xs">
          <span className="h-px flex-1 bg-hair" />
          {item.status === 'done' ? (
            <>
              <Check size={12} strokeWidth={3} className="shrink-0 text-jade" />
              <span className="shrink-0 font-medium text-jade">تمّ</span>
            </>
          ) : (
            <>
              <Play size={11} className="shrink-0 text-brass-hi" />
              <span className="shrink-0 font-medium text-brass-hi">بدأ</span>
            </>
          )}
          <span className="min-w-0 truncate text-mute">{item.text}</span>
          <span className="h-px flex-1 bg-hair" />
        </div>
      )
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

function renderSeg(seg: Segment, plain: boolean, running: boolean) {
  if (seg.type === 'group') return <TaskGroup key={seg.id} id={seg.id} task={seg.task} rows={seg.rows} live={seg.live} />
  return (
    <Item
      key={seg.item.id}
      item={seg.item}
      plain={plain && seg.item.kind === 'assistant'}
      streaming={seg.item.kind === 'assistant' ? running : false}
    />
  )
}

/**
 * حاوية الدور:
 * - تبقى مفتوحة ومستقرة دون أي طيّ تلقائي مفاجئ عند انتهاء الدور.
 * - إذا احتوى الدور على مجموعة عمل واحدة فقط، تُعرض مباشرة دون رأس خارجي مكرر فوق رأس المجموعة.
 */
function TurnBlock({ block, running }: { block: Extract<Block, { type: 'turn' }>; running: boolean }) {
  const [open, setOpen] = useState(true)
  const groups = block.work.filter((s) => s.type === 'group')
  if (groups.length === 0) {
    return (
      <div className="turn">
        {block.work.map((s) => renderSeg(s, false, running))}
        {block.tail && <Item item={block.tail} streaming={running} />}
      </div>
    )
  }
  if (groups.length === 1 && block.work.length <= 2) {
    return (
      <div className="turn">
        {block.work.map((s) => renderSeg(s, true, running))}
        {block.tail && <Item item={block.tail} streaming={running} />}
      </div>
    )
  }
  const bodyId = `turn-${block.id}`
  return (
    <div className="turn">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`turn-head flex w-full items-center gap-2 text-start transition ${ACTIVE}`}
      >
        {block.live ? (
          <LoaderCircle size={12} className="spin shrink-0 text-brass-hi" />
        ) : (
          <Clock3 size={12} className="shrink-0 text-faint/80" />
        )}
        <span className="shrink-0 t-xs font-medium text-mute">
          {block.live ? 'سير التنفيذ النشط' : <>مراحل التنفيذ ({groups.length}) · <span className="num">{formatDuration(block.ms)}</span></>}
        </span>
        <span className="flex-1" />
        <ChevronDown size={12} className={`shrink-0 text-faint/60 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={bodyId} role="region" aria-label="سجل العمل" className="turn-body">
          {block.work.map((s) => renderSeg(s, true, running))}
        </div>
      )}
      {block.tail && <Item item={block.tail} streaming={running} />}
    </div>
  )
}

interface PendingImage {
  mediaType: string
  data: string
  url: string
}

const MAX_IMAGE_MB = 4

function Composer({ sessionId, seed }: { sessionId: string | null; seed: { text: string; nonce: number } | null }) {
  const running = useStore((s) => s.running)
  const phase = useStore((s) => s.phase)
  const phaseLabel = useStore((s) => s.phaseLabel)
  const needsResume = useStore((s) => s.needsResume)
  const send = useStore((s) => s.send)
  const stop = useStore((s) => s.stop)
  const resume = useStore((s) => s.resume)
  const notify = useStore((s) => s.notify)
  const noModel = useStore((s) => !s.providers.length || !s.settings?.defaultModel)
  const mode = useStore((s) => s.mode)
  const providers = useStore((s) => s.providers)
  const defaultModel = useStore((s) => s.settings?.defaultModel ?? null)
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [reading, setReading] = useState(0)
  const readingRef = useRef(0)
  const submitting = useRef(false)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const fileRef = useRef<HTMLInputElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)

  const vision = useMemo(() => {
    if (!defaultModel) return true
    const m = providers.find((p) => p.id === defaultModel.providerId)?.models.find((x) => x.id === defaultModel.modelId)
    return m ? m.vision : true
  }, [providers, defaultModel])

  useEffect(() => { setText(''); setImages([]) }, [sessionId])
  useEffect(() => { if (seed) { setText(seed.text); ta.current?.focus() } }, [seed])

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [text])

  const pickFiles = async (files: File[]) => {
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

  const submit = async () => {
    if (submitting.current || readingRef.current || noModel || !sessionId || (images.length > 0 && !vision) || (!text.trim() && !images.length)) return
    submitting.current = true
    const value = text.trim()
    const payload = images.map((im) => ({ mediaType: im.mediaType, data: im.data }))
    setText('')
    setImages([])
    try { await send(value, payload) }
    finally { submitting.current = false; ta.current?.focus() }
  }

  return (
    <div className="composer-shell">
      <div className="composer-box" data-running={running}>
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

        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((im, i) => (
              <span key={i} className="relative">
                <img src={im.url} alt="مرفق" className="h-16 r-2 border border-hair object-cover" />
                <button
                  aria-label="إزالة"
                  onClick={() => setImages((cur) => cur.filter((_, k) => k !== i))}
                  className="absolute -end-1.5 -top-1.5 grid size-5 place-items-center r-full border border-hair bg-raised text-mute transition hover:text-coral active:scale-90"
                >
                  <X size={11} strokeWidth={3} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={ta}
          rows={1}
          dir="auto"
          value={text}
          aria-label="اكتب طلبك للوكيل"
          disabled={noModel}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))?.getAsFile()
            if (file) {
              e.preventDefault()
              void pickFiles([file])
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={noModel ? 'اختر نموذجاً من الأعلى أولاً' : running ? 'اكتب توجيهاً يصل للوكيل في خطوته القادمة…' : mode === 'agent' ? 'الصق صورة المنشور واكتب أين تنشرها…' : 'صف ما تريد بناءه: موقع، لعبة، أداة… أو الصق صورة'}
          className="block max-h-[200px] w-full resize-none bg-transparent pb-1 pt-0.5 outline-none placeholder:text-faint disabled:cursor-not-allowed disabled:bg-bg/40 disabled:opacity-45"
        />
        <div className="flex items-center gap-2 pt-1.5">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void pickFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          <button className="icon-btn size-[var(--sp-8)]! disabled:cursor-not-allowed disabled:bg-bg/40 disabled:opacity-45" title="إرفاق صور (أو الصق بـ Ctrl+V)" disabled={noModel} onClick={() => fileRef.current?.click()}>
            <Paperclip size={15} />
          </button>
          <span className="flex min-w-0 items-center gap-2 t-xs text-mute">
            {phase === 'retrying'
              ? <span className="retry-dot" aria-hidden />
              : running ? <LoaderCircle size={13} className="spin shrink-0 text-brass" /> : <span className="size-1.5 shrink-0 r-full bg-jade" />}
            <span className={`truncate ${phase === 'retrying' ? 'retry-live' : ''}`}>{phaseLabel || PHASE[phase]}{
              phase === 'retrying' ? <span className="retry-ellipsis" aria-hidden><i>.</i><i>.</i><i>.</i></span> : null
            }</span>
          </span>
          <span className="flex-1" />
          {running && (
            <button className="btn btn-danger h-[var(--sp-8)]! px-[var(--sp-3)]!" onClick={() => void stop()} title="إيقاف فوري">
              <Square size={12} fill="currentColor" /> إيقاف
            </button>
          )}
          <button className="btn btn-brass composer-send" disabled={(!text.trim() && !images.length) || noModel || reading > 0 || (images.length > 0 && !vision)} onClick={() => void submit()}>
            {running ? 'توجيه' : 'إرسال'} <SendHorizontal size={14} className="-scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Chat() {
  const items = useStore((s) => s.items)
  const running = useStore((s) => s.running)
  const project = useStore((s) => s.project)
  const plan = useStore((s) => s.plan)
  const usage = useStore((s) => s.usage)
  const sessionId = useStore((s) => s.sessionId)
  const [away, setAway] = useState(false)
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null)
  const [revealPlan, setRevealPlan] = useState(0)
  const [planVisible, setPlanVisible] = useState(false)
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

  const toBottom = useCallback(() => {
    const el = box.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  useLayoutEffect(() => {
    stick.current = true
    setAway(false)
    setSeed(null)
    setPlanVisible(false)
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [sessionId])

  // تمرير مستقر: مراقب واحد متصل بالحاوية والخيط دون إعادة اشتراك مع كل رسالة
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

  const pct = usage && usage.window > 0 ? Math.min(100, Math.round((usage.tokens / usage.window) * 100)) : null

  return (
    <section className="chat-workspace">
      <header className="chat-header">
        <h2>محادثة البناء</h2>
        <span className="flex-1" />
        {pct !== null && (
          <span className="num me-2 t-2xs text-faint" title={`استهلاك السياق: ${usage!.tokens.toLocaleString()} من ${usage!.window.toLocaleString()} رمز`}>
            {pct}% سياق
          </span>
        )}
        {plan.length > 0 && (
          <button
            className={ACTIVE_CHIP + ' chip'}
            onClick={() => { setPlanVisible((v) => !v); setRevealPlan((n) => n + 1) }}
            aria-expanded={planVisible}
            title={planVisible ? 'إخفاء خطة التنفيذ' : 'عرض خطة التنفيذ وحالة كل بند'}
          >
            <ListChecks size={12} /> الخطة
            <span className="num">{plan.filter((p) => p.status === 'done').length}/{plan.length}</span>
          </button>
        )}
      </header>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
          stick.current = isNearBottom
          setAway(!isNearBottom)
        }}
        className="chat-scroll"
      >
        {items.length === 0 ? (
          <Welcome hasProject={!!project} onIdea={(text) => setSeed({ text, nonce: Date.now() })} />
        ) : (
          <>
            {planVisible && <PlanCard reveal={revealPlan} />}
            <div ref={thread} className="thread mt-2" role="log" aria-label="رسائل المحادثة" aria-live="off">
              {blocks.map((b) =>
                b.type === 'turn' ? (
                  <TurnBlock key={b.id} block={b} running={running} />
                ) : (
                  <Item key={b.item.id} item={b.item} streaming={b.item.kind === 'assistant' ? running : false} />
                )
              )}
            </div>
          </>
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
      <Composer sessionId={sessionId} seed={seed} />
    </section>
  )
}

const IDEAS = [
  { icon: Globe2, label: 'تجربة ويب استثنائية', desc: 'موقع يعكس هويتك', prompt: 'ابنِ موقعاً احترافياً لمقهى مختص بالقهوة السعودية، بتصميم أنيق ومتجاوب.' },
  { icon: Layers3, label: 'لوحة تحكم ذكية', desc: 'بيانات واضحة. قرارات أفضل.', prompt: 'ابنِ لوحة تحكم احترافية لإدارة المشاريع وتتبع تقدم المهام، مع بحث وتصفية.' },
  { icon: WandSparkles, label: 'فكرة خارج المألوف', desc: 'حوّل الإلهام إلى تجربة', prompt: 'ابنِ لعبة ثعبان بتصميم راقٍ، وتحكم بلوحة المفاتيح ومستويات صعوبة.' },
  { icon: Code2, label: 'أداة تصنع الفرق', desc: 'حل صغير. تأثير كبير.', prompt: 'ابنِ أداة لتنظيم الملاحظات البرمجية، مع تصنيف وبحث وتصدير.' }
]

function Welcome({ hasProject, onIdea }: { hasProject: boolean; onIdea: (text: string) => void }) {
  const ready = useStore((s) => !!s.settings?.defaultModel)
  return (
    <div className="chat-welcome">
      <div className="welcome-orb"><Sparkles size={29} strokeWidth={1.4} /></div>
      <span className="welcome-kicker">YOUR NEXT BIG IDEA</span>
      <h1>فكرتك تستحق<br /><span>أكثر من مجرد كود.</span></h1>
      <p>{hasProject ? 'ذاكرة مشروعك حاضرة. لنصنع الخطوة التالية.' : 'من أول فكرة إلى آخر تفصيلة. وكيل يبني، يشغّل، ويفحص — وأنت تقود الرؤية.'}</p>
      {ready && !hasProject && <div className="idea-grid">{IDEAS.map(({ icon: Icon, label, desc, prompt }) => <button key={label} className="idea-card" onClick={() => onIdea(prompt)}><span className="idea-icon"><Icon size={17} /></span><strong>{label}</strong><span>{desc}</span><ArrowUpLeft className="idea-arrow" size={14} /></button>)}</div>}
      <div className="welcome-note"><span className="status-dot" />بيئة محلية · تحكم كامل · تنفيذ مرئي</div>
    </div>
  )
}
