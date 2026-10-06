import { z } from 'zod'

/**
 * عقد المزوّدات — مشترك بين العملية الرئيسية والواجهة.
 *
 * مبدأ التصميم: المفتاح لا يخرج أبدًا من العملية الرئيسية.
 * الواجهة تستقبل `keyMask` فقط، وترسل مفتاحًا جديدًا عند الحفظ ولا تستقبله بعده.
 */

export const PROTOCOLS = ['openai-compatible', 'anthropic', 'google'] as const
export type Protocol = (typeof PROTOCOLS)[number]

export const PROTOCOL_LABELS: Record<Protocol, { title: string; hint: string; defaultUrl: string; keyHint: string }> = {
  'openai-compatible': {
    title: 'OpenAI-compatible',
    hint: 'يغطي OpenAI و Groq و OpenRouter و DeepSeek و Together و Ollama و LM Studio و vLLM وأي بوابة أخرى',
    defaultUrl: 'https://api.openai.com/v1',
    keyHint: 'المفتاح مطلوب إلا في الخوادم المحلية (Ollama/LM Studio)',
  },
  anthropic: {
    title: 'Anthropic',
    hint: 'واجهة Claude الأصلية (tرويسة x-api-key)',
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

/** السجل المحفوظ على القرص — المفتاح فيه مشفّر بـ DPAPI. */
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
})
export type ProviderRecord = z.infer<typeof providerRecordSchema>

/** ما تراه الواجهة — بلا مفتاح، فقط قناع. */
export const providerPublicSchema = providerRecordSchema
  .omit({ apiKeyEnc: true })
  .extend({
    keyMask: z.string(),
    hasKey: z.boolean(),
  })
export type ProviderPublic = z.infer<typeof providerPublicSchema>

/** مُدخل نموذج إضافة/تعديل مزوّد. */
export const providerInputSchema = z.object({
  name: z.string().trim().min(1, 'الاسم مطلوب'),
  protocol: z.enum(PROTOCOLS),
  baseUrl: z.string().trim().min(1, 'الرابط مطلوب'),
  apiKey: z.string(),
  models: z.array(z.string().trim().min(1)).default([]),
  note: z.string().default(''),
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
})

export function toPublic(record: ProviderRecord): ProviderPublic {
  const { apiKeyEnc, ...rest } = record
  void apiKeyEnc
  return {
    ...rest,
    keyMask: record.apiKeyEnc ? '••••••••' : '—',
    hasKey: record.apiKeyEnc.length > 0,
    models: [...record.models],
  }
}