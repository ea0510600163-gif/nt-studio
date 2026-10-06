import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent, StudioBridge } from '../shared/api'

/**
 * هذا الملف هو الحدّ الأمني الوحيد بين Node والواجهة.
 * لا يُكشف ipcRenderer أبداً — فقط أفعال محددة بمدخلات مُتحقَّق منها في
 * العملية الرئيسية. لا قنوات عامة: لا يوجد invoke(channel) متاح للواجهة.
 */

/** تمرير رد الإجراء إلى الواجهة مع اسم عربي مفهوم بدل "Error invoking remote method". */
async function invoke<T>(channel: string, payload: unknown): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, payload)) as T
  } catch (e) {
    const raw = (e as Error)?.message ?? String(e)
    const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
    throw new Error(cleaned)
  }
}

/** اشتراك في قناة أحداث مع إعادة إلغاء اشتراك نظيفة. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const bridge: StudioBridge = {
  app: {
    info: () => invoke('app:info', undefined),
  },

  providers: {
    list: () => invoke('providers:list', undefined),
    add: (input) => invoke('providers:add', input),
    update: (input) => invoke('providers:update', input),
    remove: (id) => invoke('providers:remove', { id }),
    probe: (input) => invoke('providers:probe', input),
    testSaved: (id) => invoke('providers:testSaved', { id }),
    fetchModels: (input) => invoke('providers:fetchModels', input),
    setActive: (id, model) => invoke('providers:setActive', { id, model }),
    listProjects: () => invoke('projects:list', undefined),
  },

  agent: {
    run: (input) => invoke('agent:run', input),
    stop: () => invoke('agent:stop', undefined),
    status: () => invoke('agent:status', undefined),
    history: (projectPath, limit) => invoke('agent:history', { projectPath, limit }),
    onEvent: (cb: (event: AgentEvent) => void) => subscribe('agent:event', cb),
  },

  preview: {
    open: (url) => invoke('preview:open', { url }),
    close: () => invoke('preview:close', undefined),
    status: () => invoke('preview:status', undefined),
    screenshot: () => invoke('preview:screenshot', undefined),
    consoleErrors: () => invoke('preview:console', undefined),
    evaluate: (expression) => invoke('preview:evaluate', { expression }),
    click: (selector) => invoke('preview:click', { selector }),
    typeText: (selector, text) => invoke('preview:type', { selector, text }),
    reload: () => invoke('preview:reload', undefined),
    setViewport: (size) => invoke('preview:setViewport', { size }),
  },
}

contextBridge.exposeInMainWorld('studio', bridge)