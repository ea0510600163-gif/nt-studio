/**
 * اختبار تكامل حقيقي لحلقة الوكيل.
 *
 * لماذا هذا الملف موجود: كل عطب في `loop.ts` كان من نوع «يبدو صحيحًا في
 * الورقة». عيوب هذه الحلقة (prompt لا يُرسل · أداة تُنفَّذ مرتين · مخطط
 * أداة يطيح الـ SDK · رسالة `tool` غير صالحة · `system` وسط الحوار مرفوض)
 * لا يكتشفها أي اختبار وحدة — بل يحتاج خادمًا يتكلم بروتوكول OpenAI-compatible
 * فعلًا ويجيب بنداء أداة حقيقي.
 *
 * كل ما هنا على خادم HTTP محلي: لا شبكة، لا مفتاح، لا Electron.
 */

import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runAgent, type RunResult } from '../src/main/agent/loop'
import { buildToolSet, toolCatalog } from '../src/main/agent/tools/index'
import type { AgentEvent } from '../src/main/agent/types'
import type { AppContext } from '../src/main/core/context'
import type { ProviderRecord } from '../src/shared/providers'

/* ========================================================================== */
/* خادم مزوّد وهمي — يحاكي بوابة OpenAI-compatible                            */
/* ========================================================================== */

interface Capture {
  body: {
    model?: string
    messages?: Array<Record<string, unknown>>
    tools?: Array<Record<string, unknown>>
  }
}

/** سيناريو الخادم — أيّ رد يُرسل في كل دور. */
type Scenario = 'tool-then-text' | 'text-only' | 'unauthorized'

const captures: Capture[] = []
let scenario: Scenario = 'text-only'
let server: Server
let origin = ''

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data))
  })
}

function json(res: ServerResponse<IncomingMessage>, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function completion(content: string, finishReason: string): unknown {
  return {
    id: 'chatcmpl-loop',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-loop-test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
  }
}

function toolCompletion(toolCallId: string, name: string, args: unknown): unknown {
  return {
    id: 'chatcmpl-loop',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-loop-test',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'سأسجّل الحدث أولًا.',
          tool_calls: [{ id: toolCallId, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
  }
}

async function startServer(): Promise<void> {
  server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req)
      let body: Capture['body'] = {}
      try {
        body = JSON.parse(raw) as Capture['body']
      } catch {
        body = {}
      }
      captures.push({ body })

      if ((req.url ?? '').endsWith('/chat/completions')) {
        if (scenario === 'unauthorized') {
          json(res, 401, { error: { message: 'Invalid API key provided', type: 'invalid_request_error' } })
          return
        }
        // الدور الأول: نداء أداة. الدور الثاني وما بعده: نص ختامي.
        if (scenario === 'tool-then-text' && captures.length === 1) {
          json(res, 200, toolCompletion('call_abc', 'append_log', { event: 'بدء الاختبار' }))
          return
        }
        json(res, 200, completion('انتهى العمل.', 'stop'))
        return
      }

      json(res, 404, { error: { message: `مسار غير معروف: ${req.url ?? ''}` } })
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('تعذّر تحديد المنفذ')
  origin = `http://127.0.0.1:${address.port}`
}

async function stopServer(): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

/* ========================================================================== */
/* سياق وهمي + أدوات مساعدة                                                  */
/* ========================================================================== */

const PROVIDER: ProviderRecord = {
  id: 'p-local',
  name: 'local',
  protocol: 'openai-compatible',
  baseUrl: '',
  apiKeyEnc: '',
  models: ['gpt-loop-test'],
  note: '',
  createdAt: 0,
  lastTestedAt: null,
  lastTestOk: null,
  lastLatencyMs: null,
}

/**
 * `runAgent` يقرأ `ctx.state.get().providers` فقط، و `apiKeyEnc: ''` يجعل
 * `decryptKeyOf` يعود فورًا بلا لمس `safeStorage` (غير متاح خارج Electron).
 */
function fakeContext(baseUrl: string): AppContext {
  const providers: ProviderRecord[] = [{ ...PROVIDER, baseUrl }]
  return { state: { get: () => ({ providers }) } } as unknown as AppContext
}

const tempRoots: string[] = []

async function tempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-loop-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  captures.length = 0
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

interface RunOutcome {
  result: RunResult
  events: AgentEvent[]
}

async function runLoop(projectRoot: string | null, signal: AbortSignal): Promise<RunOutcome> {
  const events: AgentEvent[] = []
  const result = await runAgent(fakeContext(origin), {
    providerId: PROVIDER.id,
    modelId: 'gpt-loop-test',
    prompt: 'ابنِ لي تطبيقًا بسيطًا',
    projectRoot,
    sessionId: 's-test',
    maxSteps: 6,
    signal,
    emit: (event) => {
      events.push(event)
    },
  })
  return { result, events }
}

const terminal = (events: AgentEvent[]) => events.filter((e) => e.type === 'done' || e.type === 'failed')

/* ========================================================================== */
/* 0) الأدوات مُعرَّفة بلا execute — التنفيذ يُحدث مرة واحدة فقط              */
/* ========================================================================== */

describe('ToolSet بلا execute', () => {
  it('لا يعرّف أي أداة على أنها منفّذة', () => {
    const set = buildToolSet(toolCatalog())
    expect(Object.keys(set).length).toBeGreaterThan(20)
    for (const [name, tool] of Object.entries(set)) {
      // وجود execute هنا يعني أن الـ SDK سينفّذ الأداة، ثم ينفّذها loop.ts مجددًا.
      expect(`${name}:${String(tool.execute)}`).toBe(`${name}:undefined`)
    }
  })

  it('يغلّف مخطط JSON الخام بـ jsonSchema (لا يمرّره كما هو)', () => {
    const set = buildToolSet(toolCatalog())
    const writeFile = set.write_file
    expect(writeFile).toBeTruthy()

    // الغلاف الرسمي كائن يحمل المخطط في `jsonSchema`؛ المخطط الخام نفسه
    // كان يمرَّر كما هو فيرمي الـ SDK `TypeError: schema is not a function`.
    const wrapped = writeFile?.inputSchema as { jsonSchema?: Record<string, unknown> } | undefined
    expect(typeof wrapped?.jsonSchema).toBe('object')
    expect(String(wrapped?.jsonSchema?.type)).toBe('object')
    expect(Object.keys(wrapped?.jsonSchema?.properties ?? {})).toContain('path')
  })
})

/* ========================================================================== */
/* 1) الطلب يصل فعلًا + الأداة تُنفَّذ مرة واحدة + done(stop)                   */
/* ========================================================================== */

describe('حلقة كاملة ضد خادم محلي', () => {
  it('يرسل طلب المستخدم، وينفّذ الأداة مرة واحدة، ثم ينهي بـ done/stop', async () => {
    await startServer()
    scenario = 'tool-then-text'
    const projectRoot = await tempProject()

    try {
      const { result, events } = await runLoop(projectRoot, AbortSignal.timeout(20_000))

      /* (أ) طلب المستخدم وصل إلى الخادم */
      expect(captures.length).toBe(2)
      const firstMessages = captures[0]?.body.messages ?? []
      const userMessages = firstMessages.filter((m) => m.role === 'user')
      expect(userMessages).toHaveLength(1)
      expect(String(userMessages[0]?.content ?? '')).toContain('ابنِ لي تطبيقًا بسيطًا')

      // موجّه النظام وصل أيضًا، منفصلًا عن طلب المستخدم
      const systemMessages = firstMessages.filter((m) => m.role === 'system')
      expect(systemMessages).toHaveLength(1)
      expect(String(systemMessages[0]?.content ?? '')).toContain('NT Studio')

      // الأدوات وصلت للمزوّد كمخططات، بلا execute
      const toolNames = (captures[0]?.body.tools ?? []).map((t) => (t.function as { name?: string })?.name)
      expect(toolNames).toContain('append_log')
      expect(toolNames).toContain('write_file')

      /* (ب) الأداة نُفِّذت مرة واحدة بالضبط — عدّاد على القرص */
      const logFile = path.join(projectRoot, '.agent', 'log.jsonl')
      const lines = (await fs.readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('بدء الاختبار')

      /* الرسائل المرسلة في الدور الثاني لازم تكون صالحة للمزوّد:
         assistant بـ tool_calls ثم tool بنتيجة. لو كانت الصيغة القديمة
         (content نصّي + toolCalls) لرفضها الـ SDK بـ AI_InvalidPromptError. */
      const secondMessages = captures[1]?.body.messages ?? []
      const assistantWithCalls = secondMessages.find((m) => Array.isArray(m.tool_calls))
      expect(assistantWithCalls).toBeTruthy()
      expect((assistantWithCalls?.tool_calls as unknown[] | undefined)?.length).toBe(1)
      const toolResultMessage = secondMessages.find((m) => m.role === 'tool')
      expect(toolResultMessage).toBeTruthy()
      expect(String(toolResultMessage?.content ?? '')).toContain('Logged.')

      /* (ج) done/stop */
      expect(result.reason).toBe('stop')
      const terminals = terminal(events)
      expect(terminals).toHaveLength(1)
      const done = terminals[0]
      expect(done?.type).toBe('done')
      if (done?.type === 'done') {
        expect(done.reason).toBe('stop')
        expect(done.summary).toContain('انتهى العمل.')
      }
      expect(events.some((e) => e.type === 'failed')).toBe(false)

      /* صف واحد فقط لكل أداة، وبمعرّف النداء الحقيقي لا '' */
      const starts = events.filter((e) => e.type === 'tool_start')
      const ends = events.filter((e) => e.type === 'tool_end')
      expect(starts).toHaveLength(1)
      expect(ends).toHaveLength(1)
      if (starts[0]?.type === 'tool_start') expect(starts[0].callId).toBe('call_abc')
      if (ends[0]?.type === 'tool_end') expect(ends[0].callId).toBe('call_abc')
    } finally {
      await stopServer()
    }
  }, 30_000)

  it('يبث done/stop مباشرة عندما لا يُستدعى شيء', async () => {
    await startServer()
    scenario = 'text-only'

    try {
      const { result, events } = await runLoop(null, AbortSignal.timeout(20_000))

      expect(captures).toHaveLength(1)
      expect(result.reason).toBe('stop')
      expect(result.summary).toContain('انتهى العمل.')

      const terminals = terminal(events)
      expect(terminals).toHaveLength(1)
      expect(terminals[0]?.type).toBe('done')
      expect(events.some((e) => e.type === 'failed')).toBe(false)
    } finally {
      await stopServer()
    }
  }, 30_000)

  it('يبث failed عند 401 ولا يعيد المحاولة', async () => {
    await startServer()
    scenario = 'unauthorized'

    try {
      const startedAt = Date.now()
      const { result, events } = await runLoop(null, AbortSignal.timeout(20_000))
      const elapsed = Date.now() - startedAt

      expect(result.reason).toBe('error')
      // 401 غير قابل لإعادة المحاولة: طلب واحد فقط، بلا backoff.
      expect(captures).toHaveLength(1)
      expect(elapsed).toBeLessThan(10_000)

      const terminals = terminal(events)
      expect(terminals).toHaveLength(1)
      expect(terminals[0]?.type).toBe('failed')
      expect(events.some((e) => e.type === 'done')).toBe(false)
      if (terminals[0]?.type === 'failed') expect(terminals[0].message.length).toBeGreaterThan(0)
    } finally {
      await stopServer()
    }
  }, 30_000)
})