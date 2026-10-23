import { resolve } from 'path'
import { pollToken, publishSite, requestDeviceCode, saveToken, savedToken } from '../publish/github'
import { listSiteFiles } from '../publish/pages'
import { Tool, fail, ok, schema } from './types'

export const publishTools: Tool[] = [
  {
    name: 'publish_site',
    description:
      'Publish a static site folder (index.html at its root) to the signed-in user GitHub account via GitHub Pages and return its public https URL. The returned URL is permanent and keeps working with no local server and no running process on this machine, and it belongs to the account that signed in. Creates a public repository when needed. The URL goes live after GitHub finishes building, usually within a few minutes. The first use shows the user a GitHub sign-in code in the chat; the token is then stored encrypted on this machine and reused for later publishes. Publication is a separate surface from preview_open: the preview shows the files only inside this machine while a local server runs, while this tool makes them publicly reachable under the repository name supplied in repo.',
    schema: schema(
      {
        dir: { type: 'string', description: 'Site folder, relative to the project or absolute' },
        repo: { type: 'string', description: 'Public repository name on the user account, letters digits . _ - only, e.g. my-site' }
      },
      ['dir', 'repo']
    ),
    async run(i, ctx) {
      try {
        const files = listSiteFiles(resolve(ctx.project()?.dir ?? ctx.cwd(), String(i.dir)))
        let token = savedToken()
        if (!token) {
          const dev = await requestDeviceCode()
          await ctx.ask(`افتح ${dev.verification_uri} وأدخل الرمز ${dev.user_code} ثم اكتب "تم".`)
          token = await pollToken(dev, ctx.signal)
          saveToken(token)
        }
        const url = await publishSite(token, files, String(i.repo))
        return ok(`تم النشر: ${url}\nالرابط دائم ويعمل بلا سيرفر محلي.\nقد يحتاج الموقع بضع دقائق ليظهر بعد بناء GitHub Pages.`)
      } catch (e) {
        return fail(`تعذر النشر: ${(e as Error).message}`)
      }
    }
  }
]
