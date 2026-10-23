import type { ApiStyle, ModelInfo } from './types'

export interface Catalog {
  name: string
  baseUrl: string
  apiStyle: ApiStyle
  opencode?: boolean
  models: ModelInfo[]
}

export const OPENCODE_USER_AGENT = 'NT-Studio/1.0'
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go/v1'
export const CODECRAFT_BASE_URL = 'https://codecraftapi.com/v1'

const O = 'openai' as const
const A = 'anthropic' as const
const R = 'responses' as const

const SUPPORTED_STYLES: ApiStyle[] = ['openai', 'anthropic', 'responses']
const MIN_OUTPUT = 4_000

const m = (id: string, contextWindow: number, maxOutput: number, opts: { tools?: boolean; vision?: boolean; apiStyle?: ApiStyle } = {}): ModelInfo => ({
  id,
  tools: opts.tools ?? true,
  vision: opts.vision ?? false,
  contextWindow,
  apiStyle: opts.apiStyle ?? O,
  maxOutput
})

export const OPENCODE_GO: Catalog = {
  name: 'OpenCode Go',
  baseUrl: OPENCODE_GO_BASE_URL,
  apiStyle: 'openai',
  opencode: true,
  models: [
    m('beam-free', 1_048_576, 131_072),
    m('deepseek-v4.1-flash', 1_000_000, 384_000, { vision: true }),
    m('deepseek-v4-pro', 1_000_000, 384_000),
    m('gemini-4-argon-contributor', 1_048_576, 65_536, { vision: true }),
    m('glm-5.2', 1_000_000, 131_072),
    m('glm-5.3', 1_000_000, 131_072),
    m('glm-5.3-flash', 1_000_000, 131_072, { vision: true }),
    m('hy3', 256_000, 128_000),
    m('hy4-preview', 1_024_000, 64_000),
    m('kimi-k2.7-code', 262_144, 262_144, { vision: true }),
    m('kimi-k3', 1_048_576, 131_072, { vision: true }),
    m('longcat-2.0', 1_000_000, 131_072),
    m('longcat-2.5-preview-free', 1_000_000, 131_072, { vision: true }),
    m('mimo-v2.5', 1_000_000, 128_000, { vision: true }),
    m('mimo-v2.5-pro', 1_048_576, 128_000),
    m('mimo-v2.6-flash', 1_048_576, 131_072, { vision: true }),
    m('mimo-v2.6-pro', 1_048_576, 131_072, { vision: true }),
    m('minimax-m3.1-flash-free', 1_000_000, 512_000, { vision: true }),
    m('step-5-preview', 1_000_000, 65_536, { vision: true }),
    m('claude-haiku-5-5', 1_000_000, 128_000, { vision: true, apiStyle: A }),
    m('minimax-m3', 1_000_000, 131_072, { vision: true, apiStyle: A }),
    m('qwen3.7-plus', 1_000_000, 65_536, { vision: true, apiStyle: A }),
    m('qwen3.8-flash', 1_000_000, 131_072, { vision: true, apiStyle: A }),
    m('qwen3.8-max', 1_000_000, 131_072, { vision: true, apiStyle: A }),
    m('gpt-5.6-luna', 1_050_000, 128_000, { vision: true, apiStyle: R }),
    m('gpt-6-luna', 1_050_000, 128_000, { vision: true, apiStyle: R }),
    m('grok-4.7', 500_000, 500_000, { vision: true, apiStyle: R }),
    m('muse-spark-1.2-contributor', 1_048_576, 131_072, { vision: true, apiStyle: R }),
    m('muse-spark-1.3-contributor', 1_048_576, 131_072, { vision: true, apiStyle: R })
  ]
}

export const CODECRAFT: Catalog = {
  name: 'CodeCraft API',
  baseUrl: CODECRAFT_BASE_URL,
  apiStyle: 'openai',
  models: [
    m('claude-opus-5.5', 1_000_000, 128_000, { vision: true }),
    m('claude-opus-5', 262_144, 64_000, { vision: true }),
    m('claude-opus-4.8', 200_000, 64_000, { vision: true }),
    m('claude-opus-4.7', 200_000, 32_000, { vision: true }),
    m('claude-opus-4.6', 128_000, 64_000, { vision: true }),
    m('claude-sonnet-5', 1_000_000, 128_000, { vision: true }),
    m('claude-fable-5.1', 262_144, 128_000, { vision: true }),
    m('claude-fable-5', 1_000_000, 128_000, { vision: true }),
    m('claude-mythos-preview', 128_000, 64_000, { vision: true }),
    m('gpt-5.5-pro', 1_050_000, 128_000, { vision: true }),
    m('gpt-5.5', 400_000, 128_000, { vision: true }),
    m('gpt-5.6-terra', 372_000, 128_000, { vision: true }),
    m('gpt-5.6-sol', 262_144, 128_000, { vision: true }),
    m('gpt-5.6-luna', 262_144, 128_000, { vision: true }),
    m('gemini-3.1-pro', 1_000_000, 64_000, { vision: true }),
    m('gemini-3.6-flash', 1_000_000, 64_000, { vision: true }),
    m('gemini-3.7-flash', 1_000_000, 64_000, { vision: true }),
    m('deepseek-v4-pro-max', 128_000, 64_000),
    m('deepseek-v4-pro-0813', 1_000_000, 32_768),
    m('deepseek-v4-flash-0731', 256_000, 32_768),
    m('qwen3.8-max', 1_000_000, 131_072, { vision: true }),
    m('qwen3.7-max', 991_000, 64_000),
    m('qwen3.8-27b', 120_000, 32_768, { vision: true }),
    m('glm-5.3', 1_000_000, 131_072),
    m('glm-5.2', 200_000, 16_384),
    m('kimi-k3', 1_000_000, 131_072, { vision: true }),
    m('kimi-k2.6', 200_000, 16_384, { vision: true }),
    m('grok-4.6', 500_000, 32_768, { vision: true }),
    m('grok-4.5', 500_000, 32_768, { vision: true }),
    m('seed-2.1-pro', 128_000, 64_000),
    m('seed-2.1-turbo', 128_000, 64_000),
    m('muse-spark-1.1', 1_000_000, 32_000, { vision: true }),
    m('gemma-2-2b', 8_192, 8_192, { tools: false })
  ]
}

export function catalogFor(baseUrl: string): Catalog | undefined {
  const base = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  return [OPENCODE_GO, CODECRAFT].find((c) => c.baseUrl.replace(/\/+$/, '').toLowerCase() === base)
}

export function catalogIssues(catalog: Catalog): string[] {
  const out: string[] = []
  if (!catalog.name.trim()) out.push('اسم الكتالوج فارغ')
  if (!/^https?:\/\//.test(catalog.baseUrl)) out.push(`baseUrl غير صالح: ${catalog.baseUrl}`)
  if (!SUPPORTED_STYLES.includes(catalog.apiStyle)) out.push(`apiStyle المزوّد غير مدعوم: ${String(catalog.apiStyle)}`)
  const counts = new Map<string, number>()
  for (const model of catalog.models) {
    counts.set(model.id, (counts.get(model.id) ?? 0) + 1)
    const style = model.apiStyle ?? catalog.apiStyle
    if (model.tools && !SUPPORTED_STYLES.includes(style)) out.push(`${model.id}: أدوات مدعومة لكن نمط نداء غير مدعوم (${String(model.apiStyle)})`)
    if (!model.id) out.push('معرّف نموذج فارغ')
    if (typeof model.tools !== 'boolean') out.push(`${model.id}: tools ليست منطقية (${String(model.tools)})`)
    if (typeof model.vision !== 'boolean') out.push(`${model.id}: vision ليست منطقية (${String(model.vision)})`)
    if (!(model.contextWindow > 0)) out.push(`${model.id}: نافذة سياق غير صالحة (${String(model.contextWindow)})`)
    if (!((model.maxOutput ?? 0) >= MIN_OUTPUT)) out.push(`${model.id}: سقف إخراج غير واقعي (${String(model.maxOutput)})`)
  }
  for (const [id, n] of counts) if (n > 1) out.push(`معرّف مكرّر عبر قوائم الأنماط: ${id} (${n} مرات)`)
  return out
}
