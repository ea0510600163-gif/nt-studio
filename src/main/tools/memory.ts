import { NOTE_KINDS, type NoteKind } from '../agent/agentMemory'
import { forgetNote, recallNotes, rememberNote } from '../agent/agentNotes'
import { Tool, fail, ok, schema } from './types'

const KIND_LABEL: Record<NoteKind, string> = { user: 'المستخدم', machine: 'الجهاز', lesson: 'درس' }

export const memoryTools: Tool[] = [
  {
    name: 'memory',
    parallel: true,
    description:
      'Your permanent long-term memory (survives restarts and new sessions; the saved notes are shown to you in the LONG-TERM MEMORY section of the system prompt). ' +
      'action="remember": save one short, concrete fact (kind: "user" = user preferences/facts, "machine" = where things are on this PC and how apps behave, "lesson" = a trick that worked or a mistake to avoid). ' +
      'pinned=true only for what must never be forgotten. action="recall": search notes by keywords (empty query = most recent). action="forget": delete a note by id (e.g. "n3") or by a distinctive part of its text. action="list": show recent notes.',
    schema: schema(
      {
        action: { type: 'string', enum: ['remember', 'recall', 'forget', 'list'], description: 'Memory operation' },
        text: { type: 'string', description: 'For remember: the note text (one fact, under ~300 chars, in the user language)' },
        kind: { type: 'string', enum: ['user', 'machine', 'lesson'], description: 'For remember: note category (default "lesson")' },
        pinned: { type: 'boolean', description: 'For remember: keep this note permanently visible and never auto-delete it' },
        query: { type: 'string', description: 'For recall: keywords. For forget: note id or distinctive text' }
      },
      ['action']
    ),
    async run(i) {
      const act = String(i.action)
      if (act === 'remember') {
        const text = String(i.text ?? '').trim()
        if (!text) return fail('حدّد text: الملاحظة التي تريد حفظها.')
        const kind = NOTE_KINDS.includes(i.kind) ? (i.kind as NoteKind) : 'lesson'
        const r = rememberNote(kind, text, !!i.pinned)
        if (!r) return fail('تعذّر حفظ الملاحظة (نص فارغ).')
        return ok(`${r.status === 'added' ? 'حُفظت' : 'حُدّثت'} الملاحظة [${r.note.id}|${KIND_LABEL[r.note.kind]}]${r.note.pinned ? ' (مثبّتة)' : ''}.`)
      }
      if (act === 'recall' || act === 'list') {
        const notes = recallNotes(act === 'list' ? '' : String(i.query ?? ''), act === 'list' ? 25 : 15)
        if (!notes.length) return ok('لا توجد ملاحظات مطابقة.')
        return ok(notes.map((n) => `[${n.id}|${KIND_LABEL[n.kind]}${n.pinned ? '|مثبّتة' : ''}] ${n.text}`).join('\n'))
      }
      if (act === 'forget') {
        const q = String(i.query ?? '').trim()
        if (!q) return fail('حدّد query: معرّف الملاحظة أو جزء مميّز من نصها.')
        const n = forgetNote(q)
        return n ? ok(`حُذفت ${n} ملاحظة.`) : ok('لم تُطابق أي ملاحظة — استخدم list لرؤية المعرّفات.')
      }
      return fail(`إجراء غير معروف: ${act}`)
    }
  }
]
