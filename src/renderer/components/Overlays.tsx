import { Boxes, FolderOpen, Gauge, Layers, type LucideIcon, MessageSquarePlus, Monitor, Moon, Palette, Plus, RotateCcw, Search, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { useTheme, type ThemeMode } from '@/lib/theme'
import { confirmAction, ConfirmDialogHost, isConfirmOpen, trapDialogFocus } from './ConfirmDialog'
import ProviderForm from './ProviderForm'

/**
 * الحوار القياسي: سطح `.pop` واحد (r-5 = 16px = rounded-2xl السابق) بحدّ شعري،
 * عنوان مرجعي عبر aria-labelledby، وحصر Tab داخله، وإرجاع التركيز عند الإغلاق.
 * لا يُصدَّر: «حوار واحد مفتوح في كل لحظة» قاعدة يحفظها المُنادُون أدناه، وهم
 * وحدهم من يملكون استدعاءه.
 */
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  // تأثير واحد عند التركيب فقط: لو أُعيد مع كل render لفقد `restore` معناه
  // (سيصبح العنصر المركّز داخل الحوار نفسه) ولقفز التركيز مع كل كتابة.
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null
    const el = panel.current
    el?.focus({ preventScroll: true })
    const k = (e: KeyboardEvent) => {
      // حين يكون حوار التأكيد مفتوحاً هو يملك Escape/Tab، لا هذا الحوار
      if (isConfirmOpen()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key === 'Tab') trapDialogFocus(el, e)
    }
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('keydown', k)
      if (restore && document.contains(restore)) restore.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`pop rise r-5 flex max-h-full w-full flex-col overflow-hidden ${wide ? 'max-w-[760px]' : 'max-w-[540px]'}`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-hair px-5 py-3.5">
          <h2 id={titleId} className="font-display t-xl font-bold tracking-wide">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
        </header>
        {/* scrollbar-gutter: فتح الحوار لا يزحزح محتواه عند ظهور شريط التمرير */}
        <div className="overflow-auto p-5 [scrollbar-gutter:stable]">{children}</div>
      </div>
      <ConfirmDialogHost />
    </div>
  )
}

/** عنوان قسم بأيقونة ووصف بسطر — يفكّ تكديس الأقسام المسطّح */
function SectionHead({ icon: I, title, desc, action }: { icon: LucideIcon; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center r-2 border border-hair bg-raised text-brass-hi"><I size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="font-display t-base font-bold">{title}</h3>
          {action}
        </div>
        <p className="t-sm text-mute">{desc}</p>
      </div>
    </div>
  )
}

/** نصّ خطأ مقروء: IPC يغلّف الاستثناءات بعبارة «Error invoking remote method …» */
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': /, '')

export function ProjectsDrawer() {
  const projects = useStore((s) => s.projects)
  const project = useStore((s) => s.project)
  const setOverlay = useStore((s) => s.setOverlay)
  const openProject = useStore((s) => s.openProject)
  const openNewChatFor = useStore((s) => s.openNewChatFor)
  const newSession = useStore((s) => s.newSession)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const notify = useStore((s) => s.notify)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(() => projects.length === 0)
  const [busy, setBusy] = useState('')
  type Row = (typeof projects)[number]

  // تحديث عند الفتح + علم تحميل: القائمة تُفتح على هياكل وميض لا على فراغ
  useEffect(() => {
    let alive = true
    void refreshProjects().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [refreshProjects])

  const undo = (p: Row) => {
    void (async () => {
      const ok = await confirmAction({
        title: 'التراجع إلى آخر نقطة استرجاع',
        message: `سيُلغى ما تغيّر في «${p.name}» بعد آخر نقطة استرجاع. لا يمكن الرجوع عن هذا الإجراء.`,
        confirmLabel: 'تراجع',
        tone: 'coral'
      })
      if (!ok) return
      setBusy(p.id)
      try {
        setMsg(await window.nt.projects.undo(p.id))
      } catch (e) {
        notify(`تعذّر التراجع: ${errText(e)}`, 'error')
      } finally {
        setBusy('')
      }
    })()
  }

  const reveal = (p: Row) => {
    setBusy(p.id)
    void window.nt.projects.reveal(p.id).catch((e) => notify(`تعذّر فتح المجلد: ${errText(e)}`, 'error')).finally(() => setBusy(''))
  }

  const needle = q.trim().toLowerCase()
  const rows = needle ? projects.filter((p) => `${p.name} ${p.description} ${p.slug} ${p.stack}`.toLowerCase().includes(needle)) : projects
  const showSkeleton = loading && projects.length === 0

  return (
    <Modal title="المشاريع" onClose={() => setOverlay(null)}>
      <div className="space-y-3">
        <button className="btn btn-brass w-full justify-center" onClick={() => void newSession()}><Plus size={15} /> محادثة جديدة</button>
        <p className="t-sm text-mute">محادثة بلا مشروع. يُنشئ الوكيل مجلد المشروع تلقائياً عند أول طلب بناء.</p>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-faint" aria-hidden />
          {/* .field قاعدة بلا طبقة تتغلّب على أدوات الحاشية — المسافة تأتي من المقياس مباشرة */}
          <input className="field" style={{ paddingInlineStart: 'var(--sp-8)' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الوصف أو التقنية…" aria-label="بحث في المشاريع" />
        </div>
        {needle && !showSkeleton && <p className="num t-2xs text-faint">{rows.length} من {projects.length}</p>}

        {showSkeleton ? (
          <ul className="space-y-2">
            {[0, 1, 2].map((i) => (
              <li key={i} className="row-hover p-3.5">
                <div className="skeleton h-3.5 w-1/3" />
                <div className="skeleton mt-2 h-2.5 w-2/3" />
                <div className="skeleton mt-2 h-2 w-1/2" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center t-md text-mute">
            {needle ? `لا نتائج تطابق «${q.trim()}».` : 'لا مشاريع بعد. اكتب أول طلب وسيُنشأ مجلده تلقائياً.'}
          </p>
        ) : (
          <ul className="space-y-2" aria-busy={loading}>
            {rows.map((p) => (
              <li key={p.id} className="row-hover flex items-start gap-3 p-3.5" data-active={project?.id === p.id}>
                <button className="min-w-0 flex-1 text-start" onClick={() => void openProject(p.id)}>
                  <span className="flex items-center gap-2">
                    <span className="truncate font-display t-base font-bold">{p.name}</span>
                    {/* projects:list يعيد sessionId واحداً (آخر جلسة): مؤشّر وجود محادثة لا عدّاد */}
                    <span className="badge" data-tone={p.sessionId ? 'jade' : 'mute'}>{p.sessionId ? 'محادثة' : 'بلا محادثة'}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block t-sm text-mute">{p.description}</span>
                  <span className="mono mt-1.5 block truncate t-2xs text-faint">{p.dir}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="icon-btn" disabled={busy === p.id} title="شات جديد على هذا المشروع" onClick={() => void openNewChatFor(p.id)}><MessageSquarePlus size={15} /></button>
                  <button className="icon-btn" disabled={busy === p.id} title="فتح المجلد" onClick={() => reveal(p)}><FolderOpen size={15} /></button>
                  <button className="icon-btn" disabled={busy === p.id} title="تراجع إلى آخر نقطة استرجاع" onClick={() => undo(p)}><RotateCcw size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="t-md text-jade">{msg}</p>}
      </div>
    </Modal>
  )
}

const LIMITS: { k: 'maxSteps' | 'commandTimeoutSec' | 'compactAtPercent' | 'maxOutputTokens'; label: string; min: number; max: number; hint: string }[] = [
  { k: 'maxSteps', label: 'حد الخطوات', min: 10, max: 5000, hint: '10 – 5,000 دورة' },
  { k: 'commandTimeoutSec', label: 'مهلة الأمر (ثانية)', min: 10, max: 3600, hint: '10 – 3,600 ثانية' },
  { k: 'compactAtPercent', label: 'تلخيص السياق عند %', min: 30, max: 95, hint: '30 – 95%' },
  { k: 'maxOutputTokens', label: 'أقصى tokens للرد', min: 1000, max: 400000, hint: '1,000 – 400,000' }
]

export function SettingsModal() {
  const providers = useStore((s) => s.providers)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setOverlay = useStore((s) => s.setOverlay)
  const refreshProviders = useStore((s) => s.refreshProviders)
  const notify = useStore((s) => s.notify)
  const theme = useTheme()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [root, setRoot] = useState(settings?.workspaceRoot ?? '')
  const [persona, setPersona] = useState(settings?.persona ?? '')

  // مساحة العمل محكومة من الخارج: أي تغيير من مصدر آخر ينعكس في الحقل
  useEffect(() => { setRoot(settings?.workspaceRoot ?? '') }, [settings?.workspaceRoot])
  useEffect(() => { setPersona(settings?.persona ?? '') }, [settings?.persona])

  if (!settings) return null
  const models = providers.flatMap((p) => p.models.map((m) => ({ providerId: p.id, modelId: m.id, label: `${p.name} · ${m.id}` })))
  const key = (r: { providerId: string; modelId: string } | null) => (r ? `${r.providerId}::${r.modelId}` : '')
  const pick = (v: string) => { const [providerId, ...rest] = v.split('::'); return v ? { providerId, modelId: rest.join('::') } : null }

  if (editing) {
    return (
      <Modal title={editing === 'new' ? 'مزود جديد' : 'تعديل المزود'} onClose={() => setEditing(null)} wide>
        <ProviderForm initial={providers.find((p) => p.id === editing)} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
      </Modal>
    )
  }

  const rootTrim = root.trim()
  const rootError = rootTrim === '' ? 'المسار مطلوب.' : /[\\/]$/.test(rootTrim) ? 'لا تجعل المسار ينتهي بفاصل (\\ أو /).' : ''
  const commitRoot = () => {
    if (rootError) {
      notify(`مجلد مساحة العمل: ${rootError}`, 'warn')
      setRoot(settings.workspaceRoot)
      return
    }
    if (rootTrim !== settings.workspaceRoot) {
      void setSettings({ workspaceRoot: rootTrim }).catch((e) => notify(`تعذّر حفظ المجلد: ${errText(e)}`, 'error'))
    }
  }

  const commitPersona = () => {
    const v = persona.trim()
    if (v !== (settings.persona ?? '')) {
      void setSettings({ persona: v }).catch((e) => notify(`تعذّر حفظ الشخصية: ${errText(e)}`, 'error'))
    }
  }

  const remove = (p: { id: string; name: string }) => {
    void (async () => {
      const ok = await confirmAction({
        title: 'حذف المزود',
        message: `سيُحذف «${p.name}» وكل نماذجه من الإعدادات. لا يمكن التراجع عن الحذف.`,
        confirmLabel: 'حذف',
        tone: 'coral'
      })
      if (!ok) return
      try {
        await window.nt.providers.remove(p.id)
        await refreshProviders()
        notify('تم حذف المزود', 'info')
      } catch (e) {
        notify(`تعذّر حذف المزود: ${errText(e)}`, 'error')
      }
    })()
  }

  return (
    <Modal title="الإعدادات" onClose={() => setOverlay(null)} wide>
      <div className="space-y-7">
        <section className="space-y-3">
          <SectionHead
            icon={Boxes}
            title="المزودون"
            desc="كل مزود بمفتاحه ونماذجه — أضف، عدّل القدرات، أو احذف في أي وقت."
            action={<button className="btn" onClick={() => setEditing('new')}><Plus size={15} /> إضافة</button>}
          />
          {providers.length === 0 ? (
            <p className="r-4 border border-hair bg-surface px-4 py-6 text-center t-md text-mute">لا مزوّدين بعد.</p>
          ) : (
            <ul className="divide-y divide-hair r-4 border border-hair">
              {providers.map((p) => (
                <li key={p.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="mono truncate t-2xs text-faint">{p.baseUrl} · {p.models.length} نموذج</p>
                  </div>
                  <button className="btn" onClick={() => setEditing(p.id)}>تعديل</button>
                  <button className="icon-btn" aria-label={`حذف ${p.name}`} onClick={() => remove(p)}><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <SectionHead icon={Layers} title="النماذج" desc="النموذج الافتراضي لكل الجلسات، والاحتياطي عندما يتكرّر الفشل." />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">النموذج الافتراضي</label>
              <select className="field t-md" value={key(settings.defaultModel)} onChange={(e) => void setSettings({ defaultModel: pick(e.target.value) })}>
                <option value="">— اختر —</option>{models.map((m) => <option key={key(m)} value={key(m)}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">النموذج الاحتياطي (عند تكرار الفشل)</label>
              <select className="field t-md" value={key(settings.fallbackModel)} onChange={(e) => void setSettings({ fallbackModel: pick(e.target.value) })}>
                <option value="">— بلا —</option>{models.map((m) => <option key={key(m)} value={key(m)}>{m.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <SectionHead icon={MessageSquarePlus} title="شخصية الوكيل" desc="توجيه حر يُلحق بتعليمات النظام: من هو الوكيل وتخصصه وأسلوبه." />
          <div>
            <textarea
              className="field t-md min-h-24"
              rows={4}
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              onBlur={commitPersona}
              placeholder="مثال: أنت متخصص في التسويق الرقمي، نبرتك ودية ومختصرة…"
            />
            <p className="t-2xs mt-1 text-faint">يُحفظ عند مغادرة الحقل. فارغ = بلا توجيه إضافي.</p>
          </div>
        </section>

        <section className="space-y-3">
          <SectionHead icon={Gauge} title="حدود التشغيل" desc="سقوف الوكيل — تُطبَّق على كل الجلسات فوراً." />
          <div className="grid grid-cols-2 gap-3">
            {LIMITS.map((f) => (
              <div key={f.k}>
                <label className="label">{f.label}</label>
                <input
                  dir="ltr"
                  type="number"
                  className="field mono t-md"
                  min={f.min}
                  max={f.max}
                  value={settings[f.k]}
                  onChange={(e) => void setSettings({ [f.k]: Math.min(f.max, Math.max(f.min, +e.target.value || f.min)) })}
                />
                <p className="num t-2xs mt-1 text-faint">{f.hint}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHead icon={Palette} title="المظهر" desc="ليلي أو نهاري أو تبعاً للنظام." />
          <div className="seg w-full" role="listbox" aria-label="المظهر">
            {([['dark', 'ليلي', Moon], ['light', 'نهاري', Sun], ['system', 'النظام', Monitor]] as const).map(([m, label, I]) => (
              <button key={m} role="option" aria-selected={theme.mode === m} onClick={() => theme.setMode(m as ThemeMode)} className="seg-item flex-1">
                <I size={14} /> {label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHead icon={FolderOpen} title="مجلد مساحة العمل" desc="كل مشروع جديد يُنشأ داخل هذا المجلد في مجلد فرعي باسمه." />
          <div>
            <input
              dir="ltr"
              className="field mono t-md"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              onBlur={commitRoot}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commitRoot())}
              aria-invalid={!!rootError || undefined}
            />
            {rootError && <p className="t-2xs mt-1 text-coral">{rootError}</p>}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHead icon={ShieldCheck} title="الموافقة" desc="استقلال كامل افتراضياً، أو سؤال قبل كل أمر خطير." />
          <label className="flex items-start gap-3 r-4 border border-hair bg-surface p-3.5">
            <input type="checkbox" className="mt-1" checked={settings.approvalMode} onChange={(e) => void setSettings({ approvalMode: e.target.checked })} />
            <span>
              <span className="t-md font-medium">طلب موافقة على الأوامر الخطرة</span>
              <span className="block t-sm text-mute">مطفأ افتراضياً (استقلال كامل). عند تفعيله تُسأل قبل الحذف أو الكتابة خارج مساحة العمل.</span>
            </span>
          </label>
        </section>
      </div>
    </Modal>
  )
}
