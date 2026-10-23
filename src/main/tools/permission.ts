import { existsSync } from 'fs'
import type { ApprovalRequest, PermissionMode } from '@shared/types'
import { getWindow, send } from '../bus'
import { clip, resolvePath, uid } from '../util'

export const DENIED = 'رفض المستخدم تنفيذ هذا الإجراء'

interface RiskVerdict {
  risky: boolean
  reason: string
  destructive: boolean
}

const SAFE: RiskVerdict = { risky: false, reason: '', destructive: false }

const PATH_KEYS: Record<string, string[]> = {
  read_file: ['path', 'paths'],
  write_file: ['path'],
  edit_file: ['path'],
  delete_path: ['path'],
  move_path: ['from', 'to'],
  verify_file: ['path'],
  browser_upload: ['paths']
}

const SENSITIVE =
  /(^|[\\/])\.env(\.|$)|(^|[\\/]|\.)id_(rsa|dsa|ecdsa|ed25519)$|\.(pem|key|pfx|p12|jks|keystore|snk)$|(^|[\\/])(passwords?|passwd|secrets?|credentials?|\.netrc|\.npmrc|\.pgpass|\.git-credentials|\.htpasswd)(\.|$)/i

const SYSTEM_PROCESS =
  /\b(system|csrss|wininit|winlogon|lsass|services|smss|svchost|dwm|explorer|msdtc|fontdrvhost|wudfhost|registry|searchhost|sihost|taskhostw|ctfmon|spoolsv|wmiprvse|audiodg)\b/i

interface CommandRule {
  re: RegExp
  reason: string
}

const COMMAND_RULES: CommandRule[] = [
  { re: /\breg(?:istry)?\s+(?:delete|remove)\b|\bremove-itemproperty\b|\bclear-itemproperty\b/i, reason: 'حذف قيم أو مفاتيح من تسجيل النظام' },
  { re: /\bformat-volume\b|\bformat(?:\.com)?\s+[a-z]:/i, reason: 'تهيئة قرص أو وحدة تخزين' },
  { re: /\bdiskpart\b/i, reason: 'تعديل تقسيم الأقراص' },
  { re: /\bbcdedit\b/i, reason: 'تعديل إعدادات الإقلاع' },
  { re: /\bshutdown\b|\brestart-computer\b|\bstop-computer\b/i, reason: 'إيقاف الجهاز أو إعادة تشغيله' },
  { re: /\bstop-service\b|\bdisable-windowsoptionalfeature\b/i, reason: 'إيقاف خدمة أو ميزة من مزايا ويندوز' },
  { re: /\bremove-item\b|\brm\b|\bdel\b|\berase\b|\brmdir\b|\brd\b/i, reason: 'حذف ملفات أو مجلدات' }
]

const KILL_RE = /\bstop-process\b|\btaskkill\b|\bkill\b/i

function commandRisk(command: string): RiskVerdict {
  if (!command.trim()) return SAFE
  if (KILL_RE.test(command) && SYSTEM_PROCESS.test(command))
    return { risky: true, reason: 'إنهاء عملية نظام حرجة', destructive: true }
  if (/set-itemproperty/i.test(command) && /\bhklm\b/i.test(command))
    return { risky: true, reason: 'تعديل تسجيل النظام على مستوى الجهاز (HKLM)', destructive: true }
  for (const rule of COMMAND_RULES) if (rule.re.test(command)) return { risky: true, reason: rule.reason, destructive: true }
  return SAFE
}

function pathStrings(args: Record<string, unknown>, keys: string[]): string[] {
  const out: string[] = []
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) out.push(v)
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim()) out.push(x)
  }
  return out
}

function sensitiveHit(args: Record<string, unknown>, tool: string): string | null {
  for (const p of pathStrings(args, PATH_KEYS[tool] ?? [])) if (SENSITIVE.test(p)) return p
  return null
}

function resolved(args: Record<string, unknown>, key: string, cwd?: string): string {
  const raw = String(args[key] ?? '').trim()
  if (!raw) return ''
  return cwd ? resolvePath(cwd, raw) : raw
}

function assess(toolName: string, args: unknown, cwd?: string): RiskVerdict {
  const a = (args ?? {}) as Record<string, unknown>
  if (toolName === 'run_command') return commandRisk(String(a.command ?? ''))
  if (toolName === 'delete_path')
    return { risky: true, reason: `حذف نهائي لا يمكن التراجع عنه: ${resolved(a, 'path', cwd)}`, destructive: true }
  const secret = sensitiveHit(a, toolName)
  if (secret) return { risky: true, reason: `ملف حساس (مفاتيح أو أسرار أو كلمات سر): ${secret}`, destructive: false }
  if (toolName === 'write_file' && !a.append) {
    const p = resolved(a, 'path', cwd)
    if (p && existsSync(p)) return { risky: true, reason: `استبدال محتوى ملف موجود بالكامل: ${p}`, destructive: false }
  }
  if (toolName === 'publish_site')
    return { risky: true, reason: `نشر عام على الإنترنت عبر مستودع GitHub باسم «${String(a.repo ?? '')}»`, destructive: false }
  if (toolName === 'browser_upload')
    return { risky: true, reason: 'رفع ملف من هذا الجهاز إلى صفحة ويب خارجية', destructive: false }
  return SAFE
}

export function isRisky(toolName: string, args: unknown, cwd?: string): { risky: boolean; reason: string } {
  const v = assess(toolName, args, cwd)
  return { risky: v.risky, reason: v.reason }
}

export function isDestructive(toolName: string, args: unknown, cwd?: string): boolean {
  return assess(toolName, args, cwd).destructive
}

export function describeTarget(toolName: string, args: unknown, cwd?: string): string {
  const a = (args ?? {}) as Record<string, unknown>
  if (toolName === 'run_command') return clip(String(a.command ?? ''), 600, 0.7)
  if (toolName === 'publish_site') return `المجلد «${String(a.dir ?? '')}» ← المستودع «${String(a.repo ?? '')}»`
  const paths = pathStrings(a, PATH_KEYS[toolName] ?? [])
  if (paths.length) return clip(paths.map((p) => (cwd ? resolvePath(cwd, p) : p)).join(' ، '), 500, 0.7)
  return ''
}

const pending = new Map<string, (v: boolean) => void>()

export function answerApproval(requestId: string, ok: boolean): void {
  pending.get(requestId)?.(ok === true)
}

function windowAlive(): boolean {
  const w = getWindow()
  return !!w && !w.isDestroyed() && !w.webContents.isDestroyed()
}

export function requestApproval(
  sessionId: string,
  toolName: string,
  args: unknown,
  reason: string,
  cwd?: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (!windowAlive()) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const requestId = uid('apv_')
    const done = (v: boolean) => {
      pending.delete(requestId)
      signal?.removeEventListener('abort', onAbort)
      resolve(v)
    }
    const onAbort = () => done(false)
    if (signal?.aborted) return done(false)
    pending.set(requestId, done)
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const req: ApprovalRequest = {
      requestId,
      sessionId,
      tool: toolName,
      target: describeTarget(toolName, args, cwd),
      reason,
      danger: isDestructive(toolName, args, cwd)
    }
    send('permission:request', req)
  })
}

export interface GateOptions {
  permissionMode: PermissionMode
  sessionId: string
  toolName: string
  args: unknown
  cwd?: string
  signal?: AbortSignal
  setPhase?: (phase: 'waiting' | 'acting') => void
}

export async function gateTool(o: GateOptions): Promise<string | null> {
  if (o.permissionMode === 'full') return null
  const verdict = assess(o.toolName, o.args, o.cwd)
  if (!verdict.risky) return null
  o.setPhase?.('waiting')
  const approved = await requestApproval(o.sessionId, o.toolName, o.args, verdict.reason, o.cwd, o.signal)
  o.setPhase?.('acting')
  return approved ? null : DENIED
}
