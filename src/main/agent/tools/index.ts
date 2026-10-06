import type { ToolSet } from 'ai'
import { fsTools } from './fs'
import { projectTools } from './project'
import { memoryTools } from './memory'
import { controlTools } from './control'
import { previewTools } from './preview'
import type { ToolContext, ToolSpec } from '../types'

/** كل أدوات الوكيل في سجل واحد — الترتيب يعكس أولوية الاستخدام. */
export function toolCatalog(): ToolSpec[] {
  return [...controlTools, ...projectTools, ...fsTools, ...previewTools, ...memoryTools]
}

/** وصف مختصر للمجموعة، يُحقن في موجّه النظام. */
export function toolSummary(): string {
  const byCat: Record<string, string[]> = {}
  for (const t of toolCatalog()) {
    ;(byCat[t.category] ??= []).push(t.name)
  }
  const labels: Record<string, string> = {
    control: 'التخطيط والتواصل',
    project: 'المشروع والخوادم',
    fs: 'الملفات',
    preview: 'فحص النتيجة',
    memory: 'الذاكرة',
  }
  return Object.entries(byCat)
    .map(([cat, names]) => `- ${labels[cat] ?? cat}: ${names.join(', ')}`)
    .join('\n')
}

/**
 * يحوّل سجل أدواتنا إلى ToolSet يفهمه AI SDK.
 * كل أداة تُغلَّف لتلتقط الأخطاء كأداة فاشلة لا كرمي استثناء يُسقط الحلقة.
 */
export function buildToolSet(tools: ToolSpec[], t: ToolContext): ToolSet {
  const set: ToolSet = {}
  for (const spec of tools) {
    set[spec.name] = {
      description: spec.description,
      inputSchema: spec.inputSchema as ToolSet[string]['inputSchema'],
      execute: async (args: unknown) => {
        const started = Date.now()
        t.emit({
          type: 'tool_start',
          callId: '',
          name: spec.name,
          args: (args ?? {}) as Record<string, unknown>,
        })
        try {
          const res = await spec.execute((args ?? {}) as Record<string, unknown>, t)
          t.emit({
            type: 'tool_end',
            callId: '',
            name: spec.name,
            ok: res.ok,
            summary: res.ui ?? res.text.slice(0, 100),
            ms: Date.now() - started,
          })
          return res.text
        } catch (e) {
          const msg = (e as Error).message
          t.emit({ type: 'tool_end', callId: '', name: spec.name, ok: false, summary: msg.slice(0, 140), ms: Date.now() - started })
          throw new Error(msg)
        }
      },
    }
  }
  return set
}

