# التثبيت والتشغيل

## 1) المتطلبات

| الأداة | الإصدار المطلوب | ملاحظة |
| --- | --- | --- |
| Node.js | `>= 20.19.0` (أو 22.12+) | شرط `electron-vite` و`vite` |
| npm | 10+ | يأتي مع Node |
| git | أي إصدار حديث | يُستخدم داخل المشاريع المولّدة |

## 2) تثبيت الاعتماديات

```bash
npm install
```

### ⚠️ ملاحظة مهمة: مرآة تنزيل Electron

تنزيل ثنائي Electron يتم من خوادم GitHub افتراضيًا، وقد **يفشل بصمت** على بعض الشبكات
(الأعراض: `node_modules/electron/dist` غير موجود، و`npm install` ينتهي بنجاح رغم ذلك).

الحل المُتحقَّق منه في هذا الجهاز:

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules\electron\install.js
```

بعدها تأكد من:

```powershell
Test-Path node_modules\electron\dist\electron.exe   # يجب أن يعيد True
```

## 3) أوامر التطوير

```bash
npm run dev         # بيئة التطوير: Vite HMR + Electron
npm run preview     # تشغيل نسخة الإنتاج المبنية محليًا
npm run build       # فحص الأنواع ثم بناء main + preload + renderer
npm run typecheck   # فحص الأنواع فقط (مشروعا TS مستقلان)
npm test            # اختبارات الوحدة (vitest)
npm run dist        # مثبّت ويندوز (.exe) داخل مجلد release/
```

## 4) بنية المشروع

```
src/
  main/          عملية Electron الرئيسية — منطق الوكيل، القرص، العمليات
    ipc/         معالجات IPC (كل معالج: تحقق من المُرسِل + مخطط zod)
  preload/       جسر contextBridge — الأفعال المكشوفة للواجهة فقط
  renderer/      تطبيق React — لا وصول له إلى Node إطلاقًا
    src/styles/  نظام الثيم (Tailwind 4، مصدر واحد للألوان)
  shared/        الأنواع والعقود المشتركة بين الطبقتين
```

## 5) قرارات لا تُكسر دون سبب

| القرار | السبب |
| --- | --- |
| **لا `"type": "module"`** | يبقي `preload` بصيغة CommonJS، وهو شرط تشغيله داخل renderer مُعزل (`sandbox: true`) |
| **لا اعتماديات native** | `better-sqlite3` و`Playwright` تحتاجان خطوة بناء منفصلة-prone للفشل؛ استُبدلت بـ `WebContentsView` المدمج وتخزين JSON ذرّي |
| **مسار التطبيق ASCII** | `electron-builder`/`NSIS` لديهما مشاكل موثّقة مع المسارات غير اللاتينية |
| **`electron-builder.yml` بلا fuses** | تُضاف في S8 عبر `@electron/fuses` بعد التحقق من دعم `electron-builder` للحقل |