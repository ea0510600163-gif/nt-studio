import {
  BookOpen, Bot, Brain, Camera, CircleAlert, CircleHelp, Code2, Compass, Cpu, Eye, FilePen, FilePlus2, FileSearch, FolderOpen, FolderPlus, GitCommitHorizontal,
  Globe, Keyboard, ListChecks, MousePointerClick, Move, Paperclip, Play, Search, ShieldCheck, Sparkles, SquareTerminal, Square, Trash2, Wand2, Zap, type LucideIcon
} from 'lucide-react'

export type ToolCat =
  | 'read' | 'edit' | 'search' | 'shell' | 'preview' | 'web'
  | 'plan' | 'project' | 'memory' | 'system' | 'agent' | 'note' | 'other'

export const CATS: Record<ToolCat, { name: string; icon: LucideIcon; color: string }> = {
  read: { name: 'قراءة', icon: BookOpen, color: 'var(--cat-read)' },
  edit: { name: 'تعديل', icon: FilePen, color: 'var(--cat-edit)' },
  search: { name: 'Grep', icon: Search, color: 'var(--cat-search)' },
  shell: { name: 'Shell', icon: SquareTerminal, color: 'var(--cat-shell)' },
  preview: { name: 'المعاينة', icon: Eye, color: 'var(--cat-preview)' },
  web: { name: 'ويب', icon: Globe, color: 'var(--cat-web)' },
  plan: { name: 'الخطة', icon: ListChecks, color: 'var(--cat-plan)' },
  project: { name: 'المشروع', icon: FolderOpen, color: 'var(--cat-project)' },
  memory: { name: 'الذاكرة', icon: Brain, color: 'var(--cat-memory)' },
  system: { name: 'النظام', icon: Cpu, color: 'var(--cat-system)' },
  agent: { name: 'وكيل ذكي', icon: Bot, color: 'var(--color-brass-hi)' },
  note: { name: 'ملاحظة', icon: Sparkles, color: 'var(--color-faint)' },
  other: { name: 'أخرى', icon: Wand2, color: 'var(--color-faint)' }
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const short = (v: string, n = 70) => (v.length > n ? v.slice(0, n) + '…' : v)

interface Meta {
  label: string
  icon: LucideIcon
  arg?: (i: any) => string
}

const META: Record<string, Meta> = {
  __invalid_call: { label: 'استدعاء غير صالح', icon: CircleAlert },
  create_project: { label: 'إنشاء مشروع', icon: FolderPlus, arg: (i) => s(i.name) },
  open_project: { label: 'فتح مشروع', icon: FolderOpen, arg: (i) => s(i.slug) },
  list_projects: { label: 'قائمة المشاريع', icon: FolderOpen },
  todo_write: { label: 'تحديث الخطة', icon: ListChecks, arg: (i) => `${(i.items ?? []).length} بنود` },
  checkpoint: { label: 'نقطة استرجاع', icon: GitCommitHorizontal, arg: (i) => s(i.message) },
  memory_read: { label: 'قراءة الذاكرة', icon: Brain, arg: (i) => s(i.scope) },
  memory_write: { label: 'حفظ في الذاكرة', icon: Brain, arg: (i) => s(i.key) },
  memory: { label: 'ذاكرة دائمة', icon: Brain, arg: (i) => s(i.action) },
  publish_site: { label: 'نشر الموقع', icon: Globe, arg: (i) => s(i.repo) },
  ask_user: { label: 'سؤال للمستخدم', icon: CircleHelp },
  run_command: { label: 'أمر', icon: SquareTerminal, arg: (i) => short(s(i.command), 90) },
  read_process_output: { label: 'قراءة مخرجات عملية', icon: SquareTerminal, arg: (i) => s(i.id) },
  send_process_input: { label: 'إدخال لعملية', icon: Keyboard, arg: (i) => short(s(i.input), 40) },
  stop_process: { label: 'إيقاف عملية', icon: Square, arg: (i) => s(i.id) },
  list_processes: { label: 'العمليات', icon: Cpu },
  read_file: { label: 'قراءة', icon: Code2, arg: (i) => (Array.isArray(i.paths) ? `${i.paths.length} ملفات` : s(i.path)) },
  verify_file: { label: 'إثبات ملف', icon: ShieldCheck, arg: (i) => s(i.path) },
  write_file: { label: 'كتابة', icon: FilePlus2, arg: (i) => s(i.path) },
  edit_file: { label: 'تعديل', icon: FilePen, arg: (i) => s(i.path) },
  delete_path: { label: 'حذف', icon: Trash2, arg: (i) => s(i.path) },
  move_path: { label: 'نقل', icon: Move, arg: (i) => `${s(i.from)} ← ${s(i.to)}` },
  make_dir: { label: 'مجلد', icon: FolderPlus, arg: (i) => s(i.path) },
  list_dir: { label: 'استعراض', icon: FolderOpen, arg: (i) => s(i.path ?? '.') },
  glob: { label: 'بحث عن ملفات', icon: FileSearch, arg: (i) => s(i.pattern) },
  grep: { label: 'بحث في المحتوى', icon: Search, arg: (i) => s(i.pattern) },
  system_info: { label: 'فحص النظام', icon: Cpu, arg: (i) => s(i.section) },
  free_port: { label: 'منفذ حر', icon: Cpu },
  web_search: { label: 'بحث في الويب', icon: Globe, arg: (i) => s(i.query) },
  web_fetch: { label: 'جلب صفحة', icon: Globe, arg: (i) => short(s(i.url), 60) },
  web_open: { label: 'فتح موقع', icon: Globe, arg: (i) => short(s(i.target), 60) },
  browser_nav: { label: 'تنقل رجوع/تقدم', icon: Play, arg: (i) => (i.dir === 'back' ? 'رجوع' : i.dir === 'forward' ? 'تقدم' : s(i.dir)) },
  preview_open: { label: 'فتح المعاينة', icon: Play, arg: (i) => (i.port ? `localhost:${i.port}` : s(i.url ?? i.path)) },
  preview_reload: { label: 'إعادة تحميل', icon: Play },
  preview_close: { label: 'إغلاق المعاينة', icon: Eye },
  browser_screenshot: { label: 'لقطة شاشة', icon: Camera },
  browser_snapshot: { label: 'قراءة الصفحة', icon: Eye },
  browser_click: { label: 'نقر', icon: MousePointerClick, arg: (i) => (i.text ? s(i.text) : i.ref != null ? `#${i.ref}` : s(i.selector ?? `${i.x},${i.y}`)) },
  browser_type: { label: 'كتابة في حقل', icon: Keyboard, arg: (i) => short(s(i.value), 40) },
  browser_press: { label: 'ضغط مفتاح', icon: Keyboard, arg: (i) => s(i.key) },
  browser_scroll: { label: 'تمرير', icon: Eye },
  browser_wait: { label: 'انتظار', icon: Eye },
  browser_console: { label: 'قراءة Console', icon: SquareTerminal },
  browser_resize: { label: 'تغيير الحجم', icon: Eye, arg: (i) => s(i.device) },
  browser_eval: { label: 'تنفيذ JS', icon: Wand2, arg: (i) => short(s(i.js), 60) },
  browser_audit: { label: 'فحص شامل للصفحة', icon: Eye },
  browser_upload: { label: 'رفع ملف', icon: Paperclip, arg: (i) => short(s(i.paths), 60) },
  visual_check: { label: 'فحص بصري شامل', icon: Camera },
  skill_read: { label: 'قراءة مهارة', icon: Sparkles, arg: (i) => s(i.id) },
  skill_list: { label: 'فهرس المهارات', icon: Sparkles },
  skill_save: { label: 'حفظ مهارة', icon: Sparkles, arg: (i) => s(i.label || i.id) },
  skill_delete: { label: 'حذف مهارة', icon: Trash2, arg: (i) => s(i.id) },
  worktree_create: { label: 'نسخة عمل معزولة', icon: GitCommitHorizontal, arg: (i) => s(i.branch) },
  worktree_list: { label: 'نسخ العمل', icon: GitCommitHorizontal },
  worktree_remove: { label: 'إزالة نسخة عمل', icon: Trash2, arg: (i) => s(i.path) },
  spawn_agent: {
    label: 'تشغيل وكيل',
    icon: Bot,
    arg: (i) => `${i.agent === 'execute' ? 'وكيل تنفيذ' : 'وكيل استكشاف'} · ${short(s(i.title || i.prompt), 60)}`
  },
  computer: {
    label: 'تحكم بسطح المكتب',
    icon: MousePointerClick,
    arg: (i) => {
      const act = s(i.action)
      const cx = Array.isArray(i.coordinate) ? i.coordinate[0] : i.x
      const cy = Array.isArray(i.coordinate) ? i.coordinate[1] : i.y
      const pos = cx != null && cy != null ? `(${cx}, ${cy})` : ''
      const tgt = i.target ? `«${short(s(i.target), 28)}» ` : ''
      const map: Record<string, string> = {
        screenshot: 'لقطة شاشة 1:1 لسطح المكتب',
        inspect_ui: 'مسح العناصر التفاعلية (UIA)',
        left_click: `نقر أيسر ${tgt}${pos}${i.text ? ` + كتابة «${short(s(i.text), 24)}»` : ''}`,
        double_click: `نقر مزدوج ${tgt}${pos}`,
        triple_click: `نقر ثلاثي ${tgt}${pos}`,
        right_click: `نقر أيمن ${tgt}${pos}`,
        middle_click: `نقر أوسط ${tgt}${pos}`,
        mouse_move: `تحريك الماوس ${tgt}${pos}`,
        left_click_drag: `سحب وإفلات إلى ${pos}`,
        type: `كتابة ${tgt}${pos}: «${short(s(i.text), 35)}»`,
        key: `مفتاح: ${s(i.key || i.text)}${i.key && i.text && i.text !== i.key ? ` + كتابة «${short(s(i.text), 24)}»` : ''}`,
        hold_key: `ضغط مطوّل: ${s(i.key || i.text)}`,
        scroll: `تمرير ${s(i.direction || 'down')}`,
        wait: `انتظار ${s(i.duration ?? 1)}ث`,
        cursor_position: 'قراءة موقع المؤشر',
        clipboard_read: 'قراءة الحافظة',
        clipboard_write: `نسخ للحافظة: «${short(s(i.text), 30)}»`,
        batch: `سلسلة أوامر (${Array.isArray(i.steps) ? i.steps.length : 0} خطوات)`
      }
      return map[act] ?? `${act} ${tgt}${pos}`.trim()
    }
  },
  desktop_app: {
    label: 'تطبيقات سطح المكتب',
    icon: Cpu,
    arg: (i) => {
      const act = s(i.action)
      if (act === 'open_app') return `فتح تطبيق: ${s(i.app)}`
      if (act === 'open_url') return `فتح رابط: ${short(s(i.url), 40)}`
      if (act === 'focus_window') return `التركيز على: ${s(i.window_title || i.app)}`
      if (act === 'list_windows') return 'قائمة النوافذ المفتوحة'
      if (act === 'minimize_studio') return 'تصغير البرنامج للعمل المباشر'
      if (act === 'restore_studio') return 'إظهار نافذة البرنامج'
      return act
    }
  },
  progress: {
    label: 'تحديث خطة العمل',
    icon: ListChecks,
    arg: (i) => `${Array.isArray(i.done) ? i.done.length : 0}/${Array.isArray(i.plan) ? i.plan.length : 0} خطوات منجزة`
  }
}

const CAT: Record<string, ToolCat> = {
  read_file: 'read', list_dir: 'read', list_projects: 'read', read_process_output: 'read', list_processes: 'read', skill_read: 'read', skill_list: 'read', verify_file: 'read',
  write_file: 'edit', edit_file: 'edit', delete_path: 'edit', move_path: 'edit', make_dir: 'edit', skill_save: 'edit', skill_delete: 'edit',
  grep: 'search', glob: 'search',
  run_command: 'shell', send_process_input: 'shell', stop_process: 'shell',
  web_search: 'web', web_fetch: 'web', web_open: 'web',
  todo_write: 'plan',
  progress: 'plan',
  computer: 'agent',
  desktop_app: 'system',
  create_project: 'project', open_project: 'project', checkpoint: 'project', worktree_create: 'project', worktree_list: 'project', worktree_remove: 'project',
  memory_read: 'memory', memory_write: 'memory', memory: 'memory',
  system_info: 'system', free_port: 'system',
  spawn_agent: 'agent'
}

export function toolCat(name: string): ToolCat {
  const direct = CAT[name]
  if (direct) return direct
  if (name.startsWith('preview_') || name.startsWith('browser_')) return 'preview'
  return 'other'
}

export function toolMeta(name: string, input: unknown): { label: string; icon: LucideIcon; arg: string; cat: ToolCat } {
  if (name === 'spawn_agent') {
    const raw = (input ?? {}) as Record<string, unknown>
    const isExec = raw.agent === 'execute'
    return {
      label: isExec ? 'وكيل التنفيذ' : 'وكيل الاستكشاف',
      icon: isExec ? Zap : Compass,
      arg: short(s(raw.title || raw.prompt), 65),
      cat: 'agent'
    }
  }
  const m = META[name] ?? { label: name, icon: Wand2 }
  let arg = ''
  try { arg = m.arg ? m.arg(input ?? {}) : '' } catch {}
  return { label: m.label, icon: m.icon, arg, cat: toolCat(name) }
}

export interface SearchSource {
  n: number
  title: string
  url: string
  domain: string
  snippet: string
}

const HEAD = /^(\d+)\.\s+(.+)$/

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 48)
  }
}

export function parseSearchSources(output: string): SearchSource[] {
  const out: SearchSource[] = []
  let current: SearchSource | null = null
  for (const raw of output.split('\n')) {
    if (!raw.trim()) continue
    const head = HEAD.exec(raw)
    if (head) {
      current = { n: Number(head[1]), title: head[2].trim(), url: '', domain: '', snippet: '' }
      out.push(current)
      continue
    }
    if (!current) continue
    const line = raw.trim()
    if (!current.url && /^https?:\/\//i.test(line)) {
      current.url = line
      current.domain = domainOf(line)
      continue
    }
    if (!current.snippet) current.snippet = line
  }
  return out.filter((s) => s.url)
}
