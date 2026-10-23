import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastUserRequest } from '../src/main/agent/context.ts'

const msg = (role, blocks, at) => ({ role, content: blocks, at })

test('lastUserRequest يحدد آخر طلب ويجمع نصّه وصوره', () => {
  const msgs = [
    msg('user', [{ type: 'text', text: 'الطلب الأول' }], 1),
    msg('assistant', [{ type: 'text', text: 'الجواب الأول' }], 2),
    msg('user', [
      { type: 'text', text: 'الطلب الثاني' },
      { type: 'image', mediaType: 'image/png', data: 'AAA' }
    ], 3),
    msg('assistant', [{ type: 'text', text: 'جواب ثانٍ' }], 4)
  ]
  const req = lastUserRequest(msgs)
  assert.equal(req.index, 2)
  assert.equal(req.text, 'الطلب الثاني')
  assert.deepEqual(req.images, [{ mediaType: 'image/png', data: 'AAA' }])
})

test('lastUserRequest يعيد null بلا طلب في السجل', () => {
  assert.equal(lastUserRequest([msg('assistant', [{ type: 'text', text: 'جواب' }], 1)]), null)
  assert.equal(lastUserRequest([]), null)
})

test('إعادة التوليد تقطع السجل عند آخر طلب فتبقى الرسائل السابقة له', () => {
  const msgs = [
    msg('user', [{ type: 'text', text: 'أول' }], 1),
    msg('assistant', [{ type: 'text', text: 'رد' }], 2),
    msg('user', [{ type: 'text', text: 'ثانٍ' }], 3),
    msg('assistant', [{ type: 'text', text: 'رد2' }], 4)
  ]
  const req = lastUserRequest(msgs)
  const kept = msgs.slice(0, req.index)
  assert.deepEqual(kept.map((m) => m.content[0].text), ['أول', 'رد'])
  assert.equal(req.text, 'ثانٍ')
})
