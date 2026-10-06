/**
 * دمج الأصناف — بديل `clsx` بسطر واحد، بلا اعتمادية جديدة.
 *
 * يقبل قيَمًا مفردة أو مصفوفات متداخلة ويزيل كل `false`/`null`/`undefined`، فيمكن
 * بناء الأصناف بشرط مباشرة: `cx('base', isOn && 'bg-surface-3')`.
 */

export type ClassValue = string | number | boolean | null | undefined | ClassValue[]

export function cx(...values: ClassValue[]): string {
  const out: string[] = []
  const walk = (value: ClassValue): void => {
    if (value === null || value === undefined || value === false || value === true || value === '') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    out.push(String(value))
  }
  for (const value of values) walk(value)
  return out.join(' ')
}
