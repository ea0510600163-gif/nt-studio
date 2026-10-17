import { ipcMain, shell } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import type { Bounds, DeviceKind, FileNode, ImageAttachment, LoadedSession, ModelRef, ProviderInput, SessionMode } from '@shared/types'
import { validateImages } from '@shared/images'
import { answerAsk, runAgent } from './agent/loop'
import { Session, allLive, createSession, getSession, latestSessionForProject, listSessions, openOrCreate, pruneEmptySessions, toChatItems } from './agent/session'
import { callLlm, fetchModelList } from './providers/llm'
import { preview } from './preview'
import { db } from './store/db'
import { getKey, getProvider, getSettings, listProviders, removeProvider, resolveModel, saveProvider, setSettings } from './store/providers'
import { processes } from './tools/processes'
import { errMsg, isInside } from './util'
import { log } from './logger'
import { SKIP_DIRS, getProject, listProjects, undoLast } from './workspace/projects'
import { getWindow, send } from './bus'

function loaded(s: Session): LoadedSession {
  return { session: s.info(), project: s.project, items: toChatItems(s.messages), plan: s.plan, needsResume: s.resumable && !s.running }
}

function need(id: string): Session {
  const s = getSession(id)
  if (!s) throw new Error('الجلسة غير موجودة')
  return s
}

function tree(dir: string, root: string, depth: number, counter: { n: number }): FileNode[] {
  let ents: import('fs').Dirent[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  ents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const out: FileNode[] = []
  for (const e of ents) {
    if (++counter.n > 1500) break
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) && e.name !== '.agent') continue
      out.push({ name: e.name, path: relative(root, join(dir, e.name)).replace(/\\/g, '/'), dir: true, children: depth > 0 ? tree(join(dir, e.name), root, depth - 1, counter) : [] })
    } else out.push({ name: e.name, path: relative(root, join(dir, e.name)).replace(/\\/g, '/'), dir: false })
  }
  return out
}

export function registerIpc() {
  const own = () => getWindow()
  /** يُسجَّل كل معالج عبر هذه الدالة فقط، فيتحقق أن المُرسِل هو نافذتنا فعلاً */
  const h = (channel: string, fn: (...a: any[]) => unknown) => {
    if (ipcMain.listenerCount(channel)) throw new Error(`القناة مسجَّلة مسبقاً: ${channel}`)
    ipcMain.handle(channel, (e, ...args) => {
      const w = own()
      if (!w || w.isDestroyed() || e.sender !== w.webContents) throw new Error('مصدر غير موثوق')
      return fn(e, ...args)
    })
  }

  h('providers:list', () => listProviders())
  h('providers:save', (_e, input: ProviderInput) => {
    const p = saveProvider(input)
    send('providers:changed', null)
    return p
  })
  h('providers:remove', (_e, id: string) => {
    removeProvider(id)
    send('providers:changed', null)
  })
  h('providers:fetchModels', async (_e, input: Pick<ProviderInput, 'baseUrl' | 'apiKey' | 'apiStyle' | 'id'>) => {
    const key = input.apiKey?.trim() || (input.id ? getKey(input.id) : '')
    return fetchModelList(input.baseUrl, key, input.apiStyle)
  })
  h('providers:test', async (_e, id: string, modelId?: string) => {
    const p = getProvider(id)
    if (!p) return { ok: false, message: 'المزود غير موجود' }
    const target = resolveModel({ providerId: id, modelId: modelId ?? p.models[0]?.id ?? '' })
    if (!target || !target.model.id) return { ok: false, message: 'لا يوجد نموذج لاختباره' }
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 25000)
      const r = await callLlm({ system: 'Reply with the single word: ok', messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }], tools: [], target, signal: ctl.signal, maxTokens: 16 }, { onText: () => {}, onThinking: () => {} })
      clearTimeout(t)
      return { ok: true, message: `الاتصال سليم (${r.content.length ? 'رد النموذج' : 'بلا نص'})` }
    } catch (e) {
      return { ok: false, message: errMsg(e).slice(0, 300) }
    }
  })

  h('settings:get', () => getSettings())
  h('settings:set', (_e, patch) => setSettings(patch))

  h('projects:list', () => listProjects().map((p) => ({ ...p, sessionId: latestSessionForProject(p.id)?.id ?? null })))
  h('projects:open', (_e, projectId: string): LoadedSession => {
    const s = latestSessionForProject(projectId)
    if (s) return loaded(s)
    const n = createSession()
    const p = getProject(projectId)
    if (p) {
      n.project = p
      n.projectId = p.id
      n.title = p.name
      n.save()
    }
    return loaded(n)
  })
  h('projects:undo', async (_e, projectId: string) => {
    const p = getProject(projectId)
    return p ? undoLast(p.dir) : 'مشروع غير موجود'
  })
  h('projects:reveal', (_e, projectId: string) => {
    const p = getProject(projectId)
    if (p && existsSync(p.dir)) void shell.openPath(p.dir)
  })

  h('sessions:create', (_e, mode?: SessionMode) => loaded(createSession(mode ?? 'studio')))
  h('sessions:createForProject', (_e, projectId: string): LoadedSession => {
    const s = createSession()
    const p = getProject(projectId)
    if (p) {
      s.project = p
      s.projectId = p.id
      s.title = p.name
      s.save()
    }
    return loaded(s)
  })
  h('sessions:openLatest', (_e, mode?: SessionMode) => {
    pruneEmptySessions()
    return loaded(openOrCreate(mode ?? 'studio'))
  })
  h('sessions:load', (_e, id: string) => loaded(need(id)))
  h('sessions:list', () => listSessions())

  h('agent:send', (_e, id: string, text: string, model?: ModelRef, images?: ImageAttachment[]) => {
    const s = need(id)
    // تحقّق الخلفية أيضاً: العقد يُمرَّر عبر الجسر ولا يُصدَّق بلا فحص
    const safe = validateImages(images ?? [])
    if (safe.error) throw new Error(safe.error)
    if (s.running) s.pending.push(text)
    else
      void runAgent(s, { userText: text, model, images: safe.ok }).catch((e) => {
        // حارس حالة الزومبي: أي استثناء غير متوقع (قبل دخول الحلقة) لا يترك
        // الجلسة «تعمل» بلا دورة — فيبدو المزوّد كأنه لا يرد أبداً
        log.error('فشل تشغيل الوكيل', errMsg(e))
        s.running = false
        s.abort = null
        s.save()
        send('agent:event', { t: 'notice', sessionId: s.id, level: 'error', text: `توقف الوكيل: ${errMsg(e)}. يمكنك الضغط على «إرسال» مجدداً.` })
        send('agent:event', { t: 'run_end', sessionId: s.id, reason: 'error' })
      })
  })
  h('agent:resume', (_e, id: string, model?: ModelRef) => {
    const s = need(id)
    // نفس حارس الزومبي في agent:send: رفضٌ قبل دخول الحلقة (أو استثناء
    // متزامن) بلا معالج يتحوّل إلى unhandledRejection لا يراه إلا السجل،
    // وتبقى الجلسة «تعمل» بلا دورة ولا run_end.
    void runAgent(s, { model }).catch((e) => {
      log.error('فشل استئناف الوكيل', errMsg(e))
      s.running = false
      s.abort = null
      s.save()
      send('agent:event', { t: 'notice', sessionId: s.id, level: 'error', text: `فشل استئناف العمل: ${errMsg(e)}. يمكنك الضغط على «إرسال» مجدداً.` })
      send('agent:event', { t: 'run_end', sessionId: s.id, reason: 'error' })
    })
  })
  h('agent:stop', (_e, id: string) => {
    need(id).abort?.abort()
  })
  h('agent:answer', (_e, askId: string, value: string) => {
    for (const s of allLive()) answerAsk(s, askId, value)
  })
  h('agent:emergencyStop', () => {
    const live = allLive()
    for (const s of live) s.abort?.abort()
    processes.killAll()
    // تأكيد فوري للمستخدم: بلا هذا الحدث تبقى الواجهة على «يعمل» حتى تُطلق كل
    // دورة حدث run_end من كتلة finally الخاصة بها (وهي ستفعل، لكن بتأخير).
    for (const s of live)
      send('agent:event', { t: 'notice', sessionId: s.id, level: 'warn', text: 'أُوقف كل شيء: الوكيل وكل العمليات.' })
  })

  h('preview:setBounds', (_e, b: Bounds) => preview.setBounds(b))
  h('preview:setSuppressed', (_e, v: boolean) => preview.setSuppressed(v))
  h('preview:setDevice', (_e, d: DeviceKind) => preview.setDevice(d))
  h('preview:reload', () => preview.reload())
  h('preview:external', () => preview.external())
  h('preview:close', () => preview.close())
  h('preview:state', () => preview.state)

  /* أزرار النافذة: الإطار مخفي ونديرها نحن — كل معالج يتحقق من النافذة */
  h('window:minimize', () => own()?.minimize())
  h('window:toggleMaximize', () => {
    const w = own()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  h('window:close', () => own()?.close())
  h('window:isMaximized', () => !!own()?.isMaximized())

  h('fs:tree', (_e, id: string): FileNode[] => {
    const s = need(id)
    return s.project && existsSync(s.project.dir) ? tree(s.project.dir, s.project.dir, 4, { n: 0 }) : []
  })
  h('fs:read', (_e, id: string, path: string) => {
    const s = need(id)
    if (!s.project) throw new Error('لا مشروع')
    const full = join(s.project.dir, path)
    if (!isInside(s.project.dir, full)) throw new Error('مسار خارج المشروع')
    const st = statSync(full)
    if (st.size > 400_000) return `(ملف كبير: ${(st.size / 1024).toFixed(0)}KB)`
    const buf = readFileSync(full)
    return buf.subarray(0, 4000).includes(0) ? '(ملف ثنائي)' : buf.toString('utf8')
  })

  h('term:procs', () => processes.list())
  h('term:replay', (_e, id: string) => processes.get(id)?.buf ?? '')
  h('term:input', (_e, id: string, data: string) => processes.get(id)?.write(data))
  h('term:stop', (_e, id: string) => processes.stop(id))

  // تأكد من تهيئة قاعدة البيانات مبكراً
  db()
}
