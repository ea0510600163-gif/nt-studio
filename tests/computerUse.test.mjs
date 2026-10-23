import { test } from 'node:test'
import assert from 'node:assert/strict'
import { win32Worker } from '../src/main/desktop/win32Worker.ts'

test('win32Worker يقلع ويقرأ أبعاد الشاشة وموقع الماوس ويستعرض النوافذ المفتوحة على ويندوز', async () => {
  const LIVE_TIMEOUT = 30000
  try {
    const cursor = await win32Worker.call('cursor', {}, LIVE_TIMEOUT)
    assert.equal(cursor.ok, true)
    assert.ok(typeof cursor.screenW === 'number' && cursor.screenW >= 640, `عرض الشاشة: ${cursor.screenW}`)
    assert.ok(typeof cursor.screenH === 'number' && cursor.screenH >= 480, `طول الشاشة: ${cursor.screenH}`)
    assert.ok(typeof cursor.x === 'number', `موقع الماوس X: ${cursor.x}`)
    assert.ok(typeof cursor.y === 'number', `موقع الماوس Y: ${cursor.y}`)

    const wins = await win32Worker.call('windows', {}, LIVE_TIMEOUT)
    assert.equal(wins.ok, true)
    assert.ok(Array.isArray(wins.windows), 'قائمة النوافذ مصفوفة')

    const hit = await win32Worker.call('hitTest', { x: 400, y: 300 }, LIVE_TIMEOUT)
    assert.equal(hit.ok, true)

    const ui = await win32Worker.call('inspectUi', { maxItems: 15 }, LIVE_TIMEOUT)
    assert.equal(ui.ok, true)
    assert.ok(Array.isArray(ui.elements), 'قائمة العناصر التفاعلية مصفوفة')

    const target = await win32Worker.call('findTarget', { query: 'nonexistent-ui-element-xyz' }, LIVE_TIMEOUT)
    assert.equal(target.ok, true)
  } finally {
    win32Worker.destroy()
  }
})
