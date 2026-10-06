import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type Ref } from 'react'
import { cx } from './cx'
import { CONTROL_TEXT, type ControlSize } from './parts'
import { IconCheck, IconChevronDown } from './icons'

/**
 * قائمة اختيار — **ليست** `<select>` عارية.
 *
 * لماذا: `<select>` أصلي في ويندوز يرسم سهمًا نظامًا وحقلًا رماديًا لا يتبع
 * لوحة التطبيق، ولا يقبل `appearance-none` في Electron بثبات — فتصير ثلاثة
 * عناصر مختلفة المظهر في الشاشة نفسها. البديل هنا:
 *
 *   • `role="combobox"` + `aria-haspopup="listbox"` + `aria-expanded`
 *   • لوحة منسدلة `role="listbox"` بـ`role="option"` و`aria-selected`
 *   • `aria-activedescendant` يتتبّع الخيار المُبرَز بينما يبقى التركيز على الزر
 *   • تنقّل كامل: ↑ ↓ Home End Enter Space Esc Tab وكتابة حرف للأوّل
 *   • السهم على `end` (منطقي) فينعكس مع RTL بلا شرط
 *   • الحدّ يمرّ بـ`control-border` كما في `Input` — الحالة المفتوحة تجعله
 *     `accent` عبر صنف واحد، والحلقة تظلّ 2px منفصلة عن الحدّ
 *
 * سلوك الأسهم: تنقّل يُغيّر القيمة فورًا (كما يفعل `<select>` أصلي)، و`Esc`
 * **يعيد القيمة التي كانت قبل الفتح** ثم يغلق.
 */

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  /** سطر ثانٍ صغير — يشرح الخيار («ترويسة x-api-key لا Authorization»). */
  hint?: string
  disabled?: boolean
}

export interface SelectProps<T extends string = string> {
  options: readonly SelectOption<T>[]
  value: T | null
  onChange: (value: T) => void
  /** اسم يمكن الوصول إليه. إلزامي ما لم يكن هناك `<Field label>` يمرّر `id`. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  id?: string
  /** نصّ الحقل الفارغ. الافتراضي «اختر». */
  placeholder?: string
  size?: ControlSize
  invalid?: boolean
  disabled?: boolean
  required?: boolean
  className?: string
  /** عِرف عادي في React 19 — يشير إلى زرّ الفتح. */
  ref?: Ref<HTMLButtonElement>
}

const SIZE: Record<ControlSize, string> = {
  sm: 'h-control-sm px-2.5 text-xs gap-1.5',
  md: 'h-control-md px-3 text-base gap-2',
  lg: 'h-control-lg px-3.5 text-base gap-2',
}

function indexOfValue<T extends string>(options: readonly SelectOption<T>[], value: T | null): number {
  if (value === null) return -1
  return options.findIndex((o) => o.value === value)
}

/** أول خيار مفعّل عند direction؛ `-1` إن لم يوجد. */
function step<T extends string>(
  options: readonly SelectOption<T>[],
  from: number,
  direction: 1 | -1,
): number {
  const n = options.length
  if (n === 0) return -1
  for (let i = 1; i <= n; i++) {
    const index = (from + direction * i + n * 2) % n
    const option = options[index]
    if (option !== undefined && option.disabled !== true) return index
  }
  return -1
}

export function Select<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  invalid = false,
  disabled = false,
  required = false,
  placeholder = 'اختر',
  className,
  id,
  ...aria
}: SelectProps<T>): JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const triggerId = id ?? `s-${uid}`
  const listId = `${triggerId}-list`
  const optionId = (index: number): string => `${triggerId}-opt-${index}`

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<number>(() => Math.max(0, indexOfValue(options, value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  /** القيمة قبل الفتح: هي ما يُعيده `Escape`. */
  const preOpenRef = useRef<T | null>(null)

  const selected = indexOfValue(options, value)
  const selectedOption = selected >= 0 ? options[selected] : undefined

  // إغلاق عند النقر خارج — كمعالج pointerdown على document، لا كـeffect لكل إطار.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: PointerEvent): void => {
      const node = rootRef.current
      if (node === null) return
      if (!(event.target instanceof Node)) return
      if (node.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const commit = (index: number): void => {
    const option = options[index]
    if (option === undefined || option.disabled === true) return
    if (option.value !== value) onChange(option.value)
  }

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  /** الفتح: نحفظ القيمة الراهنة ليعيدها `Escape` إن غيّرها التنقّل. */
  const show = (seed: number): void => {
    preOpenRef.current = value
    setActive(seed)
    setOpen(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    const last = options.length - 1

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        if (!open) {
          const seed = selected >= 0 ? selected : direction === 1 ? -1 : options.length
          const first = step(options, seed, direction)
          show(first >= 0 ? first : 0)
          return
        }
        const next = step(options, active, direction)
        if (next >= 0) {
          setActive(next)
          commit(next)
        }
        return
      }
      case 'Home':
      case 'End': {
        if (!open) return
        event.preventDefault()
        const target = event.key === 'Home' ? 0 : last
        if (options[target]?.disabled === true) return
        setActive(target)
        commit(target)
        return
      }
      case 'Enter':
      case ' ':
      case 'Spacebar': {
        event.preventDefault()
        if (!open) {
          show(Math.max(0, selected))
          return
        }
        commit(active)
        close()
        return
      }
      case 'Escape': {
        if (!open) return
        event.preventDefault()
        // What the arrows changed must go back: that is what "cancel" means.
        if (preOpenRef.current !== null && preOpenRef.current !== value) onChange(preOpenRef.current)
        setActive(Math.max(0, selected))
        setOpen(false)
        return
      }
      case 'Tab': {
        setOpen(false)
        return
      }
      default: {
        // كتابة حرف واحد → اقفز إلى أول خيار يبدأ به (typeahead).
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const needle = event.key.toLowerCase()
        const found = options.findIndex(
          (o) => o.disabled !== true && o.label.toLowerCase().startsWith(needle),
        )
        if (found < 0) return
        event.preventDefault()
        setActive(found)
        commit(found)
        if (!open) show(found)
      }
    }
  }

  return (
    <div ref={rootRef} className={cx('relative inline-block w-full', className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] !== undefined ? optionId(active) : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show(Math.max(0, selected)))}
        onKeyDown={onKeyDown}
        className={cx(
          'focus-ring control-border flex w-full items-center rounded-lg border bg-inset text-start',
          'transition-ui disabled:cursor-not-allowed disabled:opacity-45',
          invalid && 'focus-visible:[--ring-focus-color:var(--color-danger)]',
          SIZE[size],
          CONTROL_TEXT[size],
          open && 'border-accent',
        )}
        {...aria}
      >
        <span
          className={cx(
            'min-w-0 flex-1 truncate',
            selectedOption === undefined && 'text-text-muted',
          )}
        >
          {selectedOption === undefined ? placeholder : selectedOption.label}
        </span>
        <IconChevronDown
          size={16}
          className={cx('text-text-muted transition-ui', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={triggerId}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-dropdown max-h-64 overflow-auto rounded-lg border border-line bg-overlay p-1 shadow-pop"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-muted">لا توجد خيارات</li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled === true || undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  commit(index)
                  close()
                }}
                className={cx(
                  'flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2',
                  'transition-ui',
                  index === active && 'bg-surface-3',
                  option.disabled === true && 'pointer-events-none opacity-45',
                )}
              >
                <span className="mt-0.5 w-4 shrink-0 text-accent">
                  {option.value === value ? <IconCheck size={15} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text-primary">{option.label}</span>
                  {option.hint === undefined ? null : (
                    <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{option.hint}</span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

export default Select
