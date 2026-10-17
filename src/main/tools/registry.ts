import type { ToolSchema } from '../providers/types'
import type { SessionMode } from '@shared/types'
import { selectModeTools } from './agentTools'
import { browserTools } from './browser'
import { fileTools } from './files'
import { projectTools } from './project'
import { shellTools } from './shell'
import { skillTools } from './skills'
import { systemTools } from './system'
import type { Tool } from './types'
import { uploadTools } from './upload'
import { webTools } from './web'
import { worktreeTools } from './worktree'

export const ALL_TOOLS: Tool[] = [
  ...projectTools,
  ...fileTools,
  ...shellTools,
  ...systemTools,
  ...webTools,
  ...browserTools,
  ...uploadTools,
  ...skillTools,
  ...worktreeTools
]

const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]))

export const getTool = (name: string) => BY_NAME.get(name)

/**
 * جميع أدوات البيئة متاحة دائماً للنموذج دون حجب:
 * - يسمح للنموذج بالقراءة أو البحث أو التنفيذ مباشرة في مساحة العمل حتى قبل إنشاء مشروع.
 * - يسمح بإنشاء أو فتح مشروع آخر في أي وقت داخل الجلسة نفسها.
 * - يحافظ على ثبات مخطط الأدوات عبر الأدوار مما يضمن فعالية Prompt Caching.
 */
export function activeTools(_hasProject?: boolean): Tool[] {
  return ALL_TOOLS
}

/**
 * أدوات الجلسة حسب وضعها: studio ترى كل شيء (كما اليوم حرفياً)، وagent
 * ترى أدوات المتصفح فقط (AGENT_TOOL_NAMES). أي اسم في القائمة بلا أداة
 * مسجلة يُتجاهل بصمت حتى لا تكسر إضافة لاحقة.
 */
export function toolsForMode(mode: SessionMode): Tool[] {
  return selectModeTools(mode, ALL_TOOLS)
}

export const toSchemas = (tools: Tool[]): ToolSchema[] =>
  tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }))
