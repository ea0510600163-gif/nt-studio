/**
 * أدوات وضع الـ Agent («مشغّل المتصفح») — تركيز كامل على التحكم بالويب.
 *
 * الفلسفة: أدوات أقل = اختيار أدق + موجّه أقصر + كاش أثبت، وأمان تلقائي
 * (لا run_command ولا ملفات أصلاً — فلا يمكن أن يمس الجهاز حتى لو أخطأ الفهم).
 * جلسات studio ترى ALL_TOOLS كما اليوم حرفياً (لا تغيير عليها).
 *
 * هذه الوحدة بلا أي استيراد وقت التشغيل — تُختبر مباشرة بلا تنحيات.
 */
export const AGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  // فتح وبحث وتنقل
  'web_open',
  'browser_nav',
  'web_search',
  'web_fetch',
  // قراءة وفحص الصفحة
  'browser_snapshot',
  'browser_screenshot',
  'visual_check',
  'browser_audit',
  'browser_console',
  // تفاعل
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_wait',
  'browser_eval',
  'browser_resize',
  // رفع صور المنشورات
  'browser_upload',
  // تسليم الكابتشا/التحقق للمستخدم + خطة نشر متعددة المنصات
  'ask_user',
  'todo_write'
])

/**
 * تصفية الأدوات حسب الوضع — نقية وقابلة للاختبار بلا Electron.
 * studio تُرجع القائمة كما هي (مرجعٌ مماثل)، وagent تُرجع المصفاة فقط.
 * اسمٌ في القائمة بلا أداة مسجلة يُتجاهل بصمت (إضافة لاحقة لا تكسر).
 */
export function selectModeTools<T extends { name: string }>(mode: 'studio' | 'agent', all: T[]): T[] {
  if (mode !== 'agent') return all
  return all.filter((t) => AGENT_TOOL_NAMES.has(t.name))
}
