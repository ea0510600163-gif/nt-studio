import { Bot, Boxes, Check, Code2, FilePen, FolderOpen, Gauge, Layers, type LucideIcon, MessageSquarePlus, Monitor, Moon, Palette, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Sun, Trash2, WandSparkles, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { SkillInfo } from '@shared/types'
import { useStore, type SettingsTab } from '@/lib/store'
import { useTheme, type ThemeMode } from '@/lib/theme'
import { confirmAction, isConfirmOpen, trapDialogFocus } from './ConfirmDialog'
import { PERMISSION_OPTIONS, applyPermissionMode } from './PermissionPicker'
import ProviderForm from './ProviderForm'

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null
    const el = panel.current
    el?.focus({ preventScroll: true })
    const k = (e: KeyboardEvent) => {
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`pop rise r-5 flex max-h-[90vh] w-full flex-col overflow-hidden ${wide ? 'max-w-[840px]' : 'max-w-[540px]'}`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-hair px-5 py-3.5">
          <h2 id={titleId} className="font-display t-xl font-bold tracking-wide">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
        </header>
        <div className="overflow-auto p-5 [scrollbar-gutter:stable]">{children}</div>
      </div>
    </div>
  )
}

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

  const remove = (p: Row) => {
    void (async () => {
      const ok = await confirmAction({
        title: 'إزالة المشروع من البرنامج',
        message: `سيُزال «${p.name}» من البرنامج مع محادثاته. مجلده (${p.dir}) يبقى على الجهاز دون مساس.`,
        confirmLabel: 'إزالة من البرنامج',
        tone: 'coral'
      })
      if (!ok) return
      setBusy(p.id)
      try {
        const res = await window.nt.projects.delete(p.id)
        notify(res.sessions ? `أُزيل المشروع من البرنامج، وأُزيلت معه ${res.sessions} محادثات` : 'أُزيل المشروع من البرنامج', 'info')
        await refreshProjects()
      } catch (e) {
        notify(`تعذّر الحذف: ${errText(e)}`, 'error')
      } finally {
        setBusy('')
      }
    })()
  }

  const removeAll = () => {
    void (async () => {
      const ok = await confirmAction({
        title: 'حذف كل المشاريع',
        message: `سيُزال كل المشاريع (${projects.length}) من البرنامج مع محادثاتها. مجلداتها تبقى على الجهاز دون مساس.`,
        confirmLabel: 'إزالة الكل',
        tone: 'coral'
      })
      if (!ok) return
      setBusy('all')
      try {
        const res = await window.nt.projects.deleteAll()
        notify(res.removed ? res.removed === 1 ? 'حُذف مشروع واحد' : `حُذفت ${res.removed} مشاريع` : 'لا مشاريع محفوظة للحذف', res.failed.length ? 'error' : 'info')
        if (res.failed.length) setMsg(`تعذّر حذف ${res.failed.length}: ${res.failed.join(' | ')}`)
        await refreshProjects()
      } catch (e) {
        notify(`تعذّر الحذف: ${errText(e)}`, 'error')
      } finally {
        setBusy('')
      }
    })()
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
          <input className="field" style={{ paddingInlineStart: 'var(--sp-8)' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الوصف أو التقنية…" aria-label="بحث في المشاريع" />
        </div>
        {needle && !showSkeleton && <p className="num t-2xs text-faint">{rows.length} من {projects.length}</p>}
        {!showSkeleton && projects.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="num t-2xs text-faint">{projects.length} {projects.length === 1 ? 'مشروع' : 'مشاريع'}</p>
            <button
              className="btn btn-danger !h-7 px-2.5 t-2xs"
              disabled={busy === 'all'}
              onClick={removeAll}
            >
              <Trash2 size={12} /> إزالة كل المشاريع
            </button>
          </div>
        )}

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
                    <span className="badge" data-tone={p.sessionId ? 'jade' : 'mute'}>{p.sessionId ? 'محادثة' : 'بلا محادثة'}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block t-sm text-mute">{p.description}</span>
                  <span className="mono mt-1.5 block truncate t-2xs text-faint">{p.dir}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="icon-btn" disabled={busy === p.id} title="شات جديد على هذا المشروع" onClick={() => void openNewChatFor(p.id)}><MessageSquarePlus size={15} /></button>
                  <button className="icon-btn" disabled={busy === p.id} title="فتح المجلد" onClick={() => reveal(p)}><FolderOpen size={15} /></button>
                  <button className="icon-btn" disabled={busy === p.id} title="تراجع إلى آخر نقطة استرجاع" onClick={() => undo(p)}><RotateCcw size={15} /></button>
                  <button className="icon-btn hover:!text-coral" disabled={busy === p.id} title="إزالة المشروع من البرنامج" onClick={() => remove(p)}><Trash2 size={15} /></button>
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
  { k: 'maxSteps', label: 'حد الخطوات', min: 10, max: 10000, hint: '10 – 10,000 دورة' },
  { k: 'commandTimeoutSec', label: 'مهلة الأمر (ثانية)', min: 10, max: 7200, hint: '10 – 7,200 ثانية' },
  { k: 'compactAtPercent', label: 'تلخيص السياق عند %', min: 30, max: 95, hint: '30 – 95%' },
  { k: 'maxOutputTokens', label: 'أقصى tokens للرد', min: 1000, max: 500000, hint: '1,000 – 500,000' }
]

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: 'providers', label: 'المزوّدون والنماذج', icon: Boxes },
  { id: 'prompts', label: 'برومنت الوكلاء', icon: Bot },
  { id: 'skills', label: 'المهارات', icon: Sparkles },
  { id: 'system', label: 'البيئة والحدود', icon: Gauge }
]

export function SettingsModal() {
  const providers = useStore((s) => s.providers)
  const settings = useStore((s) => s.settings)
  const defaultPrompts = useStore((s) => s.defaultPrompts)
  const skills = useStore((s) => s.skills)
  const settingsTab = useStore((s) => s.settingsTab)
  const openSettingsTab = useStore((s) => s.openSettingsTab)
  const setSettings = useStore((s) => s.setSettings)
  const setOverlay = useStore((s) => s.setOverlay)
  const refreshProviders = useStore((s) => s.refreshProviders)
  const refreshSkills = useStore((s) => s.refreshSkills)
  const saveSkill = useStore((s) => s.saveSkill)
  const removeSkill = useStore((s) => s.removeSkill)
  const setActiveSkill = useStore((s) => s.setActiveSkill)
  const notify = useStore((s) => s.notify)
  const theme = useTheme()

  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [root, setRoot] = useState(settings?.workspaceRoot ?? '')
  const [persona, setPersona] = useState(settings?.persona ?? '')
  const [studioPrompt, setStudioPrompt] = useState(settings?.studioPrompt ?? '')
  const [agentPrompt, setAgentPrompt] = useState(settings?.agentPrompt ?? '')
  const [editingSkill, setEditingSkill] = useState<{ id: string; label: string; description: string; content: string } | null>(null)

  useEffect(() => { setRoot(settings?.workspaceRoot ?? '') }, [settings?.workspaceRoot])
  useEffect(() => { setPersona(settings?.persona ?? '') }, [settings?.persona])
  useEffect(() => { setStudioPrompt(settings?.studioPrompt ?? '') }, [settings?.studioPrompt])
  useEffect(() => { setAgentPrompt(settings?.agentPrompt ?? '') }, [settings?.agentPrompt])
  useEffect(() => { void refreshSkills().catch(() => {}) }, [refreshSkills])

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

  const savePrompts = async () => {
    try {
      await setSettings({
        studioPrompt: studioPrompt.trim(),
        agentPrompt: agentPrompt.trim(),
        persona: persona.trim()
      })
      notify('حُفظت إعدادات برومنت الوكلاء بنجاح', 'info')
    } catch (e) {
      notify(`تعذّر حفظ البرومنت: ${errText(e)}`, 'error')
    }
  }

  const handleSaveSkillForm = async () => {
    if (!editingSkill) return
    if (!editingSkill.label.trim() || !editingSkill.content.trim()) {
      notify('أدخل اسم المهارة ومحتواها أولاً', 'warn')
      return
    }
    try {
      const saved = await saveSkill({
        id: editingSkill.id || editingSkill.label,
        label: editingSkill.label,
        description: editingSkill.description,
        content: editingSkill.content
      })
      setEditingSkill(null)
      notify(`حُفظت المهارة: ${saved.label}`, 'info')
    } catch (e) {
      notify(`تعذّر حفظ المهارة: ${errText(e)}`, 'error')
    }
  }

  const handleDeleteSkill = (s: SkillInfo) => {
    void (async () => {
      const ok = await confirmAction({
        title: 'حذف المهارة',
        message: `سيتم حذف المهارة «${s.label}» (${s.id}). هل أنت متأكد؟`,
        confirmLabel: 'حذف',
        tone: 'coral'
      })
      if (!ok) return
      try {
        await removeSkill(s.id)
        notify('حُذفت المهارة', 'info')
      } catch (e) {
        notify(`تعذّر حذف المهارة: ${errText(e)}`, 'error')
      }
    })()
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

  const creatorSkill = skills.find((s) => s.id === 'skill-creator')

  return (
    <Modal title="مركز الإعدادات والتخصيص الهندسي" onClose={() => setOverlay(null)} wide>
      <div className="space-y-5">
        <div className="seg w-full overflow-x-auto" role="tablist" aria-label="أقسام الإعدادات">
          {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={settingsTab === id}
              onClick={() => openSettingsTab(id)}
              className="seg-item flex-1"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {settingsTab === 'providers' && (
          <div className="space-y-5">
            <section className="space-y-3">
              <SectionHead
                icon={Boxes}
                title="المزودون"
                desc="كل مزود بمفتاحه ونماذجه — أضف، عدّل القدرات، أو احذف في أي وقت."
                action={<button className="btn btn-brass" onClick={() => setEditing('new')}><Plus size={15} /> إضافة مزود</button>}
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
              <SectionHead icon={Layers} title="النماذج النشطة" desc="النموذج الافتراضي لكل الجلسات، والاحتياطي عندما يتكرّر الفشل." />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>
        )}

        {settingsTab === 'prompts' && (
          <div className="space-y-5">
            <section className="space-y-3">
              <SectionHead
                icon={Code2}
                title="برومنت الوكيل الباني والمعدّل (Studio Agent Prompt)"
                desc="الدليل التعريفي الأساسي للوكيل في وضع البرمجة وبناء وتعديل المشاريع. اتركه فارغاً لاستخدام الدليل الافتراضي أو خصّصه بالكامل."
                action={
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="chip !h-7 !text-xs"
                      onClick={() => setStudioPrompt(defaultPrompts.studioPrompt)}
                    >
                      تعبئة الافتراضي للتعديل
                    </button>
                    {studioPrompt.trim() !== '' && (
                      <button
                        type="button"
                        className="chip !h-7 !text-xs"
                        onClick={() => setStudioPrompt('')}
                      >
                        استعادة الافتراضي
                      </button>
                    )}
                  </div>
                }
              />
              <textarea
                dir="auto"
                className="field mono t-xs min-h-36 leading-relaxed"
                rows={6}
                value={studioPrompt}
                onChange={(e) => setStudioPrompt(e.target.value)}
                placeholder={defaultPrompts.studioPrompt || 'الدليل التعريفي الافتراضي لوضع Studio…'}
              />
            </section>

            <section className="space-y-3">
              <SectionHead
                icon={Bot}
                title="برومنت الوكيل المتحكم بالكمبيوتر (Computer Agent Prompt)"
                desc="الدليل التعريفي للوكيل في وضع التحكم الكامل بسطح المكتب وواجهات ويندوز (1:1 + UIA). اتركه فارغاً للدليل الافتراضي أو خصّصه بالكامل."
                action={
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="chip !h-7 !text-xs"
                      onClick={() => setAgentPrompt(defaultPrompts.agentPrompt)}
                    >
                      تعبئة الافتراضي للتعديل
                    </button>
                    {agentPrompt.trim() !== '' && (
                      <button
                        type="button"
                        className="chip !h-7 !text-xs"
                        onClick={() => setAgentPrompt('')}
                      >
                        استعادة الافتراضي
                      </button>
                    )}
                  </div>
                }
              />
              <textarea
                dir="auto"
                className="field mono t-xs min-h-36 leading-relaxed"
                rows={6}
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                placeholder={defaultPrompts.agentPrompt || 'الدليل التعريفي الافتراضي لوضع التحكم بالكمبيوتر…'}
              />
            </section>

            <section className="space-y-3">
              <SectionHead
                icon={MessageSquarePlus}
                title="التوجيه الشخصي الإضافي (Persona / Standing Briefing)"
                desc="توجيه حر يُلحق بذيل تعليمات النظام في جميع الأوضاع (أسلوب الوكيل، تفضيلاتك الخاصة، قواعدك المفضلة)."
              />
              <textarea
                dir="auto"
                className="field t-md min-h-24"
                rows={3}
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="مثال: خاطبني دائماً باختصار، واستخدم تصميمات هندسية داكنة عالية الفخامة…"
              />
            </section>

            <div className="flex justify-end">
              <button type="button" className="btn btn-brass" onClick={() => void savePrompts()}>
                <Check size={15} /> حفظ جميع إعدادات البرومنت
              </button>
            </div>
          </div>
        )}

        {settingsTab === 'skills' && (
          <div className="space-y-5">
            <section className="space-y-3">
              <SectionHead
                icon={Sparkles}
                title="مكتبة المهارات الذكية"
                desc="المهارات تمنح النموذج خبرة متخصصة فورية. يمكنك اختيار أي مهارة مباشرة من زر (+) في صندوق الكتابة، أو إنشاء مهارات جديدة هنا."
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    {creatorSkill && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setActiveSkill(creatorSkill)
                          setOverlay(null)
                          notify('فُعّلت مهارة «صانع المهارات الاحترافية» في صندوق الكتابة — صف المهارة التي تريدها!', 'info')
                        }}
                      >
                        <WandSparkles size={14} className="text-brass-hi" /> صنع مهارة بالوكيل
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-brass"
                      onClick={() =>
                        setEditingSkill({
                          id: '',
                          label: '',
                          description: '',
                          content: ''
                        })
                      }
                    >
                      <Plus size={15} /> إضافة مهارة يدوياً
                    </button>
                  </div>
                }
              />

              {editingSkill && (
                <div className="space-y-3 rounded-xl border border-brass/45 bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display t-base font-bold text-brass-hi">
                      {editingSkill.id ? `تعديل المهارة: ${editingSkill.id}` : 'إنشاء مهارة جديدة'}
                    </h4>
                    <button type="button" className="icon-btn !size-7" onClick={() => setEditingSkill(null)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">عنوان المهارة (بالعربية)</label>
                      <input
                        className="field t-sm"
                        value={editingSkill.label}
                        onChange={(e) => setEditingSkill({ ...editingSkill, label: e.target.value })}
                        placeholder="مثال: مهندس واجهات المستقبل"
                      />
                    </div>
                    <div>
                      <label className="label">المعرّف (id بالإنجليزية — اختياري)</label>
                      <input
                        dir="ltr"
                        className="field mono t-sm"
                        value={editingSkill.id}
                        onChange={(e) => setEditingSkill({ ...editingSkill, id: e.target.value })}
                        placeholder="futuristic-ui-architect"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">وصف مختصر (سطر واحد)</label>
                    <input
                      className="field t-sm"
                      value={editingSkill.description}
                      onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                      placeholder="متى ولماذا تُستعمل هذه المهارة…"
                    />
                  </div>
                  <div>
                    <label className="label">محتوى ودليل المهارة (Markdown)</label>
                    <textarea
                      dir="auto"
                      className="field mono t-xs min-h-36 leading-relaxed"
                      rows={6}
                      value={editingSkill.content}
                      onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                      placeholder="اكتب إرشادات المهارة بالتفصيل…"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditingSkill(null)}>إلغاء</button>
                    <button type="button" className="btn btn-brass" onClick={() => void handleSaveSkillForm()}>
                      <Check size={14} /> حفظ المهارة
                    </button>
                  </div>
                </div>
              )}

              <ul className="space-y-2">
                {skills.map((s) => {
                  const isCreator = s.id === 'skill-creator'
                  return (
                    <li
                      key={s.id}
                      className="row-hover flex flex-wrap items-start justify-between gap-3 p-3.5"
                      data-active={isCreator || undefined}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {isCreator ? <WandSparkles size={15} className="text-brass-hi" /> : <Sparkles size={14} className="text-sky" />}
                          <strong className="font-display t-base font-bold">{s.label}</strong>
                          <span className="mono rounded bg-raised px-1.5 py-0.5 t-2xs text-mute">{s.id}</span>
                          {isCreator && <span className="badge" data-tone="jade">افتراضية · صانع المهارات</span>}
                        </div>
                        <p className="mt-1 t-sm text-mute">{s.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          className="btn !h-8 !px-3 t-xs"
                          onClick={() => {
                            setActiveSkill(s)
                            setOverlay(null)
                            notify(`فُعّلت مهارة «${s.label}» في صندوق الكتابة`, 'info')
                          }}
                        >
                          تفعيل في الشات
                        </button>
                        <button
                          type="button"
                          className="icon-btn !size-8"
                          title="تعديل المهارة"
                          onClick={() =>
                            setEditingSkill({
                              id: s.id,
                              label: s.label,
                              description: s.description,
                              content: s.content
                            })
                          }
                        >
                          <FilePen size={14} />
                        </button>
                        {!isCreator && (
                          <button
                            type="button"
                            className="icon-btn !size-8"
                            title="حذف المهارة"
                            onClick={() => handleDeleteSkill(s)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        )}

        {settingsTab === 'system' && (
          <div className="space-y-5">
            <section className="space-y-3">
              <SectionHead icon={ShieldCheck} title="صلاحيات الأدوات" desc="من يقرّر تنفيذ الإجراء الخطر: أنت أم النموذج." />
              <div className="seg w-full" role="listbox" aria-label="صلاحيات الأدوات">
                {PERMISSION_OPTIONS.map((o) => {
                  const I = o.icon
                  const on = settings.permissionMode === o.id
                  return (
                    <button key={o.id} type="button" role="option" aria-selected={on} title={o.hint} onClick={() => void applyPermissionMode(o.id)} className="seg-item flex-1">
                      <I size={14} /> {o.label}
                    </button>
                  )
                })}
              </div>
              <p className="t-2xs text-faint">{(PERMISSION_OPTIONS.find((o) => o.id === settings.permissionMode) ?? PERMISSION_OPTIONS[0]).hint}</p>
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
              <SectionHead icon={Palette} title="المظهر الهندسي" desc="ليلي (Obsidian Cyber) أو نهاري أو تبعاً للنظام." />
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
          </div>
        )}
      </div>
    </Modal>
  )
}
