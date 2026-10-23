import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, type EventChannel, type NtApi } from '../shared/ipc'

const inv = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a)

const api: NtApi = {
  providers: {
    list: () => inv('providers:list'),
    save: (i) => inv('providers:save', i),
    remove: (id) => inv('providers:remove', id),
    test: (id, m) => inv('providers:test', id, m),
    fetchModels: (i) => inv('providers:fetchModels', i)
  },
  settings: {
    get: () => inv('settings:get'),
    set: (p) => inv('settings:set', p),
    defaults: () => inv('settings:defaults')
  },
  skills: {
    list: () => inv('skills:list'),
    save: (i) => inv('skills:save', i),
    remove: (id) => inv('skills:remove', id)
  },
  projects: {
    list: () => inv('projects:list'),
    open: (id, currentSessionId) => inv('projects:open', id, currentSessionId),
    import: () => inv('projects:import'),
    undo: (id) => inv('projects:undo', id),
    reveal: (id) => inv('projects:reveal', id),
    delete: (id) => inv('projects:delete', id),
    deleteAll: () => inv('projects:deleteAll')
  },
  sessions: {
    create: (mode) => inv('sessions:create', mode),
    createForProject: (id) => inv('sessions:createForProject', id),
    openLatest: (mode) => inv('sessions:openLatest', mode),
    load: (id) => inv('sessions:load', id),
    list: () => inv('sessions:list'),
    deleteAll: () => inv('sessions:deleteAll')
  },
  agent: {
    send: (id, t, m, imgs) => inv('agent:send', id, t, m, imgs),
    regenerate: (id, m) => inv('agent:regenerate', id, m),
    stop: (id) => inv('agent:stop', id),
    resume: (id, m) => inv('agent:resume', id, m),
    answer: (a, v) => inv('agent:answer', a, v),
    emergencyStop: () => inv('agent:emergencyStop')
  },
  permission: {
    answer: (requestId, ok) => inv('permission:answer', requestId, ok)
  },
  preview: {
    setBounds: (b) => inv('preview:setBounds', b),
    setSuppressed: (v) => inv('preview:setSuppressed', v),
    setDevice: (d) => inv('preview:setDevice', d),
    reload: () => inv('preview:reload'),
    external: () => inv('preview:external'),
    close: () => inv('preview:close'),
    state: () => inv('preview:state')
  },
  computer: {
    state: () => inv('computer:state'),
    control: (action, sessionId) => inv('computer:control', action, sessionId),
    screenshot: () => inv('computer:screenshot')
  },
  window: {
    minimize: () => inv('window:minimize'),
    toggleMaximize: () => inv('window:toggleMaximize'),
    close: () => inv('window:close'),
    isMaximized: () => inv('window:isMaximized')
  },
  fs: {
    tree: (id) => inv('fs:tree', id),
    read: (id, p) => inv('fs:read', id, p),
    pickFiles: () => inv('fs:pickFiles'),
    pickFolder: () => inv('fs:pickFolder')
  },
  term: {
    procs: () => inv('term:procs'),
    replay: (id) => inv('term:replay', id),
    input: (id, d) => inv('term:input', id, d),
    stop: (id) => inv('term:stop', id)
  },
  on(channel: EventChannel, cb) {
    if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) throw new Error('قناة غير مسموحة')
    const fn = (_e: unknown, payload: unknown) => cb(payload as never)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.removeListener(channel, fn)
  }
}

contextBridge.exposeInMainWorld('nt', api)
