import { safeStorage } from 'electron'
import { db } from '../store/db'
import { pagesUrl, validateRepoName, type SiteFile } from './pages'

export const GITHUB_CLIENT_ID = 'Ov23li0pRMHMX1nfZMbG'
const API = 'https://api.github.com'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

type Form = Record<string, unknown>

async function postForm(url: string, body: Record<string, string>): Promise<Form> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, ...body })
  })
  return (await res.json()) as Form
}

export async function requestDeviceCode(): Promise<DeviceCode> {
  const r = await postForm('https://github.com/login/device/code', { scope: 'public_repo' })
  if (!r.device_code) throw new Error(String(r.error_description ?? r.error ?? 'تعذر بدء تسجيل الدخول بـ GitHub'))
  return r as unknown as DeviceCode
}

export async function pollToken(dev: DeviceCode, signal: AbortSignal): Promise<string> {
  const deadline = Date.now() + dev.expires_in * 1000
  let intervalMs = dev.interval * 1000
  while (Date.now() < deadline) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs)
      signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('أُلغي تسجيل الدخول'))), { once: true })
    })
    const r = await postForm('https://github.com/login/oauth/access_token', {
      device_code: dev.device_code,
      grant_type: DEVICE_GRANT
    })
    if (typeof r.access_token === 'string') return r.access_token
    if (r.error === 'slow_down') intervalMs += 5000
    else if (r.error !== 'authorization_pending') throw new Error(String(r.error_description ?? r.error))
  }
  throw new Error('انتهت مهلة تسجيل الدخول، أعد المحاولة')
}

export function savedToken(): string | null {
  const rec = db().get<{ enc: string }>('secrets', 'github')
  if (!rec || !safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(Buffer.from(rec.enc, 'base64'))
}

export function saveToken(token: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('التشفير غير متاح على هذا الجهاز')
  db().put('secrets', 'github', { enc: safeStorage.encryptString(token).toString('base64') })
}

async function api<T>(token: string, method: string, path: string, body?: unknown, allow: number[] = []) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (!res.ok && !allow.includes(res.status)) throw new Error(`GitHub ${res.status}: ${data.message ?? ''}`.trim())
  return { status: res.status, data }
}

export async function publishSite(token: string, files: SiteFile[], repoName: string): Promise<string> {
  const repo = validateRepoName(repoName)
  const { data: user } = await api<{ login: string }>(token, 'GET', '/user')
  const owner = user.login
  const existing = await api<{ default_branch: string }>(token, 'GET', `/repos/${owner}/${repo}`, undefined, [404])
  if (existing.status === 404) {
    await api(token, 'POST', '/user/repos', { name: repo, auto_init: true, public: true, description: 'NT Studio site' })
  }
  const branch = existing.status === 200 ? existing.data.default_branch : 'main'
  for (const f of files) {
    const path = `/repos/${owner}/${repo}/contents/${encodeURI(f.path)}`
    const current = await api<{ sha?: string }>(token, 'GET', `${path}?ref=${branch}`, undefined, [404])
    await api(token, 'PUT', path, {
      message: `Publish ${f.path}`,
      content: f.bytes.toString('base64'),
      branch,
      sha: current.data.sha
    })
  }
  const pages = { source: { branch, path: '/' } }
  const created = await api(token, 'POST', `/repos/${owner}/${repo}/pages`, pages, [409])
  if (created.status === 409) await api(token, 'PUT', `/repos/${owner}/${repo}/pages`, pages)
  return pagesUrl(owner, repo)
}
