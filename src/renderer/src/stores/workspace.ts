import { create } from 'zustand'
import type { ProjectInfo } from '../../../shared/api'
import {
  MAX_LINES,
  initialRunState,
  runReducer,
  type ChatLine,
  type ConsoleIssue,
  type Notice,
  type NoticeLevel,
  type Question,
  type RunAction,
  type RunState,
  type ToolActivity,
  type Usage,
  type ViewportName,
} from './reducer'

/**
 * حالة مساحة العمل.
 *
 * قرار: مصدر الحقيقة الوحيد هو أحداث العملية الرئيسية. لا نخزّن نسخًا منفصلة
 * من حالة الوكيل — نستقبلها ونشتقّ منها العرض. هذا يمنع الاختلاف بين ما تراه
 * الواجهة وما يفعله الوكيل فعلًا.
 *
 * كل انتقالات الحالة نفسها في `reducer.ts` (نقية وقابلة للاختبار). هذا الملف
 * غلاف zustand رقيق حولها، لا يتخذ أي قرار.
 */

export type {
  ChatLine,
  ConsoleIssue,
  Notice,
  NoticeLevel,
  Question,
  RunAction,
  RunState,
  ToolActivity,
  Usage,
  ViewportName,
}

export interface WorkspaceState extends RunState {
  projects: ProjectInfo[]
  projectPath: string | null
  viewport: ViewportName
  providerId: string | null
  modelId: string | null

  setProjects: (projects: ProjectInfo[]) => void
  setProject: (path: string | null) => void
  setActive: (providerId: string | null, modelId: string | null) => void

  pushUserLine: (text: string) => void
  pushNotice: (level: NoticeLevel, message: string) => void
  setPreviewUrl: (url: string | null) => void
  setConsoleIssues: (issues: Array<{ level: string; text: string; line?: number }>) => void
  setViewport: (v: ViewportName) => void

  /** الطريق الوحيد الذي يعدّل حالة تشغيل — كل شيء يمرّ من هنا. */
  dispatch: (action: RunAction) => void
}

const PHASE_LABEL: Record<string, string> = {
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

export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase
}

let consoleSeq = 0

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  ...initialRunState(),

  projects: [],
  projectPath: null,
  viewport: 'full',
  providerId: null,
  modelId: null,

  setProjects: (projects) => set({ projects }),

  setProject: (projectPath) => {
    const keep = { projects: get().projects, providerId: get().providerId, modelId: get().modelId }
    // مشروع جديد = جولة جديدة: نبدأ من حالة ابتدائية نظيفة.
    set({ ...keep, ...initialRunState(), projectPath })
  },

  setActive: (providerId, modelId) => set({ providerId, modelId }),

  pushUserLine: (text) => {
    const body = text.trim()
    if (!body) return
    set((s) => {
      const line: ChatLine = { id: `u${s.lineSeq}`, role: 'user', text: body, at: Date.now() }
      return { lines: [...s.lines, line].slice(-MAX_LINES), lineSeq: s.lineSeq + 1 }
    })
  },

  pushNotice: (level, message) => get().dispatch({ type: 'log/note', level, message }),

  setPreviewUrl: (previewUrl) => set({ previewUrl }),

  setConsoleIssues: (issues) =>
    set({
      consoleIssues: issues.map((i): ConsoleIssue => ({
        id: `c${consoleSeq++}`,
        level: i.level,
        text: i.text,
        line: i.line,
      })),
    }),

  setViewport: (viewport) => set({ viewport }),

  dispatch: (action) => set((s) => runReducer(s, action)),
}))

export const VIEWPORT_SIZES: Record<ViewportName, { width: number; height: number } | null> = {
  full: null,
  laptop: { width: 1280, height: 820 },
  tablet: { width: 834, height: 1000 },
  mobile: { width: 390, height: 760 },
}