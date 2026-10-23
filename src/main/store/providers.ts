import { safeStorage } from 'electron'
import type { ModelInfo, ModelRef, ProviderInput, ProviderPublic, Settings } from '@shared/types'
import { DEFAULT_SETTINGS, deriveApproval } from '../config'
import { OPENCODE_GO, catalogFor } from '../../shared/catalogs.ts'
import { mergeModelLists } from '../../shared/modelMeta.ts'
import { fetchModelList } from '../providers/llm.ts'
import { registerSecret } from '../logger'
import { uid } from '../util'
import { db } from './db'

interface StoredProvider extends Omit<ProviderPublic, 'hasKey'> {}

let settingsCache: Settings | null = null
let providersCache: ProviderPublic[] | null = null
const keyCache = new Map<string, string>()

function migrateHighLimits(raw: Partial<Settings> | undefined): Partial<Settings> | undefined {
  if (!raw) return raw
  if (!db().get('kv', 'budget2hMigrated')) {
    const b: Partial<Settings> = { ...raw }
    if ((b.maxRunMs ?? 0) < 7_200_000) {
      b.maxRunMs = 7_200_000
      db().put('kv', 'settings', { ...DEFAULT_SETTINGS(), ...b })
    }
    db().put('kv', 'budget2hMigrated', { v: 1 })
    raw = b
  }
  if (db().get('kv', 'highLimitsMigrated')) return raw
  const next: Partial<Settings> = { ...raw }
  let changed = false
  if ((next.maxOutputTokens ?? 0) < 64000) { next.maxOutputTokens = 64000; changed = true }
  if ((next.maxSteps ?? 0) < 800) { next.maxSteps = 800; changed = true }
  if ((next.commandTimeoutSec ?? 0) < 600) { next.commandTimeoutSec = 600; changed = true }
  if ((next.compactAtPercent ?? 0) < 85) { next.compactAtPercent = 85; changed = true }
  if (changed) {
    db().put('kv', 'settings', { ...DEFAULT_SETTINGS(), ...next })
    db().put('kv', 'highLimitsMigrated', { v: 1 })
    return next
  }
  db().put('kv', 'highLimitsMigrated', { v: 1 })
  return raw
}

export function getSettings(): Settings {
  if (!settingsCache) {
    const raw = db().get<Partial<Settings>>('kv', 'settings')
    const migrated = migrateHighLimits(raw)
    settingsCache = Object.freeze(deriveApproval({ ...DEFAULT_SETTINGS(), ...(migrated ?? {}) })) as Settings
  }
  return settingsCache
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = deriveApproval({ ...getSettings(), ...patch })
  settingsCache = Object.freeze(next) as Settings
  db().put('kv', 'settings', next)
  return next
}

const OPENCODE_CATALOG_VERSION = '2026-10-20'

export function syncOpencodeCatalog() {
  if (db().get<{ v: string }>('kv', 'opencodeCatalogVersion')?.v === OPENCODE_CATALOG_VERSION) return
  let changed = false
  for (const p of db().all<StoredProvider>('providers')) {
    if (!p.opencode) continue
    db().put('providers', p.id, { ...p, models: OPENCODE_GO.models })
    changed = true
  }
  db().put('kv', 'opencodeCatalogVersion', { v: OPENCODE_CATALOG_VERSION })
  if (changed) providersCache = null
}

export function applyLiveCatalog(id: string, models: ModelInfo[]): boolean {
  const p = getProvider(id)
  if (!p || !models.length) return false
  const next = mergeModelLists(p.models, models)
  if (JSON.stringify(next) === JSON.stringify(p.models)) return false
  db().put('providers', id, { id: p.id, name: p.name, baseUrl: p.baseUrl, apiStyle: p.apiStyle, models: next, opencode: p.opencode })
  providersCache = null
  return true
}

export async function refreshProviderCatalogs(): Promise<boolean> {
  let changed = false
  for (const p of listProviders()) {
    if (!p.opencode && !catalogFor(p.baseUrl)) continue
    const key = getKey(p.id)
    if (!key) continue
    try {
      const models = await fetchModelList(p.baseUrl, key, p.apiStyle)
      if (applyLiveCatalog(p.id, models)) changed = true
    } catch {}
  }
  return changed
}

export function listProviders(): ProviderPublic[] {
  if (!providersCache)
    providersCache = db()
      .all<StoredProvider>('providers')
      .map((p) => ({ ...p, hasKey: !!db().get('secrets', p.id) }))
  return providersCache
}

export function getProvider(id: string): ProviderPublic | undefined {
  return listProviders().find((p) => p.id === id)
}

export function saveProvider(input: ProviderInput): ProviderPublic {
  const id = input.id || uid('prv_')
  const stored: StoredProvider = {
    id,
    name: input.name.trim() || 'مزود',
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    apiStyle: input.apiStyle,
    models: input.models,
    opencode: input.opencode
  }
  db().put('providers', id, stored)
  if (input.apiKey && input.apiKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('التشفير غير متاح على هذا الجهاز؛ لن يُحفظ المفتاح كنص صريح.')
    db().put('secrets', id, { enc: safeStorage.encryptString(input.apiKey.trim()).toString('base64') })
    keyCache.set(id, input.apiKey.trim())
    registerSecret(input.apiKey.trim())
  }
  const s = getSettings()
  if (!s.defaultModel && stored.models[0]) setSettings({ defaultModel: { providerId: id, modelId: stored.models[0].id } })
  providersCache = null
  return { ...stored, hasKey: !!db().get('secrets', id) }
}

export function removeProvider(id: string) {
  db().del('providers', id)
  db().del('secrets', id)
  keyCache.delete(id)
  providersCache = null
  const s = getSettings()
  const patch: Partial<Settings> = {}
  if (s.defaultModel?.providerId === id) patch.defaultModel = null
  if (s.fallbackModel?.providerId === id) patch.fallbackModel = null
  if (Object.keys(patch).length) setSettings(patch)
}

export function getKey(id: string): string {
  const hit = keyCache.get(id)
  if (hit !== undefined) return hit
  const rec = db().get<{ enc: string }>('secrets', id)
  if (!rec) return ''
  try {
    const key = safeStorage.decryptString(Buffer.from(rec.enc, 'base64'))
    registerSecret(key)
    keyCache.set(id, key)
    return key
  } catch {
    return ''
  }
}

export interface ResolvedTarget {
  provider: { id: string; name: string; baseUrl: string; apiStyle: 'openai' | 'anthropic' | 'responses'; apiKey: string; opencode?: boolean }
  model: ModelInfo
}

export function resolveModel(ref: ModelRef | null | undefined): ResolvedTarget | null {
  if (!ref) return null
  const p = getProvider(ref.providerId)
  if (!p) return null
  const found = p.models.find((m) => m.id === ref.modelId)
  const model = found ?? inferModel(ref.modelId)
  if (!found) model.id = ref.modelId
  return { provider: { id: p.id, name: p.name, baseUrl: p.baseUrl, apiStyle: p.apiStyle, apiKey: getKey(p.id), opencode: p.opencode }, model }
}

function inferModel(id: string): ModelInfo {
  try { const { inferModel: inf } = require('../../shared/models') as { inferModel: (id: string) => ModelInfo }; return inf(id) } catch { return { id, tools: true, vision: false, contextWindow: 128000 } }
}

export function listVisionModel(): ResolvedTarget | null {
  for (const p of listProviders()) {
    const m = p.models.find((x) => x.vision)
    if (m) return { provider: { id: p.id, name: p.name, baseUrl: p.baseUrl, apiStyle: p.apiStyle, apiKey: getKey(p.id), opencode: p.opencode }, model: m }
  }
  return null
}

export function warmSecrets() {
  for (const p of listProviders()) getKey(p.id)
}
