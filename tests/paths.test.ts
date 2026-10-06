import path from 'node:path'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  PathGuardError,
  assertAllowed,
  assertSafeName,
  isSubPathOf,
  normalize,
  protectedMatch,
  safeJoin,
  toPosix,
} from '../src/main/core/paths'

describe('normalize', () => {
  it('يزيل الشرط المتبقي في النهاية', () => {
    expect(normalize('D:\\NT\\Projects\\app\\')).toBe('D:\\NT\\Projects\\app')
  })

  it('يبقي جذر القرص كما هو', () => {
    const root = path.parse(process.cwd()).root
    expect(normalize(root)).toBe(root)
  })

  it('يطبّع المسارات النسبية إلى مطلقة', () => {
    expect(path.isAbsolute(normalize('foo/../bar'))).toBe(true)
  })
})

describe('toPosix', () => {
  it('يحوّل الشرطات المائلة العكسية', () => {
    expect(toPosix('D:\\NT\\a\\b')).toBe('D:/NT/a/b')
  })
})

describe('isSubPathOf', () => {
  it('يقبل المسار الفرعي', () => {
    expect(isSubPathOf('D:\\NT\\Projects\\app\\src', 'D:\\NT\\Projects')).toBe(true)
  })

  it('يقبل المسار نفسه', () => {
    expect(isSubPathOf('D:\\NT\\Projects', 'd:\\nt\\projects')).toBe(true)
  })

  it('يرفض شقيقًا بنفس البادئة', () => {
    // خطأ كلاسيكي: startsWith بدون فاصل يجعل "ProjectsOld" ابنًا لـ "Projects"
    expect(isSubPathOf('D:\\NT\\ProjectsOld', 'D:\\NT\\Projects')).toBe(false)
  })

  it('يرفض الخروج من الجذر', () => {
    expect(isSubPathOf('C:\\Windows\\System32', 'D:\\NT')).toBe(false)
  })
})

describe('protectedMatch', () => {
  it('يلتقط مجلدات النظام', () => {
    expect(protectedMatch('C:\\Windows\\System32\\drivers')).not.toBeNull()
  })

  it('يسمح لمجلدات المستخدم', () => {
    expect(protectedMatch('D:\\NT\\Projects\\app\\src\\index.ts')).toBeNull()
  })
})

describe('assertAllowed', () => {
  it('يسمح بالقراءة في أي مكان', () => {
    const target = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    expect(() => assertAllowed(target, 'read')).not.toThrow()
  })

  it('يمنع الكتابة في System32', () => {
    const target = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'x.dll')
    expect(() => assertAllowed(target, 'write')).toThrow(PathGuardError)
  })

  it('يمنع الحذف داخل Program Files', () => {
    expect(() => assertAllowed('C:\\Program Files\\app\\x.exe', 'delete')).toThrow(PathGuardError)
  })

  it('يسمح بالكتابة داخل جذر المشاريع', () => {
    const target = path.join(os.tmpdir(), 'nt-studio-test', 'file.txt')
    expect(assertAllowed(target, 'write')).toBe(normalize(target))
  })
})

describe('safeJoin', () => {
  const root = path.join(os.tmpdir(), 'nt-studio-root')

  it('يجمع مسارًا نسبيًا داخل الجذر', () => {
    expect(safeJoin(root, 'src/index.ts')).toBe(normalize(path.join(root, 'src', 'index.ts')))
  })

  it('يمنع الخروج بـ ..', () => {
    expect(() => safeJoin(root, '../../Windows/System32')).toThrow(PathGuardError)
  })

  it('يمنع المسار المطلق خارج الجذر', () => {
    expect(() => safeJoin(root, 'C:\\Windows')).toThrow(PathGuardError)
  })

  it('يسمح بمسار مطلق داخل الجذر', () => {
    const inner = path.join(root, 'app')
    expect(safeJoin(root, inner)).toBe(normalize(inner))
  })
})

describe('assertSafeName', () => {
  it('يقبل اسمًا عاديًا بشرطة', () => {
    expect(assertSafeName('my-game-v2')).toBe('my-game-v2')
  })

  it('يرفض محارف ويندوز الممنوعة', () => {
    for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', 'a/b', 'a\\b', 'a|b', 'a?b', 'a*b']) {
      expect(() => assertSafeName(bad)).toThrow(PathGuardError)
    }
  })

  it('يرفض محرف التحكم', () => {
    expect(() => assertSafeName('a' + String.fromCharCode(7) + 'b')).toThrow(PathGuardError)
  })

  it('يرفض النقاط في الأطراف', () => {
    expect(() => assertSafeName('..')).toThrow(PathGuardError)
    expect(() => assertSafeName('.hidden')).toThrow(PathGuardError)
    expect(() => assertSafeName('trailing.')).toThrow(PathGuardError)
  })

  it('يرفض الاسم الفارغ والطويل', () => {
    expect(() => assertSafeName('   ')).toThrow(PathGuardError)
    expect(() => assertSafeName('x'.repeat(129))).toThrow(PathGuardError)
  })
})