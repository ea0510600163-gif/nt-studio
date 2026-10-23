import { BrowserWindow, app, desktopCapturer, session as electronSession, shell } from 'electron'
import { join } from 'path'
import { flushAll, getWindow, send, setWindow } from './bus'
import { ensureFingerprint } from './env/fingerprint'
import { registerIpc } from './ipc'
import { log } from './logger'
import { preview } from './preview'
import { desktopController } from './desktop/controller'
import { floatingHud } from './desktop/floatingHud'
import { flushPreviewCookies } from './preview/logins'
import { flushOnQuit } from './store/db'
import { syncOpencodeCatalog, refreshProviderCatalogs, warmSecrets } from './store/providers'
import { allLive } from './agent/session'
import { processes } from './tools/processes'
import { ensureRoot } from './workspace/projects'

app.commandLine.appendSwitch('force-ui-direction', 'ltr')

const RTL_LOCALE = /^(ar|he|fa|ur|yi|dv|ps|sd|ug|ckb)\b/i

if (!app.requestSingleInstanceLock()) app.quit()

let winRef: BrowserWindow | null = null

const ZOOM_STEP = 0.5
const ZOOM_MIN = -3
const ZOOM_MAX = 4

function zoomIntent(input: Electron.Input): number | null {
  if (input.type !== 'keyDown' || input.alt || (!input.control && !input.meta)) return null
  if (input.key === '=' || input.key === '+') return 1
  if (input.key === '-') return -1
  if (input.key === '0') return 0
  return null
}

function applyZoom(intent: number) {
  const win = winRef
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  const level = intent === 0 ? 0 : win.webContents.getZoomLevel() + intent * ZOOM_STEP
  win.webContents.setZoomLevel(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level)))
}

function watchZoomShortcuts() {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('before-input-event', (event, input) => {
      const intent = zoomIntent(input)
      if (intent === null) return
      event.preventDefault()
      applyZoom(intent)
    })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 640,
    backgroundColor: '#070a11',
    title: 'NT Studio',
    icon: join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  setWindow(win)
  winRef = win
  preview.attach(win)
  win.once('ready-to-show', () => win.show())
  const broadcastMax = (v: boolean) => send('window:state', { maximized: v })
  win.on('maximize', () => broadcastMax(true))
  win.on('unmaximize', () => broadcastMax(false))
  win.on('minimize', () => {
    desktopController.state.studioMinimized = true
    const hasAgent = allLive().some((s) => s.mode === 'agent' && s.running) || desktopController.state.status !== 'idle'
    if (hasAgent) floatingHud.show(desktopController.state)
    desktopController.broadcast()
  })
  win.on('restore', () => {
    desktopController.state.studioMinimized = false
    if (desktopController.state.status === 'idle' || desktopController.state.status === 'done' || desktopController.state.status === 'error') {
      floatingHud.hide()
    }
    desktopController.broadcast()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault()
  })
  win.on('closed', () => {
    if (getWindow() === win) setWindow(null)
    preview.detach()
    if (winRef === win) winRef = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  try {
    electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const primary = sources[0]
          if (primary) callback({ video: primary })
          else callback({})
        })
        .catch(() => callback({}))
    })
  } catch (e) {
    log.warn('تعذّر تهيئة بث سطح المكتب', String(e))
  }
  if (RTL_LOCALE.test(app.getLocale())) {
    log.info(`لغة النظام RTL (${app.getLocale()}): فُرض اتجاه الواجهة LTR لمنع عكس موضع المعاينة`)
  }
  registerIpc()
  watchZoomShortcuts()
  try { ensureRoot() } catch (e) { log.error('تعذّر إنشاء مساحة العمل', String(e)) }
  try { syncOpencodeCatalog() } catch (e) { log.warn('تعذّر تحديث كتالوج OpenCode Go', String(e)) }
  warmSecrets()
  createWindow()
  void refreshProviderCatalogs()
    .then((changed) => { if (changed) send('providers:changed', null) })
    .catch((e) => log.warn('تعذّر تحديث كتالوجات المزوّدين', String(e)))
  void ensureFingerprint().catch((e) => log.warn('فشل فحص البيئة', String(e)))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  const w = winRef
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore()
    w.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitFlushed = false
app.on('before-quit', (e) => {
  flushAll()
  for (const s of allLive()) s.save()
  processes.killAll()
  desktopController.shutdown()
  flushOnQuit()
  if (quitFlushed) return
  e.preventDefault()
  quitFlushed = true
  void (async () => {
    try {
      await flushPreviewCookies()
    } catch {}
    app.quit()
  })()
})

let crashCount = 0
let crashWindowStart = 0
process.on('uncaughtException', (e) => {
  const now = Date.now()
  if (now - crashWindowStart > 10_000) { crashWindowStart = now; crashCount = 0 }
  if (++crashCount > 20) {
    try { app.exit(1) } catch { process.exit(1) }
    return
  }
  try { log.error('uncaughtException', String(e?.stack ?? e)) } catch {}
})
process.on('unhandledRejection', (e) => log.error('unhandledRejection', String((e as Error)?.stack ?? e)))
