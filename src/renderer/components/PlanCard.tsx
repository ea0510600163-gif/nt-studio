import { AlertTriangle, Check, ChevronDown, Circle, ListChecks, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { planProgress } from '@/lib/plan'

export default function PlanCard() {
  const plan = useStore((s) => s.plan)
  const running = useStore((s) => s.running)
  const [open, setOpen] = useState(false)

  if (!plan.length) return null
  const p = planProgress(plan)
  const allDone = p.total > 0 && p.done === p.total
  if (allDone && !running) return null

  return (
    <div className="plan-card" data-open={open} data-live={running}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? 'إخفاء خطة التنفيذ' : 'عرض خطة التنفيذ وحالة كل بند'}
        className="plan-bar"
      >
        <ListChecks size={12} className="shrink-0 text-brass-hi" />
        <span className="shrink-0 t-2xs font-medium">الخطة</span>
        <span className="num shrink-0 t-2xs text-faint">{p.done}/{p.total}</span>
        {p.blocked > 0 && <span className="num shrink-0 t-2xs text-coral">{p.blocked} متعذّرة</span>}
        <span className="plan-track" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة إنجاز الخطة">
          <span className="plan-fill" data-done={allDone} style={{ width: `${p.pct}%` }} />
        </span>
        <ChevronDown size={12} className={`shrink-0 text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className="wg-collapse" data-open={open}>
        <div className="min-h-0 overflow-hidden">
          <ul className="plan-list">
            {plan.map((item) => {
              const active = item.status === 'doing' && running
              return (
                <li key={item.id} className="plan-item" data-status={item.status} data-active={active}>
                  {item.status === 'doing' ? (
                    running ? (
                      <LoaderCircle size={12} className="spin mt-0.5 shrink-0 text-brass-hi" />
                    ) : (
                      <Circle size={12} strokeWidth={1.6} className="mt-0.5 shrink-0 text-brass-hi" />
                    )
                  ) : item.status === 'done' ? (
                    <Check size={12} strokeWidth={3} className="mt-0.5 shrink-0 text-jade" />
                  ) : item.status === 'blocked' ? (
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-coral" />
                  ) : (
                    <Circle size={11} strokeWidth={1.5} className="mt-1 shrink-0 text-faint" />
                  )}
                  <span className="min-w-0 flex-1">{item.text}</span>
                  {item.status === 'doing' && running && <span className="shrink-0 t-2xs text-brass-hi">جارٍ</span>}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
