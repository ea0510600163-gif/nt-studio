# إضافة مزوّد OpenCode Go إلى NT Studio

- **التاريخ:** 2026-10-09
- **الحالة:** تصميم بانتظار المراجعة
- **المسار:** معماري (architectural)

## 1) الهدف

إضافة مزوّد مدمج اسمه **OpenCode Go** إلى التطبيق بحيث:

1. يختار المستخدم المزوّد من زر إعداد جاهز، فلا يُدخل إلا **مفتاح API**.
2. تُملأ تلقائياً قائمة كل نماذج OpenCode Go (36 نموذجاً) **بمعلوماتها الصحيحة** لكل نموذج: القدرات (أدوات/صور)، حجم السياق، و**نقطة الاتصال الصحيحة**.
3. يتوجّه كل نموذج تلقائياً إلى المسار الصحيح: `/chat/completions` أو `/messages` أو `/responses`.
4. تُرسَل ترويسة الجلسة **`x-opencode-session`** مع كل طلب — وهذا يصلح خطأ `HTTP 400: Request is missing x-opencode-session` الظاهر حالياً.

## 2) مصدر الحقيقة (Source of Truth)

طريقة الاتصال مأخوذة من Runtime تطبيق OpenCode نفسه، لا بالتخمين:

- الرابط الأساسي: `https://opencode.ai/zen/go/v1` (الحزمة الافتراضية `@ai-sdk/openai-compatible`).
- تفرّع المسار حسب حزمة النموذج (`provider.npm` في models.dev — وهو الكتالوج الذي يستخدمه OpenCode فعلاً). كل نموذج يحمل حزمة صريحة أو يرث الحزمة الافتراضية للمزوّد:
  - الافتراضية `@ai-sdk/openai-compatible` → `POST /chat/completions` (النمط `openai`).
  - `@ai-sdk/anthropic` → `POST /messages` (النمط `anthropic`).
  - `@ai-sdk/openai` → `POST /responses` (النمط `responses` — OpenAI Responses API).
- ترويسة الجلسة مؤكَّدة من `opencode-cli.exe`: `x-opencode-session` بمعرّف ثابت لكل محادثة، إضافةً إلى User-Agent مميز للعميل.

### مواصفة سلوك OpenCode Go (من المستندات الرسمية)

| الحزمة | المسار | النماذج |
|---|---|---|
| `@ai-sdk/openai-compatible` | `/chat/completions` | 23 |
| `@ai-sdk/anthropic` | `/messages` | 6 |
| `@ai-sdk/openai` | `/responses` | 7 |

> يجب أن يرسل العميل User-Agent خاصاً به (مثل `my-coding-agent/1.0`) و`x-opencode-session` ثابتاً لكل محادثة.

## 3) خارج النطاق (Non-goals)

- مزوّد OpenCode Zen غير Go، وأي مزوّد/بروتوكول آخر من models.dev.
- لا تغيير في واجهة الدردشة، الأدوات، المعاينة، أو حلقة الوكيل عدا تمرير معرّف الجلسة.
- لا تغيير في بروتوكولي OpenAI Chat Completions وAnthropic Messages القائمين؛ كل ما فيهما يبقى كما هو.

## 4) تغييرات نموذج البيانات

### `src/shared/types.ts`

```ts
export type ApiStyle = 'openai' | 'anthropic' | 'responses'   // + responses

export interface ModelInfo {
  id: string
  tools: boolean
  vision: boolean
  contextWindow: number
  apiStyle?: ApiStyle        // جديد: مسار هذا النموذج (يتجاوز نمط المزوّد)
}

export interface ProviderPublic {
  // ... كما هو
  opencode?: boolean         // جديد: علم لتمرير ترويسات OpenCode (session + UA)
}

export interface ProviderInput {
  // ... كما هو
  opencode?: boolean
}
```

- `ModelInfo.apiStyle` اختياري؛ عند غيابه يُستخدم `provider.apiStyle` (سلوك اليوم بلا تغيير).
- `ProviderPublic.opencode` افتراضياً `undefined`/`false` للمزوّدين الحاليين — لا أثر عليهم.
- `ResolvedTarget` في `src/main/store/providers.ts` يكتسب `provider.opencode` ويمرّر `model.apiStyle`.

### `src/main/providers/types.ts`

```ts
export interface LlmRequest {
  system: string
  messages: Msg[]
  tools: ToolSchema[]
  target: ResolvedTarget
  signal: AbortSignal
  maxTokens: number
  sessionId?: string          // جديد: لترويسة x-opencode-session
}
```

## 5) الملفات الجديدة (المجلد المطلوب)

```
src/main/providers/opencode/
  catalog.ts    كتالوج OpenCode Go المضمَّن (من models.dev): BASE_URL + 36 نموذجاً بمعلوماتها ومسارها
  headers.ts    buildOpenCodeHeaders(baseUrl, sessionId): يضيف x-opencode-session وUser-Agent عند opencode
src/main/providers/responses.ts   عميل OpenAI Responses API بالبث (SSE) — نمط 'responses'
```

و`src/shared/models.ts` يكتسب الإعداد الجاهز `OpenCode Go` (رابط + كتالوج النماذج).

## 6) الكتالوج الكامل (36 نموذجاً)

الرابط: `https://opencode.ai/zen/go/v1` · الحقول: الاسم، المعرّف، أدوات، صور، نافذة السياق.

### مسار `/chat/completions` — النمط `openai` (23)

| الاسم | المعرّف | أدوات | صور | السياق |
|---|---|---|---|---|
| DeepSeek V4 Flash | `deepseek-v4-flash` | ✓ | — | 1000000 |
| DeepSeek V4 Flash Vision Exp | `deepseek-v4-flash-vision-exp` | ✓ | ✓ | 1000000 |
| DeepSeek V4 Pro (New) | `deepseek-v4-pro` | ✓ | — | 1000000 |
| DeepSeek V4.1 Flash | `deepseek-v4.1-flash` | ✓ | ✓ | 1000000 |
| GLM-5.2 | `glm-5.2` | ✓ | — | 1000000 |
| GLM-5.3 | `glm-5.3` | ✓ | — | 1000000 |
| GLM-5.3-Flash | `glm-5.3-flash` | ✓ | ✓ | 1000000 |
| Hy3 | `hy3` | ✓ | — | 256000 |
| Hy4 preview | `hy4-preview` | ✓ | — | 1024000 |
| Kimi K2.6 | `kimi-k2.6` | ✓ | ✓ | 262144 |
| Kimi K2.7 Code | `kimi-k2.7-code` | ✓ | ✓ | 262144 |
| Kimi K3 | `kimi-k3` | ✓ | ✓ | 1048576 |
| LongCat 2.5 Preview Free | `longcat-2.5-preview-free` | ✓ | ✓ | 1000000 |
| LongCat-2.0 | `longcat-2.0` | ✓ | — | 1000000 |
| MiMo V2.5 | `mimo-v2.5` | ✓ | ✓ | 1000000 |
| MiMo V2.5 Pro | `mimo-v2.5-pro` | ✓ | ✓ | 1048576 |
| MiMo-V2.6-Flash | `mimo-v2.6-flash` | ✓ | ✓ | 1048576 |
| MiMo-V2.6-Pro | `mimo-v2.6-pro` | ✓ | ✓ | 1048576 |
| Qwen3.6 Plus | `qwen3.6-plus` | ✓ | ✓ | 1000000 |
| Qwen3.7 Max | `qwen3.7-max` | ✓ | — | 1000000 |
| Space Bunny | `space-bunny` | ✓ | ✓ | 1048576 |
| Space Bunny Free | `space-bunny-free` | ✓ | ✓ | 1048576 |
| Step 5 Preview Free | `step-5-preview-free` | ✓ | ✓ | 1000000 |

### مسار `/messages` — النمط `anthropic` (6)

| الاسم | المعرّف | أدوات | صور | السياق |
|---|---|---|---|---|
| Claude Haiku 5.5 | `claude-haiku-5-5` | ✓ | ✓ | 1000000 |
| MiniMax-M2.7 | `minimax-m2.7` | ✓ | — | 204800 |
| MiniMax-M3 | `minimax-m3` | ✓ | — | 1000000 |
| Qwen3.7 Plus | `qwen3.7-plus` | ✓ | ✓ | 1000000 |
| Qwen3.8 Flash | `qwen3.8-flash` | ✓ | ✓ | 1000000 |
| Qwen3.8 Max | `qwen3.8-max` | ✓ | ✓ | 1000000 |

### مسار `/responses` — النمط `responses` (7)

| الاسم | المعرّف | أدوات | صور | السياق |
|---|---|---|---|---|
| GPT-5.6 Luna | `gpt-5.6-luna` | ✓ | ✓ | 1050000 |
| GPT-6 Luna | `gpt-6-luna` | ✓ | ✓ | 1050000 |
| Grok 4.5 | `grok-4.5` | ✓ | ✓ | 500000 |
| Grok 4.6 | `grok-4.6` | ✓ | ✓ | 500000 |
| Grok 4.7 | `grok-4.7` | ✓ | ✓ | 500000 |
| Muse Spark 1.2 Contributor | `muse-spark-1.2-contributor` | ✓ | ✓ | 1048576 |
| Muse Spark 1.3 Contributor | `muse-spark-1.3-contributor` | ✓ | ✓ | 1048576 |

## 7) تدفّق البيانات

1. في الواجهة يضغط المستخدم زر **OpenCode Go** → يُملأ: الاسم، `baseUrl`، `opencode: true`، والـ 36 نموذجاً مع `apiStyle` لكل منها. يبقى حقل واحد مطلوب: مفتاح API.
2. عند «حفظ والبدء» يُخزَّن المزوّد كما هو اليوم (المفتاح مشفَّر عبر `safeStorage`)، ويُختبر الاتصال في الخلفية.
3. عند الإرسال: تُبنى `ResolvedTarget` (تضم `opencode` و`apiStyle` للنموذج)، وتمرّر الحلقة `s.id` كـ `sessionId`.
4. يختار `callLlm` الدالة حسب `model.apiStyle ?? provider.apiStyle`:
   - `openai` → `openai()` (قائم كما هو)
   - `anthropic` → `anthropic()` (قائم كما هو)
   - `responses` → `responses()` (جديد)
5. تُضاف ترويسات OpenCode (`x-opencode-session` + UA) إلى كل طلب عندما `provider.opencode === true`.

## 8) عميل Responses API (`responses.ts`)

المسار: `POST {base}/responses`، ترويسة `accept: text/event-stream`.

**جسم الطلب:**
```jsonc
{
  "model": "<id>",
  "instructions": "<system>",
  "input": [ /* عناصر input */ ],
  "stream": true,
  "max_output_tokens": N,
  "tools": [{ "type": "function", "name": "...", "description": "...", "parameters": { } }]
}
```

**تحويل الرسائل إلى `input`:**
- رسالة مستخدم نصية → `{ role: "user", content: [{ type: "input_text", text }] }`
- صورة → `{ type: "input_image", image_url: "data:..." }`
- نداء أداة سابق → `{ type: "function_call", call_id, name, arguments }`
- نتيجة أداة → `{ type: "function_call_output", call_id, output }`

**أحداث SSE المتتبَّعة:**
- `response.output_item.added` / `response.output_item.done` — لتثبيت عناصر `function_call` و`message`.
- `response.output_text.delta` — نص متدفّق.
- `response.function_call_arguments.delta` — تجميع معطيات الأداة حسب `item_id`.
- `response.completed` / `response.incomplete` — الإنهاء وقراءة `usage`.
- `response.failed` / `error` — خطأ (يُصنَّف retryable عند overload/rate).

**النتيجة:** `Block[]` بنفس شكل الأنماط الأخرى (`text` / `tool_use`)، و`stop` أحد `end | tool_use | max_tokens`، و`usage` من `input_tokens/output_tokens`.

## 9) معالجة الأخطاء

- تبقى `httpError` و`classifyStatus` كما هما؛ الرسالة `HTTP 400: Request is missing x-opencode-session` ستختفي بعد إضافة الترويسة.
- أخطاء Responses (`response.failed`) تُحوَّل إلى `LlmError` بالتصنيف المناسب.
- انقطاع البث أو رد بلا اكتمال → `LlmError` retryable (كما في الأنماط الحالية).

## 10) الاختبار

- **وحدة (Node `--test` أو سكربت تحقق):** `headers.ts` (يضيف الترويسة ويحافظ على البقية)، اختيار المسار لكل نموذج، ومحلّل SSE لـ Responses فوق بث اصطناعي (نص + أدوات + usage + أخطاء).
- **حيّ:** زر «اختبار الاتصال» الحالي على نموذج واحد من كل مسار (مثلاً `glm-5.3-flash`، `claude-haiku-5-5`، `grok-4.7`).
- **عدم الانحدار:** التأكد من أن مزوّداً عادياً (OpenAI/Anthropic) لا يرسل ترويسات OpenCode، وأن النماذج بلا `apiStyle` تعمل كالسابق.

## 11) معايير القبول

1. اختيار «OpenCode Go» + مفتاح API فقط → 36 نموذجاً تظهر بمعلوماتها الصحيحة.
2. طلب على نموذج `chat/completions` ينجح.
3. طلب على نموذج `messages` ينجح.
4. طلب على نموذج `responses` ينجح (أدوات + نص).
5. لا يظهر خطأ `x-opencode-session`.
6. المزوّدون الحاليون يعملون بلا أي تغيير في سلوكهم.
