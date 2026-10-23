import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as P from '../src/main/publish/pages.ts'

test('pagesUrl يبني رابط GitHub Pages بحروف صغيرة', () => {
  assert.equal(P.pagesUrl('MyUser', 'site'), 'https://myuser.github.io/site/')
})

test('validateRepoName يقبل الأسماء الصالحة ويرفض غيرها', () => {
  assert.equal(P.validateRepoName('my-site.v2'), 'my-site.v2')
  assert.throws(() => P.validateRepoName('my site'))
  assert.throws(() => P.validateRepoName('../x'))
})

test('listSiteFiles يتجاهل node_modules ويعيد المسارات بشرطات مائلة', () => {
  const root = mkdtempSync(join(tmpdir(), 'site-'))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'node_modules', 'x.js'), '')
  mkdirSync(join(root, 'css'))
  writeFileSync(join(root, 'index.html'), '<h1>hi</h1>')
  writeFileSync(join(root, 'css', 'a.css'), 'body{}')
  const paths = P.listSiteFiles(root).map((f) => f.path).sort()
  assert.deepEqual(paths, ['css/a.css', 'index.html'])
})

test('listSiteFiles يرفض مجلداً بلا index.html', () => {
  const root = mkdtempSync(join(tmpdir(), 'site-'))
  writeFileSync(join(root, 'a.txt'), 'x')
  assert.throws(() => P.listSiteFiles(root), /index\.html/)
})
