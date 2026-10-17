import { session } from 'electron'
import { log } from '../logger'

/**
 * تثبيت تسجيل الدخول في المعاينة («سجّل مرة واحدة»).
 *
 * الفكرة من agent-app (`keepLogins`): كوكيز الجلسة (بلا تاريخ انتهاء — وأكثر
 * مواقع التواصل أساس دخولها كذلك) تموت عند إغلاق التطبيق، فنحوّلها عند كل
 * تغيّر إلى كوكيز دائمة تنتهي بعد سنة، مع تفريغ دوري لمخزن الكوكيز وتنظيف
 * وسم Electron من الـ UA حتى لا تميّزنا حواجز الكشف.
 *
 * ضمانات عدم الكسر:
 * - حارس إعادة الدخول: الكوكي المحوّلة تصل بشكل `session=false` فلا تُعاد
 *   معالجتها (مكافئ لحارس `!c.session` الأصلي) — لا حلقة لا نهائية.
 * - idempotency على مستوى الجلسة: إعادة `ensureView()` بعد انهيار عملية العرض
 *   لا تضاعف المستمعات/المؤقتات.
 * - كل الدوال fail-safe: أي عطل هنا لا يكسر فتح المعاينة أبداً.
 */

export const LOGIN_PARTITION = 'persist:nt-preview'
/** سنة كاملة بالثواني — مدة تثبيت الكوكيز */
export const LOGIN_KEEP_SEC = 31536000
const FLUSH_MS = 15000

/** الحد الأدنى من حقول الكوكي الذي نحتاجه — قابل للاختبار بلا Electron */
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

/** هل تحتاج هذه الكوكي إلى تثبيت؟ (منطق نقي) */
export function shouldHardenCookie(c: HardenableCookie, removed: boolean): boolean {
  if (removed) return false
  if (c.expirationDate && !c.session) return false // دائمة أصلاً
  return true
}

/** تفاصيل إعادة الكتابة المثبتة (منطق نقي — نفس بناء agent-app) */
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
  } catch {
    /* best-effort: فشل تثبيت كوكي واحدة لا يستحق كسر أي شيء */
  }
}

/**
 * ثبّت دخول جلسة المعاينة: مستمع تحويل + تفريغ دوري + تنظيف UA.
 * آمنة التكرار لنفس الجلسة (idempotent).
 */
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

/** فكّ التثبيت (يُستدعى من `destroyView`) — fail-safe */
export function releasePreviewLogins(): void {
  try {
    const ses = session.fromPartition(LOGIN_PARTITION)
    const b = bound.get(ses)
    if (!b) return
    try {
      ses.cookies.removeListener('changed', b.handler)
    } catch {
      /* تجاهل */
    }
    clearInterval(b.timer)
    bound.delete(ses)
  } catch {
    /* تجاهل */
  }
}

/** تفريغ مخزن الكوكيز إلى القرص فوراً — تُستدعى من المؤقت ومن `before-quit` */
export async function flushPreviewCookies(): Promise<void> {
  try {
    await session.fromPartition(LOGIN_PARTITION).cookies.flushStore()
  } catch {
    /* best-effort */
  }
}
