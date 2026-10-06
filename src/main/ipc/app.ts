import { ipcMain } from 'electron'
import type { AppInfo } from '../../shared/api'

/** يعيد معلومات البيئة. لا يقبل أي مُدخل من الواجهة. */
export function registerAppHandlers(): void {
  ipcMain.handle('app:info', (): AppInfo => {
    return {
      name: 'NT Studio',
      version: process.env.npm_package_version ?? '0.1.0',
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
    }
  })
}