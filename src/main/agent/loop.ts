import type { AgentEvent, ImageAttachment, ModelInfo, ModelRef, Phase, ProjectInfo, TodoItem } from '@shared/types'
import { compactAtThreshold, FALLBACK_ATTEMPTS, IDLE_MS_PATIENT, LIMITS, PRIMARY_ATTEMPTS, SUMMARIZER_ATTEMPTS, idleMsForAttempt } from '../config'
import { send } from '../bus'
import { log, redact } from '../logger'
import { callLlm } from '../providers/llm'
import { withRetry } from '../providers/retry'
import { Block, LlmError, LlmResult, Msg } from '../providers/types'
import { ResolvedTarget, getSettings, listVisionModel, resolveModel } from '../store/providers'
import { db } from '../store/db'
import { getTool, toSchemas, toolsForMode } from '../tools/registry'
import { gateTool } from '../tools/permission'
import { toolValidationError } from '../tools/types'
import type { Tool, ToolContext, ToolResult } from '../tools/types'
import { abortError, abortable, clip, errMsg, isAbort, uid } from '../util'
import { checkpoint, logToolCallTrimmed, touchProject } from '../workspace/projects'
import { buildCompacted, dropStaleImages, estimateTokens, persistable, shrinkOld } from './context'
import { LoopGuard, callSignature, normalizeTarget } from './loopGuard'
import { actionsDigest, agentMemorySection, createAgentMemory, recordAction, recordAgentFile, setAgentGoal } from './agentMemory'
import { longTermSection, recordTaskOutcome } from './agentNotes'
import { pickModelRef } from './modelRef'
import { buildSystemPrompt } from './prompt'
import { Session } from './session'
import { promoteReasoningAnswer } from './chatItems'
import { opencodeSessionKey } from '../providers/opencode/headers'
import { desktopController } from '../desktop/controller'

const emit = (e: AgentEvent) => send('agent:event', e)

function memoryFor(s: Session): string | undefined {
  if (s.mode !== 'agent') return undefined
  return [s.memory ? agentMemorySection(s.memory) : '', longTermSection()].filter(Boolean).join('\n\n') || undefined
}

function describeUse(u: { name: string; input?: unknown }): string {
  const i = (u.input ?? {}) as Record<string, unknown>
  const c = Array.isArray(i.coordinate) ? ` (${Math.round(Number(i.coordinate[0]))},${Math.round(Number(i.coordinate[1]))})` : i.x != null && i.y != null ? ` (${Math.round(Number(i.x))},${Math.round(Number(i.y))})` : ''
  const detail = i.text != null ? ` «${String(i.text).slice(0, 40)}»` : i.key != null ? ` ${String(i.key)}` : i.app != null ? ` ${String(i.app)}` : i.window_title != null ? ` ${String(i.window_title)}` : ''
  return `${u.name}:${String(i.action ?? '')}${c}${detail}`
}

function lastAssistantText(s: Session): string {
  for (let k = s.messages.length - 1; k >= 0; k--) {
    const m = s.messages[k]
    if (m.role !== 'assistant') continue
    const t = m.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').replace(/\s+/g, ' ').trim()
    if (t) return t
  }
  return ''
}

const SYNTHETIC_TOOL = '__invalid_call'

function makeCtx(s: Session, signal: AbortSignal, vision: boolean, model: () => ModelInfo): ToolContext {
  return {
    sessionId: s.id,
    signal,
    vision,
    project: () => s.project,
    cwd: () => s.project?.dir ?? getSettings().workspaceRoot,
    model,
    settings: getSettings,
    plan: () => s.plan,
    bind(p: ProjectInfo) {
      s.project = p
      s.projectId = p.id
      s.title = p.name
      s.save()
      emit({ t: 'project_bound', sessionId: s.id, project: p })
    },
    setPlan(items: TodoItem[]) {
      s.plan = items
      s.save()
      emit({ t: 'plan', sessionId: s.id, items })
    },
    setPhase(phase: Phase, label?: string) {
      emit({ t: 'status', sessionId: s.id, phase, label })
    },
    ask(question, options) {
      return new Promise<string>((resolve) => {
        const askId = uid('ask_')
        const done = (v: string) => {
          s.asks.delete(askId)
          signal.removeEventListener('abort', onAbort)
          resolve(v)
        }
        const onAbort = () => done('')
        s.asks.set(askId, done)
        signal.addEventListener('abort', onAbort, { once: true })
        emit({ t: 'status', sessionId: s.id, phase: 'waiting', label: 'بانتظار إجابتك' })
        emit({ t: 'ask', sessionId: s.id, askId, question, options })
      })
    }
  }
}

function validate(tool: Tool, input: any): string | null {
  if (input && typeof input === 'object' && '__parse_error' in input) return `معطيات الأداة غير صالحة: ${input.__parse_error}`
  return toolValidationError(tool, input)
}

function clipInput(v: unknown, max = 1200, depth = 0): unknown {
  if (depth > 3) return '…'
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}… [${v.length} حرفاً]` : v
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clipInput(x, max, depth + 1))
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = clipInput(x, max, depth + 1)
    return o
  }
  return v
}

const BROWSER_TOOLS = new Set(['computer', 'desktop_app', 'progress', 'browser_screenshot', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_press', 'browser_scroll', 'browser_wait', 'browser_console', 'browser_resize', 'browser_eval', 'browser_audit', 'preview_open', 'preview_reload', 'visual_check', 'web_open', 'browser_nav', 'browser_upload'])
const SHELL_TOOLS = new Set(['run_command', 'read_process_output', 'send_process_input', 'stop_process', 'list_processes', 'spawn_agent'])

function waitedTimeoutMs(waitMs: number): number {
  return Math.min(Math.max(waitMs, 5_000), 300_000) + 45_000
}

function toolTimeoutMs(name: string, input: Record<string, unknown>): number {
  if (SHELL_TOOLS.has(name)) return 0
  if (name === 'computer' || name === 'desktop_app') return 180_000
  if (name === 'preview_open') return waitedTimeoutMs((Number(input.wait_sec) || 60) * 1000)
  if (name === 'browser_wait') return waitedTimeoutMs(Number(input.ms) || Number(input.timeout_ms) || 8_000)
  if (BROWSER_TOOLS.has(name)) return 60_000
  if (name === 'web_search' || name === 'web_fetch') return 45_000
  return 120_000
}

async function approvalGate(s: Session, name: string, input: unknown, ctx: ToolContext): Promise<string | null> {
  return await gateTool({
    permissionMode: getSettings().permissionMode,
    sessionId: s.id,
    toolName: name,
    args: input,
    cwd: ctx.cwd(),
    signal: ctx.signal,
    setPhase: (p) => ctx.setPhase(p, p === 'waiting' ? 'بانتظار موافقتك' : undefined)
  })
}

async function runOne(s: Session, use: Extract<Block, { type: 'tool_use' }>, ctx: ToolContext): Promise<ToolResult> {
  const tool = getTool(use.name)
  const allowed = toolsForMode(s.mode)
  const started = Date.now()
  emit({ t: 'tool_start', sessionId: s.id, callId: use.id, name: use.name, input: clipInput(use.input) })
  let res: ToolResult
  try {
    if (use.name === SYNTHETIC_TOOL) res = { content: `استدعاء أداة غير صالح: ${use.input?.__parse_error ?? ''}\nأعد الاستدعاء بصيغة JSON صحيحة.`, isError: true }
    else if (!tool || !allowed.includes(tool)) res = { content: `الأداة "${use.name}" غير متاحة. المتاح: ${allowed.map((t) => t.name).join(', ')}`, isError: true }
    else {
      const bad = validate(tool, use.input)
      if (bad) res = { content: bad, isError: true }
      else {
        const denied = await approvalGate(s, use.name, use.input ?? {}, ctx)
        if (denied) res = { content: denied, isError: true }
        else {
          if (tool.phase) ctx.setPhase(tool.phase, undefined)
          const callCtx: ToolContext = { ...ctx, callId: use.id }
          const timeout = toolTimeoutMs(use.name, (use.input ?? {}) as Record<string, unknown>)
          const run = (async (): Promise<ToolResult> => {
            if (timeout > 0) {
              let timerId: ReturnType<typeof setTimeout> | undefined
              return await Promise.race([
                tool.run(use.input ?? {}, callCtx).finally(() => { if (timerId) clearTimeout(timerId) }),
                new Promise<never>((_, reject) => {
                  timerId = setTimeout(() => reject(new Error(`انتهت مهلة الأداة (${timeout / 1000}ث). قلّل حجم الطلب أو قسّمه.`)), timeout)
                })
              ])
            }
            return await tool.run(use.input ?? {}, callCtx)
          })()
          res = await abortable(run, callCtx.signal)
        }
      }
    }
  } catch (e) {
    if (isAbort(e)) res = { content: 'أوقف المستخدم العملية.', isError: true }
    else {
      log.error(`فشل الأداة ${use.name}`, errMsg(e))
      res = { content: `خطأ داخلي في الأداة: ${errMsg(e)}`, isError: true }
    }
  }
  res = { ...res, content: redact(clip(res.content, LIMITS.toolOutputChars)) }
  const ms = Date.now() - started
  emit({
    t: 'tool_end',
    sessionId: s.id,
    callId: use.id,
    ok: !res.isError,
    output: clip(res.content, LIMITS.uiOutputChars, 0.5),
    ms,
    image: res.images?.[0] ? `data:${res.images[0].mediaType};base64,${res.images[0].data}` : undefined,
    diff: res.diff
  })
  if (s.project) logToolCallTrimmed(s.project.dir, { tool: use.name, input: JSON.stringify(use.input).slice(0, 400), ok: !res.isError, ms })
  return res
}

const PARALLEL_FILE_MUTATIONS = new Set(['write_file', 'edit_file', 'make_dir'])

async function execTools(s: Session, calls: Extract<Block, { type: 'tool_use' }>[], ctx: ToolContext): Promise<Map<string, ToolResult>> {
  const out = new Map<string, ToolResult>()
  const isReadPar = (c: (typeof calls)[number]) => !!getTool(c.name)?.parallel
  const isFileMut = (c: (typeof calls)[number]) => PARALLEL_FILE_MUTATIONS.has(c.name)

  let i = 0
  while (i < calls.length) {
    if (ctx.signal.aborted) break
    if (isReadPar(calls[i])) {
      let j = i
      while (j < calls.length && isReadPar(calls[j])) j++
      await Promise.all(calls.slice(i, j).map(async (c) => out.set(c.id, await runOne(s, c, ctx))))
      i = j
    } else if (isFileMut(calls[i])) {
      const seenTargets = new Set<string>()
      let j = i
      while (j < calls.length && isFileMut(calls[j])) {
        const target = normalizeTarget(calls[j].input)
        if (!target || seenTargets.has(target)) break
        seenTargets.add(target)
        j++
      }
      if (j > i + 1) {
        await Promise.all(calls.slice(i, j).map(async (c) => out.set(c.id, await runOne(s, c, ctx))))
        i = j
      } else {
        out.set(calls[i].id, await runOne(s, calls[i], ctx))
        i++
      }
    } else {
      out.set(calls[i].id, await runOne(s, calls[i], ctx))
      i++
    }
  }
  return out
}

interface Active {
  primary: ResolvedTarget
  fallback: ResolvedTarget | null
  current: ResolvedTarget
  sessionId: string
}

function sameTarget(a: ResolvedTarget, b: ResolvedTarget): boolean {
  return a.provider.id === b.provider.id && a.model.id === b.model.id
}

async function llmTurn(s: Session, a: Active, system: string, tools: Tool[], signal: AbortSignal) {
  emit({ t: 'text_reset', sessionId: s.id })
  emit({ t: 'thinking_reset', sessionId: s.id })
  const modelCap = a.current.model.maxOutput ?? 64_000
  const maxTokens = Math.max(1024, Math.min(getSettings().maxOutputTokens, modelCap, Math.floor(a.current.model.contextWindow * 0.5)))
  const attemptWith = (t: ResolvedTarget, maxAttempts?: number) => {
    return withRetry(
      async (attempt) => {
        const idleMs = idleMsForAttempt(attempt)
        if (attempt > 1) {
          emit({ t: 'text_reset', sessionId: s.id })
          emit({ t: 'thinking_reset', sessionId: s.id })
        }
        emit({ t: 'status', sessionId: s.id, phase: 'thinking' })
        const thinkId = uid('thk_')
        let thinkStarted = false
        const tSend = Date.now()
        let ttfbMs = 0
        let thinkChars = 0
        try {
          const r = capThinking(
            await callLlm(
              {
                system,
                messages: s.messages,
                tools: toSchemas(tools),
                target: t,
                signal,
                maxTokens,
                sessionId: a.sessionId,
                idleMs,
                connectMs: LIMITS.llmConnectMs
              },
              {
                onText: (d) => {
                  if (!ttfbMs) ttfbMs = Date.now() - tSend
                  emit({ t: 'text_delta', sessionId: s.id, text: d })
                },
                onThinking: (d) => {
                  if (!ttfbMs) ttfbMs = Date.now() - tSend
                  if (thinkChars >= LIMITS.thinkingChars || !d) return
                  if (!thinkStarted) {
                    thinkStarted = true
                    emit({ t: 'thinking_start', sessionId: s.id, id: thinkId })
                  }
                  thinkChars += d.length
                  emit({ t: 'thinking_delta', sessionId: s.id, id: thinkId, text: d })
                }
              }
            )
          )
          const totalMs = Date.now() - tSend
          log.info(`llm ok: ${t.model.id} (محاولة ${attempt}) blocks=${r.content.length} ttfb=${Math.round(ttfbMs / 1000)}s total=${Math.round(totalMs / 1000)}s`)
          return r
        } catch (e) {
          log.warn(`llm fail: ${t.model.id} (محاولة ${attempt}) ${errMsg(e)}`)
          throw e
        }
      },
      {
        signal,
        maxAttempts,
        onRetry: ({ attempt }) => {
          emit({ t: 'text_reset', sessionId: s.id })
          emit({ t: 'thinking_reset', sessionId: s.id })
          emit({ t: 'status', sessionId: s.id, phase: 'retrying', label: `إعادة الاتصال ${attempt}` })
        }
      }
    )
  }
  try {
    return await attemptWith(a.current, PRIMARY_ATTEMPTS)
  } catch (e) {
    if (isAbort(e) || !(e instanceof LlmError)) throw e
    const retryableFail = e.retryable || e.status === 404
    if (e.kind !== 'context' && retryableFail && a.fallback && !sameTarget(a.current, a.fallback)) {
      a.current = a.fallback
      a.sessionId = opencodeSessionKey(a.current.provider.id, s.projectId)
      emit({ t: 'notice', sessionId: s.id, level: 'warn', text: `فشل النموذج الأساسي بشكل متكرر؛ التحويل إلى النموذج الاحتياطي (${a.fallback.model.id}).` })
      emit({ t: 'text_reset', sessionId: s.id })
      emit({ t: 'thinking_reset', sessionId: s.id })
      system = await buildSystemPrompt({
        settings: getSettings(),
        project: s.project,
        plan: s.plan,
        model: a.current.model,
        lastUserText: [...s.messages].reverse().find((m) => m.role === 'user')?.content.find((b) => b.type === 'text')?.text?.slice(0, 2000),
        mode: s.mode,
        memory: memoryFor(s),
        display: desktopController.logicalSize()
      })
      return await attemptWith(a.current, FALLBACK_ATTEMPTS)
    }
    throw e
  }
}

function capThinking(r: LlmResult): LlmResult {
  const max = LIMITS.thinkingChars
  if (!r.content.some((b) => b.type === 'thinking' && b.text.length > max)) return r
  return {
    ...r,
    content: r.content.map((b) =>
      b.type === 'thinking' && b.text.length > max ? { ...b, text: `${b.text.slice(0, max)}\n[… اختُصر التفكير المحفوظ …]` } : b
    )
  }
}

async function summarizer(a: Active, signal: AbortSignal) {
  return async (prompt: string, text: string): Promise<string> => {
    const r = await withRetry(
      () => callLlm({ system: prompt, messages: [{ role: 'user', content: [{ type: 'text', text }] }], tools: [], target: a.current, signal, maxTokens: 3000, sessionId: a.sessionId, idleMs: IDLE_MS_PATIENT, connectMs: LIMITS.llmConnectMs }, { onText: () => {}, onThinking: () => {} }),
      { signal, onRetry: () => {}, maxAttempts: SUMMARIZER_ATTEMPTS }
    )
    return r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim() || '(ملخص فارغ)'
  }
}

export { LoopGuard, callSignature } from './loopGuard'

function persistPush(s: Session, msgs: Msg[]) {
  s.messages.push(...msgs)
  db().msgAppend(s.id, msgs.map(persistable))
  s.save()
}

function drainPending(s: Session) {
  if (!s.pending.length) return
  const items = s.pending.splice(0)
  const blocks: Block[] = []
  for (const item of items) {
    const t = typeof item === 'string' ? item : item.text
    if (t?.trim()) blocks.push({ type: 'text', text: `[توجيه من المستخدم أثناء العمل]\n${t.trim()}` })
    const imgs = typeof item === 'string' ? undefined : item.images
    if (imgs?.length) {
      for (const im of imgs) blocks.push({ type: 'image', mediaType: im.mediaType, data: im.data })
    }
  }
  if (!blocks.length) return
  persistPush(s, [{ role: 'user', content: blocks }])
}

function truncationAdvice(times: number): string {
  const base =
    'قُطع ردك عند حد الإخراج قبل اكتماله. استدعاء أداة كبير واحد لن ينجح مهما أعدته — قسّم العمل: ' +
    'اكتب الملف الأساسي بحجم صغير، ثم أضف الباقي على دفعات عبر write_file مع append=true، ' +
    'أو وزّع المحتوى على أكثر من ملف/وحدة واستوردها. لا تعِد إرسال نفس المحتوى الضخم كما هو.'
  return times >= 3
    ? `${base} (حدث هذا ${times} مرات متتالية — قلّل حجم كل استدعاء إلى النصف على الأقل فوراً.)`
    : base
}

export interface RunOptions {
  userText?: string
  model?: ModelRef
  images?: ImageAttachment[]
}

export async function runAgent(s: Session, opts: RunOptions): Promise<void> {
  if (s.running) {
    if (opts.userText || opts.images?.length) s.pending.push({ text: opts.userText ?? '', images: opts.images })
    return
  }
  const settings = getSettings()
  const primary = pickModelRef([opts.model, s.model, settings.defaultModel], resolveModel)
  if (!primary) {
    emit({ t: 'notice', sessionId: s.id, level: 'error', text: 'لم يُحدَّد نموذج. أضف مزوداً واختر نموذجاً من الإعدادات.' })
    emit({ t: 'run_end', sessionId: s.id, reason: 'error' })
    return
  }
  if (!primary.provider.apiKey && !/localhost|127\.0\.0\.1/.test(primary.provider.baseUrl)) {
    emit({ t: 'notice', sessionId: s.id, level: 'error', text: `مفتاح API غير محفوظ للمزود «${primary.provider.name}».` })
    emit({ t: 'run_end', sessionId: s.id, reason: 'error' })
    return
  }
  s.model = { providerId: primary.provider.id, modelId: primary.model.id }
  const sessionKey = opencodeSessionKey(primary.provider.id, s.projectId)
  const active: Active = { primary, fallback: resolveModel(settings.fallbackModel), current: primary, sessionId: sessionKey }
  log.info(`run start: ${active.current.provider.name}/${active.current.model.id} رسائل=${s.messages.length} مشروع=${s.projectId ?? 'لا'} session=${sessionKey}`)
  const images = (opts.images ?? []).filter((im) => im.mediaType.startsWith('image/') && im.data)
  if (images.length && !active.current.model.vision) {
    const visionFallback = active.fallback?.model.vision ? active.fallback : null
    const visionPrimary = listVisionModel()
    const visionTarget = visionFallback ?? visionPrimary
    if (visionTarget && !sameTarget(active.current, visionTarget)) {
      active.current = visionTarget
      active.sessionId = opencodeSessionKey(visionTarget.provider.id, s.projectId)
      emit({ t: 'notice', sessionId: s.id, level: 'info', text: `النموذج الأساسي لا يرى الصور — تم التحويل تلقائياً إلى ${visionTarget.model.id} لقراءتها.` })
      s.model = { providerId: visionTarget.provider.id, modelId: visionTarget.model.id }
    } else {
      emit({ t: 'notice', sessionId: s.id, level: 'warn', text: 'النموذج المختار لا يرى الصور — أُرفقت لكنه قد يتجاهلها. اختر نموذجاً يدعم الرؤية لقراءتها.' })
    }
  }

  s.running = true
  s.resumable = true
  s.abort = new AbortController()
  const signal = s.abort.signal

  if (s.mode === 'agent') {
    desktopController.startSession(s.id)
  }

  if (s.mode === 'agent' && opts.userText?.trim()) {
    if (!s.memory) s.memory = createAgentMemory(opts.userText)
    else setAgentGoal(s.memory, opts.userText)
    s.save()
  }

  repairDangling(s)

  if (opts.userText || images.length) {
    if (opts.userText && (s.title === 'محادثة جديدة' || s.title === 'وكيل المتصفح' || s.title === 'إيجنت الكمبيوتر'))
      s.title = opts.userText.replace(/\s+/g, ' ').slice(0, 60)
    const blocks: Block[] = []
    if (opts.userText) blocks.push({ type: 'text', text: opts.userText })
    for (const im of images) blocks.push({ type: 'image', mediaType: im.mediaType, data: im.data })
    if (s.mode === 'agent' && active.current.model.vision && !images.length) {
      try {
        const initShot = await desktopController.screenshot(true)
        blocks.push({
          type: 'text',
          text: `[لقطة شاشة حية لسطح المكتب الآن (${initShot.width}×${initShot.height}) | المؤشر عند (${initShot.cursorX}, ${initShot.cursorY}) | النافذة النشطة: «${initShot.activeTitle || 'سطح المكتب'}»]`
        })
        blocks.push({ type: 'image', mediaType: initShot.mediaType, data: initShot.data })
      } catch {}
    }
    persistPush(s, [{ role: 'user', content: blocks, at: Date.now() }])
  } else if (s.mode === 'agent') {
    const digest = s.memory ? actionsDigest(s.memory) : ''
    const blocks: Block[] = [{ type: 'text', text: `[استئناف العمل]\n${digest ? `${digest}\n` : ''}افحص الشاشة الآن ثم تابع من حيث توقفت دون إعادة ما أُنجز.` }]
    if (active.current.model.vision) {
      try {
        const shot = await desktopController.screenshot(true)
        blocks.push({ type: 'image', mediaType: shot.mediaType, data: shot.data })
      } catch {}
    }
    persistPush(s, [{ role: 'user', content: blocks, at: Date.now() }])
  } else s.save()

  if (opts.userText || images.length || s.runStartedAt == null) s.startRunBudget()

  const guard = new LoopGuard()
  let reason: 'done' | 'stopped' | 'error' | 'max_steps' = 'done'
  let emptyRetries = 0
  let truncations = 0

  try {
    for (let step = 1; ; step++) {
      if (signal.aborted) throw abortError()
      if (s.mode === 'agent') {
        await desktopController.waitWhilePaused(signal)
        if (signal.aborted) throw abortError()
        if (desktopController.consumeTakeoverReturned()) {
          const takeoverBlocks: Block[] = [
            {
              type: 'text',
              text: 'The human has taken over and made changes. Re-assess the current screen state and continue the task.\n[استلم المستخدم التحكم بالماوس والكيبورد مؤقتاً وأجرى تعديلات على الشاشة. افحص اللقطة الجديدة المرفقة بعناية وأكمل المهمة.]'
            }
          ]
          if (active.current.model.vision) {
            try {
              const fresh = await desktopController.screenshot(true)
              takeoverBlocks.push({ type: 'image', mediaType: fresh.mediaType, data: fresh.data })
            } catch {}
          }
          persistPush(s, [{ role: 'user', content: takeoverBlocks }])
        }
        desktopController.incrementStep()
        desktopController.setStatus('thinking')
      }
      s.cumulativeSteps++
      if (s.mode !== 'agent' && step > settings.maxSteps) {
        reason = 'max_steps'
        emit({ t: 'notice', sessionId: s.id, level: 'warn', text: `بلغ الوكيل حد الخطوات (${settings.maxSteps}). يمكنك الضغط على «استئناف» للمتابعة.` })
        break
      }
      drainPending(s)

      const tools = toolsForMode(s.mode)
      const toolsChars = JSON.stringify(toSchemas(tools)).length
      const lastUserText = [...s.messages].reverse().find((m) => m.role === 'user')?.content.find((b) => b.type === 'text')?.text?.slice(0, 2000)
      let system = await buildSystemPrompt({ settings, project: s.project, plan: s.plan, model: active.current.model, lastUserText, mode: s.mode, memory: memoryFor(s), display: desktopController.logicalSize() })
      let trimmed = dropStaleImages(s.messages)
      trimmed = shrinkOld(s.messages) || trimmed
      let tokens = estimateTokens(system, s.messages, toolsChars)
      const win = active.current.model.contextWindow
      emit({ t: 'usage', sessionId: s.id, contextTokens: tokens, contextWindow: win, step })
      const compactAt = win * (compactAtThreshold(win, settings.compactAtPercent) / 100)
      if (tokens > compactAt) {
        const compacted = await compactNow(s, active, signal)
        if (!compacted) {
          trimmed = shrinkOld(s.messages, 4, true) || trimmed
          emit({ t: 'notice', sessionId: s.id, level: 'warn', text: 'تعذّر تلخيص السياق؛ قُلّصت الرسائل القديمة بقوة بدلاً من ذلك.' })
        }
        system = await buildSystemPrompt({ settings, project: s.project, plan: s.plan, model: active.current.model, lastUserText, mode: s.mode, memory: memoryFor(s), display: desktopController.logicalSize() })
        tokens = estimateTokens(system, s.messages, toolsChars)
      }

      let result
      try {
        result = await llmTurn(s, active, system, tools, signal)
      } catch (e) {
        if (e instanceof LlmError && e.kind === 'context') {
          emit({ t: 'notice', sessionId: s.id, level: 'warn', text: 'تجاوز السياق حد النموذج؛ جارٍ التلخيص ثم المحاولة مجدداً.' })
          trimmed = shrinkOld(s.messages, 4, true) || trimmed
          const compacted = await compactNow(s, active, signal, 6)
          if (!compacted) {
            shrinkOld(s.messages, 4, true)
            emit({ t: 'notice', sessionId: s.id, level: 'warn', text: 'فشل تلخيص السياق؛ قُلّص السجل بقوة قبل إعادة المحاولة.' })
          }
          system = await buildSystemPrompt({ settings, project: s.project, plan: s.plan, model: active.current.model, lastUserText, mode: s.mode, memory: memoryFor(s), display: desktopController.logicalSize() })
          result = await llmTurn(s, active, system, tools, signal)
        } else throw e
      }

      const ctx = makeCtx(s, signal, active.current.model.vision, () => active.current.model)
      const uses = result.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
      result.content = promoteReasoningAnswer(result.content)
      const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
      if (s.mode === 'agent' && text) {
        desktopController.setThought(text)
      }
      emit({ t: 'assistant_done', sessionId: s.id })
      tokens = result.usage.input || tokens

      const broken = uses.filter((u) => (u.input as { __parse_error?: string } | undefined)?.__parse_error)
      if (result.truncated) {
        truncations++
        emit({
          t: 'notice',
          sessionId: s.id,
          level: 'warn',
          text:
            `قُطع رد النموذج عند حد الإخراج (${getSettings().maxOutputTokens} رمز)` +
            (broken.length ? ` قبل اكتمال استدعاء «${broken[0].name}» — فلم يُنفَّذ.` : '.')
        })
      }

      if (!uses.length && !text) {
        if (result.truncated) {
          persistPush(s, [{ role: 'user', content: [{ type: 'text', text: truncationAdvice(truncations) }] }])
          continue
        }
        if (++emptyRetries > 2) throw new LlmError('أعاد النموذج ردوداً فارغة متكررة. جرّب نموذجاً آخر.')
        persistPush(s, [{ role: 'user', content: [{ type: 'text', text: 'ردّك السابق كان فارغاً. تابع العمل: استخدم أداة أو قدّم الملخص النهائي.' }] }])
        continue
      }
      emptyRetries = 0

      if (!uses.length) {
        persistPush(s, [{ role: 'assistant', content: result.content }])
        if (result.truncated) {
          persistPush(s, [{ role: 'user', content: [{ type: 'text', text: truncationAdvice(truncations) }] }])
          continue
        }
        if (s.pending.length) continue
        reason = 'done'
        break
      }

      const assistantMsg: Msg = { role: 'assistant', content: result.content }
      s.messages.push(assistantMsg)
      let results: Map<string, ToolResult>
      try {
        results = await execTools(s, uses, ctx)
      } catch (e) {
        s.messages.pop()
        throw e
      }
      const blocks: Block[] = uses.map((u) => {
        if (broken.some((b) => b.id === u.id))
          return {
            type: 'tool_result',
            tool_use_id: u.id,
            content: `قُطع هذا الاستدعاء عند حد الإخراج قبل اكتمال JSON، فلم يُنفَّذ. ${truncationAdvice(truncations)}`,
            is_error: true
          }
        const r = results.get(u.id) ?? { content: 'لم تُنفَّذ (أُوقفت العملية).', isError: true }
        const images = ctx.vision ? r.images : undefined
        return { type: 'tool_result', tool_use_id: u.id, content: r.content, is_error: !!r.isError, images }
      })
      const verdict = guard.check(uses, results)
      if (verdict.warning) {
        blocks.push({ type: 'text', text: verdict.warning })
      }

      if (s.mode === 'agent' && s.memory) {
        const mem = s.memory
        for (const u of uses) {
          const r = results.get(u.id)
          if (r && (u.name === 'computer' || u.name === 'desktop_app')) {
            recordAction(mem, step, describeUse(u), String(r.content ?? '').split('\n')[0], !r.isError)
          }
          if (!r || r.isError) continue
          if (u.name === 'write_file' || u.name === 'edit_file') {
            recordAgentFile(mem, String((u.input as { path?: unknown } | undefined)?.path ?? ''), u.name === 'edit_file' ? 'edit' : 'write', step)
          }
        }
      }

      const resultMsg: Msg = { role: 'user', content: blocks }
      s.messages.pop()
      persistPush(s, [assistantMsg, resultMsg])
      const dropped = dropStaleImages(s.messages)
      const shrunk = shrinkOld(s.messages)
      if (dropped || shrunk || trimmed) db().msgReplace(s.id, s.messages.map(persistable))
      if (s.project) touchProject(s.project.id)
      if (signal.aborted) throw abortError()
    }
  } catch (e) {
    if (isAbort(e)) reason = 'stopped'
    else {
      reason = 'error'
      const msg = e instanceof LlmError ? e.message : errMsg(e)
      log.error('انتهت جولة الوكيل بخطأ', msg)
      emit({ t: 'notice', sessionId: s.id, level: 'error', text: `توقف الوكيل: ${msg}. حالتك محفوظة ويمكنك الضغط على «استئناف».` })
    }
  } finally {
    s.running = false
    s.abort = null
    s.resumable = reason === 'error' || reason === 'max_steps'
    for (const [, resolve] of s.asks) resolve('')
    s.save()
    if (s.mode === 'agent') {
      desktopController.endSession(reason)
      if (reason === 'done' && s.memory?.goal) {
        try {
          recordTaskOutcome(s.memory.goal, lastAssistantText(s), s.memory.files.map((f) => f.path))
        } catch {}
      }
    }
    if (reason === 'done' && s.project) void checkpoint(s.project.dir, 'نهاية المهمة').catch(() => {})
    emit({ t: 'status', sessionId: s.id, phase: 'idle' })
    emit({ t: 'run_end', sessionId: s.id, reason })
  }
}

export async function compactNow(s: Session, a: Active, signal: AbortSignal, keep = 10): Promise<boolean> {
  emit({ t: 'status', sessionId: s.id, phase: 'compacting', label: 'تلخيص السياق' })
  try {
    const summarize = await summarizer(a, signal)
    let summary = ''
    const compacted = await buildCompacted(s.messages, async (prompt, text) => (summary = await summarize(prompt, text)), keep)
    if (!compacted) return false
    if (!summary.trim() || summary.trim() === '(ملخص فارغ)') {
      log.warn('فشل التلخيص: ملخص فارغ — أُبقي السجل كما هو')
      return false
    }
    if (s.mode === 'agent' && s.memory) {
      const digest = actionsDigest(s.memory)
      const first = compacted[0]?.content[0]
      if (digest && first && first.type === 'text') first.text += `\n\n${digest}`
    }
    s.messages = compacted
    db().msgReplace(s.id, compacted.map(persistable))
    emit({ t: 'notice', sessionId: s.id, level: 'info', text: 'جرى تلخيص الجزء القديم من المحادثة للحفاظ على السياق.' })
    return true
  } catch (e) {
    if (isAbort(e)) throw e
    log.warn('فشل التلخيص', errMsg(e))
    return false
  }
}

export function repairDangling(s: Session) {
  const stubs: Block[] = []
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i]
    if (m.role !== 'assistant') continue
    const uses = m.content.filter((b) => b.type === 'tool_use') as Extract<Block, { type: 'tool_use' }>[]
    if (!uses.length) continue
    const satisfied = (id: string) =>
      s.messages.slice(i + 1).some((later) => later.content.some((b) => b.type === 'tool_result' && b.tool_use_id === id))
    const dangling = uses.filter((u) => !satisfied(u.id))
    for (const u of dangling)
      stubs.push({
        type: 'tool_result',
        tool_use_id: u.id,
        content: 'انقطع التنفيذ قبل اكتمال هذه الأداة (إغلاق أو إيقاف). افحص الحالة الفعلية قبل المتابعة.',
        is_error: true
      })
  }
  if (stubs.length) persistPush(s, [{ role: 'user', content: stubs }])
}

export function answerAsk(s: Session, askId: string, value: string) {
  s.asks.get(askId)?.(value)
}
