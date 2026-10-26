import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'fs'
import { dirname, extname, join, relative } from 'path'
import { send } from '../bus'
import { SKIP_DIRS, invalidateRepoMap, walkAsync } from '../workspace/projects'
import { clip, resolvePath } from '../util'
import { makeDiff } from '@shared/diff'
import { IMAGE_EXT, imageDimensions } from './imageMeta'
import { Tool, fail, ok, schema } from './types'

const changed = () => {
  invalidateRepoMap()
  send('fs:changed', Date.now())
}
const MAX_READ_BYTES = 16_000_000
const DIFF_READ_LIMIT = 200_000

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

function readForDiff(p: string): string | undefined {
  try {
    const st = statSync(p)
    if (!st.isFile() || st.size > DIFF_READ_LIMIT) return undefined
    return readFileSync(p, 'utf8')
  } catch {
    return undefined
  }
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export function globToRegex(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const j = glob.indexOf(']', i + 1)
      if (j > i + 1) {
        re += '[' + glob.slice(i + 1, j).replace(/\\/g, '\\\\') + ']'
        i = j
      } else re += '\\['
    } else if (c === '{') {
      const j = glob.indexOf('}', i)
      if (j > 0) { re += '(?:' + glob.slice(i + 1, j).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = j } else re += '\\{'
    } else re += /[.+^$()|[\]\\]/.test(c) ? '\\' + c : c
  }
  return new RegExp('^' + re + '$', 'i')
}

const rel = (base: string, p: string) => relative(base, p).replace(/\\/g, '/')

function stripLineGutter(s: string): string {
  const lines = s.split(/\r?\n/)
  const hasGutter = lines.some((l) => /^\s*\d+│\s?/.test(l))
  if (hasGutter) {
    return lines.map((l) => l.replace(/^\s*\d+│\s?/, '')).join('\n')
  }
  return s
}

function findTrimmedEndMatch(src: string, needle: string, eol: string): string | null {
  const srcLines = src.split(/\r?\n/)
  const nLines = needle.split(/\r?\n/).map((l) => l.trimEnd())
  if (!nLines.length || nLines.length > srcLines.length) return null
  const matches: string[] = []
  for (let i = 0; i <= srcLines.length - nLines.length; i++) {
    let ok = true
    for (let j = 0; j < nLines.length; j++) {
      if (srcLines[i + j].trimEnd() !== nLines[j]) {
        ok = false
        break
      }
    }
    if (ok) {
      matches.push(srcLines.slice(i, i + nLines.length).join(eol))
      if (matches.length > 1) return null
    }
  }
  if (matches.length === 1) return matches[0]

  const nTrimmed = needle.split(/\r?\n/).map((l) => l.trim())
  if (!nTrimmed.some(Boolean)) return null
  const indentMatches: string[] = []
  for (let i = 0; i <= srcLines.length - nTrimmed.length; i++) {
    let ok = true
    for (let j = 0; j < nTrimmed.length; j++) {
      if (srcLines[i + j].trim() !== nTrimmed[j]) {
        ok = false
        break
      }
    }
    if (ok) {
      indentMatches.push(srcLines.slice(i, i + nTrimmed.length).join(eol))
      if (indentMatches.length > 1) return null
    }
  }
  return indentMatches.length === 1 ? indentMatches[0] : null
}

function applyOneEdit(src: string, rawOld: string, rawNew: string, replaceAll: boolean, eol: string): { ok: true; next: string; count: number } | { ok: false; error: string } {
  const norm = (s: string) => s.replace(/\r?\n/g, eol)
  let oldS = norm(String(rawOld))
  let newS = norm(String(rawNew))
  if (!oldS) return { ok: false, error: 'old_str فارغ.' }

  let count = src.split(oldS).length - 1
  if (count === 0) {
    const strippedOld = norm(stripLineGutter(String(rawOld)))
    if (strippedOld !== oldS && src.includes(strippedOld)) {
      oldS = strippedOld
      newS = norm(stripLineGutter(String(rawNew)))
      count = src.split(oldS).length - 1
    }
  }
  if (count === 0 && !replaceAll) {
    const fuzzy = findTrimmedEndMatch(src, stripLineGutter(oldS), eol)
    if (fuzzy) {
      oldS = fuzzy
      newS = norm(stripLineGutter(String(rawNew)))
      count = 1
    }
  }

  if (count === 0) {
    const srcLines = src.split(/\r?\n/)
    const first = stripLineGutter(String(rawOld)).split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
    const at = first ? srcLines.findIndex((l) => l.includes(first)) : -1
    if (at >= 0) {
      const sLine = Math.max(0, at - 4)
      const eLine = Math.min(srcLines.length, at + 15)
      const snippet = srcLines.slice(sLine, eLine).map((l, k) => `${String(sLine + k + 1).padStart(5)}│ ${l}`).join('\n')
      return { ok: false, error: `old_str غير موجود حرفياً. أقرب تطابق للسطر الأول عند السطر ${at + 1}؛ إليك الأسطر المحيطة الفعلية (${sLine + 1}-${eLine}) لتنسخ منها old_str بدقة:\n${snippet}` }
    }
    return { ok: false, error: 'old_str غير موجود حرفياً ولم يوجد حتى السطر الأول؛ اقرأ الجزء المطلوب عبر read_file.' }
  }
  if (count > 1 && !replaceAll) return { ok: false, error: `old_str يتكرر ${count} مرات. أضف سطوراً محيطة ليصبح فريداً أو استخدم replace_all=true.` }
  const next = replaceAll ? src.split(oldS).join(newS) : src.replace(oldS, () => newS)
  return { ok: true, next, count: replaceAll ? count : 1 }
}

export const fileTools: Tool[] = [
  {
    name: 'read_file',
    parallel: true,
    description: 'Read a text or image file from disk (supports 1-based line numbers with optional start_line/end_line, or batch reading via paths array).',
    schema: schema(
      {
        path: { type: 'string', description: 'File path (relative to active project/workspace or absolute)' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of file paths to read in a single call' },
        start_line: { type: 'number', description: 'First line to read (1-based, default 1)' },
        end_line: { type: 'number', description: 'Last line inclusive (default start_line + 3999)' }
      },
      []
    ),
    async run(i, ctx) {
      const list = Array.isArray(i.paths) && i.paths.length
        ? i.paths.map(String)
        : i.path != null && String(i.path).trim()
          ? [String(i.path)]
          : []
      if (!list.length) return fail('حدّد مسار الملف في path أو قائمة مسارات في paths.')

      if (list.length > 1) {
        const sections: string[] = []
        for (const raw of list.slice(0, 12)) {
          const p = resolvePath(ctx.cwd(), raw)
          if (!existsSync(p)) {
            sections.push(`═══ ${p} (غير موجود) ═══`)
            continue
          }
          const st = statSync(p)
          if (st.isDirectory()) {
            sections.push(`═══ ${p} (مجلد) ═══`)
            continue
          }
          if (st.size > MAX_READ_BYTES) {
            sections.push(`═══ ${p} (ملف كبير — ${(st.size / 1e6).toFixed(1)}MB) ═══`)
            continue
          }
          const buf = readFileSync(p)
          if (isBinary(buf)) {
            sections.push(`═══ ${p} (ملف ثنائي — ${st.size}B) ═══`)
            continue
          }
          const lines = buf.toString('utf8').split(/\r?\n/)
          const body = lines.slice(0, 1000).map((l, k) => `${String(k + 1).padStart(5)}│ ${l}`).join('\n')
          sections.push(`═══ ${p} (${lines.length} سطراً) ═══\n${clip(body, 25000, 0.7)}`)
        }
        return ok(sections.join('\n\n'))
      }

      const raw = list[0].trim()
      if (!raw) return fail('مسار فارغ.')
      const p = resolvePath(ctx.cwd(), raw)
      if (!existsSync(p)) return fail(`الملف غير موجود: ${p}`)
      const st = statSync(p)
      if (st.isDirectory()) return fail('هذا مجلد؛ استخدم list_dir.')
      if (st.size > MAX_READ_BYTES) return fail(`الملف كبير (${(st.size / 1e6).toFixed(1)}MB). استخدم grep للبحث داخله.`)
      const buf = readFileSync(p)
      const ext = extname(p).toLowerCase()
      if (IMAGE_EXT.has(ext) && st.size <= 4 * 1024 * 1024) {
        const dim = imageDimensions(buf)
        const mime = IMAGE_MIME[ext] || 'image/png'
        return ok(
          `صورة: ${p} (${st.size} بايت${dim ? `، ${dim.w}×${dim.h} ${dim.type}` : ''})`,
          ctx.vision ? [{ mediaType: mime, data: buf.toString('base64') }] : undefined
        )
      }
      if (isBinary(buf)) return fail('ملف ثنائي، لا يمكن عرضه كنص.')
      const lines = buf.toString('utf8').split(/\r?\n/)
      const s = Math.max(1, Number(i.start_line) || 1)
      const e = Math.min(lines.length, Number(i.end_line) || s + 3999)
      const body = lines.slice(s - 1, e).map((l, k) => `${String(s + k).padStart(5)}│ ${l}`).join('\n')
      return ok(`${p}  (${lines.length} سطراً${e < lines.length ? `، معروض ${s}-${e}` : ''})\n${clip(body, 100000, 0.7)}`)
    }
  },
  {
    name: 'write_file',
    phase: 'acting',
    description: 'Create or overwrite a file (parent directories created automatically). Set append=true to append to an existing file.',
    schema: schema(
      {
        path: { type: 'string', description: 'Target file path' },
        content: { type: 'string', description: 'File content to write (or append when append=true)' },
        append: { type: 'boolean', description: 'Append content instead of overwriting' }
      },
      ['path', 'content']
    ),
    async run(i, ctx) {
      const p = resolvePath(ctx.cwd(), String(i.path))
      const content = String(i.content ?? '')
      const existed = existsSync(p)
      mkdirSync(dirname(p), { recursive: true })
      const before = existed ? readForDiff(p) : ''
      if (i.append) appendFileSync(p, content)
      else writeFileSync(p, content)
      changed()
      const lines = content.split('\n').length
      const kind = i.append ? (existed ? 'append' : 'create') : existed ? 'modify' : 'create'
      const diff = before !== undefined ? makeDiff(p, kind, before, i.append ? before + content : content) : null
      return ok(`${i.append ? 'أُلحق' : existed ? 'استُبدل' : 'أُنشئ'}: ${p} (${lines} سطراً، ${Buffer.byteLength(content)} بايت)`, undefined, diff ?? undefined)
    }
  },
  {
    name: 'edit_file',
    phase: 'acting',
    description: 'Replace an exact text block (old_str) with new_str in an existing file, or apply multiple replacements in one call via edits:[{old_str,new_str}]. Set replace_all=true to replace all occurrences.',
    schema: schema(
      {
        path: { type: 'string', description: 'File path' },
        old_str: { type: 'string', description: 'Existing text block to replace (without line-number gutter)' },
        new_str: { type: 'string', description: 'Replacement text block' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences instead of requiring a unique match' },
        edits: {
          type: 'array',
          description: 'Optional list of sequential {old_str, new_str, replace_all} edits to apply in one call',
          items: {
            type: 'object',
            properties: {
              old_str: { type: 'string' },
              new_str: { type: 'string' },
              replace_all: { type: 'boolean' }
            }
          }
        }
      },
      ['path']
    ),
    async run(i, ctx) {
      const p = resolvePath(ctx.cwd(), String(i.path))
      if (!existsSync(p)) return fail(`الملف غير موجود: ${p}`)
      let src = readFileSync(p, 'utf8')
      const before = src
      const eol = src.includes('\r\n') ? '\r\n' : '\n'

      const editList: Array<{ old_str: string; new_str: string; replace_all?: boolean }> = Array.isArray(i.edits) && i.edits.length
        ? i.edits
        : i.old_str !== undefined && i.new_str !== undefined
          ? [{ old_str: String(i.old_str), new_str: String(i.new_str), replace_all: !!i.replace_all }]
          : []

      if (!editList.length) return fail('حدّد old_str و new_str أو مصفوفة edits.')

      let totalCount = 0
      for (const ed of editList) {
        const res = applyOneEdit(src, ed.old_str, ed.new_str, !!(ed.replace_all ?? i.replace_all), eol)
        if (!res.ok) return fail(res.error)
        src = res.next
        totalCount += res.count
      }

      writeFileSync(p, src)
      changed()
      const diff = makeDiff(p, 'modify', before, src)
      return ok(`عُدّل: ${p} (${totalCount} موضع)`, undefined, diff ?? undefined)
    }
  },
  {
    name: 'delete_path',
    description: 'Delete a file or directory recursively (absolute path, or relative to the active project/workspace).',
    schema: schema({ path: { type: 'string', description: 'Path to delete' } }, ['path']),
    async run(i, ctx) {
      const p = resolvePath(ctx.cwd(), String(i.path))
      if (!existsSync(p)) return ok('غير موجود أصلاً.')
      if (dirname(p) === p) return fail('مسار جذر؛ مرفوض.')
      const before = readForDiff(p)
      rmSync(p, { recursive: true, force: true })
      changed()
      const diff = before !== undefined ? makeDiff(p, 'delete', before, '') : null
      return ok(`حُذف: ${p}`, undefined, diff ?? undefined)
    }
  },
  {
    name: 'move_path',
    description: 'Move or rename a file or directory (creates parent directories as needed).',
    schema: schema({ from: { type: 'string', description: 'Source path' }, to: { type: 'string', description: 'Destination path' } }, ['from', 'to']),
    async run(i, ctx) {
      const a = resolvePath(ctx.cwd(), String(i.from))
      const b = resolvePath(ctx.cwd(), String(i.to))
      if (!existsSync(a)) return fail('المصدر غير موجود.')
      mkdirSync(dirname(b), { recursive: true })
      let crossDevice = false
      try {
        renameSync(a, b)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
        crossDevice = true
        cpSync(a, b, { recursive: true })
        rmSync(a, { recursive: true, force: true })
      }
      changed()
      return ok(crossDevice ? `نُقل إلى ${b} (عبر نسخ ثم حذف)` : `نُقل إلى ${b}`)
    }
  },
  {
    name: 'make_dir',
    description: 'Create a directory recursively.',
    schema: schema({ path: { type: 'string', description: 'Directory path' } }, ['path']),
    async run(i, ctx) {
      const p = resolvePath(ctx.cwd(), String(i.path))
      mkdirSync(p, { recursive: true })
      changed()
      return ok('تم.')
    }
  },
  {
    name: 'list_dir',
    parallel: true,
    description: 'List directory contents as a tree (depth 1–4, default 2).',
    schema: schema({ path: { type: 'string', description: 'Directory path (default ".")' }, depth: { type: 'number', description: 'Tree depth 1–4 (default 2)' } }),
    async run(i, ctx) {
      const root = resolvePath(ctx.cwd(), String(i.path ?? '.'))
      if (!existsSync(root)) return fail(`غير موجود: ${root}`)
      const maxDepth = Math.min(Math.max(Number(i.depth) || 2, 1), 4)
      const out: string[] = [root]
      let n = 0
      const rec = (dir: string, depth: number, prefix: string) => {
        const ents = readdirSync(dir, { withFileTypes: true }).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        for (const e of ents) {
          if (++n > 400) return
          if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name) && e.name !== '.agent') { out.push(`${prefix}${e.name}/  (مخفي)`); continue }
            out.push(`${prefix}${e.name}/`)
            if (depth < maxDepth) rec(join(dir, e.name), depth + 1, prefix + '  ')
          } else {
            let size = ''
            try { size = ` (${statSync(join(dir, e.name)).size}B)` } catch {}
            out.push(`${prefix}${e.name}${size}`)
          }
        }
      }
      rec(root, 1, '  ')
      return ok(clip(out.join('\n'), 16000))
    }
  },
  {
    name: 'glob',
    parallel: true,
    description: 'Find files matching a glob pattern (skips node_modules, .git, dist).',
    schema: schema({ pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.tsx")' }, path: { type: 'string', description: 'Base directory (default ".")' } }, ['pattern']),
    async run(i, ctx) {
      const base = resolvePath(ctx.cwd(), String(i.path ?? '.'))
      const re = globToRegex(String(i.pattern).replace(/\\/g, '/'))
      const hits: string[] = []
      for await (const f of walkAsync(base, 20000)) {
        const r = rel(base, f)
        if (re.test(r) || (!String(i.pattern).includes('/') && re.test(r.split('/').pop()!))) hits.push(r)
        if (hits.length >= 300) break
      }
      return ok(hits.length ? hits.join('\n') : 'لا نتائج.')
    }
  },
  {
    name: 'grep',
    parallel: true,
    description: 'Search file contents using a regular expression. Returns matching file:line: text with optional surrounding context lines.',
    schema: schema(
      {
        pattern: { type: 'string', description: 'Regular expression pattern' },
        path: { type: 'string', description: 'Directory or file to search (default ".")' },
        include: { type: 'string', description: 'Optional glob filter for file paths' },
        ignore_case: { type: 'boolean', description: 'Case-insensitive match' },
        context: { type: 'number', description: 'Optional number of context lines before/after each match (0–5)' },
        max_results: { type: 'number', description: 'Maximum matches to return (default 100, max 400)' }
      },
      ['pattern']
    ),
    async run(i, ctx) {
      const base = resolvePath(ctx.cwd(), String(i.path ?? '.'))
      if (!existsSync(base)) return fail(`غير موجود: ${base}`)
      let re: RegExp
      try { re = new RegExp(String(i.pattern), i.ignore_case ? 'i' : '') } catch (e) { return fail(`تعبير نمطي غير صالح: ${(e as Error).message}`) }
      const include = String(i.include ?? '')
      const inc = include ? globToRegex(include) : null
      const max = Math.min(Number(i.max_results) || 100, 400)
      const ctxLines = Math.min(Math.max(Number(i.context) || 0, 0), 5)
      const hits: string[] = []
      const isSingleFile = statSync(base).isFile()
      const iter = isSingleFile ? (async function* () { yield base })() : walkAsync(base, 20000)
      for await (const f of iter) {
        if (inc) {
          const r = rel(base, f) || f.replace(/\\/g, '/').split('/').pop()!
          if (!inc.test(r) && !(!include.includes('/') && inc.test(r.split('/').pop()!))) continue
        }
        let buf: Buffer
        try { const st = statSync(f); if (st.size > 2_000_000) continue; buf = readFileSync(f) } catch { continue }
        if (isBinary(buf)) continue
        const lines = buf.toString('utf8').split(/\r?\n/)
        const fileLabel = rel(base, f) || f
        for (let k = 0; k < lines.length; k++) {
          if (re.test(lines[k])) {
            if (ctxLines > 0) {
              const s = Math.max(0, k - ctxLines)
              const e = Math.min(lines.length - 1, k + ctxLines)
              const block: string[] = []
              for (let c = s; c <= e; c++) {
                block.push(`${fileLabel}:${c + 1}${c === k ? ':' : '-'} ${lines[c].slice(0, 220)}`)
              }
              hits.push(block.join('\n'))
            } else {
              hits.push(`${fileLabel}:${k + 1}: ${lines[k].trim().slice(0, 220)}`)
            }
            if (hits.length >= max) return ok(hits.join('\n') + `\n[... توقف عند ${max} نتيجة]`)
          }
        }
      }
      return ok(hits.length ? hits.join('\n') : 'لا نتائج.')
    }
  }
]
