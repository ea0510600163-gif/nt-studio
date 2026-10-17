import { create } from 'zustand'
import type {
  AgentEvent, ChatItem, ImageAttachment, LoadedSession, ModelRef, Phase, PreviewState, ProjectInfo, ProviderPublic, SessionInfo, SessionMode, Settings, TodoItem
} from '@shared/types'
import { validateImages } from '@shared/images'

export type Tab = 'preview' | 'code' | 'terminal' | 'log'
export type Overlay = null | 'projects' | 'settings' | 'provider' | 'sessions'

export interface LogEntry {
  id: number
  ts: number
  kind: 'tool' | 'notice'
  text: string
  arg?: string
  ok?: boolean
  ms?: number
  level?: 'info' | 'warn' | 'error'
}

type ProjectRow = ProjectInfo & { sessionId: string | null }

interface State {
  ready: boolean
  providers: ProviderPublic[]
  settings: Settings | null
  projects: ProjectRow[]
  sessionId: string | null
  project: ProjectInfo | null
  items: ChatItem[]
  plan: TodoItem[]
  phase: Phase
  phaseLabel: string
  running: boolean
  needsResume: boolean
  usage: { tokens: number; window: number; step: number } | null
  preview: PreviewState
  tab: Tab
  overlay: Overlay
  log: LogEntry[]
  toast: { text: string; level: 'info' | 'warn' | 'error' } | null
  /** يزيد مع كل تغيير على القرص؛ تعتمد عليه شجرة الكود بدل مستمع fs:changed منفصل */
  treeRev: number
  /** الملف المختار للعرض في تبويب الكود */
  selectedFile: string | null
  /** عرض عمود الشات بالبكسل — بلا تخزين؛ App يحفظ nt.chatW في localStorage ويغذّي هذه القيمة */
  chatW: number
  /** كل الجلسات المحفوظة للقائمة الجديدة — تُحدَّث بـ refreshSessions() */
  sessions: SessionInfo[]
  /** وضع الواجهة: studio (برمجة ومشاريع) أو agent (مشغّل المتصفح) */
  mode: SessionMode
  /** آخر جلسة لكل وضع — التبديل بينهما فوري بلا فقدان سياق */
  studioSessionId: string | null
  agentSessionId: string | null
  /** تبديل الوضع مع حفظ جلسة الوضع الحالي وفتح جلسة الوضع الآخر (تُنشأ كسولاً) */
  setMode(m: SessionMode): Promise<void>

  /**
   * يربط قنواتIPC once ويعيد دالة فصل. الفصل ضروري: React StrictMode يستدعي
   * التأثير مرتين، وكل استدعاء بلا فصل يترك مشتركاً ثانياً فيظهر كل حدث مرتين.
   */
  bind(): () => void
  /** تهيئة البيانات (مرّة واحدة مهما تكرر النداء) */
  bootstrap(): Promise<void>
  refreshProviders(): Promise<void>
  refreshProjects(): Promise<void>
  /** يحدّث قائمة الجلسات من window.nt.sessions.list() */
  refreshSessions(): Promise<void>
  setSettings(p: Partial<Settings>): Promise<void>
  applyLoaded(l: LoadedSession): void
  newSession(): Promise<void>
  /** جلسة جديدة مربوطة بمشروع محدّد (من درج المشاريع أو الشريط) */
  openNewChatFor(projectId: string): Promise<void>
  openProject(id: string): Promise<void>
  /** تحميل جلسة محفوظة بالمعرّف ثم تطبيقها (الواجهة تغلق الدرج بنفسها) */
  loadSession(id: string): Promise<void>
  send(text: string, images?: { mediaType: string; data: string }[]): Promise<void>
  stop(): Promise<void>
  resume(): Promise<void>
  answer(askId: string, value: string): Promise<void>
  setTab(t: Tab): void
  /** يبدّل التبويب؛ ولـ«preview» يضمن أيضاً أن لوحة المعاينة مفتوحة (غلاف رقيق حول setTab) */
  focusTab(tab: Tab): void
  /** يفتح ملفاً محدداً مباشرة في تبويب الكود */
  openFileInStage(path: string): void
  /** يضبط عرض عمود الشات في الحالة (بلا تخزين — App يحفظ nt.chatW) */
  setChatWidth(w: number): void
  setOverlay(o: Overlay): void
  notify(text: string, level?: 'info' | 'warn' | 'error'): void
  bumpTreeRev(): void
  handle(e: AgentEvent): void
  currentModel(): ModelRef | null
  newChatForProject: () => Promise<void>
  closePreview: () => Promise<void>
}

let logId = 0
const entry = (e: Omit<LogEntry, 'id' | 'ts'>): LogEntry => ({ id: ++logId, ts: Date.now(), ...e })
const uid = () => Math.random().toString(36).slice(2, 9)
let bootPromise: Promise<void> | null = null
/** مؤقّت مسح التنبيه الحالي — يُلغى عند كل تنبيه جديد حتى لا يمسح تنبيهاً أحدث */
let toastTimer: ReturnType<typeof setTimeout> | null = null
/**
 * آخر رقم تسلسلي (__seq) مُطبَّق لكل جلسة — المفتاح هو sessionId.
 *
 * لماذا لكل جلسة وليس رقماً عاماً واحداً؟ __seq تصاعدي على مستوى التطبيق كله
 * (bus يزيده في كل حدث غير-دلتا). رقمٌ عامٌ واحد قد يعلو بحدثٍ من جلسة B،
 * فيسقط بهدوء حدثاً لاحقاً شرعياً من الجلسة A برقم أقلّ: ذلك ممكن بعد إعادة
 * إقلاع تُعيد فتح جلسات قديمة، أو بعد إعادة تحميل مدفوعة بـ fs:changed —
 * فتتجمّد الواجهة على حالة قديمة بلا أيّ خطأ ظاهر. حارسٌ مستقلّ لكل جلسة
 * يحلّها: يرفض تكرار/تأخّر حدث الجلسة نفسها فقط، ولا يعرف شيئاً عن غيرها.
 */
const lastSeqBySession = new Map<string, number>()
/**
 * قاعدة التسلسل — دالة نقية قابلة للاختبار: لا يُطبَّق حدثٌ يحمل رقم __seq إلا
 * إذا كان أكبر من آخر رقم طُبِّق لجلسته (أو حدثٌ بلا رقم ⇒ يُطبَّق دائماً).
 * lastSeqForSession = -Infinity (أو غير موجود) يعني «اقبل كل شيء» — تُبذر به
 * الجلسة عند applyLoaded مباشرةً.
 */
export function shouldApply(e: Pick<AgentEvent, '__seq'>, lastSeqForSession: number | undefined): boolean {
  if (typeof e.__seq !== 'number') return true // حدث بلا رقم تسلسلي: نطبّقه دائماً
  return e.__seq > (lastSeqForSession ?? -Infinity)
}
/**
 * المهمة الحالية: مفتاحها ونصّها. تُشتق من حدث الخطة (البند «doing»)،
 * وكل عنصر جديد يُوسَم بها — فتصير المجموعات في الشات = مهام لا خطوات.
 */
let curTask: string | undefined
let curTaskText = ''

/**
 * إنهاء كل بطاقة تفكير منسيابة: الفارغة تُحذف (فوضى صفرية) وما بقي يتوقف عن
 * الانسياب ويبقى مطويّاً. مسحٌ لكل المصفوفة لا للأخير فقط: محاولة فاشلت أو
 * نموذج احتياطي قد يترك بطاقة حيّة في الوسط بعد دفع إشعار — و«الأخير» وحدها
 * كانت تبقى منسيابة إلى الأبد (هالة تنبض وعدّاد يركض في منتصف سجل انتهى).
 */
function finalizeThinking(items: ChatItem[]): ChatItem[] {
  let hit = false
  const out: ChatItem[] = []
  for (const it of items) {
    if (it.kind === 'thinking' && it.streaming) {
      hit = true
      if (it.text.trim()) out.push({ ...it, streaming: false })
      continue
    }
    out.push(it)
  }
  return hit ? out : items // مرجعٌ مماثل ⇒ لا إعادة رسم بلا داعٍ
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  providers: [],
  settings: null,
  projects: [],
  sessionId: null,
  project: null,
  items: [],
  plan: [],
  phase: 'idle',
  phaseLabel: '',
  running: false,
  needsResume: false,
  usage: null,
  preview: { url: '', title: '', loading: false, device: 'desktop', open: false, errors: 0, boundsEpoch: 0 },
  tab: 'preview',
  overlay: null,
  log: [],
  toast: null,
  treeRev: 0,
  selectedFile: null,
  chatW: 500,
  sessions: [],
  mode: 'studio',
  studioSessionId: null,
  agentSessionId: null,

  bind() {
    const nt = window.nt
    const offs = [
      nt.on<AgentEvent>('agent:event', (e) => get().handle(e)),
      nt.on<PreviewState>('preview:state', (p) => set({ preview: p })),
      nt.on<string>('ui:focus', (t) => { if (t === 'preview') set({ tab: 'preview' }) }),
      nt.on('providers:changed', () => void get().refreshProviders()),
      nt.on('fs:changed', () => get().bumpTreeRev())
    ]
    // لا توجد قناة sessions:changed؛ التركيب/إعادة التركيب هو نقطة التحديث
    // للتزامن مع أي إنشاء/حذف خارجي للجلسات.
    void get().refreshSessions().catch(() => get().notify('تعذّر تحميل سجل المحادثات', 'error'))
    let off = false
    return () => {
      if (off) return
      off = true
      for (const f of offs) f()
    }
  },

  async bootstrap() {
    if (bootPromise) return bootPromise
    bootPromise = (async () => {
      const nt = window.nt
      const [providers, settings] = await Promise.all([nt.providers.list(), nt.settings.get()])
      set({ providers, settings })
      set({ preview: await nt.preview.state() })
      await get().refreshProjects()
      await get().refreshSessions()
      // استئناف آخر جلسة لها محتوى بدل إنشاء جلسة يتيمة عند كل إقلاع
      const l = await nt.sessions.openLatest()
      get().applyLoaded(l)
      set({ ready: true })
    })()
    try { await bootPromise }
    catch (e) { bootPromise = null; throw e }
  },

  async refreshProviders() {
    set({ providers: await window.nt.providers.list(), settings: await window.nt.settings.get() })
  },
  async refreshProjects() {
    set({ projects: await window.nt.projects.list() })
  },
  async refreshSessions() {
    set({ sessions: await window.nt.sessions.list() })
  },
  async setSettings(p) {
    set({ settings: await window.nt.settings.set(p) })
  },

  applyLoaded(l) {
    curTask = undefined // عناصر إعادة التحميل تحمل مهامها من session.toChatItems
    curTaskText = ''
    // ابدأ حراسة التسلسل من جديد لهذه الجلسة: -Infinity يقبل كل أحداثها، فلا
    // يُسقط أوّل حدث (تبديل جلسة/إعادة تحميل بعد رقم __seq أعلى من جلسة أخرى)
    lastSeqBySession.set(l.session.id, -Infinity)
    // سجّل الجلسة في خانة وضعها (studio/agent) — التبديل بين الوضعين يسترجعها فوراً
    const slot = l.session.mode === 'agent' ? { agentSessionId: l.session.id } : { studioSessionId: l.session.id }
    set({
      sessionId: l.session.id,
      project: l.project,
      items: l.items,
      plan: l.plan,
      running: l.session.running,
      needsResume: l.needsResume,
      phase: 'idle',
      phaseLabel: '',
      usage: null,
      selectedFile: null,
      log: [],
      ...slot
    })
  },

  async setMode(m) {
    if (get().mode === m) return
    // التبديل أثناء عمل جارٍ يتركه يتيماً يستهلك الميزانية — أوقفه أولاً
    if (get().running) {
      get().notify('أوقف العمل الجاري أولاً ثم بدّل الوضع', 'warn')
      return
    }
    const from = get().mode
    const curId = get().sessionId
    // احفظ جلسة الوضع المغادَر في خانتها قبل المغادرة
    set({ mode: m, ...(from === 'agent' ? { agentSessionId: curId } : { studioSessionId: curId }) })
    const slotId = m === 'agent' ? get().agentSessionId : get().studioSessionId
    let l: LoadedSession | null = null
    if (slotId) {
      try {
        l = await window.nt.sessions.load(slotId)
      } catch {
        l = null // حُذفت من مصدر آخر — تُفتح من جديد أدناه
      }
    }
    get().applyLoaded(l ?? (await window.nt.sessions.openLatest(m)))
  },

  async newSession() {
    const l = await window.nt.sessions.create(get().mode)
    get().applyLoaded(l)
    set({ overlay: null })
  },
  async openProject(id) {
    const l = await window.nt.projects.open(id)
    get().applyLoaded(l)
    set({ overlay: null })
  },
  async loadSession(id) {
    const l = await window.nt.sessions.load(id)
    get().applyLoaded(l)
    // مزامنة الوضع مع الجلسة المحمّلة (درج الجلسات يعرض كل الأوضاع)
    if ((l.session.mode ?? 'studio') !== get().mode) set({ mode: l.session.mode ?? 'studio' })
  },

  currentModel() {
    return get().settings?.defaultModel ?? null
  },

  async openNewChatFor(projectId) {
    const l = await window.nt.sessions.createForProject(projectId)
    get().applyLoaded(l)
    set({ overlay: null })
  },
  async newChatForProject() {
    const { project } = get()
    if (!project) {
      get().notify('افتح مشروعاً أولاً', 'warn')
      return
    }
    // جلسة جديدة مربوطة بنفس المشروع: ذاكرة المشروع كاملة بسياق محادثة نظيف
    await get().openNewChatFor(project.id)
    get().notify('شات جديد على نفس المشروع', 'info')
  },

  async closePreview() {
    await window.nt.preview.close()
    set({ preview: { ...get().preview, open: false } })
  },

  async send(text, images) {
    const { sessionId, running } = get()
    if (!sessionId) return
    const safe = validateImages(images ?? [])
    if (safe.error) {
      get().notify(safe.error, 'warn')
      return
    }
    if (!text.trim() && !safe.ok.length) return
    set((s) => ({
      items: [...s.items, { kind: 'user', id: uid(), text: text.trim(), images: safe.ok.map((im) => `data:${im.mediaType};base64,${im.data}`) }],
      running: true,
      needsResume: false
    }))
    try {
      await window.nt.agent.send(sessionId, text.trim(), get().currentModel() ?? undefined, safe.ok.length ? safe.ok : undefined)
    } catch (e) {
      // رفض الطلب (استثناء في الخلفية) لا يترك الواجهة «تعمل» بلا دورة
      set({ running: false, phase: 'idle', phaseLabel: '' })
      get().notify(`تعذّر بدء العمل: ${(e as Error).message}`, 'error')
      return
    }
    if (!running) set({ phase: 'thinking' })
  },
  async stop() {
    const id = get().sessionId
    if (!id) return
    try { await window.nt.agent.stop(id) }
    catch (e) { get().notify(`تعذّر إيقاف العمل: ${e instanceof Error ? e.message : String(e)}`, 'error') }
  },
  async resume() {
    const id = get().sessionId
    if (!id) return
    if (get().running) return
    set({ running: true, needsResume: false, phase: 'thinking' })
    try { await window.nt.agent.resume(id, get().currentModel() ?? undefined) }
    catch (e) {
      set({ running: false, needsResume: true, phase: 'idle' })
      get().notify(`تعذّر استئناف العمل: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  },
  async answer(askId, value) {
    const item = get().items.find((i) => i.kind === 'ask' && i.id === askId)
    if (!item || item.kind !== 'ask' || item.answered !== undefined) return
    set((s) => ({ items: s.items.map((i) => (i.kind === 'ask' && i.id === askId ? { ...i, answered: value } : i)) }))
    try { await window.nt.agent.answer(askId, value) }
    catch (e) {
      set((s) => ({ items: s.items.map((i) => i.kind === 'ask' && i.id === askId ? { ...i, answered: undefined } : i) }))
      get().notify(`تعذّر إرسال الإجابة: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  },

  setTab: (tab) => set({ tab }),
  focusTab(tab) {
    // غلاف رقيق حول setTab: للتبويب «preview» يضمن أيضاً أن لوحة المعاينة مفتوحة
    get().setTab(tab)
    if (tab === 'preview') set((s) => ({ preview: { ...s.preview, open: true } }))
  },
  openFileInStage(path) {
    set({ selectedFile: path, tab: 'code' })
  },
  setChatWidth: (w) => set({ chatW: w }),
  setOverlay: (overlay) => set({ overlay }),
  bumpTreeRev: () => set((s) => ({ treeRev: s.treeRev + 1 })),
  notify(text, level = 'info') {
    // أوقف مؤقّت التنبيه السابق دائماً: تكرارٌ مطابقٌ خلال 1200ms مثلاً يعني
    // استبدالاً + إعادة تشغيل (لا تكديس مؤقّتات)، وتنبيهٌ سريعٌ تالٍ لا يجوز
    // أن يمسحه مؤقّت التنبيه الأوّل. مدّة الحياة تبقى 4500ms من كل ظهور.
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
    set({ toast: { text, level } })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set((s) => (s.toast?.text === text ? { toast: null } : {}))
    }, 4500)
  },

  handle(e) {
    if (e.sessionId !== get().sessionId) return
    // حماية تسلسلية لكل جلسة: ارفض حدثاً برقم __seq لا يتجاوز آخر رقم طُبِّق
    // لهذه الجلسة تحديداً — لا رقم عامّ واحد يربط الجلسات (انظر lastSeqBySession)
    const last = lastSeqBySession.get(e.sessionId)
    if (!shouldApply(e, last)) return
    if (typeof e.__seq === 'number') lastSeqBySession.set(e.sessionId, e.__seq)
    switch (e.t) {
      case 'status':
        set({ phase: e.phase, phaseLabel: e.label ?? '' })
        break
      case 'text_delta':
        set((s) => {
          const last = s.items[s.items.length - 1]
          if (last?.kind === 'assistant' && last.streaming) return { items: [...s.items.slice(0, -1), { ...last, text: last.text + e.text }] }
          const items = finalizeThinking(s.items)
          return { items: [...items, { kind: 'assistant', id: uid(), text: e.text, streaming: true, task: curTask, taskText: curTaskText }] }
        })
        break
      case 'thinking_start':
        // تفريغ أي بطاقة سابقة أولاً (مسار احتياط/فشل لم يُفرّغها) ثم إضافة الجديدة
        set((s) => ({ items: [...finalizeThinking(s.items), { kind: 'thinking', id: e.id, text: '', streaming: true, task: curTask, taskText: curTaskText }] }))
        break
      case 'thinking_delta':
        set((s) => {
          // التوجيه بالمعرّف لا بـ«العنصر الأخير»: مزوّد يخلط التفكير بالنص قد يرسل
          // الدلتا بعد بدء النص، والمعرّف يضمن وصولها لبطاقتها الصحيحة.
          const idx = s.items.findIndex((i) => i.kind === 'thinking' && i.streaming && i.id === e.id)
          if (idx < 0) return {} // بطاقة أُنهيت/حُذفت: لا مصدر للدلتا
          const items = [...s.items]
          const cur = items[idx] as Extract<ChatItem, { kind: 'thinking' }>
          items[idx] = { ...cur, text: cur.text + e.text }
          return { items }
        })
        break
      case 'thinking_reset':
        // إزالة كل بطاقة منسيابة — لا يشترط أن تكون الأخيرة (مسار الاحتياط يدفع إشعاراً قبلها)
        set((s) => (s.items.some((i) => i.kind === 'thinking' && i.streaming) ? { items: s.items.filter((i) => !(i.kind === 'thinking' && i.streaming)) } : {}))
        break
      case 'text_reset':
        set((s) => {
          const last = s.items[s.items.length - 1]
          return last?.kind === 'assistant' && last.streaming ? { items: s.items.slice(0, -1) } : {}
        })
        break
      case 'assistant_done':
        set((s) => {
          const items = finalizeThinking(s.items)
          const last = items[items.length - 1]
          if (last?.kind === 'assistant' && last.streaming) return { items: last.text.trim() ? [...items.slice(0, -1), { ...last, streaming: false }] : items.slice(0, -1) }
          return { items }
        })
        break
      case 'tool_start':
        set((s) => {
          // id هو callId نفسه: تحديث هذا المعرّف لا ينشئ بطاقة ثانية أبداً
          if (s.items.some((i) => i.id === e.callId)) return { phase: 'acting' }
          const items = finalizeThinking(s.items)
          return { items: [...items, { kind: 'tool', id: e.callId, name: e.name, input: e.input, status: 'running', task: curTask, taskText: curTaskText }], phase: 'acting' }
        })
        break
      case 'tool_end':
        set((s) => {
          const found = s.items.find((i): i is Extract<ChatItem, { kind: 'tool' }> => i.kind === 'tool' && i.id === e.callId)
          const rawIn = (found?.input ?? {}) as Record<string, unknown>
          const arg = String(rawIn.path ?? rawIn.command ?? rawIn.pattern ?? rawIn.query ?? rawIn.target ?? rawIn.url ?? rawIn.text ?? rawIn.slug ?? '').slice(0, 80)
          return {
            items: s.items.map((i) => (i.kind === 'tool' && i.id === e.callId ? { ...i, status: e.ok ? 'ok' : 'error', output: e.output, ms: e.ms, image: e.image, diff: e.diff } : i)),
            log: [...s.log, entry({ kind: 'tool', text: found?.name ?? 'tool', arg, ok: e.ok, ms: e.ms })].slice(-400)
          }
        })
        break
      case 'project_bound':
        set({ project: e.project })
        void get().refreshProjects()
        break
      case 'ask':
        set((s) => ({ items: [...s.items, { kind: 'ask', id: e.askId, question: e.question, options: e.options }] }))
        break
      case 'plan': {
        // انتقال المهمة: أغلق القديمة بإشعار «تمّ» وابدأ الجديدة بـ«بدأ» — يرى المستخدم الحد صراحة
        const doingIdx = e.items.findIndex((x) => x.status === 'doing')
        const nextKey = doingIdx >= 0 ? `t${doingIdx}` : curTask
        const nextText = doingIdx >= 0 ? e.items[doingIdx].text : curTaskText
        const marks: ChatItem[] = []
        if (curTask && nextKey !== curTask) {
          marks.push({ kind: 'task', id: uid(), text: curTaskText, status: 'done' })
          if (nextText) marks.push({ kind: 'task', id: uid(), text: nextText, status: 'start' })
        }
        curTask = nextKey
        curTaskText = nextText
        set((s) => ({ plan: e.items, items: marks.length ? [...s.items, ...marks] : s.items }))
        break
      }
      case 'notice':
        set((s) => ({
          items: [...s.items, { kind: 'notice', id: uid(), level: e.level, text: e.text, task: curTask, taskText: curTaskText }],
          log: [...s.log, entry({ kind: 'notice', text: e.text, level: e.level })].slice(-400)
        }))
        break
      case 'usage':
        set({ usage: { tokens: e.contextTokens, window: e.contextWindow, step: e.step } })
        break
      case 'run_end':
        set((s) => {
          const items = finalizeThinking(s.items)
          return { items, running: false, phase: 'idle', phaseLabel: '', needsResume: e.reason === 'error' || e.reason === 'max_steps' }
        })
        void get().refreshProjects()
        break
    }
  }
}))
