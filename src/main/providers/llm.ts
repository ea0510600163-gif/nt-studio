import { errMsg, uid } from '../util.ts'
import { catalogFor } from '../../shared/catalogs.ts'
import { enrichModel, metaFromItem, modelId } from '../../shared/modelMeta.ts'
import type { ApiStyle, ModelInfo } from '../../shared/types.ts'
import { anthropicBlocks, newAnthropicState, reduceAnthropic } from './anthropicParse.ts'
import { devPatches } from './modelDev.ts'
import { opencodeHeaders } from './opencode/headers.ts'
import { responses } from './responses.ts'
import { parseArgs, postSse } from './transport.ts'
import { truncationVerdict } from './truncation.ts'
import {
  type Block,
  type ImageData,
  LlmError,
  type LlmHandlers,
  type LlmRequest,
  type LlmResult,
  type LlmUsage,
  type Msg
} from './types.ts'
import { encodeMessagesXml, parseXmlCalls, xmlToolsPrompt } from './xmlTools.ts'

const completionTokenProviders = new Set<string>()

export async function callLlm(req: LlmRequest, h: LlmHandlers): Promise<LlmResult> {
  const native = req.target.model.tools && req.tools.length > 0
  const onThinking = h.onThinking ?? (() => {})
  const vision = req.target.model.vision
  if (!native) {
    if (!req.tools.length) return dispatchStyle(req, h.onText, onThinking, vision, false)
    return runXml(req, h)
  }
  try {
    return await dispatchStyle(req, h.onText, onThinking, vision, true)
  } catch (e) {
    if (!isNativeToolRejection400(e)) throw e
    return await runXml(req, h)
  }
}

const NATIVE_TOOL_400_RE =
  /unknown function|no such function|function[^.]{0,60}not (found|supported|available)|does? not support[^.]{0,80}tool|tools?[^.]{0,60}not supported|unsupported[^.]{0,60}tool|invalid[^.]{0,60}tool|schema|additional ?propert|function call/i

export function isNativeToolRejection400(e: unknown): boolean {
  return e instanceof LlmError && e.status === 400 && NATIVE_TOOL_400_RE.test(e.message ?? '')
}

function dispatchStyle(
  req: LlmRequest,
  onText: (s: string) => void,
  onThinking: (s: string) => void,
  vision: boolean,
  native: boolean
): Promise<LlmResult> {
  const style = req.target.model.apiStyle ?? req.target.provider.apiStyle
  return style === 'anthropic'
    ? anthropic(req, onText, onThinking, vision, native)
    : style === 'responses'
      ? responses(req, onText, onThinking, vision, native)
      : openai(req, onText, onThinking, vision, native)
}

async function runXml(req: LlmRequest, h: LlmHandlers): Promise<LlmResult> {
  const r: LlmRequest = { ...req }
  r.system = req.system + xmlToolsPrompt(req.tools)
  r.messages = encodeMessagesXml(req.messages)
  const filter = xmlStreamFilter(h.onText)
  const res = await dispatchStyle(r, filter.push, h.onThinking ?? (() => {}), req.target.model.vision, false)
  filter.end()
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const p = parseXmlCalls(text)
  const content: Block[] = []
  const thinking = res.content.find((b) => b.type === 'thinking')
  if (thinking && thinking.type === 'thinking' && thinking.text.trim()) content.push(thinking)
  if (p.text) content.push({ type: 'text', text: p.text })
  for (const c of p.calls) content.push({ type: 'tool_use', id: uid('call_'), name: c.name, input: c.input })
  for (const e of p.errors) content.push({ type: 'tool_use', id: uid('call_'), name: '__invalid_call', input: { __parse_error: e } })
  const hasCalls = content.some((b) => b.type === 'tool_use')
  return {
    content,
    stop: res.truncated ? 'max_tokens' : hasCalls ? 'tool_use' : res.stop === 'tool_use' ? 'end' : res.stop,
    truncated: res.truncated,
    usage: res.usage
  }
}

export function xmlStreamFilter(out: (s: string) => void) {
  const TAG = '<tool_call>'
  let buf = ''
  let seenCall = false
  let callIdx = -1
  let emitted = 0
  return {
    push(d: string) {
      buf += d
      if (seenCall) return
      const i = buf.indexOf('<tool_call')
      if (i >= 0) {
        seenCall = true
        callIdx = i
        if (i > emitted) {
          out(buf.slice(emitted, i))
          emitted = i
        }
        return
      }
      let hold = 0
      for (let k = Math.min(TAG.length - 1, buf.length); k > 0; k--) {
        if (TAG.startsWith(buf.slice(-k))) {
          hold = k
          break
        }
      }
      const emit = buf.slice(emitted, buf.length - hold)
      if (emit) out(emit)
      emitted = buf.length - hold
    },
    end() {
      if (!seenCall) {
        if (emitted < buf.length) out(buf.slice(emitted))
      } else {
        const trailing = parseXmlCalls(buf.slice(callIdx)).text
        if (trailing) out(trailing)
      }
      buf = ''
    }
  }
}

function imagePart(im: ImageData) {
  return { type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.data}` } }
}

export function toOpenAi(system: string, msgs: Msg[], vision: boolean): any[] {
  const out: any[] = [{ role: 'system', content: system }]
  for (const m of msgs) {
    if (m.role === 'assistant') {
      const text = m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      const reasoning = m.content.map((b) => (b.type === 'thinking' ? b.text : '')).join('')
      const calls = m.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
      const msg: any = { role: 'assistant', content: text || (calls.length ? null : '') }
      if (calls.length) {
        msg.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } }))
        if (reasoning) msg.reasoning_content = reasoning
      }
      out.push(msg)
      continue
    }
    const parts: any[] = []
    const imgs: any[] = []
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content || '(لا مخرجات)' })
        if (vision) for (const im of b.images ?? []) imgs.push(imagePart(im))
      } else if (b.type === 'text') parts.push({ type: 'text', text: b.text })
      else if (b.type === 'image' && vision) imgs.push(imagePart(b))
    }
    if (imgs.length && !parts.length) parts.push({ type: 'text', text: '(صورة مرفقة من نتيجة الأداة)' })
    const all = [...parts, ...imgs]
    if (all.length) out.push({ role: 'user', content: all.length === 1 && all[0].type === 'text' ? all[0].text : all })
  }
  return out
}

async function openai(req: LlmRequest, onText: (s: string) => void, onThinking: (s: string) => void, vision: boolean, native: boolean): Promise<LlmResult> {
  const { provider, model } = req.target
  const url = provider.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const headers: Record<string, string> = {
    ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
    ...opencodeHeaders(provider.opencode, req.sessionId)
  }
  const build = (useCompletion: boolean) => {
    const body: any = { model: model.id, messages: toOpenAi(req.system, req.messages, vision), stream: true }
    body[useCompletion ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens
    if (native)
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    return body
  }
  let useCompletion = completionTokenProviders.has(provider.id)
  for (let pass = 0; ; pass++) {
    try {
      return await runOpenai(url, headers, build(useCompletion), req.signal, onText, onThinking, req.idleMs, req.connectMs)
    } catch (e) {
      if (pass === 0 && !useCompletion && e instanceof LlmError && e.status === 400 && /max_completion_tokens/.test(e.message)) {
        useCompletion = true
        completionTokenProviders.add(provider.id)
        continue
      }
      throw e
    }
  }
}

async function runOpenai(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, onText: (s: string) => void, onThinking: (s: string) => void, idleMs?: number, connectMs?: number): Promise<LlmResult> {
  let text = ''
  let reasoning = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let finish = ''
  let completed = false
  const usage: LlmUsage = { input: 0, output: 0 }
  await postSse(url, headers, body, signal, (data) => {
    if (data === '[DONE]') {
      completed = true
      return
    }
    let j: any
    try { j = JSON.parse(data) } catch { return }
    if (j.error) {
      const msg = typeof j.error === 'string' ? j.error : (j.error.message ?? JSON.stringify(j.error))
      throw new LlmError(`خطأ من المزود: ${msg}`, undefined, /overload|rate|busy|timeout|temporar|unavailable/i.test(msg))
    }
    if (j.usage) {
      usage.input = j.usage.prompt_tokens ?? usage.input
      usage.output = j.usage.completion_tokens ?? usage.output
      const cached = j.usage.prompt_tokens_details?.cached_tokens
      if (typeof cached === 'number' && cached > 0) usage.cachedRead = Math.max(usage.cachedRead ?? 0, cached)
    }
    const ch = j.choices?.[0]
    if (!ch) return
    const d = ch.delta ?? {}
    if (typeof d.content === 'string' && d.content) {
      text += d.content
      onText(d.content)
    }
    const think = d.reasoning ?? d.reasoning_content
    if (typeof think === 'string' && think) {
      reasoning += think
      onThinking(think)
    }
    for (const tc of d.tool_calls ?? []) {
      const idx = tc.index ?? 0
      const cur = calls.get(idx) ?? { id: '', name: '', args: '' }
      if (tc.id) cur.id = tc.id
      const fn = tc.function ?? {}
      if (fn.name) cur.name = cur.name ? (cur.name === fn.name ? cur.name : cur.name + fn.name) : fn.name
      if (fn.arguments) cur.args += fn.arguments
      calls.set(idx, cur)
    }
    if (ch.finish_reason) {
      finish = ch.finish_reason
      completed = true
    }
  }, idleMs, connectMs)
  if (!completed) throw new LlmError('انقطع البث قبل اكتمال الرد', undefined, true)
  if (usage.cachedRead) usage.input = Math.max(0, usage.input - usage.cachedRead)
  const content: Block[] = []
  if (reasoning.trim()) content.push({ type: 'thinking', text: reasoning })
  if (text) content.push({ type: 'text', text })
  for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    if (!c.name) continue
    const input = parseArgs(c.args)
    content.push({ type: 'tool_use', id: c.id || uid('call_'), name: c.name, input })
  }
  const hasCalls = content.some((b) => b.type === 'tool_use')
  const brokenArgs = content.some((b) => b.type === 'tool_use' && b.input?.__parse_error)
  const bodyBudget = body as { max_completion_tokens?: number; max_tokens?: number } | undefined
  const truncated = truncationVerdict({
    finish,
    usageOutput: usage.output,
    estimatedChars: text.length + reasoning.length,
    maxTokens: bodyBudget?.max_completion_tokens ?? bodyBudget?.max_tokens ?? 0,
    toolArgs: brokenArgs
  })
  return { content, stop: truncated ? 'max_tokens' : hasCalls ? 'tool_use' : 'end', truncated, usage }
}

function anthropicSystemWithCache(system: string): any {
  const splitIdx = system.indexOf('\n\n# ENVIRONMENT')
  if (splitIdx <= 0) return system
  return [
    { type: 'text', text: system.slice(0, splitIdx), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: system.slice(splitIdx) }
  ]
}

export function toAnthropic(msgs: Msg[], vision: boolean): any[] {
  const mapped = msgs.map((m) => {
    const blocks = m.content
      .map((b) => {
        if (b.type === 'text') return b.text.trim() ? { type: 'text', text: b.text } : null
        if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} }
        if (b.type === 'tool_result') {
          const txt = b.content || '(لا مخرجات)'
          const imgs = vision ? (b.images ?? []).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })) : []
          return { type: 'tool_result', tool_use_id: b.tool_use_id, content: imgs.length ? [{ type: 'text', text: txt }, ...imgs] : txt, is_error: !!b.is_error }
        }
        if (b.type === 'thinking') return b.signature ? { type: 'thinking', thinking: b.text, signature: b.signature } : null
        if (b.type === 'image') return vision ? { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } } : null
        return null
      })
      .filter(Boolean) as any[]
    blocks.sort((a, b) => (a.type === 'tool_result' ? 0 : 1) - (b.type === 'tool_result' ? 0 : 1))
    return { role: m.role, content: blocks.length ? blocks : [{ type: 'text', text: '(فارغ)' }] }
  })
  const merged: any[] = []
  for (const m of mapped) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === m.role) {
      prev.content = [...prev.content, ...m.content]
      prev.content.sort((a: any, b: any) => (a.type === 'tool_result' ? 0 : 1) - (b.type === 'tool_result' ? 0 : 1))
    } else {
      merged.push(m)
    }
  }
  return merged
}

async function anthropic(req: LlmRequest, onText: (s: string) => void, onThinking: (s: string) => void, vision: boolean, native: boolean): Promise<LlmResult> {
  const { provider, model } = req.target
  const base = provider.baseUrl.replace(/\/+$/, '')
  const url = /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' }
  if (provider.apiKey) {
    headers['x-api-key'] = provider.apiKey
    headers['authorization'] = `Bearer ${provider.apiKey}`
  }
  Object.assign(headers, opencodeHeaders(provider.opencode, req.sessionId))
  const body: any = { model: model.id, system: anthropicSystemWithCache(req.system), messages: toAnthropic(req.messages, vision), max_tokens: req.maxTokens, stream: true }
  if (native) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))

  const st = newAnthropicState()
  await postSse(url, headers, body, req.signal, (data) => {
    let j: any
    try { j = JSON.parse(data) } catch { return }
    reduceAnthropic(st, j, onText, onThinking)
  }, req.idleMs, req.connectMs)
  if (!st.done) throw new LlmError('انقطع البث قبل اكتمال الرد', undefined, true)
  const content = anthropicBlocks(st)
  const hasCalls = content.some((b) => b.type === 'tool_use')
  const brokenArgs = content.some((b) => b.type === 'tool_use' && b.input?.__parse_error)
  const truncated = st.stopReason === 'max_tokens' || brokenArgs
  return { content, stop: truncated ? 'max_tokens' : hasCalls ? 'tool_use' : 'end', truncated, usage: st.usage }
}

export async function fetchModelList(baseUrl: string, apiKey: string, style: ApiStyle): Promise<ModelInfo[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const url = style === 'anthropic' ? (/\/v1$/.test(base) ? `${base}/models?limit=100` : `${base}/v1/models?limit=100`) : `${base}/models`
  const headers: Record<string, string> = {
    'user-agent': 'NT-Studio/1.0',
    ...(style === 'anthropic'
      ? { 'anthropic-version': '2023-06-01', ...(apiKey ? { 'x-api-key': apiKey, authorization: `Bearer ${apiKey}` } : {}) }
      : apiKey
        ? { authorization: `Bearer ${apiKey}` }
        : {})
  }
  let res: Response
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  } catch (e) {
    let host = url
    try { host = new URL(url).host } catch {}
    throw new Error(`تعذّر جلب قائمة النماذج من ${host} خلال 15 ثانية: ${errMsg(e)}`)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j: any = await res.json()
  const items: unknown[] = j.data ?? j.models ?? []
  const catalog = catalogFor(baseUrl)
  const patches = await devPatches(baseUrl)
  return items
    .map((item) => {
      const id = modelId(item)
      return enrichModel(id, {
        provider: style === 'openai' ? undefined : { apiStyle: style },
        catalog: catalog?.models.find((m) => m.id === id),
        dev: patches.get(id),
        live: metaFromItem(item)
      })
    })
    .filter((m) => m.id)
}
