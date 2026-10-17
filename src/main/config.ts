import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Settings } from '@shared/types'

/**
 * T5 (P0-1): حقول ميزانية التشغيل الإجمالية على Settings.
 * shared/types.ts خارج نطاق هذه المهمة (قراءة فقط)، فيُعلَن الامتداد هنا عبر
 * دمج الإعلانات (module augmentation) — فيرى كل مستهلك لـ Settings
 * (getSettings/setSettings/الحلقة) الشكل نفسه بلا لمس الملف الأصلي.
 */
declare module '@shared/types' {
  interface Settings {
    /** ميزانية الوقت الإجمالية لمهمة واحدة عبر تشغيلها واستئنافاتها (ms) */
    maxRunMs: number
    /** الخطوات التراكمية المنفَّذة عبر استئنافات المهمة الواحدة */
    maxTotalStepsAcrossResumes: number
  }
}

/** الافتراضيات السخية القابلة للضبط من الإعدادات — ساعتان / 1200 خطوة */
export const DEFAULT_MAX_RUN_MS = 7_200_000
export const DEFAULT_MAX_TOTAL_STEPS = 1200

/** القيم الافتراضية القابلة للضبط (تُعدَّل أيضاً من شاشة الإعدادات) */
export function defaultWorkspaceRoot(): string {
  if (process.platform === 'win32' && existsSync('D:\\')) return 'D:\\nt'
  return join(homedir(), 'nt')
}

export const DEFAULT_SETTINGS = (): Settings => ({
  workspaceRoot: defaultWorkspaceRoot(),
  maxSteps: 800, // رفع السقف: النماذج الحديثة (~890k متوسط السياق) تحتاج مساحة لتخطيط→كود→فحص بدون توقف مبكر
  commandTimeoutSec: 600, // كان 180ث — غير كافٍ لـ install/build طويل؛ 600ث يواكب قدرات النماذج الثقيلة
  maxOutputTokens: 64000, // كان 32000 (والواجهة كانت تعرض 16000) — الآن 64k افتراضياً لكتابة ~2000 سطر دفعة واحدة
  compactAtPercent: 85, // كان 70% — مع نوافذ ~1M نؤخر التلخيص إلى 85% للحفاظ على السياق أطول
  approvalMode: false, // مطفأ افتراضياً: وضع الاستقلال الكامل
  defaultModel: null,
  fallbackModel: null,
  persona: '', // توجيه حر يُلحق بذيل النظام — فارغ = السلوك القديم تماماً
  maxRunMs: DEFAULT_MAX_RUN_MS, // T5 (P0-1): ميزانية الوقت الإجمالية — سخية وقابلة للضبط
  maxTotalStepsAcrossResumes: DEFAULT_MAX_TOTAL_STEPS // T5 (P0-1): سقف الخطوات التراكمي عبر الاستئنافات
})

/**
 * أكبر نص يمرّ في استدعاء أداة واحدة.
 * النموذج يُخرج نحو 3.2 حرفاً لكل token، وتهرريب JSON (علامات اقتباس وأسطر)
 * يضخّم الحجم x2.5 تقريباً، فنترك هامشاً للأمان.
 */
export function writeCallBudget(maxOutputTokens: number): number {
  // كان: max*3.2/2.5*0.8 ≈ max*1.02 — مقيد جداً، يمنع كتابة ~2000 سطر دفعة واحدة رغم أن النموذج قادر
  // الجديد: max*2.2 ≈ 140k حرف عند 64k توكن (~3500 سطر)، ضمن قدرة الإخراج الفعلية (~204k حرف) مع هامش JSON
  return Math.max(8000, Math.floor(maxOutputTokens * 2.2))
}

export const LIMITS = {
  toolOutputChars: 80000, // كان 24k — النماذج الحديثة تُخرج ملفات ضخمة؛ 80k يحفظ قراءة/كتابة كاملة بلا تقطيع
  uiOutputChars: 12000, // كان 6k — ضعف العرض في الواجهة للاستفادة من الردود الطويلة
  /** مهلة الاتصال (ترويسات أول استجابة) — منفصلة عن مهلة الخمول أثناء البث */
  llmConnectMs: 30_000,
  /** مهلة صمت أثناء البث؛ كانت تُسلَّح قبل إرسال الطلب فتبتلع 90 ثانية لكل محاولة */
  llmIdleMs: 180_000, // كان 90ث — النماذج الكبيرة (1M سياق) تفكر أطول قبل أول بايت (يُبقى صبوراً؛ التقصير للمحاولتين الأوليين يتم لكل محاولة عبر idleMsForAttempt)
  /** سقف نص التفكير: رُفع إلى 80k لأن النماذج الحديثة تُخرج سلاسل استدلال طويلة
   * وقطعها يفقدها سياق التفكير — 24k كان يبتلع جزءاً كبيراً من سلاسل CoT الطويلة */
  thinkingChars: 80_000,
  retryAttempts: 10 // 10 محاولات: صبور على الحدود العابرة (429/503) مع تراجع متدرج
}

/* ───────────── سياسة المحاولات + الخمول المتدرج ───────────── */

/** عدد محاولات المسار الأساسي (10 — صبر على التقنين العابر بدل الفشل المبكر) */
export const PRIMARY_ATTEMPTS = 10
/** عدد محاولات النموذج الاحتياطي */
export const FALLBACK_ATTEMPTS = 2
/** عدد محاولات الملخّص (كان 4) */
export const SUMMARIZER_ATTEMPTS = 2

/** خمول قصير للمحاولتين الأوليين: فشل سريع على النهايات الميتة */
export const IDLE_MS_FIRST_ATTEMPTS = 90_000
/** خمول صبور بعد ذلك: النماذج البطيئة العاملة تُمهَل */
export const IDLE_MS_PATIENT = 180_000

/**
 * مهلة الخمول حسب رقم المحاولة (1-based): قصيرة (90ث) للأوليين، صبورة (180ث) بعدها.
 * تُطبَّق في loop.ts قبل كل callLlm (فـ transport.ts يقرأ LIMITS.llmIdleMs حيّاً
 * عند كل تسليح — وهو خارج نطاق هذه المهمة فلا يُلمَس).
 */
export function idleMsForAttempt(attempt: number): number {
  return attempt <= 2 ? IDLE_MS_FIRST_ATTEMPTS : IDLE_MS_PATIENT
}

/* ───────────── T5 (P0-1): فحص ميزانية التشغيل الإجمالية (منطق نقي) ───────────── */

export type RunBudgetBreach = 'time' | 'steps'

/**
 * هل استُنفدت ميزانية التشغيل؟ يُفحَص أعلى حلقة runAgent كل خطوة.
 * الحدود تُمرَّر صراحةً (من settings) حتى تبقى الدالة نقية قابلة للاختبار بلا Electron.
 */
export function runBudgetBreach(
  state: { runStartedAt: number | null; cumulativeSteps: number },
  limits: { maxRunMs: number; maxTotalStepsAcrossResumes: number },
  now = Date.now()
): RunBudgetBreach | null {
  if (state.runStartedAt != null && now - state.runStartedAt > limits.maxRunMs) return 'time'
  if (state.cumulativeSteps >= limits.maxTotalStepsAcrossResumes) return 'steps'
  return null
}

/** وسم مميز ثابت في سجل التوقف حتى يبقى قابلاً للبحث (grep) — يُكتب في السجل لا في واجهة المستخدم */
export const RUN_BUDGET_TAG = 'total budget exhausted'

/** سطر واحد قصير: سبب الميزانية + زر الاستئناف. بلا أسطر إضافية ولا وسم إنجليزي في الواجهة. */
export function runBudgetNoticeText(
  breach: RunBudgetBreach,
  limits: { maxRunMs: number; maxTotalStepsAcrossResumes: number },
  state: { cumulativeSteps: number }
): string {
  if (breach === 'steps')
    return `انتهت ميزانية الخطوات (${state.cumulativeSteps}/${limits.maxTotalStepsAcrossResumes}) — اضغط «استئناف» لنافذة جديدة.`
  const mins = Math.round(limits.maxRunMs / 60000)
  const timeLabel = mins % 60 === 0 ? (mins / 60 === 1 ? 'ساعة' : mins / 60 === 2 ? 'ساعتين' : `${mins / 60} ساعات`) : `${mins} دقيقة`
  return `انتهت ميزانية الوقت (${timeLabel}) — اضغط «استئناف» لنافذة جديدة.`
}

/* ───────────── نص إعادة المحاولة — محفوظ للتوافق (العرض الحالي سطر حالة واحد) ───────────── */

/**
 * T3.3 — نسبة التلخيص الديناميكية حسب حجم النافذة.
 * النوافذ الكبيرة (~1M) تتحمل 85%، الصغيرة (<64k) يجب أن تلخص عند 75% لتترك هامش أمان.
 */
export function compactAtThreshold(contextWindow: number, basePercent: number): number {
  if (contextWindow < 64_000) return Math.min(basePercent, 75)
  if (contextWindow < 128_000) return Math.min(basePercent, 80)
  return basePercent
}

/** يُبقي التوقيع نفسه للاختبارات؛ العرض الحيّ يستخدم سطر الحالة القصير فقط */
export function formatRetryNotice(attempt: number, elapsedMs: number, delayMs: number, message: string): string {
  return `تعذّر الاتصال بالنموذج (${message.slice(0, 140)}). المحاولة ${attempt} استغرقت ${Math.round(elapsedMs / 1000)} ثوانٍ، إعادة المحاولة خلال ${Math.round(delayMs / 1000)} ثوانٍ…`
}