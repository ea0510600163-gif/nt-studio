import type { NtApi } from '@shared/ipc'

declare global {
  interface Window {
    nt: NtApi
  }
}
export {}
