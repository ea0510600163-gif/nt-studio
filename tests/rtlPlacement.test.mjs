import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * حاجز انحدار لعيب «المعاينة تفتح في الجهة المقابلة».
 *
 * على ويندوز في لغة RTL يمنح كروميوم النافذة نمط WS_EX_LAYOUTRTL، وويندوز بعدها
 * يعكس إحداثيات كل نافذة ابنة. والمعاينة طبقة WebContentsView — نافذة ابنة — فتُرسم
 * عند (عرض المحتوى − x − العرض) دائماً ومن أول فتح. لا يُصلح ذلك بأي ضبط للحدود في
 * العملية الرئيسية؛ العلاج الوحيد هو منع كروميوم من فرض الاتجاه RTL على النافذة.
 *
 * القياس البصري الكامل (يحتاج Electron وشاشة، خارج مجموعة الاختبارات):
 *   node_modules/electron/dist/electron.exe outputs/rtl-placement-probe.cjs
 * يقيس موضع طبقة عند x=900 في نافذة عرضها 1366: صحيح = 900..1199، معكوس = 166..466.
 */
const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'index.ts')

test('اتجاه واجهة كروميوم مفروض LTR قبل الجهوزية — وإلا عادت المعاينة معكوسة', () => {
  const src = readFileSync(MAIN, 'utf8')
  const call = src.indexOf("appendSwitch('force-ui-direction', 'ltr')")
  assert.notEqual(call, -1, 'force-ui-direction=ltr مفقود من src/main/index.ts: ستعود المعاينة معكوسة على ويندوز بلغة عربية')
  const ready = src.indexOf('app.whenReady(')
  assert.notEqual(ready, -1, 'لم يُعثر على app.whenReady في نقطة الدخول')
  assert.ok(call < ready, 'يجب تسجيل المفتاح قبل app.whenReady وإلا تجاهله كروميوم')
})
