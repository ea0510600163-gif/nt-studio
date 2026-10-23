import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SkillInfo } from '@shared/types'

export type Skill = SkillInfo

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i

export function sanitizeSkillId(raw: string): string {
  const clean = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return clean || `skill-${Date.now().toString(36)}`
}

export function parseSkill(id: string, raw: string): Skill {
  const text = String(raw ?? '')
  const label = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || id
  const quoted = /^>\s+(.+)$/m.exec(text)?.[1]?.trim()
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && !l.startsWith('>'))
  const description = (quoted || firstLine || '').slice(0, 160)
  return {
    id,
    label,
    description,
    content: text,
    isDefault: id === 'skill-creator' || id in DEFAULT_SKILL_FILES
  }
}

export function formatSkillMarkdown(input: { label: string; description: string; content: string }): string {
  const body = String(input.content ?? '').trim()
  if (body.startsWith('# ')) return body + '\n'
  const title = String(input.label ?? '').trim() || 'مهارة مخصصة'
  const desc = String(input.description ?? '').trim()
  return `# ${title}\n${desc ? `> ${desc}\n\n` : '\n'}${body}\n`
}

export function ensureSkillsDir(dir: string, seed: Record<string, string> = DEFAULT_SKILL_FILES): string {
  mkdirSync(dir, { recursive: true })
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'))
  } catch {
    files = []
  }
  if (!files.length) {
    for (const [id, content] of Object.entries(seed)) {
      try {
        writeFileSync(join(dir, `${id}.md`), content, 'utf8')
      } catch {}
    }
  } else if (!files.some((f) => f.toLowerCase() === 'skill-creator.md') && seed['skill-creator']) {
    try {
      writeFileSync(join(dir, 'skill-creator.md'), seed['skill-creator'], 'utf8')
    } catch {}
  }
  return dir
}

export function listSkills(dir: string): Skill[] {
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  const out: Skill[] = []
  for (const f of files.sort()) {
    const id = f.replace(/\.md$/i, '')
    if (!ID_RE.test(id)) continue
    try {
      out.push(parseSkill(id, readFileSync(join(dir, f), 'utf8')))
    } catch {}
  }
  return out.sort((a, b) => {
    if (a.id === 'skill-creator') return -1
    if (b.id === 'skill-creator') return 1
    return a.id.localeCompare(b.id)
  })
}

export function getSkill(dir: string, id: string): Skill | undefined {
  const key = String(id ?? '').trim()
  if (!ID_RE.test(key)) return undefined
  const file = join(dir, `${key}.md`)
  if (!existsSync(file)) return undefined
  try {
    return parseSkill(key, readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

export function saveSkill(dir: string, input: { id: string; label?: string; description?: string; content: string }): Skill {
  mkdirSync(dir, { recursive: true })
  const id = sanitizeSkillId(input.id || input.label || 'custom-skill')
  const md = formatSkillMarkdown({
    label: input.label || id,
    description: input.description || '',
    content: input.content
  })
  writeFileSync(join(dir, `${id}.md`), md, 'utf8')
  return parseSkill(id, md)
}

export function deleteSkill(dir: string, id: string): boolean {
  const key = String(id ?? '').trim()
  if (!ID_RE.test(key)) return false
  const file = join(dir, `${key}.md`)
  if (!existsSync(file)) return false
  try {
    unlinkSync(file)
    return true
  } catch {
    return false
  }
}

export const DEFAULT_SKILL_FILES: Record<string, string> = {
  'skill-creator': `# صانع المهارات الاحترافية
> المهارة الافتراضية لتصميم وإنشاء وحفظ مهارات جديدة فائقة الاحترافية داخل NT Studio

عند تفعيل هذه المهارة، مهمتك هي تصميم وبناء مهارة (Skill) احترافية متكاملة وحفظها مباشرة في التطبيق باستخدام أداة \`skill_save\`.

## هيكل المهارة القياسي في NT Studio
كل مهارة تُحفظ عبر \`skill_save\` بالمعطيات التالية:
- \`id\`: معرّف إنجليزي بصيغة kebab-case (مثال: \`cyber-ui-architect\` أو \`fullstack-saas\`).
- \`label\`: اسم المهارة بالعربية بشكل واضح وجذاب.
- \`description\`: وصف مكثّف من سطر واحد يوضّح متى ولماذا تُستعمل المهارة.
- \`content\`: الدليل الكامل بصيغة Markdown، ويضم:
  1. **الهدف والنطاق**: ما الذي تحقّقه المهارة بدقة.
  2. **المكدس والأدوات المفضّلة**: التقنيات، المكتبات، وأدوات NT Studio المناسبة (\`read_file\`, \`edit_file\`, \`run_command\`, \`computer\`, \`preview_open\`, \`visual_check\`).
  3. **الهندسة المعمارية وخطوات التنفيذ**: تسلسل العمل المتقن من الفهم حتى التسليم والتحقق.
  4. **معايير الجودة الفائقة**: قواعد الكود النظيف، الأداء، وتجربة المستخدم.

احفظ المهارة فوراً عبر \`skill_save\` لتظهر مباشرة في قائمة مهارات المستخدم داخل التطبيق.`,
  'landing-rtl': `# صفحة هبوط عربية فاخرة
> HTML/CSS/JS حديث أو React — للمواقع التعريفية والصفحات الفاخرة بالعربية (RTL)

المكدس: HTML حديث + CSS متقدم + JS تفاعلي، أو Vite + React + Tailwind عند الحاجة.
الخطوط: IBM Plex Sans Arabic و Noto Kufi Arabic و JetBrains Mono للأرقام والأكواد.
اعتبارات RTL: الخصائص المنطقية (margin-inline، padding-inline، inset-inline)، وdir="rtl" على html، وتباين لوني هندسي متقن.`,
  'dashboard-react': `# لوحة تحكم تفاعلية هندسية
> Vite + React + Tailwind — للجداول والبيانات الحية والفلاتر ولوحات القيادة

المكدس: Vite + React + Tailwind.
البنية:
\`\`\`
src/components/ — بطاقات إحصائية، جداول تفاعلية، فلاتر، رسوم بيانية
src/lib/store.ts — إدارة الحالة
src/data/ — بيانات واقعية غنية
\`\`\`
المعايير: بحث فوري، فرز، حالات تحميل وفراغ واضحة، وتصميم هندسي عالي الدقة.`,
  'game-canvas': `# لعبة Canvas تفاعلية
> Canvas 2D / WebGL + TypeScript — للألعاب السريعة والمحاكاة البصرية

المكدس: HTML Canvas 2D + TypeScript + requestAnimationFrame.
العناصر الأساسية: حلقة تحديث ورسم بـ deltaTime، فيزياء سلسة، مؤثرات جزيئات، تحكم بلوحة المفاتيح والماوس، شاشة بداية ونهاية وحفظ أعلى نتيجة.`,
  'api-node': `# خدمة خلفية و API متكامل
> Node.js + TypeScript — للواجهات الخلفية وقواعد البيانات والخدمات السريعة

المكدس: Node حديث + Fastify/Express + TypeScript + SQLite/JSON.
المعايير: تحقق كامل من المدخلات، معالجة أخطاء نظيفة، وتجربة حية لكل المسارات بعد التشغيل.`,
  'python-tool': `# أتمتة وأدوات Python
> Python 3 — لمعالجة البيانات، السكربتات الذكية، وأدوات سطر الأوامر

المكدس: Python 3 + pathlib + argparse.
المعايير: كود نظيف ومباشر، دعم كامل لترميز UTF-8، وتجربة فعلية قبل التسليم.`
}
