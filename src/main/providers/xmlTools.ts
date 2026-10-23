import type { Block, Msg, ToolSchema } from './types'

export function xmlToolsPrompt(tools: ToolSchema[]): string {
  const lines = tools.map((t) => {
    const props = ((t.input_schema as any).properties ?? {}) as Record<string, { type?: string }>
    const req = new Set(((t.input_schema as any).required ?? []) as string[])
    const sig = Object.entries(props)
      .map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${Array.isArray(v.type) ? v.type.join('|') : (v.type ?? 'any')}`)
      .join(', ')
    return `- ${t.name}(${sig}) — ${t.description.split('\n')[0]}`
  })
  return `

## TOOL CALLING PROTOCOL (text mode)
This model has no native tool API. To use a tool, write one or more blocks EXACTLY like this at the END of your message, then stop:
<tool_call>{"name":"tool_name","arguments":{"param":"value"}}</tool_call>
Rules: valid JSON only (escape newlines as \\n inside strings); several independent blocks per message are allowed and run in parallel; after your message the app runs them and replies with <tool_result name="..." id="...">...</tool_result> blocks. Never invent results. When the task is fully done and verified, answer in plain text with NO tool_call block.

Available tools:
${lines.join('\n')}`
}

export function encodeMessagesXml(msgs: Msg[]): Msg[] {
  const names = new Map<string, string>()
  return msgs.map((m) => {
    const parts: string[] = []
    const images: Block[] = []
    for (const b of m.content) {
      if (b.type === 'text') parts.push(b.text)
      else if (b.type === 'tool_use') {
        names.set(b.id, b.name)
        parts.push(`<tool_call>${JSON.stringify({ name: b.name, arguments: b.input })}</tool_call>`)
      } else if (b.type === 'tool_result') {
        parts.push(`<tool_result name="${names.get(b.tool_use_id) ?? 'tool'}" id="${b.tool_use_id}"${b.is_error ? ' error="true"' : ''}>\n${b.content}\n</tool_result>`)
        for (const im of b.images ?? []) images.push({ type: 'image', mediaType: im.mediaType, data: im.data })
      } else images.push(b)
    }
    return { role: m.role, content: [{ type: 'text', text: parts.join('\n') || '(فارغ)' }, ...images] }
  })
}

export interface ParsedXml {
  text: string
  calls: { name: string; input: any }[]
  errors: string[]
}

export function parseXmlCalls(raw: string): ParsedXml {
  const calls: ParsedXml['calls'] = []
  const errors: string[] = []
  const re = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const body = m[1].replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    try {
      const j = JSON.parse(body)
      const name = j.name ?? j.tool
      if (!name) throw new Error('missing name')
      calls.push({ name, input: j.arguments ?? j.input ?? j.args ?? {} })
    } catch (e) {
      errors.push(`tool_call غير صالح (${(e as Error).message}): ${body.slice(0, 160)}`)
    }
    if (m[0] === '' || re.lastIndex >= raw.length) break
  }
  const text = raw.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, '').trim()
  return { text, calls, errors }
}
