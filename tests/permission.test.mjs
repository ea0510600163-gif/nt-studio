import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'

const ROOT = new URL('..', import.meta.url).href

const stub = (code) => ({ url: 'data:text/javascript,' + encodeURIComponent(code), format: 'module', shortCircuit: true })

const BUS_STUB = `
export function send(channel, payload) { (globalThis.__sent ||= []).push({ channel, payload }) }
export function getWindow() {
  if (globalThis.__win === undefined) return { isDestroyed() { return false }, webContents: { isDestroyed() { return false } } }
  return globalThis.__win
}
export function setWindow() {}
export function flushAll() {}
`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../bus') return stub(BUS_STUB)
    let s = specifier
    if (s.startsWith('@shared/')) s = ROOT + '/src/shared/' + s.slice('@shared/'.length) + '.ts'
    else if (s.startsWith('.') && !/\.(ts|mjs|js|json|cjs)$/.test(s)) s = new URL(s + '.ts', context.parentURL).href
    return nextResolve(s, context)
  }
})

const { DENIED, isRisky, isDestructive, describeTarget, answerApproval, gateTool } = await import(ROOT + '/src/main/tools/permission.ts')

const tick = () => new Promise((r) => setImmediate(r))

function workspace() {
  return mkdtempSync(join(tmpdir(), 'nt-perm-'))
}

function startGate(toolName, args, extra = {}) {
  globalThis.__sent = []
  const promise = gateTool({ permissionMode: 'ask', sessionId: 'sess', toolName, args, ...extra })
  return { promise, requests: () => globalThis.__sent }
}

const DANGEROUS_COMMANDS = [
  'Remove-Item C:\\proj -Recurse -Force',
  'rm -rf ./build',
  'del C:\\temp\\a.txt',
  'rmdir /s /q C:\\temp',
  'Format-Volume -DriveLetter D -FileSystem NTFS',
  'format d: /q',
  'shutdown /s /t 0',
  'Restart-Computer -Force',
  'Stop-Computer',
  'reg delete HKLM\\Software\\X /v y /f',
  'Set-ItemProperty -Path HKLM:\\SYSTEM\\X -Name y -Value 1',
  'Stop-Service -Name W32Time -Force',
  'Disable-WindowsOptionalFeature -Online -FeatureName IIS',
  'bcdedit /set testsigning on',
  'diskpart /s script.txt',
  'Stop-Process -Name lsass -Force',
  'taskkill /f /im svchost.exe'
]

const SAFE_COMMANDS = [
  'Get-ChildItem C:\\proj',
  'npm install',
  'node scripts/build.js',
  'Get-Process | Format-Table -AutoSize',
  '$x = 12; Write-Output $x',
  'Stop-Process -Name notepad',
  'git status',
  'Get-Content .\\README.md',
  'npx tsc --noEmit'
]

test('أوامر خطرة تُعتبر خطرة', () => {
  for (const command of DANGEROUS_COMMANDS) {
    const v = isRisky('run_command', { command })
    assert.equal(v.risky, true, `توقّع خطر: ${command}`)
    assert.ok(v.reason.length > 0, `سبب فارغ: ${command}`)
  }
})

test('أوامر آمنة لا تُعتبر خطرة', () => {
  for (const command of SAFE_COMMANDS) {
    assert.equal(isRisky('run_command', { command }).risky, false, `توقّع أمان: ${command}`)
  }
})

test('حذف مسار خطر ومدمّر، والقراءة العادية آمنة', () => {
  const v = isRisky('delete_path', { path: 'C:\\proj\\src' })
  assert.equal(v.risky, true)
  assert.equal(isDestructive('delete_path', { path: 'C:\\proj\\src' }), true)
  assert.equal(isRisky('read_file', { path: 'src/index.ts' }).risky, false)
})

test('الملفات الحساسة خطرة قراءةً وكتابةً، والعادية آمنة', () => {
  const sensitive = ['.env', '.env.local', 'C:\\Users\\m\\.ssh\\id_rsa', 'cert.pem', 'private.key', 'bundle.pfx', 'keystore.jks', 'config\\passwords.json', 'secrets.yml', '.npmrc']
  for (const p of sensitive) {
    assert.equal(isRisky('read_file', { path: p }).risky, true, `توقّع خطر: ${p}`)
    assert.equal(isRisky('write_file', { path: p, content: 'x' }).risky, true, `توقّع خطر كتابة: ${p}`)
  }
  const normal = ['src/app.tsx', 'notes.txt', 'package.json', 'README.md', 'keys.md', 'env.d.ts']
  for (const p of normal) assert.equal(isRisky('read_file', { path: p }).risky, false, `توقّع أمان: ${p}`)
  assert.equal(isRisky('read_file', { paths: ['src/a.ts', '.env'] }).risky, true)
  assert.equal(isRisky('browser_upload', { paths: 'C:\\keys\\id_rsa', ref: 3 }).risky, true)
})

test('الكتابة فوق ملف موجود خطرة، والجديد والملحق آمنان', () => {
  const cwd = workspace()
  try {
    writeFileSync(join(cwd, 'exists.txt'), 'before')
    assert.equal(isRisky('write_file', { path: 'exists.txt', content: 'after' }, cwd).risky, true)
    assert.equal(isRisky('write_file', { path: 'exists.txt', content: 'more', append: true }, cwd).risky, false)
    assert.equal(isRisky('write_file', { path: 'brand-new.txt', content: 'x' }, cwd).risky, false)
    assert.equal(isRisky('edit_file', { path: 'exists.txt', old_str: 'before', new_str: 'after' }, cwd).risky, false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('النشر والرفع الخارجي خطران، وبقية الأدوات آمنة', () => {
  assert.equal(isRisky('publish_site', { dir: 'dist', repo: 'my-site' }).risky, true)
  assert.equal(isRisky('browser_upload', { paths: 'photo.png', ref: 4 }).risky, true)
  const safe = [
    ['computer', { action: 'left_click', coordinate: [10, 10] }],
    ['desktop_app', { action: 'open_app', app: 'chrome' }],
    ['grep', { pattern: 'password', path: 'src' }],
    ['list_dir', { path: '.' }],
    ['glob', { pattern: 'src/**/*.ts' }],
    ['web_search', { query: 'electron ipc' }],
    ['web_fetch', { url: 'https://example.com' }],
    ['make_dir', { path: 'out' }],
    ['verify_file', { path: 'index.html' }],
    ['memory', { text: 'note' }],
    ['todo_write', { items: [] }],
    ['system_info', { what: 'os' }],
    ['list_processes', {}],
    ['read_process_output', { id: 'p1' }]
  ]
  for (const [name, args] of safe) assert.equal(isRisky(name, args).risky, false, `توقّع أمان: ${name}`)
})

test('الهدف المعروض هو الأمر أو المسار نفسه', () => {
  assert.equal(describeTarget('run_command', { command: 'Remove-Item C:\\a -Recurse' }), 'Remove-Item C:\\a -Recurse')
  assert.match(describeTarget('publish_site', { dir: 'dist', repo: 'my-site' }), /my-site/)
  const cwd = workspace()
  try {
    assert.equal(describeTarget('delete_path', { path: 'sub\\file.txt' }, cwd), join(cwd, 'sub\\file.txt'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('الوضع full لا يسأل أبداً ولا يُرسل أي طلب', async () => {
  globalThis.__sent = []
  const calls = [
    ['delete_path', { path: 'C:\\proj' }],
    ['run_command', { command: 'Remove-Item C:\\ -Recurse -Force' }],
    ['publish_site', { dir: 'dist', repo: 'r' }],
    ['read_file', { path: '.env' }]
  ]
  for (const [toolName, args] of calls) {
    const r = await gateTool({ permissionMode: 'full', sessionId: 'sess', toolName, args })
    assert.equal(r, null)
  }
  assert.equal(globalThis.__sent.length, 0)
})

test('وضع غير معروف يُعامل كالافتراضي فيسأل', async () => {
  globalThis.__sent = []
  const promise = gateTool({ sessionId: 'sess', toolName: 'delete_path', args: { path: 'C:\\proj' } })
  await tick()
  assert.equal(globalThis.__sent.length, 1)
  answerApproval(globalThis.__sent[0].payload.requestId, false)
  assert.equal(await promise, DENIED)
})

test('الأداة الآمنة في وضع ask تُنفَّذ بلا سؤال', async () => {
  const { promise, requests } = startGate('read_file', { path: 'src/index.ts' })
  assert.equal(await promise, null)
  assert.equal(requests().length, 0)
})

test('الرفض يمنع التنفيذ ويُرجع نص الرفض', async () => {
  const { promise, requests } = startGate('delete_path', { path: 'C:\\proj\\src' })
  await tick()
  assert.equal(requests().length, 1)
  assert.equal(requests()[0].channel, 'permission:request')
  const req = requests()[0].payload
  assert.equal(req.tool, 'delete_path')
  assert.equal(req.sessionId, 'sess')
  assert.equal(req.danger, true)
  assert.match(req.target, /src/)
  assert.ok(req.reason.length > 0)
  answerApproval(req.requestId, false)
  assert.equal(await promise, DENIED)
})

test('الموافقة تُرجع null فيُنفَّذ الإجراء', async () => {
  const { promise, requests } = startGate('run_command', { command: 'Remove-Item C:\\temp -Recurse' })
  await tick()
  const req = requests()[0].payload
  assert.equal(req.danger, true)
  answerApproval(req.requestId, true)
  assert.equal(await promise, null)
})

test('قراءة ملف حساس طلبٌ غير مدمّر', async () => {
  const { promise, requests } = startGate('read_file', { path: '.env' })
  await tick()
  assert.equal(requests()[0].payload.danger, false)
  answerApproval(requests()[0].payload.requestId, true)
  assert.equal(await promise, null)
})

test('إيقاف الجلسة أثناء الانتظار رفضٌ تلقائي', async () => {
  const ac = new AbortController()
  const { promise, requests } = startGate('delete_path', { path: 'C:\\proj' }, { signal: ac.signal })
  await tick()
  assert.equal(requests().length, 1)
  ac.abort()
  assert.equal(await promise, DENIED)
})

test('إشارة موقوفة مسبقاً تُرفض فوراً بلا طلب', async () => {
  const ac = new AbortController()
  ac.abort()
  const { promise, requests } = startGate('delete_path', { path: 'C:\\proj' }, { signal: ac.signal })
  assert.equal(await promise, DENIED)
  assert.equal(requests().length, 0)
})

test('بلا نافذة حيّة يُرفض الطلب ولا يبقى معلقاً', async () => {
  globalThis.__win = null
  try {
    const { promise, requests } = startGate('delete_path', { path: 'C:\\proj' })
    assert.equal(await promise, DENIED)
    assert.equal(requests().length, 0)
  } finally {
    globalThis.__win = undefined
  }
})

test('ردّ على معرّف غير معروف لا يرمي', () => {
  assert.doesNotThrow(() => answerApproval('apv_missing', true))
})
