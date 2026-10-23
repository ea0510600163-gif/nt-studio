export const MAX_LONG_EDGE = 1280

export const NATIVE_1TO1_MAX_W = 1366
export const NATIVE_1TO1_MAX_H = 768

export interface Size {
  w: number
  h: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function fitLogical(screenW: number, screenH: number, maxEdge = MAX_LONG_EDGE): Size {
  const sw = Math.max(1, Math.round(Number(screenW) || 1))
  const sh = Math.max(1, Math.round(Number(screenH) || 1))
  if (sw <= NATIVE_1TO1_MAX_W && sh <= NATIVE_1TO1_MAX_H && maxEdge === MAX_LONG_EDGE) {
    return { w: sw, h: sh }
  }
  const k = Math.min(1, maxEdge / Math.max(sw, sh))
  return { w: Math.max(2, Math.round(sw * k)), h: Math.max(2, Math.round(sh * k)) }
}

export interface PhysicalPoint {
  physX: number
  physY: number
  nx: number
  ny: number
  clampedX: number
  clampedY: number
}

export function toPhysicalPoint(x: number, y: number, logical: Size, screen: Size): PhysicalPoint {
  let rawX = Number(x) || 0
  let rawY = Number(y) || 0
  if (rawX > 0 && rawX < 1 && rawY > 0 && rawY < 1) {
    rawX = rawX * logical.w
    rawY = rawY * logical.h
  }
  const clampedX = clamp(Math.round(rawX), 0, logical.w)
  const clampedY = clamp(Math.round(rawY), 0, logical.h)
  if (logical.w === screen.w && logical.h === screen.h) {
    const physX = clamp(clampedX, 0, screen.w - 1)
    const physY = clamp(clampedY, 0, screen.h - 1)
    return { physX, physY, nx: clampedX / logical.w, ny: clampedY / logical.h, clampedX, clampedY }
  }
  const physX = clamp(Math.floor(((clampedX + 0.5) / logical.w) * screen.w), 0, screen.w - 1)
  const physY = clamp(Math.floor(((clampedY + 0.5) / logical.h) * screen.h), 0, screen.h - 1)
  return { physX, physY, nx: clampedX / logical.w, ny: clampedY / logical.h, clampedX, clampedY }
}

export function toLogicalPoint(physX: number, physY: number, logical: Size, screen: Size): { x: number; y: number; nx: number; ny: number } {
  if (logical.w === screen.w && logical.h === screen.h) {
    const x = clamp(Math.round(physX), 0, logical.w)
    const y = clamp(Math.round(physY), 0, logical.h)
    return { x, y, nx: clamp(x / Math.max(1, logical.w), 0, 1), ny: clamp(y / Math.max(1, logical.h), 0, 1) }
  }
  const nx = clamp(physX / Math.max(1, screen.w), 0, 1)
  const ny = clamp(physY / Math.max(1, screen.h), 0, 1)
  return { x: Math.round(nx * logical.w), y: Math.round(ny * logical.h), nx, ny }
}

export interface ZoomPlan {
  region: [number, number, number, number]
  crop: { x: number; y: number; width: number; height: number }
  out: Size
}

export function planZoom(region: number[], logical: Size, screen: Size, maxEdge = MAX_LONG_EDGE, maxUpscale = 2): ZoomPlan {
  const v = (i: number, hi: number) => clamp(Math.round(Number(region[i]) || 0), 0, hi)
  let x1 = v(0, logical.w)
  let y1 = v(1, logical.h)
  let x2 = v(2, logical.w)
  let y2 = v(3, logical.h)
  if (x1 > x2) [x1, x2] = [x2, x1]
  if (y1 > y2) [y1, y2] = [y2, y1]
  const MIN = 24
  if (x2 - x1 < MIN) {
    const c = (x1 + x2) / 2
    x1 = clamp(Math.round(c - MIN / 2), 0, Math.max(0, logical.w - MIN))
    x2 = Math.min(logical.w, x1 + MIN)
  }
  if (y2 - y1 < MIN) {
    const c = (y1 + y2) / 2
    y1 = clamp(Math.round(c - MIN / 2), 0, Math.max(0, logical.h - MIN))
    y2 = Math.min(logical.h, y1 + MIN)
  }
  const cx = clamp(Math.floor((x1 / logical.w) * screen.w), 0, screen.w - 1)
  const cy = clamp(Math.floor((y1 / logical.h) * screen.h), 0, screen.h - 1)
  const cw = clamp(Math.round(((x2 - x1) / logical.w) * screen.w), 1, screen.w - cx)
  const ch = clamp(Math.round(((y2 - y1) / logical.h) * screen.h), 1, screen.h - cy)
  const scale = Math.min(maxEdge / Math.max(cw, ch), maxUpscale)
  return {
    region: [x1, y1, x2, y2],
    crop: { x: cx, y: cy, width: cw, height: ch },
    out: { w: Math.max(2, Math.round(cw * scale)), h: Math.max(2, Math.round(ch * scale)) }
  }
}

export function mapZoomPointToLogical(zx: number, zy: number, plan: ZoomPlan): { x: number; y: number } {
  const [x1, y1, x2, y2] = plan.region
  const rx = clamp(zx / Math.max(1, plan.out.w), 0, 1)
  const ry = clamp(zy / Math.max(1, plan.out.h), 0, 1)
  return {
    x: Math.round(x1 + rx * (x2 - x1)),
    y: Math.round(y1 + ry * (y2 - y1))
  }
}

export function drawCursorAndRulerOnBgra(
  bgra: Uint8Array | Buffer,
  width: number,
  height: number,
  cursorX: number,
  cursorY: number
): void {
  if (width <= 0 || height <= 0 || bgra.length < width * height * 4) return

  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const i = (y * width + x) * 4
    bgra[i] = b
    bgra[i + 1] = g
    bgra[i + 2] = r
    bgra[i + 3] = 255
  }

  for (let x = 100; x < width; x += 100) {
    const major = x % 200 === 0
    const len = major ? 7 : 4
    for (let y = 0; y < len; y++) {
      setPx(x, y, major ? 34 : 180, major ? 211 : 180, major ? 238 : 180)
      setPx(x - 1, y, 15, 23, 42)
    }
  }
  for (let y = 100; y < height; y += 100) {
    const major = y % 200 === 0
    const len = major ? 7 : 4
    for (let x = 0; x < len; x++) {
      setPx(x, y, major ? 34 : 180, major ? 211 : 180, major ? 238 : 180)
      setPx(x, y - 1, 15, 23, 42)
    }
  }

  const cx = clamp(Math.round(cursorX), 0, width - 1)
  const cy = clamp(Math.round(cursorY), 0, height - 1)

  for (let d = -10; d <= 10; d++) {
    if (Math.abs(d) >= 3) {
      setPx(cx + d, cy - 1, 10, 14, 24)
      setPx(cx + d, cy + 1, 10, 14, 24)
      setPx(cx + d, cy, 255, 56, 92)
      setPx(cx - 1, cy + d, 10, 14, 24)
      setPx(cx + 1, cy + d, 10, 14, 24)
      setPx(cx, cy + d, 255, 56, 92)
    }
  }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      setPx(cx + dx, cy + dy, 34, 211, 238)
    }
  }
  setPx(cx, cy, 255, 255, 255)
}
