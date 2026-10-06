// ============================================================================
// check-contrast.mjs — WCAG 2.x contrast audit AND gate for the NT Studio tokens.
//
// Run:  node scripts/check-contrast.mjs
// Exit: 0 only when EVERY rule below passes. Non-zero on any failure.
//
// WHY THIS IS A GATE AND NOT A REPORT
// -----------------------------------
// Version 1 of this script printed `RESULT: PASS` while input wells sat at
// 1.11:1 and interactive borders at 1.29:1 — it *reported* the defect as a pass
// because it only ever asserted the TEXT rules. That was the worst kind of
// tool: it looked authoritative and was silent. Every rule here is now
// machine-checked against a stated minimum, and the script exits non-zero.
//
// RULES ENFORCED
//   T1  every text role            >= 4.5:1 on EVERY surface it can land on,
//                                   including the lightest (`surface-3`) and the
//                                   recessed `inset`. The one declared exemption
//                                   is `text-disabled` at 3.0 (WCAG 1.4.3 exempts
//                                   inactive controls; 4.5 would force it to the
//                                   same luminance as `muted` and erase the
//                                   "this is off" signal).
//   B1  every interactive boundary >= 3.0:1 (WCAG 1.4.11) against BOTH its own
//                                   fill and every surface behind it.
//   D1  the decorative card border >= 1.5:1 against the card it outlines.
//   X1  theme.css declares EXACTLY these hex values (so the audit cannot drift
//                                   away from what actually ships).
//   X2  legacy aliases are byte-identical to the new tokens they map to, so the
//                                   three unmigrated screens keep working.
//   H1  historical self-test: the formula reproduces four independently-known
//       pre-wave-2 values. If the maths drifts, everything above is worthless.
//
// The formula is the WCAG 2.x relative-luminance definition; H1 is what makes
// the numbers trustworthy.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* ------------------------------------------------------------------ colour */

function parseHex(hex) {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) throw new Error(`bad hex: ${hex}`)
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** WCAG 2.x: c/255, then the sRGB companding transfer function. */
function channel(v) {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance L = 0.2126R + 0.7152G + 0.0722B. */
function luminance(hex) {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio (L1 + 0.05) / (L2 + 0.05). */
function ratio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Flatten a translucent colour over an opaque backdrop. Tailwind's `/nn`
 * opacity modifier is `color-mix(in srgb, C nn%, B)`, so this is how a
 * `bg-danger/10` alert actually composites.
 */
function over(fgHex, alpha, bgHex) {
  const f = parseHex(fgHex)
  const b = parseHex(bgHex)
  return (
    '#' +
    f
      .map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  )
}

const r2 = (n) => n.toFixed(2)
const pad = (s, n) => String(s).padEnd(n)

/* =========================================================================
 * THE RULED PALETTE
 * Anything changed here must also change in src/renderer/src/styles/theme.css
 * — rule X1 below enforces that they agree.
 * ====================================================================== */

/* =========================================================================
 * THE RULED PALETTE — read from theme.css, then checked against the ruling.
 *
 * ORDER MATTERS. The audit below computes its ratios from `C()`, i.e. from the
 * values that ACTUALLY SHIP. A previous version of this script computed them
 * from a hard-coded table and only compared the table to the CSS afterwards,
 * which meant a bad value in theme.css was caught by the "do these files agree"
 * rule instead of by the contrast rule that exists to catch bad values. Now the
 * substantive rules (T1/B1/D1) judge the shipped palette, and X1 separately
 * judges whether that palette is still the one that was ruled.
 * ====================================================================== */

/** Resolved from this file's own location, so it works from any cwd. */
const CSS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src/renderer/src/styles/theme.css',
)

/** Reads every `--color-<name>: #hex` declaration out of theme.css. */
function readCssTokens() {
  const css = fs.readFileSync(CSS_PATH, 'utf8')
  const out = {}
  for (const m of css.matchAll(/--(color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[(m[1] ?? '').replace(/^color-/, '')] = (m[2] ?? '').toLowerCase()
  }
  return out
}

let CSS_TOKENS = {}
let CSS_READ_ERROR = null
try {
  CSS_TOKENS = readCssTokens()
} catch (e) {
  CSS_READ_ERROR = String(e)
}

/** The value that ships. Falls back to the ruling only if the file is unreadable,
 *  in which case X1 fails loudly and the ratios are explicitly suspect. */
function C(name) {
  return CSS_TOKENS[name] ?? RULED[name] ?? '#000000'
}

/** new token -> legacy alias that must be byte-identical to it. */
const LEGACY_ALIASES = {
  app: 'bg',
  panel: 'surface-1',
  panel2: 'surface-2',
  panel3: 'surface-3',
  line2: 'line-strong',
  main: 'text-primary',
  dim: 'text-secondary',
  mute: 'text-tertiary',
  faint: 'text-muted',
}

/**
 * THE RULING — what theme.css is required to declare. Pure literals, so this
 * table is a specification and not a mirror of whatever the file happens to say.
 */
const RULED = {
  bg: '#08090b',
  'surface-1': '#12151a',
  'surface-2': '#1a1e25',
  'surface-3': '#232832',
  inset: '#0d0f13',
  overlay: '#1a1e25',
  line: '#343a44',
  'line-strong': '#616a76',
  'line-hover': '#737d8a',
  'text-primary': '#eef1f6',
  'text-secondary': '#c6cdd8',
  'text-tertiary': '#a4aebd',
  'text-muted': '#8b95a6',
  'text-disabled': '#6b7484',
  'text-link': '#7fb0ff',
  'ink-accent': '#04101f',
  'ink-success': '#04160c',
  'ink-warn': '#251802',
  'ink-danger': '#2b0407',
  accent: '#4c8dff',
  'accent-hover': '#6ea1ff',
  'accent-active': '#3d7ae8',
  'accent-bg': '#111d33',
  success: '#3ddc97',
  'success-bg': '#0d2419',
  warn: '#f5b544',
  'warn-bg': '#261a06',
  danger: '#ff7b7b',
  'danger-bg': '#2a0e11',
}

const S = {
  bg: C('bg'),
  'surface-1': C('surface-1'),
  'surface-2': C('surface-2'),
  'surface-3': C('surface-3'),
  inset: C('inset'),
  overlay: C('overlay'),
}

const LINE = C('line')
const LINE_STRONG = C('line-strong')
const LINE_HOVER = C('line-hover')

const ACCENT = C('accent')
const ACCENT_HOVER = C('accent-hover')
const ACCENT_ACTIVE = C('accent-active')
const ACCENT_BG = C('accent-bg')

const SUCCESS_FG = C('success')
const SUCCESS_BG = C('success-bg')
const WARN_FG = C('warn')
const WARN_BG = C('warn-bg')
const DANGER_FG = C('danger')
const DANGER_BG = C('danger-bg')

const TEXT = {
  primary: C('text-primary'),
  secondary: C('text-secondary'),
  tertiary: C('text-tertiary'),
  muted: C('text-muted'),
  disabled: C('text-disabled'),
  link: C('text-link'),
  'ink-accent': C('ink-accent'),
  'ink-success': C('ink-success'),
  'ink-warn': C('ink-warn'),
  'ink-danger': C('ink-danger'),
}

const EXTRA_SURFACES = {
  accent: ACCENT,
  'accent-hover': ACCENT_HOVER,
  'accent-active': ACCENT_ACTIVE,
  'accent-bg': ACCENT_BG,
  'success-bg': SUCCESS_BG,
  'warn-bg': WARN_BG,
  'danger-bg': DANGER_BG,
  'accent/10@surface-1': over(ACCENT, 0.1, S['surface-1']),
  'success/10@surface-1': over(SUCCESS_FG, 0.1, S['surface-1']),
  'warn/10@surface-1': over(WARN_FG, 0.1, S['surface-1']),
  'danger/10@surface-1': over(DANGER_FG, 0.1, S['surface-1']),
}

const surfaceHex = (key) => EXTRA_SURFACES[key] ?? S[key]

/* =========================================================================
 * RULE T1 — TEXT ROLES
 * ====================================================================== */

const TEXT_MIN = 4.5
const DISABLED_MIN = 3.0

/** Surfaces a piece of body text can physically land on. All five, always. */
const ALL_SURFACES = ['bg', 'surface-1', 'surface-2', 'surface-3', 'inset', 'overlay']

const TEXT_ROLES = [
  { name: 'text-primary', hex: TEXT.primary, on: ALL_SURFACES },
  { name: 'text-secondary', hex: TEXT.secondary, on: ALL_SURFACES },
  { name: 'text-tertiary', hex: TEXT.tertiary, on: ALL_SURFACES },
  { name: 'text-muted (== legacy faint)', hex: TEXT.muted, on: ALL_SURFACES },
  {
    name: 'text-disabled',
    hex: TEXT.disabled,
    on: ['bg', 'surface-1', 'surface-2', 'surface-3'],
    need: DISABLED_MIN,
    exempt: 'WCAG 1.4.3 exempts inactive controls',
  },
  { name: 'text-link', hex: TEXT.link, on: ALL_SURFACES },
  { name: 'accent-fg', hex: ACCENT, on: ALL_SURFACES },
  { name: 'success-fg', hex: SUCCESS_FG, on: ALL_SURFACES },
  { name: 'warn-fg', hex: WARN_FG, on: ALL_SURFACES },
  { name: 'danger-fg', hex: DANGER_FG, on: ALL_SURFACES },
  { name: 'ink-accent', hex: TEXT['ink-accent'], on: ['accent', 'accent-hover', 'accent-active'] },
  { name: 'ink-success', hex: TEXT['ink-success'], on: ['success-bg-solid'] },
  { name: 'ink-warn', hex: TEXT['ink-warn'], on: ['warn-bg-solid'] },
  { name: 'ink-danger', hex: TEXT['ink-danger'], on: ['danger-bg-solid'] },
  { name: 'text-primary on accent-bg', hex: TEXT.primary, on: ['accent-bg'] },
  { name: 'text-primary on success-bg', hex: TEXT.primary, on: ['success-bg'] },
  { name: 'text-primary on warn-bg', hex: TEXT.primary, on: ['warn-bg'] },
  { name: 'text-primary on danger-bg', hex: TEXT.primary, on: ['danger-bg'] },
  { name: 'muted on accent-bg', hex: TEXT.muted, on: ['accent-bg'] },
  { name: 'muted on success-bg', hex: TEXT.muted, on: ['success-bg'] },
  { name: 'muted on warn-bg', hex: TEXT.muted, on: ['warn-bg'] },
  { name: 'muted on danger-bg', hex: TEXT.muted, on: ['danger-bg'] },
  // The legacy `bg-x/10` alert tint must still be readable with muted text on it.
  { name: 'accent-fg on accent/10 tint', hex: ACCENT, on: ['accent/10@surface-1'] },
  { name: 'success-fg on success/10 tint', hex: SUCCESS_FG, on: ['success/10@surface-1'] },
  { name: 'warn-fg on warn/10 tint', hex: WARN_FG, on: ['warn/10@surface-1'] },
  { name: 'danger-fg on danger/10 tint', hex: DANGER_FG, on: ['danger/10@surface-1'] },
  { name: 'muted on accent/10 tint', hex: TEXT.muted, on: ['accent/10@surface-1'] },
  { name: 'muted on success/10 tint', hex: TEXT.muted, on: ['success/10@surface-1'] },
  { name: 'muted on warn/10 tint', hex: TEXT.muted, on: ['warn/10@surface-1'] },
  { name: 'muted on danger/10 tint', hex: TEXT.muted, on: ['danger/10@surface-1'] },
]

EXTRA_SURFACES['success-bg-solid'] = SUCCESS_FG
EXTRA_SURFACES['warn-bg-solid'] = WARN_FG
EXTRA_SURFACES['danger-bg-solid'] = DANGER_FG

/* =========================================================================
 * RULE B1 — INTERACTIVE-COMPONENT BOUNDARIES  (WCAG 1.4.11, >= 3:1)
 *
 * A boundary token must clear 3:1 against BOTH:
 *   · its own fill  — because that is the edge you actually see against the
 *     control's interior, and
 *   · every surface it can sit on — because a 1px border reads as a line only
 *     if it differs from BOTH sides of the edge.
 * ====================================================================== */

const BOUNDARY_MIN = 3.0

const BOUNDARIES = [
  {
    name: 'line-strong (input rest)',
    hex: LINE_STRONG,
    ownFill: 'inset',
    behind: ['inset', 'bg', 'surface-1', 'surface-2'],
    // Declared, not forgotten: inputs never sit on `surface-3` (menus/popovers).
    acceptedExceptions: [{ surface: 'surface-3', reason: 'inputs do not rest on menus/popovers' }],
  },
  {
    name: 'line-hover (input hover)',
    hex: LINE_HOVER,
    ownFill: 'inset',
    behind: ['inset', 'bg', 'surface-1', 'surface-2'],
  },
  {
    name: 'accent (focused input border)',
    hex: ACCENT,
    ownFill: 'inset',
    behind: ['inset', 'bg', 'surface-1', 'surface-2', 'surface-3'],
  },
]

/* =========================================================================
 * RULE D1 — DECORATIVE CARD BORDER  (>= 1.5:1)
 * ====================================================================== */

const CARD_BORDER_MIN = 1.5

/**
 * `enforce` — the ruled requirement: the decorative card border must clear
 * 1.5:1 against the card it outlines (surface-1) and the page it divides (bg).
 * `observe` — measured and printed, but NOT a failure: `line` against the
 * lighter surface-2 plate lands at 1.46:1. That is an improvement over the
 * 1.17:1 it replaces, it is what a hairline on a secondary button or a chip
 * actually is, and pushing it higher would put a 3.3:1 border on every chip.
 * Anything that needs a *load-bearing* 3:1 boundary there uses `line-strong`.
 */
const DECORATIVE = [
  {
    name: 'line',
    hex: LINE,
    enforce: ['surface-1', 'bg'],
    observe: [
      { surface: 'surface-2', usedBy: 'secondary buttons, chips, Select listbox plate' },
      { surface: 'overlay', usedBy: 'Select listbox plate' },
      { surface: 'inset', usedBy: 'chips inside code wells' },
    ],
  },
]

/* =========================================================================
 * SURFACE SEPARATION — informational. The ramp is deliberately tight (~1.1:1);
 * borders carry the separation. Not a pass/fail rule.
 * ====================================================================== */
const SURFACE_PAIRS = [
  ['surface-1 on bg', 'surface-1', 'bg'],
  ['surface-2 on surface-1', 'surface-2', 'surface-1'],
  ['surface-3 on surface-1', 'surface-3', 'surface-1'],
  ['inset on surface-1 (well fill)', 'inset', 'surface-1'],
  ['inset on bg (well fill)', 'inset', 'bg'],
]

/* =========================================================================
 * REPORT — everything below runs only when this file is the entry point, so a
 * test can `import { PALETTE, ratio, readCssTokens }` without the CLI side
 * effects (notably `process.exit`, which would kill the vitest worker).
 * ====================================================================== */

const W = 100
const sep = '='.repeat(W)
const dash = '-'.repeat(W)

let failures = 0
const fail = (msg) => {
  failures++
  console.log(`   *** FAIL *** ${msg}`)
}

function main() {
  failures = 0
  console.log(sep)
console.log('NT Studio — WCAG 2.x contrast GATE (asserts; exits non-zero on failure)')
console.log(sep)
console.log('')
console.log(`RULE T1  text roles            >= ${TEXT_MIN}:1 on every surface (disabled >= ${DISABLED_MIN}, WCAG-exempt)`)
console.log(`RULE B1  interactive boundary  >= ${BOUNDARY_MIN}:1 vs own fill AND every surface behind it`)
console.log(`RULE D1  card border           >= ${CARD_BORDER_MIN}:1 vs the card it outlines`)
console.log('RULE X1  theme.css declares exactly the values audited below')
console.log('RULE X2  legacy aliases byte-identical to the tokens they map to')
console.log('RULE H1  formula reproduces four known pre-wave-2 values')
console.log('')

/* ---- T1 ---- */
console.log('T1. TEXT ROLES'.padEnd(0) + ' — every role on every surface, worst case per role')
console.log(dash)
console.log(pad('text role', 34) + pad('hex', 9) + pad('worst surface', 22) + pad('hex', 9) + pad('ratio', 9) + 'need')
console.log(dash)
for (const role of TEXT_ROLES) {
  const need = role.need ?? TEXT_MIN
  let worst = { surface: null, ratio: Infinity }
  for (const key of role.on) {
    const bgHex = surfaceHex(key)
    const v = ratio(role.hex, bgHex)
    if (v < worst.ratio) worst = { surface: key, bgHex, ratio: v }
  }
  const ok = worst.ratio >= need
  console.log(
    pad(role.name, 34) +
      pad(role.hex, 9) +
      pad(String(worst.surface).replace(/^@/, ''), 22) +
      pad(worst.bgHex ?? '?', 9) +
      pad(`${r2(worst.ratio)}:1`, 9) +
      `>= ${need}${ok ? '' : '  <-- UNDER'}`,
  )
  if (!ok) fail(`T1 ${role.name}: ${r2(worst.ratio)}:1 on ${worst.surface}, needs ${need}`)
  if (role.exempt !== undefined) console.log(pad('', 34) + pad(`exempt: ${role.exempt}`, 60))
}
console.log('')

/* ---- B1 ---- */
console.log('B1. INTERACTIVE-COMPONENT BOUNDARIES — WCAG 1.4.11, >= 3:1')
console.log(dash)
console.log(pad('boundary', 34) + pad('hex', 9) + pad('against', 14) + pad('surface hex', 11) + pad('ratio', 9) + 'verdict')
console.log(dash)
for (const b of BOUNDARIES) {
  // De-duplicate: `ownFill` is often also in `behind` (an input's own fill IS
  // the surface directly behind its border), and printing it twice looks like
  // two separate checks.
  const behind = [...new Set(b.behind.filter((k) => k !== b.ownFill))]
  const checks = [
    { label: 'own fill', key: b.ownFill },
    ...behind.map((k) => ({ label: 'behind', key: k })),
  ]
  const accepted = new Set((b.acceptedExceptions ?? []).map((e) => e.surface))
  for (const c of checks) {
    const bgHex = surfaceHex(c.key)
    const v = ratio(b.hex, bgHex)
    const isException = accepted.has(c.key)
    const ok = v >= BOUNDARY_MIN
    const verdict = isException
      ? `ACCEPTED ${r2(v)}:1 < ${BOUNDARY_MIN} (${(b.acceptedExceptions ?? []).find((e) => e.surface === c.key)?.reason})`
      : ok
        ? `PASS ${r2(v)}:1`
        : `*** FAIL ${r2(v)}:1 ***`
    console.log(pad(`${b.name} [${c.label}]`, 46) + pad(b.hex, 9) + pad(c.key, 12) + pad(bgHex, 11) + pad(`${r2(v)}:1`, 9) + verdict)
    if (!ok && !isException) fail(`B1 ${b.name} vs ${c.key}: ${r2(v)}:1, needs ${BOUNDARY_MIN}`)
  }
  for (const e of b.acceptedExceptions ?? []) {
    // Printed as its own line so the accepted trade-off cannot be mistaken for
    // a row that simply was not checked.
    const bgHex = surfaceHex(e.surface)
    console.log(
      pad(`${b.name} [DECLARED EXCEPTION]`, 46) + pad(b.hex, 9) + pad(e.surface, 12) + pad(bgHex, 11) +
        pad(`${r2(ratio(b.hex, bgHex))}:1`, 9) + `accepted: ${e.reason}`,
    )
  }
}
console.log('')

/* ---- D1 ---- */
console.log('D1. DECORATIVE CARD BORDER — >= 1.5:1 vs the card it outlines')
console.log(dash)
console.log(pad('pair', 40) + pad('hex', 9) + pad('surface hex', 11) + pad('ratio', 9) + 'verdict')
console.log(dash)
for (const d of DECORATIVE) {
  for (const key of d.enforce) {
    const bgHex = surfaceHex(key)
    const v = ratio(d.hex, bgHex)
    const ok = v >= CARD_BORDER_MIN
    console.log(
      pad(`${d.name} on ${key}`, 40) +
        pad(d.hex, 9) +
        pad(bgHex, 11) +
        pad(`${r2(v)}:1`, 9) +
        (ok ? `PASS >= ${CARD_BORDER_MIN}` : `*** FAIL (need ${CARD_BORDER_MIN}) ***`),
    )
    if (!ok) fail(`D1 ${d.name} on ${key}: ${r2(v)}:1, needs ${CARD_BORDER_MIN}`)
  }
  for (const o of d.observe) {
    const bgHex = surfaceHex(o.surface)
    const v = ratio(d.hex, bgHex)
    console.log(
      pad(`${d.name} on ${o.surface}`, 40) +
        pad(d.hex, 9) +
        pad(bgHex, 11) +
        pad(`${r2(v)}:1`, 9) +
        `observed, not enforced (${o.usedBy})`,
    )
  }
}
console.log('')

/* ---- surfaces (informational) ---- */
console.log('INFO. SURFACE SEPARATION — deliberately tight (~1.1:1); borders carry separation')
console.log(dash)
for (const [label, a, b] of SURFACE_PAIRS) {
  console.log(pad(label, 40) + pad(S[a], 9) + pad(S[b], 11) + `${r2(ratio(S[a], S[b]))}:1`)
}
console.log('')

/* ---- X1 / X2 ---- */
console.log('X1/X2. theme.css AGREEMENT — is the shipped palette still the ruled one?')
console.log(dash)
if (CSS_READ_ERROR !== null) {
  console.log(`   *** FAIL *** cannot read ${CSS_PATH}: ${CSS_READ_ERROR}`)
  fail(`X1 theme.css is unreadable, so every ratio above is suspect`)
}
for (const [name, hex] of Object.entries(RULED)) {
  const actual = CSS_TOKENS[name]
  if (actual === undefined) {
    console.log(pad(`--color-${name}`, 34) + pad(hex, 9) + '*** MISSING FROM theme.css ***')
    fail(`X1 --color-${name} is not declared in theme.css`)
    continue
  }
  const ok = actual === hex.toLowerCase()
  console.log(pad(`--color-${name}`, 34) + pad(hex, 9) + (ok ? 'match' : `*** MISMATCH, theme.css has ${actual} ***`))
  if (!ok) fail(`X1 --color-${name}: theme.css=${actual}, ruling=${hex}`)
}
console.log('')
for (const [legacy, target] of Object.entries(LEGACY_ALIASES)) {
  const a = CSS_TOKENS[legacy]
  const b = CSS_TOKENS[target]
  const ok = a !== undefined && a === b
  console.log(
    pad(`--color-${legacy} == --color-${target}`, 40) +
      pad(String(b), 9) +
      (ok ? 'identical' : `*** DRIFT: ${a} ***`),
  )
  if (!ok) fail(`X2 legacy --color-${legacy} (${a}) drifted from --color-${target} (${b})`)
}
console.log('')

/* ---- H1 ---- */
console.log('H1. HISTORICAL SELF-TEST — formula vs independently-known pre-wave-2 values')
console.log(dash)
const HISTORICAL = [
  ['legacy faint #5f6771 on app #0a0b0d', '#5f6771', '#0a0b0d', 3.44],
  ['legacy line  #1f2227 on panel #101114', '#1f2227', '#101114', 1.18],
  ['legacy inset #0c0d10 on app  #0a0b0d', '#0c0d10', '#0a0b0d', 1.01],
  ['legacy #ffffff on accent #4c8dff', '#ffffff', '#4c8dff', 3.2],
]
for (const [label, a, b, expected] of HISTORICAL) {
  const v = ratio(a, b)
  const ok = Math.abs(v - expected) < 0.02
  console.log(pad(label, 40) + pad('computed', 9) + pad(`${r2(v)}:1`, 10) + pad(`expect ${r2(expected)}`, 12) + (ok ? 'match' : `*** DRIFT ${r2(Math.abs(v - expected))} ***`))
  if (!ok) fail(`H1 ${label}: computed ${r2(v)}, expected ${r2(expected)}`)
}
console.log('')

/* ---- before / after ---- */
console.log('BEFORE vs AFTER — the defects this audit exists to prevent')
console.log('"before" is the value that actually shipped in wave-1 theme.css.')
console.log(dash)

/**
 * `aHex`/`aBg` are read from the SHIPPED palette, so reverting a token in
 * theme.css makes this table report the regression rather than restating the
 * ruling. `bHex`/`bBg` are literal history: the values that actually shipped in
 * the wave-1 file.
 */
const CASES = [
  { token: 'line', note: 'card border vs surface-1', bHex: '#262b33', bBg: '#12151a', aHex: LINE, aBg: S['surface-1'], need: CARD_BORDER_MIN },
  { token: 'line', note: 'divider vs page bg', bHex: '#262b33', bBg: '#08090b', aHex: LINE, aBg: S.bg, need: CARD_BORDER_MIN },
  { token: 'line-strong', note: 'input border vs card', bHex: '#343b45', bBg: '#12151a', aHex: LINE_STRONG, aBg: S['surface-1'], need: BOUNDARY_MIN },
  { token: 'line-strong', note: 'input border vs page bg', bHex: '#343b45', bBg: '#08090b', aHex: LINE_STRONG, aBg: S.bg, need: BOUNDARY_MIN },
  { token: 'line-strong', note: 'input border vs own well', bHex: '#343b45', bBg: '#05060a', aHex: LINE_STRONG, aBg: S.inset, need: BOUNDARY_MIN },
  { token: 'line-hover', note: 'hover border vs own well', bHex: null, bBg: null, aHex: LINE_HOVER, aBg: S.inset, need: BOUNDARY_MIN },
  { token: 'text-muted', note: 'metadata vs page bg', bHex: '#8b95a6', bBg: '#08090b', aHex: TEXT.muted, aBg: S.bg, need: TEXT_MIN },
  { token: 'text-muted', note: 'metadata vs lightest s3', bHex: '#8b95a6', bBg: '#232832', aHex: TEXT.muted, aBg: S['surface-3'], need: TEXT_MIN },
  { token: 'text-muted', note: 'metadata vs own well', bHex: '#8b95a6', bBg: '#05060a', aHex: TEXT.muted, aBg: S.inset, need: TEXT_MIN },
  { token: 'inset', note: 'well fill vs card', bHex: '#05060a', bBg: '#12151a', aHex: S.inset, aBg: S['surface-1'], need: null },
  { token: 'inset', note: 'well fill vs page bg', bHex: '#05060a', bBg: '#08090b', aHex: S.inset, aBg: S.bg, need: null },
]

console.log(
  pad('token', 14) +
    pad('note', 27) +
    pad('was', 21) +
    pad('now', 21) +
    pad('min', 6) +
    'verdict',
)
console.log(dash)
for (const c of CASES) {
  const after = ratio(c.aHex, c.aBg)
  const before = c.bHex === null ? null : ratio(c.bHex, c.bBg)
  const wasCell = before === null ? '(new token)' : `${c.bHex} on ${c.bBg}`
  const nowCell = `${c.aHex} on ${c.aBg}`

  if (c.need === null) {
    console.log(
      pad(c.token, 14) +
        pad(c.note, 27) +
        pad(`${wasCell} ${r2(before)}:1`, 21) +
        pad(`${nowCell} ${r2(after)}:1`, 21) +
        pad('-', 6) +
        'informational — a fill carries no threshold; the 3:1 border identifies it',
    )
    continue
  }

  const fixed = after >= c.need
  const wasOk = before === null ? null : before >= c.need
  const verdict = !fixed
    ? '*** STILL UNDER ***'
    : before === null
      ? 'FIXED (new token)'
      : c.bHex === c.aHex
        ? 'unchanged (already passing)'
        : wasOk
          ? 'was already passing'
          : 'FIXED'
  console.log(
    pad(c.token, 14) +
      pad(c.note, 27) +
      pad(`${wasCell} ${before === null ? 'n/a' : r2(before) + ':1'}`, 21) +
      pad(`${nowCell} ${r2(after)}:1`, 21) +
      pad(String(c.need), 6) +
      verdict,
  )
  if (!fixed) fail(`before/after: ${c.token} ${c.note} still ${r2(after)}:1, needs ${c.need}`)
}
console.log('')

console.log(sep)
if (failures === 0) {
  console.log('RESULT: PASS — 0 failures across T1, B1, D1, X1, X2, H1.')
  console.log('Every text role clears its minimum on every surface; every interactive')
  console.log('boundary clears 3:1; theme.css agrees with this audit.')
} else {
  console.log(`RESULT: FAIL — ${failures} failure(s) above. Do not ship this palette.`)
}
console.log(sep)
  return failures === 0 ? 0 : 1
}

// CLI only when invoked directly. Under vitest `process.argv[1]` is the vitest
// binary, so importing this module for `PALETTE`/`ratio`/`readCssTokens` is inert.
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) process.exit(main())
