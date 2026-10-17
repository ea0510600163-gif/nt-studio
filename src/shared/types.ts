// أنواع مشتركة بين Main وPreload وRenderer

export type ApiStyle = 'openai' | 'anthropic' | 'responses'

export interface ModelInfo {
  id: string
  tools: boolean // يدعم استدعاء الأدوات الأصلي
  vision: boolean // يدعم الصور
  contextWindow: number // بالـ tokens
  apiStyle?: ApiStyle // مسار هذا النموذج (يتجاوز نمط المزوّد) — مثل OpenCode Go
  /** أقصى إخراج للرد (tokens) — من models.dev؛ يولّد ميزانية كتابة واقعية */
  maxOutput?: number
}

export interface ProviderPublic {
  id: string
  name: string
  baseUrl: string
  apiStyle: ApiStyle
  models: ModelInfo[]
  hasKey: boolean
  opencode?: boolean // مزوّد OpenCode: يرسل ترويسة x-opencode-session + User-Agent
}

export interface ProviderInput {
  id?: string
  name: string
  baseUrl: string
  apiKey?: string // اتركه فارغاً عند التعديل للإبقاء على المفتاح الحالي
  apiStyle: ApiStyle
  models: ModelInfo[]
  opencode?: boolean
}

export interface ModelRef {
  providerId: string
  modelId: string
}

export interface Settings {
  workspaceRoot: string
  maxSteps: number
  commandTimeoutSec: number
  maxOutputTokens: number
  compactAtPercent: number
  approvalMode: boolean
  defaultModel: ModelRef | null
  fallbackModel: ModelRef | null
  /** توجيه حر من المستخدم يُلحق بذيل تعليمات النظام (شخصية/تخصص/أسلوب الوكيل) */
  persona?: string
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
}

export type TodoStatus = 'pending' | 'doing' | 'done' | 'blocked'
export interface TodoItem {
  id: string
  text: string
  status: TodoStatus
}

export type Phase = 'idle' | 'thinking' | 'acting' | 'testing' | 'compacting' | 'waiting' | 'retrying'

/** ديف ملف حقيقي من الأداة — يُعرض أخضر/أحمر كاملاً في الواجهة */
export interface FileDiff {
  path: string
  kind: 'create' | 'modify' | 'append' | 'delete'
  before: string
  after: string
  added: number
  removed: number
}

/** صورة مرفقة من المستخدم في رسالة (base64) */
export interface ImageAttachment {
  mediaType: string // image/png | image/jpeg | image/webp | image/gif
  data: string // base64 بلا بادئة
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; images?: string[]; step?: number }
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
      /** مفتاح المهمة التي تنتمي إليها (t0/t1… أو __boot) */
      task?: string
      taskText?: string
      /** ديف حقيقي من الأداة (حيّ فقط) */
      diff?: FileDiff
      step?: number
    }
  | { kind: 'notice'; id: string; level: 'info' | 'warn' | 'error'; text: string; task?: string; taskText?: string; step?: number }
  | { kind: 'ask'; id: string; question: string; options?: string[]; answered?: string; step?: number }

/** كل حدث يصل من العملية الرئيسية يحمل __seq تصاعدياً؛ الواجهة تتجاهل المكرر/المتأخر */
export type AgentEvent =
  | { t: 'status'; sessionId: string; phase: Phase; label?: string; __seq?: number }
  | { t: 'text_delta'; sessionId: string; text: string; __seq?: number }
  | { t: 'text_reset'; sessionId: string; __seq?: number }
  /** بدأ النموذج دوراً جديداً: بطاقة تفكير حيّة تظهر فوراً (حتى قبل أوّل دلتا تفكير) */
  | { t: 'thinking_start'; sessionId: string; id: string; __seq?: number }
  | { t: 'thinking_delta'; sessionId: string; id: string; text: string; __seq?: number }
  | { t: 'thinking_reset'; sessionId: string; __seq?: number }
  | { t: 'assistant_done'; sessionId: string; __seq?: number }
  | { t: 'tool_start'; sessionId: string; callId: string; name: string; input: unknown; __seq?: number }
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
  /** جيل مستند الواجهة؛ يمنع قبول حدود قديمة بعد إعادة تحميل النافذة. */
  boundsEpoch: number
}

/**
 * حدود حاوية المعاينة كما تراها الواجهة، مقيسة من نافذة التطبيق نفسها.
 * `seq` يجعل الأحدث يفوز عند وصول تحديثات ResizeObserver بترتيب معكوس.
 */
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
