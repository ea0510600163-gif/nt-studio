import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

/**
 * نفس نمط tests/toolValidation.test.mjs: تنحية electron (لا يعمل خارج
 * التطبيق) وحلّ الاستيرادات بلا لاحقة، ثم استيراد ديناميكي بعد الخطافات.
 */
const ROOT = new URL('..', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron')
      return {
        url: 'data:text/javascript,export const session={};export const app={};export default {};',
        format: 'module',
        shortCircuit: true
      }
    let s = specifier
    if (s.startsWith('.') && !/\.(ts|mjs|js|json|cjs)$/.test(s)) s = new URL(s + '.ts', context.parentURL).href
    return nextResolve(s, context)
  }
})

const { LOGIN_KEEP_SEC, hardenedCookieDetails, shouldHardenCookie } = await import(
  ROOT + '/src/main/preview/logins.ts'
)

const sessionCookie = {
  name: 'sid',
  value: 'abc',
  domain: '.x.com',
  path: '/',
  secure: true,
  httpOnly: true,
  hostOnly: false,
  sameSite: 'lax',
  session: true
}

test('كوكي جلسة بلا انتهاء ⇒ تُثبَّت', () => {
  assert.equal(shouldHardenCookie(sessionCookie, false), true)
})

test('حدث حذف ⇒ يُتجاهل', () => {
  assert.equal(shouldHardenCookie(sessionCookie, true), false)
})

test('كوكي دائمة أصلاً ⇒ تُتجاهل (منع الحلقة)', () => {
  assert.equal(
    shouldHardenCookie({ ...sessionCookie, session: false, expirationDate: 9999999999 }, false),
    false
  )
})

test('session=false بلا انتهاء (حالة شاذة) ⇒ تُثبَّت', () => {
  assert.equal(shouldHardenCookie({ ...sessionCookie, session: false }, false), true)
})

test('بناء الـ URL: https + تجريد النقطة البادئة', () => {
  const d = hardenedCookieDetails(sessionCookie, 1000)
  assert.equal(d.url, 'https://x.com/')
})

test('بناء الـ URL: http لغير الآمن', () => {
  const d = hardenedCookieDetails({ ...sessionCookie, secure: false, domain: 'a.com', path: '/p' }, 1000)
  assert.equal(d.url, 'http://a.com/p')
})

test('الانتهاء = الآن + سنة بالثواني', () => {
  const d = hardenedCookieDetails(sessionCookie, 1000)
  assert.equal(d.expirationDate, 1000 + LOGIN_KEEP_SEC)
})

test('hostOnly ⇒ بلا domain', () => {
  const d = hardenedCookieDetails({ ...sessionCookie, hostOnly: true }, 1000)
  assert.equal(d.domain, undefined)
})

test('غير hostOnly ⇒ يحتفظ بالنطاق الأصلي', () => {
  const d = hardenedCookieDetails(sessionCookie, 1000)
  assert.equal(d.domain, '.x.com')
})

test('الاسم والقيمة يُنسخان كما هما', () => {
  const d = hardenedCookieDetails(sessionCookie, 1000)
  assert.equal(d.name, 'sid')
  assert.equal(d.value, 'abc')
})
