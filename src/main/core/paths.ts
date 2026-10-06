import path from 'node:path'

/**
 * حارس المسارات.
 *
 * سياسة المشروع: الوكيل يملك الجهاز بالكامل بلا قيود (كما طلب المستخدم)،
 * لكن هناك خطّ أحمر واحد غير قابل للتفاوض — لا كتابة ولا حذف داخل مجلدات
 * النظام. السبب: خطأ واحد من النموذج على مسار `C:\Windows\System32` يوقف
 * جهازك فعليًا، وهذا يفقدك المشروع كله. القراءة تبقى مفتوحة في كل مكان.
 */

export type FsOp = 'read' | 'write' | 'delete'

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathGuardError'
  }
}

/** المحارف الممنوعة في أسماء ملفات ويندوز. */
const WINDOWS_FORBIDDEN = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

function isControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return code < 32 || code === 127
}

/** المسارات التي يُمنع الكتابة أو الحذف فيها. */
export function protectedRoots(): string[] {
  const candidates = [
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
    path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Sysnative'),
    'C:\\$Recycle.Bin',
    'C:\\System Volume Information',
    path.join('C:\\', 'boot'),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of candidates) {
    if (!c) continue
    const n = normalize(c).toLowerCase()
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** مسار مطلق ومطبّع، بلا شرط متبقٍ في النهاية (ما عدا جذر القرص). */
export function normalize(target: string): string {
  const resolved = path.resolve(target)
  const root = path.parse(resolved).root
  if (resolved === root) return root
  return resolved.replace(/[\\/]+$/, '')
}

/** المسار بصيغة POSIX (مطلوب لعناوين file:// ومسارات أدوات الوكيل). */
export function toPosix(target: string): string {
  return normalize(target).replace(/\\/g, '/')
}

/** هل `child` داخل `parent` (أو يساويه)؟ المقارنة غير حساسة لحالة الأحرف. */
export function isSubPathOf(child: string, parent: string): boolean {
  const c = normalize(child).toLowerCase()
  const p = normalize(parent).toLowerCase()
  if (c === p) return true
  const sep = p.endsWith(path.sep) ? p : p + path.sep
  return c.startsWith(sep)
}

/** إن كان المسار محميًا: يعيد المسار المحمي المطابق، وإلا `null`. */
export function protectedMatch(target: string): string | null {
  const t = normalize(target).toLowerCase()
  return protectedRoots().find((r) => t === r || isSubPathOf(t, r)) ?? null
}

/**
 * يطبّق السياسة على عملية ملفات.
 * `read` → مسموح في كل مكان. `write`/`delete` → مرفوض داخل جذور النظام.
 */
export function assertAllowed(target: string, op: FsOp): string {
  const p = normalize(target)
  if (op === 'read') return p
  const hit = protectedMatch(p)
  if (hit) {
    throw new PathGuardError(
      `العملية "${op}" مرفوضة على مسار محمي: ${hit} — الكتابة مسموحة خارج مجلدات النظام فقط`,
    )
  }
  return p
}

/**
 * يربط مسارًا نسبيًا بجذر ويمنع الخروج من الجذر.
 * يغلق ثغرة `..` ويحمي من Measurement عبر Junction/Symlink على مستوى المسار.
 */
export function safeJoin(root: string, relative: string): string {
  const r = normalize(root)
  const joined = normalize(path.isAbsolute(relative) ? relative : path.join(r, relative))
  if (!isSubPathOf(joined, r)) {
    throw new PathGuardError(`المسار يخرج من المجلد المسموح: ${relative}`)
  }
  return joined
}

/** اسم ملف/مجلد آمن للاستخدام في أوامر الطرفية (يمنع الحقن والتخريب). */
export function assertSafeName(name: string): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) throw new PathGuardError('اسم فارغ')
  if (trimmed.length > 128) throw new PathGuardError('الاسم طويل جدًا (الحد 128 حرفًا)')
  for (const ch of trimmed) {
    if (WINDOWS_FORBIDDEN.has(ch)) {
      throw new PathGuardError(`اسم غير صالح: ${trimmed} — محرف ممنوع في أسماء ملفات ويندوز`)
    }
    if (isControlChar(ch)) {
      throw new PathGuardError('اسم غير صالح: يحتوي محرف تحكم غير مرئي')
    }
  }
  if (trimmed === '.' || trimmed === '..') throw new PathGuardError('اسم غير صالح')
  if (/^\s|\s$|^\.|\.$/.test(trimmed)) {
    throw new PathGuardError(`اسم غير صالح: ${trimmed} — لا يبدأ أو ينتهي بمسافة أو نقطة`)
  }
  return trimmed
}