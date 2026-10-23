import { createRequire } from 'node:module'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { normalizeStore, addNote, renderLongTerm, emptyStore } from '../src/main/agent/agentMemory.ts'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const DB = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'NT Studio', 'nt-studio.db')

const NOTES = [
  {
    kind: 'machine',
    pinned: true,
    text:
      'جهاز المستخدم: ويندوز بدقة 1366×768 و DPI 96 (بلا تحجيم). مجلد التنزيلات المستعمل فعلياً: D:\\NT. اختصارات قائمة ابدأ في C:\\ProgramData\\Microsoft\\Windows\\Start Menu.'
  },
  {
    kind: 'machine',
    pinned: false,
    text:
      'سرعات نماذج OpenCode Go على هذا الجهاز: muse-spark-1.3-contributor الأسرع (2–10ث/دور)، mimo-v2.5 أبطأ نحو 4× (5–34ث)، deepseek-v4.1-flash متوسط.'
  },
  {
    kind: 'user',
    pinned: true,
    text:
      'المستخدم يتكلم العربية ويفضّل العمل الاحترافي السريع، ويريد واجهات بهوية بصرية هندسية قوية (شبكات، أقواس زوايا CAD، توهج طيفي).'
  }
]

function readStore() {
  const db = new Database(DB)
  try {
    const row = db.prepare('SELECT json FROM docs WHERE coll=? AND id=?').get('kv', 'agentLongTerm')
    return row ? normalizeStore(JSON.parse(row.json)) : emptyStore()
  } finally {
    db.close()
  }
}

function writeStore(store) {
  const db = new Database(DB)
  try {
    db.prepare('INSERT INTO docs(coll,id,json) VALUES(?,?,?) ON CONFLICT(coll,id) DO UPDATE SET json=excluded.json').run(
      'kv',
      'agentLongTerm',
      JSON.stringify(store)
    )
  } finally {
    db.close()
  }
}

const write = process.argv.includes('--write')
const store = readStore()

if (write) {
  for (const n of NOTES) addNote(store, n)
  writeStore(store)
  console.log(`✅ حُفظت/دُمجت ${NOTES.length} ملاحظة وصفية في الذاكرة الدائمة.`)
} else {
  console.log(renderLongTerm(store, 20000))
}
