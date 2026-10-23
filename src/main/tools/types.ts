import type { FileDiff, ModelInfo, Phase, ProjectInfo, Settings, TodoItem } from '@shared/types'
import type { ImageData } from '../providers/types'

export interface ToolResult {
  content: string
  isError?: boolean
  images?: ImageData[]
  diff?: FileDiff
}

export interface ToolContext {
  sessionId: string
  callId?: string
  signal: AbortSignal
  vision: boolean
  project(): ProjectInfo | null
  cwd(): string
  model(): ModelInfo
  bind(p: ProjectInfo): void
  ask(question: string, options?: string[]): Promise<string>
  plan(): TodoItem[]
  setPlan(items: TodoItem[]): void
  setPhase(p: Phase, label?: string): void
  settings(): Settings
}

export interface Tool {
  name: string
  description: string
  schema: Record<string, unknown>
  parallel?: boolean
  needsProject?: boolean
  phase?: Phase
  run(input: any, ctx: ToolContext): Promise<ToolResult>
}

export const ok = (content: string, images?: ImageData[], diff?: FileDiff): ToolResult => ({ content, images, diff })
export const fail = (content: string): ToolResult => ({ content, isError: true })

type Prop = { type: string; description?: string; enum?: string[]; items?: unknown; properties?: unknown }

export function schema(props: Record<string, Prop>, required: string[] = []) {
  return { type: 'object', properties: props, required, additionalProperties: false }
}

interface SchemaProp {
  type?: string | string[]
  description?: string
  enum?: unknown[]
  items?: unknown
  properties?: Record<string, unknown>
}

const propType = (p: SchemaProp | undefined): string => {
  const t = p?.type
  return Array.isArray(t) ? t.join('|') : (t ?? 'any')
}

function exampleValue(p: unknown, depth = 0): unknown {
  if (depth > 3) return '…'
  const sp = (p ?? {}) as SchemaProp
  const t = Array.isArray(sp.type) ? sp.type[0] : sp.type
  if (t === 'array') {
    const el = sp.items ? exampleValue(sp.items, depth + 1) : ''
    return el === '' ? [] : [el]
  }
  if (t === 'object' || (sp.properties && !t)) {
    const props = (sp.properties ?? {}) as Record<string, unknown>
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, exampleValue(v, depth + 1)]))
  }
  if (t === 'number') return 0
  if (t === 'boolean') return false
  if (Array.isArray(sp.enum) && sp.enum.length) return sp.enum[0]
  return '<نص>'
}

export function toolValidationError(tool: Pick<Tool, 'name' | 'schema'>, input: unknown): string | null {
  const s = tool.schema as { required?: string[]; properties?: Record<string, unknown> }
  const required = Array.isArray(s.required) ? s.required : []
  const src = (input ?? {}) as Record<string, unknown>
  const missing = required.filter((k) => src[k] === undefined || src[k] === null)
  if (!missing.length) return null
  const props = (s.properties ?? {}) as Record<string, SchemaProp>
  const detail = missing.map((k) => {
    const desc = props[k]?.description ? ` — ${String(props[k]?.description).split('\n')[0]}` : ''
    return `- ${k}: ${propType(props[k])}${desc}`
  })
  const example = Object.fromEntries(missing.map((k) => [k, exampleValue(props[k])]))
  return [
    `نداء ناقص: الأداة «${tool.name}» تتطلّب هذه المعطيات:`,
    ...detail,
    `أعد النداء فوراً بهذا الشكل: {"name":"${tool.name}","arguments":${JSON.stringify(example)}}`,
    'لا تُعد إرسال النداء نفسه بلا هذه المفاتيح.'
  ].join('\n')
}
