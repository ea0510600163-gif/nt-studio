export type ResponsesCall = { id: string; name: string; args: string }

import type { LlmUsage } from './types.ts'

export interface ResponsesState {
  text: string
  calls: Map<number, ResponsesCall>
  usage: LlmUsage
  done: boolean
  maxTokens: boolean
  error?: string
  retryable?: boolean
  thinking: string
}

const RETRYABLE = /overload|rate|busy|timeout|temporar|unavailable/i

export function newResponsesState(): ResponsesState {
  return { text: '', calls: new Map(), usage: { input: 0, output: 0 }, done: false, maxTokens: false, thinking: '' }
}

function setError(st: ResponsesState, msg: unknown): void {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg)
  st.error = `خطأ من المزود: ${s}`
  st.retryable = RETRYABLE.test(s)
}

export function reduceResponses(st: ResponsesState, j: any, onText: (s: string) => void, onThinking?: (s: string) => void): void {
  const type = j?.type
  if (type === 'error') {
    setError(st, j.message ?? j.error?.message ?? j.error ?? 'خطأ غير معروف')
    return
  }
  if (type === 'response.output_text.delta') {
    if (typeof j.delta === 'string' && j.delta) {
      st.text += j.delta
      onText(j.delta)
    }
    return
  }
  if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
    if (typeof j.delta === 'string' && j.delta) {
      st.thinking += j.delta
      onThinking?.(j.delta)
    }
    return
  }
  if (type === 'response.output_item.added') {
    if (j.item?.type === 'function_call') {
      const idx = j.output_index ?? st.calls.size
      st.calls.set(idx, { id: j.item.call_id || j.item.id || '', name: j.item.name || '', args: j.item.arguments || '' })
    }
    return
  }
  if (type === 'response.function_call_arguments.delta') {
    const idx = j.output_index ?? 0
    const cur = st.calls.get(idx) ?? { id: '', name: '', args: '' }
    if (typeof j.delta === 'string') cur.args += j.delta
    st.calls.set(idx, cur)
    return
  }
  if (type === 'response.output_item.done') {
    if (j.item?.type === 'function_call') {
      const idx = j.output_index ?? 0
      const cur = st.calls.get(idx) ?? { id: '', name: '', args: '' }
      st.calls.set(idx, { id: j.item.call_id || j.item.id || cur.id, name: j.item.name || cur.name, args: j.item.arguments ?? cur.args })
    }
    return
  }
  if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') {
    const r = j.response ?? {}
    if (r.usage) {
      const cached = r.usage.input_tokens_details?.cached_tokens
      st.usage.input = r.usage.input_tokens ?? st.usage.input
      st.usage.output = r.usage.output_tokens ?? st.usage.output
      if (typeof cached === 'number' && cached > 0) {
        st.usage.cachedRead = cached
        st.usage.input = Math.max(0, st.usage.input - cached)
      }
    }
    if (type === 'response.failed') {
      setError(st, r.error?.message ?? r.error ?? 'فشل الرد')
      return
    }
    if (type === 'response.incomplete' && r.incomplete_details?.reason === 'max_output_tokens') st.maxTokens = true
    if (Array.isArray(r.output)) {
      if (!st.text)
        for (const it of r.output)
          if (it?.type === 'message' && Array.isArray(it.content))
            for (const p of it.content)
              if (p?.type === 'output_text' && typeof p.text === 'string') {
                st.text += p.text
                onText(p.text)
              }
      if (!st.thinking)
        for (const it of r.output)
          if (it?.type === 'reasoning' && Array.isArray(it.summary))
            for (const s of it.summary)
              if (s?.type === 'summary_text' && typeof s.text === 'string') {
                st.thinking += s.text
                onThinking?.(s.text)
              }
      let k = 0
      for (const it of r.output) {
        if (it?.type === 'function_call') {
          const id = it.call_id || it.id || ''
          if (![...st.calls.values()].some((c) => c.id && c.id === id)) st.calls.set(1000 + k, { id, name: it.name || '', args: it.arguments || '' })
        }
        k++
      }
    }
    st.done = true
  }
}
