import { existsSync, promises as fs, statSync, type Dirent } from 'node:fs'
import path from 'node:path'
import { assertAllowed, assertSafeName, isSubPathOf, normalize } from '../../core/paths'
import type { ToolContext, ToolResult, ToolSpec } from '../types'
import { bytes, truncate } from '../types'

/**
 * أدوات نظام الملفات.
 *
 * كل عملية تمرّ على assertAllowed: القراءة مفتوحة، والكتابة/الحذف مرفوضة داخل
 * مجلدات النظام. الأدوات لا تثق بما يرسله النموذج — تتحقق من كل مسار.
 */

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  'coverage',
  '.venv',
  '__pycache__',
  '.idea',
  '.vscode',
])

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svgz', '.bmp', '.tiff',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib', '.pdf',
  '.db', '.sqlite', '.bin', '.wasm',
])

export function isBinaryPath(filePath: string): boolean {
  return BINARY_EXT.has(path.extname(filePath).toLowerCase())
}

async function walk(dir: string, base: string, out: string[], depth = 0): Promise<void> {
  if (out.length > 400 || depth > 8) return
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length > 400) return
    if (IGNORED_DIRS.has(e.name)) continue
    // نتجاهل الملفات الخفية عدا .gitignore و .env.example
    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.env.example') continue
    const full = path.join(dir, e.name)
    const rel = path.relative(base, full).replace(/\\/g, '/')
    out.push(rel)
    if (e.isDirectory()) await walk(full, base, out, depth + 1)
  }
}

export const fsTools: ToolSpec[] = [
  {
    name: 'list_files',
    category: 'fs',
    parallelSafe: true,
    description:
      'List project files as relative paths. Always call this first to understand the project structure before reading or editing.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Subdirectory relative to project root. Empty = project root.' },
      },
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project — call create_project first')
      const target = args.path ? resolveExisting(t, String(args.path)) : root

      const files: string[] = []
      await walk(target, root, files)
      const sorted = files.sort()
      return {
        ok: true,
        text: sorted.length ? sorted.join('\n') : '(empty directory)',
        ui: `${sorted.length} ملف`,
      }
    },
  },

  {
    name: 'read_file',
    category: 'fs',
    parallelSafe: true,
    description: 'Read a text file. Returns the full content. Binary files are rejected.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to project root' } },
      required: ['path'],
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const full = resolveIn(t, String(args.path))
      if (isBinaryPath(full)) throw new Error(`Binary file cannot be read as text: ${String(args.path)}`)
      const stat = await fs.stat(full)
      if (stat.size > 2_000_000) throw new Error(`File too large (${bytes(stat.size)}) — read it in parts`)
      const content = await fs.readFile(full, 'utf8')
      return {
        ok: true,
        text: `\`\`\`\n// ${String(args.path)} (${lines(content)} lines)\n${truncate(content)}\n\`\`\``,
        ui: `قراءة ${String(args.path)} · ${bytes(stat.size)}`,
      }
    },
  },

  {
    name: 'write_file',
    category: 'fs',
    description:
      'Create or overwrite a file with the given content. Parent directories are created automatically. Use this for new files or full rewrites.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const full = resolveIn(t, String(args.path))
      assertAllowed(full, 'write')
      const content = String(args.content ?? '')
      if (content.length > 2_000_000) throw new Error('Content too large (>2MB) — split into multiple files')
      await fs.mkdir(path.dirname(full), { recursive: true })
      const existed = existsFile(full)
      await fs.writeFile(full, content, 'utf8')
      return {
        ok: true,
        text: `${existed ? 'Updated' : 'Created'} ${String(args.path)} (${lines(content)} lines, ${bytes(Buffer.byteLength(content))})`,
        ui: `${existed ? 'تعديل' : 'إنشاء'} ${String(args.path)}`,
      }
    },
  },

  {
    name: 'edit_file',
    category: 'fs',
    description:
      'Replace an exact string in an existing file. old_string must appear EXACTLY once — include surrounding context lines to make it unique. Fails if the string is not found or is ambiguous.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact text to replace (must be unique in the file)' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const full = resolveIn(t, String(args.path))
      assertAllowed(full, 'write')
      const oldStr = String(args.old_string ?? '')
      const newStr = String(args.new_string ?? '')
      if (oldStr === newStr) throw new Error('old_string and new_string are identical')

      const content = await fs.readFile(full, 'utf8')
      const first = content.indexOf(oldStr)
      if (first === -1) {
        throw new Error(
          `old_string not found in ${String(args.path)}. The file is ${lines(content)} lines — re-read the file and copy the exact text.`,
        )
      }
      const second = content.indexOf(oldStr, first + oldStr.length)
      if (second !== -1) {
        throw new Error(
          `old_string appears multiple times in ${String(args.path)} — add more surrounding context lines to make it unique.`,
        )
      }
      const next = content.slice(0, first) + newStr + content.slice(first + oldStr.length)
      await fs.writeFile(full, next, 'utf8')
      return {
        ok: true,
        text: `Edited ${String(args.path)} — replaced ${oldStr.length} chars with ${newStr.length} chars`,
        ui: `تعديل ${String(args.path)}`,
      }
    },
  },

  {
    name: 'delete_file',
    category: 'fs',
    description: 'Delete a file or directory inside the project. Use sparingly.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const full = resolveIn(t, String(args.path))
      assertAllowed(full, 'delete')
      await fs.rm(full, { recursive: true, force: true })
      return { ok: true, text: `Deleted ${String(args.path)}`, ui: `حذف ${String(args.path)}` }
    },
  },

  {
    name: 'move_file',
    category: 'fs',
    description: 'Move or rename a file/directory inside the project.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const from = resolveIn(t, String(args.from))
      const to = resolveIn(t, String(args.to))
      assertAllowed(to, 'write')
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.rename(from, to)
      return { ok: true, text: `Moved ${String(args.from)} -> ${String(args.to)}`, ui: 'نقل ملف' }
    },
  },

  {
    name: 'create_directory',
    category: 'fs',
    description: 'Create a directory inside the project.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const full = resolveIn(t, String(args.path))
      assertAllowed(full, 'write')
      await fs.mkdir(full, { recursive: true })
      return { ok: true, text: `Created directory ${String(args.path)}`, ui: 'إنشاء مجلد' }
    },
  },

  {
    name: 'search_text',
    category: 'fs',
    parallelSafe: true,
    description:
      'Search for a text pattern across project files. Returns matching lines with file paths and line numbers. Use plain text (not regex).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text to search for (case-insensitive)' },
        path: { type: 'string', description: 'Limit to this subdirectory. Empty = whole project.' },
      },
      required: ['pattern'],
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const pattern = String(args.pattern ?? '')
      if (!pattern) throw new Error('pattern is required')
      const base = args.path ? resolveExisting(t, String(args.path)) : root

      const files: string[] = []
      await walk(base, root, files)
      const needle = pattern.toLowerCase()
      const hits: string[] = []

      for (const rel of files) {
        if (hits.length >= 80) break
        const full = path.join(root, rel)
        if (isBinaryPath(full)) continue
        let content: string
        try {
          const stat = await fs.stat(full)
          if (stat.size > 1_500_000) continue
          content = await fs.readFile(full, 'utf8')
        } catch {
          continue
        }
        const linesArr = content.split('\n')
        for (let i = 0; i < linesArr.length; i++) {
          const line = linesArr[i]
          if (line === undefined) continue
          if (line.toLowerCase().includes(needle)) {
            hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`)
            if (hits.length >= 80) break
          }
        }
      }
      return {
        ok: true,
        text: hits.length ? hits.join('\n') : `(no matches for "${pattern}")`,
        ui: `${hits.length} نتيجة`,
      }
    },
  },

  {
    name: 'find_files',
    category: 'fs',
    parallelSafe: true,
    description:
      'Find files by extension or name fragment. Example: extension="tsx" or name="config". Much faster than reading directories.',
    inputSchema: {
      type: 'object',
      properties: {
        extension: { type: 'string', description: 'Without dot, e.g. "ts", "tsx", "css"' },
        name: { type: 'string', description: 'Case-insensitive name fragment' },
      },
    },
    async execute(args: Record<string, unknown>, t: ToolContext): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const ext = args.extension ? String(args.extension).replace(/^\./, '').toLowerCase() : ''
      const name = args.name ? String(args.name).toLowerCase() : ''
      if (!ext && !name) throw new Error('Provide extension or name')

      const files: string[] = []
      await walk(root, root, files)
      const matched = files.filter((f) => {
        if (ext && path.extname(f).toLowerCase() !== `.${ext}`) return false
        if (name && !path.basename(f).toLowerCase().includes(name)) return false
        return true
      })
      return {
        ok: true,
        text: matched.length ? matched.slice(0, 200).join('\n') : '(no matching files)',
        ui: `${matched.length} ملف`,
      }
    },
  },
]

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function resolveIn(t: ToolContext, rel: string): string {
  const root = t.projectRoot
  if (!root) throw new Error('No open project — call create_project first')
  const value = rel.trim()
  if (!value) throw new Error('path is required')
  const full = path.isAbsolute(value) ? normalize(value) : normalize(path.join(root, value))
  if (!isSubPathOf(full, root)) {
    throw new Error(`Path escapes the project root: ${rel}`)
  }
  return full
}

/** يُرجع مسارًا فرعيًا إن وُجد، وإلا يرمي خطأ واضحًا (بدل نتيجة فارغة غامضة). */
function resolveExisting(t: ToolContext, rel: string): string {
  const full = resolveIn(t, rel)
  if (!existsDir(full)) {
    throw new Error(`Directory not found: ${rel || '.'} — call list_files first to see the structure`)
  }
  return full
}

function existsDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}

function existsFile(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

function lines(text: string): number {
  return text.split('\n').length
}

void assertSafeName
