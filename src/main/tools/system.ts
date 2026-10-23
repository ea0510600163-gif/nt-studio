import { cpus, freemem, homedir, release, totalmem, userInfo } from 'os'
import { buildFingerprint, cachedFingerprint, fingerprintText } from '../env/fingerprint'
import { APPS_PS_COMMAND, parseInstalledApps } from '../env/installedApps'
import { findFreePort } from '../ports'
import { runShell } from './psScript'
import { clip, exec } from '../util'
import { Tool, fail, ok, schema } from './types'

const MAX_ENV_ENTRIES = 250

async function listening(): Promise<string> {
  if (process.platform === 'win32') {
    const r = await exec('netstat', ['-ano', '-p', 'tcp'], { timeout: 10000 })
    const rows = r.stdout.split('\n').filter((l) => /LISTENING/i.test(l)).map((l) => l.trim().split(/\s+/))
    return rows.map((c) => `${c[1]}  pid=${c[4]}`).join('\n') || 'لا منافذ مستمعة.'
  }
  const r = await exec('ss', ['-ltnp'], { timeout: 10000 })
  return r.stdout || r.stderr
}

export const systemTools: Tool[] = [
  {
    name: 'system_info',
    parallel: true,
    description: 'Inspect host machine environment (os, installed tools/versions, listening TCP ports, installed desktop applications via the fast registry scan, or environment variables).',
    schema: schema({ section: { type: 'string', enum: ['os', 'tools', 'ports', 'apps', 'env'], description: 'Section to inspect' }, refresh: { type: 'boolean', description: 'Re-probe installed tools instead of using cache' } }, ['section']),
    async run(i, ctx) {
      switch (i.section) {
        case 'os':
          return ok(`OS: ${process.platform} ${release()} ${process.arch}\nCPU: ${cpus()[0]?.model} ×${cpus().length}\nRAM: ${(freemem() / 1e9).toFixed(1)}GB حرة من ${(totalmem() / 1e9).toFixed(1)}GB\nUser: ${userInfo().username}\nHome: ${homedir()}\nWorkspace: ${ctx.settings().workspaceRoot}`)
        case 'tools': {
          const fp = i.refresh || !cachedFingerprint() ? await buildFingerprint() : cachedFingerprint()
          return ok(fingerprintText(fp))
        }
        case 'ports':
          return ok(await listening())
        case 'apps': {
          const r = await runShell(APPS_PS_COMMAND, { timeoutMs: 20_000 })
          const items = parseInstalledApps(r.stdout)
          if (!items.length) return fail(`تعذّر فحص البرامج (رمز ${r.code}). ${r.stderr.trim().slice(0, 300) || 'لا مخرجات.'}`)
          return ok(`البرامج المثبّتة (${items.length}) — فحص ريجستري سريع:\n${clip(items.join('\n'), 30000)}`)
        }
        case 'env': {
          const all = Object.entries(process.env)
          const lines = all
            .slice(0, MAX_ENV_ENTRIES)
            .map(([k, v]) => {
              if (k.toLowerCase() === 'path') return `PATH:\n  ${(v ?? '').split(process.platform === 'win32' ? ';' : ':').join('\n  ')}`
              return `${k}=${(v ?? '').slice(0, 400)}`
            })
          const note = all.length > MAX_ENV_ENTRIES ? `\n[... عُرض ${MAX_ENV_ENTRIES} مدخلاً من ${all.length} ...]` : ''
          return ok(clip(lines.join('\n'), 40000) + note)
        }
        default:
          return fail('section غير معروف')
      }
    }
  },
  {
    name: 'free_port',
    parallel: true,
    description: 'Allocate an available local TCP port (skips ports reserved by NT Studio).',
    schema: schema({ start: { type: 'number', description: 'Starting port number (default 3000)' } }),
    async run(i) {
      return ok(String(await findFreePort(Number(i.start) || 3000)))
    }
  }
]
