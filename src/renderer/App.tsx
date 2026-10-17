import { useEffect, useRef, useState } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import Chat from './components/Chat'
import CommandPalette from './components/CommandPalette'
import { ProjectsDrawer, SettingsModal } from './components/Overlays'
import ProviderForm from './components/ProviderForm'
import Stage from './components/Stage'
import TopBar from './components/TopBar'
import WorkspaceRail, { type WorkspaceLayout } from './components/WorkspaceRail'
import { ThemeProvider } from './lib/theme'
import { useStore } from './lib/store'

/** حدود عرض عمود الشات — نفس ما يقبله الفاصل بالسحب */
const W_MIN = 340
const W_MAX = 680
const W_STEP = 16
const clampW = (v: number) => Math.min(W_MAX, Math.max(W_MIN, v))
/** مهلة الإقلاع: بعدها نعتبر التحميل متعذّراً ونعرض طريقاً للخروج بدل شاشة ميتة */
const BOOT_GRACE = 8000

/**
 * الإقلاع: «جارٍ التحميل…» أولاً، ثم شاشة قابلة للاستئناف إن لم تكتمل البيانات.
 * bootstrap() في المخزن بلا مسار خطأ — لا نعدّله، ولكنّ الواجهة لا تتجمّد عليه.
 */
function BootGate() {
  const ready = useStore((s) => s.ready)
  const [attempt, setAttempt] = useState(0)
  const [waiting, setWaiting] = useState(true)

  useEffect(() => {
    if (ready) return
    setWaiting(true)
    const t = setTimeout(() => setWaiting(false), BOOT_GRACE)
    return () => clearTimeout(t)
  }, [ready, attempt])

  if (waiting) return <div className="grid h-full place-items-center t-md text-mute">جارٍ التحميل…</div>

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="pop rise w-full max-w-[440px] r-4 p-6">
        <div className="mx-auto grid size-10 place-items-center r-full" style={{ background: 'color-mix(in srgb, var(--color-coral) 16%, transparent)', color: 'var(--color-coral)' }}>
          <TriangleAlert size={18} />
        </div>
        <h1 className="mt-4 text-center font-display t-xl font-bold">تعذّر إكمال الإقلاع</h1>
        <p className="mt-2 text-center t-sm text-mute">لم تصل بيانات المشروع والجلسات في الوقت المتوقّع. أعد المحاولة، وإن تكرّر فراجع سجلّ التطبيق (app.log داخل مجلد logs في بيانات المستخدم) لمزيد من التفصيل.</p>
        <button
          className="btn btn-brass mx-auto mt-5"
          onClick={() => { setAttempt((a) => a + 1); void useStore.getState().bootstrap().catch(() => {}) }}
        >
          <RotateCcw size={15} /> إعادة المحاولة
        </button>
      </div>
    </div>
  )
}

function FirstRun({ onSaved }: { onSaved: () => void }) {
  return (
    // items-start + my-auto: المحتوى العالي يُدرَّ من أعلى (لا يُقطع أعلاه) ويبقى موسّطاً إن اتّسع
    <div className="grid h-full items-start overflow-auto p-8" style={{ paddingTop: 'var(--sp-16)' }}>
      <div className="my-auto grid w-full max-w-[980px] items-start gap-12 md:grid-cols-[1fr_1.25fr]">
        <div className="md:sticky md:top-8">
          <div className="mb-6 grid size-14 place-items-center r-5 bg-brass font-display t-3xl font-bold text-[#1a1206]">ن</div>
          <h1 className="font-display t-5xl font-bold leading-[1.45]">مرحباً في NT Studio</h1>
          <p className="mt-3 max-w-[36ch] t-lg text-mute">وكيل برمجي يعمل على جهازك. تصف له ما تريد، فيبني المشروع ويشغّله ويفحصه بنفسه ويسلّمه جاهزاً.</p>
          <p className="mt-6 t-md text-faint">الخطوة الأولى: أضف مزود النموذج الذي سيفكّر ويقرّر. يمكنك إضافة أكثر من مزود لاحقاً.</p>
        </div>
        <div className="card p-6">
          <ProviderForm onDone={onSaved} />
        </div>
      </div>
    </div>
  )
}

function AppContent() {
  const ready = useStore((s) => s.ready)
  const providers = useStore((s) => s.providers)
  const overlay = useStore((s) => s.overlay)
  const toast = useStore((s) => s.toast)
  const chatW = useStore((s) => s.chatW)
  const mode = useStore((s) => s.mode)
  const [palette, setPalette] = useState(false)
  const [layout, setLayout] = useState<WorkspaceLayout>('split')
  const [railOpen, setRailOpen] = useState(true)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const workspace = useRef<HTMLDivElement>(null)
  const [firstSaved, setFirstSaved] = useState(false)
  const drag = useRef(false)
  /** العرض الحي أثناء السحب — يقرأه المستمع المثبّت ([], لا [w]) فيعيد الاشتراك مع كل بكسل */
  const wRef = useRef(chatW)

  // الربط والفصل في تأثير واحد: الفصل يمنع تراكم المشتركين تحت StrictMode
  useEffect(() => useStore.getState().bind(), [])
  useEffect(() => { void useStore.getState().bootstrap().catch(() => {}) }, [])
  useEffect(() => { if (overlay !== null || palette) void window.nt.preview.setSuppressed(true) }, [overlay, palette])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const update = () => setCompact(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // العرض المخزون يغذّي الحالة مرّة واحدة — المصدر بعدها هو المخزن
  useEffect(() => {
    const v = Number(localStorage.getItem('nt.chatW'))
    if (v) useStore.getState().setChatWidth(clampW(v))
  }, [])
  useEffect(() => { wRef.current = chatW }, [chatW])

  useEffect(() => {
    const mv = (e: PointerEvent) => {
      if (!drag.current) return
      const w = clampW((workspace.current?.getBoundingClientRect().right ?? window.innerWidth) - e.clientX)
      wRef.current = w
      useStore.getState().setChatWidth(w)
    }
    // رفع المؤشّر خارج النافذة (أو إلغاؤه) يجب أن يُخرج من السحب ويُصفّر المؤشّر
    const end = () => {
      if (!drag.current) return
      drag.current = false
      document.body.style.cursor = ''
      localStorage.setItem('nt.chatW', String(wRef.current))
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
    }
  }, [])

  // لوحة الأوامر: Ctrl+K / Ctrl+P — بلا فعل داخل الحقول إلا Escape
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null
      const editable = !!el?.closest('input, textarea, select, [contenteditable="true"]')
      if (e.key === 'Escape') { setPalette(false); return }
      if (e.repeat || editable) return
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        setPalette(true)
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // تسليم أول تشغيل: أوّل مزود محفوظ ⇒ الإعدادات لاختيار النموذج الافتراضي فوراً
  useEffect(() => {
    if (!firstSaved) return
    const t = setInterval(() => {
      if (!useStore.getState().providers.length) return
      clearInterval(t)
      useStore.getState().setOverlay('settings')
    }, 100)
    return () => clearInterval(t)
  }, [firstSaved])

  const setWidth = (v: number) => {
    const w = clampW(v)
    useStore.getState().setChatWidth(w)
    localStorage.setItem('nt.chatW', String(w))
  }

  if (!ready) return <BootGate />
  const switchMode = (m: typeof mode) => {
    // دخول وضع Agent بلا مسرح مرئي لا معنى له — أعد التخطيط المتكامل عند الحاجة
    if (m === 'agent' && layout === 'chat') setLayout('split')
    void useStore.getState().setMode(m).catch(() => {})
  }
  return (
    <div className="studio-app">
      <TopBar layout={layout} onLayout={setLayout} railOpen={railOpen} onRail={() => setRailOpen((v) => !v)} mode={mode} onMode={switchMode} />
      {providers.length === 0 ? (
        <FirstRun onSaved={() => setFirstSaved(true)} />
      ) : (
        <main className="studio-main">
          {railOpen && <WorkspaceRail layout={layout} onLayout={setLayout} onCommands={() => setPalette(true)} onClose={() => setRailOpen(false)} />}
          <div ref={workspace} className="workspace-panels" data-layout={layout}>
          <div style={{ width: chatW }} className="chat-column" hidden={layout === 'stage'}><Chat /></div>
          <div
            hidden={layout !== 'split' || compact}
            role="separator"
            aria-orientation="vertical"
            aria-label="تغيير عرض لوحة المحادثة"
            aria-valuenow={chatW}
            aria-valuemin={W_MIN}
            aria-valuemax={W_MAX}
            tabIndex={0}
            onPointerDown={() => { drag.current = true; document.body.style.cursor = 'col-resize' }}
            onKeyDown={(e) => {
              // الشات على يمين الفاصل في RTL: السهم الأيسر يوسّعه (كالسحب يساراً)
              if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(chatW + W_STEP) }
              else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(chatW - W_STEP) }
              else if (e.key === 'Home') { e.preventDefault(); setWidth(W_MIN) }
              else if (e.key === 'End') { e.preventDefault(); setWidth(W_MAX) }
            }}
            className="workspace-divider"
          />
          <div className="stage-column" hidden={layout === 'chat' || (compact && layout === 'split')}><Stage active={!palette && layout !== 'chat' && !(compact && layout === 'split')} /></div>
          </div>
        </main>
      )}
      {overlay === 'projects' && <ProjectsDrawer />}
      {overlay === 'settings' && <SettingsModal />}
      {toast && (
        // تمركز فيزيائي بلا transform: الحاوية الممتدة توسّط الصندوق — ولا
        // يسرق متحرّك .rise الانحياز الأفقي أثناء صعوده (كان يزلّ بعرضه نصفه)
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
          <div role={toast.level === 'error' ? 'alert' : 'status'} data-level={toast.level} className="toast rise pointer-events-auto">
            {toast.text}
          </div>
        </div>
      )}
      {palette && <CommandPalette onClose={() => setPalette(false)} onNavigate={() => setLayout('stage')} />}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}
