import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import type { AppContext } from '../core/context'
import { normalize } from '../core/paths'
import { createProjectDirectory } from '../agent/tools/project'
import { listRelativeFiles } from '../agent/tools/fs-scan'
import type { ProjectInfo } from '../../shared/api'

/**
 * مدير المشاريع.
 *
 * جذر المشاريع قابل للتغيير من الإعدادات، وكل شيء يُنشأ داخله فقط.
 */

const ROOT_DEFAULT = 'D:\\NT\\Projects'

export function projectsRoot(ctx: AppContext): string {
  const configured = ctx.state.get().projectsRoot
  return normalize(configured && configured.trim() ? configured : ROOT_DEFAULT)
}

export async function listProjects(ctx: AppContext): Promise<ProjectInfo[]> {
  const root = projectsRoot(ctx)
  const out: ProjectInfo[] = []

  let entries: Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const full = path.join(root, e.name)
    const files: string[] = []
    await listRelativeFiles(full, files)
    if (files.length === 0) continue

    let createdAt = 0
    let lastSummary = ''
    try {
      createdAt = (await fs.stat(full)).birthtimeMs || (await fs.stat(full)).mtimeMs
    } catch {
      /* ignore */
    }

    const hasPackage = files.some((f) => f === 'package.json')
    try {
      const sessions = await fs.readFile(path.join(full, '.agent', 'sessions.jsonl'), 'utf8')
      const ends = sessions
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((r) => r.kind === 'end')
      const last = ends.at(-1)
      if (typeof last?.summary === 'string') lastSummary = last.summary.slice(0, 160)
    } catch {
      /* لا يوجد سجل */
    }

    out.push({ name: e.name, path: full, createdAt, fileCount: files.length, hasPackage, lastSummary })
  }

  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createProject(ctx: AppContext, name: string): Promise<ProjectInfo> {
  const root = projectsRoot(ctx)
  const created = await createProjectDirectory(root, name)
  await fs.writeFile(
    path.join(created.path, '.gitignore'),
    'node_modules/\ndist/\nbuild/\nout/\n.env\n*.log\n.agent/\n',
    'utf8',
  )
  await fs.writeFile(path.join(created.path, 'README.md'), `# ${created.name}\n\nCreated by NT Studio.\n`, 'utf8')
  await fs.mkdir(path.join(created.path, '.agent'), { recursive: true })
  return {
    name: created.name,
    path: created.path,
    createdAt: Date.now(),
    fileCount: 0,
    hasPackage: false,
    lastSummary: '',
  }
}

/** يقرأ آخر خلاصة من سجل الجلسات لعرضها في قائمة المشاريع. */
export async function lastSummaryOf(projectPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(projectPath, '.agent', 'sessions.jsonl'), 'utf8')
    const ends = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.kind === 'end')
    const last = ends.at(-1)
    return typeof last?.summary === 'string' ? last.summary.slice(0, 200) : ''
  } catch {
    return ''
  }
}

/** يزرع المشروع في الذاكرة تلقائيًا عند أول فتح. */
export async function seedMemory(projectPath: string, prompt: string, projectName: string): Promise<void> {
  try {
    const file = path.join(projectPath, '.agent', 'memory.json')
    const existing = await fs.readFile(file, 'utf8').then(
      (r) => JSON.parse(r) as { facts?: string[] },
      () => null,
    )
    if (existing) return
    await fs.writeFile(
      file,
      `${JSON.stringify(
        {
          facts: [`First request: ${prompt.slice(0, 200)}`, `Project name: ${projectName}`],
          decisions: [],
          userPreferences: [],
          gotchas: [],
          updatedAt: Date.now(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  } catch {
    /* الذاكرة مساعِدة — لا تُسقط شيئًا */
  }
}

