import type { Protocol, ProviderInput, ProviderPublic, TestResult } from './providers'

/**
 * عقد الجسر بين عملية Electron الرئيسية وواجهة React.
 *
 * القاعدة الأمنية: الواجهة لا تعرف أي قناة IPC، ولا تبني مسارًا مطلقًا،
 * ولا تمرر أمرًا جاهزًا. كل عملية تُعرَّف هنا كـ"فعل" محدد وقابل للتحقق في
 * العملية الرئيسية. أي إضافة هنا تتطلب معالجًا في src/main/ipc.
 */

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

export interface FetchModelsResult {
  ok: boolean
  models: string[]
  error?: string
}

export interface ProbeInput {
  name: string
  protocol: Protocol
  baseUrl: string
  apiKey: string
  models: string[]
}

/** أحداث التقدّم من محرك الوكيل (مطابقة لـ AgentEvent في العملية الرئيسية). */
export type AgentPhase =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'installing'
  | 'starting'
  | 'inspecting'
  | 'fixing'
  | 'done'
  | 'error'

export interface PlanStep {
  index: number
  title: string
  status: 'pending' | 'active' | 'done' | 'failed'
}

export type AgentEvent =
  | { type: 'status'; phase: AgentPhase; detail?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; callId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; callId: string; name: string; ok: boolean; summary: string; ms: number }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'plan'; steps: PlanStep[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  /**
   * حدث طرفي — يُبثّ مرة واحدة بالضبط على كل مخرج من الحلقة.
   * `summary` و`verified` مطابقة لما في `AgentEvent` داخل `src/main/agent/types.ts`:
   * كان العقد المشترك لا يعلنهما مع أن الحلقة تبثّهما فعلًا، فكان أي مستهلك
   * للواجهة مجبرًا على cast، وأي حقل جديد يُنسى في العقد يختفي عن الأنواع بصمت.
   */
  | { type: 'done'; reason: 'stop' | 'max-steps' | 'aborted' | 'error' | 'needs-input'; summary?: string; verified?: boolean }
  | { type: 'failed'; message: string }

export interface RunInput {
  prompt: string
  providerId: string
  modelId: string
  projectPath: string | null
}

export interface ProjectInfo {
  name: string
  path: string
  createdAt: number
  fileCount: number
  hasPackage: boolean
  lastSummary: string
}

export interface StudioBridge {
  app: {
    info(): Promise<AppInfo>
  }
  providers: {
    list(): Promise<ProviderPublic[]>
    add(input: ProviderInput): Promise<ProviderPublic>
    update(input: ProviderInput & { id: string }): Promise<ProviderPublic>
    remove(id: string): Promise<boolean>
    probe(input: ProbeInput): Promise<TestResult>
    testSaved(id: string): Promise<TestResult>
    fetchModels(input: { baseUrl: string; protocol: Protocol; apiKey: string }): Promise<FetchModelsResult>
    setActive(id: string, model: string): Promise<boolean>
    listProjects(): Promise<ProjectInfo[]>
  }
  agent: {
    run(input: RunInput): Promise<{ ok: boolean; sessionId: string | null; message?: string }>
    stop(): Promise<boolean>
    status(): Promise<{ running: boolean; sessionId: string | null }>
    history(projectPath: string, limit?: number): Promise<Array<Record<string, unknown>>>
    onEvent(cb: (event: AgentEvent) => void): () => void
  }
  preview: {
    /** يُستدعى من الواجهة عند تغيّر عنوان المعاينة. */
    onUrl(cb: (url: string | null) => void): () => void
    open(url: string): Promise<{ ok: boolean; url: string }>
    close(): Promise<boolean>
    status(): Promise<{ url: string | null; hasView: boolean }>
    screenshot(): Promise<{ ok: boolean; dataUrl: string | null; error?: string }>
    consoleErrors(): Promise<Array<{ level: string; text: string; line?: number }>>
    evaluate(expression: string): Promise<{ ok: boolean; value: string | null; error?: string }>
    click(selector: string): Promise<{ ok: boolean; error?: string }>
    typeText(selector: string, text: string): Promise<{ ok: boolean; error?: string }>
    reload(): Promise<boolean>
    setViewport(size: { width: number; height: number } | null): Promise<boolean>
    /** يربط WebContentsView بموضع مستطيل في النافذة (بوحدات CSS). */
    attach(bounds: PreviewBounds): Promise<boolean>
    resize(bounds: PreviewBounds): Promise<boolean>
    openExternal(url: string): Promise<boolean>
  }
}

export interface PreviewBounds {
  x: number
  y: number
  width: number
  height: number
}