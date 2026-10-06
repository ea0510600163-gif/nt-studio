import { jsonSchema, type ToolSet } from 'ai'
import { fsTools } from './fs'
import { projectTools } from './project'
import { memoryTools } from './memory'
import { controlTools } from './control'
import { previewTools } from './preview'
import type { ToolSpec } from '../types'

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
 *
 * قراران مقصودان هنا، وكلاهما أصلح عطبًا حقيقيًا:
 *
 * 1) **بلا `execute`.** الحلقة اليدوية في `loop.ts` هي المانِفّذ الوحيد للأدوات.
 *    لو أرفقنا `execute` هنا لأدّى الـ SDK الأداة بنفسه (loop.ts: الدالة تُمرَّر
 *    إلى generateText)، ثم أعاد `loop.ts` تنفيذ النداء نفسه — أي أن كل أداة
 *    كانت تعمل مرتين: `create_project` مرتين، `npm install` مرتين، وخادم تطوير
 *    ثانٍ يُقتل الأول. أداة معرَّفة بلا `execute` يعيدها `generateText` في
 *    `result.toolCalls` **دون تنفيذ** (مُتحقَّق منه على ai@7.0.128).
 *
 * 2) **`jsonSchema(...)` حول المخطط.** مخططاتنا JSON Schema خام. الـ SDK يقرأ
 *    `inputSchema` على أنه *دالة* أو غلاف `Schema`، فالمخطط الخام كان يرمي
 *    `TypeError: schema is not a function`. `jsonSchema()` هو الغلاف الرسمي.
 *
 * الأداة تُغلَّف لأخطاء الأداة نفسها (تنفيذها في loop.ts:runOne) لا هنا.
 */
export function buildToolSet(tools: ToolSpec[]): ToolSet {
  const set: ToolSet = {}
  for (const spec of tools) {
    set[spec.name] = {
      description: spec.description,
      inputSchema: jsonSchema(spec.inputSchema),
    }
  }
  return set
}

