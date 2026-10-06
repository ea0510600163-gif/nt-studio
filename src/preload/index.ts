import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, StudioBridge } from '../shared/api'

/**
 * هذا الملف هو الحدّ الأمني الوحيد بين Node والواجهة.
 * لا يُكشف ipcRenderer أبداً — فقط أفعال محددة، وكل فعل يُعاد التحقق منه
 * في العملية الرئيسية (المُرسِل + مخطط المُدخل + صلاحية المسار).
 */
const bridge: StudioBridge = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  },
}

contextBridge.exposeInMainWorld('studio', bridge)