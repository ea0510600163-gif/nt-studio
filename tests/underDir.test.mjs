import { test } from 'node:test'
import assert from 'node:assert/strict'
import { underDir } from '../src/main/util.ts'

test('underDir يطابق المجلد نفسه بمختلف الفواصل وحالة الأحرف', () => {
  assert.equal(underDir('D:\\nt\\game', 'D:\\nt\\game'), true)
  assert.equal(underDir('D:\\nt\\game', 'd:/NT/game/'), true)
})

test('underDir يطابق مجلداً فرعياً', () => {
  assert.equal(underDir('D:\\nt\\game', 'D:\\nt\\game\\node_modules\\.bin'), true)
  assert.equal(underDir('D:\\nt\\game', 'd:/nt/game/src'), true)
})

test('underDir لا يطابق مجلداً شقيقاً يبدأ بالاسم نفسه', () => {
  assert.equal(underDir('D:\\nt\\game', 'D:\\nt\\game2'), false)
  assert.equal(underDir('C:\\nt\\game', 'D:\\nt\\game'), false)
  assert.equal(underDir('D:\\nt\\game', 'D:\\nt'), false)
})

test('underDir يتجاهل الشرطة الأخيرة الزائدة في الطرفين', () => {
  assert.equal(underDir('D:/nt/game/', 'D:/nt/game/src/'), true)
  assert.equal(underDir('D:/nt/game', 'D:/nt/games/'), false)
})
