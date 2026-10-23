import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface Win32WindowInfo {
  hwnd: number
  title: string
  process: string
  pid: number
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  maximized: boolean
}

export interface Win32CursorState {
  x: number
  y: number
  screenW: number
  screenH: number
  activeTitle: string
  activeProc?: string
}

export interface Win32FocusResult {
  ok: boolean
  found: boolean
  focused: boolean
  activeTitle: string
  activeProc: string
}

export interface Win32UiElement {
  id: number
  role: string
  name: string
  cx: number
  cy: number
  x: number
  y: number
  width: number
  height: number
}

export interface Win32HitResult {
  role: string
  name: string
  cx: number
  cy: number
  x: number
  y: number
  width: number
  height: number
}

export function windowMatchesQuery(title: string, proc: string, query: string): boolean {
  let q = String(query ?? '').trim().toLowerCase()
  if (!q) return false
  if (q.endsWith('.exe')) q = q.slice(0, -4)
  const t = String(title ?? '').toLowerCase()
  const p = String(proc ?? '').toLowerCase()
  return (p.length > 0 && p.includes(q)) || t.includes(q)
}

const PS_WORKER_SCRIPT = `
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$csharp = @'
using System;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;

public class NtDesktopWin32 {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("winmm.dll")]
    public static extern uint timeBeginPeriod(uint uPeriod);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL = 0x01000;

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_SHOWWINDOW = 0x0040;

    private static readonly Random rng = new Random();

    static NtDesktopWin32() {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch { try { SetProcessDPIAware(); } catch {} }
        try { timeBeginPeriod(1); } catch {}
    }

    public static int ScreenWidth() { return GetSystemMetrics(0); }
    public static int ScreenHeight() { return GetSystemMetrics(1); }

    public static string ActiveWindowTitle() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        return sb.ToString();
    }

    public static string ActiveWindowProcess() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        uint pid = 0;
        GetWindowThreadProcessId(h, out pid);
        try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }

    public static int AutoDuration(double dist) {
        double d = 52 + 28 * Math.Log(1 + dist / 80.0, 2);
        d += rng.Next(-6, 10);
        return (int)Math.Max(50, Math.Min(185, d));
    }

    private static double Smoother(double t) { return t * t * t * (t * (t * 6 - 15) + 10); }

    public static bool SettleAt(int x, int y) {
        for (int k = 0; k < 4; k++) {
            SetCursorPos(x, y);
            POINT p;
            if (GetCursorPos(out p) && Math.Abs(p.X - x) <= 1 && Math.Abs(p.Y - y) <= 1) return true;
            Thread.Sleep(5);
        }
        return false;
    }

    public static void SmoothMove(int targetX, int targetY, int durationMs) {
        POINT start;
        if (!GetCursorPos(out start)) { SettleAt(targetX, targetY); return; }
        double dx = targetX - start.X;
        double dy = targetY - start.Y;
        double dist = Math.Sqrt(dx * dx + dy * dy);
        if (dist < 3) { SettleAt(targetX, targetY); return; }
        if (durationMs < 0) durationMs = AutoDuration(dist);
        if (durationMs <= 8) { SettleAt(targetX, targetY); return; }

        double nx = -dy / dist;
        double ny = dx / dist;
        double bend = Math.Min(28.0, dist * 0.045) * (rng.Next(0, 2) == 0 ? 1 : -1) * (0.5 + rng.NextDouble() * 0.5);
        double c1x = start.X + dx * 0.30 + nx * bend, c1y = start.Y + dy * 0.30 + ny * bend;
        double c2x = start.X + dx * 0.72 + nx * bend * 0.5, c2y = start.Y + dy * 0.72 + ny * bend * 0.5;

        int steps = Math.Max(8, Math.Min(45, durationMs / 6));
        Stopwatch sw = Stopwatch.StartNew();
        for (int i = 1; i <= steps; i++) {
            double t = Smoother((double)i / steps);
            double u = 1.0 - t;
            double px = u * u * u * start.X + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * targetX;
            double py = u * u * u * start.Y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * targetY;
            SetCursorPos((int)Math.Round(px), (int)Math.Round(py));
            int due = (int)((long)durationMs * i / steps);
            int wait = due - (int)sw.ElapsedMilliseconds;
            if (wait > 0) Thread.Sleep(wait);
        }
        SettleAt(targetX, targetY);
    }

    public static void Click(string button, int x, int y, int count, int moveMs) {
        if (x >= 0 && y >= 0) {
            SmoothMove(x, y, moveMs);
            Thread.Sleep(rng.Next(18, 32));
        }
        uint down = MOUSEEVENTF_LEFTDOWN;
        uint up = MOUSEEVENTF_LEFTUP;
        if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
        else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }

        int n = Math.Max(1, Math.Min(3, count));
        for (int i = 0; i < n; i++) {
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(rng.Next(20, 38));
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            if (i + 1 < n) Thread.Sleep(rng.Next(32, 52));
        }
    }

    public static void MouseButton(string button, bool isDown, int x, int y) {
        if (x >= 0 && y >= 0) {
            SmoothMove(x, y, -1);
            Thread.Sleep(rng.Next(18, 35));
        }
        uint flag = isDown ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
        if (button == "right") flag = isDown ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
        else if (button == "middle") flag = isDown ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
        mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Drag(int startX, int startY, int endX, int endY) {
        if (startX >= 0 && startY >= 0) {
            SmoothMove(startX, startY, -1);
            Thread.Sleep(rng.Next(35, 60));
        }
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(rng.Next(45, 75));
        POINT cur;
        double dist = 0;
        if (GetCursorPos(out cur)) {
            double ddx = endX - cur.X;
            double ddy = endY - cur.Y;
            dist = Math.Sqrt(ddx * ddx + ddy * ddy);
        }
        SmoothMove(endX, endY, Math.Max(160, AutoDuration(dist) + 45));
        Thread.Sleep(rng.Next(35, 65));
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Scroll(string dir, int amount, int x, int y) {
        if (x >= 0 && y >= 0) {
            SmoothMove(x, y, -1);
            Thread.Sleep(rng.Next(20, 40));
        }
        int clicks = Math.Max(1, Math.Min(60, amount));
        bool horizontal = (dir == "left" || dir == "right");
        int sign = (dir == "up" || dir == "right") ? 1 : -1;
        for (int i = 0; i < clicks; i++) {
            mouse_event(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, 0, 0, 120 * sign, UIntPtr.Zero);
            if (i + 1 < clicks) Thread.Sleep(rng.Next(10, 20));
        }
    }

    private static void FlushUnicode(List<ushort> buf) {
        if (buf.Count == 0) return;
        INPUT[] inputs = new INPUT[buf.Count * 2];
        for (int i = 0; i < buf.Count; i++) {
            inputs[2 * i].type = INPUT_KEYBOARD;
            inputs[2 * i].U.ki.wVk = 0;
            inputs[2 * i].U.ki.wScan = buf[i];
            inputs[2 * i].U.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[2 * i + 1].type = INPUT_KEYBOARD;
            inputs[2 * i + 1].U.ki.wVk = 0;
            inputs[2 * i + 1].U.ki.wScan = buf[i];
            inputs[2 * i + 1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        }
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        buf.Clear();
    }

    public static void TypeUnicode(string text, int delayMs) {
        if (string.IsNullOrEmpty(text)) return;
        bool burst = text.Length > 70;
        int baseD = delayMs > 0 ? Math.Min(40, delayMs) : 6;
        List<ushort> buf = new List<ushort>();
        for (int idx = 0; idx < text.Length; idx++) {
            char ch = text[idx];
            if (ch == (char)13) continue;
            if (ch == (char)10 || ch == (char)9) {
                FlushUnicode(buf);
                byte vk = ch == (char)10 ? (byte)0x0D : (byte)0x09;
                keybd_event(vk, 0, 0, UIntPtr.Zero);
                Thread.Sleep(10);
                keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                Thread.Sleep(burst ? 6 : 12);
                continue;
            }
            buf.Add((ushort)ch);
            if (burst) {
                if (buf.Count >= 20) { FlushUnicode(buf); Thread.Sleep(3); }
                continue;
            }
            if (buf.Count >= 2) {
                FlushUnicode(buf);
                Thread.Sleep(Math.Max(3, baseD));
            }
        }
        FlushUnicode(buf);
    }

    public static void PressVk(byte[] modifiers, byte mainKey, int holdMs) {
        foreach (byte m in modifiers) {
            keybd_event(m, 0, 0, UIntPtr.Zero);
            Thread.Sleep(12);
        }
        if (mainKey != 0) {
            keybd_event(mainKey, 0, 0, UIntPtr.Zero);
            Thread.Sleep(Math.Max(25, Math.Min(5000, holdMs)));
            keybd_event(mainKey, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        } else if (holdMs > 0) {
            Thread.Sleep(Math.Min(5000, holdMs));
        }
        for (int i = modifiers.Length - 1; i >= 0; i--) {
            Thread.Sleep(10);
            keybd_event(modifiers[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }
    }

    public static bool IsForeground(IntPtr hWnd) {
        return hWnd != IntPtr.Zero && GetForegroundWindow() == hWnd;
    }

    private static bool ForceForeground(IntPtr hWnd) {
        IntPtr fg = GetForegroundWindow();
        uint dummy = 0;
        uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
        uint targetThread = GetWindowThreadProcessId(hWnd, out dummy);
        uint curThread = GetCurrentThreadId();
        bool attachedFg = false, attachedTarget = false;
        try {
            if (fgThread != 0 && fgThread != curThread) attachedFg = AttachThreadInput(curThread, fgThread, true);
            if (targetThread != 0 && targetThread != curThread) attachedTarget = AttachThreadInput(curThread, targetThread, true);
            BringWindowToTop(hWnd);
            SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            SetForegroundWindow(hWnd);
        } finally {
            if (attachedTarget) AttachThreadInput(curThread, targetThread, false);
            if (attachedFg) AttachThreadInput(curThread, fgThread, false);
        }
        Thread.Sleep(90);
        return IsForeground(hWnd);
    }

    private static bool ForceForegroundWithAltUnlock(IntPtr hWnd) {
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        Thread.Sleep(30);
        keybd_event(0x12, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(70);
        return ForceForeground(hWnd);
    }

    public static int FocusWindowByQuery(string query, bool maximize) {
        string q = (query ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(q)) return 0;
        if (q.EndsWith(".exe")) q = q.Substring(0, q.Length - 4);
        IntPtr found = IntPtr.Zero;
        int bestScore = 0;
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            string title = sb.ToString();
            if (string.IsNullOrWhiteSpace(title)) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            string procName = "";
            try { procName = Process.GetProcessById((int)pid).ProcessName; } catch { }
            string p = procName.ToLowerInvariant();
            string t = title.ToLowerInvariant();
            int score = 0;
            if (p == q) score = 100;
            else if (p.Contains(q)) score = 80;
            else if (t.StartsWith(q)) score = 70;
            else if (t.Contains(q)) score = 60;
            if (score > bestScore) {
                bestScore = score;
                found = hWnd;
            }
            return score < 100;
        }, IntPtr.Zero);

        if (found == IntPtr.Zero) return 0;
        if (IsIconic(found)) ShowWindow(found, 9);
        if (maximize) ShowWindow(found, 3);
        if (IsForeground(found)) return 1;
        if (ForceForeground(found)) return 1;
        if (ForceForegroundWithAltUnlock(found)) return 1;
        return IsForeground(found) ? 1 : 2;
    }

    public static string EscJson(string s) {
        if (string.IsNullOrEmpty(s)) return "";
        return s.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\r", " ").Replace("\\n", " ").Replace("\\t", " ");
    }

    public static string ListWindowsJson() {
        List<string> items = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            string title = sb.ToString().Trim();
            if (string.IsNullOrEmpty(title)) return true;
            RECT r;
            GetWindowRect(hWnd, out r);
            int w = Math.Max(0, r.Right - r.Left);
            int h = Math.Max(0, r.Bottom - r.Top);
            if (w < 40 && h < 40 && !IsIconic(hWnd)) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            string procName = "";
            try { procName = Process.GetProcessById((int)pid).ProcessName; } catch {}
            string item = "{"
                + "\\"hwnd\\":" + hWnd.ToInt64() + ","
                + "\\"title\\":\\"" + EscJson(title) + "\\","
                + "\\"process\\":\\"" + EscJson(procName) + "\\","
                + "\\"pid\\":" + pid + ","
                + "\\"x\\":" + r.Left + ","
                + "\\"y\\":" + r.Top + ","
                + "\\"width\\":" + w + ","
                + "\\"height\\":" + h + ","
                + "\\"minimized\\":" + (IsIconic(hWnd) ? "true" : "false") + ","
                + "\\"maximized\\":" + (IsZoomed(hWnd) ? "true" : "false")
                + "}";
            items.Add(item);
            return items.Count < 40;
        }, IntPtr.Zero);
        return "[" + string.Join(",", items.ToArray()) + "]";
    }

    private static string CleanRole(ControlType ct) {
        if (ct == null) return "Control";
        string p = ct.ProgrammaticName ?? "Control";
        int dot = p.IndexOf('.');
        return dot >= 0 ? p.Substring(dot + 1) : p;
    }

    public static string HitTestJson(int x, int y) {
        try {
            AutomationElement el = AutomationElement.FromPoint(new System.Windows.Point(x, y));
            if (el == null) return "null";
            string name = (el.Current.Name ?? "").Trim();
            string role = CleanRole(el.Current.ControlType);
            Rect r = el.Current.BoundingRectangle;
            if (r.IsEmpty || double.IsInfinity(r.Left) || double.IsInfinity(r.Top) || r.Width <= 0 || r.Height <= 0) {
                return "null";
            }
            int rx = (int)Math.Round(r.Left);
            int ry = (int)Math.Round(r.Top);
            int rw = (int)Math.Round(r.Width);
            int rh = (int)Math.Round(r.Height);
            int cx = rx + rw / 2;
            int cy = ry + rh / 2;
            return "{"
                + "\\"role\\":\\"" + EscJson(role) + "\\","
                + "\\"name\\":\\"" + EscJson(name) + "\\","
                + "\\"cx\\":" + cx + ","
                + "\\"cy\\":" + cy + ","
                + "\\"x\\":" + rx + ","
                + "\\"y\\":" + ry + ","
                + "\\"width\\":" + rw + ","
                + "\\"height\\":" + rh
                + "}";
        } catch {
            return "null";
        }
    }

    public static string InspectUiJson(int maxItems) {
        try {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return "[]";
            AutomationElement win = AutomationElement.FromHandle(fg);
            if (win == null) return "[]";

            CacheRequest cache = new CacheRequest();
            cache.Add(AutomationElement.NameProperty);
            cache.Add(AutomationElement.ControlTypeProperty);
            cache.Add(AutomationElement.BoundingRectangleProperty);
            cache.Add(AutomationElement.IsOffscreenProperty);
            cache.Add(AutomationElement.IsEnabledProperty);
            cache.TreeScope = TreeScope.Element | TreeScope.Descendants;

            Condition cond = new OrCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.RadioButton)
            );

            int sw = ScreenWidth();
            int sh = ScreenHeight();
            List<string> items = new List<string>();
            HashSet<string> seen = new HashSet<string>();
            int seq = 0;

            using (cache.Activate()) {
                AutomationElementCollection els = win.FindAll(TreeScope.Descendants, cond);
                if (els == null) return "[]";
                foreach (AutomationElement el in els) {
                    if (items.Count >= maxItems) break;
                    try {
                        if (el.Cached.IsOffscreen || !el.Cached.IsEnabled) continue;
                        Rect r = el.Cached.BoundingRectangle;
                        if (r.IsEmpty || double.IsInfinity(r.Left) || r.Width < 8 || r.Height < 8) continue;
                        int rx = (int)Math.Round(r.Left);
                        int ry = (int)Math.Round(r.Top);
                        int rw = (int)Math.Round(r.Width);
                        int rh = (int)Math.Round(r.Height);
                        int cx = rx + rw / 2;
                        int cy = ry + rh / 2;
                        if (cx < 0 || cy < 0 || cx >= sw || cy >= sh) continue;
                        string name = (el.Cached.Name ?? "").Trim();
                        string role = CleanRole(el.Cached.ControlType);
                        if (string.IsNullOrEmpty(name) && role != "Edit") continue;
                        if (name.Length > 80) name = name.Substring(0, 80);
                        string dedup = role + "|" + name + "|" + (cx / 8) + "," + (cy / 8);
                        if (seen.Contains(dedup)) continue;
                        seen.Add(dedup);
                        seq++;
                        items.Add("{"
                            + "\\"id\\":" + seq + ","
                            + "\\"role\\":\\"" + EscJson(role) + "\\","
                            + "\\"name\\":\\"" + EscJson(name) + "\\","
                            + "\\"cx\\":" + cx + ","
                            + "\\"cy\\":" + cy + ","
                            + "\\"x\\":" + rx + ","
                            + "\\"y\\":" + ry + ","
                            + "\\"width\\":" + rw + ","
                            + "\\"height\\":" + rh
                            + "}");
                    } catch { continue; }
                }
            }
            return "[" + string.Join(",", items.ToArray()) + "]";
        } catch {
            return "[]";
        }
    }

    public static string FindTargetJson(string query) {
        string q = (query ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(q)) return "null";
        try {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return "null";
            AutomationElement win = AutomationElement.FromHandle(fg);
            if (win == null) return "null";

            CacheRequest cache = new CacheRequest();
            cache.Add(AutomationElement.NameProperty);
            cache.Add(AutomationElement.ControlTypeProperty);
            cache.Add(AutomationElement.BoundingRectangleProperty);
            cache.Add(AutomationElement.IsOffscreenProperty);
            cache.Add(AutomationElement.IsEnabledProperty);
            cache.TreeScope = TreeScope.Element | TreeScope.Descendants;

            Condition cond = new OrCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.RadioButton),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text)
            );

            int sw = ScreenWidth();
            int sh = ScreenHeight();
            int bestScore = 0;
            string bestJson = "null";

            using (cache.Activate()) {
                AutomationElementCollection els = win.FindAll(TreeScope.Descendants, cond);
                if (els == null) return "null";
                foreach (AutomationElement el in els) {
                    try {
                        if (el.Cached.IsOffscreen || !el.Cached.IsEnabled) continue;
                        string name = (el.Cached.Name ?? "").Trim();
                        if (string.IsNullOrEmpty(name)) continue;
                        Rect r = el.Cached.BoundingRectangle;
                        if (r.IsEmpty || double.IsInfinity(r.Left) || r.Width < 6 || r.Height < 6) continue;
                        int rx = (int)Math.Round(r.Left);
                        int ry = (int)Math.Round(r.Top);
                        int rw = (int)Math.Round(r.Width);
                        int rh = (int)Math.Round(r.Height);
                        int cx = rx + rw / 2;
                        int cy = ry + rh / 2;
                        if (cx < 0 || cy < 0 || cx >= sw || cy >= sh) continue;

                        string nl = name.ToLowerInvariant();
                        int score = 0;
                        if (nl == q) score = 100;
                        else if (nl.StartsWith(q)) score = 85;
                        else if (nl.Contains(q)) score = 70;
                        else if (q.Contains(nl) && nl.Length >= 3) score = 55;
                        if (score == 0) continue;

                        string role = CleanRole(el.Cached.ControlType);
                        if (role != "Text") score += 5;

                        if (score > bestScore) {
                            bestScore = score;
                            bestJson = "{"
                                + "\\"role\\":\\"" + EscJson(role) + "\\","
                                + "\\"name\\":\\"" + EscJson(name.Length > 80 ? name.Substring(0, 80) : name) + "\\","
                                + "\\"cx\\":" + cx + ","
                                + "\\"cy\\":" + cy + ","
                                + "\\"x\\":" + rx + ","
                                + "\\"y\\":" + ry + ","
                                + "\\"width\\":" + rw + ","
                                + "\\"height\\":" + rh
                                + "}";
                        }
                    } catch { continue; }
                }
            }
            return bestJson;
        } catch {
            return "null";
        }
    }

    public static string FocusTargetJson(string query) {
        try {
            AutomationElement el = FindBestByName(query);
            if (el == null) return "null";
            string name = (el.Current.Name ?? "").Trim();
            string role = CleanRole(el.Current.ControlType);
            Rect r = el.Current.BoundingRectangle;
            bool focused = false;
            try { el.SetFocus(); focused = true; } catch { focused = false; }
            Thread.Sleep(25);
            int rx = (int)Math.Round(r.Left);
            int ry = (int)Math.Round(r.Top);
            int rw = (int)Math.Round(r.Width);
            int rh = (int)Math.Round(r.Height);
            return "{"
                + "\\"role\\":\\"" + EscJson(role) + "\\","
                + "\\"name\\":\\"" + EscJson(name.Length > 80 ? name.Substring(0, 80) : name) + "\\","
                + "\\"cx\\":" + (rx + rw / 2) + ","
                + "\\"cy\\":" + (ry + rh / 2) + ","
                + "\\"x\\":" + rx + ","
                + "\\"y\\":" + ry + ","
                + "\\"width\\":" + rw + ","
                + "\\"height\\":" + rh + ","
                + "\\"focused\\":" + (focused ? "true" : "false")
                + "}";
        } catch {
            return "null";
        }
    }

    public static string EnsureNoDialogJson() {
        try {
            IntPtr fg = GetForegroundWindow();
            StringBuilder cls = new StringBuilder(256);
            GetClassName(fg, cls, 256);
            string cn = cls.ToString();
            string title = ActiveWindowTitle();
            if (cn == "#32770") {
                keybd_event(0x1B, 0, 0, UIntPtr.Zero);
                Thread.Sleep(25);
                keybd_event(0x1B, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                Thread.Sleep(70);
                return "{\\"ok\\":false,\\"closed\\":true,\\"dialog\\":\\"" + EscJson(title) + "\\"}";
            }
            return "{\\"ok\\":true,\\"closed\\":false,\\"window\\":\\"" + EscJson(title) + "\\"}";
        } catch {
            return "{\\"ok\\":true,\\"closed\\":false}";
        }
    }

    private static AutomationElement FindBestByName(string query) {
        string q = (query ?? "").Trim().ToLowerInvariant();
        if (q.Length == 0) return null;
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return null;
        AutomationElement win = AutomationElement.FromHandle(fg);
        if (win == null) return null;

        CacheRequest cache = new CacheRequest();
        cache.Add(AutomationElement.NameProperty);
        cache.Add(AutomationElement.ControlTypeProperty);
        cache.Add(AutomationElement.BoundingRectangleProperty);
        cache.Add(AutomationElement.IsOffscreenProperty);
        cache.Add(AutomationElement.IsEnabledProperty);
        cache.TreeScope = TreeScope.Element | TreeScope.Descendants;

        Condition cond = new OrCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.RadioButton),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text)
        );

        int sw = ScreenWidth();
        int sh = ScreenHeight();
        AutomationElement best = null;
        int bestScore = 0;

        using (cache.Activate()) {
            AutomationElementCollection els = win.FindAll(TreeScope.Descendants, cond);
            if (els == null) return null;
            foreach (AutomationElement el in els) {
                try {
                    if (el.Cached.IsOffscreen || !el.Cached.IsEnabled) continue;
                    string name = (el.Cached.Name ?? "").Trim();
                    if (name.Length == 0) continue;
                    Rect r = el.Cached.BoundingRectangle;
                    if (r.IsEmpty || double.IsInfinity(r.Left) || r.Width < 6 || r.Height < 6) continue;
                    int cx = (int)Math.Round(r.Left) + (int)Math.Round(r.Width) / 2;
                    int cy = (int)Math.Round(r.Top) + (int)Math.Round(r.Height) / 2;
                    if (cx < 0 || cy < 0 || cx >= sw || cy >= sh) continue;
                    string nl = name.ToLowerInvariant();
                    int score = 0;
                    if (nl == q) score = 100;
                    else if (nl.StartsWith(q)) score = 85;
                    else if (nl.Contains(q)) score = 70;
                    else if (q.Contains(nl) && nl.Length >= 3) score = 55;
                    if (score == 0) continue;
                    if (CleanRole(el.Cached.ControlType) != "Text") score += 5;
                    if (score > bestScore) { bestScore = score; best = el; }
                } catch { continue; }
            }
        }
        return best;
    }
}
'@

Add-Type -TypeDefinition $csharp -Language CSharp -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase

function Resolve-VkCode([string]$k) {
    $u = $k.Trim().ToLowerInvariant()
    switch ($u) {
        "return" { return 0x0D }
        "enter" { return 0x0D }
        "kp_enter" { return 0x0D }
        "escape" { return 0x1B }
        "esc" { return 0x1B }
        "tab" { return 0x09 }
        "backspace" { return 0x08 }
        "back_space" { return 0x08 }
        "delete" { return 0x2E }
        "del" { return 0x2E }
        "insert" { return 0x2D }
        "space" { return 0x20 }
        " " { return 0x20 }
        "up" { return 0x26 }
        "arrowup" { return 0x26 }
        "down" { return 0x28 }
        "arrowdown" { return 0x28 }
        "left" { return 0x25 }
        "arrowleft" { return 0x25 }
        "right" { return 0x27 }
        "arrowright" { return 0x27 }
        "home" { return 0x24 }
        "end" { return 0x23 }
        "pageup" { return 0x21 }
        "page_up" { return 0x21 }
        "prior" { return 0x21 }
        "pagedown" { return 0x22 }
        "page_down" { return 0x22 }
        "next" { return 0x22 }
        "win" { return 0x5B }
        "super" { return 0x5B }
        "super_l" { return 0x5B }
        "meta" { return 0x5B }
        "f1" { return 0x70 }
        "f2" { return 0x71 }
        "f3" { return 0x72 }
        "f4" { return 0x73 }
        "f5" { return 0x74 }
        "f6" { return 0x75 }
        "f7" { return 0x76 }
        "f8" { return 0x77 }
        "f9" { return 0x78 }
        "f10" { return 0x79 }
        "f11" { return 0x7A }
        "f12" { return 0x7B }
        "plus" { return 0xBB }
        "equal" { return 0xBB }
        "=" { return 0xBB }
        "minus" { return 0xBD }
        "-" { return 0xBD }
        default {
            if ($u.Length -eq 1) {
                $ch = [int][char]$u.ToUpperInvariant()
                if (($ch -ge 0x30 -and $ch -le 0x39) -or ($ch -ge 0x41 -and $ch -le 0x5A)) {
                    return [byte]$ch
                }
            }
            return 0
        }
    }
}

Write-Output '{"ready":true}'

while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $id = 0
    try {
        $req = $line | ConvertFrom-Json
        $id = $req.id
        $cmd = [string]$req.cmd

        switch ($cmd) {
            "exit" {
                break
            }
            "cursor" {
                $pt = New-Object NtDesktopWin32+POINT
                [void][NtDesktopWin32]::GetCursorPos([ref]$pt)
                $res = @{
                    id = $id
                    ok = $true
                    x = $pt.X
                    y = $pt.Y
                    screenW = [NtDesktopWin32]::ScreenWidth()
                    screenH = [NtDesktopWin32]::ScreenHeight()
                    activeTitle = [NtDesktopWin32]::ActiveWindowTitle()
                    activeProc = [NtDesktopWin32]::ActiveWindowProcess()
                }
                Write-Output ($res | ConvertTo-Json -Compress)
            }
            "move" {
                $dur = if ($null -ne $req.durationMs) { [int]$req.durationMs } else { -1 }
                [NtDesktopWin32]::SmoothMove([int]$req.x, [int]$req.y, $dur)
                $pt = New-Object NtDesktopWin32+POINT
                [void][NtDesktopWin32]::GetCursorPos([ref]$pt)
                $hit = [NtDesktopWin32]::HitTestJson($pt.X, $pt.Y)
                $at = [NtDesktopWin32]::EscJson([NtDesktopWin32]::ActiveWindowTitle())
                Write-Output ("{""id"":$id,""ok"":true,""x"":$($pt.X),""y"":$($pt.Y),""activeTitle"":""$at"",""hit"":$hit}")
            }
            "click" {
                $btn = if ($req.button) { [string]$req.button } else { "left" }
                $cnt = if ($null -ne $req.count) { [int]$req.count } elseif ([bool]$req.double) { 2 } else { 1 }
                $mv = if ($null -ne $req.moveMs) { [int]$req.moveMs } else { -1 }
                [NtDesktopWin32]::Click($btn, [int]$req.x, [int]$req.y, $cnt, $mv)
                $pt = New-Object NtDesktopWin32+POINT
                [void][NtDesktopWin32]::GetCursorPos([ref]$pt)
                $hit = [NtDesktopWin32]::HitTestJson($pt.X, $pt.Y)
                $at = [NtDesktopWin32]::EscJson([NtDesktopWin32]::ActiveWindowTitle())
                Write-Output ("{""id"":$id,""ok"":true,""x"":$($pt.X),""y"":$($pt.Y),""activeTitle"":""$at"",""hit"":$hit}")
            }
            "mouseButton" {
                $btn = if ($req.button) { [string]$req.button } else { "left" }
                [NtDesktopWin32]::MouseButton($btn, [bool]$req.down, [int]$req.x, [int]$req.y)
                Write-Output (@{ id = $id; ok = $true; activeTitle = [NtDesktopWin32]::ActiveWindowTitle() } | ConvertTo-Json -Compress)
            }
            "drag" {
                [NtDesktopWin32]::Drag([int]$req.startX, [int]$req.startY, [int]$req.endX, [int]$req.endY)
                $pt = New-Object NtDesktopWin32+POINT
                [void][NtDesktopWin32]::GetCursorPos([ref]$pt)
                Write-Output (@{ id = $id; ok = $true; x = $pt.X; y = $pt.Y; activeTitle = [NtDesktopWin32]::ActiveWindowTitle() } | ConvertTo-Json -Compress)
            }
            "scroll" {
                $dir = if ($req.direction) { [string]$req.direction } else { "down" }
                $amt = if ($null -ne $req.amount) { [int]$req.amount } else { 3 }
                $sx = if ($null -ne $req.x) { [int]$req.x } else { -1 }
                $sy = if ($null -ne $req.y) { [int]$req.y } else { -1 }
                [NtDesktopWin32]::Scroll($dir, $amt, $sx, $sy)
                Write-Output (@{ id = $id; ok = $true; activeTitle = [NtDesktopWin32]::ActiveWindowTitle() } | ConvertTo-Json -Compress)
            }
            "type" {
                if ([bool]$req.clear) {
                    [NtDesktopWin32]::PressVk([byte[]]@(0x11), [byte]0x41, 20)
                    [System.Threading.Thread]::Sleep(15)
                    [NtDesktopWin32]::PressVk([byte[]]@(), [byte]0x08, 20)
                    [System.Threading.Thread]::Sleep(15)
                }
                $dl = if ($null -ne $req.delayMs) { [int]$req.delayMs } else { 0 }
                [NtDesktopWin32]::TypeUnicode([string]$req.text, $dl)
                Write-Output (@{ id = $id; ok = $true; activeTitle = [NtDesktopWin32]::ActiveWindowTitle() } | ConvertTo-Json -Compress)
            }
            "key" {
                $combo = ([string]$req.key).Trim()
                $parts = $combo -split '\\+'
                $mods = New-Object System.Collections.Generic.List[byte]
                $mainKey = [byte]0
                foreach ($p in $parts) {
                    $pl = $p.Trim().ToLowerInvariant()
                    if ($pl -eq "ctrl" -or $pl -eq "control") { $mods.Add(0x11) }
                    elseif ($pl -eq "alt" -or $pl -eq "menu") { $mods.Add(0x12) }
                    elseif ($pl -eq "shift") { $mods.Add(0x10) }
                    elseif ($pl -eq "win" -or $pl -eq "super" -or $pl -eq "meta" -or $pl -eq "cmd") { $mods.Add(0x5B) }
                    else { $mainKey = Resolve-VkCode $pl }
                }
                $hm = if ($null -ne $req.holdMs) { [int]$req.holdMs } else { 30 }
                if ($mainKey -eq 0 -and $mods.Count -eq 0 -and $combo.Length -eq 1) {
                    [NtDesktopWin32]::TypeUnicode($combo, 10)
                } else {
                    [NtDesktopWin32]::PressVk($mods.ToArray(), $mainKey, $hm)
                }
                Write-Output (@{ id = $id; ok = $true; activeTitle = [NtDesktopWin32]::ActiveWindowTitle() } | ConvertTo-Json -Compress)
            }
            "windows" {
                $jsonArr = [NtDesktopWin32]::ListWindowsJson()
                Write-Output ("{""id"":$id,""ok"":true,""windows"":$jsonArr}")
            }
            "focusWindow" {
                $r = [NtDesktopWin32]::FocusWindowByQuery([string]$req.query, [bool]$req.maximize)
                $at = [NtDesktopWin32]::ActiveWindowTitle()
                $ap = [NtDesktopWin32]::ActiveWindowProcess()
                Write-Output (@{ id = $id; ok = $true; found = ($r -ne 0); focused = ($r -eq 1); activeTitle = $at; activeProc = $ap } | ConvertTo-Json -Compress)
            }
            "foreground" {
                Write-Output (@{ id = $id; ok = $true; activeTitle = [NtDesktopWin32]::ActiveWindowTitle(); activeProc = [NtDesktopWin32]::ActiveWindowProcess() } | ConvertTo-Json -Compress)
            }
            "hitTest" {
                $hit = [NtDesktopWin32]::HitTestJson([int]$req.x, [int]$req.y)
                Write-Output ("{""id"":$id,""ok"":true,""hit"":$hit}")
            }
            "inspectUi" {
                $max = if ($null -ne $req.maxItems) { [int]$req.maxItems } else { 40 }
                $arr = [NtDesktopWin32]::InspectUiJson($max)
                $at = [NtDesktopWin32]::EscJson([NtDesktopWin32]::ActiveWindowTitle())
                $ap = [NtDesktopWin32]::EscJson([NtDesktopWin32]::ActiveWindowProcess())
                Write-Output ("{""id"":$id,""ok"":true,""activeTitle"":""$at"",""activeProc"":""$ap"",""elements"":$arr}")
            }
            "findTarget" {
                $found = [NtDesktopWin32]::FindTargetJson([string]$req.query)
                Write-Output ("{""id"":$id,""ok"":true,""element"":$found}")
            }
            "focusTarget" {
                $found = [NtDesktopWin32]::FocusTargetJson([string]$req.query)
                Write-Output ("{""id"":$id,""ok"":true,""element"":$found}")
            }
            "ensureNoDialog" {
                $r = [NtDesktopWin32]::EnsureNoDialogJson()
                Write-Output ("{""id"":$id,""ok"":true,""result"":$r}")
            }
            default {
                Write-Output (@{ id = $id; ok = $false; error = "Unknown cmd: $cmd" } | ConvertTo-Json -Compress)
            }
        }
    } catch {
        Write-Output (@{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
    }
}
`

interface PendingReq {
  resolve: (val: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class Win32Worker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private readyPromise: Promise<void> | null = null
  private seq = 0
  private bootId = 0
  private pending = new Map<number, PendingReq>()
  private buf = ''
  private scriptPath: string | null = null

  async ensure(): Promise<void> {
    if (this.proc && !this.proc.killed && this.readyPromise) return this.readyPromise
    this.readyPromise = new Promise<void>((resolve, reject) => {
      try {
        const scriptPath = join(tmpdir(), `nt-studio-win32-worker-${process.pid}-${++this.bootId}.ps1`)
        writeFileSync(scriptPath, '\uFEFF' + PS_WORKER_SCRIPT, 'utf8')
        this.scriptPath = scriptPath
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
        )
        this.proc = child
        this.buf = ''
        let settled = false

        const bootTimer = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error('انتهت مهلة تشغيل محرك سطح المكتب Win32'))
          }
        }, 12000)

        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          this.buf += chunk
          let idx: number
          while ((idx = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, idx).trim()
            this.buf = this.buf.slice(idx + 1)
            if (!line || !line.startsWith('{')) continue
            try {
              const msg = JSON.parse(line)
              if (msg.ready && !settled) {
                settled = true
                clearTimeout(bootTimer)
                resolve()
                continue
              }
              if (typeof msg.id === 'number') {
                const p = this.pending.get(msg.id)
                if (p) {
                  this.pending.delete(msg.id)
                  clearTimeout(p.timer)
                  if (msg.ok === false) p.reject(new Error(msg.error || 'فشل أمر Win32'))
                  else p.resolve(msg)
                }
              }
            } catch {}
          }
        })

        child.stderr.setEncoding('utf8')
        child.stderr.on('data', () => {})

        child.on('exit', () => {
          this.cleanupScript()
          this.proc = null
          this.readyPromise = null
          for (const [, p] of this.pending) {
            clearTimeout(p.timer)
            p.reject(new Error('أُغلق محرك Win32'))
          }
          this.pending.clear()
          if (!settled) {
            settled = true
            clearTimeout(bootTimer)
            reject(new Error('توقف محرك Win32 أثناء الإقلاع'))
          }
        })
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    return this.readyPromise
  }

  async call<T = any>(cmd: string, payload: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
    await this.ensure()
    if (!this.proc || this.proc.killed) throw new Error('محرك Win32 غير متاح')
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`انتهت مهلة أمر سطح المكتب (${cmd})`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const line = JSON.stringify({ id, cmd, ...payload }) + '\n'
      this.proc!.stdin.write(line, 'utf8')
    })
  }

  private cleanupScript() {
    const f = this.scriptPath
    this.scriptPath = null
    if (f) { try { unlinkSync(f) } catch {} }
  }

  destroy() {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('أُوقف محرك Win32'))
    }
    this.pending.clear()
    this.cleanupScript()
    const child = this.proc
    this.proc = null
    this.readyPromise = null
    if (child) {
      try { child.stdin?.write('{"id":0,"cmd":"exit"}\n') } catch {}
      try { child.stdin?.end() } catch {}
      try { child.stdout?.removeAllListeners() } catch {}
      try { child.stderr?.removeAllListeners() } catch {}
      try { child.unref() } catch {}
      try { child.kill() } catch {}
    }
  }
}

export const win32Worker = new Win32Worker()
