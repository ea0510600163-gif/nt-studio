import { dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'path'
import type { Bounds, ComputerControlAction, DeviceKind, FileNode, ImageAttachment, LoadedSession, ModelRef, PickedFile, PickedFolder, ProviderInput, SessionMode } from '@shared/types'
import { validateImages } from '@shared/images'
import { answerAsk, runAgent } from './agent/loop'
import { lastUserRequest } from './agent/context'
import { AGENT_CORE, CORE } from './agent/prompt'
import { Session, allLive, createSession, deleteAllSessions, deleteSessionsForProject, getSession, latestSessionForProject, listSessions, openOrCreate, pruneEmptySessions, toChatItems } from './agent/session'
import { deleteSkill, listSkills, saveSkill } from './agent/skills'
import { callLlm, fetchModelList } from './providers/llm'
import { preview } from './preview'
import { desktopController } from './desktop/controller'
import { db } from './store/db'
import { getKey, getProvider, getSettings, listProviders, removeProvider, resolveModel, saveProvider, setSettings } from './store/providers'
import { processes } from './tools/processes'
import { answerApproval } from './tools/permission'
import { skillsDir } from './tools/skills'
import { errMsg } from './util'
import { log } from './logger'
import { SKIP_DIRS, deleteProject, getProject, importProject, listProjects, undoLast } from './workspace/projects'
import { getWindow, send } from './bus'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

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
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 25000)
    try {
      const r = await callLlm({ system: 'Reply with the single word: ok', messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }], tools: [], target, signal: ctl.signal, maxTokens: 16 }, { onText: () => {}, onThinking: () => {} })
      return { ok: true, message: `الاتصال سليم (${r.content.length ? 'رد النموذج' : 'بلا نص'})` }
    } catch (e) {
      return { ok: false, message: errMsg(e).slice(0, 300) }
    } finally {
      clearTimeout(t)
    }
  })

  h('settings:get', () => getSettings())
  h('settings:set', (_e, patch) => setSettings(patch))
  h('settings:defaults', () => ({ studioPrompt: CORE, agentPrompt: AGENT_CORE }))

  h('skills:list', () => listSkills(skillsDir()))
  h('skills:save', (_e, input: { id: string; label: string; description: string; content: string }) => {
    const saved = saveSkill(skillsDir(), input)
    send('skills:changed', null)
    return saved
  })
  h('skills:remove', (_e, id: string) => {
    deleteSkill(skillsDir(), id)
    send('skills:changed', null)
  })

  h('projects:list', () => listProjects().map((p) => ({ ...p, sessionId: latestSessionForProject(p.id)?.id ?? null })))
  const attachProject = (s: Session, projectId: string): Session => {
    const p = getProject(projectId)
    if (p) {
      s.project = p
      s.projectId = p.id
      s.title = p.name
      s.save()
    }
    return s
  }
  const openProjectSession = (projectId: string, currentId?: string | null): LoadedSession => {
    const cur = currentId ? getSession(currentId) : undefined
    if (cur && !cur.running && cur.messages.length === 0) return loaded(attachProject(cur, projectId))
    const s = latestSessionForProject(projectId)
    if (s) return loaded(s)
    return loaded(attachProject(createSession(), projectId))
  }
  h('projects:open', (_e, projectId: string, currentId?: string | null): LoadedSession => openProjectSession(projectId, currentId))
  h('projects:import', async (): Promise<LoadedSession | null> => {
    const w = own()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, { title: 'اختر مجلد المشروع', properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    return openProjectSession(importProject(res.filePaths[0]).id)
  })
  h('projects:undo', async (_e, projectId: string) => {
    const p = getProject(projectId)
    return p ? undoLast(p.dir) : 'مشروع غير موجود'
  })
  h('projects:reveal', (_e, projectId: string) => {
    const p = getProject(projectId)
    if (p && existsSync(p.dir)) void shell.openPath(p.dir).catch(() => {})
  })
  h('projects:delete', async (_e, projectId: string): Promise<{ removed: boolean; sessions: number }> => {
    const p = getProject(projectId)
    if (!p) return { removed: false, sessions: 0 }
    if ([...allLive()].some((s) => s.projectId === projectId && s.running)) throw new Error('أوقف التنفيذ الجاري في المشروع قبل حذفه.')
    processes.killUnder(p.dir)
    await deleteProject(projectId)
    const sessions = deleteSessionsForProject(projectId)
    return { removed: true, sessions }
  })
  h('projects:deleteAll', async (): Promise<{ removed: number; sessions: number; failed: string[] }> => {
    if ([...allLive()].some((s) => s.running)) throw new Error('أوقف التنفيذ الجاري قبل حذف المشاريع.')
    let removed = 0
    let sessions = 0
    const failed: string[] = []
    for (const p of listProjects()) {
      try {
        processes.killUnder(p.dir)
        await deleteProject(p.id)
        sessions += deleteSessionsForProject(p.id)
        removed++
      } catch (e) {
        failed.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return { removed, sessions, failed }
  })

  h('sessions:create', (_e, mode?: SessionMode) => loaded(createSession(mode ?? 'studio')))
  h('sessions:createForProject', (_e, projectId: string): LoadedSession => loaded(attachProject(createSession(), projectId)))
  h('sessions:openLatest', (_e, mode?: SessionMode) => {
    pruneEmptySessions()
    return loaded(openOrCreate(mode ?? 'studio'))
  })
  h('sessions:load', (_e, id: string) => loaded(need(id)))
  h('sessions:list', () => listSessions())
  h('sessions:deleteAll', () => deleteAllSessions())

  h('agent:send', (_e, id: string, text: string, model?: ModelRef, images?: ImageAttachment[]) => {
    const s = need(id)
    const safe = validateImages(images ?? [])
    if (safe.error) throw new Error(safe.error)
    if (s.running) s.pending.push({ text, images: safe.ok })
    else
      void runAgent(s, { userText: text, model, images: safe.ok }).catch((e) => {
        log.error('فشل تشغيل الوكيل', errMsg(e))
        s.running = false
        s.abort = null
        s.save()
        send('agent:event', { t: 'notice', sessionId: s.id, level: 'error', text: `توقف الوكيل: ${errMsg(e)}. يمكنك الضغط على «إرسال» مجدداً.` })
        send('agent:event', { t: 'run_end', sessionId: s.id, reason: 'error' })
      })
  })
  h('agent:regenerate', (_e, id: string, model?: ModelRef) => {
    const s = need(id)
    const warn = (text: string) => send('agent:event', { t: 'notice', sessionId: s.id, level: 'warn', text })
    if (s.running) {
      warn('الوكيل يعمل الآن — أوقفه قبل إعادة التوليد.')
      return
    }
    if (s.mode === 'agent') {
      warn('إعادة التوليد متاحة في وضع Studio فقط.')
      return
    }
    const req = lastUserRequest(s.messages)
    if (!req) {
      warn('لا يوجد طلب سابق لإعادة توليده.')
      return
    }
    s.messages = s.messages.slice(0, req.index)
    db().msgReplace(s.id, s.messages)
    s.save()
    log.info('agent:regenerate', id)
    void runAgent(s, { userText: req.text, model, images: req.images }).catch((e) => {
      log.error('فشل إعادة توليد الوكيل', errMsg(e))
      s.running = false
      s.abort = null
      s.save()
      send('agent:event', { t: 'notice', sessionId: s.id, level: 'error', text: `توقف الوكيل: ${errMsg(e)}` })
      send('agent:event', { t: 'run_end', sessionId: s.id, reason: 'error' })
    })
  })
  h('agent:resume', (_e, id: string, model?: ModelRef) => {
    const s = need(id)
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
    const s = need(id)
    log.info('agent:stop', id)
    s.pending.length = 0
    processes.killByOwner(s.id)
    s.abortAll()
    send('agent:event', { t: 'notice', sessionId: s.id, level: 'warn', text: 'أُوقف الوكيل.' })
  })
  h('agent:answer', (_e, askId: string, value: string) => {
    for (const s of allLive()) answerAsk(s, askId, value)
  })
  h('permission:answer', (_e, requestId: string, ok: boolean) => answerApproval(requestId, ok))
  h('agent:emergencyStop', () => {
    const live = allLive()
    for (const s of live) { s.pending.length = 0; s.abortAll() }
    processes.killAll()
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

  desktopController.setStopHandler((sessionId?: string) => {
    const target = sessionId ? getSession(sessionId) : allLive().find((s) => s.running)
    if (target) {
      target.pending.length = 0
      processes.killByOwner(target.id)
      target.abortAll()
      send('agent:event', { t: 'notice', sessionId: target.id, level: 'warn', text: 'أُوقف إيجنت الكمبيوتر.' })
    }
  })

  h('computer:state', () => desktopController.state)
  h('computer:control', (_e, action: ComputerControlAction, sessionId?: string) => desktopController.control(action, sessionId))
  h('computer:screenshot', async () => {
    const s = await desktopController.screenshot(false)
    return { dataUrl: `data:${s.mediaType};base64,${s.data}`, width: s.width, height: s.height }
  })

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
    const dir = s.project?.dir ?? getSettings().workspaceRoot
    return dir && existsSync(dir) ? tree(dir, dir, 4, { n: 0 }) : []
  })
  h('fs:read', (_e, id: string, path: string) => {
    const s = need(id)
    const base = s.project?.dir ?? getSettings().workspaceRoot
    const full = isAbsolute(path) ? resolve(path) : join(base, path)
    if (!existsSync(full)) throw new Error('الملف غير موجود')
    const st = statSync(full)
    if (st.size > 1_500_000) return `(ملف كبير: ${(st.size / 1024).toFixed(0)}KB)`
    const buf = readFileSync(full)
    return buf.subarray(0, 4000).includes(0) ? '(ملف ثنائي)' : buf.toString('utf8')
  })
  h('fs:pickFiles', async (): Promise<PickedFile[]> => {
    const w = own()
    if (!w) return []
    const res = await dialog.showOpenDialog(w, {
      title: 'اختر ملفات لإرفاقها',
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || !res.filePaths.length) return []
    const out: PickedFile[] = []
    for (const p of res.filePaths.slice(0, 10)) {
      try {
        const st = statSync(p)
        if (!st.isFile()) continue
        const ext = extname(p).toLowerCase()
        const mime = IMAGE_MIME[ext]
        if (mime && st.size <= 4 * 1024 * 1024) {
          const data = readFileSync(p).toString('base64')
          out.push({ path: p, name: basename(p), size: st.size, image: { mediaType: mime, data } })
          continue
        }
        let previewText: string | undefined
        if (st.size <= 250_000) {
          const buf = readFileSync(p)
          if (!buf.subarray(0, 2000).includes(0)) {
            previewText = buf.toString('utf8').slice(0, 12000)
          }
        }
        out.push({ path: p, name: basename(p), size: st.size, preview: previewText })
      } catch {}
    }
    return out
  })
  h('fs:pickFolder', async (): Promise<PickedFolder | null> => {
    const w = own()
    if (!w) return null
    const res = await dialog.showOpenDialog(w, {
      title: 'اختر مجلداً للعمل عليه',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    let entries: string[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .slice(0, 40)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    } catch {}
    return { path: dir, name: basename(dir) || dir, entries }
  })

  h('term:procs', () => processes.list())
  h('term:replay', (_e, id: string) => processes.get(id)?.buf ?? '')
  h('term:input', (_e, id: string, data: string) => processes.get(id)?.write(data))
  h('term:stop', (_e, id: string) => processes.stop(id))

  db()
}
