import { session } from 'electron'
import { log } from '../logger'

export const LOGIN_PARTITION = 'persist:nt-preview'
export const LOGIN_KEEP_SEC = 31536000
const FLUSH_MS = 15000

export interface HardenableCookie {
  name: string
  value: string
  domain: string
  path: string
  secure?: boolean
  httpOnly?: boolean
  hostOnly?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  session?: boolean
  expirationDate?: number
}

export function shouldHardenCookie(c: HardenableCookie, removed: boolean): boolean {
  if (removed) return false
  if (c.expirationDate && !c.session) return false
  return true
}

export function hardenedCookieDetails(c: HardenableCookie, nowSec = Date.now() / 1000) {
  const bare = c.domain.replace(/^\./, '')
  return {
    url: `${c.secure ? 'https' : 'http'}://${bare}${c.path}`,
    name: c.name,
    value: c.value,
    domain: c.hostOnly ? undefined : c.domain,
    path: c.path,
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite ?? 'lax',
    expirationDate: nowSec + LOGIN_KEEP_SEC
  }
}

interface Binding {
  handler: (e: unknown, c: Electron.Cookie, cause: string, removed: boolean) => void
  timer: NodeJS.Timeout
}
const bound = new WeakMap<Electron.Session, Binding>()

async function hardenOne(ses: Electron.Session, cookie: Electron.Cookie, removed: boolean): Promise<void> {
  try {
    if (removed || !cookie.domain || !cookie.name) return
    const c: HardenableCookie = {
      name: cookie.name,
      value: cookie.value ?? '',
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      hostOnly: cookie.hostOnly,
      sameSite: cookie.sameSite as HardenableCookie['sameSite'],
      session: cookie.session,
      expirationDate: cookie.expirationDate
    }
    if (!shouldHardenCookie(c, false)) return
    const d = hardenedCookieDetails(c)
    await ses.cookies.set({
      url: d.url,
      name: d.name,
      value: d.value,
      domain: d.domain,
      path: d.path,
      secure: d.secure,
      httpOnly: d.httpOnly,
      sameSite: d.sameSite as Electron.CookiesSetDetails['sameSite'],
      expirationDate: d.expirationDate
    })
  } catch {}
}

export function hardenPreviewLogins(wc: Electron.WebContents): void {
  try {
    const ses = wc.session
    if (bound.has(ses)) return
    try {
      const ua = ses.getUserAgent()
      const clean = ua.replace(/\s(Electron|agent-desktop)\/\S+/g, '')
      if (clean !== ua) ses.setUserAgent(clean)
    } catch (e) {
      log.warn('تعذّر تنظيف UA للمعاينة', String(e))
    }
    const handler = (_e: unknown, c: Electron.Cookie, _cause: string, removed: boolean) => {
      void hardenOne(ses, c, removed)
    }
    ses.cookies.on('changed', handler)
    const timer = setInterval(() => {
      void ses.cookies.flushStore().catch(() => {})
    }, FLUSH_MS)
    timer.unref?.()
    bound.set(ses, { handler, timer })
  } catch (e) {
    log.warn('تعذّر تثبيت دخول المعاينة', String(e))
  }
}

export function releasePreviewLogins(): void {
  try {
    const ses = session.fromPartition(LOGIN_PARTITION)
    const b = bound.get(ses)
    if (!b) return
    try {
      ses.cookies.removeListener('changed', b.handler)
    } catch {}
    clearInterval(b.timer)
    bound.delete(ses)
  } catch {}
}

export async function flushPreviewCookies(): Promise<void> {
  try {
    await session.fromPartition(LOGIN_PARTITION).cookies.flushStore()
  } catch {}
}
