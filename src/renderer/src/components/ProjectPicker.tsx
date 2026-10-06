import { useEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '../../../shared/api'
import {
  fileCountLabel,
  formatDateTime,
  middleTruncate,
  searchResultsLabel,
} from '../nav/routes'

/**
 * قائمة المشاريع.
 *
 * هذه الشاشة **مكوّن عرض خالص**: لا تقرأ `window.studio` ولا تمسك حالة تحميل.
 * كل شيء يأتي من `App` عبر الخصائص، لأن الفشل في القراءة يجب أن يُعرض كخطأ
 * لا كـ«لا توجد مشاريع» (كان `.catch(() => undefined)` يخلط الأمرين).
 *
 * لا يوجد زر «مشروع جديد» بالمعنى الضيّق (الوكيل هو من يصنع المجلد و git و
 * README في خطوة واحدة متّسقة عبر `create_project`). لكن **الوجهة** موجودة
 * الآن: زر «ابدأ مشروعًا جديدًا» يفتح مساحة العمل بلا مشروع، وهناك يطلب
 * المستخدم ما يريد فينشئه الوكيل. قبل هذا الإصلاح كان التطبيق يطلب قفزة إلى
 * شاشة لا يمكن بلوغها.
 */

interface Props {
  projects: ProjectInfo[]
  version: string
  loading: boolean
  /** رسالة فشل القراءة — `null` يعني لا فشل. */
  error: string | null
  /** جذر المشاريع إن أمكن استنتاجه، ليعرف المستخدم أين تقيم مشاريعه. */
  root: string | null
  onRetry: () => void
  onOpen: (path: string) => void
  onNewProject: () => void
  onProviders: () => void
}

export default function ProjectPicker({
  projects,
  version,
  loading,
  error,
  root,
  onRetry,
  onOpen,
  onNewProject,
  onProviders,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const needle = query.trim().toLowerCase()
  const filtered = needle === '' ? projects : projects.filter((p) => p.name.toLowerCase().includes(needle))

  // إبقاء المؤشّر داخل النطاق بعد كل تصفية.
  useEffect(() => {
    setActive((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)))
  }, [filtered.length])

  const openAt = (index: number): void => {
    const hit = filtered[index]
    if (hit) onOpen(hit.path)
  }

  return (
    <div className="h-full overflow-auto bg-app">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-md bg-accent/15 px-2 py-0.5 font-mono text-[11px] text-accent">NT Studio</span>
              <span className="font-mono text-[11px] text-faint" dir="ltr">
                v{version}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">مشاريعك</h1>
            <p className="mt-1.5 text-[13px] text-mute">
              اختر مشروعًا للمتابعة، أو ابدأ مشروعًا جديدًا وسيبنيه الوكيل من وصفك.
            </p>
          </div>
          <button
            type="button"
            onClick={onProviders}
            className="h-9 shrink-0 rounded-lg border border-line px-3.5 text-[12.5px] text-dim hover:bg-panel2 hover:text-main"
          >
            المزوّدات
          </button>
        </header>

        {root && (
          <p className="mb-4 font-mono text-[11px] text-faint" dir="ltr">
            {root}
          </p>
        )}

        <div className="relative mb-1.5">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // حقل البحث يلتهم Esc قبل أن يتحوّل إلى «رجوع» عام.
                if (query !== '') {
                  e.stopPropagation()
                  e.preventDefault()
                  setQuery('')
                }
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => (filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1)))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => (filtered.length === 0 ? 0 : Math.max(i - 1, 0)))
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                openAt(active)
              }
            }}
            placeholder="ابحث باسم المشروع…"
            className="h-10 w-full rounded-lg border border-line bg-inset px-3 text-[13px] text-main placeholder:text-faint focus:border-accent"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              title="مسح البحث"
              className="absolute inset-y-1 left-1 rounded-md px-2 text-[12px] text-mute hover:bg-panel2 hover:text-main"
            >
              ×
            </button>
          )}
        </div>

        <div className="mb-4 flex items-center justify-between">
          <span className="text-[11.5px] text-faint">
            {loading ? 'جارٍ قراءة المشاريع…' : searchResultsLabel(filtered.length, projects.length)}
          </span>
          {root && <span className="text-[11.5px] text-faint">Esc للرجوع · ↑↓ للتنقّل</span>}
        </div>

        {error && (
          <div className="card mb-4 border-danger/40 px-5 py-4">
            <p className="text-[13px] text-danger">{error}</p>
            <p className="mt-1.5 text-[12px] text-mute">
              هذا ليس يعني «لا توجد مشاريع» — تعذّرت قراءة القرص.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="h-9 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-white hover:opacity-90"
              >
                إعادة المحاولة
              </button>
              <button
                type="button"
                onClick={onNewProject}
                className="h-9 rounded-lg border border-line px-4 text-[12.5px] text-dim hover:bg-panel2 hover:text-main"
              >
                اذهب لمساحة العمل
              </button>
            </div>
          </div>
        )}

        {loading && projects.length === 0 ? (
          <div className="card px-5 py-10 text-center">
            <p className="text-[13px] text-mute">جارٍ القراءة…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card px-5 py-10 text-center">
            <p className="text-[13px] text-mute">
              {projects.length === 0 ? 'لا توجد مشاريع بعد' : 'لا نتائج مطابقة'}
            </p>
            {projects.length === 0 ? (
              <>
                <p className="mx-auto mt-1.5 max-w-md text-[12px] text-faint">
                  افتح مساحة العمل واكتب ما تريد — الوكيل ينشئ المجلد و git و README، ثم يظهر
                  المشروع هنا تلقائيًا.
                </p>
                <button
                  type="button"
                  onClick={onNewProject}
                  className="mt-5 h-10 rounded-lg bg-accent px-6 text-[13px] font-medium text-white hover:opacity-90"
                >
                  ابدأ مشروعًا جديدًا
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                className="mt-4 h-9 rounded-lg border border-line px-4 text-[12.5px] text-dim hover:bg-panel2 hover:text-main"
              >
                امسح البحث
              </button>
            )}
          </div>
        ) : (
          <ul className="grid gap-2">
            {filtered.map((p, i) => (
              <li key={p.path}>
                <button
                  type="button"
                  onClick={() => onOpen(p.path)}
                  onMouseEnter={() => setActive(i)}
                  className={`card w-full px-4 py-3 text-right transition-colors hover:bg-panel2 ${
                    i === active ? 'bg-panel2' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] text-main">{p.name}</span>
                    {p.hasPackage && (
                      <span className="rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[10px] text-faint">
                        node
                      </span>
                    )}
                    <span className="text-[11px] text-faint">{fileCountLabel(p.fileCount)}</span>
                    {p.createdAt > 0 && (
                      <span className="text-[11px] text-faint">· {formatDateTime(p.createdAt)}</span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-faint" dir="ltr" title={p.path}>
                    {middleTruncate(p.path, 56)}
                  </p>
                  {p.lastSummary && (
                    <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-mute">
                      {p.lastSummary}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {projects.length > 0 && (
          <button
            type="button"
            onClick={onNewProject}
            className="mt-6 h-10 rounded-lg border border-line px-5 text-[12.5px] text-dim hover:bg-panel2 hover:text-main"
          >
            ابدأ مشروعًا جديدًا
          </button>
        )}
      </div>
    </div>
  )
}
