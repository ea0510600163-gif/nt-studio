import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/api'

/**
 * S1 — هيكل فقط: يتحقق من أن الجسر بين الواجهة والعملية الرئيسية يعمل.
 * تُستبدل هذه الشاشة بالكامل في S7 بواجهة مزوّدات + مساحة عمل.
 */
export default function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.studio.app.info().then(setInfo).catch((e: unknown) => setError(String(e)))
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-app text-main">
      <h1 className="text-2xl font-semibold tracking-tight">NT Studio</h1>
      <p className="text-sm text-mute">وكيل سطح مكتب يبني مشاريع حقيقية بالذكاء الاصطناعي</p>
      {error ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger">
          فشل الجسر: {error}
        </p>
      ) : info ? (
        <p className="font-mono text-xs text-faint" dir="ltr">
          electron {info.electron} · node {info.node} · chrome {info.chrome}
        </p>
      ) : (
        <p className="text-xs text-faint">جارٍ الاتصال…</p>
      )}
      <span className="mt-2 rounded-full border border-line bg-panel px-3 py-1 text-[11px] text-mute">
        S1 · الهيكل جاهز
      </span>
    </div>
  )
}