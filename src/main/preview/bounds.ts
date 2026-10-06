/**
 * هندسة المعاينة — منطق نقيّ بلا أي اعتماد على Electron.
 *
 * لماذا ملف منفصل؟ لأن الـ WebContentsView عملية عرض ترسمها النواة **فوق** واجهة
 * React كاملة: لا يستطيع React أن يرسم فوقها ولا أن يتسلّم نقراتها. فإذا أخطأت
 * الإحداثيات ولو بخطأ واحد، يغطي الـ view شريط الأدوات ومربع الكتابة ويبتلع كل
 * نقرة — وهذا بالضبط ما كان يظهر: الواجهة مغطاة بمستطيل غريب.
 *
 * لذلك كل سؤال «أين يُوضع الـ view؟ وهل يُعرض أصلًا؟» يُحسم هنا في دوال نقيّة قابلة
 * للاختبار، ويتركّب عليها الـ controller حالةً فقط.
 */

/** مستطيل إحداثيات بوحدات DIP — وهي نفسها وحدات CSS px داخل Electron. */
export interface PreviewRect {
  x: number
  y: number
  width: number
  height: number
}

/** محاكاة جهاز: مقاس إطار عرض ثابت يُحشر داخل الحاوية. */
export interface PreviewSize {
  width: number
  height: number
}

/**
 * حمولة حدود من الواجهة. `seq` اختياري عمدًا: الواجهة ترسل الشكل القديم
 * `{x,y,width,height}` وهو مقبول تمامًا، والتسلسل يهمّ فقط عند توفّره.
 */
export interface PreviewBoundsInput extends PreviewRect {
  seq?: number
}

/**
 * أصغر مقاس نعتبره قابلًا للعرض. أصغر من ذلك تكون الحاوية مطويّة أو مخفية
 * (تبويب مغلق، لوحة منهارة) فنُخفي الـ view بدل رسم مربّع شبح فوق الواجهة.
 */
export const MIN_VISIBLE_EDGE = 10

/** حدّ سجلّ الكونسول في الذاكرة — سخي، مع الاحتفاظ بالأحدث. */
export const MAX_LOG_ENTRIES = 1000

/** أقصى عدد مشاكل (تحذير/خطأ/فواصل) نعيدها للواجهة والوكيل. */
export const MAX_CONSOLE_ISSUES = 200

/** نتيجة الحساب: أين يُوضع الـ view، وهل يُعرض أصلًا. */
export type BoundsResolution =
  | { visible: false; reason: 'no-container' | 'degenerate' }
  | { visible: true; rect: PreviewRect }

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** مستطيل نظيف: أرقام فقط، بلا NaN ولا ما لا نهاية. */
export function readRect(input: Partial<PreviewRect> | null | undefined): PreviewRect | null {
  if (!input) return null
  const { x, y, width, height } = input
  if (!isNum(x) || !isNum(y) || !isNum(width) || !isNum(height)) return null
  return { x, y, width, height }
}

/**
 * يقصّ المستطيل على مقاس النافذة الحقيقي.
 *
 * عند تصغير النافذة قد تبقى حدود الحاوية (آخر ما أرسلته الواجهة) خارج إطار
 * المحتوى. القصّ يمنع فيضان الـ view خارج النافذة، والنتيجة الشاذّة (عرض صفر أو
 * أقل) تُحوّلها `resolveBounds` إلى «مخفي» بدل مربّع 50×50 عالق على الشاشة.
 */
export function clampToContent(
  rect: PreviewRect | null,
  clip: PreviewSize | null | undefined,
): PreviewRect | null {
  if (!rect) return null
  if (!clip || !isNum(clip.width) || !isNum(clip.height)) return rect
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const width = Math.min(rect.width, clip.width - x)
  const height = Math.min(rect.height, clip.height - y)
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) }
}

/**
 * المصدر الوحيد للحقيقة: من هذا المستطيل وحده يُشتقّ موضع الـ view.
 *
 *  - حاوية مفقودة أو مشوهة: «مخفي» — لا تخمين.
 *  - حاوية أضيق/أقصر من `MIN_VISIBLE_EDGE`: «مخفي». لا حدّ أدنى 50×50 بعد؛
 *    الحدّ الأدنى القديم كان يرسم مربّعًا أسود فوق الواجهة بلا سبب.
 *  - بلا محاكاة: الحاوية كما هي.
 *  - مع محاكاة: نقصر الجهاز داخل الحاوية، نُزلقه للأعلى ونُوسّطه أفقيًا.
 *
 *وحدة القياس: `setBounds` تتوقّع DIP وCSS px == DIP طالما كان zoomFactor مساويًا لـ 1.
 * لم تُستدعَ `setZoomFactor` ولا مرّة في المشروع (تحقّقت بالبحث)، فلا يوجد تحجيم.
 * إن أُضيف تكبير مستقبلًا فيجب قسمة الإحداثيات على zoomFactor عند الحساب، وإلا
 * انزاح الـ view عن مكانه بصمت. اتجاه الواجهة (عربي/إنجليزي) لا دخل له هنا:
 * الإحداثيات تبقى DIP بأصل أعلى اليسار دائمًا.
 */
export function resolveBounds(
  container: PreviewRect | null,
  viewport: PreviewSize | null | undefined,
): BoundsResolution {
  const rect = readRect(container)
  if (!rect) return { visible: false, reason: 'no-container' }

  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  if (w < MIN_VISIBLE_EDGE || h < MIN_VISIBLE_EDGE) return { visible: false, reason: 'degenerate' }

  const left = Math.max(0, Math.round(rect.x))
  const top = Math.max(0, Math.round(rect.y))

  const device = viewport ? readRect({ x: 0, y: 0, width: viewport.width, height: viewport.height }) : null
  if (!device || device.width < MIN_VISIBLE_EDGE || device.height < MIN_VISIBLE_EDGE) {
    // بلا محاكاة، أو محاكاة بلا معنى: نعرض الحاوية كما أرسلتها الواجهة.
    return { visible: true, rect: { x: left, y: top, width: w, height: h } }
  }

  const vw = Math.min(Math.round(device.width), w)
  const vh = Math.min(Math.round(device.height), h)
  return {
    visible: true,
    rect: {
      x: left + Math.max(0, Math.round((w - vw) / 2)),
      y: top,
      width: vw,
      height: vh,
    },
  }
}

/** هل النتيجتان تُظهران الشيء نفسه على الشاشة؟ (لمنع setBounds بلا فائدة) */
export function sameResolution(a: BoundsResolution | null, b: BoundsResolution | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.visible !== b.visible) return false
  if (!a.visible || !b.visible) return true
  return (
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  )
}

/**
 * هل تُهمَل هذه الرسالة لأنها أقدم من آخر ما طُبِّق؟
 *
 * الواجهة ترسل `ipcRenderer.invoke` غير مُنتظَر في كل إطار، فقد تصل رسالتان
 * بترتيب معكوس. `seq` تصاعدي ينظّم الوصول: `أقدم` فقط هو المُهمَل، أما التساوي
 * فتُطبَّق (بلا أثر، فالتطبيق idempotent) حتى لا نُسقط تحديثًا لمجرد وصوله مرتين.
 * **اختياري بالكامل**: بلا تسلسل تُقبل الرسالة دائمًا (سلوك قديم سليم)، ولا
 * يُرفض شيء لمجرّد غيابه.
 */
export function shouldIgnore(
  seq: number | null | undefined,
  lastSeq: number | null | undefined,
): boolean {
  if (!isNum(seq) || !isNum(lastSeq)) return false
  return seq < lastSeq
}

/** رقم صالح كتسلسل، أو undefined. */
export function readSeq(input: unknown): number | undefined {
  return isNum(input) ? input : undefined
}

/** يحتفظ بالأحدث `limit` عنصرًا ويعيد نسخة. السجلّ لا يُمحى عند إعادة التحميل. */
export function keepNewest<T>(items: readonly T[], limit: number): T[] {
  if (limit <= 0) return []
  return items.length > limit ? items.slice(items.length - limit) : [...items]
}