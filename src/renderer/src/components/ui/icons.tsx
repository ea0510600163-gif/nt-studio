import type { JSX, SVGProps } from 'react'
import {
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Info,
  Laptop,
  LoaderCircle,
  Monitor,
  PanelLeft,
  Pencil,
  Plug,
  Plus,
  RotateCw,
  Search,
  Send,
  Smartphone,
  Square,
  Tablet,
  Terminal,
  Trash,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cx } from './cx'

/**
 * نظام الأيقونات — 32 أيقونة، هندسة lucide، واجهة ثابتة.
 *
 * كل أيقونة: 24×24، `viewBox="0 0 24 24"`، `stroke="currentColor"`،
 * `fill="none"`, `stroke-linecap/linejoin="round"`، و`aria-hidden` افتراضيًا.
 *
 * لماذا RTL لا يقلب الأيقونات كلها؟ لأن الاتجاه في العربية معكوس: زر «رجوع»
 * يشير إلى **اليمين**. فـ`chevron-right` هو نفسه اتساع الرجوع، ولو قلّبناه
 * لصار يشير إلى اليسار أي «تقدّم». لذلك:
 *   • `IconChevronRight` = رجوع   ·   `IconChevronLeft` = تقدّم   (بلا قلب)
 *   • `IconChevronDown` / `IconChevronUp` رأسية، القلب فيها بلا معنى
 *   • `IconExternalLink` و`IconPanelLeft` فقط يُقلبان في RTL عبر `rtl:`
 *   • `check` و`trash` و`plus` لا تُقلب أبدًا: ليست اتجاهية أصلًا
 *
 * إن سُمّي أيقونة باسمها الفريد فلا حاجة لتمرير `aria-label`: الأيقونة مخفية
 * عن قارئات الشاشة، والاسم يأتي من `IconButton`'s `label` الإلزامي.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'children'> {
  /** ضلع المربّع بالبكسل. الافتراضي 16 يناسب نصًا بحجم 13px. */
  size?: number
  /** 1.75 يبدو أنظف من 2 داخل نص عربي صغير. */
  strokeWidth?: number
  /** استثناء نادر: يجعل الأيقونة مُسمّاة بدل مخفية. */
  label?: string
}

function make(Glyph: LucideIcon, name: string, mirrorInRtl = false): (props: IconProps) => JSX.Element {
  const Component = ({
    size = 16,
    strokeWidth = 1.75,
    label,
    className,
    ...rest
  }: IconProps): JSX.Element => (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      className={cx(mirrorInRtl && 'rtl:scale-x-[-1]', 'shrink-0', className)}
      {...rest}
    />
  )
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  ;(Component as { displayName?: string }).displayName = name
  return Component
}

/* -------------------------------------------------------------- التنقّل */

/** رجوع — في RTL يشير إلى اليمين. لا يُقلب. */
export const IconChevronRight = make(ChevronRight, 'IconChevronRight')
/** تقدّم — في RTL يشير إلى اليسار. لا يُقلب. */
export const IconChevronLeft = make(ChevronLeft, 'IconChevronLeft')
export const IconChevronDown = make(ChevronDown, 'IconChevronDown')
export const IconChevronUp = make(ChevronUp, 'IconChevronUp')
export const IconClose = make(X, 'IconClose')

/* -------------------------------------------------------------- الإشارات */

export const IconCheck = make(Check, 'IconCheck')
export const IconAlertTriangle = make(TriangleAlert, 'IconAlertTriangle')
export const IconAlertCircle = make(CircleAlert, 'IconAlertCircle')
export const IconInfo = make(Info, 'IconInfo')

/* -------------------------------------------------------------- الأفعال */

export const IconPlus = make(Plus, 'IconPlus')
export const IconTrash = make(Trash, 'IconTrash')
export const IconPencil = make(Pencil, 'IconPencil')
export const IconPlug = make(Plug, 'IconPlug')
export const IconSend = make(Send, 'IconSend')
export const IconStop = make(Square, 'IconStop')
export const IconRotate = make(RotateCw, 'IconRotate')
export const IconSpinner = make(LoaderCircle, 'IconSpinner')

/* -------------------------------------------------------------- الملفات */

export const IconFolder = make(Folder, 'IconFolder')
export const IconFolderOpen = make(FolderOpen, 'IconFolderOpen')
export const IconChip = make(Cpu, 'IconChip')
export const IconTerminal = make(Terminal, 'IconTerminal')
export const IconCamera = make(Camera, 'IconCamera')

/* -------------------------------------------------------------- المعاينة */

/** اتجاهي (يفتح نافذة خارجية) — يُقلب في RTL. */
export const IconExternalLink = make(ExternalLink, 'IconExternalLink', true)
export const IconMonitor = make(Monitor, 'IconMonitor')
export const IconLaptop = make(Laptop, 'IconLaptop')
export const IconTablet = make(Tablet, 'IconTablet')
export const IconSmartphone = make(Smartphone, 'IconSmartphone')
/** اتجاهي (لوح جانبي) — يُقلب في RTL. */
export const IconPanelLeft = make(PanelLeft, 'IconPanelLeft', true)

/* -------------------------------------------------------------- العرض */

export const IconSearch = make(Search, 'IconSearch')
export const IconEye = make(Eye, 'IconEye')
export const IconEyeOff = make(EyeOff, 'IconEyeOff')

/** كل الأسماء المصدَّرة، لمن يمرّر عليها اسمًا (اختبارات، قوائم). */
export const ICON_NAMES = [
  'IconChevronRight',
  'IconChevronLeft',
  'IconChevronDown',
  'IconChevronUp',
  'IconClose',
  'IconCheck',
  'IconAlertTriangle',
  'IconAlertCircle',
  'IconInfo',
  'IconPlus',
  'IconTrash',
  'IconPencil',
  'IconPlug',
  'IconSend',
  'IconStop',
  'IconRotate',
  'IconSpinner',
  'IconFolder',
  'IconFolderOpen',
  'IconChip',
  'IconTerminal',
  'IconCamera',
  'IconExternalLink',
  'IconMonitor',
  'IconLaptop',
  'IconTablet',
  'IconSmartphone',
  'IconPanelLeft',
  'IconSearch',
  'IconEye',
  'IconEyeOff',
] as const satisfies readonly string[]
