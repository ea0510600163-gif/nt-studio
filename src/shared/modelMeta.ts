import type { ApiStyle, ModelInfo } from './types'
import { inferModel } from './models.ts'

type Raw = Record<string, unknown>

const rec = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const hasImage = (v: unknown): boolean => list(v).some((x) => typeof x === 'string' && /image/i.test(x))
const hasCap = (v: unknown, name: string): boolean => list(v).some((x) => typeof x === 'string' && x.toLowerCase() === name)

export function styleFromEndpoint(endpoint: string): ApiStyle | undefined {
  const s = endpoint.toLowerCase()
  if (/anthropic|\/messages/.test(s)) return 'anthropic'
  if (/responses/.test(s)) return 'responses'
  if (/openai|google|gemini|compatible/.test(s)) return 'openai'
  return undefined
}

export function modelId(raw: unknown): string {
  if (typeof raw === 'string') return raw.replace(/^models\//, '').trim()
  const r = rec(raw)
  const id = r.id ?? r.name ?? r.model ?? r.slug
  return typeof id === 'string' ? id.replace(/^models\//, '').trim() : ''
}

export function metaFromItem(raw: unknown): Partial<ModelInfo> {
  const r = rec(raw)
  const limit = rec(r.limit)
  const top = rec(r.top_provider)
  const arch = rec(r.architecture)
  const mods = rec(r.modalities)
  const owner = rec(r.provider)
  const contextWindow =
    num(r.context_window) ?? num(r.context_length) ?? num(limit.context) ?? num(r.max_context_length) ?? num(r.max_input_tokens)
  const maxOutput =
    num(r.max_output_tokens) ?? num(r.max_completion_tokens) ?? num(limit.output) ?? num(top.max_completion_tokens) ?? num(r.max_output)
  const seenImage = hasImage(arch.input_modalities) || hasImage(mods.input) || r.attachment === true
  const vision = hasCap(r.capabilities, 'vision') ? true : seenImage ? true : typeof r.supports_vision === 'boolean' ? r.supports_vision : undefined
  const tools =
    typeof r.tool_call === 'boolean' ? r.tool_call : hasCap(r.capabilities, 'tools') ? true : typeof r.supports_tools === 'boolean' ? r.supports_tools : undefined
  const endpoint = typeof owner.api === 'string' ? owner.api : typeof r.api === 'string' ? r.api : typeof r.npm === 'string' ? r.npm : ''
  const apiStyle = endpoint ? styleFromEndpoint(endpoint) : undefined
  const out: Partial<ModelInfo> = {}
  if (contextWindow) out.contextWindow = contextWindow
  if (maxOutput) out.maxOutput = maxOutput
  if (vision !== undefined) out.vision = vision
  if (tools !== undefined) out.tools = tools
  if (apiStyle) out.apiStyle = apiStyle
  return out
}

export function enrichModel(
  id: string,
  sources: { live?: Partial<ModelInfo>; catalog?: Partial<ModelInfo>; provider?: Partial<ModelInfo> } = {}
): ModelInfo {
  const out: ModelInfo = { ...inferModel(id), id }
  for (const layer of [sources.provider, sources.catalog, sources.live]) {
    if (!layer) continue
    for (const key of Object.keys(layer) as Array<keyof ModelInfo>) {
      if (key === 'id') continue
      const value = layer[key]
      if (value === undefined || value === null) continue
      ;(out as unknown as Record<string, unknown>)[key] = value
    }
  }
  return out
}

export function mergeModelLists(current: ModelInfo[], incoming: ModelInfo[]): ModelInfo[] {
  const live = new Set(incoming.map((m) => m.id))
  const manual = current.filter((m) => m.origin === 'manual' && !live.has(m.id))
  return [...incoming.map((m) => ({ ...m, origin: 'catalog' as const })), ...manual]
}
