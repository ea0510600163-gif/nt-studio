import { useEffect, useMemo, useState } from 'react'
import {
  PROTOCOLS,
  PROTOCOL_LABELS,
  emptyProviderInput,
  type Protocol,
  type ProviderInput,
  type ProviderPublic,
} from '../../../shared/providers'

interface Props {
  providers: ProviderPublic[]
  onChanged: (next: ProviderPublic[]) => void
  onClose?: () => void
}

type Busy = 'idle' | 'probe' | 'models' | 'save'

const FIELD =
  'w-full h-10 rounded-lg bg-inset border border-line px-3 text-[13px] text-main placeholder:text-faint outline-none focus:border-accent transition-colors'

export default function ProvidersScreen({ providers, onChanged, onClose }: Props): React.JSX.Element {
  const [form, setForm] = useState<ProviderInput>(emptyProviderInput)
  const [modelDraft, setModelDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState<Busy>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
  }, [form.protocol])

  const meta = PROTOCOL_LABELS[form.protocol]

  const modelsSummary = useMemo(
    () => (form.models.length > 3 ? `${form.models.slice(0, 3).join('، ')} +${form.models.length - 3}` : form.models.join('، ')),
    [form.models],
  )

  const patch = (p: Partial<ProviderInput>): void => setForm((f) => ({ ...f, ...p }))

  const addModel = (raw: string): void => {
    const value = raw.trim().replace(/,$/, '')
    if (!value) return
    setForm((f) => (f.models.includes(value) ? f : { ...f, models: [...f.models, value] }))
    setModelDraft('')
  }

  /**
   * النماذج الفعّالة = المحفوظة + ما هو مكتوب حاليًا.
   * السبب: المستخدم يكتب اسم النموذج ثم يضغط «اختبار الاتصال» مباشرة،
   * فلا ينبغي إهمال ما كتبه لمجرد أنه لم يضغط Enter.
   */
  const effectiveModels = useMemo((): string[] => {
    const pending = modelDraft.trim().replace(/,$/, '')
    if (!pending || form.models.includes(pending)) return form.models
    return [...form.models, pending]
  }, [form.models, modelDraft])

  /** يعتمد ما كُتب في الحقل قبل أي إجراء (اختبار/حفظ). */
  const commitDraft = (): string[] => {
    const pending = modelDraft.trim().replace(/,$/, '')
    if (pending && !form.models.includes(pending)) {
      addModel(pending)
      return [...form.models, pending]
    }
    return form.models
  }

  const canSubmit =
    form.name.trim().length > 0 && form.baseUrl.trim().length > 0 && effectiveModels.length > 0

  const refresh = async (): Promise<void> => {
    const list = await window.studio.providers.list()
    onChanged(list)
  }

  const doFetchModels = async (): Promise<void> => {
    if (!form.baseUrl.trim()) {
      setError('اكتب رابط المزوّد أولًا')
      return
    }
    setBusy('models')
    setError(null)
    setNotice(null)
    try {
      const res = await window.studio.providers.fetchModels({
        baseUrl: form.baseUrl.trim(),
        protocol: form.protocol,
        apiKey: form.apiKey,
      })
      if (!res.ok) {
        setError(res.error ?? 'تعذّر جلب قائمة النماذج')
        return
      }
      if (res.models.length === 0) {
        setError('الرابط صالح لكن لم يُرجع أي نموذج — تحقق من المفتاح، أو اكتب اسم النموذج يدويًا')
        return
      }
      patch({ models: res.models })
      setNotice(`تم جلب ${res.models.length} نموذجًا`)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy('idle')
    }
  }

  const doProbe = async (): Promise<void> => {
    setBusy('probe')
    setError(null)
    setNotice(null)
    try {
      const models = commitDraft()
    const res = await window.studio.providers.probe({
      name: form.name.trim() || 'مزوّد',
      protocol: form.protocol,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey,
      models,
    })
    if (res.ok) setNotice(`${res.message} · ${res.latencyMs}ms`)
    else setError(`فشل الاتصال: ${res.message}`)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy('idle')
    }
  }

  const doSave = async (): Promise<void> => {
    const models = commitDraft()
    const payload: ProviderInput = { ...form, models }
    if (!payload.name.trim() || !payload.baseUrl.trim() || models.length === 0) {
      setError('الاسم والرابط واسم نموذج واحد على الأقل مطلوبة')
      return
    }
    setBusy('save')
    setError(null)
    try {
      if (editingId) await window.studio.providers.update({ ...payload, id: editingId })
      else await window.studio.providers.add(payload)
      await refresh()
      setForm(emptyProviderInput())
      setEditingId(null)
      setNotice(editingId ? 'تم التحديث' : 'تم الحفظ — المفتاح مشفّر على جهازك')
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy('idle')
    }
  }

  const startEdit = (p: ProviderPublic): void => {
    setEditingId(p.id)
    setForm({
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      apiKey: '',
      models: [...p.models],
      note: p.note,
    })
    setError(null)
    setNotice('وضع التعديل — المفتاح الحالي محفوظ. اكتب مفتاحًا جديدًا فقط إن أردت تغييره.')
  }

  const doTestSaved = async (p: ProviderPublic): Promise<void> => {
    setBusy('probe')
    try {
      const res = await window.studio.providers.testSaved(p.id)
      if (res.ok) setNotice(`${p.name}: ${res.message}`)
      else setError(`${p.name}: ${res.message}`)
      await refresh()
    } finally {
      setBusy('idle')
    }
  }

  const doRemove = async (p: ProviderPublic): Promise<void> => {
    await window.studio.providers.remove(p.id)
    if (editingId === p.id) {
      setEditingId(null)
      setForm(emptyProviderInput())
    }
    await refresh()
  }

  return (
    <div className="h-full overflow-auto bg-app">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-md bg-accent/15 px-2 py-0.5 font-mono text-[11px] text-accent">S3</span>
            <span className="text-[11px] text-faint">شاشة المزوّدات</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">مزوّدات الذكاء الاصطناعي</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
            أضف أي مزوّد خاص بك: الرابط والمفتاح وأسماء النماذج. يُخزَّن المفتاح مشفّرًا على جهازك
            (DPAPI) ولا يُرسل كاملًا إلى الواجهة إطلاقًا.
          </p>
        </header>

        <section className="card p-5">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-[12px] text-dim">الاسم</span>
                <input
                  className={FIELD}
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="مثال: OpenCode Go"
                  autoFocus
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-[12px] text-dim">البروتوكول</span>
                <select
                  className={FIELD}
                  value={form.protocol}
                  onChange={(e) => patch({ protocol: e.target.value as Protocol })}
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {PROTOCOL_LABELS[p].title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="-mt-1 text-[11.5px] leading-relaxed text-faint">{meta.hint}</p>

            <label className="grid gap-1.5">
              <span className="text-[12px] text-dim">الرابط (Base URL)</span>
              <input
                className={`${FIELD} font-mono text-[12px]`}
                value={form.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder={meta.defaultUrl}
                dir="ltr"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-[12px] text-dim">
                المفتاح <span className="text-faint">({meta.keyHint})</span>
              </span>
              <div className="relative">
                <input
                  className={`${FIELD} font-mono text-[12px] pl-20`}
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => patch({ apiKey: e.target.value })}
                  placeholder="sk-…"
                  dir="ltr"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute inset-y-1 left-1 rounded-md px-2 text-[11.5px] text-mute hover:bg-panel3 hover:text-main"
                >
                  {showKey ? 'إخفاء' : 'إظهار'}
                </button>
              </div>
            </label>

            <div className="grid gap-1.5">
              <span className="text-[12px] text-dim">النماذج</span>
              <div className="flex gap-2">
                <input
                  className={`${FIELD} font-mono text-[12px]`}
                  value={modelDraft}
                  onChange={(e) => setModelDraft(e.target.value)}
                  onBlur={() => addModel(modelDraft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addModel(modelDraft)
                    }
                  }}
                  placeholder="اكتب اسم النموذج ثم اضغط Enter (أو اضغط زر الاختبار مباشرة)"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => void doFetchModels()}
                  disabled={busy !== 'idle'}
                  className="h-10 shrink-0 rounded-lg border border-line bg-panel2 px-3 text-[12.5px] text-dim transition-colors hover:bg-panel3 hover:text-main disabled:opacity-50"
                >
                  {busy === 'models' ? 'جارٍ…' : 'جلب النماذج'}
                </button>
              </div>

              {form.models.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.models.map((m) => (
                    <span
                      key={m}
                      className="group inline-flex items-center gap-1 rounded-md border border-line bg-panel2 py-1 pl-1.5 pr-2 font-mono text-[11.5px] text-dim"
                      dir="ltr"
                    >
                      {m}
                      <button
                        type="button"
                        onClick={() => patch({ models: form.models.filter((x) => x !== m) })}
                        className="rounded px-1 text-faint hover:text-danger"
                        title="إزالة"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {form.models.length > 0 && (
                <p className="text-[11.5px] text-faint" dir="ltr">
                  {modelsSummary}
                </p>
              )}
            </div>

            {error && (
              <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>
            )}
            {notice && (
              <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[12px] text-success">
                {notice}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void doSave()}
                disabled={!canSubmit || busy !== 'idle'}
                className="h-10 rounded-lg bg-accent px-5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === 'save' ? 'جارٍ الحفظ…' : editingId ? 'تحديث' : 'حفظ المزوّد'}
              </button>
              <button
                type="button"
                onClick={() => void doProbe()}
                disabled={busy !== 'idle'}
                className="h-10 rounded-lg border border-line bg-panel2 px-5 text-[13px] text-dim transition-colors hover:bg-panel3 hover:text-main disabled:opacity-50"
              >
                {busy === 'probe' ? 'جارٍ الاختبار…' : 'اختبار الاتصال'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null)
                    setForm(emptyProviderInput())
                    setNotice(null)
                  }}
                  className="h-10 rounded-lg px-3 text-[13px] text-mute hover:text-main"
                >
                  إلغاء
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-medium">المزوّدات المحفوظة</h2>
            <span className="text-[12px] text-faint">{providers.length}</span>
          </div>

          {providers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-faint">
              لا يوجد مزوّد بعد — أكمل النموذج أعلاه واضغط «حفظ المزوّد».
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {providers.map((p) => (
                <li key={p.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] text-main">{p.name}</span>
                      <span className="rounded border border-line bg-panel2 px-1.5 py-0.5 text-[10.5px] text-mute">
                        {PROTOCOL_LABELS[p.protocol].title}
                      </span>
                      {p.lastTestOk === true && (
                        <span className="text-[10.5px] text-success">✓ {p.lastLatencyMs}ms</span>
                      )}
                      {p.lastTestOk === false && <span className="text-[10.5px] text-danger">✗ فشل</span>}
                    </div>
                    <p className="mt-1 truncate font-mono text-[11.5px] text-faint" dir="ltr">
                      {p.baseUrl} · {p.keyMask} · {p.models.length} نموذج
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className="h-8 rounded-lg border border-line px-3 text-[12px] text-dim hover:bg-panel2 hover:text-main"
                    >
                      تعديل
                    </button>
                    <button
                      type="button"
                      onClick={() => void doTestSaved(p)}
                      disabled={busy !== 'idle'}
                      className="h-8 rounded-lg border border-line px-3 text-[12px] text-dim hover:bg-panel2 hover:text-main disabled:opacity-50"
                    >
                      اختبار
                    </button>
                    <button
                      type="button"
                      onClick={() => void doRemove(p)}
                      className="h-8 rounded-lg border border-danger/40 px-3 text-[12px] text-danger hover:bg-danger/10"
                    >
                      حذف
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {providers.length > 0 && onClose && (
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg bg-accent px-6 text-[13px] font-medium text-white hover:opacity-90"
            >
              متابعة إلى مساحة العمل
            </button>
          </div>
        )}
      </div>
    </div>
  )
}