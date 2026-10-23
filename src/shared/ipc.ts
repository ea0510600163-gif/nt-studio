import type {
  AgentEvent,
  ApprovalRequest,
  Bounds,
  ComputerControlAction,
  ComputerState,
  DeviceKind,
  FileNode,
  ImageAttachment,
  LoadedSession,
  ModelInfo,
  ModelRef,
  PickedFile,
  PickedFolder,
  PreviewState,
  ProcInfo,
  ProjectInfo,
  ProviderInput,
  ProviderPublic,
  SessionInfo,
  SessionMode,
  Settings,
  SkillInfo
} from './types'

export const EVENT_CHANNELS = [
  'agent:event',
  'preview:state',
  'computer:state',
  'ui:focus',
  'fs:changed',
  'term:data',
  'term:procs',
  'providers:changed',
  'skills:changed',
  'permission:request',
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
    defaults(): Promise<{ studioPrompt: string; agentPrompt: string }>
  }
  skills: {
    list(): Promise<SkillInfo[]>
    save(input: { id: string; label: string; description: string; content: string }): Promise<SkillInfo>
    remove(id: string): Promise<void>
  }
  projects: {
    list(): Promise<(ProjectInfo & { sessionId: string | null })[]>
    open(projectId: string, currentSessionId?: string | null): Promise<LoadedSession>
    import(): Promise<LoadedSession | null>
    undo(projectId: string): Promise<string>
    reveal(projectId: string): Promise<void>
    delete(projectId: string): Promise<{ removed: boolean; sessions: number }>
    deleteAll(): Promise<{ removed: number; sessions: number; failed: string[] }>
  }
  sessions: {
    create(mode?: SessionMode): Promise<LoadedSession>
    createForProject(projectId: string): Promise<LoadedSession>
    openLatest(mode?: SessionMode): Promise<LoadedSession>
    load(sessionId: string): Promise<LoadedSession>
    list(): Promise<SessionInfo[]>
    deleteAll(): Promise<number>
  }
  agent: {
    send(sessionId: string, text: string, model?: ModelRef, images?: ImageAttachment[]): Promise<void>
    regenerate(sessionId: string, model?: ModelRef): Promise<void>
    stop(sessionId: string): Promise<void>
    resume(sessionId: string, model?: ModelRef): Promise<void>
    answer(askId: string, value: string): Promise<void>
    emergencyStop(): Promise<void>
  }
  permission: {
    answer(requestId: string, ok: boolean): Promise<void>
  }
  preview: {
    setBounds(b: Bounds): Promise<void>
    setSuppressed(v: boolean): Promise<void>
    setDevice(d: DeviceKind): Promise<void>
    reload(): Promise<void>
    external(): Promise<void>
    close(): Promise<void>
    state(): Promise<PreviewState>
  }
  computer: {
    state(): Promise<ComputerState>
    control(action: ComputerControlAction, sessionId?: string): Promise<ComputerState>
    screenshot(): Promise<{ dataUrl: string; width: number; height: number }>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
  fs: {
    tree(sessionId: string): Promise<FileNode[]>
    read(sessionId: string, path: string): Promise<string>
    pickFiles(): Promise<PickedFile[]>
    pickFolder(): Promise<PickedFolder | null>
  }
  term: {
    procs(): Promise<ProcInfo[]>
    replay(procId: string): Promise<string>
    input(procId: string, data: string): Promise<void>
    stop(procId: string): Promise<void>
  }
  on<T = unknown>(channel: EventChannel, cb: (payload: T) => void): () => void
}

export type { AgentEvent, ApprovalRequest }
