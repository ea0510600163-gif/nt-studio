import { shell } from 'electron'
import { desktopController, type ComputerStepInput } from '../desktop/controller'
import { sleep } from '../util'
import { Tool, fail, ok, schema } from './types'

export const computerTools: Tool[] = [
  {
    name: 'computer',
    phase: 'acting',
    description:
      'Operate the real Windows desktop: the attached screenshot is the actual screen at native 1:1 pixel resolution with a visible cursor crosshair at (cursorX, cursorY) and 100px ruler ticks along the top/left edges. ' +
      'Actions: screenshot, inspect_ui (list interactive UI Automation elements of the active window with exact coordinates), left/double/triple/right/middle click, mouse_move, left_click_drag, left_mouse_down/up, type (Unicode text with optional clear and submit), key/hold_key, scroll, wait, cursor_position, zoom (enlarged region crop listing its interactive elements), batch (sequential steps in one call), clipboard_read, clipboard_write. ' +
      'target:"visible element label" resolves the element through Windows UI Automation; coordinate:[x,y] refers to the screenshot pixel space.',
    schema: schema(
      {
        action: {
          type: 'string',
          enum: [
            'screenshot',
            'inspect_ui',
            'left_click',
            'double_click',
            'triple_click',
            'right_click',
            'middle_click',
            'mouse_move',
            'left_click_drag',
            'left_mouse_down',
            'left_mouse_up',
            'type',
            'key',
            'hold_key',
            'scroll',
            'wait',
            'cursor_position',
            'zoom',
            'batch',
            'clipboard_read',
            'clipboard_write'
          ],
          description: 'Desktop action to perform'
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] target coordinates in 1:1 screenshot space'
        },
        target: {
          type: 'string',
          description: 'Optional UI element label/name to target directly via Windows UI Automation with 100% precision. Can be used alone or alongside coordinate:[x,y] as fallback.'
        },
        window: {
          type: 'string',
          description: 'Optional title/name of the window that must be active before this action (e.g. "chrome", "الرسام").'
        },
        start_coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[start_x, start_y] starting coordinates for left_click_drag in screenshot space'
        },
        x: {
          type: 'number',
          description: 'X coordinate in screenshot space — alternative to coordinate[0]'
        },
        y: {
          type: 'number',
          description: 'Y coordinate in screenshot space — alternative to coordinate[1]'
        },
        region: {
          type: 'array',
          items: { type: 'number' },
          description: 'For action="zoom": [x1, y1, x2, y2] region in screenshot space'
        },
        start_x: {
          type: 'number',
          description: 'Start X coordinate for drag in screenshot space'
        },
        start_y: {
          type: 'number',
          description: 'Start Y coordinate for drag in screenshot space'
        },
        text: {
          type: 'string',
          description: 'Text to type (used by action="type", "clipboard_write", and as an instant follow-up after "left_click", "triple_click" or "key" within the same call)'
        },
        key: {
          type: 'string',
          description: 'Key or shortcut to press for action="key" or "hold_key" (e.g. "Return", "Escape", "Tab", "BackSpace", "ctrl+l", "ctrl+s", "ctrl+a", "ctrl+c", "ctrl+v", "alt+tab", "win")'
        },
        clear: {
          type: 'boolean',
          description: 'Select all and clear existing field text (Ctrl+A then Backspace) before typing'
        },
        submit: {
          type: 'boolean',
          description: 'Press Enter automatically after typing or key combo'
        },
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction for action="scroll"'
        },
        amount: {
          type: 'number',
          description: 'Scroll amount (wheel notches, default 3, max 60) for action="scroll"'
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds for action="wait" (up to 60) or "hold_key"'
        },
        steps: {
          type: 'array',
          items: { type: 'object' },
          description: 'Optional sequence of desktop steps to execute in a single turn (for action="batch")'
        },
        thought: {
          type: 'string',
          description: 'Short status line shown to the user in the HUD while this action runs'
        }
      },
      ['action']
    ),
    async run(i, ctx) {
      await desktopController.waitWhilePaused(ctx.signal)

      try {
        const res = await desktopController.executeComputerAction(
          {
            action: String(i.action),
            coordinate: Array.isArray(i.coordinate) ? [Number(i.coordinate[0]), Number(i.coordinate[1])] : undefined,
            start_coordinate: Array.isArray(i.start_coordinate)
              ? [Number(i.start_coordinate[0]), Number(i.start_coordinate[1])]
              : undefined,
            x: i.x != null ? Number(i.x) : undefined,
            y: i.y != null ? Number(i.y) : undefined,
            start_x: i.start_x != null ? Number(i.start_x) : undefined,
            start_y: i.start_y != null ? Number(i.start_y) : undefined,
            target: i.target != null ? String(i.target) : undefined,
            window: i.window != null ? String(i.window) : undefined,
            region: Array.isArray(i.region) ? i.region.map((n: unknown) => Number(n)) : undefined,
            text: i.text != null ? String(i.text) : undefined,
            key: i.key != null ? String(i.key) : undefined,
            clear: !!i.clear,
            submit: !!i.submit,
            from_zoom: !!i.from_zoom,
            direction: i.direction,
            amount: i.amount != null ? Number(i.amount) : undefined,
            duration: i.duration != null ? Number(i.duration) : undefined,
            steps: Array.isArray(i.steps) ? (i.steps as ComputerStepInput[]) : undefined,
            thought: i.thought != null ? String(i.thought) : undefined
          },
          ctx.signal
        )

        const takeoverNote = desktopController.consumeTakeoverReturned()
          ? '\n⚠ ملاحظة هامة: استلم المستخدم التحكم بالماوس والكيبورد مؤقتاً وأجرى تغييرات على سطح المكتب. افحص اللقطة الجديدة المرفقة بعناية وأعد تقييم الشاشة قبل الخطوة التالية.'
          : ''

        if (res.shot.unchanged) {
          return ok(
            res.summary +
              takeoverNote +
              '\n(الشاشة لم تتغيّر عن اللقطة السابقة — لم تُرفق صورة جديدة، اعتمد على الصورة السابقة.)'
          )
        }

        return ok(res.summary + takeoverNote, [{ mediaType: res.shot.mediaType, data: res.shot.data }])
      } catch (e) {
        return fail(`تعذّر تنفيذ أمر سطح المكتب (${(e as Error).message}). خذ screenshot جديدة للتحقق من حالة الشاشة.`)
      }
    }
  },
  {
    name: 'desktop_app',
    phase: 'acting',
    description:
      'Launch any Windows application (design apps, browsers, editors, Paint, Notepad, Calculator, Explorer, etc.), open URLs in the default browser, list open desktop windows, focus/maximize a specific window, or minimize/restore the NT Studio window.',
    schema: schema(
      {
        action: {
          type: 'string',
          enum: ['open_app', 'open_url', 'focus_window', 'list_windows', 'minimize_studio', 'restore_studio'],
          description: 'Application or window management action'
        },
        app: {
          type: 'string',
          description: 'For open_app: Application name or executable path (e.g. "mspaint", "الرسام", "photoshop", "figma", "notepad", "chrome", "calc", "explorer")'
        },
        url: {
          type: 'string',
          description: 'For open_url: full http(s) link to open directly in the default browser'
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional command-line arguments for open_app'
        },
        window_title: {
          type: 'string',
          description: 'For focus_window: Partial window title or process name to bring to front'
        },
        maximize: {
          type: 'boolean',
          description: 'Maximize the target window when focusing it'
        },
        minimize_studio: {
          type: 'boolean',
          description: 'Minimize NT Studio into the floating desktop mini-HUD so the desktop is unobstructed (default: true)'
        },
        thought: {
          type: 'string',
          description: 'Short status line shown to the user in the HUD while this action runs'
        }
      },
      ['action']
    ),
    async run(i, ctx) {
      await desktopController.waitWhilePaused(ctx.signal)
      if (i.thought) desktopController.setThought(String(i.thought))
      desktopController.setStatus('acting')

      const act = String(i.action)
      const minStudio = i.minimize_studio !== false

      try {
        if (act === 'list_windows') {
          const wins = await desktopController.listWindows()
          const formatted = wins.length
            ? wins
                .map(
                  (w, idx) =>
                    `${idx + 1}. «${w.title}» (${w.process}, pid=${w.pid}) @ ${w.x},${w.y} ${w.width}×${w.height}${w.minimized ? ' [مصغّرة]' : ''}${w.maximized ? ' [مكبّرة]' : ''}`
                )
                .join('\n')
            : '(لا توجد نوافذ مفتوحة مرئية حالياً)'
          const shot = await desktopController.screenshot(true)
          return ok(`النوافذ المفتوحة على سطح المكتب (${wins.length}):\n${formatted}`, [
            { mediaType: shot.mediaType, data: shot.data }
          ])
        }

        if (act === 'minimize_studio') {
          desktopController.minimizeStudio()
          const shot = await desktopController.screenshot(true)
          return ok('صُغّرت نافذة NT Studio وظهرت لوحة الحالة العائمة أعلى الشاشة. سطح المكتب أمامك الآن بالكامل.', [
            { mediaType: shot.mediaType, data: shot.data }
          ])
        }

        if (act === 'restore_studio') {
          desktopController.restoreStudio()
          return ok('أُعيد إظهار نافذة NT Studio.')
        }

        if (act === 'focus_window') {
          const q = String(i.window_title ?? i.app ?? '').trim()
          if (!q) return fail('حدّد window_title للتركيز على النافذة.')
          const res = await desktopController.focusWindow(q, !!i.maximize, minStudio)
          const shot = await desktopController.screenshot(true)
          if (!res.found) {
            return ok(
              `لم يُعثر على نافذة تطابق «${q}». استخدم list_windows لرؤية النوافذ المفتوحة أو open_app لتشغيل البرنامج.`,
              [{ mediaType: shot.mediaType, data: shot.data }]
            )
          }
          if (!res.ok) {
            return fail(
              `عُثر على نافذة «${q}» لكنها لم تصبح النافذة النشطة (ويندوز رفض نقل التركيز).\n` +
                `النافذة النشطة الآن فعلاً: «${res.activeTitle || 'سطح المكتب'}»${res.activeProc ? ` (${res.activeProc})` : ''}.\n` +
                'جرّب: انقر داخل النافذة مباشرة عبر computer left_click، أو أعد focus_window.'
            )
          }
          return ok(
            `تم التركيز على «${res.activeTitle || q}»${i.maximize ? ' وتكبيرها' : ''} — تحقق فعلي: النافذة النشطة الآن «${res.activeTitle}»${res.activeProc ? ` (${res.activeProc})` : ''}.`,
            [{ mediaType: shot.mediaType, data: shot.data }]
          )
        }

        if (act === 'open_url') {
          const url = String(i.url ?? '').trim()
          if (!url) return fail('حدّد url: الرابط المطلوب فتحه.')
          if (!/^https?:\/\//i.test(url)) return fail('الرابط يجب أن يبدأ بـ http:// أو https://')
          try {
            await shell.openExternal(url)
          } catch (e) {
            return fail(`تعذّر فتح الرابط: ${(e as Error).message}`)
          }
          await sleep(900)
          const shot = await desktopController.screenshot(true)
          return ok(`فُتح الرابط مباشرة في المتصفح: ${url} | النافذة النشطة: «${shot.activeTitle || 'سطح المكتب'}»`, [
            { mediaType: shot.mediaType, data: shot.data }
          ])
        }

        if (act === 'open_app') {
          const appName = String(i.app ?? '').trim()
          if (!appName) return fail('حدّد اسم البرنامج أو مساره في حقل app.')
          const res = await desktopController.launchApplication(
            appName,
            Array.isArray(i.args) ? i.args.map(String) : [],
            minStudio
          )
          if (!res.ok) return fail(res.message)
          const focus = await desktopController.ensureWindowFocus(desktopController.appQueryHint(appName), !!i.maximize, 3, 450)
          const shot = await desktopController.screenshot(true)
          const active = `النافذة النشطة الآن: «${shot.activeTitle || 'سطح المكتب'}»${focus.activeProc ? ` (${focus.activeProc})` : ''}`
          if (!focus.found) {
            return ok(
              `${res.message} | ${active}\nملاحظة: لم تظهر بعد نافذة تطابق «${appName}» — إن كان البرنامج يتأخر بالفتح أعد الفحص بـ screenshot بعد wait قصير.`,
              [{ mediaType: shot.mediaType, data: shot.data }]
            )
          }
          if (!focus.ok) {
            return ok(
              `${res.message} | ${active}\nملاحظة: وُجدت نافذة «${appName}» لكن التركيز رفضه ويندوز — انقر داخلها عبر computer left_click أو أعد focus_window.`,
              [{ mediaType: shot.mediaType, data: shot.data }]
            )
          }
          return ok(`${res.message} | تم التركيز الموثّق على «${focus.activeTitle}»${i.maximize ? ' (مكبَّرة)' : ''}`, [
            { mediaType: shot.mediaType, data: shot.data }
          ])
        }

        return fail(`إجراء غير معروف: ${act}`)
      } catch (e) {
        return fail(`تعذّر تنفيذ إجراء التطبيق (${(e as Error).message}).`)
      }
    }
  },
  {
    name: 'progress',
    parallel: true,
    description:
      'Update the task checklist shown in the floating HUD: the plan step titles and which indexes are completed.',
    schema: schema(
      {
        plan: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short plan step titles'
        },
        done: {
          type: 'array',
          items: { type: 'number' },
          description: '0-based indexes of completed steps'
        }
      },
      ['plan', 'done']
    ),
    async run(i, ctx) {
      const rawPlan: string[] = Array.isArray(i.plan) ? i.plan.map((s: unknown) => String(s).trim()).filter(Boolean) : []
      const rawDone: number[] = Array.isArray(i.done)
        ? i.done.map((n: unknown) => Number(n)).filter((n: number) => !isNaN(n))
        : []
      if (!rawPlan.length) return fail('أرسل مصفوفة plan تحتوي خطوات العمل.')

      desktopController.updatePlan(rawPlan, rawDone)

      const doneSet = new Set(rawDone)
      let doingAssigned = false
      const todoItems = rawPlan.map((text: string, idx: number) => {
        const isDone = doneSet.has(idx)
        const status = isDone
          ? ('done' as const)
          : !doingAssigned
            ? ((doingAssigned = true), ('doing' as const))
            : ('pending' as const)
        return { id: String(idx + 1), text, status }
      })
      ctx.setPlan(todoItems)

      return ok(`حُدّثت خطة العمل (${rawDone.length}/${rawPlan.length} مكتمل).`)
    }
  }
]
