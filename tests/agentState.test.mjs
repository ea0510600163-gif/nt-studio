import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  MEMORY_FILES_CAP,
  agentMemorySection,
  createAgentMemory,
  recordAgentFile,
  setAgentGoal
} from '../src/main/agent/agentMemory.ts'

/**
 * المشكلة 6 (تحديث 2026-10): «معاينة الجهاز داخل التطبيق بلا فائدة».
 * الحل: أُلغيت معاينة الشاشة كلها — المشاهدة تتم على سطح المكتب الحقيقي عبر
 * الشريط العائم المصغّر 480×48 بحدّ طيف AI متحرك، ورسالة النموذج في مستطيل
 * شفاف تماماً، والبث إلى الواجهة نصي خفيف بلا صور.
 *
 * المشكلة 7: «ذاكرة بصرية قصيرة — ينسى الملفات».
 * الحل: ذاكرة حالة (الهدف + الملفات) خارج الرسائل لا يمسّها ضغط السياق،
 * وتُحقن في الموجّه قسم STATE MEMORY.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/* ───────────── ذاكرة الحالة ───────────── */

test('إنشاء الذاكرة: هدف مطبّع ومقصوص، وملفات فارغة', () => {
  const m = createAgentMemory('  أنشئ   لي portfolio.html  ')
  assert.equal(m.goal, 'أنشئ لي portfolio.html')
  assert.deepEqual(m.files, [])
})

test('تسجيل الملفات: بلا تكرار للمسار، الأحدث يفوز ويُنتقل للنهاية، مع سقف', () => {
  const m = createAgentMemory('مهمة')
  recordAgentFile(m, 'portfolio.html', 'write', 1)
  recordAgentFile(m, 'styles.css', 'write', 2)
  recordAgentFile(m, 'portfolio.html', 'edit', 3)
  assert.equal(m.files.length, 2)
  assert.deepEqual(m.files[1], { path: 'portfolio.html', action: 'edit', step: 3 })
  for (let i = 0; i < MEMORY_FILES_CAP + 5; i++) recordAgentFile(m, `f${i}.txt`, 'write', 10 + i)
  assert.equal(m.files.length, MEMORY_FILES_CAP)
  assert.equal(m.files.at(-1).path, `f${MEMORY_FILES_CAP + 4}.txt`)
})

test('قسم الموجّه: يعرض الهدف والملفات (ذاكرة لا تُنسى)', () => {
  const m = createAgentMemory('أنشئ موقعاً شخصياً')
  recordAgentFile(m, 'portfolio.html', 'write', 2)
  const section = agentMemorySection(m)
  assert.match(section, /STATE MEMORY/)
  assert.match(section, /أنشئ موقعاً شخصياً/)
  assert.match(section, /portfolio\.html/)
  assert.match(section, /كتابة\/إنشاء/)
})

test('هدف جديد (رسالة متابعة) لا يمسح الملفات', () => {
  const m = createAgentMemory('المهمة الأولى')
  recordAgentFile(m, 'app.tsx', 'write', 1)
  setAgentGoal(m, 'الآن أضف زر حفظ')
  assert.equal(m.goal, 'الآن أضف زر حفظ')
  assert.equal(m.files.length, 1)
  assert.equal(m.files[0].path, 'app.tsx')
})

/* ───────────── عقد لوحة الإيجنت (حاجز انحدار مصدري — نمط rtlPlacement في هذا المستودع) ───────────── */

test('عقد لوحة الإيجنت: رسالة النموذج شفافة، بلا معاينة شاشة، والإيقاف زر صريح', () => {
  const cons = read('src/renderer/components/computer/AgentConsole.tsx')
  assert.match(cons, /ai-msg/, 'رسالة النموذج في حاوية مستطيلة شفافة تماماً')
  assert.match(cons, /computer\.thought/, 'رسالة النموذج الحية معروضة')
  assert.match(cons, /btn-danger/, 'زر الإيقاف زر صريح دائم')
  assert.match(cons, /computer\.stuck/, 'حالة الحلقة البصرية معروضة')
  assert.match(cons, /activeWindowTitle/)
  assert.doesNotMatch(cons, /getDisplayMedia/, 'بلا بث شاشة داخل التطبيق')
  assert.doesNotMatch(cons, /<img/, 'بلا صور إطارات — المعاينة أُلغيت')

  const types = read('src/shared/types.ts')
  assert.doesNotMatch(types, /lastFrame|prevFrame|sourceId/, 'بلا حقول صور في حالة الإيجنت')
  assert.match(types, /lastActions: ComputerActionTrace\[\]/)
  assert.match(types, /stuck: ComputerStuckState \| null/)
})

test('عقد المتحكم: بث نصي خفيف بلا صور، والحلقة البصرية موصولة، والشريط العائم بطيف AI مصغّر', () => {
  const controller = read('src/main/desktop/controller.ts')
  assert.match(controller, /send\('computer:state', this\.state\)/, 'بث الحالة مباشرة بلا صور')
  assert.doesNotMatch(controller, /prevFrame|lastFrame|stateForWire/, 'لا صور في سلك الواجهة إطلاقاً')
  assert.match(controller, /cycleGuard/, 'حارس الحلقة البصرية موصول في المتحكم')
  assert.match(controller, /\[loop-guard\]/, 'سجل واضح عند منع التكرار')
  assert.match(controller, /activeWindowProcess/)

  assert.ok(!existsSync(join(ROOT, 'src/renderer/components/computer/DesktopViewer.tsx')), 'معاينة الجهاز أُلغيت من المشروع')
  const hud = read('src/main/desktop/floatingHud.ts')
  assert.match(hud, /ai-spin/, 'الحد المتحرك بطيف الذكاء الاصطناعي')
  assert.match(hud, /const w = 480/, 'الشريط أصغر (480×48)')
  assert.match(hud, /⏹ إيقاف/, 'زر الإيقاف يبقى زراً صريحاً في الشريط')
  assert.match(hud, /class="msg"/, 'رسالة النموذج في مستطيل شفاف')
  assert.doesNotMatch(hud, /d9a45c/, 'لا ذهبي في الشريط العائم')
})

test('حراسة الرؤية: لا تذكير progress إلزامي في النواة — الأداة موجودة والقرار للنموذج', () => {
  const memory = read('src/main/agent/agentMemory.ts')
  assert.doesNotMatch(memory, /progressReminder|markProgressCall|tickStep|PROGRESS_SOFT_EVERY|PROGRESS_HARD_EVERY/, 'آلة التذكير الإلزامي حُذفت')
  const loop = read('src/main/agent/loop.ts')
  assert.doesNotMatch(loop, /progressReminder|markProgressCall|تذكير إلزامي/, 'لا حقن تذكيرات في الحلقة')
  const computerTool = read('src/main/tools/computer.ts')
  assert.match(computerTool, /progress/, 'أداة progress نفسها موجودة وموصوفة')
})
