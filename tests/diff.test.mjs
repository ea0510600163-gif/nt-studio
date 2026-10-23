import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffLines, diffStats, makeDiff, DIFF_MAX_CHARS } from '../src/shared/diff.ts'

const kinds = (lines) => lines.map((l) => l.kind)

test('متطابقان ⇒ كله سياق ولا تغيير', () => {
  const d = diffLines('a\nb\nc', 'a\nb\nc')
  assert.deepEqual(kinds(d), ['ctx', 'ctx', 'ctx'])
  const s = diffStats(d)
  assert.deepEqual(s, { added: 0, removed: 0 })
})

test('إنشاء ملف: كل الأسطر مضافة', () => {
  const d = diffLines('', 'x\ny')
  assert.deepEqual(kinds(d), ['add', 'add'])
  assert.deepEqual(diffStats(d), { added: 2, removed: 0 })
})

test('حذف ملف: كل الأسطر محذوفة', () => {
  const d = diffLines('x\ny', '')
  assert.deepEqual(kinds(d), ['del', 'del'])
  assert.deepEqual(diffStats(d), { added: 0, removed: 2 })
})

test('تعديل سطر واحد: حذف وإضافة في الموضع الصحيح مع ترقيم سليم', () => {
  const d = diffLines('a\nb\nc', 'a\nB\nc')
  assert.deepEqual(kinds(d), ['ctx', 'del', 'add', 'ctx'])
  assert.equal(d[1].text, 'b')
  assert.equal(d[2].text, 'B')
  assert.equal(d[0].oldNo, 1)
  assert.equal(d[0].newNo, 1)
  assert.equal(d[1].oldNo, 2)
  assert.equal(d[2].newNo, 2)
  assert.equal(d[3].oldNo, 3)
  assert.equal(d[3].newNo, 3)
  assert.deepEqual(diffStats(d), { added: 1, removed: 1 })
})

test('إدراج سطر: لا حذف، والترقيم الجديد يزحفظ', () => {
  const d = diffLines('a\nc', 'a\nb\nc')
  assert.deepEqual(kinds(d), ['ctx', 'add', 'ctx'])
  assert.equal(d[0].newNo, 1)
  assert.equal(d[1].newNo, 2)
  assert.equal(d[2].newNo, 3)
  assert.equal(d[2].oldNo, 2)
  assert.deepEqual(diffStats(d), { added: 1, removed: 0 })
})

test('نصّان فارغان ⇒ لا أسطر', () => {
  assert.deepEqual(diffLines('', ''), [])
  assert.deepEqual(diffStats(diffLines('', '')), { added: 0, removed: 0 })
})

test('makeDiff: يُرجع FileDiff بالإحصاءات، ويتجاوز الحجم الكبير بـ null', () => {
  const d = makeDiff('src/a.ts', 'modify', 'a\nb', 'a\nB')
  assert.ok(d)
  assert.equal(d.path, 'src/a.ts')
  assert.equal(d.kind, 'modify')
  assert.equal(d.added, 1)
  assert.equal(d.removed, 1)
  const big = makeDiff('big.txt', 'modify', 'x'.repeat(DIFF_MAX_CHARS + 10), '')
  assert.equal(big, null, 'ملف أضخ من السقف: بلا ديف — يُعرض المحتوى كما هو')
})
