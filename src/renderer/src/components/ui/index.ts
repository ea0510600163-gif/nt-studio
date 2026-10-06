/**
 * مكتبة الواجهة — نقطة استيراد واحدة.
 *
 * ```tsx
 * import { Button, Field, Input, IconTrash, type Tone } from './components/ui'
 * // أو من أي مكان داخل src/renderer/src:
 * import { Button } from '../ui'          // من components/
 * import { Button } from './ui'           // من الجذر
 * ```
 *
 * **الاستيراد نسبي عمدًا.** لا يوجد `@/` في هذا المشروع: إضافته تحتاج
 * `electron.vite.config.ts` و`tsconfig.json`، وكلاهما خارج ملكية هذه المرحلة.
 *
 * التوثيق الكامل للخصائص في `.superpowers/sdd/revive/w2-a-report.md`.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button'
export { IconButton, type IconButtonProps } from './IconButton'
export { Input, type InputProps } from './Input'
export { Textarea, type TextareaProps } from './Textarea'
export { Select, type SelectOption, type SelectProps } from './Select'
export { Field, type FieldControlProps, type FieldProps } from './Field'
export { Card, type CardPadding, type CardProps, type CardTone, type CardVariant } from './Card'
export { Badge, type BadgeProps } from './Badge'
export { Chip, type ChipProps } from './Chip'
export { StatusDot, type StatusDotProps } from './StatusDot'
export { ConfirmDialog, Dialog, type ConfirmDialogProps, type DialogProps, type DialogSize, type DialogTone } from './Dialog'
export { Tooltip, type TooltipProps } from './Tooltip'
export { Toast, ToastRegion, type ToastProps, type ToastRegionProps } from './Toast'
export { Spinner, type SpinnerProps } from './Spinner'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { KeyHint, type KeyHintProps } from './KeyHint'

export { ICON_NAMES, type IconProps } from './icons'
export * from './icons'
export { cx, type ClassValue } from './cx'
export * as scale from './scales'
export {
  CONTROL_HEIGHT,
  CONTROL_TEXT,
  TONE_ALERT,
  TONE_CHIP,
  TONE_FILL,
  TONE_TEXT,
  type ControlSize,
  type Tone,
} from './parts'
