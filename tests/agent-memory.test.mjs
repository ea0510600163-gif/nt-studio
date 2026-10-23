import test from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../src/main/agent/agentMemory.ts'
import * as G from '../src/main/desktop/geometry.ts'

test('الذاكرة: هدف جديد يحفظ القديم ويُبقي الملفات', () => {
  const m = M.createAgentMemory('أنشئ ملف أ')
  M.recordAgentFile(m, 'C:/a.html', 'write', 1)
  M.setAgentGoal(m, 'أنشئ ملف ب')
  assert.equal(m.goal, 'أنشئ ملف ب')
  assert.deepEqual(m.previousGoals, ['أنشئ ملف أ'])
  assert.equal(m.files.length, 1)
  assert.match(M.agentMemorySection(m), /طلبات سابقة/)
})

test('الذاكرة: normalizeMemory يرمّم السجل القديم', () => {
  const old = { goal: 'x', files: [{ path: 'p', action: 'write', step: 1 }], updatedAt: 5 }
  const m = M.normalizeMemory(old)
  assert.deepEqual(m.actions, [])
  assert.deepEqual(m.previousGoals, [])
  assert.equal(M.normalizeMemory(null), null)
})

test('ذاكرة العمل: حلقة دائرية وملخص', () => {
  const m = M.createAgentMemory('g')
  for (let i = 1; i <= 40; i++) M.recordAction(m, i, `left_click (${i},1)`, 'نُقر', i % 10 !== 0)
  assert.equal(m.actions.length, M.ACTIONS_CAP)
  assert.equal(m.actions[0].step, 11)
  const d = M.actionsDigest(m, 3)
  assert.match(d, /#40 /)
  assert.match(d, /#38 /)
  assert.ok(!d.includes('#37 '))
  assert.match(d, /✗ /)
  assert.equal(M.actionsDigest(M.createAgentMemory('')), '')
})

test('الدائمة: إضافة/تحديث/تكرار شبه مطابق', () => {
  const s = M.emptyStore()
  const a = M.addNote(s, { kind: 'user', text: 'المستخدم يفضّل كروم لتصفح الإنترنت' }, 1)
  assert.equal(a.status, 'added')
  const b = M.addNote(s, { kind: 'user', text: 'المستخدم يفضل كروم لتصفح الانترنت!' }, 2)
  assert.equal(b.status, 'updated')
  assert.equal(s.notes.length, 1)
  assert.equal(M.addNote(s, { kind: 'lesson', text: '   ' }), null)
  const c = M.addNote(s, { kind: 'machine', text: 'مجلد المشاريع في D:\\nt', pinned: true }, 3)
  assert.equal(c.note.pinned, true)
})

test('الدائمة: بحث ونسيان', () => {
  const s = M.emptyStore()
  M.addNote(s, { kind: 'machine', text: 'برنامج فيجما مثبت في D:\\Apps\\Figma' }, 1)
  M.addNote(s, { kind: 'lesson', text: 'زر الحفظ في الرسام أعلى اليسار' }, 2)
  const hit = M.searchNotes(s, 'فيجما')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].uses, 1)
  assert.equal(M.searchNotes(s, '').length, 2)
  assert.equal(M.forgetNotes(s, 'x'), 0)
  assert.equal(M.forgetNotes(s, 'الرسام'), 1)
  assert.equal(M.forgetNotes(s, 'n1'), 1)
  assert.equal(s.notes.length, 0)
})

test('الدائمة: السقف لا يحذف المثبّت', () => {
  const s = M.emptyStore()
  M.addNote(s, { kind: 'user', text: 'ثابت مهم جداً', pinned: true }, 1)
  for (let i = 0; i < M.NOTES_CAP + 20; i++) M.addNote(s, { kind: 'lesson', text: `ملاحظة فريدة رقم ${i} ${'ز'.repeat(i % 7)} كلمة${i}` }, 10 + i)
  assert.ok(s.notes.length <= M.NOTES_CAP)
  assert.ok(s.notes.some((n) => n.pinned))
})

test('الدائمة: العرض ضمن الميزانية والمثبّت أولاً', () => {
  const s = M.emptyStore()
  assert.match(M.renderLongTerm(s), /فارغة بعد/)
  M.addNote(s, { kind: 'user', text: 'اسمي ناصر', pinned: true }, 1)
  for (let i = 0; i < 100; i++) M.addNote(s, { kind: 'lesson', text: `درس رقم ${i} ${'ب'.repeat(80)} ${i}` }, 2 + i)
  M.addJournal(s, 'أنشأت ملف العرض', 'تم في D:\\nt', ['D:\\nt\\a.html'], 1700000000000)
  M.setApp(s, 'Figma', 'C:\\Figma\\Figma.exe')
  const out = M.renderLongTerm(s, 1500)
  assert.ok(out.length <= 1500)
  assert.ok(out.indexOf('اسمي ناصر') < out.indexOf('درس رقم'))
  const full = M.renderLongTerm(s, 100000)
  assert.match(full, /figma → C:/)
  assert.match(full, /2023-11-14: أنشأت ملف العرض/)
})

test('normalizeStore: يتجاهل التالف', () => {
  const s = M.normalizeStore({ notes: [{ id: 'n1', kind: 'zzz', text: 'x' }, { id: 'n2', kind: 'user', text: 'ok' }], apps: { a: 'b', c: 5 } })
  assert.equal(s.notes.length, 1)
  assert.deepEqual(s.apps, { a: 'b' })
})

test('الهندسة: نسبة الشاشة محفوظة ومطابقة 1:1 لشاشة المستخدم 1366×768', () => {
  assert.deepEqual(G.fitLogical(1366, 768), { w: 1366, h: 768 })
  assert.deepEqual(G.fitLogical(1920, 1080), { w: 1280, h: 720 })
  assert.deepEqual(G.fitLogical(2560, 1440), { w: 1280, h: 720 })
  assert.deepEqual(G.fitLogical(1024, 768), { w: 1024, h: 768 })
  assert.deepEqual(G.fitLogical(3840, 1600), { w: 1280, h: 533 })
})

test('الهندسة: تحويل النقطة يستهدف المنتصف وبلا تجاوز ويدعم 1:1 والإحداثيات النسبية', () => {
  const L = { w: 1280, h: 720 }, S = { w: 1920, h: 1080 }
  const p = G.toPhysicalPoint(640, 360, L, S)
  assert.equal(p.physX, 960)
  assert.equal(p.physY, 540)
  const e = G.toPhysicalPoint(99999, -5, L, S)
  assert.equal(e.physX, 1919)
  assert.equal(e.physY, 0)
  // تطابق 1:1 على شاشة المستخدم 1366×768 = دقة بكسل تامة
  const userScreen = { w: 1366, h: 768 }
  const nativePt = G.toPhysicalPoint(683, 384, userScreen, userScreen)
  assert.deepEqual([nativePt.physX, nativePt.physY], [683, 384])
  // دعم الإحداثيات النسبية 0..1 تلقائياً
  const normPt = G.toPhysicalPoint(0.5, 0.5, userScreen, userScreen)
  assert.deepEqual([normPt.physX, normPt.physY], [683, 384])
  const one = G.toPhysicalPoint(300, 200, { w: 1024, h: 768 }, { w: 1024, h: 768 })
  assert.deepEqual([one.physX, one.physY], [300, 200])
  const back = G.toLogicalPoint(960, 540, L, S)
  assert.deepEqual([back.x, back.y], [640, 360])
})

test('الهندسة: رسم مؤشر الماوس ومسطرة الحواف على BGRA وتحويل نقاط التكبير', () => {
  const w = 300, h = 200
  const buf = Buffer.alloc(w * h * 4, 0)
  G.drawCursorAndRulerOnBgra(buf, w, h, 150, 100)
  // نقطة المركز عند (150, 100) تصبح بيضاء (255,255,255)
  const centerIdx = (100 * w + 150) * 4
  assert.equal(buf[centerIdx], 255)
  assert.equal(buf[centerIdx + 1], 255)
  assert.equal(buf[centerIdx + 2], 255)
  // تحويل نقطة من zoom إلى الشاشة الكاملة
  const z = G.planZoom([100, 100, 300, 300], { w: 1366, h: 768 }, { w: 1366, h: 768 })
  const mapped = G.mapZoomPointToLogical(z.out.w / 2, z.out.h / 2, z)
  assert.deepEqual(mapped, { x: 200, y: 200 })
})

test('الهندسة: خطة التكبير', () => {
  const L = { w: 1280, h: 720 }, S = { w: 1920, h: 1080 }
  const z = G.planZoom([400, 300, 200, 100], L, S)
  assert.deepEqual(z.region, [200, 100, 400, 300])
  assert.deepEqual(z.crop, { x: 300, y: 150, width: 300, height: 300 })
  assert.deepEqual(z.out, { w: 600, h: 600 })
  const tiny = G.planZoom([100, 100, 101, 101], L, S)
  assert.ok(tiny.region[2] - tiny.region[0] >= 24)
  const full = G.planZoom([0, 0, 1280, 720], L, S)
  assert.deepEqual(full.out, { w: 1280, h: 720 })
  assert.ok(full.crop.x + full.crop.width <= S.w)
})
