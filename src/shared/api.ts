/**
 * عقد الجسر بين عملية Electron الرئيسية وواجهة React.
 *
 * القاعدة الأمنية: الواجهة لا تعرف أي قناة IPC، ولا تبني مسارًا مطلقًا،
 * ولا تمرر أمرًا جاهزًا. كل عملية تُعرَّف هنا كـ"فعل" محدد وقابل للتحقق في
 * العملية الرئيسية. أي إضافة هنا تتطلب معالَجًا (handler) في src/main/ipc.
 */

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

export interface StudioBridge {
  app: {
    info(): Promise<AppInfo>
  }
}