import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWebTarget } from '../src/main/util/webUrl.ts'

test('https جاهز يبقى كما هو', () => {
  assert.equal(normalizeWebTarget('https://example.com/a?b=1'), 'https://example.com/a?b=1')
})

test('http جاهز يبقى كما هو', () => {
  assert.equal(normalizeWebTarget('http://localhost:3000/x'), 'http://localhost:3000/x')
})

test('مسافات زائدة تُزال', () => {
  assert.equal(normalizeWebTarget('   https://example.com   '), 'https://example.com/')
})

test('localhost بلا مخطط → http', () => {
  assert.equal(normalizeWebTarget('localhost:3000'), 'http://localhost:3000')
})

test('localhost مع مسار → http', () => {
  assert.equal(normalizeWebTarget('127.0.0.1:8080/app'), 'http://127.0.0.1:8080/app')
})

test('نطاق عارٍ → https', () => {
  assert.equal(normalizeWebTarget('example.com'), 'https://example.com')
})

test('نطاق عارٍ مع مسار → https', () => {
  assert.equal(normalizeWebTarget('example.com/path?q=1'), 'https://example.com/path?q=1')
})

test('عبارة عربية → بحث Google مشفّر', () => {
  assert.equal(
    normalizeWebTarget('ما هو الطقس اليوم'),
    'https://www.google.com/search?q=' + encodeURIComponent('ما هو الطقس اليوم')
  )
})

test('عبارة مختلطة عربي/إنجليزي → بحث', () => {
  assert.equal(
    normalizeWebTarget('سعر iPhone 16 في السعودية'),
    'https://www.google.com/search?q=' + encodeURIComponent('سعر iPhone 16 في السعودية')
  )
})

test('كلمة إنجليزية واحدة → بحث', () => {
  assert.equal(normalizeWebTarget('weather'), 'https://www.google.com/search?q=weather')
})

test('نص فارغ → خطأ (لا بحث فارغ)', () => {
  assert.throws(() => normalizeWebTarget('   '), /فارغة/)
})

test('file: مرفوض', () => {
  assert.throws(() => normalizeWebTarget('file:///etc/passwd'), /مرفوض/)
})

test('javascript: مرفوض', () => {
  assert.throws(() => normalizeWebTarget('javascript:alert(1)'), /مرفوض/)
})

test('data: مرفوض', () => {
  assert.throws(() => normalizeWebTarget('data:text/html,<h1>x</h1>'), /مرفوض/)
})

test('blob: مرفوض', () => {
  assert.throws(() => normalizeWebTarget('blob:https://example.com/1'), /مرفوض/)
})
