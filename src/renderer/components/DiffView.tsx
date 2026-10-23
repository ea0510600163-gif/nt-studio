import { useMemo } from 'react'
import { diffLines } from '@shared/diff'
import type { FileDiff } from '@shared/types'

const KIND_LABEL: Record<FileDiff['kind'], string> = {
  create: 'أُنشئ',
  modify: 'عُدّل',
  append: 'أُلحق',
  delete: 'حُذف'
}

export default function DiffView({ diff }: { diff: FileDiff }) {
  const lines = useMemo(() => diffLines(diff.before, diff.after), [diff])
  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-hair bg-bg" dir="ltr">
      <div className="flex items-center gap-2 border-b border-hair px-3 py-1.5 text-[11.5px]">
        <span className="font-medium text-mute">{KIND_LABEL[diff.kind]}</span>
        <span className="mono min-w-0 flex-1 truncate text-faint" style={{ unicodeBidi: 'plaintext' }}>{diff.path}</span>
        <span className="num shrink-0 text-jade">+{diff.added}</span>
        <span className="num shrink-0 text-coral">−{diff.removed}</span>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <tbody>
            {lines.map((l, n) => (
              <tr key={n} className={l.kind === 'add' ? 'diff-add' : l.kind === 'del' ? 'diff-del' : undefined}>
                <td className="num diff-no w-10 select-none px-2 text-end align-top">{l.oldNo ?? ''}</td>
                <td className="num diff-no w-10 select-none px-2 text-end align-top">{l.newNo ?? ''}</td>
                <td className="diff-code whitespace-pre px-2 align-top">{l.text || ' '}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
