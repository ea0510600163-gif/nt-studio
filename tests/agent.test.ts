import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ErrorTracker,
  backoffMs,
  classifyError,
  estimateTokens,
  summarizeOldMessages,
  type ChatMessage,
} from '../src/main/agent/recovery'
import { findFreePort } from '../src/main/agent/tools/devserver'
import { slugify } from '../src/main/agent/tools/project'
import { isBinaryPath } from '../src/main/agent/tools/fs'
import { listRelativeFiles, detectProjectKind, readPackageJson } from '../src/main/agent/tools/fs-scan'

/* ========================================================================== */
/* تصنيف الأخطاء                                                               */
/* ========================================================================== */

describe('classifyError', () => {
  it('يعدّ 429 خطأ عابر', () => {
    const r = classifyError(new Error('Rate limit exceeded'), 429)
    expect(r.cls).toBe('transient')
    expect(r.retryable).toBe(true)
  })

  it('يعدّ 5xx خطأ عابر', () => {
    expect(classifyError(new Error('bad gateway'), 502).retryable).toBe(true)
  })

  it('يعدّ فشل الشبكة خطأ عابر', () => {
    expect(classifyError(new Error('ECONNRESET')).cls).toBe('transient')
  })

  it('يعدّ تجاوز السياق خطأ سياق', () => {
    const r = classifyError(
      new Error("This model's maximum context length is 8192 tokens"),
      400,
    )
    expect(r.cls).toBe('context')
    expect(r.retryable).toBe(true)
  })

  it('يعدّ 401 خطأ دائم', () => {
    const r = classifyError(new Error('Invalid API key provided'), 401)
    expect(r.cls).toBe('permanent')
    expect(r.retryable).toBe(false)
  })

  it('يعدّ خطأ الملف خطأ منطقي', () => {
    expect(classifyError(new Error('ENOENT: no such file or directory')).cls).toBe('logic')
  })

  it('يعدّ الإيقاف من المستخدم غير قابل لإعادة المحاولة', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(classifyError(err).retryable).toBe(false)
  })
})

describe('backoffMs', () => {
  it('يتصاعد مع المحاولات', () => {
    const first = backoffMs(0, 1000, 20_000)
    const third = backoffMs(3, 1000, 20_000)
    expect(third).toBeGreaterThan(first)
  })

  it('يحترم الحد الأعلى', () => {
    let max = 0
    for (let i = 0; i < 30; i++) max = Math.max(max, backoffMs(15, 1000, 5000))
    expect(max).toBeLessThanOrEqual(5000 * 1.3)
  })
})

/* ========================================================================== */
/* كشف التعطّل                                                                */
/* ========================================================================== */

describe('ErrorTracker', () => {
  it('لا يعتبر نفسه متعطّلًا بعد فشل واحد', () => {
    const t = new ErrorTracker()
    t.recordCall('write_file', { path: 'a.ts' }, false, 'not found')
    expect(t.isStuck()).toBe(false)
  })

  it('يكشف التعطّل بعد 3 فشلات متطابقة', () => {
    const t = new ErrorTracker()
    for (let i = 0; i < 3; i++) t.recordCall('write_file', { path: 'a.ts' }, false, 'ENOENT')
    expect(t.isStuck()).toBe(true)
  })

  it('يكشف التعطّل عبر نافذة أوسع رغم نجاحات متفرقة', () => {
    const t = new ErrorTracker(10, 3)
    for (let i = 0; i < 4; i++) {
      t.recordCall('edit_file', { n: i }, false, 'old_string not found')
      t.recordCall('read_file', { n: i }, true)
    }
    expect(t.isStuck()).toBe(true)
  })

  it('يصعّد: بديل ثم إعادة تخطيط ثم سؤال المستخدم', () => {
    const t = new ErrorTracker()
    for (let i = 0; i < 3; i++) t.recordCall('run_command', { c: i }, false, 'same error')
    const s1 = t.strategy()
    const s2 = t.strategy()
    const s3 = t.strategy()
    expect(s1).toBe('alternative')
    expect(s2).toBe('replan')
    expect(s3).toBe('ask_user')
  })

  it('يصف المشكلة في رسالة التعطّل', () => {
    const t = new ErrorTracker()
    for (let i = 0; i < 3; i++) t.recordCall('write_file', { path: 'x' }, false, 'EACCES')
    const msg = t.stuckMessage()
    expect(msg).toContain('write_file')
    expect(msg).toContain('EACCES')
  })
})

/* ========================================================================== */
/* تصغير السياق                                                               */
/* ========================================================================== */

describe('summarizeOldMessages', () => {
  const build = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as ChatMessage['role'],
      content: `رسالة رقم ${i} مع نص كافٍ`,
    }))

  it('لا يلمس المحادثة القصيرة', () => {
    const m = build(6)
    expect(summarizeOldMessages(m, 4)).toHaveLength(6)
  })

  it('يضغط الطويلة ويحفظ الذيل ونظام موجّه', () => {
    const m: ChatMessage[] = [{ role: 'system', content: 'SYSTEM' }, ...build(40)]
    const out = summarizeOldMessages(m, 6)
    expect(out.length).toBeLessThan(m.length)
    expect(out[0]?.content).toBe('SYSTEM')
    expect(out.at(-1)?.content).toBe(m.at(-1)?.content)
    expect(out[1]?.content).toContain('CONTEXT COMPACTION')
  })

  it('يلخّص استخدام الأدوات', () => {
    const m: ChatMessage[] = [
      { role: 'system', content: 'S' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'write_file', args: '{}' }] },
      { role: 'tool', toolCallId: '1', content: 'Created a.ts' },
      ...build(30),
    ]
    const out = summarizeOldMessages(m, 4)
    expect(out[1]?.content).toContain('write_file')
  })

  it('يحافظ على SYSTEM دائمًا', () => {
    const m: ChatMessage[] = [{ role: 'system', content: 'MY SYSTEM' }, ...build(50)]
    const out = summarizeOldMessages(m, 5)
    expect(out[0]?.content).toBe('MY SYSTEM')
  })
})

describe('estimateTokens', () => {
  it('يقدّر ب 보수', () => {
    expect(estimateTokens('a'.repeat(350))).toBeGreaterThan(90)
    expect(estimateTokens('')).toBeGreaterThanOrEqual(0)
  })
})

/* ========================================================================== */
/* الأدوات المساعدة                                                            */
/* ========================================================================== */

describe('slugify', () => {
  it('يحوّل العربية إلى slug لاتيني', () => {
    // الترانزليترtere ثابت ومقصود: لا نتوقّع مخرجًا بعينه
    const slug = slugify('لعبة الأفعى')
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(slug.length).toBeGreaterThan(3)
  })

  it('يحوّل الإنجليزية', () => {
    expect(slugify('Snake Game!')).toBe('snake-game')
  })

  it('لا يعطي سلسلة فارغة', () => {
    expect(slugify('!!!')).toBe('project')
    expect(slugify('')).toBe('project')
  })

  it('يحدّ الطول', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(48)
  })
})

describe('isBinaryPath', () => {
  it('يميّز الملفات الثنائية', () => {
    expect(isBinaryPath('a.png')).toBe(true)
    expect(isBinaryPath('a.woff2')).toBe(true)
  })
  it('يسمح بالنصوص', () => {
    expect(isBinaryPath('index.html')).toBe(false)
    expect(isBinaryPath('main.ts')).toBe(false)
  })
})

describe('findFreePort', () => {
  it('يعيد منفذًا متاحًا', async () => {
    const port = await findFreePort()
    expect(port).toBeGreaterThan(0)
  })
  it('يلتف حول منفذ محجوز فعلًا', async () => {
    // نحجز منفذًا عبر خادم استماع حقيقي ثم نطلب المنفذ نفسه
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()))
    const taken = (blocker.address() as { port: number }).port
    const other = await findFreePort(taken)
    expect(other).not.toBe(taken)
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })
})

/* ========================================================================== */
/* مسح الملفات                                                                */
/* ========================================================================== */

const dirs: string[] = []

async function tmpProject(): Promise<string> {
  const dir = path.join(os.tmpdir(), `nt-studio-scan-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(path.join(dir, 'src'), { recursive: true })
  await fs.mkdir(path.join(dir, 'node_modules', 'junk'), { recursive: true })
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>')
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }))
  await fs.writeFile(path.join(dir, 'src', 'main.ts'), 'export const a = 1')
  await fs.writeFile(path.join(dir, 'node_modules', 'junk', 'big.js'), 'x')
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

describe('listRelativeFiles', () => {
  it('يستثني node_modules', async () => {
    const dir = await tmpProject()
    const files: string[] = []
    await listRelativeFiles(dir, files)
    expect(files).toContain('index.html')
    expect(files).toContain('src/main.ts')
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
  })
})

describe('detectProjectKind', () => {
  it('يميّز مشروع node', async () => {
    expect(await detectProjectKind(await tmpProject())).toBe('node')
  })

  it('يميّز مشروع ثابت', async () => {
    const dir = await tmpProject()
    await fs.rm(path.join(dir, 'package.json'))
    expect(await detectProjectKind(dir)).toBe('static')
  })
})

describe('readPackageJson', () => {
  it('يقرأ الاسم والسكربتات', async () => {
    const pkg = await readPackageJson(await tmpProject())
    expect(pkg?.name).toBe('x')
    expect(pkg?.scripts.dev).toBe('vite')
  })
  it('يعيد null لملف تالف', async () => {
    const dir = await tmpProject()
    await fs.writeFile(path.join(dir, 'package.json'), '{ broken')
    expect(await readPackageJson(dir)).toBeNull()
  })
})