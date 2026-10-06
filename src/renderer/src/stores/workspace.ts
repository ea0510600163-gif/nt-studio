import { create } from 'zustand'
import type { AgentEvent, AgentPhase, PlanStep, ProjectInfo } from '../../../shared/api'

/**
 * حالة مساحة العمل.
 *
 * قرار: مصدر الحقيقة الوحيد هو أحداث العملية الرئيسية. لا نخزّن نسخًا
 * منفصلة من حالة الوكيل في الواجهة — نستقبلها ونشتقّ منها العرض. هذا يمنع
 * الاختلاف بين ما تراه الواجهة وما يفعله الوكيل فعلًا.
 */

export interface ToolActivity {
  callId: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  summary: string
  ms: number
  at: number
}

export interface ChatLine {
  id: string
  role: 'user' | 'agent'
  text: string
  at: number
}

export interface Notice {
  level: 'info' | 'warn' | 'error'
  message: string
  at: number
}

export type ViewportName = 'full' | 'laptop' | 'tablet' | 'mobile'

export interface WorkspaceState {
  projects: ProjectInfo[]
  projectPath: string | null
  projectsLoading: boolean

  lines: ChatLine[]
  streamingText: string
  tools: ToolActivity[]
  plan: PlanStep[]
  notices: Notice[]

  running: boolean
  phase: AgentPhase
  phaseDetail: string
  streaming: boolean
  awaitingQuestion: string | null

  previewUrl: string | null
  screenshot: string | null
  consoleIssues: Array<{ level: string; text: string; line?: number }>
  viewport: ViewportName

  providerId: string | null
  modelId: string | null

  setProjects: (p: ProjectInfo[]) => void
  setProject: (path: string | null) => void
  pushUserLine: (text: string) => void
  resetRun: () => void
  applyEvent: (e: AgentEvent) => void
  setPreviewUrl: (url: string | null) => void
  setScreenshot: (data: string | null) => void
  setConsoleIssues: (issues: Array<{ level: string; text: string; line?: number }>) => void
  setViewport: (v: ViewportName) => void
  setActive: (providerId: string | null, modelId: string | null) => void
  setAwaitingQuestion: (q: string | null) => void
  pushNotice: (level: Notice['level'], message: string) => void
}

let seq = 0
const nextId = (): string => `l${Date.now().toString(36)}${(seq++).toString(36)}`

const MAX_TOOLS = 120
const MAX_NOTICES = 200
const MAX_LINES = 300

const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: 'جاهز',
  thinking: 'يفكّر',
  tool: 'ينفّذ',
  installing: 'يثبّت الحزم',
  starting: 'يشغّل الخادم',
  inspecting: 'يفحص النتيجة',
  fixing: 'يصلح',
  done: 'اكتمل',
  error: 'خطأ',
}

export function phaseLabel(phase: AgentPhase): string {
  return PHASE_LABEL[phase] ?? phase
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  projects: [],
  projectPath: null,
  projectsLoading: true,

  lines: [],
  streamingText: '',
  tools: [],
  plan: [],
  notices: [],

  running: false,
  phase: 'idle',
  phaseDetail: '',
  streaming: false,
  awaitingQuestion: null,

  previewUrl: null,
  screenshot: null,
  consoleIssues: [],
  viewport: 'full',

  providerId: null,
  modelId: null,

  setProjects: (projects) => set({ projects, projectsLoading: false }),

  setProject: (projectPath) =>
    set({
      projectPath,
      previewUrl: null,
      screenshot: null,
      consoleIssues: [],
      lines: [],
      streamingText: '',
      tools: [],
      plan: [],
      notices: [],
      running: false,
      phase: 'idle',
      awaitingQuestion: null,
    }),

  pushUserLine: (text) =>
    set((s) => ({
      lines: [...s.lines, { id: nextId(), role: 'user' as const, text, at: Date.now() }].slice(-MAX_LINES),
    })),

  resetRun: () =>
    set({
      streamingText: '',
      tools: [],
      streaming: false,
      awaitingQuestion: null,
      notices: [],
    }),

  pushNotice: (level, message) =>
    set((s) => ({
      notices: [...s.notices, { level, message, at: Date.now() }].slice(-MAX_NOTICES),
    })),

  setPreviewUrl: (previewUrl) => set({ previewUrl }),
  setScreenshot: (screenshot) => set({ screenshot }),
  setConsoleIssues: (consoleIssues) => set({ consoleIssues }),
  setViewport: (viewport) => set({ viewport }),
  setActive: (providerId, modelId) => set({ providerId, modelId }),
  setAwaitingQuestion: (awaitingQuestion) => set({ awaitingQuestion, running: false, streaming: false }),

  applyEvent: (e) => {
    switch (e.type) {
      case 'status': {
        set({ phase: e.phase, phaseDetail: e.detail ?? '' })
        return
      }

      case 'text': {
        set((s) => ({ streamingText: s.streamingText + e.delta, streaming: true }))
        return
      }

      case 'tool_start': {
        set((s) => {
          const activity: ToolActivity = {
            callId: e.callId || `t${s.tools.length}`,
            name: e.name,
            args: e.args ?? {},
            status: 'running',
            summary: '',
            ms: 0,
            at: Date.now(),
          }
          return {
            streaming: false,
            tools: [...s.tools, activity].slice(-MAX_TOOLS),
          }
        })
        return
      }

      case 'tool_end': {
        set((s) => {
          let index = s.tools.findIndex((t) => t.callId === e.callId && t.status === 'running')
          if (index === -1) {
            for (let i = s.tools.length - 1; i >= 0; i--) {
              const tool = s.tools[i]
              if (tool && tool.name === e.name && tool.status === 'running') {
                index = i
                break
              }
            }
          }
          if (index === -1) return {}
          const copy = [...s.tools]
          const target = copy[index]
          if (!target) return {}
          copy[index] = {
            ...target,
            status: e.ok ? 'done' : 'error',
            summary: e.summary,
            ms: e.ms,
          }
          return { tools: copy }
        })
        return
      }

      case 'notice': {
        set((s) => ({
          notices: [...s.notices, { level: e.level, message: e.message, at: Date.now() }].slice(-MAX_NOTICES),
        }))
        return
      }

      case 'plan': {
        set({ plan: e.steps })
        return
      }

      case 'done': {
        const state = get()
        const text = state.streamingText.trim()
        const lines =
          text.length > 0
            ? [...state.lines, { id: nextId(), role: 'agent' as const, text, at: Date.now() }].slice(-MAX_LINES)
            : state.lines
        set({
          running: false,
          streaming: false,
          streamingText: '',
          phase: e.reason === 'needs-input' ? 'idle' : 'done',
          lines,
          awaitingQuestion: e.reason === 'needs-input' ? text || 'في انتظار ردّك' : null,
        })
        return
      }

      case 'failed': {
        set((s) => ({
          running: false,
          streaming: false,
          streamingText: '',
          phase: 'error',
          notices: [...s.notices, { level: 'error' as const, message: e.message, at: Date.now() }].slice(
            -MAX_NOTICES,
          ),
        }))
        return
      }
    }
  },
}))

export const VIEWPORT_SIZES: Record<ViewportName, { width: number; height: number } | null> = {
  full: null,
  laptop: { width: 1280, height: 820 },
  tablet: { width: 834, height: 1000 },
  mobile: { width: 390, height: 760 },
}