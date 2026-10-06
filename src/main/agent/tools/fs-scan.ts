/**
 * جمع المسارات النسبية لكل ملفات المشروع.
 *
 * ملاحظة: `base` يبقى الجذر الأصلي أثناء التكرار، وإلا أصبحت مسارات
 * الملفات الفرعية نسبية لمجلدها هي (فيصبح src/main.ts просто main.ts).
 */

import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'

const IGNORED = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
  'coverage', '.venv', '__pycache__', '.idea', '.vscode', '.agent',
])

/** يجمع المسارات النسبية لكل ملفات المشروع (بدون مجلدات مولّدة). */
export async function listRelativeFiles(
  dir: string,
  out: string[],
  base: string = dir,
  depth = 0,
): Promise<void> {
  if (out.length > 500 || depth > 8) return
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length > 500) return
    if (IGNORED.has(e.name)) continue
    const full = path.join(dir, e.name)
    const rel = path.relative(base, full).replace(/\\/g, '/')
    if (e.isDirectory()) {
      await listRelativeFiles(full, out, base, depth + 1)
    } else {
      out.push(rel)
    }
  }
}

/** اسم أقرب ملف تعريف مشروع داخل جذر (package.json > index.html > Cargo.toml…) */
export async function detectProjectKind(dir: string): Promise<string> {
  const candidates: Array<[string, string]> = [
    ['package.json', 'node'],
    ['Cargo.toml', 'rust'],
    ['requirements.txt', 'python'],
    ['pyproject.toml', 'python'],
    ['index.html', 'static'],
    ['go.mod', 'go'],
    ['composer.json', 'php'],
  ]
  for (const [file, kind] of candidates) {
    try {
      await fs.stat(path.join(dir, file))
      return kind
    } catch {
      /* next */
    }
  }
  return 'unknown'
}

/** يقرأ package.json إن وُجد ويرجع name + scripts. */
export async function readPackageJson(dir: string): Promise<{
  name?: string
  scripts: Record<string, string>
} | null> {
  try {
    const raw = await fs.readFile(path.join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> }
    return { name: parsed.name, scripts: parsed.scripts ?? {} }
  } catch {
    return null
  }
}