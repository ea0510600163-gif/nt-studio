import { Activity, Bot, CheckCircle2, Circle, Crosshair, Hand, ListChecks, Minimize2, Pause, Play, ShieldAlert, Sparkles, Square } from 'lucide-react'
import { useStore } from '@/lib/store'
import { confirmAction } from '../ConfirmDialog'
import type { ComputerAgentStatus } from '@shared/types'

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000))
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function statusMeta(status: ComputerAgentStatus): { label: string; tone: 'brass' | 'jade' | 'coral' | 'mute' } {
  switch (status) {
    case 'thinking':
      return { label: 'يحلّل ويخطّط…', tone: 'brass' }
    case 'acting':
      return { label: 'ينفّذ', tone: 'jade' }
    case 'waiting':
      return { label: 'ينتظر تأكيدك', tone: 'brass' }
    case 'paused':
      return { label: 'متوقف مؤقتاً', tone: 'brass' }
    case 'takeover':
      return { label: 'الجهاز بين يديك', tone: 'brass' }
    case 'done':
      return { label: 'مهمة منجزة', tone: 'jade' }
    case 'error':
      return { label: 'خطأ في التنفيذ', tone: 'coral' }
    default:
      return { label: 'جاهز للعمل', tone: 'mute' }
  }
}

export default function AgentConsole() {
  const computer = useStore((s) => s.computer)
  const running = useStore((s) => s.running)
  const settings = useStore((s) => s.settings)
  const computerControl = useStore((s) => s.computerControl)

  const st = statusMeta(computer.status)
  const modelId = settings?.defaultModel?.modelId ?? 'Vision Engine'
  const { stats, plan, cursor, lastActions } = computer
  const isPaused = computer.status === 'paused'
  const isTakeover = computer.status === 'takeover'
  const isActive =
    running ||
    computer.status === 'thinking' ||
    computer.status === 'acting' ||
    computer.status === 'waiting' ||
    isPaused ||
    isTakeover

  const dotColor =
    computer.status === 'acting' || computer.status === 'done'
      ? 'var(--color-jade)'
      : computer.status === 'error'
        ? 'var(--color-coral)'
        : computer.status === 'paused' || computer.status === 'takeover'
          ? '#f59e0b'
          : computer.status === 'idle'
            ? 'var(--color-faint)'
            : 'var(--ai-c1)'

  const nx = Math.max(0.03, Math.min(0.97, cursor.nx || 0.5))
  const ny = Math.max(0.05, Math.min(0.95, cursor.ny || 0.5))

  const handleStop = async () => {
    if (!isActive) return
    const ok = await confirmAction({
      title: 'إيقاف إيجنت الكمبيوتر',
      message: 'سيتم إيقاف جلسة التحكم الحالية بسطح المكتب فوراً وإلغاء أي إجراء قيد التنفيذ.',
      confirmLabel: 'إيقاف فوري',
      tone: 'coral'
    })
    if (!ok) return
    await computerControl('stop')
  }

  const metrics: [string, number | string][] = [
    ['النقرات', stats.clicks],
    ['الأحرف', stats.chars],
    ['اللقطات', stats.screenshots],
    ['الخطوات', stats.steps],
    ['الزمن', formatElapsed(stats.elapsedMs)]
  ]

  return (
    <div dir="rtl" className="grid-bg flex h-full min-h-0 flex-col overflow-auto">
      <div className="ai-hairline shrink-0" aria-hidden="true" />

      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 p-4">
        <header className="geo-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="ai-ring grid size-9 shrink-0 place-items-center rounded-xl bg-surface" style={{ color: 'var(--ai-c1)' }} aria-hidden="true">
              <Bot size={17} />
            </span>
            <div className="min-w-0">
              <strong className="t-sm font-bold text-ink">إيجنت الكمبيوتر</strong>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 t-2xs text-faint">
                <span className="mono text-mute">{modelId}</span>
                <span>·</span>
                <span className="mono" style={{ color: 'var(--ai-c1)' }}>
                  {computer.logicalWidth}×{computer.logicalHeight}
                </span>
                {computer.activeWindowTitle && (
                  <>
                    <span>·</span>
                    <span className="truncate text-ink/85" title={computer.activeWindowTitle}>
                      {computer.activeWindowTitle}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <span className="badge shrink-0 px-2.5 py-1" data-tone={st.tone === 'mute' ? undefined : st.tone}>
            <span
              className={`size-2 rounded-full ${
                isActive && !isPaused && !isTakeover && computer.status !== 'done' && computer.status !== 'error'
                  ? 'animate-pulse'
                  : ''
              }`}
              style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
            />
            <span>{st.label}</span>
          </span>
        </header>

        {computer.thought && (
          <div key={computer.thought} className="ai-msg geo-corners rise flex items-start gap-3 px-4 py-3">
            <div className="mt-0.5 flex shrink-0 items-center gap-1.5" style={{ color: 'var(--ai-c1)' }}>
              <Sparkles size={13} />
              <span className="t-xs font-bold">الآن</span>
            </div>
            <p className="min-w-0 flex-1 t-xs leading-relaxed text-ink/95" style={{ unicodeBidi: 'plaintext' }}>
              {computer.thought}
            </p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[240px_1fr]">
          <div className="geo-card relative flex flex-col justify-between overflow-hidden p-3">
            <div className="mb-2 flex items-center justify-between t-2xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                <Crosshair size={12} style={{ color: 'var(--ai-c1)' }} />
                <span>الرادار المكاني 1:1</span>
              </span>
              <span className="mono text-[10px]" style={{ color: 'var(--ai-c1)' }}>
                {cursor.x}, {cursor.y}
              </span>
            </div>

            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-hair/80 radar-screen">
              <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden="true">
                <defs>
                  <pattern id="ntGeoGrid" width="32" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 32 0 L 0 0 0 30" className="radar-grid" fill="none" strokeWidth="0.7" />
                  </pattern>
                  <radialGradient id="ntCursorGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(86,182,194,0.35)" />
                    <stop offset="100%" stopColor="rgba(86,182,194,0)" />
                  </radialGradient>
                </defs>
                <rect width="320" height="180" fill="url(#ntGeoGrid)" />
                <line x1="160" y1="0" x2="160" y2="180" className="radar-axis" strokeDasharray="3 3" strokeWidth="0.8" />
                <line x1="0" y1="90" x2="320" y2="90" className="radar-axis" strokeDasharray="3 3" strokeWidth="0.8" />

                <line x1={nx * 320} y1={0} x2={nx * 320} y2={180} className="radar-beam" strokeWidth="0.9" strokeDasharray="2 2" />
                <line x1={0} y1={ny * 180} x2={320} y2={ny * 180} className="radar-beam" strokeWidth="0.9" strokeDasharray="2 2" />

                <circle cx={nx * 320} cy={ny * 180} r="18" fill="url(#ntCursorGlow)" />
                <circle cx={nx * 320} cy={ny * 180} r="6.5" fill="none" stroke="#56b6c2" strokeWidth="1.3" />
                <circle cx={nx * 320} cy={ny * 180} r="2.2" fill="#ff385c" />
              </svg>

              <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center justify-between text-[9px] text-mute mono">
                <span>UIA + 1:1 PIXEL</span>
                <span>
                  {computer.screenWidth}×{computer.screenHeight}
                </span>
              </div>
            </div>
          </div>

          <div className="geo-card flex flex-col justify-between gap-3 p-3">
            <dl className="grid grid-cols-5 gap-2 text-center">
              {metrics.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1">
                  <dt className="t-2xs text-mute">{label}</dt>
                  <dd className="mono t-base font-bold text-ink" dir="ltr">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              {isPaused ? (
                <button className="btn !py-1.5 !px-3 t-xs" onClick={() => void computerControl('resume')} title="استئناف عمل الإيجنت">
                  <Play size={13} />
                  <span>استئناف</span>
                </button>
              ) : (
                <button
                  className="btn !py-1.5 !px-3 t-xs"
                  disabled={!isActive || isTakeover}
                  onClick={() => void computerControl('pause')}
                  title="إيقاف الإيجنت مؤقتاً"
                >
                  <Pause size={13} />
                  <span>إيقاف مؤقت</span>
                </button>
              )}

              {isTakeover ? (
                <button
                  className="btn !py-1.5 !px-3 t-xs"
                  style={{
                    background: 'color-mix(in srgb, var(--color-jade) 20%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--color-jade) 50%, transparent)',
                    color: 'var(--color-jade)'
                  }}
                  onClick={() => void computerControl('return')}
                  title="إعادة التحكم للإيجنت ليفحص الشاشة ويكمل المهمة"
                >
                  <Bot size={14} />
                  <span>أعد الإيجنت</span>
                </button>
              ) : (
                <button
                  className="btn !py-1.5 !px-3 t-xs"
                  style={{
                    background: 'color-mix(in srgb, var(--ai-c1) 12%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--ai-c1) 45%, transparent)',
                    color: 'var(--ai-c1)'
                  }}
                  onClick={() => void computerControl('takeover')}
                  title="استلم التحكم بالماوس والكيبورد بنفسك فوراً"
                >
                  <Hand size={13} />
                  <span>استلم أنا</span>
                </button>
              )}

              <button
                className="btn !py-1.5 !px-3 t-xs"
                onClick={() => void computerControl('minimize_studio')}
                title="تصغير البرنامج ومتابعة الإيجنت عبر الشريط العائم"
              >
                <Minimize2 size={13} />
                <span>تصغير</span>
              </button>

              <span className="flex-1" />

              <button
                className="btn btn-danger !py-1.5 !px-3.5 t-xs font-bold"
                disabled={!isActive}
                onClick={() => void handleStop()}
                title="إيقاف فوري لجلسة التحكم"
              >
                <Square size={12} />
                <span>إيقاف</span>
              </button>
            </div>
          </div>
        </div>

        {computer.stuck && (
          <div
            className="geo-card flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 t-xs font-semibold leading-relaxed"
            style={{
              borderColor: 'color-mix(in srgb, var(--color-coral) 55%, transparent)',
              background: 'color-mix(in srgb, var(--color-coral) 12%, transparent)',
              color: 'var(--color-coral)'
            }}
          >
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <p>
              {computer.stuck.kind} تكررت {computer.stuck.repeats} مرات بلا تغيير في الشاشة.
            </p>
          </div>
        )}

        {plan.length > 0 && (
          <div className="geo-card rounded-xl p-3">
            <div className="mb-2 flex items-center justify-between t-2xs text-mute">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                <ListChecks size={13} style={{ color: 'var(--ai-c2)' }} />
                <span>خطة المهمة</span>
              </span>
              <span className="mono">
                {plan.filter((p) => p.state === 'done').length}/{plan.length}
              </span>
            </div>
            <div className="grid max-h-32 gap-1.5 overflow-auto sm:grid-cols-2">
              {plan.map((step, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 t-xs ${
                    step.state === 'active'
                      ? 'border-sky/40 bg-raised font-medium'
                      : step.state === 'done'
                        ? 'border-jade/25 bg-jade/5 text-jade'
                        : 'border-hair/40 bg-bg/40 text-mute'
                  }`}
                  style={step.state === 'active' ? { color: 'var(--ai-c1)' } : undefined}
                >
                  {step.state === 'done' ? (
                    <CheckCircle2 size={13} className="shrink-0 text-jade" />
                  ) : step.state === 'active' ? (
                    <span className="inline-block size-2 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--ai-c1)' }} />
                  ) : (
                    <Circle size={12} className="shrink-0 text-faint" />
                  )}
                  <span className={`truncate ${step.state === 'done' ? 'line-through opacity-80' : ''}`}>{step.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {lastActions.length > 0 && (
          <div className="geo-card rounded-xl p-3">
            <div className="mb-2 flex items-center justify-between t-2xs text-mute">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                <Activity size={13} style={{ color: 'var(--ai-c1)' }} />
                <span>سجل العمليات</span>
              </span>
              <span className="mono text-[10px] text-faint">{lastActions.length}</span>
            </div>
            <div className="space-y-1.5">
              {lastActions.map((act) => (
                <div
                  key={act.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hair/50 bg-bg/65 px-3 py-1.5 t-2xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="mono rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: 'color-mix(in srgb, var(--ai-c1) 14%, transparent)', color: 'var(--ai-c1)' }}
                    >
                      {act.kind}
                    </span>
                    <span className="truncate text-ink/90">{act.detail || act.text || act.kind}</span>
                    {act.hitRole && (
                      <span className="mono truncate rounded border border-hair bg-surface px-1.5 py-0.5 text-[10px] text-mute">
                        {act.hitRole}
                        {act.hitName ? `: ${act.hitName}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 mono text-[10px]">
                    {act.x != null && act.y != null && <span className="text-mute">({act.x},{act.y})</span>}
                    {act.ms != null && <span className="text-faint">{act.ms}ms</span>}
                    {act.changedScreen !== undefined && (
                      <span className={act.changedScreen ? 'text-jade' : 'text-faint'}>
                        {act.changedScreen ? 'تغيّر مرئي' : 'ثابت'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
