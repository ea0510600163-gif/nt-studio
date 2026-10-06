// فحص سلامة الترميز: بايتات NUL + mojibake + محارف صينية داخل شيفرة المصدر.
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['src', 'tests']
const EXT = /\.(ts|tsx|css|html|json|yml|md)$/

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (EXT.test(entry.name)) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(r, []))
let issues = 0

for (const file of files) {
  const buf = fs.readFileSync(file)
  const problems = []

  if (buf.includes(0)) problems.push('NUL byte')
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) problems.push('BOM')

  const text = buf.toString('utf8')
  if (text.includes('\uFFFD')) problems.push('replacement char (U+FFFD)')
  if (/[\u4e00-\u9fff]/.test(text)) problems.push('CJK chars')
  if (/[\u00c2\u00c3][\u0080-\u00bf]/.test(text)) problems.push('double-encoded utf8')

  if (problems.length > 0) {
    issues++
    console.log(`${file}\n  - ${problems.join('\n  - ')}`)
  }
}

console.log(
  issues === 0
    ? `CLEAN - ${files.length} file(s) checked, 0 issues`
    : `FOUND ${issues} file(s) with issues`,
)
process.exit(issues === 0 ? 0 : 1)