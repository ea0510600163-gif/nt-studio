import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opencodeHeaders, opencodeSessionKey } from '../src/main/providers/opencode/headers.ts'
import { OPENCODE_USER_AGENT } from '../src/shared/catalogs.ts'

/**
 * تثبيت عقد ترويسات OpenCode Go (المواصفة §10).
 * الترويسة `x-opencode-session` + `User-Agent` المميّز سببَي عمل المزوّد أصلاً،
 * وغيابهما يعني خطأ 400 «Request is missing x-opencode-session». والجهة الأخرى
 * من العقد أهمّ: مزوّد عادي لا يحمل هذه الترويسات وإلا اختلّ توجيهه.
 */

test('opencodeHeaders(true) يضيف x-opencode-session وUser-Agent مميّزاً', () => {
  const h = opencodeHeaders(true, 'k')
  assert.equal(h['x-opencode-session'], 'k')
  assert.equal(h['user-agent'], OPENCODE_USER_AGENT)
  // معرّف عميل حقيقي، لا اسم مكتبة HTTP عامة (كان هذا سبب الرفض)
  assert.ok(OPENCODE_USER_AGENT.length > 0)
  assert.ok(!/^(node|undici|fetch|axios|okhttp|python-requests)/i.test(OPENCODE_USER_AGENT))
  // لا ترويسة ثالثة تتسرّب إلى المزوّد بلا قصد
  assert.deepEqual(Object.keys(h).sort(), ['user-agent', 'x-opencode-session'])
})

test('مفتاح الجلسة يُقصّ من الفراغات ولا يُعدَّل محتواه', () => {
  assert.equal(opencodeHeaders(true, '  nt-p1-proj  ')['x-opencode-session'], 'nt-p1-proj')
})

test('عدم انحدار: مزوّد عادي لا يرسل ترويسات OpenCode', () => {
  // فحص المواصفة الصريح: opencode=false/undefined ⇒ كائن فارغ تماماً
  for (const flag of [false, undefined]) {
    assert.deepEqual(opencodeHeaders(flag, 'k'), {})
    assert.equal(opencodeHeaders(flag, 'k')['x-opencode-session'], undefined)
    assert.equal(opencodeHeaders(flag, 'k')['user-agent'], undefined)
  }
})

test('الدالة كلّية: مفتاح ناقص أو فارغ يعود إلى مفتاح حتمي غير فارغ', () => {
  for (const key of [undefined, '', '   ']) {
    const v = opencodeHeaders(true, key)['x-opencode-session']
    assert.ok(typeof v === 'string' && v.length > 0, `مفتاح فارغ للمدخل ${JSON.stringify(key)}`)
    assert.equal(v, opencodeSessionKey(''))
  }
  // ثابت عبر النداءات: لا توليد عشوائي لكل نداء (يكسر الـ prompt caching)
  assert.equal(
    opencodeHeaders(true, undefined)['x-opencode-session'],
    opencodeHeaders(true, undefined)['x-opencode-session']
  )
})

test('الدمج يحافظ على ترويسات المستدعي ثم يضيف ترويسات OpenCode', () => {
  const base = { authorization: 'Bearer k', 'content-type': 'application/json' }
  assert.deepEqual({ ...base, ...opencodeHeaders(true, 'k') }, {
    authorization: 'Bearer k',
    'content-type': 'application/json',
    'user-agent': OPENCODE_USER_AGENT,
    'x-opencode-session': 'k'
  })
  // والعكس: بلا opencode لا يزال الدمج هو base بلا زيادة
  assert.deepEqual({ ...base, ...opencodeHeaders(false, 'k') }, base)
})

test('opencodeSessionKey ثابت ومشتقّ من المزوّد والمشروع', () => {
  assert.equal(opencodeSessionKey('prov1', 'proj2'), 'nt-prov1-proj2')
  assert.equal(opencodeSessionKey('prov1'), 'nt-prov1-app')
  // مزوّدان different ≠ نفس المفتاح (وإلا تقاسموا جلسة المزوّد)
  assert.notEqual(opencodeSessionKey('prov1', 'a'), opencodeSessionKey('prov2', 'a'))
  // حروف خطرة تُقتلع: المفتاح يدخل في ترويسة HTTP
  assert.equal(opencodeSessionKey('p 1/x'), 'nt-p1x-app')
})
