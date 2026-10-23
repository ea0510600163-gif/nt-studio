import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from '../logger'

export interface Db {
  kind: 'sqlite' | 'json'
  get<T>(coll: string, id: string): T | undefined
  put(coll: string, id: string, val: unknown): void
  del(coll: string, id: string): void
  all<T>(coll: string): T[]
  msgs<T>(sessionId: string): T[]
  msgAppend(sessionId: string, items: unknown[]): void
  msgReplace(sessionId: string, items: unknown[]): void
  msgDelete(sessionId: string): void
  flushNow(): void
}

class SqliteDb implements Db {
  kind = 'sqlite' as const
  private d: any
  private cache = new Map<string, any>()
  constructor(file: string, Database: any) {
    this.d = new Database(file)
    this.d.pragma('journal_mode = WAL')
    this.d.pragma('synchronous = NORMAL')
    this.d.exec(`
      CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (coll, id));
      CREATE TABLE IF NOT EXISTS messages (session_id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (session_id, seq));
    `)
  }
  stmt(sql: string) {
    let s = this.cache.get(sql)
    if (!s) this.cache.set(sql, (s = this.d.prepare(sql)))
    return s
  }
  get<T>(coll: string, id: string) {
    const r = this.stmt('SELECT json FROM docs WHERE coll=? AND id=?').get(coll, id)
    return r ? (JSON.parse(r.json) as T) : undefined
  }
  put(coll: string, id: string, val: unknown) {
    this.stmt('INSERT INTO docs(coll,id,json) VALUES(?,?,?) ON CONFLICT(coll,id) DO UPDATE SET json=excluded.json').run(coll, id, JSON.stringify(val))
  }
  del(coll: string, id: string) {
    this.stmt('DELETE FROM docs WHERE coll=? AND id=?').run(coll, id)
  }
  all<T>(coll: string) {
    return this.stmt('SELECT json FROM docs WHERE coll=? ORDER BY rowid').all(coll).map((r: any) => JSON.parse(r.json) as T)
  }
  msgs<T>(sid: string) {
    return this.stmt('SELECT json FROM messages WHERE session_id=? ORDER BY seq').all(sid).map((r: any) => JSON.parse(r.json) as T)
  }
  msgAppend(sid: string, items: unknown[]) {
    if (!items.length) return
    const max = this.stmt('SELECT COALESCE(MAX(seq),-1) AS m FROM messages WHERE session_id=?').get(sid).m as number
    const ins = this.stmt('INSERT INTO messages(session_id,seq,json) VALUES(?,?,?)')
    this.d.transaction(() => items.forEach((m, i) => ins.run(sid, max + 1 + i, JSON.stringify(m))))()
  }
  msgReplace(sid: string, items: unknown[]) {
    const ins = this.stmt('INSERT INTO messages(session_id,seq,json) VALUES(?,?,?)')
    this.d.transaction(() => {
      this.stmt('DELETE FROM messages WHERE session_id=?').run(sid)
      items.forEach((m, i) => ins.run(sid, i, JSON.stringify(m)))
    })()
  }
  msgDelete(sid: string) {
    this.stmt('DELETE FROM messages WHERE session_id=?').run(sid)
  }
  flushNow() {}
}

class JsonDb implements Db {
  kind = 'json' as const
  private data: { docs: Record<string, Record<string, unknown>>; msgs: Record<string, unknown[]> } = { docs: {}, msgs: {} }
  private timer: NodeJS.Timeout | null = null
  private file: string
  constructor(file: string) {
    this.file = file
    try {
      if (existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      log.error('تعذّر قراءة ملف البيانات، سيبدأ فارغاً', String(e))
    }
  }
  private flush() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.write()
    }, 250)
  }
  private write() {
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(this.data))
      renameSync(this.file + '.tmp', this.file)
    } catch (e) {
      log.error('فشل حفظ ملف البيانات', String(e))
    }
  }
  flushNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.write()
  }
  get<T>(c: string, id: string) {
    return this.data.docs[c]?.[id] as T | undefined
  }
  put(c: string, id: string, v: unknown) {
    ;(this.data.docs[c] ??= {})[id] = v
    this.flush()
  }
  del(c: string, id: string) {
    delete this.data.docs[c]?.[id]
    this.flush()
  }
  all<T>(c: string) {
    return Object.values(this.data.docs[c] ?? {}) as T[]
  }
  msgs<T>(sid: string) {
    return (this.data.msgs[sid] ?? []) as T[]
  }
  msgAppend(sid: string, items: unknown[]) {
    ;(this.data.msgs[sid] ??= []).push(...items)
    this.flush()
  }
  msgReplace(sid: string, items: unknown[]) {
    this.data.msgs[sid] = [...items]
    this.flush()
  }
  msgDelete(sid: string) {
    delete this.data.msgs[sid]
    this.flush()
  }
}

let instance: Db | null = null
export function db(): Db {
  if (instance) return instance
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  try {
    const Database = require('better-sqlite3')
    instance = new SqliteDb(join(dir, 'nt-studio.db'), Database)
  } catch (e) {
    log.warn('better-sqlite3 غير متاح، سيُستخدم ملف JSON بدلاً منه', String(e))
    instance = new JsonDb(join(dir, 'nt-studio.json'))
  }
  log.info(`قاعدة البيانات: ${instance.kind}`)
  return instance
}

export function flushOnQuit() {
  instance?.flushNow()
}
