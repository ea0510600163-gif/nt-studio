import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'
type EffectiveTheme = 'dark' | 'light'

interface ThemeCtx {
  mode: ThemeMode
  effective: EffectiveTheme
  setMode: (m: ThemeMode) => void
  toggle: () => void
}

const KEY = 'nt.theme'
const Ctx = createContext<ThemeCtx | null>(null)
const QUERY = '(prefers-color-scheme: light)'

const read = (): ThemeMode => {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark'
}

function systemTheme(): EffectiveTheme {
  return window.matchMedia(QUERY).matches ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(read)
  const [system, setSystem] = useState<EffectiveTheme>(systemTheme)

  const effective = useMemo<EffectiveTheme>(() => (mode === 'system' ? system : mode), [mode, system])

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = (e: MediaQueryListEvent) => setSystem(e.matches ? 'light' : 'dark')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effective)
    localStorage.setItem(KEY, mode)
  }, [effective, mode])

  const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), [])

  return <Ctx.Provider value={{ mode, effective, setMode, toggle }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme خارج ThemeProvider')
  return v
}
