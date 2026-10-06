import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'
import { decryptSecret, encryptSecret } from './secrets'
import type { AppContext } from './context'
import {
  DEFAULT_API_STYLE,
  PROTOCOL_LABELS,
  apiStyleOf,
  headersOf,
  mergeSecretMap,
  providerInputSchema,
  queryParamsOf,
  toPublic,
  type ApiStyle,
  type ProviderInput,
  type ProviderPublic,
  type ProviderRecord,
  type StringMap,
  type TestResult,
} from '../../shared/providers'

const log = (ctx: AppContext) => ctx.root.child('providers')

/** يُرسَل مع كل طلب حتى لا ترفضه جدران الحماية التي تتجاهل المستخدمين المجهولين. */
const USER_AGENT = 'nt-studio/0.1.0'

/* -------------------------------------------------------------------------- */
/* URL normalization                                                          */
/* -------------------------------------------------------------------------- */

/**
 * لواحق نقطة النهاية التي يقصّها المستخدم من شريط العنوان.
 * الترتيب مهم: الأطول أولًا (`/chat/completions` قبل `/completions`)،
 * والأفعال المنقوطة (`:generateContent`) قبل البقية لأنها نهاية الرابط فعلًا.
 */
const ENDPOINT_SUFFIXES = [
  ':generateContent',
  ':streamRawPredict',
  ':systemone',
  '/chat/completions',
  '/completions',
  '/responses',
  '/messages',
  '/models',
  '/embeddings',
]

/** لواحق تُحذف بعدها الذيل `models/<id>` — لأن الرابط المنسوخ كان نقطة نهاية نموذج واحد. */
const MODEL_ID_TAILS = [/\/(?:models|tunedModels)\/[^/]+$/i]

/** أي مقطع إصدارية داخل المسار: v1 v2 v3 v4 v1beta v1beta1 v1alpha v2alpha … */
const VERSION_SEGMENT = /(?:^|\/)v\d+(?:(?:beta|alpha)\d*)?(?=\/|$)/i

const DEFAULT_VERSION: Record<ProviderRecord['protocol'], string> = {
  'openai-compatible': 'v1',
  anthropic: 'v1',
  google: 'v1beta',
}

/** يزيل الشرطات المائلة الطرفية ويعيد '/' لجذر الرابط. */
function trimPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * المضيفات التي تُخدَم محليًا. القاعدة: خادم محلي نادرًا ما يملك شهادة،
 * وإجبار TLS عليها يعني أن كل Ollama/LM Studio/vLLM محلي يفشل اتصاله.
 * المخطط الصريح من المستخدم يتقدّم دائمًا على هذا الاستنتاج.
 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host === 'host.docker.internal' || host.endsWith('.host.docker.internal')) {
    return true
  }
  if (host.includes(':')) {
    // IPv6: ::1 و link-local و ULA
    return host === '::1' || host === '0:0:0:0:0:0:0:1' || /^f[cd]/.test(host) || host.startsWith('fe80:')
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** يخمّن البروتوكول عندما لا يكتبه المستخدم: http للمضيفات المحلية، https لغيرها. */
function guessScheme(input: string): 'http' | 'https' {
  try {
    return isLocalHost(new URL(`http://${input.replace(/^\/+/, '')}`).hostname) ? 'http' : 'https'
  } catch {
    return 'https'
  }
}

/**
 * يحوّل أي مدخل إلى جذر API صالح.
 *
 * يقبل: example.com · http://localhost:11434 · url/v1/chat/completions ·
 * url/v1?api-version=… · رابط Vertex المنتهي بـ :streamRawPredict
 *
 * القواعد (مُثبتة بالاختبارات في tests/provider-urls.test.ts):
 *  1. تحليل بـ `new URL` والعمل على `pathname` فقط، مع بقاء `search` و`hash` كما هما.
 *  2. لا تُلحق نسخة إصدارية إن كان المسار يحوي مقطعًا إصداريًا أصلًا
 *     (ولو لم يكن في آخره: `…/v1/acct/gw/openai`).
 *  3. لا تُلحق نسخة إصدارية إن كان الرابط نقطة نهاية نموذج كاملة (`:generateContent`…).
 *  4. الدالة نُطبَّقة مرتين كمرة واحدة (idempotent) — تُستدعى عند الحفظ وعند كل طلب.
 */
export function normalizeBaseUrl(raw: string, protocol: ProviderRecord['protocol']): string {
  const input = String(raw ?? '').trim()
  if (!input) return ''

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
  let url: URL
  try {
    url = new URL(hasScheme ? input : `${guessScheme(input)}://${input}`)
  } catch {
    return input.replace(/\/+$/, '')
  }

  const lower = url.pathname.toLowerCase()
  let path = trimPath(url.pathname)
  let completeEndpoint = false

  for (const suffix of ENDPOINT_SUFFIXES) {
    if (!lower.endsWith(suffix.toLowerCase())) continue
    path = trimPath(path.slice(0, path.length - suffix.length))
    if (suffix.startsWith(':')) {
      // رابط نموذج واحد (.../models/gemini-2.0:generateContent) — لا نحتاج أي لاحقة بعده.
      completeEndpoint = true
      for (const tail of MODEL_ID_TAILS) path = path.replace(tail, '')
    }
    break
  }

  path = trimPath(path)
  if (!completeEndpoint && !VERSION_SEGMENT.test(path)) {
    path = path === '/' ? `/${DEFAULT_VERSION[protocol]}` : `${path}/${DEFAULT_VERSION[protocol]}`
  }

  url.pathname = path
  return url.toString()
}

/** يفصل جذر الـ base عن معاملات الاستعلام — الـ SDK يبني الرابط بـ `${base}${path}`. */
export function splitEndpoint(baseUrl: string, extra?: StringMap): { base: string; params: StringMap } {
  const params: StringMap = {}
  let base = baseUrl.replace(/\/+$/, '')
  try {
    const url = new URL(baseUrl)
    for (const [key, value] of url.searchParams) params[key] = value
    for (const [key, value] of Object.entries(extra ?? {})) params[key] = value
    url.search = ''
    url.hash = ''
    base = url.toString().replace(/\/+$/, '')
  } catch {
    /* رابط غير قابل للتحليل: نمرّره كما هو وندمج المعاملات في المسار */
    for (const [key, value] of Object.entries(extra ?? {})) params[key] = value
  }
  return { base, params }
}

type FetchArg = Parameters<typeof fetch>[0]
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>
type FetchFn = (input: FetchArg, init?: FetchInit) => ReturnType<typeof fetch>

/** ترويسات المصادقة التي يجب ألا تصل بقيم فارغة. */
const EMPTY_AUTH_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key']

/**
 * غلاف `fetch` يحل مشكلتين لا يحلّهما أي مزوّد من المزوّدات:
 *  1. `createOpenAI*` يبني `${baseURL}${path}` — فلو احتوى baseURL على `?` لوقع المسار
 *     داخل سلسلة الاستعلام. لذلك نمرّر search عبر معاملات الطلب لا عبر الرابط.
 *  2. بعض المسارات تُرسل `Authorization: Bearer ` بمفتاح فارغ (خادم محلي بلا مفتاح)؛
 *     الترويس الفارغ يُسقط طلبًا تقبله بوابة متسامحة. نحذفه بدل إرساله.
 */
function makeFetch(params: StringMap): FetchFn {
  const entries = Object.entries(params)
  return (input, init) => {
    let target: FetchArg = input
    if (entries.length > 0) {
      try {
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
        const url = new URL(raw)
        for (const [key, value] of entries) url.searchParams.set(key, value)
        target = url.toString()
      } catch {
        /* نمرّر الرابط كما هو */
      }
    }
    const headers = new Headers(init?.headers)
    let dirty = false
    for (const name of EMPTY_AUTH_HEADERS) {
      const value = headers.get(name)
      if (value === null) continue
      if (value.trim() === '' || value.trim().toLowerCase() === 'bearer') {
        headers.delete(name)
        dirty = true
      }
    }
    if (!dirty && !init?.headers) return fetch(target)
    return fetch(target, dirty ? { ...init, headers } : init)
  }
}

/* -------------------------------------------------------------------------- */
/* Model listing (fast path, no AI SDK)                                       */
/* -------------------------------------------------------------------------- */

function headersFor(protocol: ProviderRecord['protocol'], apiKey: string, extra?: StringMap): StringMap {
  const key = apiKey.trim()
  const base: StringMap = {
    'user-agent': USER_AGENT,
    'content-type': 'application/json',
  }
  if (protocol === 'anthropic') {
    if (key) base['x-api-key'] = key
    base['anthropic-version'] = '2023-06-01'
  } else if (protocol === 'google') {
    if (key) base['x-goog-api-key'] = key
  } else if (key) {
    base.authorization = `Bearer ${key}`
  }
  // ترويسات المستخدم تُدمج أخيرًا حتى تتجاوز الافتراضي (مثل api-key في Azure).
  return { ...base, ...(extra ?? {}) }
}

function isAbortError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null
  const name = err?.name ?? ''
  const message = err?.message ?? ''
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /abort|timed? ?out/i.test(message) ||
    /This operation was aborted/i.test(message)
  )
}

export async function fetchModels(
  baseUrl: string,
  protocol: ProviderRecord['protocol'],
  apiKey: string,
  extra?: { headers?: StringMap; queryParams?: StringMap },
): Promise<string[]> {
  const base = normalizeBaseUrl(baseUrl, protocol)
  const { base: root, params } = splitEndpoint(base, extra?.queryParams)
  const query: StringMap = { ...params }
  if (protocol === 'google' && apiKey.trim()) query.key = apiKey.trim()
  if (protocol === 'anthropic') query.limit = '1000'

  const url = new URL(`${root}/models`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, {
      headers: headersFor(protocol, apiKey, extra?.headers),
      signal: controller.signal,
    })
    const text = await res.text()
    // بوابة بلا مسار /models ليست خطأً قاتلًا: المستخدم يكتب اسم النموذج يدويًا.
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      throw new Error(
        `لا يوجد مسار /models على هذا المزوّد (${res.status}) — اكتب اسم النموذج يدويًا ثم احفظ`,
      )
    }
    if (!res.ok) throw new Error(extractError(text, res.status))
    return parseModels(text, protocol)
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error('انتهت مهلة جلب النماذج (15 ثانية) — تحقق من الرابط أو اكتب اسم النموذج يدويًا')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** مقارنة نصية حتمية لا تعتمد على لغة النظام (عكس localeCompare). */
function compareIds(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** يستخرج قائمة العناصر من أي صيغة رد شائعة في البوابات. */
function extractModelItems(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  if (!json || typeof json !== 'object') return []
  const rec = json as Record<string, unknown>
  if (Array.isArray(rec.data)) return rec.data
  if (Array.isArray(rec.models)) return rec.models
  // بعض الوسطاء يردّون بنموذج واحد: { model: '…' } أو { id: '…' } أو { name: '…' }
  if (typeof rec.model === 'string' || typeof rec.id === 'string' || typeof rec.name === 'string') return [json]
  return []
}

export function parseModels(raw: string, protocol: ProviderRecord['protocol']): string[] {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return []
  }

  const out: string[] = []
  for (const item of extractModelItems(json)) {
    let name: string | undefined
    if (typeof item === 'string') name = item
    else if (item && typeof item === 'object') {
      const rec = item as { id?: unknown; name?: unknown; model?: unknown }
      if (typeof rec.id === 'string') name = rec.id
      else if (typeof rec.name === 'string') name = rec.name
      else if (typeof rec.model === 'string') name = rec.model
    }
    if (!name) continue
    const clean = protocol === 'google' ? name.replace(/^models\//, '') : name
    if (clean && !out.includes(clean)) out.push(clean)
  }
  return out.sort(compareIds)
}

/** أسماء النماذج التي لا تستطيع الإجابة عن "ping" — تُستبعد من اختيار الفحص. */
const NON_CHAT_PATTERNS: RegExp[] = [
  /^auto($|[-_:.])/i,
  /(?:^|[-_:])(?:embed|embedding|embeddings|bge|e5)(?:[-_:.]|$)/i,
  /moderation/i,
  /^(?:whisper|tts)(?:[-_:.]|$)/i,
  /rerank/i,
  /regression/i,
  /(?:^|[-_:])dall-e(?:[-_:.]|$)/i,
  /(?:^|[-_])deprecated(?:[-_:.]|$)/i,
]

export function isLikelyChatModel(id: string): boolean {
  const name = id.trim().toLowerCase()
  if (!name) return false
  return !NON_CHAT_PATTERNS.some((re) => re.test(name))
}

/**
 * يختار النموذج الذي يختبره الفحص.
 * الأولوية لما اختاره المستخدم، ثم أول نموذج قادر على الإجابة بترتيب حتمي.
 * لا نستخدم أبدًا "أول حرف أبجدية" بلا ترشيح: كان ذلك يُرجع `auto`.
 */
export function pickProbeModel(models: string[], requested?: string): string | undefined {
  const list = (models ?? []).map((m) => String(m).trim()).filter((m) => m.length > 0)
  if (requested) {
    const wanted = requested.trim()
    const exact = list.find((m) => m === wanted)
    if (exact) return exact
  }
  if (list.length === 0) return undefined
  const usable = list.filter(isLikelyChatModel)
  const pool = usable.length > 0 ? usable : list
  return [...pool].sort(compareIds)[0]
}

/** هل يطلب هذا الخطأ اسم `max_completion_tokens` بدل `max_tokens`؟ */
export function isMaxTokensRejection(message: string): boolean {
  return /max_completion_tokens/i.test(message) || /max_tokens/i.test(message)
}

/** يعيد الترويسات/المعاملات التي لا должны أن تصل إلى الواجهة أبدًا. */
export function redactErrorInput(text: string): string {
  return text.replace(/([?&](?:key|api[-_]?key|token|access[-_]?token)=)[^&\s]+/gi, '$1••••')
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
  const trimmed = redactErrorInput(raw.trim())
  return status
    ? `HTTP ${status}: ${trimmed.slice(0, 300) || 'بدون تفاصيل'}`
    : trimmed.slice(0, 300) || 'فشل الطلب بدون رسالة'
}

/* -------------------------------------------------------------------------- */
/* Connection probe through AI SDK                                            */
/* -------------------------------------------------------------------------- */

export interface BuildModelOptions {
  /**
   * يحوّل `max_tokens` إلى `max_completion_tokens`.
   * نماذج الاستدلال (o-series، gpt-5-class، كثير من نماذج البوابات) ترفض الأول بـ 400.
   */
  maxCompletionTokens?: boolean
}

function renameMaxTokens(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.max_tokens !== 'number' || args.max_completion_tokens !== undefined) return args
  const out: Record<string, unknown> = { ...args, max_completion_tokens: args.max_tokens }
  delete out.max_tokens
  return out
}

export function buildModel(
  record: ProviderRecord,
  apiKey: string,
  modelId: string,
  options: BuildModelOptions = {},
): LanguageModel {
  const normalized = normalizeBaseUrl(record.baseUrl, record.protocol)
  const { base: baseURL, params } = splitEndpoint(normalized, queryParamsOf(record))
  const headers = headersOf(record)
  const doFetch = makeFetch(params)
  // '' لا undefined: يمنع SDK من قراءة متغيّر بيئة أو رمي خطأ إنجليزي خام.
  const key = apiKey.trim()

  if (record.protocol === 'anthropic') {
    return createAnthropic({ baseURL, apiKey: key, headers, fetch: doFetch })(modelId)
  }
  if (record.protocol === 'google') {
    return createGoogleGenerativeAI({ baseURL, apiKey: key, headers, fetch: doFetch })(modelId)
  }
  if (apiStyleOf(record) === 'responses') {
    // بوابة Responses فقط: المسار الصحيح {base}/responses لا {base}/chat/completions
    return createOpenAI({ baseURL, apiKey: key, headers, fetch: doFetch, name: record.name || 'openai' }).responses(
      modelId,
    )
  }
  return createOpenAICompatible({
    name: record.name || 'openai-compatible',
    baseURL,
    // بلا مفتاح ⇐ لا ترويسة Authorization إطلاقًا (خادم محلي) بدل Bearer not-needed
    ...(key ? { apiKey: key } : {}),
    headers,
    fetch: doFetch,
    ...(options.maxCompletionTokens ? { transformRequestBody: renameMaxTokens } : {}),
  })(modelId)
}

export interface ProbeInput {
  baseUrl: string
  protocol: ProviderRecord['protocol']
  name: string
  apiKey: string
  models: string[]
  /** النموذج الذي اختاره المستخدم — يُختبر أولًا إن كان ضمن القائمة. */
  model?: string
  apiStyle?: ApiStyle
  headers?: StringMap
  queryParams?: StringMap
}

interface ProbeFailure {
  status: number | null
  message: string
}

/** يحوّل خطأ أي SDK/شبكة إلى رسالة عربية تُظهر السبب الحقيقي ورمز الحالة. */
function describeFailure(e: unknown): ProbeFailure {
  if (isAbortError(e)) {
    return { status: null, message: 'انتهت مهلة الاتصال بالمزوّد (30 ثانية) — تحقق من الرابط أو من انقطاع الشبكة' }
  }

  const err = e as {
    message?: string
    statusCode?: unknown
    responseBody?: unknown
    data?: unknown
    url?: unknown
    cause?: { statusCode?: unknown; message?: string }
  }
  const status =
    typeof err.statusCode === 'number'
      ? err.statusCode
      : typeof err.cause?.statusCode === 'number'
        ? err.cause.statusCode
        : null

  // جسم الرد هو السبب الحقيقي؛ APICallError لا يضعه في message.
  let detail = ''
  if (typeof err.responseBody === 'string' && err.responseBody.trim()) {
    detail = extractError(err.responseBody, status ?? undefined)
  }
  if ((!detail || detail === 'فشل الطلب بدون رسالة') && typeof err.data === 'string' && err.data.trim()) {
    detail = extractError(err.data, status ?? undefined)
  }
  if (!detail) detail = err.cause?.message ?? err.message ?? String(e)

  const prefix =
    status === 401
      ? 'المفتاح مرفوض (401)'
      : status === 403
        ? 'الطلب محجوب (403) — المفتاح أو الـ User-Agent أو عنوان IP'
        : status === 404
          ? 'المسار غير موجود (404) — راجع الرابط أو صيغة الواجهة'
          : status === 400
            ? 'طلب مرفوض (400) — معامل غير مدعوم أو اسم نموذج خاطئ'
            : status === 429
              ? 'تجاوز الحدّ (429) — أعد المحاولة لاحقًا'
              : status !== null && status >= 500
                ? `خطأ من الخادم (${status})`
                : 'تعذّر الاتصال بالمزوّد'
  const target = typeof err.url === 'string' && err.url ? ` — ${redactErrorInput(err.url)}` : ''
  return { status, message: `${prefix}${detail ? `: ${detail}` : ''}${target}` }
}

export async function probeConnection(input: ProbeInput): Promise<TestResult> {
  const models = (input.models ?? []).map((m) => String(m).trim()).filter((m) => m.length > 0)
  const model = pickProbeModel(models, input.model)
  if (!model) {
    return {
      ok: false,
      status: null,
      latencyMs: 0,
      message: 'أضف اسم نموذج واحدًا على الأقل قبل الاختبار',
      modelsFound: 0,
    }
  }

  const record: ProviderRecord = {
    id: 'probe',
    name: input.name || 'probe',
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    apiKeyEnc: '',
    models,
    note: '',
    createdAt: 0,
    lastTestedAt: null,
    lastTestOk: null,
    lastLatencyMs: null,
    apiStyle: input.apiStyle ?? DEFAULT_API_STYLE,
    headers: input.headers ?? {},
    queryParams: input.queryParams ?? {},
  }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)

  const run = async (maxCompletionTokens: boolean) =>
    generateText({
      model: buildModel(record, input.apiKey, model, { maxCompletionTokens }),
      prompt: 'ping',
      maxOutputTokens: 16,
      // الفحص قياس لاتصال لا عملية طويلة: إعادة المحاولة التلقائية تُضاعف الزمن وتشوّه القياس.
      maxRetries: 0,
      abortSignal: controller.signal,
    })

  try {
    let result
    try {
      result = await run(false)
    } catch (first) {
      // بعض النماذج ترفض max_tokens؛ نعيد المحاولة مرة واحدة بالاسم الصحيح.
      const firstFailure = describeFailure(first)
      if (!isMaxTokensRejection(firstFailure.message)) throw first
      result = await run(true)
    }
    const latencyMs = Date.now() - started
    const text = typeof result.text === 'string' ? result.text.trim().slice(0, 60) : ''
    return {
      ok: true,
      status: 200,
      latencyMs,
      message: `اتصال ناجح عبر ${PROTOCOL_LABELS[input.protocol].title} — النموذج ${model}${text ? ` — ردّ: ${text}` : ''}`,
      modelsFound: models.length,
    }
  } catch (e) {
    const latencyMs = Date.now() - started
    const failure = describeFailure(e)
    return {
      ok: false,
      status: failure.status,
      latencyMs,
      message: failure.message.slice(0, 400),
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

/**
 * يبني سجلًا من مُدخل الواجهة (كل الحقول عدا `apiKeyEnc`).
 * سلسلة الاستعلام تُنزع من الرابط وتُحفظ في `queryParams` — لأن `baseUrl`
 * يُعاد إلى الواجهة كما هو، فبقاء سرٍّ داخله يعني تسريبه للواجهة.
 */
function recordFromInput(
  base: Omit<ProviderRecord, 'apiKeyEnc'>,
  parsed: ProviderInput,
): Omit<ProviderRecord, 'apiKeyEnc'> {
  const { base: baseUrl, params } = splitEndpoint(normalizeBaseUrl(parsed.baseUrl, parsed.protocol))
  return {
    ...base,
    name: parsed.name,
    protocol: parsed.protocol,
    baseUrl,
    apiStyle: parsed.apiStyle ?? DEFAULT_API_STYLE,
    headers: mergeSecretMap(headersOf(base), parsed.headers),
    queryParams: mergeSecretMap(params, parsed.queryParams),
    models: [...new Set(parsed.models)],
    note: parsed.note,
  }
}

export function addProvider(ctx: AppContext, input: unknown): ProviderPublic {
  const parsed = providerInputSchema.parse(input)
  const record: ProviderRecord = {
    ...recordFromInput(
      {
        id: crypto.randomUUID(),
        name: parsed.name,
        protocol: parsed.protocol,
        baseUrl: '',
        models: [],
        note: '',
        createdAt: Date.now(),
        lastTestedAt: null,
        lastTestOk: null,
        lastLatencyMs: null,
      },
      parsed,
    ),
    apiKeyEnc: parsed.apiKey ? encryptSecret(parsed.apiKey) : '',
  }

  const records = [...(ctx.state.get().providers as ProviderRecord[]), record]
  ctx.state.patch({ providers: records })
  // لا تُسجَّل الترويسات ولا قيم المعاملات: قد تحوي أسرارًا و redact() لا يبتلع "api-key".
  log(ctx).info(
    `provider added "${record.name}" (${record.protocol}) style:${record.apiStyle} ` +
      `headers:${Object.keys(record.headers ?? {}).length} query:${Object.keys(record.queryParams ?? {}).length} ` +
      `models: ${record.models.join(', ') || 'none'}`,
  )
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
  const { apiKeyEnc: _previous, ...editable } = current
  void _previous
  const next: ProviderRecord = {
    ...recordFromInput(editable, parsed),
    apiKeyEnc: apiKeyProvided ? (parsed.apiKey ? encryptSecret(parsed.apiKey) : '') : current.apiKeyEnc,
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
