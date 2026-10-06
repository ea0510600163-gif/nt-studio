/// <reference types="vite/client" />

import type { StudioBridge } from '../../shared/api'

declare global {
  interface Window {
    readonly studio: StudioBridge
  }
}

export {}