/**
 * أسماء المقاييس، جاهزة للنسخ.
 *
 * لماذا هذا الملف موجود أصلًا؟ لأن Tailwind لا يولّد أداة إلا إذا قرأ اسمها
 * من شيفرة المصدر. فمقياس `--duration-*` مثلًا ليس نطاقًا موثّقًا في Tailwind
 * 4، ولا `--z-*` كذلك. لو كتب أحدهم `duration-fast` ولم يكن هناك مرجع يقرأه،
 * لفقد الصنف بصمت — أخطر أنواع الأخطاء: لا خطأ، ولا أسلوب.
 *
 * فالمهمة هنا مزدوجة:
 *   1) **ضمان التوليد**: كل درجة في كل مقياس مُذكورة هنا نصًّا حرفيًا، فيتولّد
 *      صنفها مهما لم تستعمله الشاشات بعد.
 *   2) **إنهاء التخمين**: الوكيل التالي لا يحتاج أن يقرأ `theme.css` ليعرف أن
 *      نصف قطر زرّ هو `rounded-lg` وأن ارتفاعه `h-control-lg`.
 *
 * القيم كلها من `styles/theme.css`؛ هذا فهرس لا مصدر. المصدر الوحيد هو الملف.
 */

/** المسافات — `gutter` يحلّ أربعة حشوات صفحات متنافسة. */
export const GUTTER = {
  /** حشوة صفحة: `px-gutter py-gutter` — المعيار الوحيد. */
  page: 'px-gutter py-gutter',
  sm: 'p-gutter-sm',
} as const

/** ارتفاعات العناصر التفاعلية. ثلاث درجات لا خمس. */
export const CONTROL = {
  /** 28px — شريط علوي مزدحم. */
  sm: 'h-control-sm',
  /** 34px — الافتراضي. */
  md: 'h-control-md',
  /** 40px — حقول نموذج وأزرار صفحات. */
  lg: 'h-control-lg',
  /** 32px — الحدّ الأدنى لمس، ولا يُكسَر. */
  tap: 'min-h-control-xs min-w-control-xs',
  /** مربّع 32×32 لأزرار الأيقونات. */
  xs: 'h-control-xs w-control-xs',
} as const

/** نصف القطر: درجة للعنصر التفاعلي، ودرجة تالية للسطح. */
export const RADIUS = {
  xs: 'rounded-xs',
  sm: 'rounded-sm',
  md: 'rounded-md',
  /** 8px — درجة العناصر التفاعلية: أزرار وحقول وقوائم. */
  control: 'rounded-lg',
  /** 12px — درجة الأسطح: بطاقات ولوحات ونوافذ وإشعارات. */
  surface: 'rounded-xl',
  hero: 'rounded-2xl',
} as const

/** سلم الطباعة — مُعايَر للعربية. */
export const TYPE = {
  /** 11px — بيانات ثانوية دقيقة. */
  micro: 'text-xs',
  /** 12px — نصوص واجهة ثانوية ورقائق. */
  small: 'text-sm',
  /** 13px — افتراضي الواجهة. */
  base: 'text-base',
  /** 15px — متن الفقرات والعناوين الفرعية. */
  body: 'text-md',
  lg: 'text-lg',
  xl: 'text-xl',
  /** 24px — `h1`. */
  h1: 'text-2xl',
  display: 'text-3xl',
} as const

export const LEADING = {
  tight: 'leading-tight',
  normal: 'leading-normal',
  relaxed: 'leading-relaxed',
} as const

/**
 * `tracking-tight` صار `0` عمدًا: التباعد السالب خطأ على خطّ عربي متّصل.
 * إن احتجت تباعدًا موجبًا فللحروف اللاتينية فقط في المقاس الصغير.
 */
export const TRACKING = {
  tight: 'tracking-tight',
  normal: 'tracking-normal',
  wide: 'tracking-wide',
  widest: 'tracking-widest',
} as const

export const ELEVATION = {
  /** 1px ظلّ خفيف. */
  e1: 'shadow-e1',
  /** بطاقة ساكنة. */
  e2: 'shadow-e2',
  /** قائمة منسدلة، تلميح، إشعار. */
  e3: 'shadow-e3',
  /** نافذة حوارية. */
  e4: 'shadow-e4',
  card: 'shadow-card',
  pop: 'shadow-pop',
} as const

export const DURATION = {
  fast: 'duration-fast',
  base: 'duration-base',
  slow: 'duration-slow',
} as const

export const EASING = {
  soft: 'ease-soft',
  snap: 'ease-snap',
  inOut: 'ease-in-out-soft',
} as const

/** الانتقال القياسي — بديل `transition-colors` لأنه يحدّد المدة والمنحنى. */
export const MOTION = {
  standard: 'transition-ui',
  colors: 'transition-colors duration-base ease-soft',
} as const

export const Z = {
  base: 'z-base',
  raised: 'z-raised',
  sticky: 'z-sticky',
  header: 'z-header',
  dropdown: 'z-dropdown',
  overlay: 'z-overlay',
  modal: 'z-modal',
  toast: 'z-toast',
  tooltip: 'z-tooltip',
} as const

/** أسطح التطبيق. `inset` بئر الإدخال، و`overlay` لوحة النافذة. */
export const SURFACE = {
  page: 'bg-bg',
  base: 'bg-surface-1',
  raised: 'bg-surface-2',
  menu: 'bg-surface-3',
  well: 'bg-inset',
  overlay: 'bg-overlay',
} as const

/** أدوار النصّ. `muted` هي `faint` القديمة بعد التصحيح. */
export const INK = {
  primary: 'text-text-primary',
  secondary: 'text-text-secondary',
  tertiary: 'text-text-tertiary',
  /** كل البيانات الوصفية في التطبيق اليوم. 5.24:1 على الصفحة. */
  muted: 'text-text-muted',
  disabled: 'text-text-disabled',
  link: 'text-text-link',
  onAccent: 'text-ink-accent',
  onSuccess: 'text-ink-success',
  onWarn: 'text-ink-warn',
  onDanger: 'text-ink-danger',
} as const

/** حدود. `line` زخرفي، و`line-strong` لحافة هي الأداة نفسها. */
export const BORDER = {
  hairline: 'border-line',
  /** حدود الحقول والرقائق القابلة للإزالة: 1.62:1 مقابل 1.29:1. */
  control: 'border-line-strong',
  accent: 'border-accent-border',
  success: 'border-success-border',
  warn: 'border-warn-border',
  danger: 'border-danger-border',
} as const

export const ACCENT = {
  base: 'bg-accent',
  hover: 'bg-accent-hover',
  active: 'bg-accent-active',
  soft: 'bg-accent-bg',
  text: 'text-accent',
} as const

/** أرقام في عمود: زمن الاستجابة ومدد الأدوات. */
export const NUMBERS = 'tabular-nums'

/** حلقة التركيز — الصنف الوحيد. **لا تستعمل `outline-none` أبدًا.** */
export const FOCUS_RING = 'focus-ring'

/** بطاقة ساكنة (يكافئ `card`). للمكوّنات التفاعلية استعمل `<Card>`. */
export const CARD = 'card'
