/**
 * يكتب ملف .cmd بترميز UTF-16LE مع BOM.
 *
 * السبب: cmd.exe يقرأ ملفات .cmd بترميز ANSI (CP1256) فيتحول النص العربي
 * إلى رموز，并在解析 السطور يفشل. أما UTF-16LE مع BOM فيقرأه cmd بشكل
 * صحيح تمامًا دون أي إعدادات إضافية.
 */
import fs from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('الاستخدام: node scripts/write-cmd.mjs <file.cmd> < source.cmd.txt')
  process.exit(1)
}

const source = process.argv[3]
if (!source) {
  console.error('يلزم ملف مصدر')
  process.exit(1)
}

const text = fs.readFileSync(source, 'utf8')
// BOM + UTF-16LE
const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
fs.writeFileSync(target, buf)
console.log(`wrote ${target} as UTF-16LE (${buf.length} bytes)`)