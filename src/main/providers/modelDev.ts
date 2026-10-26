import { OPENCODE_GO_BASE_URL } from '../../shared/catalogs.ts'
import { metaFromItem } from '../../shared/modelMeta.ts'
import type { ModelInfo } from '../../shared/types.ts'

const DEV_URL = 'https://models.dev/api.json'
const TTL = 10 * 60_000

const normBase = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '').toLowerCase()

let cache: { at: number; items: Map<string, Map<string, unknown>> } | null = null

async function devItems(): Promise<Map<string, Map<string, unknown>>> {
  if (cache && Date.now() - cache.at < TTL) return cache.items
  const res = await fetch(DEV_URL, { headers: { 'user-agent': 'NT-Studio/1.0' }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = (await res.json()) as unknown
  const top = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null
  if (!top) throw new Error('بنية غير متوقعة من models.dev')
  const items = new Map<string, Map<string, unknown>>()
  for (const [pid, pv] of Object.entries(top)) {
    const prov = pv && typeof pv === 'object' && !Array.isArray(pv) ? (pv as Record<string, unknown>) : null
    if (!prov) continue
    const list = prov['models'] && typeof prov['models'] === 'object' && !Array.isArray(prov['models']) ? (prov['models'] as Record<string, unknown>) : null
    if (!list) continue
    const byId = new Map<string, unknown>()
    for (const [mid, item] of Object.entries(list)) if (item && typeof item === 'object') byId.set(mid, item)
    if (byId.size) items.set(pid, byId)
  }
  cache = { at: Date.now(), items }
  return items
}

export async function devPatches(baseUrl: string): Promise<Map<string, Partial<ModelInfo>>> {
  const key = normBase(baseUrl) === OPENCODE_GO_BASE_URL ? 'opencode-go' : undefined
  const out = new Map<string, Partial<ModelInfo>>()
  if (!key) return out
  let byId: Map<string, unknown> | undefined
  try {
    byId = (await devItems()).get(key)
  } catch {
    return out
  }
  if (!byId) return out
  for (const [id, item] of byId) {
    const patch = metaFromItem(item)
    if (Object.keys(patch).length) out.set(id, patch)
  }
  return out
}
