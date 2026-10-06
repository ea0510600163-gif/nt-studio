import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  DEFAULT_API_STYLE,
  PROTOCOLS,
  PROTOCOL_LABELS,
  apiStyleOf,
  emptyProviderInput,
  inputFromPublic,
  isSecretMask,
  type ApiStyle,
  type Protocol,
  type ProviderInput,
  type ProviderPublic,
  type StringMap,
  type TestResult,
} from '../../../shared/providers'
import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  Field,
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronUp,
  IconButton,
  IconEye,
  IconEyeOff,
  IconInfo,
  IconPencil,
  IconPlug,
  IconPlus,
  IconRotate,
  IconTrash,
  Input,
  KeyHint,
  Select,
  Spinner,
  Textarea,
  Toast,
  ToastRegion,
  Tooltip,
  TONE_ALERT,
  cx,
  type SelectOption,
  type Tone,
} from './ui'

/* ========================================================================== *
 *  شاشة المزوّدات — أول شاشة تتبنّى نظام التصميم.
 *
 *  كل ما كان هنا قبل هذا الملف مكتوبًا بأرقام عشوائية داخل أسماء الأصناف
 *  (أحجام خطوط بـ«نصّ + قوس مربّع»)، وبألوان قديمة بأسمائها المنسوخة، وبعناصر
 *  بلا أسماء للوصول إليها. ما يلي يُعيد بناءها على `components/ui` بالكامل،
 *  ويصلح العيوب المقيسة في `w2-b1-brief.md`.
 *
 *  ثلاث قواعد لا تُكسر هنا:
 *   1) **لا قيمة عشوائية**: كل لون وحجم ونصف قطر يأتي من `theme.css` عبر
 *      مكوّنات `ui/`. لا قيمة داخل قوس مربّع في اسم صنف، ولا لون حرّ.
 *   2) **لا خاصية فيزيائية**: الحشوات والحواف منطقية (`ps` / `pe` / `ms` /
 *      `me` / `start` / `end`). الفخّ الحقيقي في الشاشة القديمة كان حشوة
 *      يسارية على حقل المفتاح يقابلها موضع يساري مطلق لزرّ الإظهار —
 *      الاثنان يتلغيان بالصدفة، فتغيير أحدهما وحده ينقل الزرّ إلى الجهة
 *      الخاطئة فيغطّي مؤشر الكتابة.
 *   3) **كل نداء IPC في `try/catch`**: لا `void handler()` بلا التقاط.
 * ========================================================================== */

interface Props {
  providers: ProviderPublic[]
  onChanged: (next: ProviderPublic[]) => void
  onClose?: () => void
}

/* ------------------------------------------------------------------ نصوص */

const PRODUCT_NAME = 'NT Studio'

const PROTOCOL_OPTIONS: readonly SelectOption<Protocol>[] = PROTOCOLS.map((value) => ({
  value,
  label: PROTOCOL_LABELS[value].title,
  hint: PROTOCOL_LABELS[value].hint,
}))

/**
 * صيغة الواجهة — الشرح هنا هو ما طلبه المستخدم: متى `/chat/completions`
 * ومتى `/responses`. wave 1 أضاف `apiStyle` إلى العقد، فلم يعد الاختيار
 * مخفيًّا خلف قيمة صامتة.
 */
const API_STYLE_OPTIONS: readonly SelectOption<ApiStyle>[] = [
  {
    value: 'chat-completions',
    label: 'chat/completions',
    hint: 'يرسل الطلب إلى ‎{base}/chat/completions — يصلح لأغلب البوابات وOpenAI وGroq وOpenRouter وOllama.',
  },
  {
    value: 'responses',
    label: 'responses',
    hint: 'يرسل الطلب إلى ‎{base}/responses — تخدمه بعض البوابات وحده، وتردّ على ‎/chat/completions‎ بـ404.',
  },
]

/* ------------------------------------------------------- أدوات نصّية عربية */

interface PluralForms {
  /** 1 · «دقيقة» */
  one: string
  /** 2 · «دقيقتين» */
  two: string
  /** 3–10 · «5 دقائق» */
  few: string
  /** 11+ · «15 دقيقة» */
  many: string
}

/** جمع عربي صحيح: مفرد · مثنى · جمع قلّة (3–10) · تمييز مفرد منصوب (11+). */
function unitWords(n: number, forms: PluralForms): string {
  if (n === 1) return forms.one
  if (n === 2) return forms.two
  if (n <= 10) return `${n} ${forms.few}`
  return `${n} ${forms.many}`
}

const minutesWord = (n: number): string =>
  unitWords(n, { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة' })
const hoursWord = (n: number): string =>
  unitWords(n, { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة' })
const daysWord = (n: number): string => unitWords(n, { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يومًا' })

/** «نموذج واحد» · «نموذجان» · «7 نماذج» · «120 نموذجًا». */
function modelsWord(n: number): string {
  if (n === 0) return 'بلا نماذج'
  return unitWords(n, { one: 'نموذج واحد', two: 'نموذجان', few: 'نماذج', many: 'نموذجًا' })
}

/** «قبل 4 دقائق» — `lastTestedAt` كان مخزَّنًا ولا يُعرض إطلاقًا. */
function relativeTime(timestamp: number, now: number): string {
  const diff = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return 'قبل لحظات'
  if (diff < hour) return `قبل ${minutesWord(Math.floor(diff / minute))}`
  if (diff < day) return `قبل ${hoursWord(Math.floor(diff / hour))}`
  if (diff < 30 * day) return `قبل ${daysWord(Math.floor(diff / day))}`
  return new Date(timestamp).toLocaleDateString('ar-EG', { dateStyle: 'medium' })
}

/** رسالة عربية من أي خطأ مرفوض، بلا `undefined` ولا `Error: Error: …`. */
function messageOf(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  const text = raw.trim()
  return text.length > 0 ? text : fallback
}

/* -------------------------------------------------------- تطبيع الرابط */

/**
 * **مرآة** لـ`normalizeBaseUrl` + `splitEndpoint` في `src/main/core/providers.ts:113`.
 *
 * لماذا مرآة لا استيراد؟ الدالة تعيش في العملية الرئيسية (تلتفّ `@ai-sdk/*`)
 * والواجهة لا تستطيع استيرادها؛ و`src/shared/providers.ts` لا يصدّرها.
 * فلم يبقَ إلا عرض ما **سيُحفظ فعلًا** قبل الحفظ — وهو أصلح سببٍ لعرضه.
 *
 * ⚠️ هذه نسخة ثانية من قاعدة واحدة. التطابق مضمون باختبار جدول حرفي في
 * `tests/providers-screen.test.tsx`، لكن الجذر الصحيح هو نقل الدالة إلى
 * `src/shared/`. (موثّق في تقرير المرحلة.)
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
] as const

const VERSION_SEGMENT = /(?:^|\/)v\d+(?:(?:beta|alpha)\d*)?(?=\/|$)/i
const MODEL_ID_TAIL = /\/(?:models|tunedModels)\/[^/]+$/i

const DEFAULT_VERSION: Record<Protocol, string> = {
  'openai-compatible': 'v1',
  anthropic: 'v1',
  google: 'v1beta',
}

/** نفس `trimPath` في العملية الرئيسية: يحذف الشرطة الطرفية ويعيد `/`. */
function trimPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** نفس `isLocalHost` في العملية الرئيسية: خادم محلي نادرًا ما يملك شهادة. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host === 'host.docker.internal' || host.endsWith('.host.docker.internal')) {
    return true
  }
  if (host.includes(':')) {
    return host === '::1' || host === '0:0:0:0:0:0:0:1' || /^f[cd]/.test(host) || host.startsWith('fe80:')
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (m === null) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** نفس `guessScheme`: http للمضيفات المحلية بلا مخطّط، https لغيرها. */
function guessScheme(input: string): 'http' | 'https' {
  try {
    return isLocalHost(new URL(`http://${input.replace(/^\/+/, '')}`).hostname) ? 'http' : 'https'
  } catch {
    return 'https'
  }
}

export interface NormalisedUrl {
  /** جذر الـ API كما سيُحفظ (بلا سلسلة استعلام). */
  base: string
  /** معاملات تُنزع من الرابط وتُحفظ في خانة `queryParams`. */
  params: [string, string][]
}

export function previewBaseUrl(raw: string, protocol: Protocol): NormalisedUrl {
  const input = String(raw ?? '').trim()
  if (input === '') return { base: '', params: [] }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
  let url: URL
  try {
    url = new URL(hasScheme ? input : `${guessScheme(input)}://${input}`)
  } catch {
    return { base: input.replace(/\/+$/, ''), params: [] }
  }

  const lower = url.pathname.toLowerCase()
  let path = trimPath(url.pathname)
  let completeEndpoint = false

  for (const suffix of ENDPOINT_SUFFIXES) {
    if (!lower.endsWith(suffix.toLowerCase())) continue
    path = trimPath(path.slice(0, path.length - suffix.length))
    if (suffix.startsWith(':')) {
      completeEndpoint = true
      path = path.replace(MODEL_ID_TAIL, '')
    }
    break
  }

  path = trimPath(path)
  if (!completeEndpoint && !VERSION_SEGMENT.test(path)) {
    path = path === '/' ? `/${DEFAULT_VERSION[protocol]}` : `${path}/${DEFAULT_VERSION[protocol]}`
  }
  url.pathname = path

  const params: [string, string][] = []
  url.searchParams.forEach((value, key) => params.push([key, value]))
  url.search = ''

  return { base: url.toString().replace(/\/+$/, ''), params }
}

/** رسالة عربية لكل خطأ في الرابط قبل أن يصل إلى الـSDK. */
function baseUrlProblem(raw: string): string | null {
  const input = raw.trim()
  if (input === '') return 'اكتب رابط المزوّد — مثال: https://api.openai.com/v1'
  if (/\s/.test(input)) return 'الرابط لا يقبل مسافات — انسخه من شريط العنوان كاملًا.'
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
  if (hasScheme && !/^https?:\/\//i.test(input)) {
    return 'بروتوكول غير مدعوم — استخدم https، أو http للخوادم المحلية فقط.'
  }
  try {
    new URL(hasScheme ? input : `https://${input}`)
  } catch {
    return 'الرابط غير صالح — اكتبه هكذا: api.example.com أو https://api.example.com/v1'
  }
  return null
}

/* ------------------------------------------------- ترجمة نتيجة الاختبار */

interface ProbeCopy {
  /** العنوان — يحمل رمز الحالة كما هو. */
  title: string
  /** ماذا يعني الرمز بلغة المستخدم. */
  reason: string
  /** ماذا يفعل الآن. */
  advice: string
}

/**
 * `TestResult.status` موجود في العقد منذ الأزل — ولم تعرضه الواجهة قط، فكان
 * كل فشل يظهر كجملة واحدة لا يستطيع المستخدم التصرّف بناءً عليها.
 * لكل رمزٍ معناه كتابة عربية مختلفة.
 */
export function describeProbeFailure(res: TestResult): ProbeCopy {
  switch (res.status) {
    case 401:
      return {
        title: 'المفتاح مرفوض (401)',
        reason: 'رفض المزوّد المفتاح: إمّا أنه غير صحيح أو منتهي الصلاحية، أو أن الحساب لا يملك صلاحية الوصول.',
        advice: 'انسخ المفتاح كاملًا بلا مسافة قبله أو بعده، وتأكد أنه من هذا المزوّد بالذات — فمفتاح بوابة أخرى يُرفض دائمًا.',
      }
    case 403:
      return {
        title: 'الطلب محجوب (403)',
        reason: 'المفتاح مقبول، لكن المزوّد رفض الطلب نفسه.',
        advice: 'راجع قيود الـUser-Agent وعنوان الـIP عند المزوّد، أو جرّب مزوّدًا آخر.',
      }
    case 404:
      return {
        title: 'المسار غير موجود (404)',
        reason: 'الرابط موجود لكن المسار المطلوب غير موجود عليه.',
        advice: 'اكتب جذر الـAPI لا نقطة النهاية (بلا ‎/chat/completions‎)، وإن كانت البوابة تخدم ‎/responses‎ وحده فاختر صيغة «responses».',
      }
    case 400:
      return {
        title: 'طلب مرفوض (400)',
        reason: 'المزوّد لم يقبل معاملات الطلب.',
        advice: 'تأكد أن اسم النموذج صحيح ومتاح لحسابك — فبعض النماذج ترفض معاملات مثل ‎max_tokens‎.',
      }
    case 429:
      return {
        title: 'تجاوز الحدّ (429)',
        reason: 'تجاوزت حصة الطلبات أو التوكنات مؤقتًا.',
        advice: 'انتظر قليلًا ثم أعد الاختبار — هذا الخطأ لا يشير إلى خطأ في إعداداتك.',
      }
    default: {
      if (res.status !== null && res.status >= 500) {
        return {
          title: `خطأ من الخادم (${res.status})`,
          reason: 'أعاد المزوّد خطأ داخليًا في خادمه.',
          advice: 'هذه مشكلة عند المزوّد لا عندك — أعد المحاولة لاحقًا.',
        }
      }
      return {
        title: 'تعذّر الاتصال بالمزوّد',
        reason: res.message.trim() === '' ? 'لم يصل أي ردّ من المزوّد.' : res.message.trim(),
        advice: 'تحقق من الرابط ومن الاتصال بالإنترنت، ومن أن البروتوكول المختار هو الصحيح.',
      }
    }
  }
}

/* ------------------------------------------------------- أدوات النماذج */

/** لصق `a, b, c` كان يُنتج رقاقةً واحدة اسمها `a, b, c`. */
function splitModelTokens(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

/** يزيل المدخلات ذات الاسم الفارغ أو القيمة الفارغة قبل الإرسال. */
function cleanMap(map: StringMap | undefined): StringMap {
  const out: StringMap = {}
  for (const [key, value] of Object.entries(map ?? {})) {
    const name = key.trim()
    const text = value.trim()
    if (name !== '' && text !== '') out[name] = text
  }
  return out
}

interface FieldErrors {
  name?: string
  baseUrl?: string
  models?: string
}

/* ========================================================================== *
 *  لوح صغير — رسالة واحدة بدور الوصول الصحيح واسم صحيح لقارئ الشاشة
 * ========================================================================== */

interface BannerProps {
  tone: Tone
  title: ReactNode
  children?: ReactNode
}

function Banner({ tone, title, children }: BannerProps): JSX.Element {
  const urgent = tone === 'danger' || tone === 'warn'
  const icon =
    tone === 'success' ? (
      <IconCheck size={16} />
    ) : tone === 'danger' ? (
      <IconAlertCircle size={16} />
    ) : (
      <IconAlertTriangle size={16} />
    )

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      className={cx('grid gap-1 rounded-xl border p-3', TONE_ALERT[tone])}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden="true">{icon}</span>
        {title}
      </p>
      {children === undefined || children === null ? null : (
        // `user-select: none` على `body` في `theme.css` كان يمنع نسخ نص الخطأ
        // واسم النموذج والرابط — وهذه الشاشة كلّها أخطاء وروابط.
        <div className="select-text text-sm leading-relaxed text-text-secondary">{children}</div>
      )}
    </div>
  )
}

/* ========================================================================== *
 *  محرّر خريطة (ترويسات / معاملات استعلام) — صفوف قابلة للإضافة والحذف
 * ========================================================================== */

interface MapEditorProps {
  legend: string
  description: ReactNode
  rows: StringMap
  onChange: (next: StringMap) => void
  addLabel: string
  namePlaceholder: string
  valuePlaceholder: string
  removeLabelFor: (key: string) => string
}

function MapEditor({
  legend,
  description,
  rows,
  onChange,
  addLabel,
  namePlaceholder,
  valuePlaceholder,
  removeLabelFor,
}: MapEditorProps): JSX.Element {
  const entries = Object.entries(rows)

  const update = (index: number, key: string, value: string): void => {
    const next: StringMap = {}
    entries.forEach(([existingKey, existingValue], at) => {
      if (at === index) {
        const name = key.trim()
        if (name !== '' && value !== '') next[name] = value
        return
      }
      next[existingKey] = existingValue
    })
    onChange(next)
  }

  return (
    <fieldset className="grid gap-2 rounded-lg border border-line bg-surface-1 p-3">
      <legend className="px-1 text-sm font-semibold text-text-secondary">{legend}</legend>
      <p className="text-xs leading-relaxed text-text-muted">{description}</p>

      {entries.length === 0 ? (
        <p className="text-xs text-text-muted">لا يوجد أي مُدخل.</p>
      ) : (
        entries.map(([key, value], index) => {
          const masked = isSecretMask(value)
          return (
            <div key={`${index}-${key}`} className="flex items-end gap-2">
              <Field label={`اسم ${legend} ${index + 1}`} hideLabel className="min-w-0 flex-1">
                {({ id, ...aria }) => (
                  <Input
                    id={id}
                    {...aria}
                    size="sm"
                    mono
                    dir="ltr"
                    value={key}
                    placeholder={namePlaceholder}
                    onChange={(e) => update(index, e.target.value, value)}
                  />
                )}
              </Field>
              <Field
                label={`قيمة ${legend} ${index + 1}`}
                hideLabel
                className="min-w-0 flex-1"
                hint={masked ? 'قيمة محفوظة مشفّرة — اتركها كما هي للإبقاء عليها.' : undefined}
              >
                {({ id, ...aria }) => (
                  <Input
                    id={id}
                    {...aria}
                    size="sm"
                    mono={!masked}
                    dir="ltr"
                    // القناع `••••••••` ليس قيمةً حقيقية — لا يُعرض كنصّ مموّه.
                    type={masked ? 'password' : 'text'}
                    value={value}
                    placeholder={valuePlaceholder}
                    onChange={(e) => update(index, key, e.target.value)}
                  />
                )}
              </Field>
              <IconButton
                icon={<IconTrash size={15} />}
                label={removeLabelFor(key === '' ? 'هذا المدخل' : key)}
                tone="danger"
                size="sm"
                onClick={() => {
                  const next: StringMap = {}
                  entries.forEach(([k, v], at) => {
                    if (at !== index) next[k] = v
                  })
                  onChange(next)
                }}
              />
            </div>
          )
        })
      )}

      <div>
        <Button size="sm" variant="secondary" leading={<IconPlus size={14} />} onClick={() => onChange({ ...rows, '': '' })}>
          {addLabel}
        </Button>
      </div>
    </fieldset>
  )
}

/* ========================================================================== *
 *  الشاشة
 * ========================================================================== */

export default function ProvidersScreen({ providers, onChanged, onClose }: Props): JSX.Element {
  const [form, setForm] = useState<ProviderInput>(emptyProviderInput)
  const [modelDraft, setModelDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [alert, setAlert] = useState<BannerProps | null>(null)
  const [notice, setNotice] = useState<{ tone: Tone; title: ReactNode; body?: ReactNode; sticky?: boolean } | null>(
    null,
  )
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // حالة **لكل عملية** على حدة: `busy` واحد كان يعطّل الأزرار الخمسة معًا،
  // ومنها «اختبار» على صفّ آخر لا علاقة له بالعملية الجارية.
  const [probing, setProbing] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testingIds, setTestingIds] = useState<readonly string[]>([])
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [confirmRemove, setConfirmRemove] = useState<ProviderPublic | null>(null)
  const [lastProbeFailed, setLastProbeFailed] = useState(false)

  const refreshSeq = useRef(0)
  const booted = useRef(false)

  const meta = PROTOCOL_LABELS[form.protocol]
  const style = form.apiStyle ?? DEFAULT_API_STYLE
  const headers = form.headers ?? {}
  const queryParams = form.queryParams ?? {}
  const typedBaseUrl = form.baseUrl.trim()

  /* ------------------------------------------------------- تحميل القائمة */

  /**
   * `refresh()` كان بلا التقاط: أي رفض كان يختفي بصمت.
   * وطلبان متداخلان كانا يستطيعان الكتابة فوق بعضهما، فلا نتيجة واحدة تفوز.
   */
  const refreshList = useCallback(async (): Promise<ProviderPublic[]> => {
    const seq = refreshSeq.current + 1
    refreshSeq.current = seq
    setLoadingList(true)
    try {
      const list = await window.studio.providers.list()
      if (refreshSeq.current !== seq) return list
      setListError(null)
      onChanged(list)
      return list
    } catch (e) {
      if (refreshSeq.current === seq) {
        setListError(messageOf(e, 'تعذّر قراءة المزوّدات المحفوظة من القرص'))
      }
      return []
    } finally {
      if (refreshSeq.current === seq) setLoadingList(false)
    }
  }, [onChanged])

  // قراءة واحدة عند الإقلاع: بدونها لا يمكن التمييز بين «لا يوجد مزوّد بعد»
  // و«جارٍ القراءة» و«فشلت القراءة».
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void refreshList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------ النماذج */

  /** المسودة التي لم تُضَف بعد — سبب «زرّ حفظ حيّ وصفر رقائق ظاهرة». */
  const pendingDraft = modelDraft.trim().replace(/,$/, '')

  const effectiveModels = useMemo((): string[] => {
    if (pendingDraft === '' || form.models.includes(pendingDraft)) return form.models
    return [...form.models, pendingDraft]
  }, [form.models, pendingDraft])

  const mergeModels = (tokens: string[]): string[] => {
    const merged = [...form.models]
    for (const token of tokens) {
      if (!merged.includes(token)) merged.push(token)
    }
    setForm((f) => ({ ...f, models: merged }))
    return merged
  }

  /** يعتمد ما كُتب في الحقل قبل أي إجراء — «اكتب ثم اختبار» بلا Enter. */
  const commitDraftModels = (): string[] => {
    const tokens = splitModelTokens(modelDraft)
    if (tokens.length === 0) return form.models
    const merged = mergeModels(tokens)
    setModelDraft('')
    return merged
  }

  const onModelsKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' && event.key !== ',') return
    event.preventDefault()
    commitDraftModels()
  }

  const onModelsPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const text = event.clipboardData.getData('text')
    if (splitModelTokens(text).length < 2) return // سطر واحد — نترك المتصفح
    event.preventDefault()
    mergeModels(splitModelTokens(`${modelDraft} ${text}`))
    setModelDraft('')
  }

  const removeModel = (model: string): void => {
    setForm((f) => ({ ...f, models: f.models.filter((m) => m !== model) }))
    setLastProbeFailed(false)
  }

  /* ---------------------------------------------------------- أدوات أخرى */

  const patch = (p: Partial<ProviderInput>): void => {
    setForm((f) => ({ ...f, ...p }))
    // أي تعديل يُبطل نتيجة اختبارٍ سابق: لم تعد تصف هذا النموذج.
    setLastProbeFailed(false)
    setFieldErrors((prev) => {
      const keys = Object.keys(p) as (keyof FieldErrors)[]
      if (!keys.some((key) => prev[key] !== undefined)) return prev
      const next: FieldErrors = { ...prev }
      for (const key of keys) delete next[key]
      return next
    })
  }

  const normalised = useMemo(() => previewBaseUrl(typedBaseUrl, form.protocol), [typedBaseUrl, form.protocol])
  const showNormalised = typedBaseUrl !== '' && normalised.base !== '' && normalised.base !== typedBaseUrl

  /**
   * تغيير البروتوكول كان يبقي `https://api.openai.com/v1` في الحقل، ثم يختبره
   * بترويسة `x-api-key` — فين اتصال OpenAI فاشلًا باسم بروتوكول Claude.
   * لذلك يُمسح كل ما هو شُكْل البروتوكول، ويُبقى ما هو إعداد البوابة.
   */
  const onProtocolChange = (next: Protocol): void => {
    setForm({
      ...emptyProviderInput(),
      protocol: next,
      apiStyle: DEFAULT_API_STYLE,
      headers: form.headers ?? {},
      queryParams: form.queryParams ?? {},
    })
    setModelDraft('')
    setShowKey(false)
    setEditingId(null)
    setFieldErrors({})
    setAlert(null)
    setLastProbeFailed(false)
    setNotice({
      tone: 'warn',
      title: 'تغيّر البروتوكول',
      body: 'حُذف الرابط والمفتاح والنماذج من النموذج — كانت مضبوطة على البروتوكول السابق.',
      sticky: true,
    })
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setForm(emptyProviderInput())
    setModelDraft('')
    setShowKey(false)
    setFieldErrors({})
    setLastProbeFailed(false)
    setAlert(null)
    setNotice(null)
  }

  /**
   * `startEdit` كان يبقي `modelDraft` السابق، فتسريب مسودة مزوّد إلى آخر
   * كان يُحفظ معه. `showKey` أيضًا: مفتاح مكشوف يبقى مكشوفًا للمزوّد التالي.
   */
  const startEdit = (p: ProviderPublic): void => {
    setEditingId(p.id)
    setForm(inputFromPublic(p))
    setModelDraft('')
    setShowKey(false)
    setFieldErrors({})
    setAlert(null)
    setLastProbeFailed(p.lastTestOk === false)
    setNotice({
      tone: 'accent',
      title: `وضع التعديل — «${p.name}»`,
      body: 'المفتاح الحالي مشفّر على جهازك ولا يعود إلى الواجهة؛ اترك حقل المفتاح فارغًا للإبقاء عليه.',
      sticky: true,
    })
  }

  const validate = (): FieldErrors | null => {
    const next: FieldErrors = {}
    if (form.name.trim() === '') next.name = 'اكتب اسمًا يميّز هذا المزوّد في القائمة.'
    const urlProblem = baseUrlProblem(form.baseUrl)
    if (urlProblem !== null) next.baseUrl = urlProblem
    if (effectiveModels.length === 0) {
      next.models = 'أضف اسم نموذج واحدًا على الأقل — اكتبه هنا أو اضغط «جلب النماذج».'
    }
    return Object.keys(next).length > 0 ? next : null
  }

  const rejectInvalid = (): boolean => {
    const problems = validate()
    if (problems === null) return false
    setFieldErrors(problems)
    setAlert({
      tone: 'warn',
      title: 'البيانات غير مكتملة',
      children: 'أكمل الحقول المعلَّمة بالأحمر قبل المتابعة.',
    })
    return true
  }

  /* ------------------------------------------------------------- الاختبار */

  const doProbe = async (): Promise<void> => {
    if (rejectInvalid()) return
    const models = commitDraftModels()
    setProbing(true)
    setAlert(null)
    setNotice(null)
    try {
      const res = await window.studio.providers.probe({
        name: form.name.trim() || 'مزوّد',
        protocol: form.protocol,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        models,
      })
      if (res.ok) {
        setLastProbeFailed(false)
        setNotice({
          tone: 'success',
          title: 'نجح الاتصال',
          body: (
            <>
              {res.message}
              {' · '}
              <span className="num">{res.latencyMs} مللي ثانية</span>
            </>
          ),
        })
      } else {
        const copy = describeProbeFailure(res)
        setLastProbeFailed(true)
        setAlert({
          tone: 'danger',
          title: copy.title,
          children: (
            <>
              <p>{copy.reason}</p>
              <p className="mt-1">{copy.advice}</p>
              <p className="mt-1 text-xs text-text-muted">ردّ المزوّد: {res.message}</p>
            </>
          ),
        })
      }
    } catch (e) {
      // العيب الأصلي: `doProbe` كان بلا catch و`void` يُخفي الرفض تمامًا.
      setLastProbeFailed(true)
      setAlert({
        tone: 'danger',
        title: 'تعذّر تشغيل الاختبار',
        children: messageOf(e, 'حدث خطأ غير متوقع أثناء الاختبار'),
      })
    } finally {
      setProbing(false)
    }
  }

  const doTestSaved = async (p: ProviderPublic): Promise<void> => {
    if (testingIds.includes(p.id)) return // قفل: نقرتان لا تعطيان اختبارين
    setTestingIds((ids) => [...ids, p.id])
    setAlert(null)
    setNotice(null)
    try {
      const res = await window.studio.providers.testSaved(p.id)
      if (res.ok) {
        setNotice({
          tone: 'success',
          title: `«${p.name}»: الاتصال ناجح`,
          body: (
            <>
              {res.message}
              {' · '}
              <span className="num">{res.latencyMs} مللي ثانية</span>
            </>
          ),
        })
      } else {
        const copy = describeProbeFailure(res)
        setAlert({
          tone: 'danger',
          title: `«${p.name}»: ${copy.title}`,
          children: (
            <>
              <p>{copy.reason}</p>
              <p className="mt-1">{copy.advice}</p>
              <p className="mt-1 text-xs text-text-muted">ردّ المزوّد: {res.message}</p>
            </>
          ),
        })
      }
      await refreshList()
    } catch (e) {
      // العيب الأصلي: `doTestSaved` بلا catch ولا `void` معالج — رفضُ الـIPC
      // كان يختفي بلا أثر يُرى.
      setAlert({
        tone: 'danger',
        title: `تعذّر اختبار «${p.name}»`,
        children: messageOf(e, 'رفضت العملية الرئيسية تنفيذ الاختبار'),
      })
    } finally {
      setTestingIds((ids) => ids.filter((id) => id !== p.id))
    }
  }

  /* ----------------------------------------------------------- جلب النماذج */

  /**
   * كان `patch({ models: res.models })` — أي استبدال كامل. كل نموذج كتبه
   * المستخدم بيده كان يُمحى بلا تأكيد ولا أثر ولا تراجع. الآن **دمج**:
   * ما كتبه يبقى أولًا، والجديد يُضاف، ويظهر الفرق في إشعار.
   */
  const doFetchModels = async (): Promise<void> => {
    const urlProblem = baseUrlProblem(form.baseUrl)
    if (urlProblem !== null) {
      setFieldErrors((prev) => ({ ...prev, baseUrl: urlProblem }))
      setAlert({
        tone: 'warn',
        title: 'الرابط غير صالح',
        children: urlProblem,
      })
      return
    }
    setFetching(true)
    setAlert(null)
    setNotice(null)
    try {
      const res = await window.studio.providers.fetchModels({
        baseUrl: form.baseUrl.trim(),
        protocol: form.protocol,
        apiKey: form.apiKey.trim(),
      })
      if (!res.ok) {
        setAlert({
          tone: 'warn',
          title: 'تعذّر جلب قائمة النماذج',
          children: (
            <>
              <p>{res.error ?? 'لم يُرجع المزوّد قائمة نماذج.'}</p>
              <p className="mt-1">
                هذا ليس نهاية الطريق: اكتب اسم النموذج في الحقل أعلاه واحفظ — كثير من البوابات لا تخدم مسار
                ‎/models‎ أصلًا.
              </p>
            </>
          ),
        })
        return
      }
      if (res.models.length === 0) {
        setAlert({
          tone: 'warn',
          title: 'القائمة فارغة',
          children:
            'وصل الطلب لكن لم يُرجع أي نموذج. اكتب اسم النموذج يدويًا في الحقل أعلاه ثم احفظ.',
        })
        return
      }
      const kept = form.models
      const merged = mergeModels(res.models)
      const added = merged.length - kept.length
      setNotice({
        tone: 'success',
        title: `أُضيف ${modelsWord(added)} من المزوّد`,
        body:
          kept.length > 0 ? (
            <>
              أبقيت {modelsWord(kept.length)} التي كتبتها يدويًا كما هي، ولم يُحذف شيء.
            </>
          ) : (
            <>النماذج المتاحة الآن: {modelsWord(merged.length)}.</>
          ),
      })
    } catch (e) {
      setAlert({
        tone: 'danger',
        title: 'تعذّر الاتصال لجلب النماذج',
        children: messageOf(e, 'حدث خطأ غير متوقع أثناء الجلب'),
      })
    } finally {
      setFetching(false)
    }
  }

  /* ---------------------------------------------------------------- الحفظ */

  /**
   * هل ضاعت الإعدادات المتقدّمة بين الواجهة والعملية الرئيسية؟
   *
   * ⚠️ **عيب مقيس في طبقة الجسر (لا أملك إصلاحه):**
   * `src/main/ipc/providers.ts` يعلن `input` بـ`z.object({...})` بستة حقول
   * فقط، وزود 4 يُزيل أي مفتاح غير معلَن — فـ`apiStyle` و`headers`
   * و`queryParams` تُحذف قبل أن تصل إلى `addProvider`. النتيجة: المستخدم
   * يكتب `api-key` لـAzure، يضغط حفظ، ويُقال له إنه حُفظ، ثم يُختبر بلا
   * الترويسة فيفشل بلا سبب ظاهر.
   *
   * بدل ابتلاع ذلك بصمت (وهو العيب الذي عالجناه في بقية الشاشة) يُعلَن الإعداد الضائع
   * فورًا. الإصلاح: إضافة الحقول الثلاثة إلى مخطّطات `providers:add` و
   * `providers:update` و`providers:probe` و`providers:fetchModels`. عندها
   * يسقط هذا الفحص من تلقاءه.
   */
  const advancedLost = (saved: ProviderPublic, sent: ProviderInput): boolean => {
    const sentStyle = sent.apiStyle ?? DEFAULT_API_STYLE
    const wantedHeaders = Object.keys(cleanMap(sent.headers)).length > 0
    const wantedQuery = Object.keys(cleanMap(sent.queryParams)).length > 0
    const wantedStyle = sentStyle !== DEFAULT_API_STYLE
    if (!wantedHeaders && !wantedQuery && !wantedStyle) return false
    const gotHeaders = Object.keys(saved.headers ?? {}).length > 0
    const gotQuery = Object.keys(saved.queryParams ?? {}).length > 0
    const gotStyle = apiStyleOf(saved)
    return (
      (wantedHeaders && !gotHeaders) || (wantedQuery && !gotQuery) || (wantedStyle && gotStyle !== sentStyle)
    )
  }

  const doSave = async (): Promise<void> => {
    if (rejectInvalid()) return
    const models = commitDraftModels()
    const payload: ProviderInput = {
      ...form,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      // `apiKey` وحده لم يكن يُقصَّ — فمفتاحٌ بلحقة سطر يُرفض بـ401.
      apiKey: form.apiKey.trim(),
      models,
      note: form.note.trim(),
      apiStyle: style,
      headers: cleanMap(headers),
      queryParams: cleanMap(queryParams),
    }

    const wasEdit = editingId !== null
    setSaving(true)
    setAlert(null)
    setNotice(null)
    try {
      const saved = wasEdit
        ? await window.studio.providers.update({ ...payload, id: String(editingId) })
        : await window.studio.providers.add(payload)
      await refreshList()
      setForm(emptyProviderInput())
      setModelDraft('')
      setShowKey(false)
      setEditingId(null)
      setAdvancedOpen(false)
      setFieldErrors({})
      setLastProbeFailed(false)

      if (advancedLost(saved, payload)) {
        setNotice({
          tone: 'warn',
          title: 'حُفظ المزوّد، لكن إعداداته المتقدّمة لم تصل',
          body: 'الترويسات الإضافية ومعاملات الاستعلام وصيغة الواجهة تُحذف حاليًا في طبقة الجسر قبل الحفظ. أضفها مجدّدًا بعد إصلاح الطبقة.',
          sticky: true,
        })
      } else {
        setNotice({
          tone: 'success',
          title: wasEdit ? 'حُدّث المزوّد' : 'حُفظ المزوّد',
          body: 'المفتاح مشفّر على جهازك بـDPAPI، ولا يعود كاملًا إلى الواجهة إطلاقًا. النماذج جاهزة للاستخدام.',
        })
      }
    } catch (e) {
      setAlert({
        tone: 'danger',
        title: wasEdit ? 'تعذّر تحديث المزوّد' : 'تعذّر حفظ المزوّد',
        children: messageOf(e, 'رفضت العملية الرئيسية الحفظ — تحقّق من توفّر Secure Storage على ويندوز'),
      })
    } finally {
      setSaving(false)
    }
  }

  /* ---------------------------------------------------------------- الحذف */

  /**
   * كان `doRemove` بلا تأكيد ولا قفل ولا التقاط: نقرتان = حذفان، ورفضُ
   * الـIPC يختفي، والمفتاح المشفّر يُمحى نهائيًا بلا رجعة — والواجهة لا
   * تستقبله أصلًا فلا سبيل لاستعادته.
   */
  const doRemove = async (p: ProviderPublic): Promise<void> => {
    if (removingId !== null) return // قفل: حذف واحد في كل مرّة
    setRemovingId(p.id)
    try {
      await window.studio.providers.remove(p.id)
      if (editingId === p.id) cancelEdit()
      await refreshList()
      setConfirmRemove(null)
      setNotice({
        tone: 'success',
        title: `حُذف «${p.name}»`,
        body: 'حُذف مفتاحه المشفّر معه نهائيًا — لا يمكن استرجاعه من داخل التطبيق.',
      })
    } catch (e) {
      setConfirmRemove(null)
      setAlert({
        tone: 'danger',
        title: 'تعذّر الحذف',
        children: messageOf(e, 'رفضت العملية الرئيسية الحذف'),
      })
    } finally {
      setRemovingId(null)
    }
  }

  /* ---------------------------------------------------------------- العرض */

  const canSubmit = form.name.trim() !== '' && typedBaseUrl !== '' && effectiveModels.length > 0
  const now = Date.now()
  const hasAdvanced = style !== DEFAULT_API_STYLE
  const advancedRows =
    Object.keys(cleanMap(headers)).length + Object.keys(cleanMap(queryParams)).length

  return (
    <div className="h-full overflow-auto bg-bg">
      {/* الشريط العلوي ثابت: زرّ «متابعة» في نهاية صفحة قابلة للتمرير كان
          خارج الشاشة تمامًا وقت الحاجة إليه. */}
      <header className="sticky top-0 z-sticky flex flex-wrap items-center gap-3 border-b border-line bg-surface-1 px-gutter py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* كان وسم `S3` — اسم مرحلة داخلية يظهر لمستخدم نهائي. */}
            <Badge tone="accent" size="sm" icon={<IconPlug size={13} />}>
              {PRODUCT_NAME}
            </Badge>
            <span className="text-xs text-text-muted">اتصال مزوّد الذكاء الاصطناعي</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold">مزوّدات الذكاء الاصطناعي</h1>
        </div>
        {providers.length > 0 && onClose !== undefined ? (
          <Tooltip content="يعود إلى حيث أتيتَ، وإلا إلى مساحة العمل." side="bottom">
            <Button variant="primary" size="lg" leading={<IconChevronLeft size={16} />} onClick={onClose}>
              متابعة
            </Button>
          </Tooltip>
        ) : null}
      </header>

      <div className="mx-auto max-w-3xl px-gutter py-gutter">
        <p className="mb-5 text-base leading-relaxed text-text-secondary">
          أضف أي مزوّد: رابط الـAPI ومفتاحه وأسماء نماذجه. يُخزَّن المفتاح مشفّرًا على جهازك بـDPAPI ولا
          يُرسل كاملًا إلى الواجهة إطلاقًا — ولا يمكن استرجاعه بعد الحذف.
        </p>

        {/* ------------------------------------------------------ النموذج */}
        <Card as="section" padding="lg">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الاسم" required error={fieldErrors.name}>
                {({ id, ...aria }) => (
                  <Input
                    id={id}
                    {...aria}
                    size="lg"
                    value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder="مثال: OpenCode Go"
                  />
                )}
              </Field>

              <Field label="البروتوكول" required hint={meta.hint}>
                {({ id, ...aria }) => (
                  <Select<Protocol>
                    id={id}
                    {...aria}
                    size="lg"
                    options={PROTOCOL_OPTIONS}
                    value={form.protocol}
                    onChange={onProtocolChange}
                  />
                )}
              </Field>
            </div>

            <Field
              label="الرابط (Base URL)"
              required
              error={fieldErrors.baseUrl}
              hint={`الافتراضي لهذا البروتوكول: ${meta.defaultUrl} — اكتب جذر الـAPI، وسنقص أي نقطة نهاية تلحق بها.`}
            >
              {({ id, ...aria }) => (
                <Input
                  id={id}
                  {...aria}
                  size="lg"
                  mono
                  dir="ltr"
                  value={form.baseUrl}
                  onChange={(e) => patch({ baseUrl: e.target.value })}
                  placeholder={meta.defaultUrl}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>

            {/* ما سيُحفظ فعلًا — أكثر ما يحيّر المستخدم على هذه الشاشة. */}
            {showNormalised ? (
              <div className="rounded-lg border border-accent-border bg-accent-bg p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-accent">
                  <span aria-hidden="true">
                    <IconInfo size={15} />
                  </span>
                  سيُحفظ الرابط باسم
                </p>
                <p className="mt-1 select-text text-sm text-text-secondary">
                  <bdi dir="ltr" className="font-mono">
                    {normalised.base}
                  </bdi>
                </p>
                {normalised.params.length > 0 ? (
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                    وتُنقل معاملات الرابط من عنوانه إلى خانة «معاملات استعلام إضافية» حتى لا تُعرض مع
                    العنوان:
                  </p>
                ) : null}
                {normalised.params.map(([key, value]) => (
                  <p key={key} className="mt-1 select-text text-xs text-text-secondary">
                    <bdi dir="ltr" className="font-mono">
                      {key}={value}
                    </bdi>
                  </p>
                ))}
              </div>
            ) : null}

            <Field
              label="المفتاح"
              hint={meta.keyHint}
              error={editingId === null ? undefined : 'اتركه فارغًا للإبقاء على المفتاح المحفوظ.'}
            >
              {({ id, ...aria }) => (
                <Input
                  id={id}
                  {...aria}
                  size="lg"
                  mono
                  dir="ltr"
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => patch({ apiKey: e.target.value })}
                  placeholder="sk-…"
                  autoComplete="off"
                  spellCheck={false}
                  // الزرّ كان **داخل** `<label>` فيصير جزءًا من اسم الحقل
                  // ويسرق التركيز عند التفعيل. الآن في فتحة `trailing` المنطقية.
                  trailing={
                    <IconButton
                      size="sm"
                      icon={showKey ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                      label={showKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
                      onClick={() => setShowKey((value) => !value)}
                    />
                  }
                />
              )}
            </Field>

            {/* «النماذج» كانت `div` + `span`: بلا `label` ولا `aria-label`
                ولا اسم إطلاقًا لقارئ الشاشة، والنقر على النصّ لا يركّز الحقل. */}
            <Field
              label="النماذج"
              error={fieldErrors.models}
              hint={
                <>
                  اكتب اسم النموذج ثم <KeyHint keys={['Enter']} /> أو فاصلة، أو الصق قائمة كاملة. الإضافة
                  اليدوية مسار كامل تمامًا — لا يُشترط وجود مسار ‎/models‎ لدى المزوّد.
                </>
              }
            >
              {({ id, ...aria }) => (
                <div className="flex gap-2">
                  <Input
                    id={id}
                    {...aria}
                    size="lg"
                    mono
                    dir="ltr"
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    onBlur={commitDraftModels}
                    onPaste={onModelsPaste}
                    onKeyDown={onModelsKeyDown}
                    placeholder="gpt-4o"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Tooltip content="يضيف ما يعلنه المزوّد إلى قائمتك ولا يحذف ما كتبته بيدك" side="bottom">
                    <Button
                      size="lg"
                      variant="secondary"
                      loading={fetching}
                      onClick={() => void doFetchModels()}
                      className="shrink-0"
                    >
                      جلب النماذج
                    </Button>
                  </Tooltip>
                </div>
              )}
            </Field>

            {form.models.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {form.models.map((model) => (
                  <Chip
                    key={model}
                    mono
                    dir="ltr"
                    removable
                    removeLabel={`إزالة النموذج ${model}`}
                    onRemove={() => removeModel(model)}
                    className="select-text"
                  >
                    {model}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-xs leading-relaxed text-text-muted">
                لا توجد نماذج بعد. اكتب اسمًا واحدًا على الأقل — به يعمل التطبيق كلّه.
              </p>
            )}

            <p className="select-text text-xs leading-relaxed text-text-muted">
              {form.models.length > 0 ? modelsWord(form.models.length) : 'بلا نماذج'}
              {pendingDraft !== '' ? (
                <>
                  {' · '}
                  <span className="text-accent">
                    سيُحفظ أيضًا: <bdi dir="ltr" className="font-mono">{pendingDraft}</bdi>
                  </span>
                </>
              ) : null}
            </p>

            {/* ------------------------------------------------ المتقدّم */}
            <div className="grid gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                aria-expanded={advancedOpen}
                aria-controls="advanced-region"
                trailing={
                  advancedOpen ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />
                }
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                إعدادات البوابة (ترويسات ومعاملات وصيغة الواجهة)
                {advancedRows > 0 || hasAdvanced ? ' · مُعدّة' : ''}
              </Button>

              {advancedOpen ? (
                <div id="advanced-region" className="grid gap-3">
                  {form.protocol === 'openai-compatible' ? (
                    <Field
                      label="صيغة الواجهة"
                      hint="تحدّد المسار الذي يُرسَل إليه الطلب. اتركها على chat/completions إلا إن رفض المزوّدها."
                    >
                      {({ id, ...aria }) => (
                        <Select<ApiStyle>
                          id={id}
                          {...aria}
                          options={API_STYLE_OPTIONS}
                          value={style}
                          onChange={(next) => patch({ apiStyle: next })}
                        />
                      )}
                    </Field>
                  ) : null}

                  <MapEditor
                    legend="ترويسة"
                    description="تُرسَل مع كل طلب. هذا هو ما تحتاجه بوابة Azure (‎api-key‎) أو OpenRouter (‎HTTP-Referer‎). القيم التي تبدأ بنقاط تُخزَّن مشفّرة مثل المفتاح ولا تعود إلى الواجهة."
                    rows={headers}
                    onChange={(next) => patch({ headers: next })}
                    addLabel="أضف ترويسة"
                    namePlaceholder="api-key"
                    valuePlaceholder="القيمة"
                    removeLabelFor={(key) => `حذف الترويسة ${key}`}
                  />

                  <MapEditor
                    legend="معامل استعلام"
                    description="يُضاف إلى كل رابط طلب (‎?api-version=…‎ في Azure مثلًا). نفس قاعدة الأسرار: ما يبدأ بنقاط يُقنَّع ولا يعود."
                    rows={queryParams}
                    onChange={(next) => patch({ queryParams: next })}
                    addLabel="أضف معاملًا"
                    namePlaceholder="api-version"
                    valuePlaceholder="القيمة"
                    removeLabelFor={(key) => `حذف المعامل ${key}`}
                  />

                  <Field
                    label="ملاحظة داخلية"
                    hint="محفوظة على جهازك لتتذكّر هذا الاتصال لاحقًا. لا تُرسل إلى المزوّد ولا تظهر خارج هذه الشاشة."
                  >
                    {({ id, ...aria }) => (
                      <Textarea
                        id={id}
                        {...aria}
                        rows={2}
                        value={form.note}
                        onChange={(e) => patch({ note: e.target.value })}
                        placeholder="مثال: حساب الشركة — يُجدَّد كل ثلاثة أشهر."
                      />
                    )}
                  </Field>
                </div>
              ) : null}
            </div>

            {/* ---------------------------------------------------- التنبيه */}
            {alert !== null ? <Banner {...alert} /> : null}

            {lastProbeFailed ? (
              <Banner
                tone="warn"
                title="آخر اختبار على هذا النموذج فشل"
                children="لن أمنعك من الحفظ — القرار لك — لكن تفعيل مزوّد يفشل اتصاله يجعل التطبيق كلّه يفشل. أصلح الخطأ أعلاه أو احفظ رغم ذلك إن كنت واثقًا."
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="lg"
                loading={saving}
                onClick={() => void doSave()}
                disabled={!canSubmit}
              >
                {lastProbeFailed
                  ? 'احفظ رغم فشل الاختبار'
                  : editingId !== null
                    ? 'تحديث المزوّد'
                    : 'حفظ المزوّد'}
              </Button>
              <Button size="lg" variant="secondary" loading={probing} onClick={() => void doProbe()}>
                اختبار الاتصال
              </Button>
              {editingId !== null ? (
                <Button size="lg" variant="ghost" onClick={cancelEdit}>
                  إلغاء التعديل
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        {/* ------------------------------------------------- المحفوظات */}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">المزوّدات المحفوظة</h2>
            <Badge num>{providers.length}</Badge>
          </div>

          {listError !== null ? (
            <EmptyState
              variant="bordered"
              icon={<IconAlertTriangle size={22} />}
              title="تعذّر قراءة المزوّدات المحفوظة"
              description={listError}
              action={
                <Button variant="secondary" loading={loadingList} onClick={() => void refreshList()}>
                  أعد القراءة
                </Button>
              }
            />
          ) : providers.length === 0 ? (
            loadingList ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                <Spinner size={16} />
                جارٍ قراءة المزوّدات المحفوظة…
              </div>
            ) : (
              <EmptyState
                icon={<IconPlug size={22} />}
                title="لا يوجد مزوّد محفوظ بعد"
                description="أكمل النموذج أعلاه واضغط «حفظ المزوّد». تحتاج مزوّدًا واحدًا على الأقل قبل أن يعمل التطبيق — رابط ومفتاح واسم نموذج واحد تكفي."
              />
            )
          ) : (
            <ul className="grid gap-2.5">
              {providers.map((p) => {
                const testing = testingIds.includes(p.id)
                return (
                  <Card as="li" key={p.id} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-medium">{p.name}</span>
                        <Badge size="sm">{PROTOCOL_LABELS[p.protocol].title}</Badge>
                        {apiStyleOf(p) !== DEFAULT_API_STYLE ? (
                          <Badge size="sm" tone="accent">
                            {apiStyleOf(p)}
                          </Badge>
                        ) : null}
                        {/* `hasKey` كانت مخزَّنة بلا استعمال و`keyMask` ثابتة،
                            فكل صفّ كان يبدو متطابقًا. */}
                        <Badge
                          size="sm"
                          tone={p.hasKey ? 'success' : 'warn'}
                          icon={p.hasKey ? <IconCheck size={12} /> : <IconAlertTriangle size={12} />}
                        >
                          {p.hasKey ? 'مفتاح محفوظ' : 'بلا مفتاح'}
                        </Badge>
                        {Object.keys(p.headers ?? {}).length > 0 ? (
                          <Badge size="sm" tone="accent">
                            {Object.keys(p.headers ?? {}).length} ترويسة
                          </Badge>
                        ) : null}
                        {Object.keys(p.queryParams ?? {}).length > 0 ? (
                          <Badge size="sm" tone="accent">
                            {Object.keys(p.queryParams ?? {}).length} معامل
                          </Badge>
                        ) : null}
                      </div>

                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                        <bdi dir="ltr" className="select-text font-mono">
                          {p.baseUrl}
                        </bdi>
                        <span aria-hidden="true">·</span>
                        <span>{p.models.length === 0 ? 'بلا نماذج' : modelsWord(p.models.length)}</span>
                        {p.lastTestedAt !== null ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>اختُبر {relativeTime(p.lastTestedAt, now)}</span>
                          </>
                        ) : null}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {testing ? (
                        <Spinner size={15} label={`جارٍ اختبار ${p.name}`} className="text-accent" />
                      ) : p.lastTestOk === true ? (
                        <Badge
                          size="sm"
                          tone="success"
                          num
                          icon={<IconCheck size={12} />}
                          title={`آخر اختبار ناجح: ${p.lastLatencyMs ?? 0} مللي ثانية`}
                        >
                          {p.lastLatencyMs ?? 0} مللي ثانية
                        </Badge>
                      ) : p.lastTestOk === false ? (
                        <Badge size="sm" tone="danger" icon={<IconAlertCircle size={12} />}>
                          فشل آخر اختبار
                        </Badge>
                      ) : (
                        <Badge size="sm" icon={<IconInfo size={12} />}>
                          لم يُختبر بعد
                        </Badge>
                      )}

                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={testing}
                        aria-busy={testing}
                        onClick={() => startEdit(p)}
                        leading={<IconPencil size={14} />}
                      >
                        تعديل
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={testing}
                        aria-busy={testing}
                        onClick={() => void doTestSaved(p)}
                        leading={<IconRotate size={14} />}
                      >
                        اختبار
                      </Button>
                      <Button
                        size="sm"
                        variant="dangerSoft"
                        onClick={() => setConfirmRemove(p)}
                        leading={<IconTrash size={14} />}
                      >
                        حذف
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* الإشعارات — `Toast` لا مخزن ولا سياق: صاحب الشاشة يتحكّم بها.
          ملاحظة: `App.tsx` (ليس ملكيتي) لا يعرض `ToastRegion`، فهذه الشاشة
          تحمل region's الخاصًا بها؛ حين يُرفع إلى الجذر يُحذف هذا السطر. */}
      <ToastRegion size="md">
        {notice !== null ? (
          <Toast
            tone={notice.tone}
            title={notice.title}
            duration={notice.sticky === true ? 0 : 6_000}
            onDismiss={() => setNotice(null)}
          >
            {notice.body}
          </Toast>
        ) : null}
      </ToastRegion>

      <ConfirmDialog
        open={confirmRemove !== null}
        busy={removingId !== null}
        title={`حذف «${confirmRemove?.name ?? ''}»؟`}
        description="سيُحذف المزوّد ومفتاحه المشفّر نهائيًا. لا يمكن استرجاع المفتاح من داخل التطبيق، وستحتاج إلى إدخاله من جديد."
        confirmLabel="احذف نهائيًا"
        onCancel={() => {
          if (removingId === null) setConfirmRemove(null)
        }}
        onConfirm={() => {
          if (confirmRemove !== null) void doRemove(confirmRemove)
        }}
      >
        {confirmRemove !== null ? (
          <div className="grid gap-2 text-sm text-text-secondary">
            <p className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm">{PROTOCOL_LABELS[confirmRemove.protocol].title}</Badge>
              <span>{confirmRemove.models.length === 0 ? 'بلا نماذج' : modelsWord(confirmRemove.models.length)}</span>
            </p>
            <p className="select-text font-mono text-xs text-text-muted">
              <bdi dir="ltr">{confirmRemove.baseUrl}</bdi>
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}