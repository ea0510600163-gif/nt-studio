import type { ToolSchema } from '../providers/types'
import type { SessionMode } from '@shared/types'
import { selectModeTools } from './agentTools'
import { browserTools } from './browser'
import { computerTools } from './computer'
import { fileTools } from './files'
import { memoryTools } from './memory'
import { projectTools } from './project'
import { publishTools } from './publish'
import { shellTools } from './shell'
import { skillTools } from './skills'
import { subagentTools } from './subagent'
import { systemTools } from './system'
import type { Tool } from './types'
import { uploadTools } from './upload'
import { verifyTools } from './verify'
import { webTools } from './web'
import { worktreeTools } from './worktree'

export const ALL_TOOLS: Tool[] = [
  ...computerTools,
  ...memoryTools,
  ...projectTools,
  ...fileTools,
  ...shellTools,
  ...systemTools,
  ...webTools,
  ...publishTools,
  ...browserTools,
  ...uploadTools,
  ...verifyTools,
  ...skillTools,
  ...worktreeTools,
  ...subagentTools
]

const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]))

export const getTool = (name: string) => BY_NAME.get(name)

export function toolsForMode(mode: SessionMode): Tool[] {
  return selectModeTools(mode, ALL_TOOLS)
}

export const toSchemas = (tools: Tool[]): ToolSchema[] =>
  tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }))
