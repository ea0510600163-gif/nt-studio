import { homedir } from 'os'
import { join } from 'path'
import type { PermissionMode, Settings } from '@shared/types'

export const DEFAULT_MAX_RUN_MS = 14_400_000
export const DEFAULT_MAX_TOTAL_STEPS = 5000

export function defaultWorkspaceRoot(): string {
  return join(homedir(), 'nt')
}

export const DEFAULT_SETTINGS = (): Settings => ({
  workspaceRoot: defaultWorkspaceRoot(),
  maxSteps: 2000,
  commandTimeoutSec: 900,
  maxOutputTokens: 64000,
  compactAtPercent: 85,
  defaultModel: null,
  fallbackModel: null,
  permissionMode: 'ask',
  approvalMode: true,
  persona: '',
  studioPrompt: '',
  agentPrompt: '',
  maxRunMs: DEFAULT_MAX_RUN_MS,
  maxTotalStepsAcrossResumes: DEFAULT_MAX_TOTAL_STEPS
})

function normalizePermissionMode(v: unknown): PermissionMode {
  return v === 'full' ? 'full' : 'ask'
}

export function deriveApproval(s: Settings): Settings {
  const permissionMode = normalizePermissionMode(s.permissionMode)
  return { ...s, permissionMode, approvalMode: permissionMode === 'ask' }
}

export function writeCallBudget(maxOutputTokens: number): number {
  return Math.max(8000, Math.floor(maxOutputTokens * 2.2))
}

export const LIMITS = {
  toolOutputChars: 120000,
  uiOutputChars: 16000,
  llmConnectMs: 75_000,
  llmIdleMs: 180_000,
  thinkingChars: 100_000,
  retryAttempts: 10
}

export const PRIMARY_ATTEMPTS = 10
export const FALLBACK_ATTEMPTS = 5
export const SUMMARIZER_ATTEMPTS = 4

export const IDLE_MS_FIRST_ATTEMPTS = 90_000
export const IDLE_MS_PATIENT = 180_000

export function idleMsForAttempt(attempt: number): number {
  return attempt <= 2 ? IDLE_MS_FIRST_ATTEMPTS : IDLE_MS_PATIENT
}

export function compactAtThreshold(contextWindow: number, basePercent: number): number {
  if (contextWindow < 64_000) return Math.min(basePercent, 75)
  if (contextWindow < 128_000) return Math.min(basePercent, 80)
  return basePercent
}
