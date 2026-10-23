import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

export interface SiteFile {
  path: string
  bytes: Buffer
}

const SKIP_DIRS = new Set(['node_modules', '.git'])
const MAX_FILES = 500
const MAX_BYTES = 25 * 1024 * 1024

export const pagesUrl = (login: string, repo: string) => `https://${login.toLowerCase()}.github.io/${repo}/`

export function validateRepoName(name: string): string {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new Error('اسم المستودع يقبل الأحرف الإنجليزية والأرقام و . _ - فقط')
  return name
}

export function listSiteFiles(root: string): SiteFile[] {
  const files: SiteFile[] = []
  let total = 0
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      total += statSync(full).size
      if (files.length >= MAX_FILES || total > MAX_BYTES) throw new Error('الموقع أكبر من الحد المسموح به للنشر')
      files.push({ path: relative(root, full).split(sep).join('/'), bytes: readFileSync(full) })
    }
  }
  walk(root)
  if (!files.some((f) => f.path === 'index.html')) throw new Error('المجلد لا يحتوي index.html في جذره')
  return files
}
