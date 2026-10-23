import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opencodeSessionKey } from '../src/main/providers/opencode/sessionKey.ts'

/**
 * السبب الجذري لبطء «شات جديد على نفس المشروع»:
 * ترويسة `x-opencode-session` كانت تُؤخذ من معرّف الشات الداخلي (`ses_xxx`)،
 * وهو يتغيّر مع كل شات جديد ⇒ المزوّد يفقد التوجيه والـ prompt caching
 * ⇒ بداية باردة (40-120 ثانية) في أول نداء من كل شات جديد.
 *
 * الإصلاح: اشتقاق معرّف **مستقر** من المزوّد + المشروع (أو ثابت للتطبيق)
 * بدل معرّف الشات العابر.
 */
test('معرّف الجلسة يبقى ثابتاً عبر شاتات مختلفة على نفس المشروع', () => {
  const a = opencodeSessionKey('prv_1', 'prj_mkule0pr5ev2')
  const b = opencodeSessionKey('prv_1', 'prj_mkule0pr5ev2')
  assert.equal(a, b, 'شاتان على نفس المشروع يجب أن يُرسلا نفس معرّف الجلسة')
})

test('معرّف الجلسة يختلف بين مشروعين مختلفين', () => {
  const a = opencodeSessionKey('prv_1', 'prj_A')
  const b = opencodeSessionKey('prv_1', 'prj_B')
  assert.notEqual(a, b)
})

test('معرّف الجلسة يختلف بين مزوّدين مختلفين', () => {
  const a = opencodeSessionKey('prv_1', 'prj_A')
  const b = opencodeSessionKey('prv_2', 'prj_A')
  assert.notEqual(a, b)
})

test('بلا مشروع: يبقى معرّف ثابت للتطبيق (لا معرّف شات عابر)', () => {
  const a = opencodeSessionKey('prv_1', null)
  const b = opencodeSessionKey('prv_1', null)
  assert.equal(a, b)
  assert.ok(a.length > 0)
})

test('المعرّف ثابت لا يتغيّر بتغيّر اسم الشات الداخلي', () => {
  // sessionId المتغيّر (معرّف الشات) لا يُستخدم أصلاً في اشتقاق المفتاح
  const a = opencodeSessionKey('prv_1', 'prj_X')
  const b = opencodeSessionKey('prv_1', 'prj_X')
  assert.equal(a, b)
})