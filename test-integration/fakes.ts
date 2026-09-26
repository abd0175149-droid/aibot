import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * ★★★ **مزوّدان مزيّفان — وشكلُهما يُنسخ من المُحلِّل لا يُخمَّن.**
 *
 *   الاختبارُ يشغّل مسارَ الردّ الحقيقيّ كاملاً، فلا بدّ من طرفَين خارجيَّين:
 *   ميتا (‏Graph) وجيميناي. وكلاهما يُبدَّل بمتغيّر بيئةٍ قائمٍ أصلاً في
 *   الشيفرة — `GRAPH_BASE` و`GOOGLE_AI_BASE` — فلا حاجةَ إلى حقنٍ جديد.
 *
 * ⚠️ والشكلُ **يُطابق ما يقرؤه المُحلِّل بالضبط**:
 *   · `res.messages[0].id` — وإلّا رمى `NO_MESSAGE_ID` (‏`whatsapp.ts:99`).
 *   · `candidates[0].content.parts[0].text` و`usageMetadata` بعدَّادَين غيرِ
 *     صفريَّين — وإلّا حُسبت الكلفةُ صفراً ومرّ الاختبارُ على كلفةٍ كاذبة
 *     (‏`google.ts:60,78`).
 *   ومزيّفٌ بشكلٍ مخترعٍ يشهد على مسارٍ غير الذي يعمل.
 *
 * ⚠️ ويسجّل كلَّ طلبٍ: التأكيدُ على «كم رسالةً خرجت» لا يُقرأ من القاعدة
 *    وحدها — القاعدةُ تقول ما حُجز، والسجلُّ يقول ما **خرج فعلاً**.
 */

export interface FakeLog {
  graphSends: Array<{ to: string; body: string }>;
  modelCalls: Array<{ model: string; contents: unknown }>;
}

export interface Fakes {
  url: string;
  log: FakeLog;
  /** نصُّ الردّ الذي يُعيده النموذجُ في النداء التالي. */
  setReply: (text: string) => void;
  close: () => Promise<void>;
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

export async function startFakes(): Promise<Fakes> {
  const log: FakeLog = { graphSends: [], modelCalls: [] };
  let reply = 'أهلاً! كيف أقدر أساعدك؟';

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '';
      const raw = await readBody(req);
      const json = raw ? JSON.parse(raw) as Record<string, unknown> : {};

      /* ① ميتا — إرسالُ رسالة. الشكلُ من `whatsapp.ts:99`. */
      if (url.includes('/messages')) {
        const text = (json.text as { body?: string } | undefined)?.body
          ?? (json.interactive as { body?: { text?: string } } | undefined)?.body?.text
          ?? '';
        /* حالةُ القراءة (`status: read`) ليست إرسالاً — لا تُحسب. */
        if (json.status !== 'read') {
          log.graphSends.push({ to: String(json.to ?? ''), body: text });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          messaging_product: 'whatsapp',
          contacts: [{ input: String(json.to ?? ''), wa_id: String(json.to ?? '') }],
          messages: [{ id: `wamid.FAKE_${randomUUID()}` }],
        }));
        return;
      }

      /* ② جيميناي — توليد. الشكلُ من `google.ts:60,78`. */
      if (url.includes(':generateContent')) {
        const model = /models\/([^:]+):/.exec(url)?.[1] ?? '?';
        log.modelCalls.push({ model, contents: json.contents });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          candidates: [{
            content: { role: 'model', parts: [{ text: reply }] },
            finishReason: 'STOP',
          }],
          /* غيرُ صفريَّين عمداً: كلفةٌ صفريّةٌ تجعل الاختبارَ يشهد على
             حسابٍ لم يجرِ — وهي حادثةُ `price_missing` بعينها. */
          usageMetadata: { promptTokenCount: 128, candidatesTokenCount: 24, totalTokenCount: 152 },
        }));
        return;
      }

      /* ③ التضمين — الاسترجاعُ يناديه لكلّ ردّ. */
      if (url.includes(':embedContent') || url.includes(':batchEmbedContents')) {
        const one = { values: Array.from({ length: 768 }, () => 0.01) };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ embedding: one, embeddings: [one] }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `مسارٌ غيرُ مزيَّف: ${url}`, code: 404 } }));
    })().catch(() => {
      res.writeHead(500);
      res.end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('تعذّر ربطُ خادم التزييف');

  return {
    url: `http://127.0.0.1:${addr.port}`,
    log,
    setReply: (t: string) => { reply = t; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
