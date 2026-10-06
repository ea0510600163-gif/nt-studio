/**
 * أجزاء مشتركة بين المكوّنات — خرائط أصناف بدل سلاسل مكرّرة.
 *
 * كل سلسلة هنا **حرفية** وليست مركّبة، لأن ماسح Tailwind يقرأ النص الخام من
 * ملفات المصدر؛ لو ركّبنا `bg-${tone}` لتوقّف توليد الأدوات. الخريطة هي
 * المصدر الوحيد للحجم في كل التطبيق، فلا يختلف زرّان بنفس `size`.
 */

/** نبرةStatus واحدة للاستخدام في `Badge` و`Chip` و`StatusDot` و`Toast`. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger'

/** ارتفاع عنصر تفاعلي. ثلاث درجات، لا خمس. */
export type ControlSize = 'sm' | 'md' | 'lg'

/** `sm` = شريط علوي مزدحم (28) · `md` = الافتراضي (34) · `lg` = حقول نموذج (40). */
export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: 'h-control-sm',
  md: 'h-control-md',
  lg: 'h-control-lg',
}

/** `sm` = 12px · `md` = 13px (افتراضي الواجهة) · `lg` = 15px. */
export const CONTROL_TEXT: Record<ControlSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-md',
}

/** لون النصّ وحده — لِـ`StatusDot` و`Tooltip` ونقاط التقدّم. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text-secondary',
  accent: 'text-accent',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
}

/** لون الملء فقط — للنقاط والشرائط. */
export const TONE_FILL: Record<Tone, string> = {
  neutral: 'bg-text-tertiary',
  accent: 'bg-accent',
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
}

/**
 * سطح إنذار كامل: سطح معتم + حدّ + نص. أدوار Status الثلاث معًا، حتى يصير
 * التنبيه مقروءًا بدل أن يكون لطخة لون واحدة.
 */
export const TONE_ALERT: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-text-secondary',
  accent: 'border-accent-border bg-accent-bg text-accent',
  success: 'border-success-border bg-success-bg text-success',
  warn: 'border-warn-border bg-warn-bg text-warn',
  danger: 'border-danger-border bg-danger-bg text-danger',
}

/** نسخة أفتح من `TONE_ALERT` للرقائق والوسوم الصغيرة. */
export const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-text-secondary',
  accent: 'border-accent-border bg-accent-bg text-accent',
  success: 'border-success-border bg-success-bg text-success',
  warn: 'border-warn-border bg-warn-bg text-warn',
  danger: 'border-danger-border bg-danger-bg text-danger',
}
