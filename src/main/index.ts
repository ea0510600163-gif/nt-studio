import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerAppHandlers } from './ipc/app'

const APP_ID = 'com.nt.studio'
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null

/** روابط مسموح فتحها في المتصفح الخارجي فقط (http/https). */
function openExternally(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0b0d',
    title: 'NT Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // إعدادات أمان غير قابلة للتفاوض: لا Node في الواجهة، وعزل كامل،
      // وsandbox مفعّل (يتطلب preload بصيغة CommonJS — لذلك لا "type":"module").
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // أي نافذة جديدة تُطلب من داخل التطبيق تُمنع وتُحوَّل للمتصفح الخارجي.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })

  // منع أي تنقل خارج حزمة التطبيق المحلية (في وضع التطوير يُسمح بخادم Vite فقط).
  win.webContents.on('will-navigate', (event, url) => {
    if (RENDERER_URL && url.startsWith(RENDERER_URL)) return
    event.preventDefault()
    openExternally(url)
  })

  if (RENDERER_URL) void win.loadURL(RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID)
  registerAppHandlers()
  mainWindow = createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    else mainWindow?.focus()
  })
})

app.on('window-all-closed', () => {
  mainWindow = null
  if (process.platform !== 'darwin') app.quit()
})