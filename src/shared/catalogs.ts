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

const m = (
  id: string,
  contextWindow: number,
  maxOutput: number,
  opts: { tools?: boolean; vision?: boolean; apiStyle?: ApiStyle; cost?: ModelInfo['cost'] } = {}
): ModelInfo => ({
  id,
  tools: opts.tools ?? true,
  vision: opts.vision ?? false,
  contextWindow,
  apiStyle: opts.apiStyle ?? O,
  maxOutput,
  cost: opts.cost
})

export const OPENCODE_GO: Catalog = {
  name: 'OpenCode Go',
  baseUrl: OPENCODE_GO_BASE_URL,
  apiStyle: 'openai',
  opencode: true,
  models: [
    m('beam-free', 1_048_576, 131_072, { cost: { input: 0, output: 0, cacheRead: 0 } }),
    m('deepseek-v4.1-flash', 1_000_000, 384_000, { vision: true, cost: { input: 0.15, output: 0.6, cacheRead: 0.003 } }),
    m('deepseek-v4-pro', 1_000_000, 384_000, { cost: { input: 0.66, output: 1.98, cacheRead: 0.022 } }),
    m('gemini-4-argon', 1_048_576, 65_536, { vision: true, cost: { input: 2, output: 10, cacheRead: 0.1 } }),
    m('glm-5.2', 1_000_000, 131_072, { cost: { input: 1.4, output: 4.4, cacheRead: 0.26 } }),
    m('glm-5.3', 1_000_000, 131_072, { cost: { input: 1.4, output: 4.4, cacheRead: 0.26 } }),
    m('glm-5.3-flash', 1_000_000, 131_072, { vision: true, cost: { input: 0.15, output: 0.5, cacheRead: 0.03 } }),
    m('gpt-5.6-luna', 1_050_000, 128_000, { vision: true, apiStyle: R, cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 } }),
    m('gpt-6-luna', 1_050_000, 128_000, { vision: true, apiStyle: R, cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } }),
    m('claude-haiku-5-5', 1_000_000, 128_000, { vision: true, apiStyle: A, cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } }),
    m('hy3', 256_000, 128_000, { cost: { input: 0.14, output: 0.58, cacheRead: 0.035 } }),
    m('hy4-preview', 1_024_000, 64_000, { cost: { input: 0.834, output: 2.501, cacheRead: 0.042 } }),
    m('kimi-k2.7-code', 262_144, 262_144, { vision: true, cost: { input: 0.95, output: 4, cacheRead: 0.19 } }),
    m('kimi-k3', 1_048_576, 131_072, { vision: true, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 } }),
    m('kimi-k3.1-pro', 1_048_576, 131_072, { vision: true, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2 } }),
    m('longcat-2.0', 1_000_000, 131_072, { cost: { input: 0.3, output: 1.2, cacheRead: 0.006 } }),
    m('mimo-v2.5', 1_000_000, 128_000, { vision: true, cost: { input: 0.14, output: 0.28, cacheRead: 0.0028 } }),
    m('mimo-v2.5-pro', 1_048_576, 128_000, { cost: { input: 0.435, output: 0.87, cacheRead: 0.003625 } }),
    m('mimo-v2.6-flash', 1_048_576, 131_072, { vision: true, cost: { input: 0.14, output: 0.28, cacheRead: 0.0028 } }),
    m('mimo-v2.6-pro', 1_048_576, 131_072, { vision: true, cost: { input: 0.435, output: 0.87, cacheRead: 0.003625 } }),
    m('minimax-m3', 1_000_000, 131_072, { vision: true, apiStyle: A, cost: { input: 0.3, output: 1.2, cacheRead: 0.06 } }),
    m('minimax-m3.1-flash', 1_000_000, 512_000, { vision: true, cost: { input: 0.15, output: 0.6, cacheRead: 0.015 } }),
    m('muse-spark-1.2-contributor', 1_048_576, 131_072, { vision: true, apiStyle: R, cost: { input: 0.1, output: 0.2, cacheRead: 0.002 } }),
    m('muse-spark-1.3-contributor', 1_048_576, 131_072, { vision: true, apiStyle: R, cost: { input: 0.1, output: 0.2, cacheRead: 0.002 } }),
    m('qwen3.7-plus', 1_000_000, 65_536, { vision: true, apiStyle: A, cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 } }),
    m('qwen3.8-flash', 1_000_000, 131_072, { vision: true, apiStyle: A, cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 } }),
    m('qwen3.8-max', 1_000_000, 131_072, { vision: true, apiStyle: A, cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 } }),
    m('grok-4.7', 500_000, 500_000, { vision: true, apiStyle: R, cost: { input: 2, output: 6, cacheRead: 0.5 } }),
    m('step-5-preview', 1_000_000, 65_536, { vision: true, cost: { input: 1, output: 2.7, cacheRead: 0.1 } })
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
    if (model.cost) {
      for (const [k, v] of [['input', model.cost.input], ['output', model.cost.output]] as const)
        if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) out.push(`${model.id}: سعر ${k} غير صالح (${String(v)})`)
      if (model.cost.cacheRead !== undefined && !(model.cost.cacheRead >= 0)) out.push(`${model.id}: سعر قراءة الكاش غير صالح (${String(model.cost.cacheRead)})`)
      if (model.cost.cacheWrite !== undefined && !(model.cost.cacheWrite >= 0)) out.push(`${model.id}: سعر كتابة الكاش غير صالح (${String(model.cost.cacheWrite)})`)
    }
  }
  for (const [id, n] of counts) if (n > 1) out.push(`معرّف مكرّر عبر قوائم الأنماط: ${id} (${n} مرات)`)
  return out
}
