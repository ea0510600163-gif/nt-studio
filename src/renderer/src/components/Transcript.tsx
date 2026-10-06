import { useMemo, useState, type JSX, type ReactNode } from 'react'
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  StatusDot,
  TONE_ALERT,
  cx,
} from './ui'
import { formatTime, stripAnsi, type ChatLine, type Question, type ToolActivity, type ToolStatus } from '../stores/reducer'

/**
 * عرض السجلّ — كل ما يخصّ «ماذا قال الوكيل وماذا فعل».
 *
 * لماذا ملف منفصل؟ لأن `ChatPanel.tsx` كان يحتوي التقديم والحالة في آن واحد،
 * فصار ملفًا لا يمكن اختباره: كل سلوك عرض اختباره يحتاج جسر `window.studio`
 * كاملًا. هذا الملف **تقديميّ بحت** — لا `dispatch` ولا وعد ولا مؤقّت — فيمكن
 * اختبارMarkdown والصفوف وحدها.
 *
 * أربع قواعد هنا ليست ذوقًا:
 *
 * 1) **`dir="auto"` على نصّ الوكيل.** بدونه يُعاد ترتيب أي كود أو رابط أو أثر
 *    استثناء داخل ردّ عربي إلى خطوات بصرية عشوائية (Unicode bidi). القاعدة
 *    تُطبَّق على كل عنصر فيه نصّ مختلط، لا على الجذع وحده.
 * 2) **Markdown حقيقي.** الموجّه النظامي يطلب نثرًا منظّمًا، والنصّ كان يُعرض
 *    خامًا بـ`whitespace-pre-wrap` فظهر `#` والأسوار ``` حرفيين. هذا الملف
 *    يوزّع كتلاً: فقرات · قوائم · عناوين · كود مضمّن · كود مسوّور. لا HTML خام
 *    ولا `dangerouslySetInnerHTML` — النصّ يمرّ إلى عناصر React نصًّا، فلا حقن.
 * 3) **المُدخلات مرئية.** `body { user-select: none }`، فالمستخدم اليوم لا
 *    يستطيع نسخ ردّ الوكيل ولا مسار ملف ولا رسالة خطأ. كل نصّ هنا داخل
 *    `select-text`.
 * 4) **لا أوامر Unicode للأيقونات** — `cx` والأيقونات من `components/ui`.
 */

/* ========================================================================== *
 *  Markdown — محلّل صغير Enough للمهمّة، وكامل بما طلبه الموجّه النظامي
 * ========================================================================== */

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

const FENCE = /^\s*```(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/

/**
 * يحوّل نصًّا خامًا إلى كتل. سطر بسطر، بلاExpressions ولا آلة حالات.
 *
 * الفقرة تجمّع الأسطر المتتالية حتى سطر فارغ أو بداية كتلة جديدة، وتحتفظ
 * بالفواصل داخلها بـ`whitespace-pre-wrap` — لأن الردّ العربي يعتمد على السطر
 * مثلما تعتمد القائمة.
 */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let i = 0

  const startsBlock = (line: string): boolean => {
    const t = line.trim()
    return (
      t === '' ||
      FENCE.test(t) ||
      RULE.test(line) ||
      HEADING.test(line) ||
      QUOTE.test(line) ||
      BULLET.test(line) ||
      NUMBERED.test(line)
    )
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    if (trimmed === '') {
      i++
      continue
    }

    const fence = FENCE.exec(trimmed)
    if (fence !== null) {
      const lang = (fence[1] ?? '').trim()
      const body: string[] = []
      i++
      while (i < lines.length && FENCE.test((lines[i] ?? '').trim()) === false) {
        body.push(lines[i] ?? '')
        i++
      }
      i++ // سطر الإغلاق
      blocks.push({ kind: 'code', lang, code: body.join('\n') })
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    const head = HEADING.exec(line)
    if (head !== null) {
      blocks.push({ kind: 'heading', level: (head[1] ?? '#').length, text: head[2] ?? '' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        body.push((lines[i] ?? '').replace(QUOTE, '$1'))
        i++
      }
      blocks.push({ kind: 'quote', text: body.join('\n') })
      continue
    }

    const ordered = BULLET.test(line) === false && NUMBERED.test(line)
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const re = ordered ? NUMBERED : BULLET
      const items: string[] = []
      while (i < lines.length) {
        const m = re.exec(lines[i] ?? '')
        if (m === null) break
        items.push(m[1] ?? '')
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const body: string[] = []
    while (i < lines.length && startsBlock(lines[i] ?? '') === false) {
      body.push(lines[i] ?? '')
      i++
    }
    blocks.push({ kind: 'paragraph', text: body.join('\n') })
  }

  return blocks
}

/**
 * ترميز داخل السطر: كود مضمّن، غامق، مائل، ورابط.
 *
 * الرابط **ليس** `<a>`: النقر عليه شحنة تنقّل، و`will-navigate` في العملية
 * الرئيسية يفتحه خارجيًا، وCSP لا يحسمها. فنعرض النصّ ملوّنًا ونطبع العنوان
 * بجانبه ليقرأه المستخدم ولا يُنقر.
 *
 * النمط نصّ لا كائن: كل نداء يبني `RegExp` جديدًا، لأن الاستدعاءات متشعّبة
 * (الغامق يحوي كودًا) و`lastIndex` مشترك بين النداءات كان سيُفسد التطابق.
 */
const INLINE_SOURCE = '(`[^`]+`)|(\\*\\*[^*\\n]+\\*\\*)|(\\[[^\\]\\n]+\\]\\([^)\\s]+\\))|(\\*[^*\\n]+\\*)|(_[^_\\n]+_)'

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = new RegExp(INLINE_SOURCE, 'g')
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    const token = m[0]
    const at = m.index
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyBase}-${at}`

    if (token.startsWith('`')) {
      out.push(
        <code
          key={key}
          className="rounded-xs border border-line bg-inset px-1 py-0.5 font-mono text-xs text-text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-text-primary">
          {renderInline(token.slice(2, -2), `${key}b`)}
        </strong>,
      )
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(token)
      const label = link?.[1] ?? token
      const href = link?.[2] ?? ''
      out.push(
        <span key={key} className="text-text-link">
          {renderInline(label, `${key}l`)}
          {href !== '' && href !== label ? (
            <span className="ms-1 font-mono text-xs text-text-muted">{href}</span>
          ) : null}
        </span>,
      )
    } else {
      const inner = token.startsWith('_') ? token.slice(1, -1) : token.slice(1, -1)
      out.push(
        <em key={key} className="italic">
          {renderInline(inner, `${key}i`)}
        </em>,
      )
    }
    last = at + token.length
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * مستوى `#` في ردّ الوكيل يُقرأ كعنوان داخل_LOG لا كعنوان صفحة.
 * `<h1>` و`<h2>` داخل `role="log"` يعلنان قارئ الشاشة أنهما عنوانا
 * الوثيقة، وهو ادّعاء غير صحيح: المستند عنوانه الوحيد هو التطبيق.
 * لذلك: `h3..h6`، والبصمة من سلم الطباعة نفسه.
 */
const HEADING_TAG: Record<number, 3 | 4 | 5 | 6> = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 6, 6: 6 }

const HEADING_CLASS: Record<number, string> = {
  1: 'text-lg font-semibold text-text-primary',
  2: 'text-md font-semibold text-text-primary',
  3: 'text-base font-semibold text-text-primary',
  4: 'text-base font-medium text-text-secondary',
  5: 'text-sm font-medium text-text-secondary',
  6: 'text-sm font-medium text-text-muted',
}

const CODE_WELL =
  'overflow-x-auto rounded-lg border border-line bg-inset p-3 font-mono text-xs leading-relaxed text-text-secondary'

export interface MarkdownProps {
  text: string
  className?: string
}

/** ردّ الوكيل كبنى فعلية — لا نصّ خام. */
export function Markdown({ text, className }: MarkdownProps): JSX.Element {
  const blocks = useMemo(() => parseMarkdown(text), [text])

  return (
    <div dir="auto" className={cx('grid gap-2 select-text', className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`

        if (block.kind === 'heading') {
          // عنوان حقيقي لا `<p>` مزيّف: `#` في ردّ الوكيل عنوان، وقارئ
          // الشاشة يقرأ العناوين كبنية لا كنصّ.
          const Tag = `h${HEADING_TAG[block.level] ?? 6}` as 'h3' | 'h4' | 'h5' | 'h6'
          return (
            <Tag key={key} className={cx('pt-1', HEADING_CLASS[block.level])}>
              {renderInline(block.text, key)}
            </Tag>
          )
        }

        if (block.kind === 'code') {
          return (
            <div key={key} className="grid gap-1">
              {block.lang === '' ? null : (
                <span className="font-mono text-xs text-text-muted">{block.lang}</span>
              )}
              <pre dir="ltr" className={CODE_WELL}>
                <code>{block.code}</code>
              </pre>
            </div>
          )
        }

        if (block.kind === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={key} className={cx('grid gap-1 ps-5', block.ordered ? 'list-decimal' : 'list-disc')}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`} className="leading-relaxed marker:text-text-tertiary">
                  {renderInline(item, `${key}-${itemIndex}`)}
                </li>
              ))}
            </Tag>
          )
        }

        if (block.kind === 'quote') {
          return (
            <p
              key={key}
              className="border-s-2 border-line-strong ps-3 text-text-tertiary italic"
            >
              {renderInline(block.text, key)}
            </p>
          )
        }

        if (block.kind === 'rule') {
          return <hr key={key} className="border-line" />
        }

        return (
          <p key={key} className="whitespace-pre-wrap leading-relaxed">
            {renderInline(block.text, key)}
          </p>
        )
      })}
    </div>
  )
}

/* ========================================================================== *
 *  سطر الأداة — أهم ما يُعرض أثناء البناء
 * ========================================================================== */

const TOOL_TONE: Record<ToolStatus, 'accent' | 'success' | 'danger'> = {
  running: 'accent',
  done: 'success',
  error: 'danger',
}

const TOOL_LABEL: Record<ToolStatus, string> = {
  running: 'قيد التنفيذ',
  done: 'اكتملت',
  error: 'فشلت',
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} مللي ثانية`
  return `${(ms / 1000).toFixed(1)} ثانية`
}

/**
 * صفّ أداة واحدة.
 *
 * **المُدخلات هي السبب كله.** `describeArgs` في `reducer.ts` كانت مكتوبة
 * ومختبرة وبلا مستهلك: المستخدم يرى `write_file` ولا يعرف أي ملف يُكتب،
 * وهو أهمّ ما يحتاجه أثناء بناء. نعرض `argHint` — وهو ناتجها — كرقائق
 * `key=value` قابلة للنسخ، ونفتح تفاصيل مختصرة لكل مُدخل آخر عبر زرّ.
 */
export function ToolRow({ tool }: { tool: ToolActivity }): JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = stripAnsi(tool.summary)
  const args = tool.argHint
    .split('·')
    .map((part) => part.trim())
    .filter((part) => part !== '')

  return (
    <li className="grid gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* النقطة تحمل نصًّا في شجرة الوصول: `aria-label` على `div` بلا دور
            كان يقرأه قارئ الشاشة كصنف غير معرّف. `hideLabel` يبقي النصّ
            دون تكرار مرئي. */}
        <StatusDot
          tone={TOOL_TONE[tool.status]}
          label={TOOL_LABEL[tool.status]}
          hideLabel
          pulse={tool.status === 'running'}
          size="sm"
        />

        <span dir="ltr" className="shrink-0 font-mono text-xs font-medium text-text-secondary">
          {tool.name}
        </span>

        {args.map((arg) => (
          <Chip key={arg} mono dir="auto" tone="neutral" className="max-w-full">
            {arg}
          </Chip>
        ))}

        <span className="flex-1" />

        {tool.ms > 0 ? (
          <span className="shrink-0 font-mono text-xs text-text-muted num">{formatMs(tool.ms)}</span>
        ) : null}

        <IconButton
          size="sm"
          icon={open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          label={open ? `اخفِ تفاصيل ${tool.name}` : `اعرض تفاصيل ${tool.name}`}
          onClick={() => setOpen((v) => !v)}
        />
      </div>

      {summary === '' ? null : open ? (
        <pre
          dir="auto"
          className="whitespace-pre-wrap break-words rounded-lg border border-line bg-inset p-2 font-mono text-xs leading-relaxed text-text-secondary"
        >
          {summary}
        </pre>
      ) : (
        <p className="truncate text-xs leading-relaxed text-text-muted">{summary}</p>
      )}

      {open && Object.keys(tool.args).length > 0 ? (
        <dl className="grid gap-1 rounded-lg border border-line bg-inset p-2 text-xs">
          {Object.entries(tool.args).map(([key, value]) => (
            <div key={key} className="flex flex-wrap items-baseline gap-2">
              <dt dir="ltr" className="shrink-0 font-mono text-text-muted">
                {key}
              </dt>
              <dd dir="auto" className="min-w-0 flex-1 break-words font-mono text-text-secondary">
                {typeof value === 'string' ? value : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  )
}

/* ========================================================================== *
 *  اللوح كامل
 * ========================================================================== */

export interface TranscriptProps {
  lines: ChatLine[]
  tools: ToolActivity[]
  /** أدوات أقدم من الحدّ المعروض. */
  hiddenTools: number
  expandedTools: boolean
  onToggleTools: () => void
  streamingText: string
  /** حقيقي أثناء العمل فقط — المؤشّر لا ينبض على نصّ متروّك. */
  streaming: boolean
  lastError: string | null
  onOpenLog: () => void
  question: Question | null
  onPickOption: (text: string) => void
  shot: { url: string; at: number } | null
  onDismissShot: () => void
}

export function Transcript({
  lines,
  tools,
  hiddenTools,
  expandedTools,
  onToggleTools,
  streamingText,
  streaming,
  lastError,
  onOpenLog,
  question,
  onPickOption,
  shot,
  onDismissShot,
}: TranscriptProps): JSX.Element {
  const empty = lines.length === 0 && streamingText === '' && tools.length === 0

  return (
    <div className="grid gap-3">
      {empty ? (
        <EmptyState
          variant="card"
          size="sm"
          className="mt-6"
          title="اطلب ما تريد وسأبنيه لك"
          description="موقع · لعبة · أداة · أي شيء يعمل في المتصفح"
        />
      ) : null}

      {/* طلب المستخدم — مُدخل لا ردّ: بلا Markdown، وحدّه هو الحدّ. */}
      {lines.map((line) =>
        line.role === 'user' ? (
          <div key={line.id} className="flex justify-end">
            <p className="max-w-[85%] rounded-lg border border-line bg-surface-2 px-3 py-2 text-base leading-relaxed whitespace-pre-wrap text-text-primary select-text">
              {line.text}
            </p>
          </div>
        ) : (
          <Markdown key={line.id} text={line.text} className="text-base text-text-secondary" />
        ),
      )}

      {tools.length > 0 ? (
        <ul className="grid gap-2" aria-label="أدوات الوكيل">
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </ul>
      ) : null}

      {hiddenTools > 0 ? (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            leading={<IconChevronDown size={14} />}
            trailing={expandedTools ? <IconChevronUp size={14} /> : null}
            onClick={onToggleTools}
          >
            {`و ${hiddenTools} أدوات أقدم`}
          </Button>
        </div>
      ) : null}

      {streamingText === '' ? null : (
        <div className="relative">
          <Markdown text={streamingText} className="text-base text-text-secondary" />
          {streaming ? (
            <span
              aria-hidden="true"
              className="absolute bottom-0 end-0 inline-block h-3 w-0.5 animate-pulse bg-accent"
            />
          ) : null}
        </div>
      )}

      {shot === null ? null : (
        <figure className="grid gap-1.5 rounded-xl border border-line bg-surface-1 p-2">
          <figcaption className="flex items-center gap-2 text-xs text-text-muted">
            <span className="num">لقطة {formatTime(shot.at)}</span>
            <span className="flex-1" />
            <IconButton
              size="sm"
              icon={<IconClose size={14} />}
              label="إخفاء اللقطة"
              onClick={onDismissShot}
            />
          </figcaption>
          <img
            src={shot.url}
            alt="لقطة من المعاينة"
            className="max-h-64 w-full rounded-lg border border-line"
          />
        </figure>
      )}

      {lastError === null ? null : (
        <div className={cx('grid gap-1.5 rounded-xl border px-3 py-2', TONE_ALERT.danger)}>
          <p className="flex items-start gap-2 text-base leading-relaxed select-text">
            <IconAlertCircle size={16} className="mt-0.5 shrink-0" />
            {lastError}
          </p>
          <Button variant="link" size="sm" onClick={onOpenLog} className="justify-start px-0">
            اعرض التفاصيل في السجل
          </Button>
        </div>
      )}

      {question === null ? null : (
        <div className={cx('grid gap-2 rounded-xl border px-3 py-2', TONE_ALERT.warn)}>
          <p className="flex items-start gap-2 text-base leading-relaxed select-text">
            <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
            {question.text}
          </p>
          {question.options.length === 0 ? null : (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <Button key={option} variant="secondary" size="sm" onClick={() => onPickOption(option)}>
                  {option}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Transcript