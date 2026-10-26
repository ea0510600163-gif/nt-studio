import type { ResolvedTarget } from '../store/providers'

export interface ImageData {
  mediaType: string
  data: string
}

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; images?: ImageData[] }
  | { type: 'image'; mediaType: string; data: string }

export interface Msg {
  role: 'user' | 'assistant'
  content: Block[]
  at?: number
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LlmRequest {
  system: string
  messages: Msg[]
  tools: ToolSchema[]
  target: ResolvedTarget
  signal: AbortSignal
  maxTokens: number
  sessionId?: string
  idleMs?: number
  connectMs?: number
}

export interface LlmUsage {
  input: number
  output: number
  cachedRead?: number
  cacheWrite?: number
}

export interface LlmResult {
  content: Block[]
  stop: 'end' | 'tool_use' | 'max_tokens'
  truncated: boolean
  usage: LlmUsage
}

export interface LlmHandlers {
  onText(delta: string): void
  onThinking(delta: string): void
}

export type LlmErrorKind = 'context' | 'auth' | 'other'

export class LlmError extends Error {
  status?: number
  retryable: boolean
  retryAfterMs?: number
  kind: LlmErrorKind
  constructor(
    message: string,
    status?: number,
    retryable = false,
    retryAfterMs?: number,
    kind: LlmErrorKind = 'other'
  ) {
    super(message)
    this.name = 'LlmError'
    this.status = status
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
    this.kind = kind
  }
}
