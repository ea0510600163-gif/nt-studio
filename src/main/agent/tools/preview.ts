import type { ToolContext, ToolResult, ToolSpec } from '../types'
import { truncate } from '../types'

/**
 * أدوات المعاينة والفحص الآلي.
 *
 * هذه الأدوات هي الفرق بين "كتب الكود" و"تأكّد أنه يعمل". النموذج يلتقط لقطة،
 * يقرأ أخطاء الكونسول، يفحص DOM، ويجرّب التفاعل — ثم يقرر بنفسه.
 *
 * التنفيذ عبر WebContentsView في العملية الرئيسية: محتوى غير موثوق يُعرض
 * في view معزول تمامًا عن واجهة التطبيق (لا وصول له للجسر أو لـ Node).
 */

export interface InspectDeps {
  /** يلتقط لقطة شاشة بصيغة base64. */
  screenshot: () => Promise<string>
  /** يجمع أخطاء الكونسول وpageerrors المرصودة. */
  consoleErrors: () => Promise<Array<{ level: string; text: string; line?: number }>>
  /** ينفّذ JS داخل الصفحة المعروضة ويعيد النتيجة JSON. */
  evaluate: (expression: string) => Promise<unknown>
  /** ينقر على عنصر ويعدّه. */
  click: (selector: string) => Promise<boolean>
  /** يكتب نصًا في حقل. */
  type: (selector: string, text: string) => Promise<boolean>
  /** يعيد العنوان والرابط الحالي. */
  pageInfo: () => Promise<{ url: string; title: string }>
  /** يعيد url المعروض الحالي. */
  currentUrl: () => Promise<string | null>
}

let deps: InspectDeps | null = null

export function setInspectDeps(next: InspectDeps | null): void {
  deps = next
}

function requireDeps(): InspectDeps {
  if (!deps) throw new Error('المعاينة غير مفعّلة — شغّل المشروع أولًا (start_dev_server)')
  return deps
}

const SELECTOR_HINT = 'Example: "button.play", "#submit", "nav a[href=\'/about\']"'

export const previewTools: ToolSpec[] = [
  {
    name: 'inspect_page',
    category: 'preview',
    parallelSafe: true,
    description: `Inspect the running app: page title, URL, console errors and page errors. Call this after start_dev_server and after every fix. This is how you KNOW the app works instead of assuming.`,
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, _t: ToolContext): Promise<ToolResult> {
      const d = requireDeps()
      const [info, errors] = await Promise.all([d.pageInfo(), d.consoleErrors()])
      const linesOut = [`url: ${info.url}`, `title: ${info.title || '(empty)'}`]
      if (errors.length === 0) {
        linesOut.push('console: clean (no errors)')
      } else {
        linesOut.push(`console: ${errors.length} issue(s)`)
        for (const e of errors.slice(0, 15)) {
          linesOut.push(`  [${e.level}]${e.line ? ` line ${e.line}` : ''} ${truncate(e.text, 400)}`)
        }
      }
      return {
        ok: errors.length === 0,
        text: linesOut.join('\n'),
        ui: errors.length === 0 ? 'الصفحة سليمة' : `${errors.length} خطأ`,
      }
    },
  },

  {
    name: 'take_screenshot',
    category: 'preview',
    description:
      'Capture a PNG screenshot of the preview. Use it to check the visual result (layout, spacing, contrast) before declaring done.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, _t: ToolContext): Promise<ToolResult> {
      const d = requireDeps()
      const data = await d.screenshot()
      const sizeKb = Math.round((data.length * 0.75) / 1024)
      return {
        ok: true,
        text: `Screenshot captured (${sizeKb} KB PNG). It is shown in the preview panel next to the code — read it to check the layout visually.`,
        ui: `لقطة ${sizeKb}KB`,
      }
    },
  },

  {
    name: 'evaluate_js',
    category: 'preview',
    description: `Run JavaScript inside the previewed page and return the JSON result. Use to inspect the DOM or query state. Example: document.querySelectorAll('button').length`,
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'JS expression to evaluate' } },
      required: ['expression'],
    },
    async execute(args, _t: ToolContext): Promise<ToolResult> {
      const d = requireDeps()
      const expression = String(args.expression ?? '')
      if (!expression) throw new Error('expression is required')
      const result = await d.evaluate(expression)
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? 'undefined'
      return { ok: true, text: truncate(String(text), 6_000), ui: 'تنفيذ JS' }
    },
  },

  {
    name: 'click_element',
    category: 'preview',
    description: `Click an element in the previewed page. Use it to verify buttons and navigation actually work. ${SELECTOR_HINT}`,
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector' } },
      required: ['selector'],
    },
    async execute(args, _t: ToolContext): Promise<ToolResult> {
      const d = requireDeps()
      const selector = String(args.selector ?? '')
      const clicked = await d.click(selector)
      if (!clicked) throw new Error(`No element matched "${selector}". Inspect the DOM first.`)
      await new Promise((r) => setTimeout(r, 700))
      const info = await d.pageInfo()
      const errors = await d.consoleErrors()
      const linesOut = [`clicked: ${selector}`, `url now: ${info.url}`]
      if (errors.length) linesOut.push(`console errors: ${errors.length}`)
      return { ok: true, text: linesOut.join('\n'), ui: `نقر ${selector.slice(0, 24)}` }
    },
  },

  {
    name: 'type_text',
    category: 'preview',
    description: `Type text into an input in the previewed page, to verify forms work. ${SELECTOR_HINT}`,
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
      required: ['selector', 'text'],
    },
    async execute(args, _t: ToolContext): Promise<ToolResult> {
      const d = requireDeps()
      const selector = String(args.selector ?? '')
      const text = String(args.text ?? '')
      const typed = await d.type(selector, text)
      if (!typed) throw new Error(`No editable element matched "${selector}"`)
      return { ok: true, text: `typed ${text.length} chars into ${selector}`, ui: 'إدخال نص' }
    },
  },

  {
    name: 'reload_preview',
    category: 'preview',
    description: 'Reload the previewed page. Use after writing files to see the change.',
    inputSchema: { type: 'object', properties: {} },
    async execute(_args, _t: ToolContext): Promise<ToolResult> {
      const d = requireDeps()
      const before = await d.pageInfo()
      await d.evaluate('location.reload()')
      await new Promise((r) => setTimeout(r, 1400))
      const after = await d.pageInfo()
      const errors = await d.consoleErrors()
      return {
        ok: errors.length === 0,
        text: `reloaded: ${after.url || before.url}\nconsole issues: ${errors.length}`,
        ui: 'تحديث المعاينة',
      }
    },
  },
]

