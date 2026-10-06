import { contextBridge, ipcRenderer } from 'electron'
import type { StudioBridge } from '../shared/api'

/**
 * هذا الملف هو الحدّ الأمني الوحيد بين Node والواجهة.
 * لا يُكشف ipcRenderer أبداً — فقط أفعال محددة، وكل فعل يُعاد التحقق منه
 * في العملية الرئيسية (المُرسِل + مخطط المُدخل + صلاحية المسار).
 */
const bridge: StudioBridge = {
  app: {
    info: (): ReturnType<StudioBridge['app']['info']> => ipcRenderer.invoke('app:info'),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    add: (input) => ipcRenderer.invoke('providers:add', input),
    update: (input) => ipcRenderer.invoke('providers:update', input),
    remove: (id) => ipcRenderer.invoke('providers:remove', { id }),
    probe: (input) => ipcRenderer.invoke('providers:probe', input),
    testSaved: (id) => ipcRenderer.invoke('providers:testSaved', { id }),
    fetchModels: (input) => ipcRenderer.invoke('providers:fetchModels', input),
    setActive: (id, model) => ipcRenderer.invoke('providers:setActive', { id, model }),
  },
}

contextBridge.exposeInMainWorld('studio', bridge)