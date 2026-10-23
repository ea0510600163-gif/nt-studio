export type ApiStyle = 'openai' | 'anthropic' | 'responses'

export interface ModelInfo {
  id: string
  tools: boolean
  vision: boolean
  contextWindow: number
  apiStyle?: ApiStyle
  maxOutput?: number
  origin?: 'catalog' | 'manual'
}

export interface ProviderPublic {
  id: string
  name: string
  baseUrl: string
  apiStyle: ApiStyle
  models: ModelInfo[]
  hasKey: boolean
  opencode?: boolean
}

export interface ProviderInput {
  id?: string
  name: string
  baseUrl: string
  apiKey?: string
  apiStyle: ApiStyle
  models: ModelInfo[]
  opencode?: boolean
}

export interface ModelRef {
  providerId: string
  modelId: string
}

export type PermissionMode = 'ask' | 'full'

export interface Settings {
  workspaceRoot: string
  maxSteps: number
  commandTimeoutSec: number
  maxOutputTokens: number
  compactAtPercent: number
  maxRunMs: number
  maxTotalStepsAcrossResumes: number
  defaultModel: ModelRef | null
  fallbackModel: ModelRef | null
  permissionMode: PermissionMode
  approvalMode: boolean
  persona?: string
  studioPrompt?: string
  agentPrompt?: string
}

export interface ApprovalRequest {
  requestId: string
  sessionId: string
  tool: string
  target: string
  reason: string
  danger: boolean
}

export interface SkillInfo {
  id: string
  label: string
  description: string
  content: string
  isDefault?: boolean
}

export interface PickedFile {
  path: string
  name: string
  size: number
  preview?: string
  image?: ImageAttachment
}

export interface PickedFolder {
  path: string
  name: string
  entries: string[]
}

export interface ProjectInfo {
  id: string
  slug: string
  name: string
  description: string
  stack: string
  dir: string
  createdAt: number
  updatedAt: number
}

export interface SessionInfo {
  id: string
  projectId: string | null
  title: string
  updatedAt: number
  running: boolean
  mode?: SessionMode
}

export type SessionMode = 'studio' | 'agent'

export type TodoStatus = 'pending' | 'doing' | 'done' | 'blocked'
export interface TodoItem {
  id: string
  text: string
  status: TodoStatus
}

export type Phase = 'idle' | 'thinking' | 'acting' | 'testing' | 'compacting' | 'waiting' | 'retrying' | 'stopping'

export interface FileDiff {
  path: string
  kind: 'create' | 'modify' | 'append' | 'delete'
  before: string
  after: string
  added: number
  removed: number
}

export interface ImageAttachment {
  mediaType: string
  data: string
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images?: string[]; at?: number; step?: number }
  | { kind: 'task'; id: string; text: string; status: 'start' | 'done'; step?: number }
  | { kind: 'assistant'; id: string; text: string; streaming?: boolean; task?: string; taskText?: string; step?: number }
  | { kind: 'thinking'; id: string; text: string; streaming?: boolean; task?: string; taskText?: string; step?: number }
  | {
      kind: 'tool'
      id: string
      name: string
      input: unknown
      status: 'running' | 'ok' | 'error'
      output?: string
      ms?: number
      image?: string
      task?: string
      taskText?: string
      diff?: FileDiff
      step?: number
    }
  | { kind: 'notice'; id: string; level: 'info' | 'warn' | 'error'; text: string; task?: string; taskText?: string; step?: number }
  | { kind: 'ask'; id: string; question: string; options?: string[]; answered?: string; step?: number }

export type AgentEvent =
  | { t: 'status'; sessionId: string; phase: Phase; label?: string; __seq?: number }
  | { t: 'text_delta'; sessionId: string; text: string; __seq?: number }
  | { t: 'text_reset'; sessionId: string; __seq?: number }
  | { t: 'thinking_start'; sessionId: string; id: string; __seq?: number }
  | { t: 'thinking_delta'; sessionId: string; id: string; text: string; __seq?: number }
  | { t: 'thinking_reset'; sessionId: string; __seq?: number }
  | { t: 'assistant_done'; sessionId: string; __seq?: number }
  | { t: 'tool_start'; sessionId: string; callId: string; name: string; input: unknown; __seq?: number }
  | { t: 'tool_progress'; sessionId: string; callId: string; output: string; __seq?: number }
  | {
      t: 'tool_end'
      sessionId: string
      callId: string
      ok: boolean
      output: string
      ms: number
      image?: string
      diff?: FileDiff
      __seq?: number
    }
  | { t: 'plan'; sessionId: string; items: TodoItem[]; __seq?: number }
  | { t: 'project_bound'; sessionId: string; project: ProjectInfo; __seq?: number }
  | { t: 'ask'; sessionId: string; askId: string; question: string; options?: string[]; __seq?: number }
  | { t: 'notice'; sessionId: string; level: 'info' | 'warn' | 'error'; text: string; __seq?: number }
  | { t: 'usage'; sessionId: string; contextTokens: number; contextWindow: number; step: number; __seq?: number }
  | {
      t: 'run_end'
      sessionId: string
      reason: 'done' | 'stopped' | 'error' | 'max_steps'
      __seq?: number
    }

export type DeviceKind = 'mobile' | 'tablet' | 'desktop'

export interface PreviewState {
  url: string
  title: string
  loading: boolean
  device: DeviceKind
  open: boolean
  errors: number
  boundsEpoch: number
}

export type ComputerAgentStatus = 'idle' | 'thinking' | 'acting' | 'waiting' | 'paused' | 'takeover' | 'done' | 'error'

export interface ComputerStats {
  clicks: number
  chars: number
  screenshots: number
  steps: number
  elapsedMs: number
}

export interface ComputerPlanStep {
  title: string
  state: 'done' | 'active' | 'pending'
}

export interface ComputerActionTrace {
  id: string
  kind: string
  x?: number
  y?: number
  nx?: number
  ny?: number
  startX?: number
  startY?: number
  startNx?: number
  startNy?: number
  text?: string
  detail?: string
  hitRole?: string
  hitName?: string
  ms?: number
  ts: number
  changedScreen?: boolean
}

export interface ComputerStuckState {
  kind: string
  x?: number
  y?: number
  repeats: number
  since: number
}

export type ComputerControlAction =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'takeover'
  | 'return'
  | 'minimize_studio'
  | 'restore_studio'

export interface ComputerState {
  status: ComputerAgentStatus
  thought: string
  stats: ComputerStats
  plan: ComputerPlanStep[]
  lastAction: ComputerActionTrace | null
  lastActions: ComputerActionTrace[]
  cursor: { x: number; y: number; nx: number; ny: number }
  screenWidth: number
  screenHeight: number
  logicalWidth: number
  logicalHeight: number
  activeWindowTitle: string
  activeWindowProcess: string
  studioMinimized: boolean
  stuck: ComputerStuckState | null
  errorMessage?: string
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
  seq?: number
  boundsEpoch?: number
}

export interface LoadedSession {
  session: SessionInfo
  project: ProjectInfo | null
  items: ChatItem[]
  plan: TodoItem[]
  needsResume: boolean
}

export interface FileNode {
  name: string
  path: string
  dir: boolean
  children?: FileNode[]
}

export interface ProcInfo {
  id: string
  name: string
  command: string
  running: boolean
  exitCode: number | null
}
