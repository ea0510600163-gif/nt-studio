import { useEffect, useState } from 'react'
import type { ProjectInfo } from '../../../shared/api'
import { useWorkspace } from '../stores/workspace'

/**
 * اختيار المشروع.
 *
 * لا زر "مشروع جديد" هنا — المشروع الجديد يصنعه الوكيل عبر create_project
 * لأن ذلك يبني git و README و .agent في خطوة واحدة متّسقة.
 */

interface Props {
  projects: ProjectInfo[]
  version: string
  onOpen: (path: string) => void
  onProviders: () => void
}

export default function ProjectPicker({ projects, version, onOpen, onProviders }: Props): React.JSX.Element {
  const setProjects = useWorkspace((s) => s.setProjects)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void window.studio.providers.listProjects().then(setProjects).catch(() => undefined)
  }, [setProjects])

  const filtered = projects.filter((p) =>
    query.trim() === '' ? true : p.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

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
              اختر مشروعًا للمتابعة، أو اكتب في الشات طلبًا جديدًا وسيُنشأ لك مشروع.
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

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث باسم المشروع…"
          className="mb-4 h-10 w-full rounded-lg border border-line bg-inset px-3 text-[13px] text-main placeholder:text-faint outline-none focus:border-accent"
        />

        {filtered.length === 0 ? (
          <div className="card px-5 py-10 text-center">
            <p className="text-[13px] text-mute">
              {projects.length === 0 ? 'لا توجد مشاريع بعد' : 'لا نتائج مطابقة'}
            </p>
            <p className="mt-1.5 text-[12px] text-faint">
              افتح مساحة العمل واطلب ما تريد — سينشئه الوكيل ويضيفه هنا.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {filtered.map((p) => (
              <li key={p.path}>
                <button
                  type="button"
                  onClick={() => onOpen(p.path)}
                  className="card w-full px-4 py-3 text-right transition-colors hover:bg-panel2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] text-main">{p.name}</span>
                    {p.hasPackage && (
                      <span className="rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[10px] text-faint">
                        node
                      </span>
                    )}
                    <span className="text-[11px] text-faint">{p.fileCount} ملف</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-faint" dir="ltr">
                    {p.path}
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

        </div>
    </div>
  )
}