import { OPENCODE_USER_AGENT } from '../../../shared/catalogs.ts'
import { opencodeSessionKey } from './sessionKey.ts'

export { opencodeSessionKey }

export function opencodeHeaders(opencode: boolean | undefined, sessionKey?: string): Record<string, string> {
  if (!opencode) return {}
  return {
    'user-agent': OPENCODE_USER_AGENT,
    'x-opencode-session': sessionKey?.trim() || opencodeSessionKey('')
  }
}
