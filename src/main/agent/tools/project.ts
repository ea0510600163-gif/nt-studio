import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assertAllowed, assertSafeName, normalize } from '../../core/paths'
import type { ToolResult, ToolSpec } from '../types'
import { truncate } from '../types'
import { execCommand } from './exec'

import { startDevServer, stopDevServer } from './devserver'

import { listRelativeFiles } from './fs-scan'


/**
 * أدوات المشروع.
 *
 * الفلسفة: المشروع يُنشأ بـ"هيكل نظيف" (git + README + .gitignore) لا بقوالب
 * جاهزة. النموذج هو من يختار الحزم ويعقلد البنية — هذا ما يجعل النتيجة
 * قابلة للتعديل لاحقًا بدل أن تكون كعكة منفوخة لا يعرف أحد مكوّناتها.
 */

const ROOT_DEFAULT = 'D:\\NT\\Projects'

/** يحوّل الاسم العربي/الإنجليزي إلى slug صالح لمجلد ويندوز. */
export function slugify(input: string): string {
  const map: Record<string, string> = {
    'أ': 'a', 'إ': 'i', 'آ': 'a', 'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th',
    'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z',
    'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a',
    'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
    'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'h', 'ء': '', 'ؤ': 'w', 'ئ': 'y',
  }
  let out = ''
  for (const ch of String(input ?? '').trim().toLowerCase()) {
    const mapped = map[ch]
    if (mapped !== undefined) out += mapped
    else if (/[a-z0-9]/.test(ch)) out += ch
    else if (/[\s\-_/.]/.test(ch)) out += '-'
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  return out || 'project'
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

export interface CreatedProject {
  name: string
  path: string
}

export async function createProjectDirectory(
  root: string,
  rawName: string,
): Promise<CreatedProject> {
  const base = normalize(root || ROOT_DEFAULT)
  assertAllowed(base, 'write')
  await fs.mkdir(base, { recursive: true })

  const slug = slugify(assertSafeName(rawName.replace(/[\\/]/g, '-').slice(0, 60)))
  let folder = path.join(base, slug)
  let n = 2
  while (await dirExists(folder)) {
    folder = path.join(base, `${slug}-${n}`)
    n++
  }
  await fs.mkdir(folder, { recursive: true })
  return { name: path.basename(folder), path: folder }
}

const GITIGNORE = `node_modules/
dist/
build/
out/
.next/
.cache/
.vite/
coverage/
*.log
.env
.env.local
.DS_Store
Thumbs.db
*.tsbuildinfo
.agent/
`

export const projectTools: ToolSpec[] = [
  {
    name: 'create_project',
    category: 'project',
    description: `Create a new empty project folder with git initialised, a .gitignore and a README. Call this FIRST for any new build request. Returns the absolute path to work in. Default root: ${ROOT_DEFAULT}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short descriptive name, e.g. "snake-game" or "portfolio"' },
        description: { type: 'string', description: 'One line about what this project is' },
      },
      required: ['name'],
    },
    async execute(args, t): Promise<ToolResult> {
      const root = t.ctx.state.get().projectsRoot || ROOT_DEFAULT
      const created = await createProjectDirectory(root, String(args.name))
      t.projectRoot = created.path

      await fs.writeFile(path.join(created.path, '.gitignore'), GITIGNORE, 'utf8')
      const desc = String(args.description ?? '').trim()
      await fs.writeFile(
        path.join(created.path, 'README.md'),
        `# ${created.name}\n\n${desc || 'Created by NT Studio.'}\n`,
        'utf8',
      )
      await fs.mkdir(path.join(created.path, '.agent'), { recursive: true })

      t.emit({ type: 'status', phase: 'starting' })

      let gitOk = false
      try {
        const { execFile } = await import('node:child_process')
        const { promisify } = await import('node:util')
        await promisify(execFile)('git', ['init', '-q'], { cwd: created.path, timeout: 10_000, windowsHide: true })
        gitOk = true
      } catch {
        gitOk = false
      }

      return {
        ok: true,
        text: `Project created at: ${created.path}\nGit initialised: ${gitOk ? 'yes' : 'no (git unavailable)'}\nNow write the real project files into this folder. Do NOT nest another folder — write directly into this path.`,
        ui: `مشروع جديد: ${created.name}`,
      }
    },
  },

  {
    name: 'project_status',
    category: 'project',
    parallelSafe: true,
    description: 'Inspect the current project: whether package.json exists, scripts, installed dependencies, and git state.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const linesOut: string[] = [`path: ${root}`]

      const pkgPath = path.join(root, 'package.json')
      if (await fileExists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
          name?: string
          scripts?: Record<string, string>
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        linesOut.push(`name: ${pkg.name ?? '(none)'}`)
        linesOut.push(`scripts: ${JSON.stringify(pkg.scripts ?? {})}`)
        linesOut.push(
          `dependencies: ${Object.keys(pkg.dependencies ?? {}).length} | devDependencies: ${Object.keys(pkg.devDependencies ?? {}).length}`,
        )
      } else {
        linesOut.push('package.json: absent')
      }

      linesOut.push(`node_modules: ${(await dirExists(path.join(root, 'node_modules'))) ? 'present' : 'absent'}`)
      linesOut.push(`.git: ${(await dirExists(path.join(root, '.git'))) ? 'present' : 'absent'}`)

      const files: string[] = []
      await listRelativeFiles(root, files)
      linesOut.push(`files: ${files.length}`)
      linesOut.push(files.slice(0, 60).join('\n'))

      return { ok: true, text: linesOut.join('\n'), ui: `${files.length} ملف` }
    },
  },

  {
    name: 'run_command',
    category: 'exec',
    description: `Run a shell command in a directory and return stdout, stderr and exit code. Use for git, mkdir, and any utility. Output is streamed live to the terminal panel. Default directory: the project root.`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell command to execute' },
        cwd: { type: 'string', description: 'Working directory. Defaults to the project root.' },
        timeoutMs: { type: 'number', description: 'Timeout in ms. Default 120000.' },
      },
      required: ['command'],
    },
    async execute(args, t): Promise<ToolResult> {
      const command = String(args.command ?? '').trim()
      if (!command) throw new Error('command is required')
      const cwd = args.cwd
        ? path.isAbsolute(String(args.cwd))
          ? normalize(String(args.cwd))
          : t.projectRoot
            ? path.join(t.projectRoot, String(args.cwd))
            : normalize(String(args.cwd))
        : t.projectRoot ?? ROOT_DEFAULT

      if (!(await dirExists(cwd))) throw new Error(`Working directory does not exist: ${cwd}`)

      const timeoutMs = Math.min(Number(args.timeoutMs ?? 120_000) || 120_000, 600_000)
      const out = await execCommand(command, cwd, timeoutMs, t)
      return {
        ok: out.code === 0,
        text: `$ ${command}\nexit: ${out.code}\n${truncate(out.output, 14_000)}`,
        ui: `${command.slice(0, 40)}${out.code === 0 ? '' : ` (exit ${out.code})`}`,
      }
    },
  },

  {
    name: 'install_dependencies',
    category: 'exec',
    description:
      'Install project dependencies with the correct package manager. Detects lockfile (npm/pnpm/yarn/bun) and runs the matching install. Runs in background-safe mode with a long timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional specific packages to add. Empty = install from package.json.',
        },
      },
    },
    async execute(args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')
      const packages = Array.isArray(args.packages) ? args.packages.map((p) => String(p)).filter(Boolean) : []

      let manager = 'npm'
      if (await fileExists(path.join(root, 'pnpm-lock.yaml'))) manager = 'pnpm'
      else if (await fileExists(path.join(root, 'yarn.lock'))) manager = 'yarn'
      else if (await fileExists(path.join(root, 'bun.lockb'))) manager = 'bun'

      let command: string
      if (manager === 'pnpm') command = packages.length ? `pnpm add ${packages.join(' ')}` : 'pnpm install'
      else if (manager === 'yarn') command = packages.length ? `yarn add ${packages.join(' ')}` : 'yarn install'
      else if (manager === 'bun') command = packages.length ? `bun add ${packages.join(' ')}` : 'bun install'
      else command = packages.length ? `npm install ${packages.join(' ')}` : 'npm install'

      t.emit({ type: 'status', phase: 'installing', detail: command })
      const out = await execCommand(command, root, 600_000, t)
      if (out.code !== 0) {
        throw new Error(
          `Dependency install failed (exit ${out.code}).\nCommand: ${command}\n${truncate(out.output, 6_000)}`,
        )
      }
      return {
        ok: true,
        text: `${command} completed successfully.\n${truncate(out.output.slice(-2_000), 2_000)}`,
        ui: `${manager}: تثبيت الحزم`,
      }
    },
  },

  {
    name: 'start_dev_server',
    category: 'exec',
    description: `Start the project's development server in the background and return the detected local URL. Automatically picks a free port, waits for readiness, and registers the process so the preview panel opens automatically. Use this instead of run_command for dev servers.`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Override command. Defaults to package.json dev script.' },
        port: { type: 'number', description: 'Preferred port. Defaults to an auto-free port.' },
      },
    },
    async execute(args, t): Promise<ToolResult> {
      const root = t.projectRoot
      if (!root) throw new Error('No open project')

      const preferred = Number(args.port ?? 0) || undefined
      const result = await startDevServer({
        cwd: root,
        command: args.command ? String(args.command) : undefined,
        preferredPort: preferred,
        ctx: t.ctx,
        signal: t.signal,
        emit: t.emit,
      })

      return {
        ok: true,
        text: `Dev server running at ${result.url}\ncommand: ${result.command}\nPID: ${result.pid}\nThe preview panel is open. Now INSPECT the running app with inspect_page before reporting success.`,
        ui: `الخادم: ${result.url}`,
      }
    },
  },

  {
    name: 'stop_dev_server',
    category: 'exec',
    description: 'Stop the project dev server started earlier.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, t): Promise<ToolResult> {
      const stopped = await stopDevServer(t.ctx)
      return { ok: true, text: stopped ? 'Dev server stopped.' : 'No dev server was running.' }
    },
  },
]

