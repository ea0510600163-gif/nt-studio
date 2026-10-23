import { BrowserWindow, screen } from 'electron'
import type { ComputerControlAction, ComputerState } from '@shared/types'
import { log } from '../logger'

const HUD_CMD_PREFIX = '__NT_HUD_CMD__:'

function buildHudHtml(): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  @property --ai-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
  @keyframes ai-spin { to { --ai-angle: 360deg; } }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.3); opacity: 0.65; }
  }
  @keyframes hud-breathe {
    0%, 100% { box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), 0 0 18px -6px rgba(99, 191, 201, 0.4); }
    50% { box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), 0 0 30px -4px rgba(177, 155, 224, 0.5); }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
  html, body {
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    font-family: 'Segoe UI', Tahoma, system-ui, sans-serif;
    color: #f3f4f8;
  }
  .pill {
    position: relative;
    isolation: isolate;
    -webkit-app-region: drag;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: calc(100% - 6px);
    height: calc(100% - 6px);
    margin: 3px;
    padding: 5px 10px;
    border-radius: 13px;
    background:
      radial-gradient(ellipse at center, transparent 0%, #161616 75%),
      linear-gradient(rgba(80, 80, 80, 0.45) 1px, transparent 1px) 0 0 / 16px 16px,
      linear-gradient(90deg, rgba(80, 80, 80, 0.45) 1px, transparent 1px) 0 0 / 16px 16px,
      linear-gradient(rgba(80, 80, 80, 0.18) 1px, transparent 1px) 0 0 / 4px 4px,
      linear-gradient(90deg, rgba(80, 80, 80, 0.18) 1px, transparent 1px) 0 0 / 4px 4px,
      #161616;
    animation: hud-breathe 2.4s ease-in-out infinite;
  }
  .pill::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1.2px;
    background: conic-gradient(from var(--ai-angle), #63bfc9, #b19be0, #63bfc9, #b19be0, #63bfc9);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    animation: ai-spin 3.2s linear infinite;
    pointer-events: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .pill, .pill::before { animation: none; }
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #22d3ee;
    box-shadow: 0 0 10px #22d3ee;
    animation: pulse 1.5s infinite ease-in-out;
    flex-shrink: 0;
  }
  .pill[data-status="acting"] .dot { background: #34d399; box-shadow: 0 0 10px #34d399; }
  .pill[data-status="paused"] .dot, .pill[data-status="takeover"] .dot { background: #fbbf24; box-shadow: 0 0 10px #fbbf24; }
  .pill[data-status="done"] .dot { background: #34d399; animation: none; }
  .pill[data-status="error"] .dot { background: #f87171; animation: none; }
  .pill[data-status="idle"] .dot { background: #64748b; box-shadow: none; animation: none; }
  .msg {
    flex: 1;
    min-width: 0;
    padding: 3px 8px;
    border-radius: 7px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: transparent;
    font-size: 11px;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  button {
    -webkit-app-region: no-drag;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    transition: all 0.14s ease;
    white-space: nowrap;
  }
  button:hover {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(99, 191, 201, 0.5);
  }
  button.takeover {
    background: rgba(99, 191, 201, 0.14);
    border-color: rgba(99, 191, 201, 0.45);
    color: #a5e3ea;
  }
  button.return-agent {
    background: rgba(52, 211, 153, 0.2);
    border-color: rgba(52, 211, 153, 0.55);
    color: #6ee7b7;
  }
  button.stop {
    background: rgba(248, 113, 113, 0.2);
    border-color: rgba(248, 113, 113, 0.5);
    color: #fca5a5;
  }
  button.stop:hover {
    background: rgba(248, 113, 113, 0.32);
  }
</style>
</head>
<body>
  <div id="pill" class="pill" data-status="thinking">
    <span class="dot"></span>
    <div id="thoughtText" class="msg">الآن: جاهز للعمل المباشر على سطح المكتب…</div>
    <div class="actions">
      <button id="btnTakeover" class="takeover" onclick="sendCmd('takeover')" title="استلم التحكم بالماوس والكيبورد">✋ استلم</button>
      <button id="btnPause" onclick="togglePause()" title="إيقاف مؤقت / استئناف">⏸</button>
      <button id="btnStop" class="stop" onclick="sendCmd('stop')" title="إيقاف فوري">⏹ إيقاف</button>
      <button id="btnRestore" onclick="sendCmd('restore_studio')" title="إظهار نافذة NT Studio">🗖</button>
    </div>
  </div>
  <script>
    let currentStatus = 'idle';
    function sendCmd(cmd) {
      console.log('${HUD_CMD_PREFIX}' + cmd);
    }
    function togglePause() {
      if (currentStatus === 'paused' || currentStatus === 'takeover') sendCmd('resume');
      else sendCmd('pause');
    }
    window.__updateHud = function(st) {
      if (!st) return;
      currentStatus = st.status || 'idle';
      const pill = document.getElementById('pill');
      pill.setAttribute('data-status', currentStatus);
      const stepTxt = st.stats && st.stats.steps ? ' [#' + st.stats.steps + '] ' : '';
      document.getElementById('thoughtText').textContent = 'الآن:' + stepTxt + (st.thought || 'يتحكم بسطح المكتب…');
      const btnTakeover = document.getElementById('btnTakeover');
      if (currentStatus === 'takeover') {
        btnTakeover.textContent = '🤖 أعد الإيجنت';
        btnTakeover.className = 'return-agent';
        btnTakeover.onclick = function() { sendCmd('return'); };
      } else {
        btnTakeover.textContent = '✋ استلم';
        btnTakeover.className = 'takeover';
        btnTakeover.onclick = function() { sendCmd('takeover'); };
      }
      const btnPause = document.getElementById('btnPause');
      btnPause.textContent = (currentStatus === 'paused') ? '▶' : '⏸';
    };
  </script>
</body>
</html>`
}

export class FloatingHudManager {
  private win: BrowserWindow | null = null
  private ready = false
  private onCommand: ((action: ComputerControlAction) => void) | null = null
  private lastState: ComputerState | null = null

  setCommandHandler(fn: (action: ComputerControlAction) => void) {
    this.onCommand = fn
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const disp = screen.getPrimaryDisplay()
    const w = 480
    const h = 48
    const x = Math.round(disp.bounds.x + (disp.bounds.width - w) / 2)
    const y = disp.bounds.y + 10

    const win = new BrowserWindow({
      width: w,
      height: h,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    try {
      win.setContentProtection(true)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {}

    win.webContents.on('console-message', (...args: any[]) => {
      const first = args[0]
      const msg = typeof first === 'object' && first && 'message' in first ? String(first.message) : String(args[2] ?? '')
      if (msg.startsWith(HUD_CMD_PREFIX)) {
        const cmd = msg.slice(HUD_CMD_PREFIX.length).trim() as ComputerControlAction
        this.onCommand?.(cmd)
      }
    })

    win.on('closed', () => {
      this.win = null
      this.ready = false
    })

    this.ready = false
    const htmlUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(buildHudHtml())
    void win.loadURL(htmlUrl).then(() => {
      this.ready = true
      if (this.lastState) this.pushState(this.lastState)
    }).catch((e) => log.warn('تعذّر تحميل الشريط العائم', String(e)))

    this.win = win
    return win
  }

  show(state?: ComputerState) {
    try {
      if (state) this.lastState = state
      const w = this.ensureWindow()
      if (!w.isVisible()) w.showInactive()
      if (this.ready && this.lastState) this.pushState(this.lastState)
    } catch (e) {
      log.warn('تعذّر إظهار الشريط العائم', String(e))
    }
  }

  hide() {
    try {
      if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
        this.win.hide()
      }
    } catch {}
  }

  destroy() {
    try {
      if (this.win && !this.win.isDestroyed()) this.win.close()
    } catch {}
    this.win = null
    this.ready = false
  }

  pushState(state: ComputerState) {
    this.lastState = state
    try {
      if (!this.win || this.win.isDestroyed() || !this.ready) return
      void this.win.webContents.executeJavaScript(`window.__updateHud && window.__updateHud(${JSON.stringify(state)})`).catch(() => {})
    } catch {}
  }
}

export const floatingHud = new FloatingHudManager()
