import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry } from '../src/main/providers/retry.ts'
import { LlmError } from '../src/main/providers/types.ts'

/**
 * الحالة الحقيقية من سجل التشغيل: 429 من Gemini نصّه «أعد بعد 13س48د».
 * السلوك الصحيح: لا تُستهلك دقائق في محاولات عقيمة — يُبلَّغ الخطأ فوراً
 * (فتتولّاه المقايضة الاحتياطية أو رسالة المستخدم).
 */
const quota13h = () => new LlmError('HTTP 429: You exceeded your current quota', 429, true, 13 * 3600 * 1000 + 48 * 60 * 1000)

test('مهلة «أعد بعد ساعات» تُفشل فوراً بلا محاولات عقيمة', async () => {
  const ac = new AbortController()
  let attempts = 0
  const retries = []
  const call = () =>
    withRetry(async () => { attempts++; throw quota13h() }, { signal: ac.signal, onRetry: (i) => retries.push(i) }).then(() => null, (e) => e)
  let timer
  const res = await Promise.race([call(), new Promise((r) => { timer = setTimeout(() => r('__timeout__'), 2000) })])
  clearTimeout(timer)
  if (res === '__timeout__') {
    ac.abort() // أوقف السلسلة كي لا يعلّق الاختبار دقائق — السلوك المرصود (الانتظار) هو نفسه الخلل
    assert.fail('انتظر أكثر من ثانيتين: إعادة المحاولة تجري رغم أن المزوّد طلب ساعات')
  }
  assert.ok(res instanceof LlmError, 'يجب أن يرمي الخطأ الأصلي كما هو ليصل للنموذج الاحتياطي أو للمستخدم')
  assert.equal(res.status, 429)
  assert.equal(attempts, 1, 'محاولة واحدة فقط — لا سلسلة محاولات عقيمة')
  assert.equal(retries.length, 0, 'لا يُجدول أي انتظار')
})

test('مهلة قصيرة (ثوانٍ) تُحترم: تُعاد المحاولة ثم تنجح', async () => {
  let attempts = 0
  const retries = []
  const out = await withRetry(async () => {
    attempts++
    if (attempts < 2) throw new LlmError('HTTP 429: rate limited', 429, true, 1500)
    return 'ok'
  }, { signal: new AbortController().signal, onRetry: (i) => retries.push(i) })
  assert.equal(out, 'ok')
  assert.equal(attempts, 2)
  assert.equal(retries.length, 1)
  assert.ok(retries[0].delayMs >= 1500, 'الانتظار يحترم retry-after قصيراً')
})

test('خطأ عابر بلا retry-after يُعاد بتراجع أُسّي', async () => {
  let attempts = 0
  const out = await withRetry(async () => {
    attempts++
    if (attempts < 3) throw new LlmError('HTTP 503: overloaded', 503, true)
    return 'done'
  }, { signal: new AbortController().signal, onRetry: () => {} })
  assert.equal(out, 'done')
  assert.equal(attempts, 3)
})
