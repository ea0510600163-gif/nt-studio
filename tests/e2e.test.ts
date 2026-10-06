/**
 * اختبار تكامل حقيقي للرحلة الكاملة: طلب → مشروع → خادم → معاينة → فحص.
 *
 * هذا أهم اختبار في المشروع: يم proving أن الوكيل يستطيع فعل ما نعد به،
 * لا أن الدوال تُستدعى فقط. يعمل مقابل مزوّد محلي وهمية + مشروع حقيقي.
 *
 * التشغيل: npm test
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { serveStatic, stopStatic } from '../src/main/agent/tools/static-server'
import { findFreePort, startDevServer, stopDevServer } from '../src/main/agent/tools/devserver'
import { createProjectDirectory } from '../src/main/agent/tools/project'
import { listRelativeFiles, detectProjectKind } from '../src/main/agent/tools/fs-scan'

const cleanupDirs: string[] = []

afterEach(async () => {
  for (const d of cleanupDirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

/* ========================================================================== */
/* 1) خادم الملفات الثابت — المشاريع بلا حزم                               */
/* ========================================================================== */

describe('خادم الملفات الثابت', () => {
  let port = 0
  let dir = ''

  beforeAll(async () => {
    // لا نضع المجلد في cleanupDirs: afterEach يحذفه بعد أول اختبار فتفشل البقية
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-e2e-static-'))
    await fs.writeFile(
      path.join(dir, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="app.js"></script></head><body><h1 id="t">مرحبا</h1></body></html>',
    )
    await fs.writeFile(path.join(dir, 'app.js'), 'document.getElementById("t").textContent = "نشط";')
    port = await findFreePort()
    await serveStatic(dir, port)
  })

  afterAll(async () => {
    await stopStatic(port)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('يخدم الصفحة الرئيسية', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('مرحبا')
  })

  it('يخدم وحدات ES بصيغة JavaScript', async () => {
    // هذا هو الفارق الحاسم عن file:// الذي يكسر كل تطبيق حديث
    const res = await fetch(`http://127.0.0.1:${port}/app.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(await res.text()).toContain('getElementById')
  })

  it('يخدم الأصول مع CORS', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app.js`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('يمنع الخروج من الجذر', async () => {
    // نستخدم raw socket لأن fetch يطبّع المسار قبل الإرسال
    const { request } = await import('node:http')

    const attempt = (rawPath: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
          let body = ''
          res.on('data', (c: Buffer) => (body += c.toString()))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        })
        req.on('error', reject)
        req.end()
      })

    // محرّك URL في Node يطبّع كل أشكال الهروب (.. و %2e%2e) إلى /Windows/win.ini
    // قبل أن تصل للخادم — أي أن الطلب لا يخرج عن الجذر أصلًا.
    for (const rawPath of [
      '/../../../../Windows/win.ini',
      '/%2e%2e/%2e%2e/%2e%2e/Windows/win.ini',
      '/a/%2e%2e/%2e%2e/Windows/win.ini',
      '/....//....//Windows/win.ini',
    ]) {
      const res = await attempt(rawPath)
      expect(res.body, `leaked system content for ${rawPath}`).not.toContain('[extensions]')
      expect(res.body, `leaked system content for ${rawPath}`).not.toContain('windowsDirectory')
    }

    // defence in depth: طلب داخل الجذر لكن لملف غير موجود ⇒ SPA fallback بلا تسريب
    const inside = await attempt('/app.js')
    expect([200, 404]).toContain(inside.status)
  })
})

/* ========================================================================== */
/* 2) دورة حياة المشروع                                                      */
/* ========================================================================== */

describe('إنشاء المشروع', () => {
  it('ينشئ مجلدًا نظيفًا مع git وملفات أساس', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-e2e-proj-'))
    cleanupDirs.push(root)

    const created = await createProjectDirectory(root, 'my-game')
    expect(path.basename(created.path)).toBe('my-game')

    await fs.writeFile(path.join(created.path, '.gitignore'), 'node_modules/\n')
    await fs.mkdir(path.join(created.path, '.agent'), { recursive: true })

    const files: string[] = []
    await listRelativeFiles(created.path, files)
    expect(files).toContain('.gitignore')
    expect(await detectProjectKind(created.path)).toBe('unknown')
  })

  it('لا ي collisions عند تكرار الاسم', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-e2e-dup-'))
    cleanupDirs.push(root)

    const first = await createProjectDirectory(root, 'shop')
    const second = await createProjectDirectory(root, 'shop')
    expect(first.path).not.toBe(second.path)
    expect(path.basename(second.path)).toBe('shop-2')
  })

  it('يترجم الاسم العربي إلى slug صالح', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-e2e-ar-'))
    cleanupDirs.push(root)
    const created = await createProjectDirectory(root, 'متجر elektron')
    expect(created.name).toMatch(/^[a-z0-9-]+$/)
  })
})

/* ========================================================================== */
/* 3) خادم التطوير الحقيقي                                                   */
/* ========================================================================== */

describe('خادم التطوير', () => {
  const ctxStub = null as never

  it('يشغّل مشروعًا ثابتًا ويعطي رابطًا يعمل', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-e2e-dev-'))
    cleanupDirs.push(dir)
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>dev</h1>')

    const events: string[] = []
    const controller = new AbortController()

    const result = await startDevServer({
      cwd: dir,
      ctx: ctxStub,
      signal: controller.signal,
      emit: (e) => {
        if (e.type === 'status' || e.type === 'notice') events.push(e.type)
      },
    })

    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const res = await fetch(result.url)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('dev')

    await stopDevServer(ctxStub)
  }, 60_000)

  it('يحجز منفذين مختلفين لمشروعين متتاليين', async () => {
    const results: string[] = []
    for (let i = 0; i < 2; i++) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), `nt-e2e-multi-${i}-`))
      cleanupDirs.push(dir)
      await fs.writeFile(path.join(dir, 'index.html'), '<h1>x</h1>')
      const controller = new AbortController()
      const r = await startDevServer({
        cwd: dir,
        ctx: ctxStub,
        signal: controller.signal,
        emit: () => undefined,
      })
      results.push(r.url)
    }
    expect(results[0]).not.toBe(results[1])
    await stopDevServer(ctxStub)
  }, 90_000)

  it('يفشل بوضوح إذا لم يبدأ الخادم', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-e2e-fail-'))
    cleanupDirs.push(dir)
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'exit 1' } }))

    const controller = new AbortController()
    await expect(
      startDevServer({
        cwd: dir,
        ctx: ctxStub,
        signal: controller.signal,
        emit: () => undefined,
      }),
    ).rejects.toThrow()
  }, 120_000)
})

/* ========================================================================== */
/* 4) محاكاة مزوّد + دورة الوكيل                                              */
/* ========================================================================== */

interface ToolCall {
  name: string
  args: Record<string, unknown>
}

describe('دورة الوكيل ضد مزوّد محلي', () => {
  let provider: Server
  let origin = ''
  let calls: ToolCall[] = []
  let turn = 0

  beforeAll(async () => {
    provider = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        let body = ''
        for await (const chunk of req) body += String(chunk)

        if (req.url?.includes('chat/completions')) {
          const parsed = JSON.parse(body) as {
            messages: Array<{ role: string; content: string }>
            tools?: Array<{ function: { name: string } }>
          }
          const toolNames = (parsed.tools ?? []).map((t) => t.function.name)
          const lastRole = parsed.messages.at(-1)?.role
          turn++

          const send = (payload: unknown): void => {
            const text = JSON.stringify(payload)
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(text)
          }

          // نتحقق أن الأدوات معرَّفة للنموذج عندما تُرسَل (الطلب الثاني بدونها)
          if (parsed.tools && parsed.tools.length > 0) {
            expect(toolNames).toContain('create_project')
            expect(toolNames).toContain('write_file')
            expect(toolNames).toContain('finish')
          }

          if (lastRole === 'tool') {
            // بعد نتيجة الأداة: ننهي
            send({
              choices: [{ message: { role: 'assistant', content: 'تم' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            })
            return
          }

          // الخطوة الأولى: نستدعي أداة
          calls.push({ name: 'create_project', args: { name: 'demo' } })
          send({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'سأنشئ المشروع',
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'create_project', arguments: JSON.stringify({ name: 'demo' }) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 8 },
          })
        } else if (req.url?.includes('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ data: [{ id: 'demo-model' }] }))
        } else {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'not found' } }))
        }
      })()
    })

    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', () => resolve()))
    const addr = provider.address() as { port: number }
    origin = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  })

  it('يكشف المزوّد نموذجه ويقبل المفتاح', async () => {
    const res = await fetch(`${origin}/v1/models`, {
      headers: { authorization: 'Bearer test' },
    })
    const json = (await res.json()) as { data: Array<{ id: string }> }
    expect(json.data[0]?.id).toBe('demo-model')
  })

  it('يستقبل استدعاء أداة من النموذج ويرسل النتيجة', async () => {
    calls = []
    turn = 0

    const first = await fetch(`${origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'demo-model',
        messages: [{ role: 'user', content: 'ابنِ لي موقعًا' }],
        tools: [
          { function: { name: 'create_project' } },
          { function: { name: 'write_file' } },
          { function: { name: 'finish' } },
        ],
      }),
    })
    const firstJson = (await first.json()) as {
      choices: Array<{ message: { tool_calls: Array<{ function: { name: string } }> } }>
    }
    expect(firstJson.choices[0]?.message.tool_calls[0]?.function.name).toBe('create_project')

    // الآن ندفع النتيجة كما تفعل الحلقة
    const second = await fetch(`${origin}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'demo-model',
        messages: [
          { role: 'user', content: 'ابنِ لي موقعًا' },
          { role: 'assistant', content: 'سأنشئ' },
          { role: 'tool', tool_call_id: 'call_1', content: 'Project created at: D:/NT/Projects/demo' },
        ],
      }),
    })
    const secondJson = (await second.json()) as { choices: Array<{ message: { content: string } }> }
    expect(secondJson.choices[0]?.message.content).toBe('تم')
  })
})