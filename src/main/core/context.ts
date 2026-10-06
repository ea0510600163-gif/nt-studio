import { app } from 'electron'
import path from 'node:path'
import { z } from 'zod'
import { Logger, type ScopedLogger } from './logger'
import { JsonStore } from './store'

/**
 * سياق التطبيق: نقطة واحدة تُنشئ كل حالة طويلة العمر وتمرّرها للوحدات.
 * لا تستخدم أي وحدة `app.getPath` مباشرة، ولا تمسك حالة في متغيرات عامة.
 */

export const appStateSchema = z.object({
  schemaVersion: z.number().int().default(1),
  /** جذر المشاريع المولّدة — افتراضيًا D:\NT\Projects. */
  projectsRoot: z.string().default('D:\\NT\\Projects'),
  theme: z.enum(['dark', 'light']).default('dark'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  firstRunCompleted: z.boolean().default(false),
  /** يملؤه S3 بمخطط المزوّدات الكامل. */
  providers: z.array(z.unknown()).default([]),
  activeProviderId: z.string().nullable().default(null),
  activeModel: z.string().nullable().default(null),
})

export type AppState = z.infer<typeof appStateSchema>

export interface AppDirs {
  userData: string
  logs: string
}

export interface AppContext {
  state: JsonStore<AppState>
  root: ScopedLogger
  logger: Logger
  dirs: AppDirs
}

const DEFAULTS: AppState = appStateSchema.parse({})

export async function createContext(): Promise<AppContext> {
  const userData = app.getPath('userData')
  const logs = path.join(userData, 'logs')

  const logger = new Logger({ dir: logs, minLevel: DEFAULTS.logLevel })
  const root = logger.child('studio')

  const state = new JsonStore<AppState>({
    file: path.join(userData, 'state.json'),
    schema: appStateSchema,
    defaults: DEFAULTS,
    onError: (scope, error) => root.error(`تعذّر ${scope === 'load' ? 'قراءة' : 'كتابة'} state.json`, error),
  })

  await state.load()
  // كتابة أولية تضمن وجود الملف بعد أول تشغيل (تشخيص ونسخ احتياطي أسهل).
  await state.flush()
  root.info('تم تشغيل NT Studio', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    projectsRoot: state.get().projectsRoot,
    nodeEnv: process.env.NODE_ENV ?? 'production',
  })

  return { state, root, logger, dirs: { userData, logs } }
}