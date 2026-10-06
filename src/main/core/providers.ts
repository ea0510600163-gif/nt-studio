import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'
import { decryptSecret, encryptSecret } from './secrets'
import type { AppContext } from './context'
import {
  PROTOCOL_LABELS,
  providerInputSchema,
  toPublic,
  type ProviderPublic,
  type ProviderRecord,
  type TestResult,
} from '../../shared/providers'

const log = (ctx: AppContext) => ctx.root.child('providers')

/* -------------------------------------------------------------------------- */
/* URL normalization                                                          */
/* -------------------------------------------------------------------------- */

/** Endpoint suffixes stripped when the user pastes a full endpoint URL. */
const ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/completions',
  '/responses',
  '/messages',
  '/models',
  '/embeddings',
]

/**
 * Converts any input into a valid API root.
 * Accepts: example.com - http://localhost:11434/v1 - url/v1/chat/completions
 */
export function normalizeBaseUrl(raw: string, protocol: ProviderRecord['protocol']): string {
  let url = String(raw ?? '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  url = url.replace(/\/+$/, '')

  const lower = url.toLowerCase()
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      url = url.slice(0, url.length - suffix.length).replace(/\/+$/, '')
      break
    }
  }
  url = url.replace(/\/(v\d+(beta\d*)?)$/i, '')

  if (protocol === 'anthropic') return `${url}/v1`
  if (protocol === 'google') return `${url}/v1beta`
  return url.endsWith('/v1') ? url : `${url}/v1`
}

function headersFor(protocol: ProviderRecord['protocol'], apiKey: string): Record<string, string> {
  if (protocol === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  if (protocol === 'google') return { 'content-type': 'application/json' }
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  }
}

function withQuery(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`
}

/* -------------------------------------------------------------------------- */
/* Model listing (fast path, no AI SDK)                                       */
/* -------------------------------------------------------------------------- */

export async function fetchModels(
  baseUrl: string,
  protocol: ProviderRecord['protocol'],
  apiKey: string,
): Promise<string[]> {
  const base = normalizeBaseUrl(baseUrl, protocol)
  let url = `${base}/models`
  if (protocol === 'google') url = withQuery(url, 'key', apiKey)
  if (protocol === 'anthropic') url = `${url}?limit=1000`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, { headers: headersFor(protocol, apiKey), signal: controller.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(extractError(text, res.status))
    return parseModels(text, protocol)
  } finally {
    clearTimeout(timer)
  }
}

export function parseModels(raw: string, protocol: ProviderRecord['protocol']): string[] {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return []
  }
  const items: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown[] })?.data)
      ? (json as { data: unknown[] }).data
      : Array.isArray((json as { models?: unknown[] })?.models)
        ? (json as { models: unknown[] }).models
        : []

  const out: string[] = []
  for (const item of items) {
    let name: string | undefined
    if (typeof item === 'string') name = item
    else if (item && typeof item === 'object') {
      const rec = item as { id?: unknown; name?: unknown }
      if (typeof rec.id === 'string') name = rec.id
      else if (typeof rec.name === 'string') name = rec.name
    }
    if (!name) continue
    const clean = protocol === 'google' ? name.replace(/^models\//, '') : name
    if (clean && !out.includes(clean)) out.push(clean)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

export function extractError(raw: string, status?: number): string {
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: unknown } | string
      message?: unknown
      detail?: unknown
    }
    if (typeof j.error === 'string') return j.error
    if (j.error && typeof j.error === 'object' && typeof j.error.message === 'string') return j.error.message
    if (typeof j.message === 'string') return j.message
    if (typeof j.detail === 'string') return j.detail
  } catch {
    /* not JSON */
  }
  const trimmed = raw.trim()
  return status
    ? `HTTP ${status}: ${trimmed.slice(0, 300) || 'no details'}`
    : trimmed.slice(0, 300) || 'failed without a message'
}

/* -------------------------------------------------------------------------- */
/* Connection probe through AI SDK                                            */
/* -------------------------------------------------------------------------- */

export function buildModel(record: ProviderRecord, apiKey: string, modelId: string): LanguageModel {
  const baseURL = normalizeBaseUrl(record.baseUrl, record.protocol)
  if (record.protocol === 'anthropic') {
    return createAnthropic({ baseURL, apiKey })(modelId)
  }
  if (record.protocol === 'google') {
    return createGoogleGenerativeAI({ baseURL, apiKey: apiKey || undefined })(modelId)
  }
  return createOpenAICompatible({
    name: record.name || 'openai-compatible',
    baseURL,
    apiKey: apiKey || 'not-needed',
  })(modelId)
}

export interface ProbeInput {
  baseUrl: string
  protocol: ProviderRecord['protocol']
  name: string
  apiKey: string
  models: string[]
}

export async function probeConnection(input: ProbeInput): Promise<TestResult> {
  const model = input.models[0]
  if (!model) {
    return {
      ok: false,
      status: null,
      latencyMs: 0,
      message: 'Add at least one model name before testing',
      modelsFound: 0,
    }
  }
  const record: ProviderRecord = {
    id: 'probe',
    name: input.name || 'probe',
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    apiKeyEnc: '',
    models: input.models,
    note: '',
    createdAt: 0,
    lastTestedAt: null,
    lastTestOk: null,
    lastLatencyMs: null,
  }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const result = await generateText({
      model: buildModel(record, input.apiKey, model),
      prompt: 'ping',
      maxOutputTokens: 16,
      abortSignal: controller.signal,
    })
    const latencyMs = Date.now() - started
    const text = typeof result.text === 'string' ? result.text.trim().slice(0, 60) : ''
    return {
      ok: true,
      status: 200,
      latencyMs,
      message: `Connected via ${PROTOCOL_LABELS[input.protocol].title} - model ${model}${text ? ` - replied: ${text}` : ''}`,
      modelsFound: input.models.length,
    }
  } catch (e) {
    const latencyMs = Date.now() - started
    const err = e as { message?: string; statusCode?: number; cause?: { message?: string } }
    const message = err.cause?.message ?? err.message ?? String(e)
    return {
      ok: false,
      status: typeof err.statusCode === 'number' ? err.statusCode : null,
      latencyMs,
      message: message.slice(0, 400),
      modelsFound: 0,
    }
  } finally {
    clearTimeout(timer)
  }
}

/* -------------------------------------------------------------------------- */
/* Record management                                                          */
/* -------------------------------------------------------------------------- */

export function listProviders(ctx: AppContext): ProviderPublic[] {
  const records = ctx.state.get().providers as ProviderRecord[]
  return records.map((r) => toPublic(r))
}

export function addProvider(ctx: AppContext, input: unknown): ProviderPublic {
  const parsed = providerInputSchema.parse(input)
  const record: ProviderRecord = {
    id: crypto.randomUUID(),
    name: parsed.name,
    protocol: parsed.protocol,
    baseUrl: normalizeBaseUrl(parsed.baseUrl, parsed.protocol),
    apiKeyEnc: parsed.apiKey ? encryptSecret(parsed.apiKey) : '',
    models: [...new Set(parsed.models)],
    note: parsed.note,
    createdAt: Date.now(),
    lastTestedAt: null,
    lastTestOk: null,
    lastLatencyMs: null,
  }
  const records = [...(ctx.state.get().providers as ProviderRecord[]), record]
  ctx.state.patch({ providers: records })
  log(ctx).info(`provider added "${record.name}" (${record.protocol}) models: ${record.models.join(', ') || 'none'}`)
  return toPublic(record)
}

export function updateProvider(
  ctx: AppContext,
  id: string,
  input: unknown,
  apiKeyProvided: boolean,
): ProviderPublic {
  const records = [...(ctx.state.get().providers as ProviderRecord[])]
  const index = records.findIndex((r) => r.id === id)
  if (index === -1) throw new Error('Provider not found')
  const current = records[index]
  if (!current) throw new Error('Provider not found')

  const parsed = providerInputSchema.parse(input)
  const next: ProviderRecord = {
    ...current,
    name: parsed.name,
    protocol: parsed.protocol,
    baseUrl: normalizeBaseUrl(parsed.baseUrl, parsed.protocol),
    apiKeyEnc: apiKeyProvided ? (parsed.apiKey ? encryptSecret(parsed.apiKey) : '') : current.apiKeyEnc,
    models: [...new Set(parsed.models)],
    note: parsed.note,
  }
  records[index] = next
  ctx.state.patch({ providers: records })
  return toPublic(next)
}

export function removeProvider(ctx: AppContext, id: string): void {
  const records = ctx.state.get().providers as ProviderRecord[]
  ctx.state.patch({ providers: records.filter((r) => r.id !== id) })
  if (ctx.state.get().activeProviderId === id) {
    ctx.state.patch({ activeProviderId: null, activeModel: null })
  }
}

export function decryptKeyOf(ctx: AppContext, record: ProviderRecord): string {
  if (!record.apiKeyEnc) return ''
  try {
    return decryptSecret(record.apiKeyEnc)
  } catch (e) {
    log(ctx).error(`could not decrypt key for "${record.name}"`, e)
    throw new Error('Stored key cannot be decrypted - re-enter it in the providers screen')
  }
}

export function recordTest(ctx: AppContext, id: string, result: TestResult): void {
  const records = [...(ctx.state.get().providers as ProviderRecord[])]
  const index = records.findIndex((r) => r.id === id)
  if (index === -1) return
  const current = records[index]
  if (!current) return
  records[index] = {
    ...current,
    lastTestedAt: Date.now(),
    lastTestOk: result.ok,
    lastLatencyMs: result.latencyMs,
  }
  ctx.state.patch({ providers: records })
}

export function findProvider(ctx: AppContext, id: string): ProviderRecord | undefined {
  return (ctx.state.get().providers as ProviderRecord[]).find((r) => r.id === id)
}