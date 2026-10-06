import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/api'
import type { ProviderPublic } from '../../shared/providers'
import ProvidersScreen from './components/ProvidersScreen'

/**
 * S3 — التوجيه: أول تشغيل ⇒ شاشة المزوّدات. بعدها ⇒ مساحة العمل
 * (تُبنى بالكامل في S7؛ هنا-placeholders واضحة لا واجهات وهمية).
 */
export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [providers, setProviders] = useState<ProviderPublic[] | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    window.studio.app.info().then(setInfo).catch(() => undefined)
    window.studio.providers.list().then(setProviders).catch(() => setProviders([]))
  }, [])

  if (providers === null) {
    return (
      <div className="grid h-full place-items-center bg-app text-[13px] text-faint">جارٍ التحميل…</div>
    )
  }

  const firstRun = providers.length === 0
  if (firstRun || showSettings) {
    return (
      <ProvidersScreen
        providers={providers}
        onChanged={setProviders}
        onClose={firstRun ? undefined : () => setShowSettings(false)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <span className="text-[13.5px] font-medium">NT Studio</span>
        <span className="rounded-md bg-success/15 px-2 py-0.5 text-[11px] text-success">جاهز</span>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-faint" dir="ltr">
          {info ? `electron ${info.electron} · node ${info.node}` : ''}
        </span>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="h-8 rounded-lg border border-line px-3 text-[12px] text-dim hover:bg-panel2 hover:text-main"
        >
          المزوّدات
        </button>
      </header>

      <div className="grid flex-1 place-items-center px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl border border-line bg-panel2">
            <span className="text-[18px]">◍</span>
          </div>
          <h2 className="text-[15px] font-medium">مساحة العمل جاهزة للانطلاق</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-mute">
            اختُبرت المزوّدات وبقي بناء {`محرك الوكيل (S4)، مدير المشاريع (S5)، والمعاينة والفحص (S6)`}.
            هذه المراحل هي التي تحوّل الطلب إلى مشروع حقيقي.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
            {providers.map((p) => (
              <span key={p.id} className="rounded-md border border-line bg-panel2 px-2 py-1 text-mute">
                {p.name} · {p.models.length} نموذج
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}