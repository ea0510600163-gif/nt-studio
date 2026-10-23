import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const alias = { '@shared': resolve('src/shared') }

function manualChunks(id: string): string | undefined {
  const n = id.replace(/\\/g, '/')
  const at = n.lastIndexOf('node_modules/')
  if (at < 0) return undefined
  const parts = n.slice(at + 'node_modules/'.length).split('/')
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  if (name === 'react' || name === 'react-dom' || name === 'scheduler') return 'vendor-react'
  if (name.startsWith('@xterm/') || name === 'xterm') return 'vendor-xterm'
  if (name === 'highlight.js') return 'vendor-highlight'
  if (name === 'lucide-react') return 'vendor-icons'
  return undefined
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: { rollupOptions: { external: ['better-sqlite3', 'node-pty'] } }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    resolve: { alias: { ...alias, '@': resolve('src/renderer') } },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { output: { manualChunks } } }
  }
})
