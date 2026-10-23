import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'

const ROOT = new URL('..', import.meta.url).href

const shellCalls = []
const stub = (code) => ({ url: 'data:text/javascript,' + encodeURIComponent(code), format: 'module', shortCircuit: true })

const STUBS = {
  electron: `
export const shell = {
  openPath(p) { globalThis.__shellCalls.push(['openPath', p]); return Promise.resolve('') },
  openExternal(u) { globalThis.__shellCalls.push(['openExternal', u]); return Promise.resolve() }
}
export default { shell }
`,
  db: `
const store = new Map()
export function db() {
  return {
    get(table, key) { return store.get(table + ':' + key) ?? null },
    put(table, key, value) { store.set(table + ':' + key, value) }
  }
}
export function flushOnQuit() {}
`
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return stub(STUBS.electron)
    if (specifier === '../store/db') return stub(STUBS.db)
    let s = specifier
    if (s.startsWith('@shared/')) s = ROOT + '/src/shared/' + s.slice('@shared/'.length) + '.ts'
    else if (s.startsWith('.') && !/\.(ts|mjs|js|json|cjs)$/.test(s)) s = new URL(s + '.ts', context.parentURL).href
    return nextResolve(s, context)
  }
})

globalThis.__shellCalls = shellCalls

const { findStartMenuShortcut, appQueryHint, launchApplication } = await import(ROOT + 'src/main/desktop/appLaunch.ts')

function startMenu(programData, appData, localAppData) {
  const prev = {
    ProgramData: process.env['ProgramData'],
    APPDATA: process.env['APPDATA'],
    LOCALAPPDATA: process.env['LOCALAPPDATA']
  }
  process.env['ProgramData'] = programData
  process.env['APPDATA'] = appData
  process.env['LOCALAPPDATA'] = localAppData
  return () => {
    process.env['ProgramData'] = prev.ProgramData
    process.env['APPDATA'] = prev.APPDATA
    process.env['LOCALAPPDATA'] = prev.LOCALAPPDATA
  }
}

function tempStartMenu() {
  const base = mkdtempSync(join(tmpdir(), 'nt-applaunch-'))
  const programData = join(base, 'ProgramData')
  const appData = join(base, 'Roaming')
  const localAppData = join(base, 'Local')
  for (const root of [programData, appData, localAppData]) mkdirSync(root, { recursive: true })
  const systemMenu = join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const userMenu = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const localPrograms = join(localAppData, 'Programs')
  mkdirSync(systemMenu, { recursive: true })
  mkdirSync(userMenu, { recursive: true })
  mkdirSync(localPrograms, { recursive: true })
  return { base, systemMenu, userMenu, localPrograms }
}

test('findStartMenuShortcut: استعلام فارغ يُرجع null', () => {
  assert.equal(findStartMenuShortcut(''), null)
  assert.equal(findStartMenuShortcut('   '), null)
})

test('findStartMenuShortcut: لا مجلدات → null', () => {
  const base = mkdtempSync(join(tmpdir(), 'nt-applaunch-empty-'))
  const restore = startMenu(base, base, base)
  try {
    assert.equal(findStartMenuShortcut('notepad'), null)
  } finally {
    restore()
    rmSync(base, { recursive: true, force: true })
  }
})

test('findStartMenuShortcut: المطابقة التامة تفوز على الجزئية', () => {
  const t = tempStartMenu()
  const restore = startMenu(join(t.base, 'ProgramData'), join(t.base, 'Roaming'), join(t.base, 'Local'))
  try {
    writeFileSync(join(t.systemMenu, 'note pad.lnk'), 'x')
    writeFileSync(join(t.systemMenu, 'notepad.lnk'), 'x')
    assert.equal(findStartMenuShortcut('notepad'), join(t.systemMenu, 'notepad.lnk'))
  } finally {
    restore()
    rmSync(t.base, { recursive: true, force: true })
  }
})

test('findStartMenuShortcut: تطابق البادئة والاحتواء وملفات exe', () => {
  const t = tempStartMenu()
  const restore = startMenu(join(t.base, 'ProgramData'), join(t.base, 'Roaming'), join(t.base, 'Local'))
  try {
    writeFileSync(join(t.userMenu, 'paint studio.lnk'), 'x')
    assert.equal(findStartMenuShortcut('paint'), join(t.userMenu, 'paint studio.lnk'))
    writeFileSync(join(t.localPrograms, 'my tool.exe'), 'x')
    assert.equal(findStartMenuShortcut('tool'), join(t.localPrograms, 'my tool.exe'))
    assert.equal(findStartMenuShortcut('my'), join(t.localPrograms, 'my tool.exe'))
  } finally {
    restore()
    rmSync(t.base, { recursive: true, force: true })
  }
})

test('appQueryHint: يعيد الاسم كما هو إن لم يكن في القاموس', () => {
  assert.equal(appQueryHint('  some unknown app  '), 'some unknown app')
  assert.equal(appQueryHint(''), '')
})

test('appQueryHint: يحوّل الأسماء المعروفة إلى أوامر التشغيل', () => {
  assert.equal(appQueryHint('paint'), 'mspaint.exe')
  assert.equal(appQueryHint('notepad'), 'notepad.exe')
  assert.equal(appQueryHint('المفكرة'), 'notepad.exe')
})

test('launchApplication: اسم فارغ يُرجع خطأ بلا لمس الشل', async () => {
  shellCalls.length = 0
  const res = await launchApplication('   ')
  assert.deepEqual(res, { ok: false, message: 'اسم التطبيق فارغ.' })
  assert.equal(shellCalls.length, 0)
})

test('launchApplication: الروابط والبروتوكولات تُفتح خارجياً', async () => {
  shellCalls.length = 0
  const res = await launchApplication('https://example.com/page')
  assert.equal(res.ok, true)
  assert.match(res.message, /فُتح البروتوكول/)
  assert.deepEqual(shellCalls[0], ['openExternal', 'https://example.com/page'])
})

test('launchApplication: مسار موجود يُفتح ويُحفظ في الذاكرة', async () => {
  const base = mkdtempSync(join(tmpdir(), 'nt-applaunch-path-'))
  const target = join(base, 'tool.exe')
  writeFileSync(target, 'x')
  shellCalls.length = 0
  try {
    const res = await launchApplication(target)
    assert.equal(res.ok, true)
    assert.match(res.message, /فُتح البرنامج من المسار/)
    assert.deepEqual(shellCalls[0], ['openPath', target])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
