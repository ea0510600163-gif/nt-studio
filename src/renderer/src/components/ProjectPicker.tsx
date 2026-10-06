import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ProjectInfo } from '../../../shared/api'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  IconChevronLeft,
  IconClose,
  IconFolderOpen,
  IconSearch,
  Input,
  Spinner,
  Tooltip,
  cx,
} from './ui'
import {
  fileCountLabel,
  formatDateTime,
  middleTruncate,
  searchResultsLabel,
} from '../nav/routes'

/**
 * قائمة المشاريع.
 *
 * هذه الشاشة **مكوّن عرض خالص**: لا تقرأ `window.studio` ولا تمسك حالة تحميل.
 * كل شيء يأتي من `App` عبر الخصائص، لأن الفشل في القراءة يجب أن يُعرض كخطأ
 * لا كـ«لا توجد مشاريع» (كان `.catch(() => undefined)` يخلط الأمرين).
 *
 * أربع حالات منفصلة لا يمكن دمجها: **جارٍ القراءة** · **فشل القراءة** ·
 * **لا مشاريع** · **لا نتائج بحث**. قبلها كانت اثنتان، وأخطرهما أن فشل القرص
 * كان يُعرض حرفيًا كالقائمة الفارغة.
 *
 * لا يوجد زرّ «مشروع جديد» بالمعنى الضيّق (الوكيل هو من يصنع المجلد و git و
 * README في خطوة واحدة متّسقة عبر `create_project`). لكن **الوجهة** موجودة
 * هنا: زر «ابدأ مشروعًا جديدًا» يفتح مساحة العمل بلا مشروع، وهناك يطلب
 * المستخدم ما يريد فينشئه الوكيل.
 *
 * **لا زرّ «المزوّدات» هنا**: صار في الشريط العلوي والشريط الجانبي. تكراره هنا
 * كان يخلق ثلاث طرق للوصول إلى شاشة واحدة، **وأخطرها يكسر ترتيب التركيز** —
 * الزرّ كان أعلى اليسار فيخرج بعد حقل البحث أعلى اليمين.
 */

/** الحدّ الأعلى في `src/main/agent/tools/fs-scan.ts` يتوقف عند 500 مدخل. */
const FILE_COUNT_CAP = 501

/** أطول نصّ يُعرض افتراضيًا — القصّ في الوسط، فالذيل هو الجزء المفيد. */
const PATH_MAX = 56

/**
 * عدد الملفات بصيغة عربية صحيحة، **لا يُقدَّم مقدَّرًا كعدد دقيق**:
 * كل مشروع فيه أكثر من 501 ملف يقرأ 501، فإضافة «+» هي الفرق بين قياس
 * وتخمين. الأرقام داخل النصّ العربي تُعزل بـ`bdi` في الاستعمال.
 */
function fileCountText(count: number): string {
  if (Number.isFinite(count) && count >= FILE_COUNT_CAP) return `${FILE_COUNT_CAP}+ ملف`
  return fileCountLabel(count)
}

/** ما يميّز هذا المشروع فعلًا — ملفٌ نقيسه، لا تصنيفًا نتلقّاه. */
function evidenceLabel(project: ProjectInfo): string | null {
  return project.hasPackage ? 'package.json' : null
}

interface Props {
  projects: ProjectInfo[]
  loading: boolean
  /** رسالة فشل القراءة — `null` يعني لا فشل. */
  error: string | null
  /** جذر المشاريع **مستنتَج** من مسار أول مشروع، لا مقروءًا من الإعدادات. */
  root: string | null
  onRetry: () => void
  onOpen: (path: string) => void
  onNewProject: () => void
}

interface ProjectCardProps {
  project: ProjectInfo
  /** نشِط الآن بمؤشّر لوحة المفاتيح. */
  active: boolean
  onOpen: () => void
  onHover: () => void
}

/**
 * بطاقة المشروع.
 *
 * **افتراض واضح أنها تُفتح**: `Card variant="interactive"` يرسم `<button>`
 * حقيقيًا بأخذ التركيز، والحدّ والارتفاع يتحوّلان عند التحويم، وسهم اتجاهي
 * على الطرفية (اليسار في RTL) يقول «ادخل» بلا كلام.
 */
function ProjectCard(props: ProjectCardProps): React.JSX.Element {
  const { project: p, active } = props
  const evidence = evidenceLabel(p)
  const created = formatDateTime(p.createdAt)

  return (
    <Card
      variant="interactive"
      padding="sm"
      onClick={props.onOpen}
      onMouseEnter={props.onHover}
      onFocus={props.onHover}
      aria-current={active ? 'true' : undefined}
      className={cx('group flex w-full items-start gap-3 text-start', active && 'border-accent')}
    >
      <span className="mt-0.5 inline-flex text-text-muted group-hover:text-accent">
        <IconFolderOpen size={16} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium text-text-primary">{p.name}</span>
          {evidence === null ? null : (
            <Badge size="sm" num title="ملف تعريف المشروع المقروء من القرص">
              {evidence}
            </Badge>
          )}
          <Badge size="sm" num>
            <bdi>{fileCountText(p.fileCount)}</bdi>
          </Badge>
          {created === '' ? null : (
            <span className="text-xs text-text-muted">
              أُنشئ <bdi>{created}</bdi>
            </span>
          )}
        </span>

        <span
          className="mt-1 block font-mono text-xs text-text-muted"
          dir="ltr"
          title={p.path}
        >
          {middleTruncate(p.path, PATH_MAX)}
        </span>

        {p.lastSummary === '' ? null : (
          <span className="mt-1.5 block text-sm leading-relaxed text-text-secondary">
            آخر جلسة: {p.lastSummary}
          </span>
        )}
      </span>

      <Tooltip content="افتح المشروع" side="start">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex text-text-muted transition-ui group-hover:text-accent"
        >
          <IconChevronLeft size={16} />
        </span>
      </Tooltip>
    </Card>
  )
}

export default function ProjectPicker({
  projects,
  loading,
  error,
  root,
  onRetry,
  onOpen,
  onNewProject,
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const needle = query.trim().toLowerCase()
  const filtered = needle === '' ? projects : projects.filter((p) => p.name.toLowerCase().includes(needle))
  const searching = needle !== ''

  // إبقاء المؤشّر داخل النطاق بعد كل تصفية.
  useEffect(() => {
    setActive((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)))
  }, [filtered.length])

  const openAt = (index: number): void => {
    const hit = filtered[index]
    if (hit) onOpen(hit.path)
  }

  const clearQuery = (): void => {
    setQuery('')
    inputRef.current?.focus()
  }

  /** الترتيب صريح لا مُصادفة: الأحدث أولًا (main يرتّب بـ`createdAt` تنازليًا). */
  let resultsText: string
  if (loading && projects.length === 0) resultsText = 'جارٍ قراءة المشاريع…'
  else if (error !== null) resultsText = 'تعذّرت القراءة'
  else resultsText = searchResultsLabel(filtered.length, projects.length)

  let body: ReactNode
  if (error !== null) {
    body = (
      <EmptyState
        icon={<IconFolderOpen size={22} />}
        title="تعذّرت قراءة المشاريع"
        description={
          <>
            <span className="block font-mono text-sm text-danger">{error}</span>
            <span className="mt-2 block">
              هذا ليس يعني «لا توجد مشاريع» — تعذّر الوصول إلى القرص، وقد تكون ملفاتك سليمة.
            </span>
          </>
        }
        action={
          <Button variant="primary" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        }
        secondaryAction={
          <Button variant="secondary" onClick={onNewProject}>
            اذهب لمساحة العمل
          </Button>
        }
      />
    )
  } else if (loading && projects.length === 0) {
    body = (
      <EmptyState
        title={
          <span className="flex items-center gap-2">
            <Spinner size={14} label={null} />
            <span>جارٍ القراءة…</span>
          </span>
        }
        description="نقرأ محتويات مجلد المشاريع من القرص."
      />
    )
  } else if (filtered.length === 0) {
    body = searching ? (
      <EmptyState
        icon={<IconSearch size={20} />}
        title="لا نتائج مطابقة"
        description={`لا مشروع باسم يحتوي «${query.trim()}».`}
        action={
          <Button variant="secondary" onClick={clearQuery}>
            امسح البحث
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<IconFolderOpen size={22} />}
        title="لا توجد مشاريع بعد"
        description="افتح مساحة العمل واكتب ما تريد — الوكيل ينشئ المجلد و git و README، ثم يظهر المشروع هنا تلقائيًا."
        action={
          <Button variant="primary" onClick={onNewProject}>
            ابدأ مشروعًا جديدًا
          </Button>
        }
      />
    )
  } else {
    body = (
      <ul className="grid gap-2">
        {filtered.map((p, i) => (
          <li key={p.path}>
            <ProjectCard
              project={p}
              active={i === active}
              onOpen={() => onOpen(p.path)}
              onHover={() => setActive(i)}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-gutter px-gutter py-gutter">
        <header>
          <h1 className="text-2xl font-semibold">مشاريعك</h1>
          <p className="mt-1.5 text-base leading-relaxed text-text-secondary">
            اختر مشروعًا للمتابعة، أو ابدأ مشروعًا جديدًا وسيبنيه الوكيل من وصفك.
          </p>
        </header>

        {/*
          الجذر **مستنتَج** من مسار أول مشروع، لا مقروءًا من إعدادات التطبيق:
          قناة `projects:getRoot` موجودة في العملية الرئيسية لكنها لم تعبر الجسر
          بعد. نعرضه مع التصريح بأنه تقدير، ولا نقدّمه كأنه حقيقة.
        */}
        {root === null ? null : (
          <p className="text-xs leading-relaxed text-text-muted">
            مجلد المشاريع المستنتَج: <span className="font-mono" dir="ltr">{root}</span> —{' '}
            <span className="text-text-tertiary">
              استُنتج من مسار أول مشروع، وقد لا يكون مجلد المشاريع الحقيقي.
            </span>
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Input
            ref={inputRef}
            type="search"
            size="lg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // حقل البحث يلتهم Esc قبل أن يتحوّل إلى «رجوع» عام.
                if (query !== '') {
                  e.stopPropagation()
                  e.preventDefault()
                  clearQuery()
                }
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => (filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1)))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                openAt(active)
              }
            }}
            placeholder="ابحث باسم المشروع…"
            aria-label="ابحث باسم المشروع"
            // Chromium يرسم زرّ مسح أصليًا داخل `type="search"`، فيتكرر مع
            // زرّنا المسمّى. إخفاءه صنف واحد على الغلاف، لا صنفان متعارضان.
            className="[&_input::-webkit-search-cancel-button]:appearance-none"
            leading={<IconSearch size={15} />}
            trailing={
              query === '' ? null : (
                <IconButton
                  size="sm"
                  icon={<IconClose size={14} />}
                  label="مسح البحث"
                  onClick={clearQuery}
                />
              )
            }
          />

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-text-muted" aria-live="polite">
              {resultsText}
            </span>
            <span className="text-xs text-text-muted">
              {projects.length > 0 ? 'Enter لفتح · ↑↓ للتنقّل · Esc لمسح البحث' : ''}
            </span>
          </div>
        </div>

        <div aria-busy={loading} className="flex flex-col gap-gutter">
          {body}
        </div>

        {projects.length > 0 ? (
          <div>
            <Button variant="secondary" onClick={onNewProject}>
              ابدأ مشروعًا جديدًا
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
