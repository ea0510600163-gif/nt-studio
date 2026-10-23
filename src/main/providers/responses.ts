import { uid } from '../util.ts'
import { opencodeHeaders } from './opencode/headers.ts'
import { parseArgs, postSse } from './transport.ts'
import { type Block, type ImageData, LlmError, type LlmResult, type LlmRequest, type Msg } from './types.ts'
import { newResponsesState, reduceResponses } from './responsesParse.ts'

function imageUrl(im: ImageData): string {
  return `data:${im.mediaType};base64,${im.data}`
}

function toResponsesInput(msgs: Msg[], vision: boolean): any[] {
  const out: any[] = []
  for (const m of msgs) {
    if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'text' && b.text.trim()) out.push({ role: 'assistant', content: [{ type: 'output_text', text: b.text }] })
        else if (b.type === 'tool_use') out.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })
      }
      continue
    }
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        out.push({ type: 'function_call_output', call_id: b.tool_use_id, output: b.content || '(لا مخرجات)' })
        if (vision && b.images?.length) out.push({ role: 'user', content: b.images.map((im) => ({ type: 'input_image', image_url: imageUrl(im) })) })
      } else if (b.type === 'text' && b.text.trim()) {
        out.push({ role: 'user', content: [{ type: 'input_text', text: b.text }] })
      } else if (b.type === 'image' && vision) {
        out.push({ role: 'user', content: [{ type: 'input_image', image_url: imageUrl(b) }] })
      }
    }
  }
  return out
}

export async function responses(req: LlmRequest, onText: (s: string) => void, onThinking: (s: string) => void, vision: boolean, native: boolean): Promise<LlmResult> {
  const { provider, model } = req.target
  const url = provider.baseUrl.replace(/\/+$/, '') + '/responses'
  const headers: Record<string, string> = {
    ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
    ...opencodeHeaders(provider.opencode, req.sessionId)
  }
  const body: any = {
    model: model.id,
    instructions: req.system,
    input: toResponsesInput(req.messages, vision),
    stream: true,
    max_output_tokens: req.maxTokens
  }
  if (native) body.tools = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema }))

  const st = newResponsesState()
  await postSse(url, headers, body, req.signal, (data) => {
    let j: any
    try { j = JSON.parse(data) } catch { return }
    reduceResponses(st, j, onText, onThinking)
    if (st.error) throw new LlmError(st.error, undefined, !!st.retryable)
  }, req.idleMs, req.connectMs)

  if (!st.done) throw new LlmError('انقطع البث قبل اكتمال الرد', undefined, true)
  const content: Block[] = []
  if (st.thinking.trim()) content.push({ type: 'thinking', text: st.thinking })
  if (st.text) content.push({ type: 'text', text: st.text })
  for (const [, c] of [...st.calls.entries()].sort((a, b) => a[0] - b[0])) {
    if (!c.name) continue
    content.push({ type: 'tool_use', id: c.id || uid('call_'), name: c.name, input: parseArgs(c.args) })
  }
  const hasCalls = content.some((b) => b.type === 'tool_use')
  const brokenArgs = content.some((b) => b.type === 'tool_use' && b.input?.__parse_error)
  const truncated = st.maxTokens || brokenArgs
  return { content, stop: truncated ? 'max_tokens' : hasCalls ? 'tool_use' : 'end', truncated, usage: st.usage }
}
