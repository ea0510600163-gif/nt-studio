import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { basename, join, relative } from 'path'
import type { ProjectInfo } from '@shared/types'
import { db } from '../store/db'
import { getSettings } from '../store/providers'
import { commitMessageArgs, exec, safeCommitMessage, slugify, uid } from '../util'

export const GIT_ID = ['-c', 'user.name=NT Studio', '-c', 'user.email=agent@nt.local']

export const AGENT_CACHE_TTL_MS = 3000

interface AgentFileEntry { text: string; mtimeMs: number; at: number }
const agentFileCache = new Map<string, AgentFileEntry>()
export const agentCacheStats = { fileReads: 0, fileHits: 0, repoBuilds: 0, repoHits: 0, listQueries: 0, listHits: 0 }

export function ensureRoot(): string {
  const root = getSettings().workspaceRoot
  mkdirSync(root, { recursive: true })
  return root
}

export const listProjects = (): ProjectInfo[] =>
  db().all<ProjectInfo>('projects').sort((a, b) => b.updatedAt - a.updatedAt)

let projectListCache: { list: ProjectInfo[]; at: number } | null = null

export const invalidateProjectList = () => { projectListCache = null }

export function cachedProjectList(): ProjectInfo[] {
  const now = Date.now()
  if (projectListCache && now - projectListCache.at < AGENT_CACHE_TTL_MS) {
    agentCacheStats.listHits++
    return projectListCache.list
  }
  agentCacheStats.listQueries++
  const list = listProjects()
  projectListCache = { list, at: now }
  return list
}

export const getProject = (id: string) => db().get<ProjectInfo>('projects', id)
export const findBySlug = (slug: string) => listProjects().find((p) => p.slug === slug || p.name === slug)

export function touchProject(id: string) {
  const p = getProject(id)
  if (p) db().put('projects', id, { ...p, updatedAt: Date.now() })
  invalidateProjectList()
}

export function deleteProject(id: string): { removed: boolean } {
  if (!getProject(id)) return { removed: false }
  db().del('projects', id)
  invalidateProjectList()
  return { removed: true }
}

export function importProject(dir: string): ProjectInfo {
  const known = listProjects().find((p) => p.dir === dir)
  if (known) return known
  const name = basename(dir) || dir
  mkdirSync(join(dir, '.agent'), { recursive: true })
  const now = Date.now()
  const project: ProjectInfo = { id: uid('prj_'), slug: slugify(name), name, description: '', stack: '', dir, createdAt: now, updatedAt: now }
  db().put('projects', project.id, project)
  invalidateProjectList()
  return project
}

export async function hasGit(): Promise<boolean> {
  return (await exec('git', ['--version'], { shell: process.platform === 'win32' })).code === 0
}

export async function createProject(input: { name: string; slug?: string; description: string; stack: string }): Promise<{ project: ProjectInfo; git: boolean }> {
  const root = ensureRoot()
  const base = slugify(input.slug || input.name)
  let slug = base
  for (let i = 2; existsSync(join(root, slug)); i++) slug = `${base}-${i}`
  const dir = join(root, slug)
  mkdirSync(join(dir, '.agent'), { recursive: true })
  const now = Date.now()
  const project: ProjectInfo = { id: uid('prj_'), slug, name: input.name, description: input.description, stack: input.stack, dir, createdAt: now, updatedAt: now }

  writeFileSync(
    join(dir, '.agent', 'PROJECT.md'),
    `# ${input.name}\n\n## الوصف\n${input.description}\n\n## المكدس التقني\n${input.stack}\n\n## هوية التصميم\n(تُملأ قبل كتابة الواجهة: الألوان، الخطوط، فكرة التخطيط)\n\n## القرارات\n- ${new Date().toISOString().slice(0, 10)}: بدء المشروع.\n\n## طريقة التشغيل\n(تُملأ بعد أول تشغيل ناجح)\n`
  )
  writeFileSync(join(dir, '.agent', 'TODO.md'), '# المهام\n\n(لا مهام بعد)\n')
  writeFileSync(join(dir, '.agent', 'memory.json'), JSON.stringify({ facts: {} }, null, 2))
  writeFileSync(join(dir, '.agent', 'log.jsonl'), '')
  writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\nbuild\n.next\n__pycache__\n.venv\n.env\n.agent/log.jsonl\n')

  let git = false
  if (await hasGit()) {
    const sh = process.platform === 'win32'
    const a = await exec('git', ['init', '-q'], { cwd: dir, shell: sh })
    if (a.code === 0) {
      await exec('git', ['add', '-A'], { cwd: dir, shell: sh })
      await exec('git', [...GIT_ID, 'commit', '-q', '-m', safeCommitMessage('بداية المشروع')], { cwd: dir, shell: sh })
      git = true
    }
  }
  db().put('projects', project.id, project)
  invalidateProjectList()
  return { project, git }
}

export async function checkpoint(dir: string, message: string): Promise<string> {
  if (!(await hasGit())) return 'Git غير مثبّت؛ لم تُنشأ نقطة استرجاع (ثبّته بـ winget install Git.Git)'
  const sh = process.platform === 'win32'
  if (!existsSync(join(dir, '.git'))) await exec('git', ['init', '-q'], { cwd: dir, shell: sh })
  await exec('git', ['add', '-A'], { cwd: dir, shell: sh })
  const st = await exec('git', ['status', '--porcelain'], { cwd: dir, shell: sh })
  if (!st.stdout.trim()) return 'لا تغييرات جديدة منذ آخر نقطة.'
  const msg = commitMessageArgs(message)
  const r = await exec('git', [...GIT_ID, 'commit', '-q', ...msg.args], { cwd: dir, shell: sh })
  msg.cleanup?.()
  return r.code === 0 ? `✓ نقطة استرجاع: ${message}` : `تعذّر إنشاء نقطة: ${r.stderr.slice(0, 200)}`
}

export async function createWorktree(projectDir: string, branch: string): Promise<string> {
  const sh = process.platform === 'win32'
  if (!existsSync(join(projectDir, '.git'))) return 'المشروع ليس مستودع git — لا يمكن إنشاء worktree.'
  const slug = slugify(branch).slice(0, 30)
  const wtDir = join(projectDir, '..', `${slug}-wt`)
  if (existsSync(wtDir)) return `المجلد موجود بالفعل: ${wtDir}`
  const r = await exec('git', ['worktree', 'add', '-b', slug, wtDir, 'HEAD'], { cwd: projectDir, shell: sh })
  if (r.code !== 0) return `فشل إنشاء worktree: ${(r.stderr || r.stdout).slice(0, 300)}`
  return `✓ worktree: ${wtDir} (branch: ${slug})`
}

export async function listWorktrees(projectDir: string): Promise<string> {
  const sh = process.platform === 'win32'
  const r = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: projectDir, shell: sh })
  if (r.code !== 0) return 'لا worktrees أو ليس مستودع git.'
  return r.stdout.trim() || 'لا worktrees.'
}

export async function removeWorktree(projectDir: string, wtDir: string): Promise<string> {
  const sh = process.platform === 'win32'
  const r = await exec('git', ['worktree', 'remove', wtDir, '--force'], { cwd: projectDir, shell: sh })
  return r.code === 0 ? `✓ أُزيل worktree: ${wtDir}` : `فشل: ${(r.stderr || r.stdout).slice(0, 300)}`
}

export async function undoLast(dir: string): Promise<string> {
  const sh = process.platform === 'win32'
  if (!existsSync(join(dir, '.git'))) return 'لا يوجد Git في هذا المشروع.'
  const st = await exec('git', ['status', '--porcelain'], { cwd: dir, shell: sh })
  if (st.stdout.trim()) {
    await exec('git', ['reset', '--hard', 'HEAD'], { cwd: dir, shell: sh })
    await exec('git', ['clean', '-fd', '-e', '.agent'], { cwd: dir, shell: sh })
    return 'أُعيد المشروع إلى آخر نقطة استرجاع.'
  }
  const cnt = await exec('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, shell: sh })
  if (parseInt(cnt.stdout) <= 1) return 'لا توجد نقطة أقدم للرجوع إليها.'
  await exec('git', ['reset', '--hard', 'HEAD~1'], { cwd: dir, shell: sh })
  return 'رُجع إلى النقطة السابقة.'
}

export function readAgentFile(dir: string, name: string, max = 6000): string {
  const key = `${dir}|${name}|${max}`
  const hit = agentFileCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < AGENT_CACHE_TTL_MS) {
    try {
      if (statSync(join(dir, '.agent', name)).mtimeMs === hit.mtimeMs) {
        agentCacheStats.fileHits++
        return hit.text
      }
    } catch {}
  }
  try {
    const f = join(dir, '.agent', name)
    const mtimeMs = statSync(f).mtimeMs
    agentCacheStats.fileReads++
    const t = readFileSync(f, 'utf8')
    const text = t.length > max ? t.slice(0, max) + '\n[... مقتطع ...]' : t
    agentFileCache.set(key, { text, mtimeMs, at: now })
    return text
  } catch {
    return ''
  }
}

export const clearAgentFileCache = () => { agentFileCache.clear() }

export const resetAgentCacheStats = () => {
  agentCacheStats.fileReads = 0
  agentCacheStats.fileHits = 0
  agentCacheStats.repoBuilds = 0
  agentCacheStats.repoHits = 0
  agentCacheStats.listQueries = 0
  agentCacheStats.listHits = 0
}

export function logToolCall(dir: string, entry: Record<string, unknown>) {
  try {
    appendFileSync(join(dir, '.agent', 'log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}

export function logToolCallTrimmed(dir: string, entry: Record<string, unknown>) {
  logToolCall(dir, entry)
  try {
    const f = join(dir, '.agent', 'log.jsonl')
    const st = statSync(f)
    if (st.size > 2_000_000) {
      const keep = readFileSync(f, 'utf8').split('\n').slice(-2000).join('\n')
      writeFileSync(f, keep)
    }
  } catch {}
}

export function writeTodoFile(dir: string, items: { text: string; status: string }[]) {
  const mark = (s: string) => (s === 'done' ? '[x]' : s === 'doing' ? '[~]' : s === 'blocked' ? '[!]' : '[ ]')
  try {
    writeFileSync(join(dir, '.agent', 'TODO.md'), '# المهام\n\n' + items.map((i) => `- ${mark(i.status)} ${i.text}`).join('\n') + '\n')
  } catch {}
}

export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.turbo', '.agent', 'target', '.idea', '.vscode'])

export function* walk(dir: string, max = 5000): Generator<string> {
  let n = 0
  const queue = [dir]
  while (queue.length) {
    const d = queue.shift()!
    let ents: import('fs').Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { continue }
    ents.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of ents) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) queue.push(join(d, e.name))
      } else if (++n <= max) yield join(d, e.name)
      else return
    }
  }
}

export async function* walkAsync(dir: string, max = 5000): AsyncGenerator<string> {
  let n = 0
  const queue = [dir]
  while (queue.length) {
    const d = queue.shift()!
    let ents: import('fs').Dirent[]
    try { ents = await readdir(d, { withFileTypes: true }) } catch { continue }
    ents.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of ents) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) queue.push(join(d, e.name))
      } else if (++n <= max) yield join(d, e.name)
      else return
    }
  }
}

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|py|vue|svelte|go|rs|css|html)$/i

let repoCache: { dir: string; budget: number; map: string; at: number; rootMtimeMs: number } | null = null
let repoDirty = true

export const invalidateRepoMap = () => { repoDirty = true; agentFileCache.clear(); projectListCache = null }

export function repoMap(dir: string, budget = 5000): string {
  if (!existsSync(dir)) return ''
  const now = Date.now()
  if (!repoDirty && repoCache && repoCache.dir === dir && repoCache.budget === budget && now - repoCache.at < AGENT_CACHE_TTL_MS) {
    try {
      if (statSync(dir).mtimeMs === repoCache.rootMtimeMs) {
        agentCacheStats.repoHits++
        return repoCache.map
      }
    } catch {}
  }
  const map = buildRepoMap(dir, budget)
  agentCacheStats.repoBuilds++
  let rootMtimeMs = 0
  try { rootMtimeMs = statSync(dir).mtimeMs } catch {}
  repoCache = { dir, budget, map, at: now, rootMtimeMs }
  repoDirty = false
  return map
}

function buildRepoMap(dir: string, budget: number): string {
  const lines: string[] = []
  let used = 0
  for (const f of walk(dir, 400)) {
    const rel = relative(dir, f).replace(/\\/g, '/')
    let line = rel
    try {
      const st = statSync(f)
      if (CODE_EXT.test(f) && st.size < 200_000 && !/\.(css|html)$/i.test(f)) {
        const src = readFileSync(f, 'utf8')
        const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|def)\s+([A-Za-z_$][\w$]*)|^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/gm
        const syms: string[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(src)) && syms.length < 12) syms.push(m[1] || m[2])
        if (syms.length) line += `  ‹${syms.join(', ')}›`
      }
    } catch {}
    if (used + line.length > budget) { lines.push('… (باقي الملفات مقتطع، استخدم glob/list_dir)'); break }
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

export async function repoMapAsync(dir: string, budget = 5000): Promise<string> {
  if (!existsSync(dir)) return ''
  const now = Date.now()
  if (!repoDirty && repoCache && repoCache.dir === dir && repoCache.budget === budget && now - repoCache.at < AGENT_CACHE_TTL_MS) {
    try {
      if (statSync(dir).mtimeMs === repoCache.rootMtimeMs) {
        agentCacheStats.repoHits++
        return repoCache.map
      }
    } catch {}
  }
  const map = await buildRepoMapAsync(dir, budget)
  agentCacheStats.repoBuilds++
  let rootMtimeMs = 0
  try { rootMtimeMs = statSync(dir).mtimeMs } catch {}
  repoCache = { dir, budget, map, at: now, rootMtimeMs }
  repoDirty = false
  return map
}

async function buildRepoMapAsync(dir: string, budget: number): Promise<string> {
  const lines: string[] = []
  let used = 0
  for await (const f of walkAsync(dir, 400)) {
    const rel = relative(dir, f).replace(/\\/g, '/')
    let line = rel
    try {
      const st = await stat(f)
      if (CODE_EXT.test(f) && st.size < 200_000 && !/\.(css|html)$/i.test(f)) {
        const src = await readFile(f, 'utf8')
        const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|def)\s+([A-Za-z_$][\w$]*)|^export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/gm
        const syms: string[] = []
        let m: RegExpExecArray | null
        while ((m = re.exec(src)) && syms.length < 12) syms.push(m[1] || m[2])
        if (syms.length) line += `  ‹${syms.join(', ')}›`
      }
    } catch {}
    if (used + line.length > budget) { lines.push('… (باقي الملفات مقتطع، استخدم glob/list_dir)'); break }
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}
