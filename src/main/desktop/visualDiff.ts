export const FP_COLS = 32
export const FP_ROWS = 24

export const MAD_MIN = 2.5
export const CELLS_MIN = 8
export const CELL_DELTA = 24

export const UNCHANGED_REPEATS_BEFORE_BLOCK = 2

export type FrameFingerprint = Uint8Array

export function fingerprintBitmap(pixels: Uint8Array | Buffer, width: number, height: number): FrameFingerprint {
  const fp = new Uint8Array(FP_COLS * FP_ROWS)
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return fp

  const acc = new Uint32Array(fp.length)
  const hits = new Uint32Array(fp.length)
  const cellW = width / FP_COLS
  const cellH = height / FP_ROWS
  const stepX = Math.max(1, Math.floor(cellW / 8))
  const stepY = Math.max(1, Math.floor(cellH / 8))

  for (let y = 0; y < height; y += stepY) {
    const row = Math.min(FP_ROWS - 1, Math.floor(y / cellH)) * FP_COLS
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4
      const luma = (pixels[i + 2] * 77 + pixels[i + 1] * 150 + pixels[i] * 29) >> 8
      const cell = row + Math.min(FP_COLS - 1, Math.floor(x / cellW))
      acc[cell] += luma
      hits[cell]++
    }
  }
  for (let i = 0; i < fp.length; i++) fp[i] = hits[i] ? Math.round(acc[i] / hits[i]) : 0
  return fp
}

export interface FrameChange {
  changed: boolean
  mad: number
  changedCells: number
}

export function compareFingerprints(prev: FrameFingerprint | null, next: FrameFingerprint | null): FrameChange {
  if (!prev || !next || prev.length !== next.length) return { changed: true, mad: 255, changedCells: FP_COLS * FP_ROWS }
  let sum = 0
  let cells = 0
  for (let i = 0; i < prev.length; i++) {
    const d = Math.abs(prev[i] - next[i])
    sum += d
    if (d >= CELL_DELTA) cells++
  }
  const mad = sum / prev.length
  return { changed: mad >= MAD_MIN || cells >= CELLS_MIN, mad, changedCells: cells }
}

export const POINTER_ACTIONS: ReadonlySet<string> = new Set([
  'left_click',
  'click',
  'double_click',
  'triple_click',
  'right_click',
  'middle_click',
  'left_click_drag',
  'drag'
])

export function describeAction(kind: string, x?: number, y?: number, text?: string): string {
  const pos = x != null && y != null ? ` عند (${Math.round(x)}, ${Math.round(y)})` : ''
  if (text) return `${kind} «${text.slice(0, 40)}»`
  return `${kind}${pos}`
}

export function actionSignature(
  kind: string,
  input: {
    coordinate?: unknown
    x?: unknown
    y?: unknown
    start_coordinate?: unknown
    start_x?: unknown
    start_y?: unknown
    text?: unknown
    key?: unknown
    direction?: unknown
    amount?: unknown
  }
): string {
  const num = (v: unknown): number | null => (v == null || isNaN(Number(v)) ? null : Math.round(Number(v)))
  const cx = num(input.coordinate?.[0 as never]) ?? num(input.x)
  const cy = num(input.coordinate?.[1 as never]) ?? num(input.y)
  const sx = num(input.start_coordinate?.[0 as never]) ?? num(input.start_x)
  const sy = num(input.start_coordinate?.[1 as never]) ?? num(input.start_y)
  const parts: string[] = [kind]
  if (cx != null && cy != null) parts.push(`${cx},${cy}`)
  if (sx != null && sy != null) parts.push(`from ${sx},${sy}`)
  if (input.text != null && String(input.text).trim()) parts.push(`text:${String(input.text).trim().slice(0, 60)}`)
  if (input.key != null && String(input.key).trim()) parts.push(`key:${String(input.key).trim().slice(0, 40)}`)
  if (input.direction != null) parts.push(`dir:${String(input.direction)}`)
  if (input.amount != null) parts.push(`amount:${String(input.amount)}`)
  return parts.join('|')
}

export interface CycleVerdict {
  blocked: boolean
  repeats: number
  unchangedRepeats: number
  hint: string | null
}

export function stuckAlternatives(kind: string, x?: number, y?: number): string {
  const where = describeAction(kind, x, y)
  return (
    `ملاحظة بصرية: ${where} تكرر ولم تتغيّر الشاشة.\n` +
    'بدائل متاحة عند الحاجة:\n' +
    '1) في المتصفح: key "ctrl+l" لإبراز شريط العنوان ثم type بنص الرابط/الاستعلام مباشرةً (+ Enter).\n' +
    '2) key "Tab" أو "shift+Tab" للتنقل بين العناصر، أو scroll إن كان العنصر خارج الشاشة.\n' +
    '3) خذ screenshot جديدة، أو desktop_app action="list_windows" للتحقق من النافذة النشطة.\n' +
    '4) إن كان الموقع بطيئاً: wait 2 ثوانٍ ثم أعد الفحص.'
  )
}

export function stuckWarning(kind: string, x?: number, y?: number): string {
  return (
    `ملاحظة: لم تتغيّر الشاشة بعد ${describeAction(kind, x, y)}. ` +
    'يمكنك تجربة ctrl+l + كتابة الرابط مباشرة، أو Tab للتنقل، أو scroll/فحص النوافذ.'
  )
}

export class ActionCycleGuard {
  private sig: string | null = null
  private lastKind = ''
  private lastX: number | undefined
  private lastY: number | undefined
  private repeats = 0
  private unchanged = 0

  get current(): { sig: string | null; kind: string; x?: number; y?: number; repeats: number; unchangedRepeats: number } {
    return { sig: this.sig, kind: this.lastKind, x: this.lastX, y: this.lastY, repeats: this.repeats, unchangedRepeats: this.unchanged }
  }

  preflight(kind: string, x?: number, y?: number, sig?: string): CycleVerdict {
    const same = this.sig !== null && (sig ?? this.sig) === this.sig
    if (!same) return { blocked: false, repeats: this.repeats, unchangedRepeats: 0, hint: null }
    if (this.unchanged >= UNCHANGED_REPEATS_BEFORE_BLOCK) {
      return { blocked: true, repeats: this.repeats, unchangedRepeats: this.unchanged, hint: stuckAlternatives(kind, x, y) }
    }
    if (this.unchanged === UNCHANGED_REPEATS_BEFORE_BLOCK - 1) {
      return { blocked: false, repeats: this.repeats, unchangedRepeats: this.unchanged, hint: stuckWarning(kind, x, y) }
    }
    return { blocked: false, repeats: this.repeats, unchangedRepeats: this.unchanged, hint: null }
  }

  observe(kind: string, changed: boolean, input: { x?: number; y?: number; sig?: string } = {}): CycleVerdict {
    const sig = input.sig ?? this.sig
    const x = input.x ?? this.lastX
    const y = input.y ?? this.lastY
    if (sig != null && sig === this.sig) {
      this.repeats++
      this.unchanged = changed ? 0 : this.unchanged + 1
    } else {
      this.sig = sig ?? null
      this.repeats = 1
      this.unchanged = changed ? 0 : 1
    }
    this.lastKind = kind
    this.lastX = x
    this.lastY = y
    const verdict: CycleVerdict = {
      blocked: false,
      repeats: this.repeats,
      unchangedRepeats: this.unchanged,
      hint: null
    }
    if (!changed && this.unchanged >= UNCHANGED_REPEATS_BEFORE_BLOCK) {
      verdict.blocked = true
      verdict.hint = stuckAlternatives(kind, x, y)
    } else if (!changed && this.unchanged >= 1 && POINTER_ACTIONS.has(kind)) {
      verdict.hint = stuckWarning(kind, x, y)
    }
    return verdict
  }

  reset(): void {
    this.sig = null
    this.lastKind = ''
    this.lastX = undefined
    this.lastY = undefined
    this.repeats = 0
    this.unchanged = 0
  }
}
