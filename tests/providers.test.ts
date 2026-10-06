/**
 * اختبار تكامل حقيقي لبروتوكولات المزوّدات الثلاثة.
 *
 * الهدف: إثبات أن electron-vite يقدر ينفّذ حزم AI SDK (ESM-only)
 * من داخل عملية main التي تُبنى CommonJS — أخطر نقطة في المشروع،
 * ولا تُثبت إلا بتشغيل فعلي.
 *
 * كل بروتوكول يُختبر مقابل خادم HTTP محلي يحاكي الاستجابة الحقيقية،
 * ثم نتحقق من: جلب النماذج + طلب الإكمال + استخراج النص.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  buildModel,
  extractError,
  fetchModels,
  normalizeBaseUrl,
  parseModels,
  probeConnection,
} from '../src/main/core/providers'

/* -------------------------------------------------------------------------- */
/* خادم مزوّد وهمي يحاكي البوابات الثلاث                                     */
/* -------------------------------------------------------------------------- */

interface Capture {
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

const captures: Capture[] = []

function readBody(req: IncomingMessageLike): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data))
  })
}

type IncomingMessageLike = Parameters<typeof createServer>[0] extends (
  req: infer R,
  res: infer _S,
) => void
  ? R
  : never

function json(res: ServerResponseLike, status: number, payload: unknown): void {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  })
  res.end(text)
}

type ServerResponseLike = Parameters<Parameters<typeof createServer>[0]>[1]

let server: Server
let origin = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      captures.push({ url: req.url ?? '', headers: req.headers, body })
      const url = req.url ?? ''

      // CORS preflight (AI SDK قد يرسل OPTIONS)
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
        })
        res.end()
        return
      }

      // ---- OpenAI-compatible ----
      if (url === '/v1/models') {
        json(res, 200, { object: 'list', data: [{ id: 'gpt-test-a' }, { id: 'gpt-test-b' }] })
        return
      }
      if (url === '/v1/chat/completions') {
        json(res, 200, {
          id: 'chatcmpl-x',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-test-a',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'pong-openai' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        })
        return
      }

      // ---- Anthropic ----
      if (url === '/v1/messages') {
        json(res, 200, {
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [{ type: 'text', text: 'pong-anthropic' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 2 },
        })
        return
      }

      // ---- Google ----
      if (url.startsWith('/v1beta/models') && url.includes('generateContent')) {
        json(res, 200, {
          candidates: [{ content: { parts: [{ text: 'pong-google' }], role: 'model' }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
        })
        return
      }
      if (url === '/v1beta/models') {
        json(res, 200, {
          models: [{ name: 'models/gemini-test' }, { name: 'models/gemini-test-2' }],
        })
        return
      }

      json(res, 404, { error: { message: `مسار غير معروف: ${url}` } })
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('تعذّر تحديد المنفذ')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/* -------------------------------------------------------------------------- */
/* تطبيع الروابط                                                             */
/* -------------------------------------------------------------------------- */

describe('normalizeBaseUrl', () => {
  it('يضيف البروتوكول والرابط الناقص', () => {
    expect(normalizeBaseUrl('api.example.com', 'openai-compatible')).toBe('https://api.example.com/v1')
  })

  it('لا يكرر /v1', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1', 'openai-compatible')).toBe(
      'https://api.example.com/v1',
    )
  })

  it('يقصّ رابط نقطة النهاية الكامل', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions', 'openai-compatible')).toBe(
      'https://api.example.com/v1',
    )
  })

  it('يحافظ على المضيف والمنفذ للخدمات المحلية', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:11434', 'openai-compatible')).toBe('http://127.0.0.1:11434/v1')
  })

  it('يختار النسخة الصحيحة لكل بروتوكول', () => {
    expect(normalizeBaseUrl('https://a.com', 'anthropic')).toBe('https://a.com/v1')
    expect(normalizeBaseUrl('https://a.com', 'google')).toBe('https://a.com/v1beta')
  })

  it('يزيل الشرطة المائلة الأخيرة', () => {
    expect(normalizeBaseUrl('https://a.com/v1/', 'openai-compatible')).toBe('https://a.com/v1')
  })
})

/* -------------------------------------------------------------------------- */
/* تحليل الردود                                                             */
/* -------------------------------------------------------------------------- */

describe('parseModels', () => {
  it('يقرأ صيغة OpenAI (data[])', () => {
    expect(parseModels(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), 'openai-compatible')).toEqual([
      'a',
      'b',
    ])
  })

  it('يقرأ صيغة Google ويزيل بادئة models/', () => {
    expect(parseModels(JSON.stringify({ models: [{ name: 'models/gemini-x' }] }), 'google')).toEqual(['gemini-x'])
  })

  it('يزيل التكرار ويرتّب', () => {
    expect(parseModels(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] }), 'anthropic')).toEqual([
      'a',
      'b',
    ])
  })

  it('يتحمّل ردًا ليس JSON', () => {
    expect(parseModels('<html>oops</html>', 'openai-compatible')).toEqual([])
  })
})

describe('extractError', () => {
  it('يقرأ error.message', () => {
    expect(extractError(JSON.stringify({ error: { message: 'bad key' } }), 401)).toBe('bad key')
  })

  it('يقرأ message مباشرة', () => {
    expect(extractError(JSON.stringify({ message: 'nope' }), 500)).toBe('nope')
  })

  it('يتعامل مع نص عادي', () => {
    expect(extractError('Service Unavailable', 503)).toContain('Service Unavailable')
  })
})

/* -------------------------------------------------------------------------- */
/* التكامل الحقيقي عبر AI SDK                                                */
/* -------------------------------------------------------------------------- */

describe('تكامل openai-compatible مع خادم حقيقي', () => {
  it('يجلب النماذج', async () => {
    const models = await fetchModels(origin, 'openai-compatible', 'test-key')
    expect(models).toEqual(['gpt-test-a', 'gpt-test-b'])
  })

  it('ينفّذ طلب إكمال فعلي عبر AI SDK', async () => {
    const result = await probeConnection({
      name: 'local',
      protocol: 'openai-compatible',
      baseUrl: origin,
      apiKey: 'test-key',
      models: ['gpt-test-a'],
    })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('pong-openai')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('يرسل ترويسة Authorization', () => {
    const last = captures.at(-1)
    expect(last?.headers.authorization).toBe('Bearer test-key')
  })
})

describe('تكامل anthropic مع خادم حقيقي', () => {
  it('ينفّذ طلب messages فعلي', async () => {
    const result = await probeConnection({
      name: 'claude',
      protocol: 'anthropic',
      baseUrl: origin,
      apiKey: 'sk-ant-test',
      models: ['claude-test'],
    })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('pong-anthropic')
  })

  it('يرسل x-api-key لا Authorization', () => {
    const last = captures.at(-1)
    expect(last?.headers['x-api-key']).toBe('sk-ant-test')
    expect(last?.headers.authorization).toBeUndefined()
  })
})

describe('تكامل google مع خادم حقيقي', () => {
  it('ينفّذ طلب generateContent فعلي', async () => {
    const result = await probeConnection({
      name: 'gemini',
      protocol: 'google',
      baseUrl: origin,
      apiKey: 'AIzaTest',
      models: ['gemini-test'],
    })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('pong-google')
  })
})

describe('التعامل مع الأخطاء', () => {
  it('يرفض النموذج الفارغ برسالة واضحة', async () => {
    const result = await probeConnection({
      name: 'x',
      protocol: 'openai-compatible',
      baseUrl: origin,
      apiKey: '',
      models: [],
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('model')
  })

  it('يبلّغ عن فشل الاتصال برسالة واضحة', async () => {
    // منفذ غير مُستخدم ⇒ رفض اتصال فوري، بلا انتظار
    const result = await probeConnection({
      name: 'x',
      protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1',
      apiKey: '',
      models: ['m'],
    })
    expect(result.ok).toBe(false)
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.message.length).toBeLessThanOrEqual(400)
  }, 20_000)
})

describe('buildModel', () => {
  it('يبني نموذجًا قابلًا للاستدعاء لكل بروتوكول دون رمي', () => {
    for (const protocol of ['openai-compatible', 'anthropic', 'google'] as const) {
      const model = buildModel(
        {
          id: 'x',
          name: 'x',
          protocol,
          baseUrl: origin,
          apiKeyEnc: '',
          models: ['m'],
          note: '',
          createdAt: 0,
          lastTestedAt: null,
          lastTestOk: null,
          lastLatencyMs: null,
        },
        'key',
        'm',
      )
      // AI SDK v7 يعيد كائن LanguageModel بإصدار المواصفة v4
      expect(model).toBeTruthy()
      expect(model.specificationVersion).toBe('v4')
    }
  })
})