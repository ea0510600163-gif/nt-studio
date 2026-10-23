import { existsSync, statSync, readFileSync, readdirSync } from 'fs'
import { basename, extname, resolve } from 'path'
import { IMAGE_EXT, imageDimensions } from './imageMeta'
import { Tool, fail, ok, schema } from './types'

export { imageDimensions }

export const verifyTools: Tool[] = [
  {
    name: 'verify_file',
    parallel: true,
    description:
      'Prove the real state of a file on disk: returns the absolute path, exact size in bytes, last-modified time, and image dimensions (W×H) for images. ' +
      'Returns an explicit failure with the parent folder contents when the path does not exist.',
    schema: schema(
      {
        path: { type: 'string', description: 'Absolute path, or a path relative to the current project/workspace' },
        expect_width: { type: 'number', description: 'Optional required image width in pixels (e.g. 1024)' },
        expect_height: { type: 'number', description: 'Optional required image height in pixels (e.g. 1024)' }
      },
      ['path']
    ),
    async run(i, ctx) {
      const raw = String(i.path ?? '').trim()
      if (!raw) return fail('حدّد path: مسار الملف المراد التحقق منه.')
      const abs = resolve(ctx.cwd(), raw)
      if (!existsSync(abs)) {
        let siblings = ''
        try {
          const parent = resolve(abs, '..')
          siblings = readdirSync(parent)
            .slice(0, 12)
            .join(', ')
        } catch {}
        return fail(
          `الملف غير موجود: ${abs}\n` +
            (siblings ? `ملفات المجلد الأب: ${siblings}\n` : '') +
            'تحقق من المسار الصحيح أو أنشئ الملف ثم أعد verify_file.'
        )
      }
      const st = statSync(abs)
      const ext = extname(abs).toLowerCase()
      const lines = [
        `الملف موجود: ${abs}`,
        `الاسم: ${basename(abs)}`,
        `الحجم: ${st.size} بايت (${(st.size / 1024).toFixed(1)} ك.ب)`,
        `آخر تعديل: ${new Date(st.mtimeMs).toLocaleString('ar')}`
      ]
      if (IMAGE_EXT.has(ext)) {
        try {
          const head = readFileSync(abs).subarray(0, 65536)
          const dim = imageDimensions(head)
          if (dim) {
            lines.push(`الأبعاد: ${dim.w}×${dim.h} (${dim.type})`)
            const ew = i.expect_width ? Number(i.expect_width) : null
            const eh = i.expect_height ? Number(i.expect_height) : null
            if ((ew && dim.w !== ew) || (eh && dim.h !== eh)) {
              return fail(
                lines.join('\n') +
                  `\n❌ الأبعاد لا تطابق المطلوب (المطلوب ${ew ?? '—'}×${eh ?? '—'}، الموجود ${dim.w}×${dim.h}).`
              )
            }
            lines.push('✅ الأبعاد مطابقة للمطلوب.')
          }
        } catch (e) {
          lines.push(`تعذّرت قراءة ترويسة الصورة: ${(e as Error).message}`)
        }
      }
      return ok(lines.join('\n'))
    }
  }
]
