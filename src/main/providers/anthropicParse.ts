import { LlmError, type Block } from './types.ts'
import { parseArgs } from './transport.ts'
import { uid } from '../util.ts'

export interface AnthropicState {
  blocks: Map<number, { kind: 'text' | 'tool' | 'thinking'; text: string; id: string; name: string; json: string; signature?: string }>
  stopReason: string
  done: boolean
  usage: { input: number; output: number }
}

export function newAnthropicState(): AnthropicState {
  return { blocks: new Map(), stopReason: '', done: false, usage: { input: 0, output: 0 } }
}

export function reduceAnthropic(st: AnthropicState, j: any, onText: (s: string) => void, onThinking?: (s: string) => void): void {
  switch (j.type) {
    case 'message_start':
      st.usage.input = j.message?.usage?.input_tokens ?? 0
      break
    case 'content_block_start': {
      const cb = j.content_block
      if (cb?.type === 'tool_use') st.blocks.set(j.index, { kind: 'tool', text: '', id: cb.id, name: cb.name, json: '' })
      else if (cb?.type === 'thinking') {
        st.blocks.set(j.index, { kind: 'thinking', text: cb.thinking ?? '', id: '', name: '', json: '' })
        if (cb.thinking) onThinking?.(cb.thinking)
      } else if (cb?.type === 'text') {
        st.blocks.set(j.index, { kind: 'text', text: cb.text ?? '', id: '', name: '', json: '' })
        if (cb.text) onText(cb.text)
      }
      break
    }
    case 'content_block_delta': {
      const b = st.blocks.get(j.index)
      if (!b) break
      if (j.delta?.type === 'text_delta') {
        b.text += j.delta.text
        onText(j.delta.text)
      } else if (j.delta?.type === 'thinking_delta' && typeof j.delta.thinking === 'string' && j.delta.thinking) {
        b.text += j.delta.thinking
        onThinking?.(j.delta.thinking)
      } else if (j.delta?.type === 'signature_delta' && typeof j.delta.signature === 'string') {
        b.signature = j.delta.signature
      } else if (j.delta?.type === 'input_json_delta') b.json += j.delta.partial_json
      break
    }
    case 'message_delta':
      st.stopReason = j.delta?.stop_reason ?? st.stopReason
      st.usage.output = j.usage?.output_tokens ?? st.usage.output
      break
    case 'message_stop':
      st.done = true
      break
    case 'error': {
      const t = j.error?.type ?? ''
      throw new LlmError(`خطأ من المزود: ${j.error?.message ?? t}`, undefined, /overloaded|api_error|rate_limit|timeout/.test(t))
    }
  }
}

export function anthropicBlocks(st: AnthropicState): Block[] {
  const content: Block[] = []
  for (const [, b] of [...st.blocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (b.kind === 'thinking' && b.text.trim()) content.push({ type: 'thinking', text: b.text, ...(b.signature ? { signature: b.signature } : {}) })
    if (b.kind === 'text' && b.text) content.push({ type: 'text', text: b.text })
    if (b.kind === 'tool') content.push({ type: 'tool_use', id: b.id || uid('call_'), name: b.name, input: parseArgs(b.json) })
  }
  return content
}
