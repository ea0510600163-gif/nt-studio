import { z } from 'zod'

/**
 * عقد المزوّدات — مشترك بين العملية الرئيسية والواجهة.
 *
 * مبدأ التصميم: المفتاح لا يخرج أبدًا من العملية الرئيسية.
 * الواجهة تستقبل `keyMask` فقط، وترسل مفتاحًا جديدًا عند الحفظ ولا تستقبله بعده.
 * نفس القاعدة تنطبق على `headers` و`queryParams`: قد يحتوي كل منهما سرًّا
 * (`api-key` في Azure، `key` في Vertex) فيُقنَّع مثل المفتاح تمامًا.
 */

export const PROTOCOLS = ['openai-compatible', 'anthropic', 'google'] as const
export type Protocol = (typeof PROTOCOLS)[number]

/**
 * صيغة الواجهة المطلوبة من البوابة.
 * أغلب البوابات توفّر `chat-completions`، وبعضها (Zen وغيره) يوفّر `/responses` فقط.
 */
export const API_STYLES = ['chat-completions', 'responses'] as const
export type ApiStyle = (typeof API_STYLES)[number]

/** خريطة ترويسات أو معاملات استعلام: المفتاح اسم، القيمة نص. */
export type StringMap = Record<string, string>

/** القيمة الافتراضية لسجلّات قديمة لا تحمل `apiStyle`. */
export const DEFAULT_API_STYLE: ApiStyle = 'chat-completions'

export const PROTOCOL_LABELS: Record<Protocol, { title: string; hint: string; defaultUrl: string; keyHint: string }> = {
  'openai-compatible': {
    title: 'OpenAI-compatible',
    hint: 'يغطي OpenAI و Groq و OpenRouter و DeepSeek و Together و Ollama و LM Studio و vLLM وأي بوابة أخرى',
    defaultUrl: 'https://api.openai.com/v1',
    keyHint: 'المفتاح مطلوب إلا في الخوادم المحلية (Ollama/LM Studio)',
  },
  anthropic: {
    title: 'Anthropic',
    hint: 'واجهة Claude الأصلية (ترويسة x-api-key)',
    defaultUrl: 'https://api.anthropic.com/v1',
    keyHint: 'sk-ant-…',
  },
  google: {
    title: 'Google Generative AI',
    hint: 'واجهة Gemini الأصلية (المفتاح في معامل query)',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyHint: 'AIza…',
  },
}

/**
 * السجل المحفوظ على القرص — المفتاح فيه مشفّر بـ DPAPI.
 *
 * الحقول الثلاثة الأخيرة اختيارية عمدًا: أي مزوّد حُفظ قبل هذا الإصدار لا يحملها،
 * وقيمتها الفعلية تُقرأ عبر `apiStyleOf` / `headersOf` / `queryParamsOf`.
 * (لو استُعمل `.default()` لصارت إلزامية في النوع المطبَّق، وكسرت `state.json`).
 */
export const providerRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.enum(PROTOCOLS),
  baseUrl: z.string(),
  /** صيغة "dpapi:<base64>"، أو فارغ للمزوّدات التي لا تحتاج مفتاحًا. */
  apiKeyEnc: z.string(),
  models: z.array(z.string()),
  note: z.string(),
  createdAt: z.number(),
  lastTestedAt: z.number().nullable(),
  lastTestOk: z.boolean().nullable(),
  lastLatencyMs: z.number().nullable(),
  /** `chat-completions` (افتراضي) أو `responses`. غائبة ⇐ الافتراضي. */
  apiStyle: z.enum(API_STYLES).optional(),
  /** ترويسات إضافية تُرسَل مع كل طلب. قد تحوي أسرارًا ⇒ تُقنَّع في toPublic. */
  headers: z.record(z.string(), z.string()).optional(),
  /** معاملات استعلام إضافية (`api-version` في Azure مثلًا). غائبة ⇐ لا شيء. */
  queryParams: z.record(z.string(), z.string()).optional(),
})
export type ProviderRecord = z.infer<typeof providerRecordSchema>

/* -------------------------------------------------------------------------- */
/* قيم افتراضية للسجلات القديمة                                                 */
/* -------------------------------------------------------------------------- */

type ProviderLike = Pick<ProviderRecord, 'apiStyle' | 'headers' | 'queryParams'>

export const apiStyleOf = (record: ProviderLike): ApiStyle => record.apiStyle ?? DEFAULT_API_STYLE
export const headersOf = (record: ProviderLike): StringMap => ({ ...(record.headers ?? {}) })
export const queryParamsOf = (record: ProviderLike): StringMap => ({ ...(record.queryParams ?? {}) })

/* -------------------------------------------------------------------------- */
/* قناع الأسرار                                                               */
/* -------------------------------------------------------------------------- */

/** نفس قناع المفتاح: يُرسل إلى الواجهة مكان القيمة الحقيقية. */
export const SECRET_MASK = '••••••••'

export const isSecretMask = (value: string): boolean => value === SECRET_MASK

/** يُخفي كل قيمة في الخريطة مع إبقاء أسماء المفاتيح ظاهرة ليتعرّف المستخدم عليها. */
export function maskMap(map: StringMap | undefined): StringMap {
  const out: StringMap = {}
  for (const key of Object.keys(map ?? {}).sort()) out[key] = SECRET_MASK
  return out
}

/**
 * يدمج خريطة جديدة مع المحفوظة، بثلاث قواعد:
 *  - قيمة فارغة ⇐ احذف المدخل (الطريقة الوحيدة لتصفير ترويسة).
 *  - قيمة القناع `••••••••` ⇐ القيمة المحفوظة (الواجهة لا تعرف السر، فلا تفقده).
 *  - غير ذلك ⇐ استبدل.
 */
export function mergeSecretMap(current: StringMap, incoming: StringMap | undefined): StringMap {
  const out: StringMap = { ...current }
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (value === '') delete out[key]
    else if (!isSecretMask(value)) out[key] = value
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* ما تراه الواجهة                                                            */
/* -------------------------------------------------------------------------- */

/** ما تراه الواجهة — بلا مفتاح، فقط قناع. */
export const providerPublicSchema = providerRecordSchema
  .omit({ apiKeyEnc: true })
  .extend({
    keyMask: z.string(),
    hasKey: z.boolean(),
  })
export type ProviderPublic = z.infer<typeof providerPublicSchema>

/**
 * مُدخل نموذج إضافة/تعديل مزوّد.
 * ملاحظة: الحقول الثلاثة الأخيرة اختيارية حتى لا تنكسر أي شاشة تُنشئ المُدخل
 * بالحقول الستة القديمة وحدها.
 */
export const providerInputSchema = z.object({
  name: z.string().trim().min(1, 'الاسم مطلوب'),
  protocol: z.enum(PROTOCOLS),
  baseUrl: z.string().trim().min(1, 'الرابط مطلوب'),
  apiKey: z.string(),
  models: z.array(z.string().trim().min(1)).default([]),
  note: z.string().default(''),
  apiStyle: z.enum(API_STYLES).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
})
export type ProviderInput = z.infer<typeof providerInputSchema>

export interface TestResult {
  ok: boolean
  status: number | null
  latencyMs: number
  message: string
  modelsFound: number
}

export const emptyProviderInput = (): ProviderInput => ({
  name: '',
  protocol: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  models: [],
  note: '',
  apiStyle: DEFAULT_API_STYLE,
  headers: {},
  queryParams: {},
})

/** يبني مُدخل تعديل مزوّد محفوظ — الأسرار تُقنَّع كما في toPublic. */
export const inputFromPublic = (record: ProviderPublic): ProviderInput => ({
  name: record.name,
  protocol: record.protocol,
  baseUrl: record.baseUrl,
  apiKey: '',
  models: [...record.models],
  note: record.note,
  apiStyle: apiStyleOf(record),
  headers: maskMap(record.headers),
  queryParams: maskMap(record.queryParams),
})

export function toPublic(record: ProviderRecord): ProviderPublic {
  const { apiKeyEnc, ...rest } = record
  void apiKeyEnc
  return {
    ...rest,
    apiStyle: apiStyleOf(record),
    headers: maskMap(record.headers),
    queryParams: maskMap(record.queryParams),
    keyMask: record.apiKeyEnc ? SECRET_MASK : '—',
    hasKey: record.apiKeyEnc.length > 0,
    models: [...record.models],
  }
}
