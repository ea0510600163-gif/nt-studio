import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * بنية المشروع تتبع اصطلاح electron-vite الرسمي:
 *   src/main      -> عملية Electron الرئيسية   (منطق الوكيل + Node + القرص)
 *   src/preload   -> جسر contextBridge          (الواجهة الوحيدة المكشوفة للواجهة الأمامية)
 *   src/renderer  -> تطبيق React                (بلا أي وصول لـ Node)
 *
 * لا يوجد "type": "module" عمداً، حتى تُبنى main/preload بصيغة CommonJS
 * ويبقى preload قابلاً للتشغيل داخل renderer مُعزل (sandbox: true).
 */
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      sourcemap: true,
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      sourcemap: true,
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      sourcemap: true,
      // CSP صارمة: لا inline scripts، ولا eval، ولا مصادر خارجية غير معروفة
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
          },
        },
      },
    },
  },
})