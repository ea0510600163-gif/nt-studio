import type { ReactNode } from 'react'

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:[^)\s]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (m[1]) out.push(<code key={`${keyBase}c${k++}`}>{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={`${keyBase}b${k++}`}>{t.slice(2, -2)}</strong>)
    else out.push(<a key={`${keyBase}a${k++}`} href={m[4]} target="_blank" rel="noreferrer">{t.slice(1, t.indexOf(']'))}</a>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Md({ text, rtl }: { text: string; rtl?: boolean }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  const dir = rtl ? 'rtl' : 'auto'
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++
      blocks.push(<pre key={key++}><code>{buf.join('\n')}</code></pre>)
    } else if (/^#{1,3}\s/.test(line)) {
      const lvl = line.match(/^#+/)![0].length
      const Tag = (`h${lvl}`) as 'h1' | 'h2' | 'h3'
      blocks.push(<Tag key={key++} dir={dir}>{inline(line.replace(/^#+\s/, ''), `h${key}`)}</Tag>)
      i++
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s/.test(line)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(<li key={items.length} dir={dir}>{inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `l${key}${items.length}`)}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>)
    } else if (!line.trim()) i++
    else {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim() && !/^```|^#{1,3}\s|^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) buf.push(lines[i++])
      blocks.push(
        <p key={key++} dir={dir}>
          {inline(buf.join(' '), `p${key}`)}
        </p>
      )
    }
  }
  return <div className="prose-nt">{blocks}</div>
}
