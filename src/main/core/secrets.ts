import { safeStorage } from 'electron'

/**
 * تشفير الأسرار على القرص.
 *
 * على ويندوز يستخدم هذا `safeStorage` أي DPAPI الخاص بالمستخدم — المفتاح
 * مرتبط بحساب ويندوز، فلا يمكن استخراج المفتاح من ملف الإعدادات المنسوخ
 * أو المقروء على جهاز آخر. هذا أقوى بكثير من أي مفتاح مشتق داخل التطبيق.
 *
 * الصيغة المحفوظة: `dpapi:<base64>` أو `aesgcm:<base64>` (احتياطي).
 */

const PREFIX_DPAPI = 'dpapi:'
const PREFIX_AES = 'aesgcm:'

export function secureStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function encryptSecret(plain: string): string {
  if (secureStorageAvailable()) {
    return PREFIX_DPAPI + safeStorage.encryptString(plain).toString('base64')
  }
  throw new Error(
    'تشفير نظام التشغيل غير متاح على هذا الجهاز — لا يمكن حفظ المفاتيح بأمان. فعّل "Toujours" كتخزين آمن أو استخدم جهاز ويندوز.',
  )
}

export function decryptSecret(stored: string): string {
  if (stored.startsWith(PREFIX_DPAPI)) {
    const raw = Buffer.from(stored.slice(PREFIX_DPAPI.length), 'base64')
    return safeStorage.decryptString(raw)
  }
  if (stored.startsWith(PREFIX_AES)) {
    throw new Error('صيغة احتياطية غير مدعومة في هذا الإصدار')
  }
  // قيمة قديمة غير مشفّرة: تُرفض عمدًا بدل تمريرها كما هي.
  throw new Error('المفتاح المحفوظ غير مشفّر — يُطلب إعادة إدخاله')
}

/** يخفي المفتاح جزئيًا للعرض في الواجهة. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return '••••'
  return `${plain.slice(0, 4)}${'•'.repeat(Math.min(16, plain.length - 8))}${plain.slice(-4)}`
}