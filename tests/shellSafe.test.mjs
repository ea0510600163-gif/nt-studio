import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildShellPlan, decodeConsoleText, needsScriptFile, runShell, scriptPrelude } from '../src/main/tools/psScript.ts'
import { arabicPathAdvice, powerShellParseAdvice } from '../src/main/tools/shellAdvice.ts'
import { APPS_PS_COMMAND, parseInstalledApps } from '../src/main/env/installedApps.ts'

/**
 * المشكلة 2: «إنشاء portfolio.html بعربي وstyle كسر الأمر — TerminatorExpectedAtEndOfString
 * واعتبر text-align:center أمراً».
 * السبب الجذري: تمرير الأمر كوسيط `-Command` واحد، فتُهَّرب علامات الاقتباس بقواعد
 * CRT لا بقواعد PowerShell. الحل: ملف .ps1 مؤقت UTF-8+BOM وتشغيله بـ -File.
 *
 * المشكلة 3: «العربية ??? و mojibake في run_command و Get-ChildItem لمجلد دخل-اليوم-الواحد».
 * السبب: ترميزات الكونسول غير موحّدة (chcp/Input/Output/PSDefaultParameterValues).
 * الحل: ديباجة ترميز واحدة + فكّ يجرّب windows-1256 قبل فقدان العربية.
 *
 * المشكلة 4: «Get-CimInstance Win32_Product تجمّد > 30 ثانية».
 * الحل: رفض مسبق بأمر الريجستري السريع + system_info apps بمهلة 20ث.
 */

const WIN = process.platform === 'win32'
/** الوضع السريع (verify --quick): تتخطى الفحوص التي تُشغّل PowerShell/الريجستري الحقيقي */
const QUICK = process.env.NT_VERIFY_QUICK === '1'

/* ───────────── 1) قرار "ملف سكربت" ───────────── */

test('أمر بسيط ASCII ⇒ -Command بلا ملف', () => {
  assert.equal(needsScriptFile('Get-Date'), false)
  const plan = buildShellPlan('Get-Date')
  assert.equal(plan.usedScriptFile, false)
})

test('أمر فيه عربي/اقتباسات/أسطر متعددة/here-string ⇒ ملف سكربت UTF-8 (سبب كسر portfolio.html سابقاً)', () => {
  assert.equal(needsScriptFile('<div style="text-align:center">مرحباً</div>'), true)
  assert.equal(needsScriptFile('Set-Content -Path a.html -Value "<p>hi</p>"'), true)
  assert.equal(needsScriptFile('$a = 1\n$a'), true)
  assert.equal(needsScriptFile('$html = @"\n<body>مرحبا</body>\n"@'), true)
})

test('ديباجة الترميز تتضمن chcp 65001 و OutputEncoding و PSDefaultParameterValues و PYTHONUTF8', () => {
  const p = scriptPrelude()
  assert.match(p, /chcp\.com 65001/)
  assert.match(p, /\[Console\]::OutputEncoding/)
  assert.match(p, /\[Console\]::InputEncoding/)
  assert.match(p, /PSDefaultParameterValues/)
  assert.match(p, /PYTHONUTF8/)
  assert.match(p, /PYTHONIOENCODING/)
})

test('الخطة البسيطة على ويندوز: -Command؛ وذات العربية: -File + تنظيف الملف المؤقت', () => {
  if (!WIN) return
  const simple = buildShellPlan('Write-Output hello')
  assert.equal(simple.usedScriptFile, false)

  const arabic = buildShellPlan('Write-Output "مرحباً"')
  assert.equal(arabic.usedScriptFile, true)
  const fileIdx = arabic.args.indexOf('-File') + 1
  assert.ok(fileIdx > 0)
  const scriptPath = arabic.args[fileIdx]
  assert.ok(existsSync(scriptPath), 'ملف السكربت يجب أن يكون موجوداً أثناء التنفيذ')
  assert.ok(readFileSync(scriptPath, 'utf8').startsWith('\uFEFF'), 'BOM مطلوب لعربية Windows PowerShell 5.1')
  arabic.cleanup?.()
  assert.equal(existsSync(scriptPath), false, 'يُحذف الملف المؤقت بعد الانتهاء')
})

/* ───────────── 2) فكّ الترميز ───────────── */

test('فكّ UTF-8 السليم يمرّ كما هو', () => {
  const text = 'مرحباً بالعالم'
  assert.equal(decodeConsoleText(Buffer.from(text, 'utf8')), text)
})

test('بايتات windows-1256 (mojibake) تُفكّ للعربية بدل U+FFFD', () => {
  // "مرحبا" بترميز windows-1256
  const cp1256 = Buffer.from([0xe3, 0xd1, 0xcd, 0xc8, 0xc7])
  const decoded = decodeConsoleText(cp1256)
  assert.equal(decoded.includes('\uFFFD'), false)
  assert.equal(decoded, 'مرحبا')
})

/* ───────────── 3) تشخيص أخطاء كتابة الملفات وعربي المسارات ───────────── */

test('خطأ TerminatorExpectedAtEndOfString ⇒ توجيه حاسم إلى write_file', () => {
  const advice = powerShellParseAdvice(
    'Set-Content -Path portfolio.html -Value "<style>body { text-align:center; }</style>"',
    'ParserError: TerminatorExpectedAtEndOfString'
  )
  assert.ok(advice)
  assert.match(advice, /write_file/)
  assert.match(advice, /edit_file/)
})

test('«text-align:center صار أمراً» (أمر ليس كتابة ملف) ⇒ التفسير الصريح يُذكر', () => {
  const advice = powerShellParseAdvice('text-align: center', 'ParserError: UnexpectedToken')
  assert.ok(advice)
  assert.match(advice, /text-align/)
})

test('خطأ عادي بلا نمط تحليل ⇒ لا نص ضجيج', () => {
  assert.equal(powerShellParseAdvice('npm test', 'exit code: 1\nfailing'), null)
})

test('مسار عربي داخل نص الأمر ⇒ تنبيه باستخدام cwd/أدوات الملفات', () => {
  const advice = arabicPathAdvice('cd "مجلد دخل-اليوم-الواحد"; Get-ChildItem')
  assert.ok(advice)
  assert.match(advice, /cwd/)
  assert.equal(arabicPathAdvice('cd src; npm test'), null)
})

test('محلّل قائمة البرامج: تنظيف + نزع تكرار بالاسم', () => {
  const items = parseInstalledApps('Google Chrome | 130.0 | Google\n\nGoogle Chrome | 131.0 | Google\nVLC media player | 3.0 | VideoLAN\n')
  assert.equal(items.length, 2)
  assert.match(items[0], /Google Chrome/)
  assert.match(items[1], /VLC/)
})

/* ───────────── 5) اختبار حي: الدورة الكاملة عربي + HTML + اقتباسات + Get-ChildItem ───────────── */

test('حي: إنشاء portfolio.html عربي مع CSS واقتباسات ونقطتين منقوطتين ينجح كاملاً (لا TerminatorExpected)', { skip: !WIN || QUICK }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nt-shell-safe-'))
  try {
    // نفس شكل الأمر الذي كان يكسر: here-string + عربي + "text-align: center;" + اقتباسات
    const cmd = [
      '$html = @"',
      '<!DOCTYPE html>',
      '<html lang="ar" dir="rtl"><head><meta charset="utf-8">',
      '<style>body { text-align: center; color: #d9a45c; font-family: "Segoe UI"; }</style>',
      '</head><body><p>مرحباً — هذا موقعي الشخصي</p></body></html>',
      '"@',
      "Set-Content -Path 'portfolio.html' -Value $html -Encoding utf8",
      'Write-Output "OK"'
    ].join('\n')
    const r = await runShell(cmd, { cwd: dir, timeoutMs: 30000 })
    assert.equal(r.code, 0, `stderr: ${r.stderr}`)
    assert.equal(r.usedScriptFile, true, 'كان يجب أن يُنفَّذ عبر ملف سكربت آمن')
    assert.match(r.stdout, /OK/)

    const html = readFileSync(join(dir, 'portfolio.html'), 'utf8')
    assert.match(html, /مرحباً — هذا موقعي الشخصي/)
    assert.match(html, /text-align: center;/)
    assert.match(html, /Segoe UI/)
    assert.equal(html.includes('???'), false, 'العربية يجب ألا تتحول ???')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('حي: Get-ChildItem لمجلد عربي (دخل-اليوم-الواحد) يعرض الاسم سليماً بلا ??? أو mojibake', { skip: !WIN || QUICK }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nt-arabic-'))
  const arabicName = 'دخل-اليوم-الواحد'
  try {
    mkdirSync(join(dir, arabicName))
    const r = await runShell('Get-ChildItem -Name', { cwd: dir, timeoutMs: 20000 })
    assert.equal(r.code, 0, `stderr: ${r.stderr}`)
    assert.ok(r.stdout.includes(arabicName), `المخرجات: ${JSON.stringify(r.stdout)}`)
    assert.equal(r.stdout.includes('???'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('حي: فحص البرامج المثبّتة عبر الريجستري ينتهي خلال المهلة (لو كان Win32_Product لتجمّد)', { skip: !WIN || QUICK }, async () => {
  const t0 = Date.now()
  const r = await runShell(APPS_PS_COMMAND, { timeoutMs: 20000 })
  const ms = Date.now() - t0
  assert.ok(ms < 22000, `استغرق ${ms}ms`)
  const items = parseInstalledApps(r.stdout)
  // على ويندوز حقيقي: قائمة غير فارغة. لو تعذّر (بيئة معزولة) نكتفي بأنه لم يتجمد وبلا انهيار
  assert.ok(Array.isArray(items))
  if (items.length) assert.match(items[0], /\|/, 'سطر متوقع: الاسم | الإصدار | الناشر')
})
