import { shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { learnApp, learnedApp } from '../agent/agentNotes'
import { sleep } from '../util'
import { APP_ALIASES } from './appAliases'

export function findStartMenuShortcut(query: string): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const roots = [
    process.env['ProgramData'] ? join(process.env['ProgramData'], 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
    process.env['APPDATA'] ? join(process.env['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
    process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'Programs') : ''
  ].filter((p) => p && existsSync(p))

  const matches: { path: string; score: number }[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || matches.length > 25) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full, depth + 1)
      } else if (/\.(lnk|exe)$/i.test(name)) {
        const base = name.replace(/\.(lnk|exe)$/i, '').toLowerCase()
        if (base === q) matches.push({ path: full, score: 100 })
        else if (base.startsWith(q)) matches.push({ path: full, score: 80 })
        else if (base.includes(q)) matches.push({ path: full, score: 60 })
      }
    }
  }
  for (const r of roots) walk(r, 0)
  matches.sort((a, b) => b.score - a.score)
  return matches[0]?.path ?? null
}

export function appQueryHint(appName: string): string {
  const raw = appName.trim()
  const mapped = APP_ALIASES[raw.toLowerCase()]
  return mapped ?? raw
}

export async function launchApplication(
  appNameOrPath: string,
  args: string[] = [],
  minimizeStudioFirst = true,
  minimizeStudio: () => void = () => {}
): Promise<{ ok: boolean; message: string }> {
  const raw = appNameOrPath.trim()
  if (!raw) return { ok: false, message: 'اسم التطبيق فارغ.' }

  if (minimizeStudioFirst) {
    minimizeStudio()
    await sleep(80)
  }

  const lower = raw.toLowerCase()
  const mapped = APP_ALIASES[lower] ?? raw

  const learned = learnedApp(raw)
  if (learned && existsSync(learned)) {
    const err = await shell.openPath(learned)
    if (!err) {
      await sleep(550)
      return { ok: true, message: `شُغّل التطبيق من مساره المحفوظ في الذاكرة: ${learned}` }
    }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(mapped) || /^ms-[a-z0-9-]+:/i.test(mapped)) {
    await shell.openExternal(mapped)
    await sleep(550)
    return { ok: true, message: `فُتح البروتوكول/الرابط: ${mapped}` }
  }

  if (existsSync(mapped)) {
    const err = await shell.openPath(mapped)
    if (!err) {
      learnApp(raw, mapped)
      await sleep(550)
      return { ok: true, message: `فُتح البرنامج من المسار: ${mapped}` }
    }
  }

  const shortcut = findStartMenuShortcut(raw) || (mapped !== raw ? findStartMenuShortcut(mapped) : null)
  if (shortcut) {
    const err = await shell.openPath(shortcut)
    if (!err) {
      learnApp(raw, shortcut)
      await sleep(650)
      return { ok: true, message: `شُغّل التطبيق من قائمة ابدأ: ${shortcut}` }
    }
  }

  return await new Promise<{ ok: boolean; message: string }>((resolve) => {
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '""', mapped, ...args], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore'
      })
      child.on('error', (e) => {
        resolve({ ok: false, message: `تعذّر تشغيل "${raw}": ${e.message}` })
      })
      child.unref()
      setTimeout(() => {
        resolve({ ok: true, message: `شُغّل التطبيق: ${mapped}` })
      }, 550)
    } catch {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', `Start-Process -FilePath '${mapped.replace(/'/g, "''")}'`],
        (err) => {
          if (err)
            resolve({
              ok: false,
              message: `تعذّر العثور على التطبيق "${raw}". جرّب البحث عن مساره أو التحقق من اسمه.`
            })
          else resolve({ ok: true, message: `شُغّل التطبيق: ${mapped}` })
        }
      )
    }
  })
}
