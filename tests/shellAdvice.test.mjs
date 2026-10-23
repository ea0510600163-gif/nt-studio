import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandNotFoundAdvice, installNote } from '../src/main/tools/shellAdvice.ts'

/**
 * تشخيص فشل «الأمر غير موجود» — الانحدار من سجل حقيقي (مشروع grocery-accounting):
 *
 * 1) `npm install ... 2>&1 | tail -5` فشل: PowerShell لا يعرف tail (أداة يونكس).
 * 2) `npx tsc --noEmit` ثم `./node_modules/.bin/tsc` ثم `node .../tsc` — ثلاث
 *    نداءات فاشلة متطابقة لأن typescript لم تُثبَّت (npm أسقط حزم dev).
 * 3) أوامر `dir node_modules/@types` المتكررة بلا نتيجة جديدة.
 *
 * الرفض الصامت كان يُنتج إعادة النداء نفسه حرفياً؛ النصّ الجديد خطواتٌ قابلة
 * للتنفيذ: تحقّق Get-Command ⇒ بدّل المسار ⇒ ثبّت صريحاً ⇒ تحقّق --version.
 */

const NOT_RECOGNIZED = `The term 'tail' is not recognized as the name of a cmdlet, function, script file, or operable program.
Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`

test('فشل أداة يونكس في PowerShell: الرفض يذكر البدائل', () => {
  const advice = commandNotFoundAdvice('npm install --no-audit --no-fund 2>&1 | tail -5', NOT_RECOGNIZED)
  assert.ok(advice)
  assert.match(advice, /أمر يونكس غير مدعوم/)
  assert.match(advice, /tail/)
  assert.match(advice, /Select-Object/)
})

test('فشل tsc المفقود: الرفض يذكر التحقق والمسار الكامل و npm ls', () => {
  const advice = commandNotFoundAdvice(
    'npx tsc --noEmit',
    `'tsc' is not recognized as the name of a cmdlet, function, script file, or operable program.`
  )
  assert.ok(advice)
  assert.match(advice, /Get-Command/)
  assert.match(advice, /node_modules\/<pkg>\/bin\/<cli>/)
  assert.match(advice, /--include=dev/)
  assert.match(advice, /npm ls --depth=0/)
})

test('فشل عادي (exit code ≠ 0) بلا «غير موجود» ⇒ لا نصّ تشخيص (لا ضجيج)', () => {
  assert.equal(commandNotFoundAdvice('npm test', 'exit code: 1\n3 failing\n'), null)
  assert.equal(commandNotFoundAdvice('git status', 'fatal: not a git repository\n'), null)
})

test('نمط bash أيضاً: command not found', () => {
  const advice = commandNotFoundAdvice('tail -n 5 log', 'tail: command not found')
  assert.ok(advice)
  assert.match(advice, /tail/)
})

test('خطأ typescript حقيقي ليس «أمر غير موجود»', () => {
  // فشل حقيقي بمعنى آخر: لا تُضف خطوات تثبيت تُربك الموديل
  assert.equal(commandNotFoundAdvice('node node_modules/typescript/bin/tsc --noEmit', 'error TS2307: Cannot find module react'), null)
})

test('أدوات يونكس متعددة في أمر واحد تُذكر كلها', () => {
  const advice = commandNotFoundAdvice('cat file | grep x | wc -l', NOT_RECOGNIZED)
  assert.ok(advice)
  for (const t of ['cat', 'grep', 'wc']) assert.ok(advice.includes(t), `expected ${t}`)
})

test('الرفض يمنع إعادة الأمر نفسه صراحة', () => {
  const advice = commandNotFoundAdvice('tsc --noEmit', NOT_RECOGNIZED)
  assert.ok(advice)
  assert.match(advice, /لا تُعِد إرسال الأمر نفسه/)
})

test('نصّ فارغ أو أمر ناجح: بلا نصّ تشخيص', () => {
  assert.equal(commandNotFoundAdvice('npm install', ''), null)
})

/* ───────────── تذكير التثبيت: حزم dev قد تُسقط بصمت ───────────── */

test('npm install ناجح بلا dev صريح ⇒ تذكير مُلحق', () => {
  const note = installNote('npm install --no-audit --no-fund')
  assert.ok(note)
  assert.match(note, /--include=dev/)
  assert.match(note, /npm ls --depth=0/)
})

test('npm ci / pnpm install / yarn أيضاً', () => {
  assert.ok(installNote('npm ci'))
  assert.ok(installNote('pnpm install'))
  assert.ok(installNote('yarn'))
})

test('عند طلب dev صراحةً أو تثبيت حزمة dev ⇒ لا تذكير (لا ضجيج)', () => {
  assert.equal(installNote('npm install --include=dev typescript'), null)
  assert.equal(installNote('npm i --save-dev vite'), null)
  assert.equal(installNote('$env:NODE_ENV="development"; npm install'), null)
})

test('أوامر غير التثبيت ⇒ لا تذكير', () => {
  assert.equal(installNote('npm test'), null)
  assert.equal(installNote('node -v'), null)
})
