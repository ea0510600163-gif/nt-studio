/**
 * اختبارات تطبيع روابط المزوّدات + مسارات الطلب + اختيار نموذج الفحص.
 *
 * لماذا هذا الملف: جدول الحالات هنا هو **نتائج منفَّذة** لا توقّعات.
 * كل سطر فيه يكتب الناتج الحرفي الذي تُنتجه `normalizeBaseUrl` اليوم،
 * وأي تغيّر في السلوك يُفشل البناء فورًا بدل أن يعود كمشكلة اتصال عند المستخدم.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildModel,
  isLikelyChatModel,
  normalizeBaseUrl,
  pickProbeModel,
  probeConnection,
} from '../src/main/core/providers'
import {
  DEFAULT_API_STYLE,
  SECRET_MASK,
  apiStyleOf,
  mergeSecretMap,
  providerRecordSchema,
  toPublic,
  type ProviderRecord,
} from '../src/shared/providers'

/* -------------------------------------------------------------------------- */
/* خادم يلتقط كل طلب لتثبيت المسار والترويسات على السلك                      */
/* -------------------------------------------------------------------------- */

interface Capture {
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

const captures: Capture[] = []

/** منطق كل اختبار: يعيد [status, body] حسب المسار والمحتوى. */
type Route = (url: string, body: string) => [number, unknown]
let route: Route = () => [404, { error: { message: 'unknown' } }]

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data))
  })
}

let server: Server
let origin = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req)
      const url = req.url ?? ''
      captures.push({ url, headers: req.headers, body })
      const [status, payload] = route(url, body)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
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
/* الجدول: كل ما يكتبه المستخدم ⇒ الناتج الحرفي                                 */
/* -------------------------------------------------------------------------- */

interface Row {
  input: string
  protocol: 'openai-compatible' | 'anthropic' | 'google'
  expected: string
  why: string
}

const ROWS: Row[] = [
  // — صف الجدول المُبلَّغ عنه في البلاغ —
  {
    input: 'https://opencode.ai/zen/v1/responses',
    protocol: 'openai-compatible',
    expected: 'https://opencode.ai/zen/v1',
    why: 'نقطة نهاية Responses ⇒ يُقصّ اللاحق ويبقى جذر /v1 (ثم يوجّه apiStyle=responses الطلب إلى /responses)',
  },
  {
    input: 'localhost:11434',
    protocol: 'openai-compatible',
    expected: 'http://localhost:11434/v1',
    why: 'خادم محلي بلا شهادة ⇒ لا نفرض https',
  },
  {
    input: '127.0.0.1:1234',
    protocol: 'openai-compatible',
    expected: 'http://127.0.0.1:1234/v1',
    why: '127/8 محلة ⇒ http',
  },
  {
    input: 'https://host/v1?api-version=2024-06-01',
    protocol: 'openai-compatible',
    expected: 'https://host/v1?api-version=2024-06-01',
    why: 'سلسلة الاستعلام تبقى intactة ولا يُلحق شيء بعدها',
  },
  {
    input: 'https://my.gateway.ai/proxy/v2',
    protocol: 'openai-compatible',
    expected: 'https://my.gateway.ai/proxy/v2',
    why: 'لا تُعاد كتابة الإصدار v2 إلى v1',
  },
  {
    input: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
    protocol: 'openai-compatible',
    expected: 'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
    why: 'المسار يحوي v1 في بدايته ⇒ لا يُلحق /v1 آخر',
  },
  {
    input: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'openai-compatible',
    expected: 'https://generativelanguage.googleapis.com/v1beta/openai',
    why: 'أساس Google الرسمي لـ OpenAI-compat لا يُلمس',
  },

  // — حالات إضافية إلزامية —
  {
    input: 'https://api.example.com/v1/',
    protocol: 'openai-compatible',
    expected: 'https://api.example.com/v1',
    why: 'شرطة مائلة طرفية تُزال',
  },
  {
    input: 'HTTPS://Host/V1',
    protocol: 'openai-compatible',
    expected: 'https://host/V1',
    why: 'المضيف يُحجَّر بأحرف صغيرة، وحالة المسار تبقى كما كتبها المستخدم',
  },
  {
    input: '[::1]:11434/v1',
    protocol: 'openai-compatible',
    expected: 'http://[::1]:11434/v1',
    why: 'IPv6 محل بلا أقواس ⇒ http',
  },
  {
    input: '192.168.1.50:8000/v1',
    protocol: 'openai-compatible',
    expected: 'http://192.168.1.50:8000/v1',
    why: 'نطاق 192.168/16 خاص ⇒ http',
  },
  {
    input: 'https://host/v1#frag',
    protocol: 'openai-compatible',
    expected: 'https://host/v1#frag',
    why: 'الجزء الأخير (hash) يبقى سليمًا',
  },
  {
    input: 'https://host/v1beta',
    protocol: 'openai-compatible',
    expected: 'https://host/v1beta',
    why: 'v1beta مقطع إصداري ⇒ يُحفظ',
  },
  {
    input: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0:generateContent',
    protocol: 'google',
    expected: 'https://generativelanguage.googleapis.com/v1beta',
    why: 'رابط Google الكامل ⇒ يُقصّ الفعل واسم النموذج ويبقى أساس v1beta',
  },
  {
    input: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0:generateContent',
    protocol: 'openai-compatible',
    expected: 'https://generativelanguage.googleapis.com/v1beta',
    why: 'حتى لو اختار المستخدم OpenAI-compatible بدل Google',
  },
  {
    input: 'https://LOCATION-aiplatform.googleapis.com/v1/projects/P/locations/L/publishers/google/models/gemini-2.0:streamRawPredict',
    protocol: 'google',
    expected:
      'https://location-aiplatform.googleapis.com/v1/projects/P/locations/L/publishers/google',
    why: 'Vertex: رابط نموذج كامل ⇒ يُقصّ الفعل + models/<id> ولا يُلحق شيء (المسار مُكتمل)',
  },

  // — السلوك المُوثَّق سابقًا (tests/providers.test.ts) —
  { input: 'api.example.com', protocol: 'openai-compatible', expected: 'https://api.example.com/v1', why: 'بلا بروتوكول' },
  {
    input: 'https://api.example.com/v1',
    protocol: 'openai-compatible',
    expected: 'https://api.example.com/v1',
    why: 'لا تكرار لـ /v1',
  },
  {
    input: 'https://api.example.com/v1/chat/completions',
    protocol: 'openai-compatible',
    expected: 'https://api.example.com/v1',
    why: 'يُقصّ رابط نقطة النهاية الكامل',
  },
  {
    input: 'http://127.0.0.1:11434',
    protocol: 'openai-compatible',
    expected: 'http://127.0.0.1:11434/v1',
    why: 'بروتوكول صريح من المستخدم يُحترم',
  },
  {
    input: 'https://a.com',
    protocol: 'anthropic',
    expected: 'https://a.com/v1',
    why: 'النسخة الافتراضية لـ Anthropic',
  },
  {
    input: 'https://a.com',
    protocol: 'google',
    expected: 'https://a.com/v1beta',
    why: 'النسخة الافتراضية لـ Google',
  },
  { input: '', protocol: 'openai-compatible', expected: '', why: 'مدخل فارغ' },
  {
    input: 'host.docker.internal:3000',
    protocol: 'openai-compatible',
    expected: 'http://host.docker.internal:3000/v1',
    why: 'اسم مضيف الحاويات محلي',
  },
  {
    input: 'myserver.local:1234',
    protocol: 'openai-compatible',
    expected: 'http://myserver.local:1234/v1',
    why: 'لاحقة .local محلي (mDNS)',
  },
  {
    input: '172.20.0.5:8000',
    protocol: 'openai-compatible',
    expected: 'http://172.20.0.5:8000/v1',
    why: '172.16/12 خاص ⇒ http',
  },
  {
    input: '172.32.0.5:8000',
    protocol: 'openai-compatible',
    expected: 'https://172.32.0.5:8000/v1',
    why: '172.32 خارج النطاق الخاص ⇒ https',
  },
]

describe('normalizeBaseUrl — الجدول الحرفي', () => {
  for (const row of ROWS) {
    it(`${row.protocol}: ${row.input} ⇒ ${row.expected}`, () => {
      expect(normalizeBaseUrl(row.input, row.protocol)).toBe(row.expected)
    })
  }
})

describe('normalizeBaseUrl — نُطبَّق مرتين كمرة واحدة (idempotent)', () => {
  it('تطبيق الدالة مرتين = مرة واحدة لكل صف', () => {
    for (const row of ROWS.filter((r) => r.expected !== '')) {
      const once = normalizeBaseUrl(row.input, row.protocol)
      const twice = normalizeBaseUrl(once, row.protocol)
      expect(twice, `idempotence: ${row.input}`).toBe(once)
    }
  })
})

describe('normalizeBaseUrl — لا يُلحق /v1 داخل سلسلة الاستعلام', () => {
  it('النسخة تُلحق قبل ?', () => {
    expect(normalizeBaseUrl('https://host?api-version=2024-06-01', 'openai-compatible')).toBe(
      'https://host/v1?api-version=2024-06-01',
    )
  })
  it('استعلام بلا إصدار ⇒ تُلحق النسخة في المسار لا بعد الاستعلام', () => {
    expect(normalizeBaseUrl('https://host/chat?x=1', 'openai-compatible')).toBe('https://host/chat/v1?x=1')
  })
  it('الاستعلام يبقى سليمًا والنسخة قبل ?', () => {
    const out = normalizeBaseUrl('https://host?api-version=2024-06-01&x=2', 'openai-compatible')
    const u = new URL(out)
    expect(u.pathname).toBe('/v1')
    expect(u.search).toBe('?api-version=2024-06-01&x=2')
  })
})

/* -------------------------------------------------------------------------- */
/* اختيار نموذج الفحص                                                          */
/* -------------------------------------------------------------------------- */

describe('pickProbeModel', () => {
  const list = ['auto', 'gpt-5', 'qwen3-max', 'text-embedding-3-small']

  it('يتجاهل auto ونماذج التضمين', () => {
    expect(isLikelyChatModel('auto')).toBe(false)
    expect(isLikelyChatModel('text-embedding-3-small')).toBe(false)
    expect(isLikelyChatModel('text-embedding-ada-002')).toBe(false)
    expect(isLikelyChatModel('omni-moderation-latest')).toBe(false)
    expect(isLikelyChatModel('whisper-1')).toBe(false)
    expect(isLikelyChatModel('bge-reranker-v2-m3')).toBe(false)
    expect(isLikelyChatModel('gpt-5')).toBe(true)
    expect(isLikelyChatModel('qwen3-max')).toBe(true)
  })

  it('لا يختار أول اسم أبجديًا إذا كان auto أو التضمين', () => {
    expect(pickProbeModel(list)).toBe('gpt-5')
  })

  it('يبدأ بالنموذج ثم لا يتغيّر بترتيب القائمة', () => {
    expect(pickProbeModel(['qwen3-max', 'gpt-5'], 'gpt-5')).toBe('gpt-5')
    expect(pickProbeModel(['gpt-5', 'qwen3-max'])).toBe('gpt-5')
    expect(pickProbeModel([...list].reverse())).toBe('gpt-5')
  })

  it('يختار النموذج المطلوب حتى لو لم يكن في القائمة', () => {
    expect(pickProbeModel(list, 'qwen3-max')).toBe('qwen3-max')
    expect(pickProbeModel([], 'anything')).toBeUndefined()
  })

  it('لا يسقط إلى لا شيء إذا كان كل النماذج غير صالحة للإكمال', () => {
    expect(pickProbeModel(['text-embedding-3-large'])).toBe('text-embedding-3-large')
  })
})

/* -------------------------------------------------------------------------- */
/* إثبات على السلك: مسار الطلب، الترويسات، max_completion_tokens               */
/* -------------------------------------------------------------------------- */

const record = (over: Partial<ProviderRecord> = {}): ProviderRecord => ({
  id: 'r',
  name: 'local',
  protocol: 'openai-compatible',
  baseUrl: origin,
  apiKeyEnc: '',
  models: ['gpt-5'],
  note: '',
  createdAt: 0,
  lastTestedAt: null,
  lastTestOk: null,
  lastLatencyMs: null,
  ...over,
})

const chatOk = {
  id: 'chatcmpl-x',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-5',
  choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

describe('الفحص الحي — يختار نموذجًا قادرًا على الإجابة', () => {
  it('لا يختبر auto ولا نموذج التضمين ولو كانا أول القائمة أبجديًا', async () => {
    const seen: string[] = []
    route = (_url, body) => {
      const model = (JSON.parse(body) as { model?: string }).model ?? ''
      seen.push(model)
      if (model !== 'gpt-5') {
        return [400, { error: { message: `model ${model} cannot generate` } }]
      }
      return [200, { ...chatOk, model }]
    }
    const result = await probeConnection({
      name: 'gw',
      protocol: 'openai-compatible',
      baseUrl: origin,
      apiKey: 'k',
      models: ['auto', 'gpt-5', 'qwen3-max', 'text-embedding-3-small'],
    })
    expect(result.ok).toBe(true)
    expect(seen).toEqual(['gpt-5'])
    expect(result.message).toContain('gpt-5')
    route = () => [404, { error: { message: 'unknown' } }]
  })

  it('يفضّل النموذج الذي اختاره المستخدم', async () => {
    const seen: string[] = []
    route = (_url, body) => {
      const model = (JSON.parse(body) as { model?: string }).model ?? ''
      seen.push(model)
      return [200, { ...chatOk, model }]
    }
    await probeConnection({
      name: 'gw',
      protocol: 'openai-compatible',
      baseUrl: origin,
      apiKey: 'k',
      models: ['auto', 'gpt-5', 'qwen3-max'],
      model: 'qwen3-max',
    })
    expect(seen).toEqual(['qwen3-max'])
    route = () => [404, { error: { message: 'unknown' } }]
  })

  it('يعرض السبب الحقيقي ورقم الحالة بدل "فشل الاتصال"', async () => {
    route = () => [401, { error: { message: 'Incorrect API key provided' } }]
    const result = await probeConnection({
      name: 'gw',
      protocol: 'openai-compatible',
      baseUrl: origin,
      apiKey: 'bad',
      models: ['gpt-5'],
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.message).toContain('401')
    expect(result.message).toContain('Incorrect API key provided')
    expect(result.message.length).toBeLessThanOrEqual(400)
    route = () => [404, { error: { message: 'unknown' } }]
  })
})

describe('الفحص الحي — max_completion_tokens', () => {
  it('يعيد المحاولة باسم المعامل الصحيح عندما يرفض النموذج max_tokens', async () => {
    const bodies: string[] = []
    route = (_url, body) => {
      bodies.push(body)
      const parsed = JSON.parse(body) as Record<string, unknown>
      if (parsed.max_tokens !== undefined) {
        return [400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported, use max_completion_tokens" } }]
      }
      return [200, chatOk]
    }
    const result = await probeConnection({
      name: 'reasoner',
      protocol: 'openai-compatible',
      baseUrl: origin,
      apiKey: 'k',
      models: ['gpt-5'],
    })
    expect(result.ok).toBe(true)
    expect(bodies).toHaveLength(2)
    expect(JSON.parse(bodies[0] as string).max_tokens).toBe(16)
    const retry = JSON.parse(bodies[1] as string) as Record<string, unknown>
    expect(retry.max_tokens).toBeUndefined()
    expect(retry.max_completion_tokens).toBe(16)
    route = () => [404, { error: { message: 'unknown' } }]
  })
})

describe('الفحص الحي — ترويسات ومعاملات مخصّصة (Azure / OpenRouter)', () => {
  it('يرسل الترويسة السرّية والمعامل في الرابط لا داخل المسار', async () => {
    route = () => [200, chatOk]
    const result = await probeConnection({
      name: 'azure',
      protocol: 'openai-compatible',
      baseUrl: `${origin}/openai?api-version=2024-06-01`,
      apiKey: '',
      models: ['gpt-5'],
      headers: { 'api-key': 'SECRET-KEY', 'HTTP-Referer': 'https://nt.studio' },
      queryParams: { 'api-version': '2024-06-01' },
    })
    expect(result.ok).toBe(true)
    const last = captures.at(-1)
    expect(last?.headers['api-key']).toBe('SECRET-KEY')
    expect(last?.headers['http-referer']).toBe('https://nt.studio')
    // لا bearer وهمي على خادم بلا مفتاح
    expect(last?.headers.authorization).toBeUndefined()
    expect(last?.url).toBe('/openai/v1/chat/completions?api-version=2024-06-01')
    route = () => [404, { error: { message: 'unknown' } }]
  })
})

describe('الفحص الحي — صيغة Responses', () => {
  it('يوجّه الطلب إلى /responses لا /chat/completions', async () => {
    route = (url) => {
      if (url.split('?')[0] !== '/v1/responses') {
        return [404, { error: { message: `not found: ${url}` } }]
      }
      return [
        200,
        {
          id: 'resp_1',
          created_at: 1,
          model: 'gpt-5',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              id: 'msg_1',
              status: 'completed',
              content: [{ type: 'output_text', text: 'pong-responses', annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      ]
    }
    const result = await probeConnection({
      name: 'zen',
      protocol: 'openai-compatible',
      baseUrl: `${origin}/v1`,
      apiKey: 'k',
      models: ['gpt-5'],
      apiStyle: 'responses',
    })
    expect(captures.at(-1)?.url).toBe('/v1/responses')
    expect(result.ok).toBe(true)
    expect(result.message).toContain('pong-responses')
    route = () => [404, { error: { message: 'unknown' } }]
  })
})

/* -------------------------------------------------------------------------- */
/* السجلّات القديمة والأسرار                                                   */
/* -------------------------------------------------------------------------- */

describe('توافق السجلّات القديمة', () => {
  const legacy = {
    id: 'old',
    name: 'قديم',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnc: 'dpapi:AAAA',
    models: ['gpt-4'],
    note: '',
    createdAt: 1,
    lastTestedAt: null,
    lastTestOk: null,
    lastLatencyMs: null,
  }

  it('سجلٌّ محفوظ قبل الحقول الجديدة يمرّ عبر المخطط', () => {
    const parsed = providerRecordSchema.parse(legacy)
    expect(parsed).toBeTruthy()
    expect(apiStyleOf(parsed)).toBe(DEFAULT_API_STYLE)
    expect(parsed.headers).toBeUndefined()
  })

  it('النموذج المبنيّ من سجلّ قديم يعمل بلا حقول جديدة', () => {
    const model = buildModel(providerRecordSchema.parse(legacy), 'key', 'gpt-4')
    expect(model).toBeTruthy()
    expect(typeof model === 'object' ? (model as { specificationVersion?: string }).specificationVersion : undefined).toBe('v4')
  })
})

describe('toPublic — الأسرار لا تعود للواجهة', () => {
  const withSecrets = record({
    apiKeyEnc: 'dpapi:SECRET',
    headers: { 'api-key': 'AZURE-SECRET', 'HTTP-Referer': 'https://nt.studio' },
    queryParams: { 'api-version': '2024-06-01', key: 'GOOGLE-SECRET' },
  })

  it('يحذف apiKeyEnc ويقنّع كل قيم الترويسات والمعاملات', () => {
    const pub = toPublic(withSecrets)
    expect(JSON.stringify(pub)).not.toContain('AZURE-SECRET')
    expect(JSON.stringify(pub)).not.toContain('GOOGLE-SECRET')
    expect(JSON.stringify(pub)).not.toContain('dpapi:SECRET')
    expect(pub.keyMask).toBe(SECRET_MASK)
    expect(pub.hasKey).toBe(true)
    // أسماء المفاتيح تبقى ظاهرة ليتعرف المستخدم عليها
    expect(Object.keys(pub.headers ?? {}).sort()).toEqual(['HTTP-Referer', 'api-key'])
    expect(pub.headers?.['api-key']).toBe(SECRET_MASK)
    expect(pub.queryParams?.['api-version']).toBe(SECRET_MASK)
  })

  it('القناع في مُدخل التعديل يحفظ السر ولا يمسحه', () => {
    expect(mergeSecretMap({ 'api-key': 'REAL' }, { 'api-key': SECRET_MASK })).toEqual({ 'api-key': 'REAL' })
    expect(mergeSecretMap({ 'api-key': 'REAL' }, { 'api-key': 'NEW' })).toEqual({ 'api-key': 'NEW' })
    expect(mergeSecretMap({ 'api-key': 'REAL' }, { 'api-key': '' })).toEqual({})
  })
})
