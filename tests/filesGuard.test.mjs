import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'

const ROOT = new URL('..', import.meta.url).href

const TYPE_ONLY = new Set([
  'Tool', 'ToolContext', 'ToolResult', 'Settings', 'ProjectInfo', 'ModelInfo', 'TodoItem',
  'FileDiff', 'ImageData', 'Phase', 'ModelRef', 'ProviderInput', 'ProviderPublic', 'Db',
  'BrowserWindow', 'EventChannel', 'AgentEvent', 'ApiStyle'
])

const stub = (code) => ({ url: 'data:text/javascript,' + encodeURIComponent(code), format: 'module', shortCircuit: true })

const STUBS = {
  electron: `
export const app = { getPath(){ return process.env.TEMP || '.' }, on(){}, whenReady(){ return Promise.resolve() }, getName(){ return 'nt' } }
export const safeStorage = { isEncryptionAvailable(){ return false }, encryptString(s){ return Buffer.from(String(s)) }, decryptString(b){ return String(b) } }
export const BrowserWindow = class {}
export const ipcMain = { handle(){}, on(){} }
export default { app, safeStorage }
`,
  db: `
export function db(){ throw new Error('db stub') }
export function flushOnQuit(){}
`,
  providers: `
export function getSettings(){ return { workspaceRoot: process.env.NT_TEST_ROOT || process.cwd(), approvalMode: false, maxOutputTokens: 64000, commandTimeoutSec: 600 } }
export function getProviders(){ return [] }
`
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return stub(STUBS.electron)
    if (specifier === '../store/db' || specifier === './db') return stub(STUBS.db)
    if (specifier === '../store/providers') return stub(STUBS.providers)
    let s = specifier
    if (s.startsWith('@shared/')) s = ROOT + '/src/shared/' + s.slice('@shared/'.length) + '.ts'
    else if (s.startsWith('.') && !/\.(ts|mjs|js|json|cjs)$/.test(s)) s = new URL(s + '.ts', context.parentURL).href
    return nextResolve(s, context)
  },
  load(url, context, nextLoad) {
    const r = nextLoad(url, context)
    const raw = r.source
    const src = raw == null ? null : typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
    if (src == null || !url.startsWith('file:') || !url.endsWith('.ts')) return r
    const fixed = src.replace(/import\s*\{([^}]*)\}\s*from\s*'(\.\/types|\.\/providers\/types)'/g, (_m, names, spec) => {
      const keep = names
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .filter((n) => !TYPE_ONLY.has(n.replace(/^type\s+/, '')))
      return keep.length ? `import { ${keep.join(', ')} } from '${spec}'` : ''
    })
    return fixed === src ? r : { format: r.format, source: fixed, shortCircuit: true }
  }
})

const { fileTools } = await import(ROOT + '/src/main/tools/files.ts')

const tool = (name) => {
  const t = fileTools.find((x) => x.name === name)
  assert.ok(t, `الأداة ${name} غير موجودة في fileTools`)
  return t
}

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'nt-guard-'))
  const settings = {
    workspaceRoot: cwd,
    maxSteps: 2000,
    commandTimeoutSec: 900,
    maxOutputTokens: 64000,
    compactAtPercent: 85,
    approvalMode: false,
    defaultModel: null,
    fallbackModel: null
  }
  const ctx = {
    sessionId: 'guard-test',
    signal: new AbortController().signal,
    vision: true,
    project: () => null,
    cwd: () => cwd,
    model: () => ({ id: 'test-model', tools: true, vision: true, contextWindow: 200000, maxOutput: 64000 }),
    bind() {},
    ask: async () => 'موافقة',
    plan: () => [],
    setPlan() {},
    setPhase() {},
    settings: () => settings
  }
  return {
    ctx,
    outsideDir: mkdtempSync(join(tmpdir(), 'nt-outside-')),
    seed(relPath, body) {
      const abs = join(cwd, relPath)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, body)
      return abs
    },
    cleanup() {
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}

test('read_file يقرأ مساراً مطلقاً داخل جذر مساحة العمل بنجاح', async () => {
  const ws = workspace()
  try {
    const abs = ws.seed('src/hello.ts', 'export const x = 1\n')
    const r = await tool('read_file').run({ path: abs }, ws.ctx)
    assert.equal(r.isError, undefined)
    assert.match(r.content, /export const x = 1/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('read_file يقرأ مساراً نسبياً داخل مساحة العمل', async () => {
  const ws = workspace()
  try {
    ws.seed('notes.txt', 'محتوى عادي')
    const r = await tool('read_file').run({ path: 'notes.txt' }, ws.ctx)
    assert.equal(r.isError, undefined)
    assert.match(r.content, /محتوى عادي/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('read_file يقرأ مساراً مطلقاً خارج جذر مساحة العمل وملفات .env بصلاحيات كاملة', async () => {
  const ws = workspace()
  try {
    const outside = join(ws.outsideDir, 'normal.txt')
    writeFileSync(outside, 'محتوى عادي خارج مساحة العمل\n')
    const r = await tool('read_file').run({ path: outside }, ws.ctx)
    assert.equal(r.isError, undefined)
    assert.match(r.content, /محتوى عادي خارج/)

    const envFile = ws.seed('.env', 'PORT=3000\n')
    const rEnv = await tool('read_file').run({ path: envFile }, ws.ctx)
    assert.equal(rEnv.isError, undefined)
    assert.match(rEnv.content, /PORT=3000/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('read_file يدعم قراءة عدة ملفات دفعة واحدة عبر paths', async () => {
  const ws = workspace()
  try {
    ws.seed('a.txt', 'first-file')
    ws.seed('b.txt', 'second-file')
    const r = await tool('read_file').run({ paths: ['a.txt', 'b.txt'] }, ws.ctx)
    assert.equal(r.isError, undefined)
    assert.match(r.content, /first-file/)
    assert.match(r.content, /second-file/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('edit_file يدعم تعديلات متعددة دفعة واحدة عبر edits', async () => {
  const ws = workspace()
  try {
    const f = ws.seed('multi.ts', 'const a = 1\nconst b = 2\n')
    const r = await tool('edit_file').run({
      path: f,
      edits: [
        { old_str: 'const a = 1', new_str: 'const a = 10' },
        { old_str: 'const b = 2', new_str: 'const b = 20' }
      ]
    }, ws.ctx)
    assert.equal(r.isError, undefined)
    const after = await tool('read_file').run({ path: f }, ws.ctx)
    assert.match(after.content, /const a = 10/)
    assert.match(after.content, /const b = 20/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('list_dir يستعرض مجلداً خارج مساحة العمل بنجاح', async () => {
  const ws = workspace()
  try {
    writeFileSync(join(ws.outsideDir, 'entry.txt'), 'x')
    const r = await tool('list_dir').run({ path: ws.outsideDir, depth: 1 }, ws.ctx)
    assert.equal(r.isError, undefined)
    assert.match(r.content, /entry\.txt/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('grep يبحث في مجلد خارج مساحة العمل بنجاح', async () => {
  const ws = workspace()
  try {
    writeFileSync(join(ws.outsideDir, 'findme.txt'), 'needle-in-haystack\n')
    const r = await tool('grep').run({ pattern: 'needle-in-haystack', path: ws.outsideDir }, ws.ctx)
    assert.equal(r.isError, undefined)
    assert.match(r.content, /findme\.txt/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('read_file على ملف غير موجود يُرجع «غير موجود» ولا يرمي', async () => {
  const ws = workspace()
  try {
    const missing = join(ws.ctx.cwd(), 'لا-يوجد.txt')
    const r = await tool('read_file').run({ path: missing }, ws.ctx)
    assert.equal(r.isError, true)
    assert.match(r.content, /غير موجود/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('grep مع include="src/*.ts" يطابق src/a.ts', async () => {
  const ws = workspace()
  try {
    ws.seed('src/a.ts', 'const needle = 1\n')
    ws.seed('deep/nested/b.ts', 'const needle = 2\n')
    const r = await tool('grep').run({ pattern: 'needle', include: 'src/*.ts' }, ws.ctx)
    assert.equal(r.isError, undefined, r.content)
    assert.match(r.content, /src\/a\.ts/)
    assert.doesNotMatch(r.content, /nested\/b\.ts/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})

test('glob بنمط "src/*.ts" يجد src/a.ts', async () => {
  const ws = workspace()
  try {
    ws.seed('src/a.ts', 'x')
    const r = await tool('glob').run({ pattern: 'src/*.ts' }, ws.ctx)
    assert.equal(r.isError, undefined, r.content)
    assert.match(r.content, /src\/a\.ts/)
  } finally {
    ws.cleanup()
    rmSync(ws.outsideDir, { recursive: true, force: true })
  }
})
