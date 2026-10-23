import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planProgress } from '../src/renderer/lib/plan.ts'

/**
 * ملخّص حالة الخطة — يغذّي بطاقة الخطة في المحادثة (PlanCard):
 * العدّاد في الرأس، شريط النسبة، والأيقونة الحيّة لكل بند
 * (دوران للجاري، صح للمنجز، تعتيم لما لم يُبدأ).
 */

const item = (id, status) => ({ id, text: `بند ${id}`, status })

test('خطة فارغة ⇒ أصفار بلا قسمة على صفر', () => {
  const p = planProgress([])
  assert.equal(p.total, 0)
  assert.equal(p.done, 0)
  assert.equal(p.pct, 0)
  assert.equal(p.current, null)
})

test('حالات مختلطة: العدّ صحيح والنسبة مقرّبة والحالي أول doing', () => {
  const plan = [item('1', 'done'), item('2', 'done'), item('3', 'doing'), item('4', 'pending'), item('5', 'blocked')]
  const p = planProgress(plan)
  assert.equal(p.total, 5)
  assert.equal(p.done, 2)
  assert.equal(p.doing, 1)
  assert.equal(p.blocked, 1)
  assert.equal(p.pending, 1)
  assert.equal(p.pct, 40) // 2/5
  assert.equal(p.current?.id, '3')
})

test('أول doing هو الحالي حتى مع تعدد البنود الجارية', () => {
  const plan = [item('1', 'pending'), item('2', 'doing'), item('3', 'doing')]
  assert.equal(planProgress(plan).current?.id, '2')
})

test('بلا doing ⇒ الحالي null (لا ندّعي جارياً وهمياً)', () => {
  const plan = [item('1', 'done'), item('2', 'pending')]
  assert.equal(planProgress(plan).current, null)
})

test('كل البنود منجزة ⇒ 100% والحالي null', () => {
  const plan = [item('1', 'done'), item('2', 'done')]
  const p = planProgress(plan)
  assert.equal(p.pct, 100)
  assert.equal(p.current, null)
})

test('النصف: 1/2 ⇒ 50% بلا كسور عشرية في الواجهة', () => {
  assert.equal(planProgress([item('1', 'done'), item('2', 'pending')]).pct, 50)
})

test('الثّلث: 1/3 ⇒ 33% (تقريب للأقرب لا اقتطاع)', () => {
  assert.equal(planProgress([item('1', 'done'), item('2', 'pending'), item('3', 'pending')]).pct, 33)
})
