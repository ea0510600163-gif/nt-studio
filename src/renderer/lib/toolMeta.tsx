import {
  BookOpen, Brain, Camera, CircleAlert, CircleHelp, Code2, Cpu, Eye, FilePen, FilePlus2, FileSearch, FolderOpen, FolderPlus, GitCommitHorizontal,
  Globe, Keyboard, ListChecks, MousePointerClick, Move, Paperclip, Play, Search, Sparkles, SquareTerminal, Square, Trash2, Wand2, type LucideIcon
} from 'lucide-react'

export type ToolCat =
  | 'read' | 'edit' | 'search' | 'shell' | 'preview' | 'web'
  | 'plan' | 'project' | 'memory' | 'system' | 'note' | 'other'

/** اسم الفئة وأيقونتها ولونها — اللون متغيّر CSS معرّف في styles.css */
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
  ask_user: { label: 'سؤال للمستخدم', icon: CircleHelp },
  run_command: { label: 'أمر', icon: SquareTerminal, arg: (i) => short(s(i.command), 90) },
  read_process_output: { label: 'قراءة مخرجات عملية', icon: SquareTerminal, arg: (i) => s(i.id) },
  send_process_input: { label: 'إدخال لعملية', icon: Keyboard, arg: (i) => short(s(i.input), 40) },
  stop_process: { label: 'إيقاف عملية', icon: Square, arg: (i) => s(i.id) },
  list_processes: { label: 'العمليات', icon: Cpu },
  read_file: { label: 'قراءة', icon: Code2, arg: (i) => s(i.path) },
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
  worktree_create: { label: 'نسخة عمل معزولة', icon: GitCommitHorizontal, arg: (i) => s(i.branch) },
  worktree_list: { label: 'نسخ العمل', icon: GitCommitHorizontal },
  worktree_remove: { label: 'إزالة نسخة عمل', icon: Trash2, arg: (i) => s(i.path) }
}

const CAT: Record<string, ToolCat> = {
  read_file: 'read', list_dir: 'read', list_projects: 'read', read_process_output: 'read', list_processes: 'read', skill_read: 'read', skill_list: 'read',
  write_file: 'edit', edit_file: 'edit', delete_path: 'edit', move_path: 'edit', make_dir: 'edit',
  grep: 'search', glob: 'search',
  run_command: 'shell', send_process_input: 'shell', stop_process: 'shell',
  web_search: 'web', web_fetch: 'web', web_open: 'web',
  todo_write: 'plan',
  create_project: 'project', open_project: 'project', checkpoint: 'project', worktree_create: 'project', worktree_list: 'project', worktree_remove: 'project',
  memory_read: 'memory', memory_write: 'memory',
  system_info: 'system', free_port: 'system'
}

/** فئة الأداة؛ الأدوات غير المعرَّفة في «أخرى»، وأدوات المعاينة والمتصفح في «preview» */
export function toolCat(name: string): ToolCat {
  const direct = CAT[name]
  if (direct) return direct
  if (name.startsWith('preview_') || name.startsWith('browser_')) return 'preview'
  return 'other'
}

export function toolMeta(name: string, input: unknown): { label: string; icon: LucideIcon; arg: string; cat: ToolCat } {
  const m = META[name] ?? { label: name, icon: Wand2 }
  let arg = ''
  try { arg = m.arg ? m.arg(input ?? {}) : '' } catch { /* تجاهل */ }
  return { label: m.label, icon: m.icon, arg, cat: toolCat(name) }
}
