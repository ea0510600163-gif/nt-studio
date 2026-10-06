import type {
  Protocol,
  ProviderInput,
  ProviderPublic,
  TestResult,
} from './providers'

/**
 * عقد الجسر بين عملية Electron الرئيسية وواجهة React.
 *
 * القاعدة الأمنية: الواجهة لا تعرف أي قناة IPC، ولا تبني مسارًا مطلقًا،
 * ولا تمرر أمرًا جاهزًا. كل عملية تُعرَّف هنا كـ"فعل" محدد وقابل للتحقق في
 * العملية الرئيسية. أي إضافة هنا تتطلب معالجًا (handler) في src/main/ipc.
 */

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

export interface FetchModelsResult {
  ok: boolean
  models: string[]
  error?: string
}

export interface ProbeInput {
  name: string
  protocol: Protocol
  baseUrl: string
  apiKey: string
  models: string[]
}

export interface StudioBridge {
  app: {
    info(): Promise<AppInfo>
  }
  providers: {
    list(): Promise<ProviderPublic[]>
    add(input: ProviderInput): Promise<ProviderPublic>
    update(input: ProviderInput & { id: string }): Promise<ProviderPublic>
    remove(id: string): Promise<boolean>
    /** فحص الاتصال قبل الحفظ — لا يحتاج مزوّدًا محفوظًا. */
    probe(input: ProbeInput): Promise<TestResult>
    /** إعادة فحص مزوّد محفوظ (يُفكّ تعمية المفتاح في العملية الرئيسية). */
    testSaved(id: string): Promise<TestResult>
    fetchModels(input: {
      baseUrl: string
      protocol: Protocol
      apiKey: string
    }): Promise<FetchModelsResult>
    setActive(id: string, model: string): Promise<boolean>
  }
}