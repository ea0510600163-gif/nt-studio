import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupTasks, groupTurns } from '../src/renderer/lib/groups.ts'

/* عناصر اختبار: المهمة تُصرَّح بـ item.task */
const user = (id) => ({ kind: 'user', id, text: 'ابنِ لي موقع قهوة' })
const boot = (id, name = 'create_project') => ({ kind: 'tool', id, name, input: { slug: 'coffee' }, status: 'ok', ms: 5, task: '__boot', taskText: 'التهيئة' })
const tool = (id, task, name = 'read_file', status = 'ok', ms = 10) => ({ kind: 'tool', id, name, input: { path: 'a.ts' }, status, ms, task, taskText: 'مهمة ' + task })
const note = (id, task) => ({ kind: 'assistant', id, text: 'سأبدأ', task, taskText: 'مهمة ' + task })
const marker = (id, text, status) => ({ kind: 'task', id, text, status })

const groups = (items, running = false) => groupTasks(items, running).filter((s) => s.type === 'group')

test('مهمتان متتاليتان ⇒ مجموعتان للمهام + تهيئة — لا تكديس', () => {
  const items = [user('u1'), boot('t0'), tool('t1', 't1'), tool('t2', 't1'), tool('t3', 't2'), tool('t4', 't2')]
  const g = groups(items)
  assert.equal(g.length, 3)
  assert.deepEqual(g.map((x) => x.task), ['__boot', 't1', 't2'])
})

test('عشرات الخطوات داخل المهمة نفسها = مجموعة واحدة (قلب الإصلاح)', () => {
  const items = Array.from({ length: 30 }, (_, n) => tool(`t${n}`, 't1', n % 2 ? 'write_file' : 'read_file'))
  const g = groups(items)
  assert.equal(g.length, 1, 'لا مجموعة لكل خطوة — المهمة هي الوحدة')
  assert.equal(g[0].rows.length, 30)
})

test('ما قبل أول خطة (التهيئة) مجموعة "__boot"', () => {
  const g = groups([user('u1'), boot('b0'), boot('b1')])
  assert.equal(g.length, 1)
  assert.equal(g[0].task, '__boot')
})

test('رسالة مستخدم وعلامة مهمة تفصلان الشرائح', () => {
  const items = [user('u1'), tool('t1', 't1'), user('u2'), tool('t2', 't1'), marker('m1', 'تمّ', 'done'), tool('t3', 't2')]
  const segs = groupTasks(items, false)
  assert.equal(segs.filter((s) => s.type === 'item').length, 3) // مستخدم + مستخدم + علامة
  const g = groups(items)
  assert.equal(g.length, 3)
  assert.deepEqual(g.map((x) => x.task), ['t1', 't1', 't2']) // المهمة نفسها تستأنف بعد توجيه المستخدم
})

test('أثناء العمل: المجموعة الأخيرة حيّة', () => {
  const items = [user('u1'), tool('t1', 't1'), tool('t2', 't2')]
  const segs = groupTasks(items, true)
  const g = segs.filter((s) => s.type === 'group')
  assert.equal(g[0].live, false)
  assert.equal(g[1].live, true)
  assert.equal(groupTasks(items, false).filter((s) => s.type === 'group' && s.live).length, 0)
})

test('ملاحظة الوكيل تظهر مستقلّة (لا تُحشر داخل خطوات التنفيذ)', () => {
  const items = [note('a1', 't1'), tool('t1', 't1'), note('a2', 't1')]
  const segs = groupTasks(items, false)
  // ملاحظة الوكيل = عنصر مفرد، لا صفّ внутри مجموعة — فلا يُدفن الجواب بداخلها
  assert.equal(segs.filter((s) => s.type === 'item' && s.item.kind === 'assistant').length, 2)
  const g = segs.filter((s) => s.type === 'group')
  assert.equal(g.length, 1)
  assert.equal(g[0].rows.length, 1)
})

test('رد نصّي خالص بلا أدوات ⇒ عنصر مفرد', () => {
  const items = [note('a1', 't1'), tool('t1', 't2')]
  const segs = groupTasks(items, false)
  assert.equal(segs.filter((s) => s.type === 'item').length, 1)
  assert.equal(groups(items).length, 1)
})

test('عناصر بلا مهمة (جلسة قديمة) تُجمَّع معاً', () => {
  const items = [{ kind: 'tool', id: 'a', name: 'read_file', input: {}, status: 'ok', ms: 1 }, { kind: 'tool', id: 'b', name: 'write_file', input: {}, status: 'ok', ms: 1 }]
  const g = groups(items)
  assert.equal(g.length, 1)
  assert.equal(g[0].rows.length, 2)
})

/* ───────── حاوية الدور (groupTurns) ───────── */

const turns = (items, running = false) => groupTurns(groupTasks(items, running), running)

test('الدور يحتضن العمل ويفصل الجواب النهائي خارج الطيّ', () => {
  const items = [user('u1'), note('a1', 't1'), tool('t1', 't1'), note('a2', 't1')]
  const blocks = turns(items)
  assert.equal(blocks.length, 2) // مستخدم + دور
  assert.equal(blocks[0].type, 'item')
  const turn = blocks[1]
  assert.equal(turn.type, 'turn')
  // العمل = النثر الوسيط + مجموعة الأحداث؛ الجواب النهائي خارجها
  assert.equal(turn.work.length, 2)
  assert.equal(turn.work[0].type, 'item')
  assert.equal(turn.work[1].type, 'group')
  assert.equal(turn.tail.kind, 'assistant')
  assert.equal(turn.tail.id, 'a2')
})

test('ردّ خالص بلا أدوات ⇒ دور بلا رأس عمل (لا يُطوى الملخّص)', () => {
  const blocks = turns([user('u1'), note('a1', 't1')])
  const turn = blocks[1]
  assert.equal(turn.type, 'turn')
  assert.equal(turn.work.length, 1)
  assert.equal(turn.tail, null)
  assert.equal(turn.work.some((s) => s.type === 'group'), false)
})

test('كل رسالة مستخدم تبدأ دوراً جديداً', () => {
  const items = [user('u1'), tool('t1', 't1'), note('a1', 't1'), user('u2'), tool('t2', 't1'), note('a2', 't1')]
  const blocks = turns(items)
  assert.deepEqual(blocks.map((b) => b.type), ['item', 'turn', 'item', 'turn'])
})

test('مدّة الدور = مجموع مدد أدواته', () => {
  const items = [user('u1'), tool('t1', 't1', 'read_file', 'ok', 10), tool('t2', 't1', 'write_file', 'ok', 25), note('a1', 't1')]
  const turn = turns(items)[1]
  assert.equal(turn.ms, 35)
})

test('أثناء العمل: الدور الأخير حيّ وما قبله ساكن', () => {
  const items = [user('u1'), tool('t1', 't1'), note('a1', 't1'), user('u2'), tool('t2', 't1')]
  const blocks = turns(items, true).filter((b) => b.type === 'turn')
  assert.equal(blocks[0].live, false)
  assert.equal(blocks[1].live, true)
  assert.equal(turns(items, false).filter((b) => b.type === 'turn' && b.live).length, 0)
})
