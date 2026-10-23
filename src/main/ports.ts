import { createServer } from 'net'

export function appPorts(): number[] {
  const out: number[] = []
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) {
    try {
      const p = Number(new URL(url).port)
      if (Number.isFinite(p) && p > 0) out.push(p)
    } catch {}
  }
  return out
}

export function isAppPort(p: number): boolean {
  return appPorts().includes(p)
}

function freeOn(host: string, port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer()
    s.once('error', () => res(false))
    s.once('listening', () => s.close(() => res(true)))
    try {
      s.listen(port, host)
    } catch {
      res(false)
    }
  })
}

export async function isPortFree(port: number): Promise<boolean> {
  return (await freeOn('127.0.0.1', port)) && (await freeOn('::1', port))
}

export async function findFreePort(start = 3000, alsoAvoid: readonly number[] = []): Promise<number> {
  const avoid = new Set<number>([...appPorts(), ...alsoAvoid])
  for (let p = Math.max(1024, start | 0); p < Math.max(1024, start | 0) + 300; p++) {
    if (avoid.has(p)) continue
    if (await isPortFree(p)) return p
  }
  throw new Error(`لم يُعثر على منفذ حرّ ابتداءً من ${start}.`)
}
