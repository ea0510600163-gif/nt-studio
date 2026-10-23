const NOT_FOUND_RE =
  /is not recognized as the name of a cmdlet|is not recognized as an internal or external command|command not found|not recognized as the name of a cmdlet/i

const UNIX_TOOLS_RE = /\b(tail|head|grep|egrep|fgrep|sed|awk|wc|xargs|cat|ls|cp|mv|rm|mkdir|touch|which)\b/g

export function commandNotFoundAdvice(command: string, output: string): string | null {
  if (!NOT_FOUND_RE.test(output)) return null
  const unix = [...new Set((command.match(UNIX_TOOLS_RE) ?? []).map((x) => x.toLowerCase()))]
  const steps = [
    'الأمر غير موجود في هذه البيئة — لا تُعِد إرسال الأمر نفسه أبداً.',
    '1) تحقّق من وجوده: Get-Command <name> -ErrorAction SilentlyContinue',
    '2) إن كانت أداة npm محلية فاستدعها بمسارها الكامل: node node_modules/<pkg>/bin/<cli> --version (تحقّق أوّلاً بـ npm ls --depth=0 <pkg>)',
    '3) إن لم تكن مثبّتة فأعد التثبيت صريحاً: npm install --include=dev <pkg> — ثم تحقّق بـ npm ls --depth=0 <pkg> قبل الاستخدام',
    '4) قبل استخدام أي أداة جديداً، اطبع نسختها (<bin> --version)؛ لا تفترض التثبيت من نجاح npm install وحده'
  ]
  if (unix.length)
    steps.push(
      `أمر يونكس غير مدعوم في PowerShell: ${unix.join(', ')} — البدائل: Select-Object -First/-Last بدل head/tail، Select-String بدل grep، Get-Content بدل cat، Get-ChildItem بدل ls. وتجنّب الأنابيب ما أمكن.`
    )
  return steps.join('\n')
}

const INSTALL_RE = /\b(npm\s+(install|i|ci)|pnpm\s+(install|i)|yarn(\s+install)?)\b/
const DEV_EXPLICIT_RE = /--include=dev|--production\s*=\s*false|--only=dev|--save-dev|NODE_ENV\s*=\s*"?development|--dev\b/

export function installNote(command: string): string | null {
  if (!INSTALL_RE.test(command) || DEV_EXPLICIT_RE.test(command)) return null
  return (
    'ملاحظة تثبيت: npm install قد يُسقط حزم التطوير بصمت (NODE_ENV=production أو npm config omit/production). ' +
    'قبل استخدام أي أداة من الحزم تحقّق: npm ls --depth=0 <pkg> أو <bin> --version؛ ' +
    'وإن كانت ناقصة أعد التثبيت بـ: npm install --include=dev.'
  )
}

const PS_PARSE_ERROR_RE =
  /TerminatorExpectedAtEndOfString|UnexpectedToken|MissingEndCurlyBrace|MissingEndParenthesisInMethodCall|ParserError|The string is missing the terminator|Missing closing '}'/i

export function powerShellParseAdvice(command: string, output: string): string | null {
  if (!PS_PARSE_ERROR_RE.test(String(output ?? ''))) return null
  const looksLikeWrite =
    /\b(set-content|add-content|out-file|new-item)\b|>\s*[^\s|]+\s*$|>>\s*[^\s|]+\s*$/i.test(String(command ?? ''))
  const lines = [
    'خطأ تحليل PowerShell (غالباً بسبب كتابة محتوى ملف داخل نص الأمر: علامات اقتباس/نقاط منقوطة تكسر الجملة).',
    'الحل المضمون — لا تكتب محتوى الملفات في سطر أوامر إطلاقاً:',
    '1) استخدم أداة write_file: { "path": "portfolio.html", "content": "<!DOCTYPE html>…" } — تكتب UTF-8 بدقة بلا أي تهريب.',
    '2) للتعديل لاحقاً استخدم edit_file، وللإلحاق write_file مع append=true.',
    '3) إن احتجت PowerShell فعلاً لنص متعدد الأسطر فاجعل النص في here-string: @" … "@ (سطران منفصلان حول المحتوى) — والنظام يشغّله في ملف سكربت UTF-8 آمن.'
  ]
  if (!looksLikeWrite) lines.push('وردت كلمة مثل text-align:center كأمر؟ هذا أثر التقطيع — طبّق الحل نفسه.')
  return lines.join('\n')
}

const NON_ASCII_RE = /[^\x00-\x7F]/

export function arabicPathAdvice(command: string): string | null {
  const cmd = String(command ?? '')
  if (!NON_ASCII_RE.test(cmd)) return null
  const mentionsPath =
    /\b(cd|set-location|push-location|get-childitem|get-content|set-content|out-file|copy-item|move-item|new-item)\b/i.test(cmd) ||
    (cmd.match(/["'][^"'\n]*[^\x00-\x7F][^"'\n]*["']/g)?.length ?? 0) > 0
  if (!mentionsPath) return null
  return (
    'ملاحظة مسار غير إنجليزي: لا تُدرج مسارات فيها عربي/رموز داخل نص الأمر (تُفسَّر بايتاتها بترميز خاطئ). ' +
    'استخدم معامل cwd للأمر، أو أدوات الملفات (read_file/list_dir/write_file) التي تتعامل مع المسار كنص Unicode كامل.'
  )
}
