import { create } from 'zustand'
import type {
  AgentEvent, ChatItem, ComputerControlAction, ComputerState, LoadedSession, ModelRef, Phase, PreviewState, ProjectInfo, ProviderPublic, SessionInfo, SessionMode, Settings, SkillInfo, TodoItem
} from '@shared/types'
import { validateImages } from '@shared/images'

export type Tab = 'preview' | 'code' | 'terminal' | 'log'
export type Overlay = null | 'projects' | 'settings' | 'provider' | 'sessions'
export type SettingsTab = 'providers' | 'prompts' | 'skills' | 'system'

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
  defaultPrompts: { studioPrompt: string; agentPrompt: string }
  skills: SkillInfo[]
  activeSkill: SkillInfo | null
  settingsTab: SettingsTab
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
  computer: ComputerState
  tab: Tab
  overlay: Overlay
  log: LogEntry[]
  toast: { text: string; level: 'info' | 'warn' | 'error' } | null
  treeRev: number
  selectedFile: string | null
  chatW: number
  sessions: SessionInfo[]
  mode: SessionMode
  studioSessionId: string | null
  agentSessionId: string | null
  setMode(m: SessionMode): Promise<void>
  bind(): () => void
  bootstrap(): Promise<void>
  refreshProviders(): Promise<void>
  refreshProjects(): Promise<void>
  refreshSessions(): Promise<void>
  refreshSkills(): Promise<void>
  saveSkill(input: { id: string; label: string; description: string; content: string }): Promise<SkillInfo>
  removeSkill(id: string): Promise<void>
  setActiveSkill(s: SkillInfo | null): void
  openSettingsTab(tab: SettingsTab): void
  setSettings(p: Partial<Settings>): Promise<void>
  applyLoaded(l: LoadedSession): void
  newSession(): Promise<void>
  openNewChatFor(projectId: string): Promise<void>
  openProject(id: string): Promise<void>
  loadSession(id: string): Promise<void>
  deleteAllChats(): Promise<number>
  send(text: string, images?: { mediaType: string; data: string }[]): Promise<void>
  regenerate(): Promise<void>
  stop(): Promise<void>
  resume(): Promise<void>
  answer(askId: string, value: string): Promise<void>
  setTab(t: Tab): void
  focusTab(tab: Tab): void
  openFileInStage(path: string): void
  setChatWidth(w: number): void
  setOverlay(o: Overlay): void
  notify(text: string, level?: 'info' | 'warn' | 'error'): void
  bumpTreeRev(): void
  handle(e: AgentEvent): void
  currentModel(): ModelRef | null
  newChatForProject: () => Promise<void>
  closePreview: () => Promise<void>
  computerControl: (action: ComputerControlAction) => Promise<void>
}

let logId = 0
const entry = (e: Omit<LogEntry, 'id' | 'ts'>): LogEntry => ({ id: ++logId, ts: Date.now(), ...e })
const uid = () => Math.random().toString(36).slice(2, 9)
let bootPromise: Promise<void> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
const lastSeqBySession = new Map<string, number>()

export function shouldApply(e: Pick<AgentEvent, '__seq'>, lastSeqForSession: number | undefined): boolean {
  if (typeof e.__seq !== 'number') return true
  return e.__seq > (lastSeqForSession ?? -Infinity)
}

let curTask: string | undefined
let curTaskText = ''

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
  return hit ? out : items
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  providers: [],
  settings: null,
  defaultPrompts: { studioPrompt: '', agentPrompt: '' },
  skills: [],
  activeSkill: null,
  settingsTab: 'providers',
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
  computer: {
    status: 'idle',
    thought: '',
    stats: { clicks: 0, chars: 0, screenshots: 0, steps: 0, elapsedMs: 0 },
    plan: [],
    lastAction: null,
    lastActions: [],
    cursor: { x: 512, y: 384, nx: 0.5, ny: 0.5 },
    screenWidth: 1920,
    screenHeight: 1080,
    logicalWidth: 1280,
    logicalHeight: 720,
    activeWindowTitle: '',
    activeWindowProcess: '',
    studioMinimized: false,
    stuck: null
  },
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
      nt.on<ComputerState>('computer:state', (c) =>
        set((prev) => ({
          computer: {
            ...prev.computer,
            ...c
          }
        }))
      ),
      nt.on<string>('ui:focus', (t) => { if (t === 'preview') set({ tab: 'preview' }) }),
      nt.on('providers:changed', () => void get().refreshProviders()),
      nt.on('skills:changed', () => void get().refreshSkills()),
      nt.on('fs:changed', () => get().bumpTreeRev())
    ]
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
      const [providers, settings, defaultPrompts, skills] = await Promise.all([
        nt.providers.list(),
        nt.settings.get(),
        nt.settings.defaults().catch(() => ({ studioPrompt: '', agentPrompt: '' })),
        nt.skills.list().catch(() => [])
      ])
      set({ providers, settings, defaultPrompts, skills })
      set({ preview: await nt.preview.state() })
      if (nt.computer) {
        try { set({ computer: await nt.computer.state() }) } catch {}
      }
      await get().refreshProjects()
      await get().refreshSessions()
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
  async refreshSkills() {
    const skills = await window.nt.skills.list()
    const cur = get().activeSkill
    set({
      skills,
      activeSkill: cur ? skills.find((s) => s.id === cur.id) ?? null : null
    })
  },
  async saveSkill(input) {
    const saved = await window.nt.skills.save(input)
    await get().refreshSkills()
    return saved
  },
  async removeSkill(id) {
    await window.nt.skills.remove(id)
    await get().refreshSkills()
  },
  setActiveSkill(s) {
    set({ activeSkill: s })
  },
  openSettingsTab(tab) {
    set({ settingsTab: tab, overlay: 'settings' })
  },
  async setSettings(p) {
    set({ settings: await window.nt.settings.set(p) })
  },

  applyLoaded(l) {
    const doingIdx = (l.plan ?? []).findIndex((x) => x.status === 'doing')
    curTask = doingIdx >= 0 ? `t${doingIdx}` : undefined
    curTaskText = doingIdx >= 0 ? l.plan[doingIdx].text : ''
    lastSeqBySession.set(l.session.id, -Infinity)
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
    if (get().running) {
      get().notify('أوقف العمل الجاري أولاً ثم بدّل الوضع', 'warn')
      return
    }
    const from = get().mode
    const curId = get().sessionId
    set({ mode: m, ...(from === 'agent' ? { agentSessionId: curId } : { studioSessionId: curId }) })
    const slotId = m === 'agent' ? get().agentSessionId : get().studioSessionId
    let l: LoadedSession | null = null
    if (slotId) {
      try {
        l = await window.nt.sessions.load(slotId)
      } catch {
        l = null
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
    const l = await window.nt.projects.open(id, get().sessionId)
    get().applyLoaded(l)
    set({ overlay: null })
  },
  async loadSession(id) {
    if (get().running) {
      get().notify('أوقف العمل الجاري أولاً ثم بدّل الجلسة', 'warn')
      return
    }
    const l = await window.nt.sessions.load(id)
    get().applyLoaded(l)
    if ((l.session.mode ?? 'studio') !== get().mode) set({ mode: l.session.mode ?? 'studio' })
  },

  async deleteAllChats() {
    const removed = await window.nt.sessions.deleteAll()
    await get().refreshSessions()
    if (removed > 0 && !get().sessions.some((s) => s.id === get().sessionId)) await get().newSession()
    return removed
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
    await get().openNewChatFor(project.id)
    get().notify('شات جديد على نفس المشروع', 'info')
  },

  async closePreview() {
    await window.nt.preview.close()
    set({ preview: { ...get().preview, open: false } })
  },

  async computerControl(action) {
    try {
      const next = await window.nt.computer.control(action, get().sessionId ?? undefined)
      set({ computer: next })
      if (action === 'takeover') {
        get().notify('✋ تعامل مع الجهاز بنفسك — الماوس والكيبورد بين يديك', 'info')
      } else if (action === 'return') {
        get().notify('🤖 أُعيد التحكم للإيجنت — يقيّم الشاشة الآن ويكمل المهمة', 'info')
      } else if (action === 'pause') {
        get().notify('⏸ أُوقف الإيجنت مؤقتاً', 'info')
      } else if (action === 'resume') {
        get().notify('▶ استؤنف عمل الإيجنت', 'info')
      } else if (action === 'stop') {
        set({ running: false, phase: 'idle', phaseLabel: '' })
        get().notify('⏹ أُوقف الإيجنت فوراً', 'warn')
      }
    } catch (e) {
      get().notify(`تعذّر تنفيذ الأمر: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
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
      items: [...s.items, { kind: 'user', id: uid(), text: text.trim(), images: safe.ok.map((im) => `data:${im.mediaType};base64,${im.data}`), at: Date.now() }],
      running: true,
      needsResume: false
    }))
    try {
      await window.nt.agent.send(sessionId, text.trim(), get().currentModel() ?? undefined, safe.ok.length ? safe.ok : undefined)
    } catch (e) {
      set({ running: false, phase: 'idle', phaseLabel: '' })
      get().notify(`تعذّر بدء العمل: ${(e as Error).message}`, 'error')
      return
    }
    if (!running) set({ phase: 'thinking' })
  },
  async regenerate() {
    const { sessionId, items, mode } = get()
    if (!sessionId) return
    if (mode === 'agent') {
      get().notify('إعادة التوليد متاحة في وضع Studio فقط', 'warn')
      return
    }
    if (get().running) {
      get().notify('أوقف العمل الجاري أولاً', 'warn')
      return
    }
    let idx = -1
    for (let k = items.length - 1; k >= 0; k--) if (items[k].kind === 'user') { idx = k; break }
    if (idx < 0) {
      get().notify('لا يوجد طلب سابق لإعادة توليده', 'warn')
      return
    }
    set({ items: items.slice(0, idx + 1), running: true, needsResume: false, phase: 'thinking' })
    try {
      await window.nt.agent.regenerate(sessionId, get().currentModel() ?? undefined)
    } catch (e) {
      set({ running: false, phase: 'idle', phaseLabel: '' })
      get().notify(`تعذّرت إعادة التوليد: ${(e as Error).message}`, 'error')
    }
  },
  async stop() {
    const st = get()
    const target = st.sessions.find((x) => x.running)?.id ?? st.sessionId
    if (!target) return
    set({ phase: 'stopping', phaseLabel: 'جارٍ إيقاف الوكيل…' })
    try { await window.nt.agent.stop(target) }
    catch (e) { get().notify(`تعذّر إيقاف العمل: ${e instanceof Error ? e.message : String(e)}`, 'error') }
    void get().refreshSessions().catch(() => {})
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
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
    set({ toast: { text, level } })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set((s) => (s.toast?.text === text ? { toast: null } : {}))
    }, 4500)
  },

  handle(e) {
    if (e.sessionId !== get().sessionId) return
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
        set((s) => ({ items: [...finalizeThinking(s.items), { kind: 'thinking', id: e.id, text: '', streaming: true, task: curTask, taskText: curTaskText }] }))
        break
      case 'thinking_delta':
        set((s) => {
          const idx = s.items.findIndex((i) => i.kind === 'thinking' && i.streaming && i.id === e.id)
          if (idx < 0) return {}
          const items = [...s.items]
          const cur = items[idx] as Extract<ChatItem, { kind: 'thinking' }>
          items[idx] = { ...cur, text: cur.text + e.text }
          return { items }
        })
        break
      case 'thinking_reset':
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
          if (s.items.some((i) => i.id === e.callId)) return { phase: 'acting' }
          const items = finalizeThinking(s.items)
          return { items: [...items, { kind: 'tool', id: e.callId, name: e.name, input: e.input, status: 'running', task: curTask, taskText: curTaskText }], phase: 'acting' }
        })
        break
      case 'tool_progress':
        set((s) => ({
          items: s.items.map((i) => (i.kind === 'tool' && i.id === e.callId ? { ...i, output: e.output } : i))
        }))
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
        void get().refreshSessions().catch(() => {})
        break
    }
  }
}))
