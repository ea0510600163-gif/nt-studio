import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const quick = process.argv.includes('--quick')

const testFiles = [
  'tests/desktopGuard.test.mjs',
  'tests/shellSafe.test.mjs',
  'tests/agentState.test.mjs',
  'tests/agentAccuracy.test.mjs'
]
const env = { ...process.env, ...(quick ? { NT_VERIFY_QUICK: '1' } : {}) }

const res = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: ROOT, env, stdio: 'inherit' })
process.exit(res.status ?? 1)
