import { arch, cpus, release, totalmem } from 'os'
import { db } from '../store/db'
import { exec } from '../util'

export interface Fingerprint {
  ts: number
  os: string
  arch: string
  cpu: string
  ramGB: number
  tools: Record<string, string | null>
  packageManager: string
}

const PROBES: [string, string, string[]][] = [
  ['node', 'node', ['-v']],
  ['npm', 'npm', ['-v']],
  ['pnpm', 'pnpm', ['-v']],
  ['yarn', 'yarn', ['-v']],
  ['bun', 'bun', ['-v']],
  ['python', 'python', ['--version']],
  ['py', 'py', ['-V']],
  ['pip', 'pip', ['--version']],
  ['git', 'git', ['--version']],
  ['winget', 'winget', ['--version']],
  ['go', 'go', ['version']],
  ['dotnet', 'dotnet', ['--version']],
  ['java', 'java', ['-version']],
  ['cargo', 'cargo', ['--version']]
]

export async function buildFingerprint(): Promise<Fingerprint> {
  const sh = process.platform === 'win32'
  const results = await Promise.all(
    PROBES.map(async ([key, cmd, args]) => {
      const r = await exec(cmd, args, { shell: sh, timeout: 8000 })
      const out = (r.stdout + ' ' + r.stderr).trim().split('\n')[0]?.trim()
      return [key, r.code === 0 && out ? out.slice(0, 60) : null] as const
    })
  )
  const tools = Object.fromEntries(results)
  const fp: Fingerprint = {
    ts: Date.now(),
    os: `${process.platform} ${release()}`,
    arch: arch(),
    cpu: `${cpus()[0]?.model ?? 'cpu'} ×${cpus().length}`,
    ramGB: Math.round(totalmem() / 1024 ** 3),
    tools,
    packageManager: tools.pnpm ? 'pnpm' : tools.npm ? 'npm' : tools.yarn ? 'yarn' : 'none'
  }
  db().put('kv', 'fingerprint', fp)
  return fp
}

export const cachedFingerprint = () => db().get<Fingerprint>('kv', 'fingerprint')

export async function ensureFingerprint(maxAgeMs = 12 * 3600_000): Promise<Fingerprint> {
  const c = cachedFingerprint()
  if (c && Date.now() - c.ts < maxAgeMs) return c
  return buildFingerprint()
}

export function fingerprintText(fp?: Fingerprint): string {
  if (!fp) return '(لم تُفحص البيئة بعد: استخدم system_info section=tools)'
  const have = Object.entries(fp.tools).filter(([, v]) => v).map(([k, v]) => `${k} ${String(v).replace(/^[a-zA-Z .]*?(?=\d)/, '')}`)
  const miss = Object.entries(fp.tools).filter(([, v]) => !v).map(([k]) => k)
  return `${fp.os} ${fp.arch} | ${fp.cpu} | ${fp.ramGB}GB RAM\nمثبّت: ${have.join(', ') || 'لا شيء'}\nغير مثبّت: ${miss.join(', ') || 'لا شيء'}\nمدير الحزم المفضّل: ${fp.packageManager}`
}
