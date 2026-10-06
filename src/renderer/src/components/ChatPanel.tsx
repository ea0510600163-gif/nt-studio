import { useEffect, useMemo, useRef, useState } from 'react'
import { phaseLabel, useWorkspace, VIEWPORT_SIZES } from '../stores/workspace'

/**
 * لوحة الشات (ضيقة، حسب الطلب) — تحكي وت.stream وتعرض كل خطوة.
 *
 * ملاحظة تصميم: نمرّر موضع المعاينة إلى العملية الرئيسية لأن preview
 * عبارة عن WebContentsView حقيقي لا iframe.
 */

const FIELD =
  'w-full bg-inset border border-line rounded-lg px-3 py-2.5 text-[13px] text-main placeholder:text-faint outline-none focus:border-accent resize-none transition-colors'

export default function ChatPanel(): React.JSX.Element {
  const {
    lines,
    streamingText,
    tools,
    notices,
    running,
    phase,
    phaseDetail,
    providerId,
    modelId,
    awaitingQuestion,
    pushUserLine,
    resetRun,
    applyEvent,
    setAwaitingQuestion,
    previewUrl,
    setConsoleIssues,
    viewport,
    setViewport,
    projects,
    projectPath,
    plan,
    consoleIssues,
  } = useWorkspace()

  const [draft, setDraft] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const active = useMemo(
    () => projects.find((p) => p.path === projectPath) ?? null,
    [projects, projectPath],
  )

  /* ------------------------------- التمرير ------------------------------- */
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, streamingText, tools.length])

  /* ------------------------ تمرير حدود المعاينة ------------------------- */
  useEffect(() => {
    const el = previewRef.current
    if (!el) return undefined

    const rect0 = el.getBoundingClientRect()

    // attach ينشئ الـ view؛ resize يحدّث موضعه بعد كل تغيير في التخطيط
    void window.studio.preview
      .attach({ x: rect0.left, y: rect0.top, width: rect0.width, height: rect0.height })
      .catch(() => undefined)

    const push = (): void => {
      const rect = el.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) return
      void window.studio.preview.resize({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }

    const observer = new ResizeObserver(push)
    observer.observe(el)
    window.addEventListener('resize', push)
    const timer = window.setTimeout(push, 80)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', push)
      window.clearTimeout(timer)
    }
  }, [previewUrl])

  /* ------------------------------- الأحداث ------------------------------ */
  useEffect(() => window.studio.agent.onEvent(applyEvent), [applyEvent])

  /* ---------------------- عنوان المعاينة (يبثّه main) ------------------- */
  useEffect(
    () =>
      window.studio.preview.onUrl((url) => {
        useWorkspace.getState().setPreviewUrl(url)
      }),
    [],
  )

  /* ------------------------------ التشغيل ------------------------------- */
  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || running || busy) return
    if (!providerId || !modelId) return

    pushUserLine(text)
    setDraft('')
    resetRun()
    setBusy(true)
    try {
      const res = await window.studio.agent.run({
        prompt: text,
        providerId,
        modelId,
        projectPath,
      })
      if (!res.ok) {
        useWorkspace.setState({
          phase: 'error',
          notices: [
            ...useWorkspace.getState().notices,
            { level: 'error', message: res.message ?? 'تعذّر البدء', at: Date.now() },
          ],
        })
      }
    } catch (e) {
      setAwaitingQuestion(null)
      useWorkspace.setState({
        phase: 'error',
        notices: [
          ...useWorkspace.getState().notices,
          { level: 'error', message: (e as Error).message, at: Date.now() },
        ],
      })
    } finally {
      useWorkspace.setState({ running: true })
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    await window.studio.agent.stop()
    useWorkspace.setState({ running: false, phase: 'idle', streaming: false })
  }

  /* ------------------------------ المعاينة ------------------------------ */
  const openExternal = async (): Promise<void> => {
    if (previewUrl) await window.studio.preview.openExternal(previewUrl)
  }

  const reload = async (): Promise<void> => {
    await window.studio.preview.reload()
    const issues = await window.studio.preview.consoleErrors()
    setConsoleIssues(issues)
  }

  const refreshShot = async (): Promise<void> => {
    const res = await window.studio.preview.screenshot()
    if (res.ok && res.dataUrl) useWorkspace.setState({ screenshot: res.dataUrl })
  }

  const changeViewport = (v: typeof viewport): void => {
    setViewport(v)
    void window.studio.preview.setViewport(VIEWPORT_SIZES[v])
  }

  const canSend = draft.trim().length > 0 && !running && !busy && Boolean(providerId && modelId)

  return (
    <div className="flex h-full min-w-0 flex-col bg-panel">
      {/* الحالة */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            running ? 'bg-accent animate-pulse' : phase === 'error' ? 'bg-danger' : 'bg-success'
          }`}
        />
        <span className="text-[12px] text-dim">{phaseLabel(phase)}</span>
        {phaseDetail && (
          <span className="min-w-0 truncate font-mono text-[11px] text-faint" dir="ltr">
            {phaseDetail}
          </span>
        )}
        <div className="flex-1" />
        {running && (
          <button
            type="button"
            onClick={() => void stop()}
            className="h-7 rounded-lg border border-danger/40 px-2.5 text-[11.5px] text-danger hover:bg-danger/10"
          >
            إيقاف
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowLog((s) => !s)}
          className="h-7 rounded-lg border border-line px-2.5 text-[11.5px] text-mute hover:bg-panel2 hover:text-main"
        >
          السجل
        </button>
      </div>

      {/* الخطة */}
      {plan.length > 0 && (
        <div className="shrink-0 border-b border-line bg-panel2 px-3 py-2">
          <div className="mb-1 text-[10.5px] text-faint">الخطة</div>
          <ol className="grid gap-0.5">
            {plan.map((step) => (
              <li key={step.index} className="flex items-start gap-2 text-[11.5px]">
                <span
                  className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    step.status === 'done'
                      ? 'bg-success'
                      : step.status === 'active'
                        ? 'bg-accent'
                        : step.status === 'failed'
                          ? 'bg-danger'
                          : 'bg-line2'
                  }`}
                />
                <span
                  className={
                    step.status === 'done'
                      ? 'text-faint line-through'
                      : step.status === 'active'
                        ? 'text-main'
                        : 'text-mute'
                  }
                >
                  {step.title}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* المحادثة */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {lines.length === 0 && !streamingText && tools.length === 0 && (
          <div className="pt-8 text-center">
            <p className="text-[13px] text-mute">اطلب ما تريد وسأبنيه لك</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
              موقع · لعبة · أداة · أي شيء يعمل في المتصفح
            </p>
          </div>
        )}

        <div className="grid gap-3">
          {lines.map((line) => (
            <div key={line.id}>
              {line.role === 'user' ? (
                <div className="rounded-lg border border-line bg-inset px-3 py-2 text-[12.5px] text-main">
                  {line.text}
                </div>
              ) : (
                <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-dim">{line.text}</div>
              )}
            </div>
          ))}

          {/* الأدوات */}
          {tools.slice(-6).map((tool) => (
            <div key={`${tool.at}-${tool.name}`} className="flex items-center gap-2 text-[11.5px]">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  tool.status === 'running'
                    ? 'bg-accent animate-pulse'
                    : tool.status === 'done'
                      ? 'bg-success'
                      : 'bg-danger'
                }`}
              />
              <span className="font-mono text-faint" dir="ltr">
                {tool.name}
              </span>
              {tool.summary && (
                <span className="min-w-0 flex-1 truncate text-mute">{tool.summary}</span>
              )}
              {tool.ms > 0 && (
                <span className="shrink-0 font-mono text-faint">{tool.ms}ms</span>
              )}
            </div>
          ))}

          {/* البث المباشر */}
          {streamingText && (
            <div className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-dim">
              {streamingText}
              <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />
            </div>
          )}

          {/* سؤال للمستخدم */}
          {awaitingQuestion && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
              {awaitingQuestion}
            </div>
          )}
        </div>
      </div>

      {/* المعاينة */}
      <div className="shrink-0 border-t border-line">
        <div className="flex h-9 items-center gap-1.5 px-3">
          <span className="text-[11px] text-faint">المعاينة</span>
          <div className="flex-1" />
          {(['full', 'laptop', 'tablet', 'mobile'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeViewport(v)}
              title={v}
              className={`h-6 w-6 rounded grid place-items-center text-[10px] transition-colors ${
                viewport === v ? 'bg-panel3 text-main' : 'text-faint hover:text-main'
              }`}
            >
              {v === 'full' ? '⛶' : v === 'laptop' ? '▭' : v === 'tablet' ? '▯' : '▮'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void reload()}
            disabled={!previewUrl}
            className="h-6 rounded border border-line px-2 text-[10.5px] text-mute hover:bg-panel2 hover:text-main disabled:opacity-40"
          >
            تحديث
          </button>
          <button
            type="button"
            onClick={() => void refreshShot()}
            disabled={!previewUrl}
            className="h-6 rounded border border-line px-2 text-[10.5px] text-mute hover:bg-panel2 hover:text-main disabled:opacity-40"
          >
            لقطة
          </button>
          <button
            type="button"
            onClick={() => void openExternal()}
            disabled={!previewUrl}
            className="h-6 rounded border border-line px-2 text-[10.5px] text-mute hover:bg-panel2 hover:text-main disabled:opacity-40"
          >
            خارجي
          </button>
        </div>

        {/* حاوية يقيم فيها WebContentsView — يجب أن تكون فارغة تمامًا */}
        <div
          ref={previewRef}
          className="relative h-[46%] min-h-[220px] w-full bg-inset"
        >
          {!previewUrl && (
            <div className="grid h-full place-items-center px-4 text-center">
              <p className="text-[11.5px] text-faint">
                {active ? 'لم يبدأ الخادم بعد — اطلب البناء وسيظهر هنا' : 'لا يوجد مشروع مفتوح'}
              </p>
            </div>
          )}
        </div>

        {consoleIssues.length > 0 && (
          <div className="max-h-24 overflow-auto border-t border-line bg-panel2 px-3 py-1.5">
            {consoleIssues.slice(-6).map((issue, i) => (
              <div key={i} className="truncate font-mono text-[10.5px] text-danger/80" dir="ltr">
                {issue.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* السجل */}
      {showLog && (
        <div className="max-h-40 shrink-0 overflow-auto border-t border-line bg-inset px-3 py-2">
          {notices.length === 0 ? (
            <p className="text-[11px] text-faint">لا يوجد سجل</p>
          ) : (
            notices.slice(-60).map((n, i) => (
              <div
                key={i}
                className={`font-mono text-[10.5px] leading-relaxed ${
                  n.level === 'error' ? 'text-danger' : n.level === 'warn' ? 'text-warn' : 'text-faint'
                }`}
                dir="ltr"
              >
                {n.message.replace(/\n$/, '')}
              </div>
            ))
          )}
        </div>
      )}

      {/* المُدخل */}
      <div className="shrink-0 border-t border-line p-3">
        <textarea
          className={FIELD}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={awaitingQuestion ? 'اكتب ردّك…' : 'اكتب ما تريد بناءه… (Ctrl+Enter للإرسال)'}
          disabled={running}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="h-9 rounded-lg bg-accent px-4 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'يعمل…' : 'إرسال'}
          </button>
          <span className="truncate font-mono text-[10.5px] text-faint">
            {modelId ?? 'لم تختر نموذجًا'}
          </span>
        </div>
      </div>
    </div>
  )
}