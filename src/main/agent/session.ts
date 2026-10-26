import type { ModelRef, ProjectInfo, SessionInfo, SessionMode, TodoItem } from '@shared/types'
import { db } from '../store/db'
import { getProject } from '../workspace/projects'
import type { Msg } from '../providers/types'
import { uid } from '../util'
import { normalizeMemory, type AgentMemory } from './agentMemory'

interface SessionMeta {
  id: string
  projectId: string | null
  title: string
  updatedAt: number
  resumable: boolean
  plan: TodoItem[]
  model: ModelRef | null
  runStartedAt: number | null
  cumulativeSteps: number
  mode?: SessionMode
  memory?: AgentMemory | null
  cost?: number
}

export interface PendingUserMessage {
  text: string
  images?: { mediaType: string; data: string }[]
}

export class Session {
  running = false
  abort: AbortController | null = null
  pending: PendingUserMessage[] = []
  asks = new Map<string, (v: string) => void>()
  children = new Set<AbortController>()
  private childAbortHandlers = new Map<AbortController, () => void>()
  project: ProjectInfo | null = null
  constructor(
    public id: string,
    public projectId: string | null,
    public title: string,
    public messages: Msg[] = [],
    public plan: TodoItem[] = [],
    public model: ModelRef | null = null,
    public resumable = false,
    public updatedAt = Date.now(),
    public runStartedAt: number | null = null,
    public cumulativeSteps = 0,
    public mode: SessionMode = 'studio',
    public memory: AgentMemory | null = null,
    public cost = 0
  ) {
    if (projectId) this.project = getProject(projectId) ?? null
  }
  meta(): SessionMeta {
    return { id: this.id, projectId: this.projectId, title: this.title, updatedAt: this.updatedAt, resumable: this.resumable, plan: this.plan, model: this.model, runStartedAt: this.runStartedAt, cumulativeSteps: this.cumulativeSteps, mode: this.mode, memory: this.memory, cost: this.cost }
  }
  startRunBudget(now = Date.now()): void {
    this.runStartedAt = now
    this.cumulativeSteps = 0
    this.save()
  }
  clearRunBudget(): void {
    this.runStartedAt = null
    this.cumulativeSteps = 0
    this.save()
  }
  info(): SessionInfo {
    return { id: this.id, projectId: this.projectId, title: this.title, updatedAt: this.updatedAt, running: this.running, mode: this.mode }
  }
  save() {
    this.updatedAt = Date.now()
    db().put('sessions', this.id, this.meta())
  }
  linkChild(): AbortController {
    const c = new AbortController()
    const onAbort = () => c.abort()
    if (this.abort?.signal.aborted) c.abort()
    else if (this.abort) {
      this.abort.signal.addEventListener('abort', onAbort, { once: true })
      this.childAbortHandlers.set(c, onAbort)
    }
    this.children.add(c)
    return c
  }
  unlinkChild(c: AbortController) {
    const onAbort = this.childAbortHandlers.get(c)
    if (onAbort) this.abort?.signal.removeEventListener('abort', onAbort)
    this.childAbortHandlers.delete(c)
    this.children.delete(c)
  }
  abortAll() {
    for (const c of [...this.children]) {
      try { c.abort() } catch {}
    }
    this.children.clear()
    this.childAbortHandlers.clear()
    this.abort?.abort()
  }
}

const live = new Map<string, Session>()
const LIVE_CAP = 8

function remember(s: Session) {
  live.set(s.id, s)
  if (live.size <= LIVE_CAP) return
  for (const [id, x] of [...live].sort((a, b) => a[1].updatedAt - b[1].updatedAt)) {
    if (id === s.id || x.running) continue
    live.delete(id)
    break
  }
}

export function createSession(mode: SessionMode = 'studio'): Session {
  const s = new Session(uid('ses_'), null, mode === 'agent' ? 'إيجنت الكمبيوتر' : 'محادثة جديدة')
  s.mode = mode
  remember(s)
  s.save()
  return s
}

export function getSession(id: string): Session | undefined {
  const hit = live.get(id)
  if (hit) return hit
  const m = db().get<SessionMeta>('sessions', id)
  if (!m) return undefined
  const s = new Session(m.id, m.projectId, m.title, db().msgs<Msg>(id), m.plan ?? [], m.model ?? null, m.resumable, m.updatedAt, m.runStartedAt ?? null, m.cumulativeSteps ?? 0, m.mode ?? 'studio', normalizeMemory(m.memory), m.cost ?? 0)
  remember(s)
  return s
}

export function openOrCreate(mode: SessionMode = 'studio'): Session {
  const all = listSessions()
  const m =
    mode === 'agent'
      ? all.find((x) => x.mode === 'agent')
      : all.find((x) => x.mode !== 'agent' && (x.projectId || x.title !== 'محادثة جديدة'))
  if (m) {
    const s = getSession(m.id)
    if (s) return s
  }
  return createSession(mode)
}

export function pruneEmptySessions(keepRecent = 5): number {
  const metas = db().all<SessionMeta>('sessions').sort((a, b) => b.updatedAt - a.updatedAt)
  let removed = 0
  for (const m of metas.slice(keepRecent)) {
    if (m.projectId || (m.title !== 'محادثة جديدة' && m.title !== 'وكيل المتصفح') || live.has(m.id)) continue
    db().msgDelete(m.id)
    db().del('sessions', m.id)
    removed++
  }
  return removed
}

export function deleteAllSessions(): number {
  let removed = 0
  for (const m of db().all<SessionMeta>('sessions')) {
    const s = live.get(m.id)
    if (s?.running) continue
    db().msgDelete(m.id)
    db().del('sessions', m.id)
    if (s) live.delete(m.id)
    removed++
  }
  return removed
}

export function deleteSessionsForProject(projectId: string): number {
  let removed = 0
  for (const m of db().all<SessionMeta>('sessions')) {
    if (m.projectId !== projectId) continue
    const s = live.get(m.id)
    if (s?.running) continue
    db().msgDelete(m.id)
    db().del('sessions', m.id)
    if (s) live.delete(m.id)
    removed++
  }
  return removed
}

export const listSessions = (): SessionInfo[] =>
  db().all<SessionMeta>('sessions').sort((a, b) => b.updatedAt - a.updatedAt).map((m) => ({ id: m.id, projectId: m.projectId, title: m.title, updatedAt: m.updatedAt, running: live.get(m.id)?.running ?? false, mode: m.mode ?? 'studio' }))

export function latestSessionForProject(projectId: string): Session | undefined {
  const m = db().all<SessionMeta>('sessions').filter((x) => x.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return m ? getSession(m.id) : undefined
}

export const allLive = () => [...live.values()]

export { toChatItems } from './chatItems'
