import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { createContext, type AppContext } from './core/context'
import { registerAppHandlers } from './ipc/app'
import { registerProviderHandlers } from './ipc/providers'
import { registerProjectHandlers } from './ipc/projects'
import { registerPreviewHandlers } from './ipc/preview'
import { registerAgentHandlers } from './ipc/agent'
import { AgentRunner } from './agent/session'
import { PreviewController } from './preview/controller'
import { setInspectDeps } from './agent/tools/preview'

const APP_ID = 'com.nt.studio'
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null

function openExternally(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

function createMainWindow(ctx: AppContext, preview: PreviewController, runner: AgentRunner): BrowserWindow {
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (RENDERER_URL && url.startsWith(RENDERER_URL)) return
    event.preventDefault()
    openExternally(url)
  })

  // المعاينة عملية عرض منفصلة يرسمها النظام **فوق** الواجهة بالكامل.
  // عند تغيير مقاس النافذة نكتفي بإعادة تطبيق آخر حدود أرسلتها الواجهة (مقصوصةً
  // على إطار المحتوى الجديد) — لا نخمّن مستطيل النافذة كاملة أبدًا؛ فقد كان
  // resize/move → syncBounds يغطّي التطبيق كله ويلتهم كل نقرة.
  // أما تحريك النافذة على الشاشة فلا يمسّ إحداثيات المحتوى إطلاقًا، فلا فعل له.
  win.on('resize', () => preview.onHostResize())
  win.on('maximize', () => preview.onHostResize())
  win.on('unmaximize', () => preview.onHostResize())

  // إيقاف كل شيء بلطف قبل الإغلاق
  win.on('close', () => {
    runner.stop()
    preview.close()
  })

  // ربط أدوات الفحص بالمعاينة الحقيقية
  setInspectDeps({
    screenshot: async () => (await preview.screenshot()).dataUrl ?? '',
    consoleErrors: async () => preview.consoleErrors(),
    evaluate: async (expression) => {
      const res = await preview.evaluate(expression)
      return res.ok ? (res.value ?? '') : null
    },
    click: async (selector) => (await preview.click(selector)).ok,
    type: async (selector, text) => (await preview.typeText(selector, text)).ok,
    pageInfo: async () => {
      const url = preview.currentUrl() ?? ''
      const res = await preview.evaluate('document.title')
      return { url, title: res.ok ? (res.value ?? '') : '' }
    },
    currentUrl: async () => preview.currentUrl(),
  })

  registerAppHandlers(ctx)
  registerProviderHandlers(ctx)
  registerProjectHandlers(ctx)
  registerPreviewHandlers(ctx, preview)
  registerAgentHandlers(ctx, runner)

  if (RENDERER_URL) void win.loadURL(RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

app.whenReady().then(async () => {
  app.setAppUserModelId(APP_ID)

  /* نسخة واحدة فقط: نسختان تتعارضان على state.json وعلى منفذ المعاينة */
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  let ctx: AppContext
  try {
    ctx = await createContext()
  } catch (e) {
    console.error('Failed to initialize app context:', e)
    app.quit()
    return
  }

  const preview = new PreviewController(ctx)
  const runner = new AgentRunner(ctx)

  mainWindow = createMainWindow(ctx, preview, runner)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(ctx, preview, runner)
    else mainWindow?.focus()
  })

  app.on('window-all-closed', () => {
    mainWindow = null
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    runner.stop()
    void ctx.state.flush()
  })
})

