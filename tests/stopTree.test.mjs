import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abortable, abortError } from '../src/main/util.ts'

// إيقاف OpenCode-style: الإلغاء الفوري لكل عملية (لا ينتظر المهلة).
// ملاحظة: session.ts لا تُستورد هنا لأن Node strip-only لا يدعم parameter
// properties — سلوك linkChild/abortAll مغطى بـ typecheck والمراجعة اليدوية.

test('abortable يمرّر النجاح بلا إشارة', async () => {
  assert.equal(await abortable(Promise.resolve(7)), 7)
})

test('abortable يرفض فوراً إن كانت الإشارة مجهَضة مسبقاً', async () => {
  const c = new AbortController()
  c.abort()
  await assert.rejects(abortable(new Promise(() => {}), c.signal), (e) => e.name === 'AbortError')
})

test('abortable يرفض فور الإجهاض بلا انتظار الوعد المعلّق', async () => {
  const c = new AbortController()
  const p = abortable(new Promise(() => {}), c.signal)
  const t0 = Date.now()
  c.abort()
  await assert.rejects(p, (e) => e.name === 'AbortError')
  assert.ok(Date.now() - t0 < 1000, 'يجب الرفض فوراً لا بعد مهلة')
})

test('abortable يلتقط خطأ الوعد نفسه لا الإجهاض', async () => {
  const c = new AbortController()
  await assert.rejects(abortable(Promise.reject(new Error('boom')), c.signal), /boom/)
})

test('abortError يحمل اسم AbortError', () => {
  assert.equal(abortError().name, 'AbortError')
})
