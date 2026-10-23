import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_IMAGES, MAX_IMAGE_BYTES, validateImages } from '../src/shared/images.ts'

const b64 = (bytes) => 'A'.repeat(4 * Math.ceil(bytes / 3)) // base64 صالح بطول محدد البايتات
const png = (kb = 100) => ({ mediaType: 'image/png', data: b64(kb * 1024) })
const jpg = (kb = 100) => ({ mediaType: 'image/jpeg', data: b64(kb * 1024) })

test('قائمة صحيحة ⇒ تمرّ كما هي', () => {
  const r = validateImages([png(), jpg()])
  assert.equal(r.error, undefined)
  assert.equal(r.ok.length, 2)
  assert.equal(r.ok[0].mediaType, 'image/png')
})

test('قائمة فارغة ⇒ لا خطأ', () => {
  const r = validateImages([])
  assert.equal(r.error, undefined)
  assert.equal(r.ok.length, 0)
})

test('أكثر من الحد الأقصى ⇒ خطأ بلا مرفقات', () => {
  const r = validateImages(Array.from({ length: MAX_IMAGES + 1 }, () => png(1)))
  assert.ok(r.error?.includes('6'))
  assert.equal(r.ok.length, 0)
})

test('نوع غير مدعوم (svg/bmp) ⇒ خطأ صريح', () => {
  const r = validateImages([{ mediaType: 'image/svg+xml', data: 'PHN2Zz48L3N2Zz4=' }])
  assert.ok(r.error?.includes('svg'))
  assert.equal(r.ok.length, 0)
})

test('بيانات تالفة (base64 غير صالح) ⇒ خطأ', () => {
  const r = validateImages([{ mediaType: 'image/png', data: '^^^^not*base64$$' }])
  assert.ok(r.error)
  assert.equal(r.ok.length, 0)
})

test('صورة أضخ من 4MB ⇒ خطأ يذكر الحد', () => {
  const r = validateImages([{ mediaType: 'image/png', data: 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) }])
  assert.ok(r.error?.includes('4'))
  assert.equal(r.ok.length, 0)
})
