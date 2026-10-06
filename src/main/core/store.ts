import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ZodType } from 'zod'

/**
 * مخزن JSON ذرّي على القرص.
 *
 * لماذا هذا مكتوب يدويًا بدل `electron-store` أو `better-sqlite3`:
 *  - electron-store 11 أصبح ESM فقط، وهو يتعارض مع main بصيغة CommonJS
 *    (وهي شرط تشغيل preload داخل renderer معزول sandbox:true).
 *  - better-sqlite3 اعتماد native يحتاج خطوة بناء منفصلة لكل نسخة Electron،
 *    وهو أكبر مصدر فشل في تثبيت تطبيقات سطح المكتب.
 *
 * الضمانات: كتابة ذرّية (tmp ثم rename)، نسخة احتياطية قبل كل استبدال،
 * تحقق من المخطط عند القراءة، تدوير تلقائي عند التلف، وكتابة مؤجّلة.
 */

export interface JsonStoreOptions<T extends object> {
  /** المسار الكامل للملف. */
  file: string
  /** مخطط zod يفرض شكل البيانات. */
  schema: ZodType<T>
  /** القيم الافتراضية عند الغياب أو التلف. */
  defaults: T
  /** مهلة تجميع الكتابات قبل الكتابة الفعلية على القرص. */
  debounceMs?: number
  onError?: (scope: 'load' | 'save', error: unknown) => void
}

export class JsonStore<T extends object> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(private readonly opts: JsonStoreOptions<T>) {
    this.data = structuredClone(opts.defaults)
  }

  get file(): string {
    return this.opts.file
  }

  get(): T {
    return this.data
  }

  /** نسخة للقراءة فقط — لا تعدّلها مباشرة. */
  snapshot(): T {
    return structuredClone(this.data)
  }

  /** تحميل أول مرة. آمن للاستدعاء المتكرر. */
  async load(): Promise<T> {
    if (this.loaded) return this.data
    this.loaded = true
    const recovered = await this.readFromDisk()
    if (recovered !== null) this.data = recovered
    return this.data
  }

  /** دمج جزئي فوري في الذاكرة + جدولة الكتابة. */
  patch(partial: Partial<T>): T {
    this.data = { ...this.data, ...partial }
    this.schedule()
    return this.data
  }

  /** استبدال كامل (يُمرَّر عبر المخطط). */
  replace(next: T): T {
    const parsed = this.opts.schema.safeParse(next)
    this.data = parsed.success ? parsed.data : next
    this.schedule()
    return this.data
  }

  /** تعديل داخل معاملة ثم حفظ. */
  update<TK extends keyof T>(key: TK, mutate: (current: T[TK]) => T[TK]): T[TK] {
    const value = mutate(this.data[key])
    this.data = { ...this.data, [key]: value }
    this.schedule()
    return value
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    const ms = this.opts.debounceMs ?? 250
    if (ms <= 0) {
      void this.flush()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, ms)
  }

  /** كتابة فورية إلى القرص (يُستدعى عند الإغلاق). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const run = this.writing.then(() => this.writeNow())
    this.writing = run.catch(() => undefined)
    await run
  }

  private async readFromDisk(): Promise<T | null> {
    const candidates = [this.opts.file, `${this.opts.file}.bak`]
    for (const file of candidates) {
      try {
        const raw = await fs.readFile(file, 'utf8')
        if (!raw.trim()) continue
        const parsed = this.opts.schema.safeParse(JSON.parse(raw))
        if (parsed.success) return parsed.data
        this.opts.onError?.('load', new Error(`مخطط غير صالح في ${file}`))
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        if (err.code !== 'ENOENT') this.opts.onError?.('load', e)
      }
    }
    return null
  }

  private async writeNow(): Promise<void> {
    const { file, schema } = this.opts
    const validated = schema.safeParse(this.data)
    if (!validated.success) {
      this.opts.onError?.('save', new Error(`بيانات غير صالحة، أُلغي الحفظ: ${validated.error.message}`))
      return
    }
    const payload = `${JSON.stringify(validated.data, null, 2)}\n`
    const dir = path.dirname(file)
    await fs.mkdir(dir, { recursive: true })

    // نسخة احتياطية من النسخة السابقة قبل استبدالها.
    try {
      await fs.copyFile(file, `${file}.bak`)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') this.opts.onError?.('save', e)
    }

    // كتابة ذرّية: ملف مؤقت ثم إعادة تسمية (إما الكتابة كلها تظهر أو لا شيء).
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, payload, 'utf8')

    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(tmp, file)
        return
      } catch (e) {
        // على ويندوز قد يفشل rename إذا كان الملف مقفولاً لحظيًا (مضاد فيروسات/فهرسة).
        lastError = e
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)))
      }
    }
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    this.opts.onError?.('save', lastError)
  }
}