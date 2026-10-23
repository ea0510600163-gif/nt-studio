import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const ROOT = new URL('..', import.meta.url).href

const TYPE_ONLY = new Set(['Tool', 'ToolContext', 'ToolResult', 'Settings', 'ProjectInfo', 'ModelInfo', 'TodoItem', 'FileDiff', 'ImageData', 'Phase'])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron')
      return {
        url: 'data:text/javascript,export const BrowserWindow={};export const WebContentsView={};export const shell={};export const session={};export const app={};export default {};',
        format: 'module',
        shortCircuit: true
      }
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

const { uploadTools } = await import(ROOT + '/src/main/tools/upload.ts')

const tool = uploadTools.find((t) => t.name === 'browser_upload')
const ctx = () => ({ signal: AbortSignal.timeout(5000), cwd: () => process.cwd(), settings: () => ({}) })

test('browser_upload مسجلة: paths مطلوب، تسلسلية، طور acting', () => {
  assert.ok(tool, 'browser_upload موجودة')
  assert.deepEqual(tool.schema.required, ['paths'])
  assert.equal(!!tool.parallel, false)
  assert.equal(tool.phase, 'acting')
})

test('مسار فارغ ⇒ فشل صريح', async () => {
  const r = await tool.run({ paths: '   ' }, ctx())
  assert.equal(r.isError, true)
})

test('ملف غير موجود ⇒ فشل يسمّي المسار', async () => {
  const r = await tool.run({ paths: 'Z:/nope/nothing.png' }, ctx())
  assert.equal(r.isError, true)
  assert.match(r.content, /غير موجود/)
})

test('ملف عادي بلا محدد ⇒ فشل يطلب ref/selector/text', async () => {
  const r = await tool.run({ paths: import.meta.filename }, ctx())
  assert.equal(r.isError, true)
  assert.match(r.content, /ref أو selector أو text/)
})
