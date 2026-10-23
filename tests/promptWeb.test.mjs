import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

/**
 * سطر البحث بالويب التعليمي: يصل كل الجلسات عبر الموجّهين (CORE و AGENT_CORE)
 * وعبر وصف الأداة نفسه الذي يرافق كل نداء نموذج.
 */
const ROOT = new URL('..', import.meta.url).href

const TYPE_ONLY = new Set(['Tool', 'ToolContext', 'ToolResult', 'Settings', 'ProjectInfo', 'ModelInfo', 'TodoItem', 'FileDiff', 'ImageData', 'Phase'])

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron')
      return {
        url: 'data:text/javascript,export const BrowserWindow={};export const WebContentsView={};export const shell={};export const session={};export const app={};export const safeStorage={};export const clipboard={};export const ipcMain={};export const dialog={};export const nativeImage={};export default {};',
        format: 'module',
        shortCircuit: true
      }
    let s = specifier
    if (s.startsWith('.') && !/\.(ts|mjs|js|json|cjs)$/.test(s)) s = new URL(s + '.ts', context.parentURL).href
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

const { CORE } = await import(ROOT + '/src/main/agent/prompt.ts')
const { AGENT_CORE } = await import(ROOT + '/src/main/agent/agentPrompt.ts')
const { webTools } = await import(ROOT + '/src/main/tools/web.ts')

const byName = Object.fromEntries(webTools.map((t) => [t.name, t]))

test('CORE يعلّم البحث بالويب: المحركان، صياغة الاستعلام، والنص الكامل عبر web_fetch', () => {
  assert.match(CORE, /Searching the web/)
  assert.match(CORE, /DuckDuckGo/)
  assert.match(CORE, /Bing/)
  assert.match(CORE, /entity \+ topic \+ version or year/)
  assert.match(CORE, /web_fetch/)
})

test('AGENT_CORE يعلّم البحث بالويب بنفس السطر', () => {
  assert.match(AGENT_CORE, /Searching the web/)
  assert.match(AGENT_CORE, /DuckDuckGo/)
  assert.match(AGENT_CORE, /Bing/)
  assert.match(AGENT_CORE, /entity \+ topic \+ version or year/)
  assert.match(AGENT_CORE, /web_fetch/)
})

test('وصف أداة web_search يشرح بنفسه كيف يُبحث ويُقرأ النص', () => {
  const d = byName.web_search.description
  assert.match(d, /DuckDuckGo/)
  assert.match(d, /Bing/)
  assert.match(d, /title, URL and snippet/)
  assert.match(d, /web_fetch/)
  assert.match(byName.web_search.schema.properties.query.description, /distinctive keywords/)
})

test('السطر بلا أوامر سلوكية: لا禁令 ولا أرقام جهاز مصلّبة', () => {
  const line = CORE.split('\n').find((l) => l.includes('Searching the web'))
  const agentLine = AGENT_CORE.split('\n').find((l) => l.includes('Searching the web'))
  assert.ok(line && agentLine)
  for (const l of [line, agentLine]) {
    assert.doesNotMatch(l, /never |always |must |do not |don't /i)
    assert.doesNotMatch(l, /1366|1024|768|720/)
  }
})
