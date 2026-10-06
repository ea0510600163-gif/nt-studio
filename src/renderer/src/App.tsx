import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/api'
import type { ProviderPublic } from '../../shared/providers'
import ProvidersScreen from './components/ProvidersScreen'
import ProjectPicker from './components/ProjectPicker'
import ChatPanel from './components/ChatPanel'
import { useWorkspace } from './stores/workspace'

/**
 * جذر التطبيق.
 *
 * التوجيه بسيط ومقصود — لا مكتبة توجيه لثلاث شاشات فقط.
 * ثلاث حالات: إعداد (لا مزوّد) ← اختيار مشروع ← مساحة عمل.
 */

type Screen = 'providers' | 'workspace'

export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [providers, setProviders] = useState<ProviderPublic[] | null>(null)
  const [screen, setScreen] = useState<Screen>('providers')

  const { setProjects, projects, projectPath, setProject, setActive } = useWorkspace()

  useEffect(() => {
    window.studio.app.info().then(setInfo).catch(() => undefined)

    void (async () => {
      const list = await window.studio.providers.list()
      setProviders(list)
      setScreen(list.length === 0 ? 'providers' : 'workspace')

      const first = list[0]
      if (first) {
        const model = first.models[0] ?? null
        setActive(first.id, model)
        if (model) await window.studio.providers.setActive(first.id, model)
      }

      setProjects(await window.studio.providers.listProjects())
    })()
  }, [setActive, setProjects])

  /* المكوّن نفسه يتولّى تمرير حدوده إلى العملية الرئيسية */

  if (providers === null) {
    return <div className="grid h-full place-items-center bg-app text-[13px] text-faint">جارٍ التحميل…</div>
  }

  if (screen === 'providers' || providers.length === 0) {
    return (
      <ProvidersScreen
        providers={providers}
        onChanged={(list) => {
          setProviders(list)
          if (list.length > 0) {
            const first = list[0]
            if (first) {
              setActive(first.id, first.models[0] ?? null)
              setScreen('workspace')
            }
          }
        }}
      />
    )
  }

  if (!projectPath) {
    return (
      <ProjectPicker
        projects={projects}
        version={info?.version ?? ''}
        onOpen={(path) => {
          setProject(path)
          setScreen('workspace')
        }}
        onProviders={() => setScreen('providers')}
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <button
          type="button"
          onClick={() => setScreen('providers')}
          className="text-[12.5px] text-mute hover:text-main"
        >
          ← المزوّدات
        </button>
        <div className="h-3 w-px bg-line" />
        <span className="truncate text-[12.5px] text-main">
          {projects.find((p) => p.path === projectPath)?.name ?? 'مشروع'}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setProject(null)}
          className="h-7 rounded-lg border border-line px-2.5 text-[11.5px] text-mute hover:bg-panel2 hover:text-main"
        >
          كل المشاريع
        </button>
        <span className="font-mono text-[10.5px] text-faint" dir="ltr">
          {info ? `v${info.version}` : ''}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        <ChatPanel />
      </div>
    </div>
  )
}