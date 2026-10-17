import type {
  AgentEvent,
  Bounds,
  DeviceKind,
  FileNode,
  ImageAttachment,
  LoadedSession,
  ModelInfo,
  ModelRef,
  PreviewState,
  ProcInfo,
  ProjectInfo,
  ProviderInput,
  ProviderPublic,
  SessionInfo,
  SessionMode,
  Settings
} from './types'

/** القنوات المسموح بالاستماع إليها من الواجهة */
export const EVENT_CHANNELS = [
  'agent:event',
  'preview:state',
  'ui:focus',
  'fs:changed',
  'term:data',
  'term:procs',
  'providers:changed',
  'window:state'
] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export interface TestResult {
  ok: boolean
  message: string
}

export interface NtApi {
  providers: {
    list(): Promise<ProviderPublic[]>
    save(input: ProviderInput): Promise<ProviderPublic>
    remove(id: string): Promise<void>
    test(id: string, modelId?: string): Promise<TestResult>
    fetchModels(input: Pick<ProviderInput, 'baseUrl' | 'apiKey' | 'apiStyle' | 'id'>): Promise<ModelInfo[]>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  projects: {
    list(): Promise<(ProjectInfo & { sessionId: string | null })[]>
    open(projectId: string): Promise<LoadedSession>
    undo(projectId: string): Promise<string>
    reveal(projectId: string): Promise<void>
  }
  sessions: {
    create(mode?: SessionMode): Promise<LoadedSession>
    /** جلسة جديدة مرتبطة بنفس المشروع — ذاكرة المشروع كاملة بسياق محادثة نظيف */
    createForProject(projectId: string): Promise<LoadedSession>
    /** آخر جلسة ذات محتوى ضمن الوضع نفسه، أو جلسة جديدة — لا ينشئ كياناً يتيماً عند كل إقلاع */
    openLatest(mode?: SessionMode): Promise<LoadedSession>
    load(sessionId: string): Promise<LoadedSession>
    list(): Promise<SessionInfo[]>
  }
  agent: {
    send(sessionId: string, text: string, model?: ModelRef, images?: ImageAttachment[]): Promise<void>
    stop(sessionId: string): Promise<void>
    resume(sessionId: string, model?: ModelRef): Promise<void>
    answer(askId: string, value: string): Promise<void>
    emergencyStop(): Promise<void>
  }
  preview: {
    setBounds(b: Bounds): Promise<void>
    setSuppressed(v: boolean): Promise<void>
    setDevice(d: DeviceKind): Promise<void>
    reload(): Promise<void>
    external(): Promise<void>
    /** إغلاق لوحة المعاينة (زر × في شريط المعاينة) */
    close(): Promise<void>
    state(): Promise<PreviewState>
  }
  /** أزرار النافذة المخصّصة (الإطار مخفي — نرسمها نحن بتصميمنا) */
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
  fs: {
    tree(sessionId: string): Promise<FileNode[]>
    read(sessionId: string, path: string): Promise<string>
  }
  term: {
    procs(): Promise<ProcInfo[]>
    replay(procId: string): Promise<string>
    input(procId: string, data: string): Promise<void>
    stop(procId: string): Promise<void>
  }
  on<T = unknown>(channel: EventChannel, cb: (payload: T) => void): () => void
}

export type { AgentEvent }
