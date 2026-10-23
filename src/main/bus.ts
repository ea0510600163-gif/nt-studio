import type { BrowserWindow } from 'electron'
import type { EventChannel } from '@shared/ipc'
import type { AgentEvent } from '@shared/types'

let win: BrowserWindow | null = null
export const setWindow = (w: BrowserWindow | null) => { win = w }
export const getWindow = () => win

const FLUSH_MS = 40

const alive = (): boolean => !!win && !win.isDestroyed() && !win.webContents.isDestroyed()

function raw(channel: EventChannel, payload: unknown): void {
  if (alive()) win!.webContents.send(channel, payload)
}

function timer(): {
  schedule(fn: () => void): void
  cancel(): void
} {
  let t: ReturnType<typeof setTimeout> | null = null
  return {
    schedule(fn) {
      if (t) return
      t = setTimeout(fn, FLUSH_MS)
      t.unref?.()
    },
    cancel() {
      if (!t) return
      clearTimeout(t)
      t = null
    }
  }
}

type Delta = { t: 'text_delta' | 'thinking_delta'; sessionId: string; text: string; id?: string }
const deltaQ: Delta[] = []
const deltaT = timer()

function flushDeltas(): void {
  deltaT.cancel()
  if (!deltaQ.length) return
  const items = deltaQ.splice(0, deltaQ.length)
  const merged: Delta[] = []
  for (const d of items) {
    const prev = merged[merged.length - 1]
    if (prev && prev.t === d.t && prev.sessionId === d.sessionId && prev.id === d.id) {
      prev.text += d.text
    } else {
      merged.push({ ...d })
    }
  }
  for (const d of merged) raw('agent:event', d)
}

function dropPending(sessionId: string, t: Delta['t']): void {
  for (let i = deltaQ.length - 1; i >= 0; i--) if (deltaQ[i].sessionId === sessionId && deltaQ[i].t === t) deltaQ.splice(i, 1)
}

let previewState: unknown
const previewT = timer()

function flushPreview(): void {
  previewT.cancel()
  if (previewState === undefined) return
  raw('preview:state', previewState)
  previewState = undefined
}

const termBuf = new Map<string, string[]>()
const termT = timer()

function flushTerm(): void {
  termT.cancel()
  if (!termBuf.size) return
  for (const [id, chunks] of termBuf) raw('term:data', { id, data: chunks.join('') })
  termBuf.clear()
}

let seq = 0

export function send(channel: EventChannel, payload: unknown): void {
  if (!alive()) return
  switch (channel) {
    case 'agent:event': {
      const e = payload as AgentEvent
      if (e.t === 'text_delta' || e.t === 'thinking_delta') {
        deltaQ.push(e as Delta)
        deltaT.schedule(flushDeltas)
        return
      }
      if (e.t === 'text_reset') dropPending(e.sessionId, 'text_delta')
      if (e.t === 'thinking_reset') dropPending(e.sessionId, 'thinking_delta')
      flushDeltas()
      raw(channel, { ...e, __seq: ++seq })
      return
    }
    case 'preview:state':
      previewState = payload
      previewT.schedule(flushPreview)
      return
    case 'term:data': {
      const m = payload as { id: string; data: string }
      const list = termBuf.get(m.id)
      if (list) list.push(m.data)
      else termBuf.set(m.id, [m.data])
      termT.schedule(flushTerm)
      return
    }
    default:
      raw(channel, payload)
  }
}

export function flushAll(): void {
  flushDeltas()
  flushPreview()
  flushTerm()
}
