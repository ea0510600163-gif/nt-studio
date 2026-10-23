import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { postSse } from '../src/main/providers/transport.ts'
import { LlmError } from '../src/main/providers/types.ts'

/**
 * postSse هو الطبقة التي تُشغّل كل نموذج. هذا الاختبار يثبت أنها تُكمل بثّاً
 * حقيقياً بالكامل — لأن «الوكيل لا يرد» كان أبرز عَرَض غامض في الميدان،
 * وهذه أولاً تُثبت أن الطبقة نفسها تُكمل.
 */
test('postSse يُكمل بثّ SSE متأخر الأحداث بالكامل', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"a":1}\n\n')
    setTimeout(() => { res.write('data: {"b":2}\n\n'); res.end() }, 50)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const got = []
  try {
    await postSse(`http://127.0.0.1:${port}/chat/completions`, { authorization: 'Bearer x' }, { model: 'm' }, new AbortController().signal, (d) => got.push(d))
  } finally {
    server.close()
  }
  assert.deepEqual(got, ['{"a":1}', '{"b":2}'])
})

test('postSse يرفض استجابة HTTP الخاطئة بلا تعليق', async () => {
  const server = createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"Missing API key."}}')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await assert.rejects(
    postSse(`http://127.0.0.1:${port}/chat/completions`, {}, {}, new AbortController().signal, () => {}),
    (e) => {
      assert.ok(e instanceof LlmError, `توقّعنا LlmError فجاء ${e?.name}`)
      assert.match(String(e.message), /401/)
      // الرسالة الحقيقية من المزوّد تُستخلص من غلاف JSON لا تظهر كـ "401" عارية
      assert.ok(String(e.message).includes('Missing API key'), e.message)
      assert.equal(e.status, 401)
      // 401 ليس قابلاً لإعادة المحاولة — إعادة المحاولة ستستهلك ست محاولات بلا فائدة
      assert.equal(e.retryable, false)
      assert.equal(e.kind, 'auth')
      return true
    }
  )
  server.close()
})

/**
 * انحدار HIGH: بوابة تُجيب 200 بغلاف خطأ JSON (حصة مستنفدة مثلاً). كان postSse
 * يقبل أي 2xx ويمسح الأسطر بحثاً عن «data:» فلا يجد شيئاً، فينتهي الحال
 * بـ «انقطع البث قبل اكتمال الرد» — رسالة تخفي السبب الحقيقي تماماً.
 */
test('postSse يستخلص رسالة الخطأ الحقيقية من ردّ 200 غير بثّي (application/json)', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"quota exceeded"}}')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  try {
    await assert.rejects(
      postSse(
        `http://127.0.0.1:${port}/chat/completions`,
        {},
        {},
        new AbortController().signal,
        // لا يصح أن يصل حدث بثّ واحد: الردّ ليس بثّاً من أصله
        (d) => { throw new Error(`وصل حدث بثّ غير متوقّع: ${d}`) }
      ),
      (e) => {
        assert.ok(e instanceof LlmError, `توقّعنا LlmError فجاء ${e?.name}: ${e?.message}`)
        assert.match(String(e.message), /quota exceeded/)
        assert.equal(e.status, 200)
        // 200 مع غلاف خطأ: إعادة المحاولة لا تغيّر النتيجة
        assert.equal(e.retryable, false)
        return true
      }
    )
  } finally {
    server.close()
  }
})

/** نفس الانحدار لكن الجسم نص خام لا JSON — يجب أن يظهر النص كما هو */
test('postSse يستخلص نص الخطأ الخام من ردّ 200 غير بثّي', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('upstream connect error')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await assert.rejects(
    postSse(`http://127.0.0.1:${port}/chat/completions`, {}, {}, new AbortController().signal, () => {}),
    (e) => {
      assert.ok(e instanceof LlmError)
      assert.match(String(e.message), /upstream connect error/)
      return true
    }
  )
  server.close()
})

/** 200 بلا ترويسة content-type إطلاقاً: بعض البوابات البسيطة تحذفها */
test('postSse يتجاوز غياب ترويسة content-type ويمسح تفاؤلياً', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200)
    res.write('data: {"a":1}\n\n')
    res.end('data: [DONE]\n\n')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const got = []
  try {
    await postSse(`http://127.0.0.1:${port}/chat/completions`, {}, {}, new AbortController().signal, (d) => got.push(d))
  } finally {
    server.close()
  }
  assert.deepEqual(got, ['{"a":1}', '[DONE]'])
})

/** الشكل الواقعي للترويسة يحمل معاملات — يجب ألا يُرفض بثّ سليم */
test('postSse يقبل text/event-stream مع معاملات', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    res.end('data: {"ok":true}\n\n')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const got = []
  try {
    await postSse(`http://127.0.0.1:${port}/chat/completions`, {}, {}, new AbortController().signal, (d) => got.push(d))
  } finally {
    server.close()
  }
  assert.deepEqual(got, ['{"ok":true}'])
})
