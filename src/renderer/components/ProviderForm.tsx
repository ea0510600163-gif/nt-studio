import { Check, ChevronDown, CircleAlert, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PRESETS, inferModel } from '@shared/models'
import type { ApiStyle, ModelInfo, ProviderPublic } from '@shared/types'
import { useStore } from '@/lib/store'

const API_STYLES: { id: ApiStyle; label: string }[] = [
  { id: 'openai', label: 'متوافقة مع OpenAI' },
  { id: 'anthropic', label: 'متوافقة مع Anthropic' },
  { id: 'responses', label: 'OpenAI Responses' }
]

const MAX_MODELS = 80
const CTX = { min: 1024, max: 4_000_000 }
const OUT = { min: 256, max: 2_000_000 }
const OUT_DEFAULT = 64_000
const PRICE = { min: 0, max: 1_000 }
const ERR_URL = 'رابط غير صالح — مثال: https://api.example.com/v1'
const URL_RE = /^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]\S*)?$/i
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': /, '')
const num = (n: number) => n.toLocaleString('en-US')
const fp = (n: number) => String(+(n.toFixed(6)))
const patchCost = (m: ModelInfo, p: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): Partial<ModelInfo> => ({
  cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0, cacheRead: m.cost?.cacheRead, cacheWrite: m.cost?.cacheWrite, ...p }
})

function CapNum({ label, hint, value, min, max, onCommit, float = false }: { label: string; hint: string; value: number; min: number; max: number; onCommit: (n: number) => void; float?: boolean }) {
  const [raw, setRaw] = useState(() => String(value))
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (!dirty) setRaw(String(value)) }, [value, dirty])
  const n = Number(raw)
  const bad = raw.trim() === '' || !Number.isFinite(n) || (!float && !Number.isInteger(n)) || n < min || n > max
  const commit = () => {
    setDirty(false)
    const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
    setRaw(String(v))
    onCommit(v)
  }
  return (
    <div>
      <label className="label">{label}</label>
      <input
        dir="ltr"
        type="number"
        step={float ? 'any' : 1}
        className="field mono t-md"
        min={min}
        max={max}
        value={raw}
        aria-invalid={bad || undefined}
        onChange={(e) => { setDirty(true); setRaw(e.target.value) }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
      <p className={`t-2xs mt-1 ${bad ? 'text-coral' : 'text-faint'}`}>{bad ? `عدد ${float ? '' : 'صحيح '}بين ${num(min)} و ${num(max)}` : hint}</p>
    </div>
  )
}

export default function ProviderForm({ initial, onDone, onCancel }: { initial?: ProviderPublic; onDone: () => void; onCancel?: () => void }) {
  const refresh = useStore((s) => s.refreshProviders)
  const notify = useStore((s) => s.notify)
  const settings = useStore((s) => s.settings)
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [style, setStyle] = useState<ApiStyle>(initial?.apiStyle ?? 'openai')
  const [opencode, setOpencode] = useState<boolean>(initial?.opencode ?? false)
  const [models, setModels] = useState<ModelInfo[]>(initial?.models ?? [])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'' | 'fetch' | 'save'>('')
  const [open, setOpen] = useState<string>('')
  const [err, setErr] = useState('')

  const host = () => { try { return new URL(baseUrl.trim()).hostname } catch { return '' } }
  const urlOk = URL_RE.test(baseUrl.trim())
  const urlBad = baseUrl.trim() !== '' && !urlOk
  const valid = baseUrl.trim() && urlOk && models.length > 0 && (apiKey.trim() || initial?.hasKey || /localhost|127\.0\.0\.1/.test(baseUrl))

  const addModel = (id: string) => {
    const t = id.trim()
    if (t && !models.some((m) => m.id === t)) setModels([...models, { ...inferModel(t), origin: 'manual' }])
    setDraft('')
  }
  const patch = (id: string, p: Partial<ModelInfo>) => setModels(models.map((m) => (m.id === id ? { ...m, ...p } : m)))

  const fetchModels = async () => {
    setBusy('fetch')
    setErr('')
    try {
      const list = await window.nt.providers.fetchModels({ id: initial?.id, baseUrl, apiKey, apiStyle: style })
      const merged = [...models]
      for (const m of list) if (!merged.some((x) => x.id === m.id)) merged.push({ ...m, origin: 'catalog' })
      setModels(merged.slice(0, MAX_MODELS))
      if (!list.length) setErr('لم يُرجع المزود قائمة نماذج؛ أضفها يدوياً.')
    } catch (e) {
      setErr('تعذّر جلب القائمة (' + errText(e) + '). أضف النماذج يدوياً.')
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    if (!urlOk) {
      setErr(ERR_URL)
      return
    }
    setBusy('save')
    setErr('')
    try {
      const p = await window.nt.providers.save({ id: initial?.id, name: name || host() || 'مزوّد', baseUrl, apiKey, apiStyle: style, models, opencode })
      await refresh()
      onDone()
      const dm = settings?.defaultModel
      const target = open || (dm && dm.providerId === p.id ? dm.modelId : '')
      void window.nt.providers.test(p.id, target || undefined)
        .then((r) => { if (!r.ok) notify(`تم الحفظ، لكن اختبار الاتصال فشل: ${r.message}`, 'warn') })
        .catch((e) => notify(`تعذّر اختبار الاتصال: ${errText(e)}`, 'error'))
    } catch (e) {
      setErr(errText(e))
      setBusy('')
    }
  }

  return (
    <div className="space-y-5">
      {!initial && (
        <div>
          <span className="label">ابدأ من إعداد جاهز</span>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.name} className="chip" data-on={baseUrl === p.baseUrl} onClick={() => { setName(p.name); setBaseUrl(p.baseUrl); setStyle(p.apiStyle); setOpencode(!!p.opencode); if (p.models) setModels(p.models) }}>{p.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">اسم المزود</label>
          <input className="field t-md" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: Anthropic" />
        </div>
        <div>
          <label className="label">رابط الـ Base URL</label>
          <input dir="ltr" className="field mono t-md" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" aria-invalid={urlBad || undefined} />
          {urlBad && <p className="t-2xs mt-1 text-coral">{ERR_URL}</p>}
        </div>
      </div>
      <div>
        <span className="label">نوع الواجهة</span>
        <div className="seg w-full" role="listbox" aria-label="نوع الواجهة">
          {API_STYLES.map((s) => (
            <button key={s.id} role="option" aria-selected={style === s.id} onClick={() => setStyle(s.id)} className="seg-item flex-1">{s.label}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">مفتاح API {initial?.hasKey && <span className="text-jade">· محفوظ ومشفّر — اتركه فارغاً للإبقاء عليه</span>}</label>
        <input dir="ltr" type="password" autoComplete="off" className="field mono t-md" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={initial?.hasKey ? '••••••••••••' : 'sk-…'} />
        <p className="t-2xs mt-1.5 text-faint">يُشفَّر عبر نظام Windows ولا يُكتب كنص صريح في أي ملف أو سجل.</p>
      </div>
      <label className="flex items-start gap-3 r-4 border border-hair bg-surface p-3.5">
        <input type="checkbox" className="mt-1" checked={opencode} onChange={(e) => setOpencode(e.target.checked)} />
        <span>
          <span className="t-md font-medium">مزوّد OpenCode (Go)</span>
          <span className="block t-sm text-mute">يرسل ترويسة <span className="mono">x-opencode-session</span> ومعرّف الجلسة مع كل نداء. فعّلها لمزوّد OpenCode فقط.</span>
        </span>
      </label>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="t-sm font-medium text-mute">النماذج</span>
          <button className="chip" disabled={!baseUrl.trim() || busy !== ''} onClick={() => void fetchModels()}>
            {busy === 'fetch' ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} جلب القائمة تلقائياً
          </button>
        </div>
        <div className="flex gap-2">
          <input dir="ltr" className="field mono t-md" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addModel(draft))} placeholder="اسم النموذج ثم Enter" />
          <button className="btn" disabled={!draft.trim()} onClick={() => addModel(draft)}><Plus size={15} />إضافة</button>
        </div>
        {models.length > 0 && (
          <ul className="mt-3 max-h-52 divide-y divide-hair overflow-auto r-4 border border-hair">
            {models.map((m, mi) => {
              const capsId = `caps-${mi}`
              return (
                <li key={m.id} className="bg-surface">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button className="mono min-w-0 flex-1 truncate text-start t-sm" onClick={() => setOpen(open === m.id ? '' : m.id)} aria-expanded={open === m.id} aria-controls={capsId}>{m.id}</button>
                    {m.apiStyle && <span className="badge" data-tone="mute">{m.apiStyle === 'anthropic' ? 'messages' : m.apiStyle === 'responses' ? 'responses' : 'chat'}</span>}
                    <span className="badge" data-tone={m.tools ? 'sky' : 'mute'}>{m.tools ? 'أدوات' : 'نصّي'}</span>
                    {m.vision && <span className="badge" data-tone="jade">صور</span>}
                    {m.cost && <span className="badge num" data-tone="mute" title="سعر لكل مليون رمز — إدخال/إخراج">${fp(m.cost.input)}/${fp(m.cost.output)}</span>}
                    <button className="icon-btn" onClick={() => setOpen(open === m.id ? '' : m.id)} aria-expanded={open === m.id} aria-controls={capsId} aria-label={open === m.id ? 'إخفاء القدرات' : 'تعديل القدرات'}><ChevronDown size={13} className={open === m.id ? 'rotate-180' : ''} /></button>
                    <button className="icon-btn" onClick={() => setModels(models.filter((x) => x.id !== m.id))} aria-label={`حذف ${m.id}`}><Trash2 size={14} /></button>
                  </div>
                  {open === m.id && (
                    <div id={capsId} role="region" aria-label={`قدرات ${m.id}`} className="border-t border-hair px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 t-sm">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={m.tools} onChange={(e) => patch(m.id, { tools: e.target.checked })} />يدعم استدعاء الأدوات</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={m.vision} onChange={(e) => patch(m.id, { vision: e.target.checked })} />يدعم الصور</label>
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 gap-3">
                        <CapNum label="نافذة السياق" hint="الحجم الكلّي للسياق — منه يُحسب متى يبدأ التلخيص التلقائي." value={m.contextWindow} min={CTX.min} max={CTX.max} onCommit={(n) => patch(m.id, { contextWindow: n })} />
                        <CapNum label="أقصى إخراج" hint="ميزانية الكتابة في النداء الواحد — تحدّد حجم ما يكتبه المزوّد دفعة واحدة." value={m.maxOutput ?? OUT_DEFAULT} min={OUT.min} max={OUT.max} onCommit={(n) => patch(m.id, { maxOutput: n })} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <CapNum float label="سعر الإدخال ($/مليون)" hint="دولار لكل مليون رمز إدخال — من صفحة أسعار المزود." value={m.cost?.input ?? 0} min={PRICE.min} max={PRICE.max} onCommit={(n) => patch(m.id, patchCost(m, { input: n }))} />
                        <CapNum float label="سعر الإخراج ($/مليون)" hint="دولار لكل مليون رمز إخراج." value={m.cost?.output ?? 0} min={PRICE.min} max={PRICE.max} onCommit={(n) => patch(m.id, patchCost(m, { output: n }))} />
                        <CapNum float label="سعر قراءة الكاش ($/مليون)" hint="دولار لكل مليون رمز كاش مقروء — من صفحة أسعار المزود." value={m.cost?.cacheRead ?? 0} min={PRICE.min} max={PRICE.max} onCommit={(n) => patch(m.id, patchCost(m, { cacheRead: n }))} />
                        <CapNum float label="سعر كتابة الكاش ($/مليون)" hint="دولار لكل مليون رمز تُكتب في الكاش أول مرة — يُبلَّغ عنه في نمط Anthropic فقط." value={m.cost?.cacheWrite ?? 0} min={PRICE.min} max={PRICE.max} onCommit={(n) => patch(m.id, patchCost(m, { cacheWrite: n }))} />
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {err && <p className="flex items-start gap-2 t-md text-coral"><CircleAlert size={15} className="mt-0.5 shrink-0" />{err}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button className="btn btn-brass" disabled={!valid || busy !== ''} onClick={() => void save()}>
          {busy === 'save' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} حفظ والبدء
        </button>
        {onCancel && <button className="btn btn-ghost" onClick={onCancel}>إلغاء</button>}
      </div>
    </div>
  )
}
