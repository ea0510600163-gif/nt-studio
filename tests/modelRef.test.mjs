import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickModelRef } from '../src/main/agent/modelRef.ts'

/** حلّال وهمي: «prv_gone» محذوف من قاعدة البيانات — وهذا ما يحدث فعلاً عند حذف مزود */
const resolve = (ref) => (ref && ref.providerId === 'prv_gone' ? null : ref ? { provider: { id: ref.providerId }, model: { id: ref.modelId } } : null)

const alive = { providerId: 'prv_ok', modelId: 'deepseek-v4.1-flash' }
const dead = { providerId: 'prv_gone', modelId: 'longcat-2.5-preview-free' }

test('المرشح الأول الصالح هو المختار (السلوك المعتاد لا يتغيّر)', () => {
  assert.deepEqual(pickModelRef([alive, dead, alive], resolve), resolve(alive))
})

test('مرجع الجلسة الميت لا يقتل الجلسة: يُستخدم النموذج الافتراضي', () => {
  // الجلسة تشير إلى مزود محذوف؛ الإعدادات فيها نموذج افتراضي صالح
  assert.deepEqual(pickModelRef([dead, dead, alive], resolve), resolve(alive))
})

test('الفراغات تُتخطّى بلا انهيار', () => {
  assert.deepEqual(pickModelRef([null, undefined, alive], resolve), resolve(alive))
})

test('كل المرشحين ميتون ⇒ null (الواجهة تُبلغ «لم يُحدَّد نموذج»)', () => {
  assert.equal(pickModelRef([dead, null, dead], resolve), null)
  assert.equal(pickModelRef([], resolve), null)
})
