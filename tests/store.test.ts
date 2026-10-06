import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JsonStore } from '../src/main/core/store'
import { redact } from '../src/main/core/logger'

const schema = z.object({
  count: z.number().int(),
  name: z.string(),
  tags: z.array(z.string()).default([]),
})

const defaults = schema.parse({ count: 0, name: 'initial' })

const dirs: string[] = []

async function tmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `nt-studio-test-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})

describe('JsonStore', () => {
  it('يبدأ بالقيم الافتراضية عند غياب الملف', async () => {
    const file = path.join(await tmpDir(), 'state.json')
    const store = new JsonStore({ file, schema, defaults })
    expect(await store.load()).toEqual(defaults)
  })

  it('يكتب ذرّيًا ويقرأ القيمة نفسها من جديد', async () => {
    const file = path.join(await tmpDir(), 'state.json')
    const a = new JsonStore({ file, schema, defaults })
    await a.load()
    a.patch({ count: 7 })
    await a.flush()

    const b = new JsonStore({ file, schema, defaults })
    expect((await b.load()).count).toBe(7)
  })

  it('لا يترك ملفات مؤقتة بعد الكتابة', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'state.json')
    const store = new JsonStore({ file, schema, defaults })
    await store.load()
    store.patch({ name: 'x' })
    await store.flush()
    const entries = await fs.readdir(dir)
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
  })

  it('يتعافى من ملف تالف عبر النسخة الاحتياطية', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'state.json')

    const first = new JsonStore({ file, schema, defaults })
    await first.load()
    first.patch({ count: 42 })
    await first.flush()
    // النسخة الاحتياطية تُنشأ قبل الاستبدال التالي
    first.patch({ count: 99 })
    await first.flush()

    await fs.writeFile(file, '{ this is not json', 'utf8')

    const recovered = new JsonStore({ file, schema, defaults })
    const data = await recovered.load()
    expect(data.count).toBe(42)
  })

  it('يرفض الحفظ إذا خالفت البيانات المخطط', async () => {
    const dir = await tmpDir()
    const file = path.join(dir, 'state.json')
    const errors: unknown[] = []
    const store = new JsonStore({
      file,
      schema,
      defaults,
      onError: (_scope, e) => errors.push(e),
    })
    await store.load()
    // تجاوز النوع عمدًا
    ;(store.get() as unknown as { count: string }).count = 'not a number'
    await store.flush()

    expect(errors).toHaveLength(1)
    await expect(fs.readFile(file, 'utf8')).rejects.toThrow()
  })

  it('snapshot يعيد نسخة لا تغيّر الحالة', async () => {
    const file = path.join(await tmpDir(), 'state.json')
    const store = new JsonStore({ file, schema, defaults })
    await store.load()
    const snap = store.snapshot()
    snap.name = 'mutated'
    expect(store.get().name).toBe('initial')
  })
})

describe('redact', () => {
  it('يخفي مفاتيح OpenAI', () => {
    expect(redact('key=sk-abcdef1234567890')).toBe('key=sk-***')
  })

  it('يخفي ترويسة Authorization', () => {
    expect(redact('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  })

  it('يخفي حقول JSON الحساسة', () => {
    const out = redact('{"apiKey":"super-secret-value","model":"gpt"}')
    expect(out).not.toContain('super-secret-value')
    expect(out).toContain('gpt')
  })
})