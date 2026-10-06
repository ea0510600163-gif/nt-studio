import { createReadStream } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import type { AppContext } from '../../core/context'

/**
 * خادم ملفات ثابت صغير للمشاريع بلا حزم.
 *
 * لماذا لا نستخدم file:// مباشرة؟ لأن وحدات ES الحديثة تُحمّل عبر CORS،
 * وfile:// يمنع ذلك فتُفشل كل تطبيق يستخدم type="module" أو الاستيراد الديناميكي.
 * كما أنه يمنع طلبات fetch الداخلية. الخادم يحل المشكلتين ويمنح رابطًا حقيقيًا.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

const live = new Map<number, Server>()

/** سجلّ اختياري — يسهّل اختبار الخادم بلا سياق Electron كامل. */
type StaticLogger = { info: (m: string, d?: unknown) => void; error: (m: string, d?: unknown) => void }
let activeLogger: StaticLogger | null = null

/** يضبط المسجّل المستخدم (null افتراضيًا، ويُمرَّر في الاختبارات). */
export function setStaticLogger(logger: StaticLogger | null): void {
  activeLogger = logger
}

export async function serveStatic(root: string, port: number, ctx?: AppContext): Promise<string> {
  await stopStatic(port)

  const baseDir = path.resolve(root)
  // مقارنة تعتمد على path.relative بدل startsWith (البادئة النصية تخدع عند تشابه الأسماء)
  const isInside = (candidate: string): boolean => {
    const rel = path.relative(baseDir, path.resolve(candidate))
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
        let rel: string
        try {
          rel = decodeURIComponent(url.pathname)
        } catch {
          res.writeHead(400).end('bad path')
          return
        }
        if (rel.includes('\0')) {
          res.writeHead(400).end('bad path')
          return
        }
        if (rel.endsWith('/')) rel += 'index.html'

        const target = path.resolve(baseDir, `.${path.sep}${rel}`)
        if (!isInside(target)) {
          res.writeHead(403).end('forbidden')
          return
        }

        let info = await stat(target).catch(() => null)
        if (info?.isDirectory()) {
          const indexPath = path.join(target, 'index.html')
          info = await stat(indexPath).catch(() => null)
          if (info) {
            send(res, indexPath)
            return
          }
        }
        if (!info) {
          // SPA fallback
          const fallback = path.join(baseDir, 'index.html')
          const fb = await stat(fallback).catch(() => null)
          if (fb) {
            send(res, fallback)
            return
          }
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
          return
        }
        send(res, target)
      } catch (e) {
        const log = ctx ? ctx.root.child('static') : activeLogger
        log?.error('static serve failed', e)
        if (!res.headersSent) res.writeHead(500).end('error')
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  live.set(port, server)
  const log = ctx ? ctx.root.child('static') : activeLogger
  log?.info(`static server on 127.0.0.1:${port} for ${root}`)
  return `${root} -> ${port}`
}

function send(res: ServerResponse, file: string): void {
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'access-control-allow-origin': '*',
  })
  createReadStream(file).pipe(res)
}

export async function stopStatic(port: number): Promise<void> {
  const server = live.get(port)
  if (!server) return
  live.delete(port)
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

export async function stopAllStatic(): Promise<void> {
  for (const port of [...live.keys()]) await stopStatic(port)
}