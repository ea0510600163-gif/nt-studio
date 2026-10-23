import { db } from '../store/db'
import {
  addJournal,
  addNote,
  forgetNotes,
  normalizeStore,
  renderLongTerm,
  searchNotes,
  setApp,
  type AddNoteResult,
  type LongTermStore,
  type Note,
  type NoteKind
} from './agentMemory'

const KEY = 'agentLongTerm'
let cache: LongTermStore | null = null

function load(): LongTermStore {
  if (!cache) {
    let raw: unknown
    try {
      raw = db().get<unknown>('kv', KEY)
    } catch {
      raw = null
    }
    cache = normalizeStore(raw)
  }
  return cache
}

function persist(): void {
  try {
    db().put('kv', KEY, load())
  } catch {}
}

export function rememberNote(kind: NoteKind, text: string, pinned = false): AddNoteResult | null {
  const r = addNote(load(), { kind, text, pinned })
  if (r) persist()
  return r
}

export function forgetNote(query: string): number {
  const n = forgetNotes(load(), query)
  if (n) persist()
  return n
}

export function recallNotes(query: string, limit = 15): Note[] {
  const r = searchNotes(load(), query, limit)
  if (r.length) persist()
  return r
}

export function longTermSection(): string {
  return renderLongTerm(load())
}

export function recordTaskOutcome(goal: string, result: string, files: string[] = []): void {
  addJournal(load(), goal, result, files)
  persist()
}

export function learnApp(name: string, target: string): void {
  const s = load()
  const k = String(name ?? '').trim().toLowerCase()
  if (!k || s.apps[k] === target) return
  setApp(s, name, target)
  persist()
}

export function learnedApp(name: string): string | null {
  return load().apps[String(name ?? '').trim().toLowerCase()] ?? null
}
