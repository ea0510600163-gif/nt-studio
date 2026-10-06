import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../src/shared/api'
import {
  MAX_ARG_VALUE,
  MAX_LINES,
  MAX_NOTICES,
  MAX_NOTICE_LEN,
  MAX_OPEN_STARTS,
  MAX_SUMMARY_LEN,
  MAX_TOOLS,
  NO_MODEL,
  applyAgentEvent,
  compactArgs,
  describeArgs,
  extractLoopbackUrl,
  filterNotices,
  formatUsage,
  initialRunState,
  noticeCounts,
  runReducer,
  shouldAutoScroll,
  stripAnsi,
  toolKey,
  transcriptSignature,
  visibleTools,
  type NoticeLevel,
  type RunAction,
  type RunState,
} from '../src/renderer/src/stores/reducer'

/**
 * اختبارات منطق انتقالات حالة مساحة العمل — `src/renderer/src/stores/reducer.ts`.
 *
 * لماذا هذا الملف هو الأهم في جولة W1: `reducer.ts` كان ٣٢ كيلوبايتًا من منطق
 * نقيّ جديد بلا سطر اختبار واحد. كل حالة هنا تمثّل عيبًا حقيقيًا كان في
 * `ChatPanel.tsx` قبل إعادة الكتابة:
 *   - `running: true` في `finally` ⇒ أي فشل يجمّد الواجهة إلى الأبد.
 *   - `done:needs-input` غير idempotent ⇒ السؤال الحقيقي يُستبدل بنص بديل.
 *   - `phaseDetail` لا يُمسح أبدًا ⇒ يبقى رابط قديم في الترويسة.
 *   - معرّف الأداة من طول المصفوفة ⇒ تصادم بعد ١٢٠ أداة.
 *   - السحب القسري للتمرير ⇒ المستخدم لا يستطيع قراءة ما فوقه.
 *
 * كل الدوال نقية، والوقت يُمرَّر (`now`) فلا نعتمد على `Date.now()` ولا على ساعة
 * النظام — النتيجة نفسها في أي جهاز وفي أي وقت.
 */

const T0 = 1_700_000_000_000

/** حدث من العملية الرئيسية بنوعه الكامل — لا cast إلا عند اختبار نوع مجهول. */
function ev(event: AgentEvent): AgentEvent {
  return event
}

/** حالة جارية نظيفة: بعد `run/started` مباشرة (running=true, settled=false). */
function running(now = T0): RunState {
  return runReducer(initialRunState(), { type: 'run/started' }, now)
}

/** يطبّق سلسلة أحداث على حالة جارية. */
function feed(s: RunState, events: AgentEvent[], now = T0): RunState {
  let out = s
  for (const e of events) out = applyAgentEvent(out, e, now)
  return out
}

/* ------------------------------------------------- ١)	done ينهي ويُنظّف */

describe('حدث done — الطرفية وتنفية phaseDetail', () => {
  it('done يضع الحالة الطرفية ويمسح تفصيل المرحلة', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'status', phase: 'starting', detail: 'npm run dev --port 5173' }), T0)
    expect(s.phase).toBe('starting')
    expect(s.phaseDetail).toBe('npm run dev --port 5173')

    s = applyAgentEvent(s, ev({ type: 'done', reason: 'stop', summary: 'أنجزتُ الموقع.' }), T0)
    expect(s.running).toBe(false)
    expect(s.dispatching).toBe(false)
    expect(s.stopping).toBe(false)
    expect(s.settled).toBe(true)
    expect(s.phase).toBe('done')
    // العيب الأساسي: الرابط/الأمر القديم يبقى معلّقًا في الترويسة بعد الانتهاء.
    expect(s.phaseDetail).toBe('')
    expect(s.streamingText).toBe('')
    expect(s.awaitingQuestion).toBeNull()
  })

  it('خلاصة done تصير سطرًا في المحادثة', () => {
    const s = feed(running(), [{ type: 'done', reason: 'stop', summary: 'جاهز للتسليم.' }])
    const last = s.lines[s.lines.length - 1]
    expect(last?.role).toBe('agent')
    expect(last?.text).toBe('جاهز للتسليم.')
  })

  it('reason=error ينشر الخطأ في اللوحة لا في السجل المطوي وحده', () => {
    const s = feed(running(), [{ type: 'done', reason: 'error', error: 'نفدت حصة المزوّد' } as unknown as AgentEvent])
    expect(s.running).toBe(false)
    expect(s.phase).toBe('error')
    expect(s.lastError).toBe('نفدت حصة المزوّد')
    expect(s.notices.some((n) => n.level === 'error' && n.message.includes('نفدت'))).toBe(true)
  })

  it('reason=max-steps ينبّه بلا أن يعلن خطأً', () => {
    const s = feed(running(), [{ type: 'done', reason: 'max-steps' }])
    expect(s.phase).toBe('done')
    expect(s.lastError).toBeNull()
    expect(s.notices.some((n) => n.level === 'warn')).toBe(true)
  })

  it('reason=aborted يعود إلى idle بهدوء', () => {
    const s = feed(running(), [{ type: 'done', reason: 'aborted' }])
    expect(s.phase).toBe('idle')
    expect(s.running).toBe(false)
    expect(s.lastError).toBeNull()
  })

  it('terminal idempotent: تكرار done لا يُفسد الحالة ولا يكرّر السطر', () => {
    const once = feed(running(), [{ type: 'done', reason: 'stop', summary: 'تم.' }])
    const twice = applyAgentEvent(once, ev({ type: 'done', reason: 'stop', summary: 'تم.' }), T0 + 10)
    expect(twice).toBe(once)
    expect(twice.lines).toHaveLength(once.lines.length)
  })

  it('needs-input الحقيقي لا يُستبدل بحدث needs-input مكرّر بلا سؤال', () => {
    // control.ts وloop.ts يبثّان needs-input معًا: الثاني بلا `question`.
    let s = feed(running(), [{ type: 'done', reason: 'needs-input', question: 'أي إطار تختار؟', options: ['React', 'Vue'] } as unknown as AgentEvent])
    expect(s.awaitingQuestion?.text).toBe('أي إطار تختار؟')
    expect(s.awaitingQuestion?.synthetic).toBe(false)
    expect(s.awaitingQuestion?.options).toEqual(['React', 'Vue'])
    expect(s.running).toBe(false)

    const again = applyAgentEvent(s, ev({ type: 'done', reason: 'needs-input' }), T0 + 5)
    expect(again).toBe(s)
    expect(again.awaitingQuestion?.text).toBe('أي إطار تختار؟')
    expect(again.awaitingQuestion?.synthetic).toBe(false)
  })

  it('needs-input بلا نص يُصنع له سؤال بديل مُعلَّم synthetic', () => {
    const s = feed(running(), [{ type: 'done', reason: 'needs-input' }])
    expect(s.awaitingQuestion?.synthetic).toBe(true)
    expect(s.awaitingQuestion?.text.length).toBeGreaterThan(0)
    expect(s.phase).toBe('idle')
  })

  it('السؤال البديل يُستبدل بسؤال حقيقي يصل بعده', () => {
    const synthetic = feed(running(), [{ type: 'done', reason: 'needs-input' }])
    expect(synthetic.awaitingQuestion?.synthetic).toBe(true)

    const real = applyAgentEvent(
      synthetic,
      ev({ type: 'done', reason: 'needs-input', question: 'ما اسم المشروع؟' } as unknown as AgentEvent),
      T0 + 1,
    )
    expect(real.awaitingQuestion?.text).toBe('ما اسم المشروع؟')
    expect(real.awaitingQuestion?.synthetic).toBe(false)
  })
})

/* ------------------------------------------------- ٢) status لا يفسد running */

describe('حدث status — المرحلة دون المساس بـ running', () => {
  it('status يحدّث phase وphaseDetail ويحفظ running=true', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'status', phase: 'installing' }), T0)
    expect(s.phase).toBe('installing')
    expect(s.running).toBe(true)
    expect(s.settled).toBe(false)

    s = applyAgentEvent(s, ev({ type: 'status', phase: 'inspecting', detail: 'أخطاء الكونسول: 2' }), T0)
    expect(s.phase).toBe('inspecting')
    expect(s.phaseDetail).toBe('أخطاء الكونسول: 2')
    expect(s.running).toBe(true)
  })

  it('كل المراحل التسع تُقبل، وتفصيلها يُمسح حين لا يُرسل', () => {
    const phases = ['idle', 'thinking', 'tool', 'installing', 'starting', 'inspecting', 'fixing', 'done', 'error'] as const
    let s = running()
    for (const phase of phases) {
      s = applyAgentEvent(s, ev({ type: 'status', phase }), T0)
      expect(s.phase).toBe(phase)
    }
  })

  it('phase مجهول يُتجاهل بدل أن يفسد الحالة (لا يُسقط الحدث كله)', () => {
    const s = applyAgentEvent(running(), ev({ type: 'status', phase: 'wat' as never }), T0)
    expect(s.phase).toBe('thinking')
    expect(s.unknownEvents).toBe(0)
  })

  it('status بخطأ أثناء التشغيل يُظهر lastError ويكتب السجل', () => {
    const s = applyAgentEvent(running(), ev({ type: 'status', phase: 'error', detail: 'انتهت المهلة' }), T0)
    expect(s.phase).toBe('error')
    expect(s.lastError).toBe('انتهت المهلة')
    expect(s.notices.some((n) => n.level === 'error')).toBe(true)
    // الخطأ لا يوقف التشغيل وحده: الحالة الطرفية يحسمها حدث طرفي.
    expect(s.running).toBe(true)
  })

  it('detail يحوي رابط المعاينة فينتقل إلى previewUrl', () => {
    const s = applyAgentEvent(running(), ev({ type: 'status', phase: 'starting', detail: 'http://127.0.0.1:5173' }), T0)
    expect(s.previewUrl).toBe('http://127.0.0.1:5173')
  })

  it('أول حدث يغلق نافذة الإرسال المزدوج (dispatching)', () => {
    const started = running()
    expect(started.dispatching).toBe(true)
    const after = applyAgentEvent(started, ev({ type: 'status', phase: 'thinking' }), T0)
    expect(after.dispatching).toBe(false)
    expect(after.running).toBe(true)
  })
})

/* ---------------------------------------- ٣) نوع مجهول: يُسجَّل ولا يُسقَط */

describe('حدث مجهول — يُسجَّل ولا يُسقط', () => {
  /** cast هنا مقصود: نحاكي main أرسل `type` لم تعرفه الواجهة بعد. */
  const alien = { type: 'tool_progress', name: 'write_file', percent: 40 } as unknown as AgentEvent

  it('type غير معروف يزيد عدّادًا ويكتب ملاحظة تحذير', () => {
    const s = applyAgentEvent(running(), alien, T0)
    expect(s.unknownEvents).toBe(1)
    expect(s.running).toBe(true)
    const note = s.notices[s.notices.length - 1]
    expect(note?.level).toBe('warn')
    expect(note?.message).toContain('tool_progress')
    // ونص الحدث نفسه محفوظ — دليل على ما الذي أُسقط لو أُسقط.
    expect(note?.message).toContain('write_file')
  })

  it('عدّاد الأحداث المجهولة يتراكم ولا يُصفَّر', () => {
    let s = running()
    s = applyAgentEvent(s, alien, T0)
    s = applyAgentEvent(s, alien, T0)
    s = applyAgentEvent(s, alien, T0)
    expect(s.unknownEvents).toBe(3)
  })

  it('حدث بلا type يُسجَّل بنص «بلا نوع» لا ينهار', () => {
    const s = applyAgentEvent(running(), {} as AgentEvent, T0)
    expect(s.unknownEvents).toBe(1)
    expect(s.notices[s.notices.length - 1]?.message).toContain('بلا نوع')
  })

  it('حدث غير قابل للتمثيل لا يرمي استثناءً', () => {
    const cyclic: Record<string, unknown> = { type: 'weird' }
    cyclic.self = cyclic
    const s = applyAgentEvent(running(), cyclic as unknown as AgentEvent, T0)
    expect(s.unknownEvents).toBe(1)
    expect(s.notices[s.notices.length - 1]?.message).toContain('غير قابل للقراءة')
  })
})

/* --------------------------------------------- ٤) الأدوات: callId فارغ */

describe('الأدوات — tool_end بـ callId فارغ يقابل tool_start بلا تصادم', () => {
  it('callId فارغ: يُنشئ صفًّا ثم يُسوّيه بنفس الصفّ', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: '', name: 'write_file', args: { path: 'src/App.tsx' } }), T0)
    expect(s.tools).toHaveLength(1)
    const row = s.tools[0]
    expect(row?.status).toBe('running')
    expect(row?.argHint).toContain('src/App.tsx')

    s = applyAgentEvent(s, ev({ type: 'tool_end', callId: '', name: 'write_file', ok: true, summary: 'كُتب الملف', ms: 42 }), T0)
    expect(s.tools).toHaveLength(1)
    expect(s.tools[0]?.status).toBe('done')
    expect(s.tools[0]?.summary).toBe('كُتب الملف')
    expect(s.tools[0]?.ms).toBe(42)
  })

  it('فشل الأداة يسجّل status=error', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: '', name: 'read_file', args: { path: 'nope.ts' } }), T0)
    s = applyAgentEvent(s, ev({ type: 'tool_end', callId: '', name: 'read_file', ok: false, summary: 'غير موجود', ms: 3 }), T0)
    expect(s.tools[0]?.status).toBe('error')
    expect(s.tools[0]?.summary).toBe('غير موجود')
  })

  it('بثّ بلا callId بعد بثّ حقيقي لنفس الأداة يربط الصفّ ولا يصنع صفًّا ثانيًا', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: 'call-1', name: 'write_file', args: { path: 'a.ts' } }), T0)
    // الغلاف يكرّر البثّ بلا callId لنفس العمل.
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: '', name: 'write_file', args: { path: 'a.ts' } }), T0)
    expect(s.tools).toHaveLength(1)

    s = applyAgentEvent(s, ev({ type: 'tool_end', callId: 'call-1', name: 'write_file', ok: true, summary: 'ok', ms: 5 }), T0)
    s = applyAgentEvent(s, ev({ type: 'tool_end', callId: '', name: 'write_file', ok: true, summary: 'ok', ms: 5 }), T0)
    expect(s.tools).toHaveLength(1)
    expect(s.tools[0]?.status).toBe('done')
  })

  it('tool_end بلا start مقابل: لا أثر ولا انهيار', () => {
    const s = applyAgentEvent(running(), ev({ type: 'tool_end', callId: '', name: 'ghost', ok: true, summary: '', ms: 0 }), T0)
    expect(s.tools).toHaveLength(0)
  })

  it('callId مكرّر في tool_start لا يكرّر الصفّ', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: 'c1', name: 'list_files', args: {} }), T0)
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: 'c1', name: 'list_files', args: {} }), T0)
    expect(s.tools).toHaveLength(1)
  })

  it('tool_end ب callId مجهول لا يمسّ صفًّا آخر', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: 'c1', name: 'list_files', args: {} }), T0)
    s = applyAgentEvent(s, ev({ type: 'tool_end', callId: 'nope', name: 'list_files', ok: true, summary: 'x', ms: 1 }), T0)
    expect(s.tools[0]?.status).toBe('running')
  })

  it('معرّفات الصفوف لا تصادم بعد تجاوز MAX_TOOLS (١٢٠)', () => {
    let s = running()
    const total = MAX_TOOLS + 30
    for (let i = 0; i < total; i++) {
      s = applyAgentEvent(s, ev({ type: 'tool_start', callId: `c${i}`, name: 'write_file', args: { path: `f${i}.ts` } }), T0)
      s = applyAgentEvent(s, ev({ type: 'tool_end', callId: `c${i}`, name: 'write_file', ok: true, summary: 'ok', ms: 1 }), T0)
    }

    expect(s.tools).toHaveLength(MAX_TOOLS)
    const ids = new Set(s.tools.map((t) => t.id))
    expect(ids.size).toBe(MAX_TOOLS)
    // العدّاد interno تجاوز الحدّ ⇒ المعرّفات لا تعاد من الصفر.
    expect(Number(s.tools[s.tools.length - 1]?.id.slice(1))).toBeGreaterThan(MAX_TOOLS)
    // والأقدم سقط فعلًا، فالنافذة تحتفظ بالأحدث.
    expect(s.tools.some((t) => t.id === 't0')).toBe(false)
  })

  it('الأدوات بلا callId لا تصادم عبر النافذة كلها', () => {
    let s = running()
    const total = MAX_TOOLS + 30
    for (let i = 0; i < total; i++) {
      s = applyAgentEvent(s, ev({ type: 'tool_start', callId: '', name: 'run_command', args: { command: `echo ${i}` } }), T0)
      s = applyAgentEvent(s, ev({ type: 'tool_end', callId: '', name: 'run_command', ok: true, summary: `ok ${i}`, ms: 1 }), T0)
    }
    expect(s.tools).toHaveLength(MAX_TOOLS)
    expect(new Set(s.tools.map((t) => t.id)).size).toBe(MAX_TOOLS)
    // كل صفّ سُوِّي بالخلاصة الصحيحة — لا خلط بين عملين مختلفين.
    expect(s.tools[s.tools.length - 1]?.summary).toBe(`ok ${total - 1}`)
    expect(s.tools[0]?.summary).toBe(`ok ${total - MAX_TOOLS}`)
  })

  it('سجلّ الـ openStarts يبقى محدودًا بـ MAX_OPEN_STARTS', () => {
    // عدد يفرض كلا الحدّين معًا: نوافذ الأدوات أضيق من سجلّ المطابقة المفتوح.
    const starts = MAX_TOOLS + 40
    let s = running()
    for (let i = 0; i < starts; i++) {
      s = applyAgentEvent(s, ev({ type: 'tool_start', callId: `c${i}`, name: 'read_file', args: { path: `f${i}` } }), T0)
    }
    expect(s.openStarts).toHaveLength(MAX_OPEN_STARTS)
    expect(s.tools).toHaveLength(MAX_TOOLS)
    // نافذة الأدوات احتفظت بالأحدث: الأقدم سقط ومعه مدخله من سجلّ المطابقة.
    expect(s.tools[0]?.callId).toBe(`c${starts - MAX_TOOLS}`)
    expect(s.openStarts[0]?.name).toBe('read_file')
  })
})

/* -------------------------------- ٥) لا running=true في أي مسار فشل */

describe('running لا يصبح true في أي مسار فشل', () => {
  it('كل مسارات الإنهاء تترك running=false من حالة جارية', () => {
    const cases: RunAction[] = [
      { type: 'run/rejected', message: 'رفض main الطلب' },
      { type: 'run/lost', message: 'انقطعت المهمة' },
      { type: 'run/stopped' },
    ]
    for (const action of cases) {
      const s = runReducer(running(), action, T0)
      expect(s.running, action.type).toBe(false)
      expect(s.dispatching, action.type).toBe(false)
      expect(s.stopping, action.type).toBe(false)
      expect(s.settled, action.type).toBe(true)
    }
  })

  it('مسارات الفشل من حالة ساكنة لا تُشعل running أصلًا', () => {
    const idle = initialRunState()
    const cases: RunAction[] = [
      { type: 'run/rejected', message: 'خطأ' },
      { type: 'run/lost', message: 'خطأ' },
      { type: 'run/stopped' },
      { type: 'run/stopping' },
      { type: 'event', event: ev({ type: 'failed', message: 'فشلت المهمة' }) },
      { type: 'event', event: ev({ type: 'done', reason: 'error' }) },
    ]
    for (const action of cases) {
      expect(runReducer(idle, action, T0).running, action.type).toBe(false)
    }
  })

  it('failed يوقف التشغيل ويظهر الخطأ', () => {
    const s = runReducer(running(), { type: 'event', event: ev({ type: 'failed', message: 'تعذّر الاتصال' }) }, T0)
    expect(s.running).toBe(false)
    expect(s.phase).toBe('error')
    expect(s.lastError).toBe('تعذّر الاتصال')
    expect(s.notices.some((n) => n.level === 'error')).toBe(true)
  })

  it('failed مكرّر لا يكرّر السطر ولا يغيّر phase', () => {
    const once = runReducer(running(), { type: 'event', event: ev({ type: 'failed', message: 'boom' }) }, T0)
    const twice = runReducer(once, { type: 'event', event: ev({ type: 'failed', message: 'boom' }) }, T0 + 1)
    expect(twice).toBe(once)
    expect(twice.phase).toBe('error')
  })

  it('الطريق الوحيد إلى running=true هو run/started (عدا الاستئناف المقصود)', () => {
    const sources: RunAction[] = [
      { type: 'run/rejected', message: 'x' },
      { type: 'run/lost', message: 'x' },
      { type: 'run/stopped' },
      { type: 'run/stopping' },
      { type: 'question/cleared' },
      { type: 'log/cleared' },
      { type: 'log/note', level: 'info', message: 'x' },
      { type: 'preview/url', url: 'http://127.0.0.1:3000' },
      { type: 'event', event: ev({ type: 'notice', level: 'info', message: 'x' }) },
      { type: 'event', event: ev({ type: 'text', delta: 'x' }) },
      { type: 'event', event: ev({ type: 'tool_start', callId: 'c', name: 'n', args: {} }) },
      { type: 'event', event: ev({ type: 'usage', inputTokens: 1, outputTokens: 1 }) },
      { type: 'event', event: ev({ type: 'plan', steps: [] }) },
      { type: 'event', event: ev({ type: 'done', reason: 'stop' }) },
    ]
    for (const action of sources) {
      expect(runReducer(initialRunState(), action, T0).running, action.type).toBe(false)
    }
    expect(runReducer(initialRunState(), { type: 'run/started' }, T0).running).toBe(true)
  })

  it('run/resumed يشعلها فقط لأن main قال إن العملية تعمل', () => {
    const s = runReducer(initialRunState(), { type: 'run/resumed' }, T0)
    expect(s.running).toBe(true)
    expect(s.dispatching).toBe(false)
    expect(s.settled).toBe(false)
    // ومتى كانت تعمل أصلًا فلا يلمسها.
    expect(runReducer(running(), { type: 'run/resumed' }, T0).running).toBe(true)
  })

  it('run/rejected بلا رسالة نصية يعطي خطأً عربيًا مفهومًا', () => {
    const s = runReducer(running(), { type: 'run/rejected', message: '   ' }, T0)
    expect(s.lastError).toBe('تعذّر بدء المهمة.')
    expect(s.phase).toBe('error')
  })
})

/* ------------------------------------------ ٦) التمرير التلقائي */

describe('shouldAutoScroll — حدّ «قريب من القاع» بالبكسل', () => {
  const at = (scrollTop: number, scrollHeight = 1000, clientHeight = 400): { scrollTop: number; scrollHeight: number; clientHeight: number } => ({
    scrollTop,
    scrollHeight,
    clientHeight,
  })

  it('في القاع تمامًا ⇒ true', () => {
    expect(shouldAutoScroll(at(600))).toBe(true)
  })

  it('تجاوز المستخدم القاع (فراغ سالب) ⇒ true دائمًا', () => {
    expect(shouldAutoScroll(at(700))).toBe(true)
  })

  it('عند الحدّ بالضبط (٥٦ بكسل) ⇒ true', () => {
    expect(shouldAutoScroll(at(544))).toBe(true)
  })

  it('بكسل واحد بعد الحدّ ⇒ false — لا ننتزع التمرير من المستخدم', () => {
    expect(shouldAutoScroll(at(543))).toBe(false)
  })

  it('بعيد فوق ⇒ false', () => {
    expect(shouldAutoScroll(at(0))).toBe(false)
  })

  it('العتبة قابلة للتغيير وتُحترم في الاتجاهين', () => {
    // عتبة صفرية: لا تسامح في البكسل إطلاقًا
    expect(shouldAutoScroll(at(560), 0)).toBe(false)
    expect(shouldAutoScroll(at(600), 0)).toBe(true)
    // عتبة 200: الحدّ نفسه مقبول، والبكسل التالي مرفوض
    expect(shouldAutoScroll(at(500), 200)).toBe(true)
    expect(shouldAutoScroll(at(400), 200)).toBe(true)
    expect(shouldAutoScroll(at(399), 200)).toBe(false)
  })

  it('محتوى أقصر من الحاوية (لا تمرير أصلًا) ⇒ true', () => {
    expect(shouldAutoScroll(at(0, 200, 400))).toBe(true)
  })
})

/* ------------------------------------------------- ٧) رموز ANSI */

describe('stripAnsi — إزالة رموز الألوان الحقيقية', () => {
  it('يزيل SGR ملوّن (ما يصل من FORCE_COLOR=1 في exec)', () => {
    expect(stripAnsi('\u001b[32m✓ built in 1.2s\u001b[39m')).toBe('✓ built in 1.2s')
  })

  it('يزيل سلسلة إعادة الضبط الكاملة', () => {
    expect(stripAnsi('\u001b[1;32mA\u001b[0m\u001b[2mB\u001b[22m')).toBe('AB')
  })

  it('يزيل تحكّم المؤشّر (مسح السطر) وينظّف\r', () => {
    expect(stripAnsi('progress...\r\u001b[2Kdone')).toContain('done')
    expect(stripAnsi('progress...\r\u001b[2Kdone')).not.toContain('\u001b')
  })

  it('يزيل مسح الشاشة والعودة للبداية (تسلسل CSI)', () => {
    expect(stripAnsi('\u001b[2J\u001b[Hscreen cleared')).toBe('screen cleared')
  })

  it('نص عربي بلا رموز يمرّ كما هو (بلا تغيير ولا قصّ)', () => {
    const text = 'تم تثبيت ١٢ حزمة'
    expect(stripAnsi(text)).toBe(text)
  })

  it('extractLoopbackUrl يقرأ رابطًا ملفوفًا برموز ANSI', () => {
    expect(extractLoopbackUrl('\u001b[36mhttp://127.0.0.1:5173\u001b[0m')).toBe('http://127.0.0.1:5173')
  })
})

/* ---------------------------------------- ٨) استخراج رابط المعاينة */

describe('extractLoopbackUrl — رابط خادم التطوير', () => {
  it('يقرأ رابط start_dev_server من خلاصته', () => {
    expect(extractLoopbackUrl('الخادم: http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
  })

  it('يقرأ رابطًا من مخرجات الخادم الحيّة (Vite)', () => {
    const log = '  VITE v5.4.0  ready in 412 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host'
    expect(extractLoopbackUrl(log)).toBe('http://localhost:5173')
  })

  it('يزيل الشرطة المائلة الطرفية ونقطةَ الجملة', () => {
    expect(extractLoopbackUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000')
    expect(extractLoopbackUrl('افتح http://127.0.0.1:3000.')).toBe('http://127.0.0.1:3000')
  })

  it('يحفظ المسار داخل الرابط', () => {
    expect(extractLoopbackUrl('http://127.0.0.1:4173/preview/index.html')).toBe('http://127.0.0.1:4173/preview/index.html')
  })

  it('يرفض الروابط غير المحلية (خادم بعيد لا يُحقن في المعاينة)', () => {
    expect(extractLoopbackUrl('https://api.openai.com/v1')).toBeNull()
    expect(extractLoopbackUrl('http://example.com:8080')).toBeNull()
    expect(extractLoopbackUrl('no url here')).toBeNull()
    expect(extractLoopbackUrl('')).toBeNull()
  })

  it('notice يحمل الرابط يحدّث previewUrl', () => {
    const s = applyAgentEvent(running(), ev({ type: 'notice', level: 'info', message: 'ready on http://127.0.0.1:5180/' }), T0)
    expect(s.previewUrl).toBe('http://127.0.0.1:5180')
  })

  it('نفس الرابط مرتين لا يُعيد الكتابة', () => {
    let s = applyAgentEvent(running(), ev({ type: 'notice', level: 'info', message: 'http://127.0.0.1:5173' }), T0)
    const first = s.previewUrl
    s = applyAgentEvent(s, ev({ type: 'notice', level: 'info', message: 'again http://127.0.0.1:5173' }), T0)
    expect(s.previewUrl).toBe(first)
  })

  it('preview/url يقبل العنوان الخام ويرفض غير المحلّي', () => {
    const local = runReducer(initialRunState(), { type: 'preview/url', url: 'http://localhost:3000/app' }, T0)
    expect(local.previewUrl).toBe('http://localhost:3000/app')
    const remote = runReducer(local, { type: 'preview/url', url: 'https://evil.example.com' }, T0)
    expect(remote.previewUrl).toBe('https://evil.example.com')
    expect(runReducer(remote, { type: 'preview/url', url: null }, T0).previewUrl).toBeNull()
  })
})

/* ------------------------------------------------- ٩) الحدود MAX_* */

describe('الحدود MAX_* — تقصّ المصفوفات فعلًا', () => {
  it('MAX_NOTICES: لا يتجاوز السجل ٢٠٠ ملاحظة', () => {
    let s = initialRunState()
    for (let i = 0; i < MAX_NOTICES + 120; i++) {
      s = runReducer(s, { type: 'log/note', level: 'info', message: `سطر ${i}` }, T0)
    }
    expect(s.notices).toHaveLength(MAX_NOTICES)
    expect(s.notices[0]?.message).toBe(`سطر ${120}`)
    expect(s.notices[MAX_NOTICES - 1]?.message).toBe(`سطر ${MAX_NOTICES + 119}`)
  })

  it('MAX_NOTICES + تكرار نفس الملاحظة: لا تضخّم', () => {
    let s = initialRunState()
    for (let i = 0; i < 10; i++) {
      s = runReducer(s, { type: 'log/note', level: 'info', message: 'نفس السطر' }, T0)
    }
    expect(s.notices).toHaveLength(1)
  })

  it('MAX_NOTICE_LEN: الملاحظة الطويلة تُقصّ', () => {
    const s = runReducer(initialRunState(), { type: 'log/note', level: 'info', message: 'ا'.repeat(MAX_NOTICE_LEN + 900) }, T0)
    expect(s.notices[0]?.message).toHaveLength(MAX_NOTICE_LEN)
  })

  it('MAX_LINES: المحادثة لا تنمو بلا حدود', () => {
    let s = running()
    // كل دلتا تنتهي بفقرة فارغة ⇒ تُغلق فورًا وتصير سطرًا مستقلًا.
    for (let i = 0; i < MAX_LINES + 120; i++) {
      s = applyAgentEvent(s, ev({ type: 'text', delta: `سطر ${i}\n\n` }), T0)
    }
    expect(s.lines.length).toBeLessThanOrEqual(MAX_LINES)
    expect(s.lines).toHaveLength(MAX_LINES)
    expect(s.lines[0]?.text).toBe('سطر 120')
  })

  it('MAX_TOOLS: نافذة الأدوات محدودة (مغطّى أعلاه بتفصيل)', () => {
    let s = running()
    for (let i = 0; i < MAX_TOOLS + 1; i++) {
      s = applyAgentEvent(s, ev({ type: 'tool_start', callId: `c${i}`, name: 'list_files', args: { path: `f${i}` } }), T0)
    }
    expect(s.tools).toHaveLength(MAX_TOOLS)
  })

  it('MAX_SUMMARY_LEN وMAX_ARG_VALUE يقصّان العرض لا الحالة', () => {
    const long = 'ط'.repeat(MAX_SUMMARY_LEN + 100)
    const s = feed(running(), [
      { type: 'tool_start', callId: 'c1', name: 'run_command', args: { command: 'x'.repeat(MAX_ARG_VALUE + 50) } },
      { type: 'tool_end', callId: 'c1', name: 'run_command', ok: true, summary: long, ms: 7 },
    ])
    expect(s.tools[0]?.summary).toHaveLength(MAX_SUMMARY_LEN)
    const shown = s.tools[0]?.args.command
    expect(typeof shown).toBe('string')
    expect((shown as string).length).toBeLessThanOrEqual(MAX_ARG_VALUE + 1)
  })

  it('MAX_LINES محفوظ في مساحة العمل أيضًا (سطر المستخدم)', () => {
    expect(MAX_LINES).toBe(300)
    expect(MAX_TOOLS).toBe(120)
    expect(MAX_NOTICES).toBe(200)
  })
})

/* ------------------------------------------------- ١٠) formatUsage */

describe('formatUsage — نص عربي مقروء', () => {
  it('الحالة الفارغة ⇒ نص فارغ (لا «NaN رمز» في الشريط)', () => {
    expect(formatUsage(null)).toBe('')
  })

  it('أقل من ألف ⇒ العدد مباشرة', () => {
    expect(formatUsage({ inputTokens: 400, outputTokens: 200 })).toBe('600 رمز')
    expect(formatUsage({ inputTokens: 0, outputTokens: 0 })).toBe('0 رمز')
    expect(formatUsage({ inputTokens: 999, outputTokens: 0 })).toBe('999 رمز')
  })

  it('ألف فأكثر ⇒ k بخانة عشرية واحدة', () => {
    expect(formatUsage({ inputTokens: 1_000, outputTokens: 0 })).toBe('1.0k رمز')
    expect(formatUsage({ inputTokens: 1_200, outputTokens: 300 })).toBe('1.5k رمز')
    expect(formatUsage({ inputTokens: 250_000, outputTokens: 0 })).toBe('250.0k رمز')
  })

  it('usage يتراكم عبر الأحداث، والأصفار لا تمسح شيئًا', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'usage', inputTokens: 1_000, outputTokens: 200 }), T0)
    s = applyAgentEvent(s, ev({ type: 'usage', inputTokens: 50, outputTokens: 10 }), T0)
    expect(s.usage).toEqual({ inputTokens: 1_050, outputTokens: 210 })
    expect(formatUsage(s.usage)).toBe('1.3k رمز')

    const before = s.usage
    s = applyAgentEvent(s, ev({ type: 'usage', inputTokens: 0, outputTokens: 0 }), T0)
    expect(s.usage).toBe(before)
  })

  it('قيم سالبة أو مشوّهة تُقصّ عند الصفر', () => {
    const s = applyAgentEvent(running(), ev({ type: 'usage', inputTokens: -5, outputTokens: 7 }), T0)
    expect(s.usage).toEqual({ inputTokens: 0, outputTokens: 7 })
  })

  it('run/started يصفّر عدّاد الرموز (كل مهمة تبدأ من جديد)', () => {
    let s = applyAgentEvent(running(), ev({ type: 'usage', inputTokens: 900, outputTokens: 100 }), T0)
    expect(s.usage).not.toBeNull()
    s = runReducer(s, { type: 'run/started' }, T0)
    expect(s.usage).toBeNull()
  })

  it('NO_MODEL نص عربي لا ينقص ولا يصير فارغًا', () => {
    expect(NO_MODEL.length).toBeGreaterThan(0)
    expect(NO_MODEL).toMatch(/[\u0600-\u06FF]/)
  })
})

/* ---------------------------------- ١١) مساعدات العرض— البصمة والعدّ */

describe('مساعدات العرض', () => {
  it('visibleTools يبقي الأحدث فقط، بلا نسخ بلا داعٍ', () => {
    const s = feed(running(), [
      { type: 'tool_start', callId: 'a', name: 'a', args: {} },
      { type: 'tool_end', callId: 'a', name: 'a', ok: true, summary: '', ms: 1 },
      { type: 'tool_start', callId: 'b', name: 'b', args: {} },
    ])
    expect(s.tools).toHaveLength(2)
    expect(visibleTools(s.tools).map((t) => t.name)).toEqual(['a', 'b'])
    expect(visibleTools(s.tools, 1).map((t) => t.name)).toEqual(['b'])
    expect(visibleTools([], 6)).toEqual([])
  })

  it('noticeCounts يعدّ كل مستوى', () => {
    const s = runReducer(initialRunState(), { type: 'log/note', level: 'error', message: 'أ' }, T0)
    const s2 = runReducer(s, { type: 'log/note', level: 'warn', message: 'ب' }, T0)
    const s3 = runReducer(s2, { type: 'log/note', level: 'info', message: 'ج' }, T0)
    expect(noticeCounts(s3.notices)).toEqual({ total: 3, errors: 1, warns: 1 })
  })

  it('filterNotices «الكل» يعيد المصفوفة كما هي، والمستوى يفلتر', () => {
    const notices = [
      { id: 'n0', level: 'error' as NoticeLevel, message: 'أ', at: T0 },
      { id: 'n1', level: 'info' as NoticeLevel, message: 'ب', at: T0 },
      { id: 'n2', level: 'warn' as NoticeLevel, message: 'ج', at: T0 },
    ]
    expect(filterNotices(notices, 'all')).toBe(notices)
    expect(filterNotices(notices, 'error').map((n) => n.id)).toEqual(['n0'])
    expect(filterNotices(notices, 'warn').map((n) => n.id)).toEqual(['n2'])
  })

  it('log/cleared يمسح السجل ويحرّر الذاكرة', () => {
    const s = runReducer(initialRunState(), { type: 'log/note', level: 'info', message: 'أ' }, T0)
    const cleared = runReducer(s, { type: 'log/cleared' }, T0)
    expect(cleared.notices).toEqual([])
    expect(runReducer(cleared, { type: 'log/cleared' }, T0)).toBe(cleared)
  })

  it('transcriptSignature يتغيّر عند تغيّر حالة الأداة لا عددها فقط', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: 'a', name: 'n', args: {} }), T0)
    const runningSig = transcriptSignature(s)
    s = applyAgentEvent(s, ev({ type: 'tool_end', callId: 'a', name: 'n', ok: true, summary: 'تم', ms: 1 }), T0)
    expect(s.tools).toHaveLength(1)
    // نفس العدد لا يكفي: تغيّر الحالة فقط يجب أن يغيّر البصمة، وإلا تحدّث التمرير الكسل.
    expect(transcriptSignature(s)).not.toBe(runningSig)
  })

  it('toolKey لا يتغيّر بترتيب مفاتيح الكائن', () => {
    expect(toolKey('write_file', { path: 'a.ts', content: 'x' })).toBe(toolKey('write_file', { content: 'x', path: 'a.ts' }))
    expect(toolKey('a', { p: 1 })).not.toBe(toolKey('b', { p: 1 }))
  })

  it('describeArgs يبرز المسار والأمر، ويُخفي المحتوى والأسرار', () => {
    expect(describeArgs({ path: 'src/App.tsx' })).toBe('path=src/App.tsx')
    expect(describeArgs({ content: 'SECRET', apiKey: 'sk-x', path: 'a.ts' })).toContain('path=a.ts')
    expect(describeArgs({ content: 'SECRET' })).toBe('')
    expect(describeArgs(null)).toBe('')
    expect(describeArgs([1, 2])).toBe('')
  })

  it('compactArgs لا يُخرج content ولا apiKey ولا نصًا ضخمًا', () => {
    const out = compactArgs({ path: 'a.ts', content: 'SECRET', apiKey: 'sk-1', items: [1, 2, 3], flag: true })
    expect(out.content).toBeUndefined()
    expect(out.apiKey).toBeUndefined()
    expect(out.path).toBe('a.ts')
    expect(out.flag).toBe(true)
    expect(out.items).toBe('3 عنصر')
  })

  it('سطر الأداة لا يسرّب مفتاحًا ولا محتوى ملف إلى الواجهة', () => {
    const s = feed(running(), [{ type: 'tool_start', callId: 'c', name: 'write_file', args: { path: 'a.ts', content: 'رمز سري', apiKey: 'sk-live-1234' } }])
    const row = s.tools[0]
    expect(row?.argHint).not.toContain('sk-live-1234')
    expect(row?.argHint).not.toContain('رمز سري')
    expect(JSON.stringify(row?.args)).not.toContain('sk-live-1234')
  })

  it('flush: أول حدث غير نصّي يفرّغ الكتلة في السطر فلا تصير فقرة متّصلة', () => {
    let s = running()
    s = applyAgentEvent(s, ev({ type: 'text', delta: 'سطر أول\n\n' }), T0)
    s = applyAgentEvent(s, ev({ type: 'text', delta: 'جارٍ العمل' }), T0)
    expect(s.streamingText).toBe('جارٍ العمل')
    s = applyAgentEvent(s, ev({ type: 'tool_start', callId: 'a', name: 'n', args: {} }), T0)
    expect(s.streamingText).toBe('')
    const texts = s.lines.map((l) => l.text)
    expect(texts).toContain('سطر أول')
    expect(texts).toContain('جارٍ العمل')
  })

  it('الخطة تُنقّى: خطوة بلا status صالحة تصبح pending', () => {
    const s = applyAgentEvent(
      running(),
      ev({
        type: 'plan',
        steps: [
          { index: 1, title: 'إنشاء المشروع', status: 'done' },
          { index: 2, title: 'كتابة الملفات', status: 'bogus' as never },
          { index: 3, title: '', status: 'active' },
        ],
      }),
      T0,
    )
    expect(s.plan).toHaveLength(3)
    expect(s.plan[0]?.status).toBe('done')
    expect(s.plan[1]?.status).toBe('pending')
    expect(s.plan[2]?.title.length).toBeGreaterThan(0)
  })

  it('initialRunState نظيفة ومتوقفة', () => {
    const s = initialRunState()
    expect(s.running).toBe(false)
    expect(s.settled).toBe(true)
    expect(s.phase).toBe('idle')
    expect(s.lines).toEqual([])
    expect(s.tools).toEqual([])
    expect(s.notices).toEqual([])
    expect(s.openStarts).toEqual([])
    expect(s.unknownEvents).toBe(0)
    expect(s.usage).toBeNull()
    expect(s.lastError).toBeNull()
  })
})