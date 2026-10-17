import { existsSync } from 'fs'
import { isAbsolute } from 'path'
import { send } from '../bus'
import { preview } from '../preview'
import { clip, resolvePath } from '../util'
import { readDeniedReason } from './guard'
import { Tool, fail, ok, schema } from './types'

function need(): string | null {
  if (!preview.isOpen()) return 'المعاينة غير مفتوحة. افتح صفحة عبر web_open أولاً.'
  send('ui:focus', 'preview')
  return null
}

/** عدد أخطاء Console الحالية — للمقارنة بعد الرفع */
const errCount = () => preview.getLogs().console.filter((c) => c.level === 'error').length

export const uploadTools: Tool[] = [
  {
    name: 'browser_upload',
    // تسلسلي عمداً: رفعان متزامنان يتسابقان على debugger واحد
    phase: 'acting',
    description:
      'Upload local file(s) into a file input on the open preview page (e.g. attach post images when publishing). Works even when the input is visually hidden. Select the input by ref (from browser_snapshot), CSS selector, or visible text.',
    schema: schema(
      {
        ref: { type: 'number', description: 'رقم العنصر من browser_snapshot' },
        selector: { type: 'string', description: 'CSS selector لحقل input[type=file]' },
        text: { type: 'string', description: 'نص ظاهر قرب حقل الرفع' },
        paths: { type: 'string', description: 'مسار ملف واحد (مطلق أو نسبي لمجلد العمل)' }
      },
      ['paths']
    ),
    async run(i, ctx) {
      // 1) المسار أولاً (قبل لمس المتصفح — فشل سريع على مدخلات سيئة):
      //    حلّ نسبي→مطلق، ثم وجود، ثم فحص الأسرار (P0-3: لا رفع لمفاتيح/‎.env)
      const raw = String(i.paths ?? '').trim()
      if (!raw) return fail('حدّد مسار الملف في paths.')
      const abs = isAbsolute(raw) ? raw : resolvePath(ctx.cwd(), raw)
      if (!existsSync(abs)) return fail(`الملف غير موجود: ${abs}`)
      const denied = readDeniedReason(abs, ctx.cwd(), ctx.settings())
      if (denied) return fail(`الرفع مرفوض — ملف حساس لا يُرسل لمواقع خارجية:\n${denied}`)

      // 2) وجود المحدد شكلاً (قبل فتح المتصفح — فشل سريع)
      if (i.ref == null && !i.selector && !i.text) return fail('حدّد حقل الرفع عبر ref أو selector أو text.')

      const n = need()
      if (n) return fail(n)
      const wc = preview.wc
      if (!wc) return fail('المعاينة غير مفتوحة. افتح صفحة عبر web_open أولاً ثم أعد المحاولة.')

      // 2) المحدد: نفس لغة browser_click (ref → data-nt-ref)؛ فرع text يعلّم الحقل بسمة
      let selector: string
      if (i.ref != null) selector = `[data-nt-ref="${Number(i.ref)}"]`
      else if (i.selector) selector = String(i.selector)
      else selector = '' // يُحسم في فرع text أدناه

      // text: ابحث عن أقرب input[type=file] لنص ظاهر، وعلّمه بسمة مؤقتة (أنظف من nth-of-type)
      if (i.text && !i.selector && i.ref == null) {
        const markJs = `(()=>{
          const t=${JSON.stringify(String(i.text))}.trim().toLowerCase();
          const inputs=[...document.querySelectorAll('input[type=file]')];
          if(!inputs.length)return false;
          if(inputs.length===1){inputs[0].setAttribute('data-nt-up','1');return true}
          const vis=e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'};
          const labels=[...document.querySelectorAll('label,span,div,p,button')].filter(vis);
          let bi=0,bs=-1;
          inputs.forEach((inp,idx)=>{const r=inp.getBoundingClientRect();let s=0;for(const o of labels){const ot=String(o.innerText||'').trim().toLowerCase();if(!ot||!ot.includes(t))continue;const q=o.getBoundingClientRect();s=Math.max(s,10000-Math.hypot(q.left-r.left,q.top-r.top))}if(s>bs){bs=s;bi=idx}});
          if(bs<0)return false;
          inputs[bi].setAttribute('data-nt-up','1');return true
        })()`
        try {
          const marked = await preview.exec<boolean>(markJs)
          if (!marked) return fail('لم يُعثر على حقل رفع قرب هذا النص. خذ browser_snapshot جديدة وحدّد ref.')
          selector = 'input[type=file][data-nt-up="1"]'
        } catch (e) {
          return fail('تعذّر تحديد حقل الرفع: ' + (e as Error).message)
        }
      }

      // 3) CDP عند الطلب فقط: attach → تحديد العقدة → حقن الملفات → detach (try/finally)
      const before = errCount()
      const dbg = wc.debugger
      try {
        try {
          dbg.attach('1.3')
        } catch (e) {
          return fail(`تعذّر ربط مصحح المتصفح — غالباً DevTools مفتوحة أو رفع آخر جارٍ: أغلق DevTools، وانتظر انتهاء أي رفع، ثم أعد المحاولة مرة واحدة. (${(e as Error).message})`)
        }
        try {
          const doc = (await dbg.sendCommand('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } }
          let nodeId: number
          try {
            const q = (await dbg.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector })) as { nodeId: number }
            nodeId = q.nodeId
          } catch {
            return fail(`لم يُعثر على حقل الرفع (${selector}). خذ browser_snapshot جديدة وتحقق من ref.`)
          }
          if (!nodeId) return fail(`لم يُعثر على حقل الرفع (${selector}). خذ browser_snapshot جديدة وتحقق من ref.`)
          // تحقق النوع: الرقم القديم قد يشير لعنصر ليس حقل ملفات — ارفض قبل حقن غامض
          try {
            const desc = (await dbg.sendCommand('DOM.describeNode', { nodeId })) as {
              node: { nodeName: string; attributes?: string[] }
            }
            const attrs = desc.node.attributes ?? []
            const typeIdx = attrs.findIndex((a, k) => k % 2 === 0 && a.toLowerCase() === 'type')
            const typeVal = typeIdx >= 0 ? (attrs[typeIdx + 1] ?? '').toLowerCase() : ''
            if (desc.node.nodeName !== 'INPUT' || typeVal !== 'file')
              return fail(`العنصر المحدد (${selector}) ليس حقل ملفات — بل <${desc.node.nodeName}>. خذ browser_snapshot جديدة وحدّد ref حقل الرفع الصحيح.`)
          } catch {
            return fail(`تعذّر فحص حقل الرفع (${selector}). خذ browser_snapshot جديدة وحدّد ref، أو استخدم selector لحقل input[type=file].`)
          }
          await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [abs] })
        } finally {
          try {
            dbg.detach()
          } catch {
            /* تجاهل */
          }
        }
      } catch (e) {
        return fail(`فشل الرفع (${(e as Error).message}). تحقق أن الهدف input[type=file] فعلاً عبر browser_snapshot جديدة، وأن الملف موجود وغير مفتوح حصرياً، ثم أعد المحاولة.`)
      }

      await preview.settle(ctx.signal, 2500) // الرفع: انتظار توليد المعاينة/رد فعل الصفحة — لا شبكة كاملة
      const fresh = preview
        .getLogs()
        .console.filter((c) => c.level === 'error')
        .slice(before)
      return ok(
        `رُفع الملف في حقل الرفع (${selector})${fresh.length ? `\n⚠ أخطاء Console جديدة:\n${fresh.slice(0, 5).map((c) => '  ' + clip(c.text, 300)).join('\n')}` : '\n✓ بلا أخطاء Console جديدة'}`
      )
    }
  }
]
