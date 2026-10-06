/**
 * تشديد Electron بعد البناء.
 *
 * التطبيق يبني مشاريع ويشغّل خوادم — أي بيئة تنفيذ. لذلك نطفئ ما يوسّع سطح
 * الهجوم بلا فائدة، ونفعّل فحص سلامة asar لكشف العبث بعد التوزيع.
 *
 * نستخدم CLI لا المكتبة: @electron/fuses حزمة ESM-only، بينما electron-builder
 * يستدعي afterPack عبر require() CommonJS، واستيرادها مباشرة يُسقط البناء.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const KEYS = [
  'RunAsNode=off',
  'EnableCookieEncryption=on',
  'EnableNodeOptionsEnvironmentVariable=off',
  'EnableNodeCliInspectArguments=off',
  'EnableEmbeddedAsarIntegrityValidation=on',
  'OnlyLoadAppFromAsar=on',
]

/** يجد ملف exe الخاص بالتطبيق داخل مجلد الحزمة. */
function findExecutable(appOutDir) {
  const entries = fs
    .readdirSync(appOutDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
    .map((e) => e.name)

  if (entries.length === 0) {
    throw new Error(`no .exe found in ${appOutDir}`)
  }
  // نتجاهل أدواتHelper مثل crashpad_handler
  const app =
    entries.find((n) => !/crashpad|updater|snapshot/i.test(n)) ?? entries[0]
  return path.join(appOutDir, app)
}

export default function afterPack(context) {
  const exePath = findExecutable(context.appOutDir)
  const bin = path.join(process.cwd(), 'node_modules', '@electron', 'fuses', 'dist', 'bin.js')
  const args = [bin, 'write', '--app', exePath, ...KEYS]

  console.log(`[fuses] ${exePath}`)
  const result = spawn(process.execPath, args, { stdio: 'inherit' })

  return new Promise((resolve, reject) => {
    result.on('error', reject)
    result.on('close', (code) => {
      if (code === 0) {
        console.log('[fuses] ok')
        resolve(undefined)
      } else {
        reject(new Error(`electron-fuses exited with code ${code}`))
      }
    })
  })
}