/**
 * ═════════════════════════════════════════════════════════════════════════
 * اختبار التحمّل — شرطُ قبولٍ من المرحلة السابعة:
 * «٥٠ محادثةً متزامنة» عبر **مسار الويبهوك الحقيقيّ** لا عبر الطابور مباشرةً.
 *
 * وفرقُ ذلك عن `drill-debounce.ts` جوهريّ: تلك التمارين تدفع مهمّةً إلى
 * `ch-inbound` بيدها، فتقفز فوق نصف المسار — Fastify، وحلّ المستأجر بدورٍ
 * متجاوز، وتحقّق توقيع ميتا، والردّ قبل المعالجة. وهنا كلّ ذلك داخل القياس:
 * حمولةٌ بشكل ميتا بالضبط + `x-hub-signature-256` صحيح ⟶ POST على
 * `/api/webhooks/wa/:publicId`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★ القرار الأوّل: **مزوّدٌ وهميٌّ بزمنٍ واقعيّ، لا خمسون نداءً حقيقيّاً.**
 *
 *   السببُ ليس الكلفة (خمسون نداءً على flash سنتاتٌ قليلة). السبب أنّ
 *   **المقيسَ هو المنصّة**: الطوابير والقاعدة والأقفال والنوافذ. ونداءُ
 *   Gemini الحقيقيّ يُدخل في القياس متغيّراً لا نملكه ولا نصلحه — زمنَ
 *   استجابةِ مزوّدٍ يتقلّب بين ثانيةٍ وثمانٍ وقد يرمي 429 في منتصف الضخّ —
 *   فيصير الرقم الناتج «كم كان Gemini سريعاً اليوم» لا «كم يحتمل خادمنا».
 *
 *   والأهمّ: الزمنُ الوهميّ **وسيطٌ نُحرّكه**. طاقةُ هذه المنصّة معادلةٌ لا
 *   رقم: عاملُ الردّ بتزامن ٣، فالخرجُ ≈ ٣ ÷ زمن المزوّد. ولا يُثبَت ذلك
 *   إلّا بتشغيلَين بزمنَين مختلفَين — وهو ما لا يمكن مع مزوّدٍ حقيقيّ.
 *
 *   وثمنُ القرار مُعلَن: هذا الاختبار **لا يقيس Gemini ولا حدوده**، ولا
 *   يشهد على سلوك المنصّة عند فشل المزوّد (ذاك تمرينٌ آخر).
 *
 * ★ القرار الثاني: **مِكدسٌ معزول، لأنّ `nuskjo` و`baitalsham` حيّان.**
 *
 *   لتقيس «من الويبهوك إلى ظهور الردّ الصادر» يجب أن ينجح الإرسال إلى Graph،
 *   وتوكن التمرين غير صالح. وتوجيه Graph إلى بديلٍ وهميّ يجري بمتغيّر بيئةٍ
 *   **عامٍّ للعمليّة** (`GRAPH_BASE`)، فإعادةُ تشغيل عامل الإنتاج به تعني أنّ
 *   أيّ رسالةٍ من مستأجرٍ حقيقيّ خلال الضخّ تُرسَل إلى بديلٍ وهميّ = رسالةٌ
 *   ضائعة عند زبونٍ حقيقيّ. ولا يُشترى قياسٌ بهذا الثمن.
 *
 *   فالمكدس هنا نسخةٌ معزولةٌ من الشيفرة نفسها:
 *     · الـAPI **عمليّةٌ منفصلة** (‏`apps/api/src/main.ts`) كما في الإنتاج،
 *     · والعمّال في هذه العمليّة بنفس دوالّ الإنتاج ونفس تزامنها،
 *       (والتزامن **يُقرأ من `main.ts` ويُطابَق** — فلا يكذب الاختبار بعد
 *        تعديلٍ في الإنتاج لا يعرفه، انظر `assertConcurrencyMatchesProd`)
 *     · وريدِس **قاعدةٌ منطقيّةٌ أخرى** (`REDIS_DB`, افتراضها 9) فلا يرى
 *       عاملُ الإنتاج مهامَّنا ولا نرى مهامَّه،
 *     · وPostgres **هو نفسه** عمداً: الأقفال والمجمّع والـRLS تُقاس على
 *       القاعدة الحقيقيّة وبجانب حركة الإنتاج — وهذا هو السؤال أصلاً.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ما يُقاس
 *   ① زمن الاستجابة من إرسال الويبهوك إلى **وصول الردّ الصادر إلى القناة**
 *      (بديلُ Graph يسجّل لحظةَ الوصول — فلا استقصاءٌ بدقّة ٢٠٠ms يُجمّل الرقم)
 *      مع تفصيلٍ لكلّ مرحلة: بوّابة ⟶ وارد ⟶ انتظارُ الطابور والدمج ⟶ الردّ.
 *   ② عمقُ الطوابير كلَّ نصف ثانية، وهل انحسر بعد التوقّف.
 *   ③ الصحّة: صفرُ رسالةٍ ضائعة · صفرُ ردٍّ مكرَّر · صفرُ نافذةٍ مفوترةٍ مرّتين.
 *   ④ الأقفال: `pg_stat_activity` أثناء الضخّ، وعدّادُ `deadlocks` قبل/بعد.
 *   ⑤ الحملُ والذاكرة: `loadavg` المضيف (‏`/proc` مشتركٌ مع الحاوية) وRSS.
 *
 * ★ وتجربةُ **النافذة المزدوجة** (`BURST`) ليست زينة: `openOrExtendWindow`
 *   تقرأ ثمّ تكتب بلا قفل، وتعليقُها يُحيل الضمانَ إلى «قيدٍ فريدٍ جزئيّ في
 *   القاعدة». فهذه الحُقنة تُثبت وجودَه أو غيابَه بثلاث رسائل متزامنة على
 *   محادثةٍ نافذتُها مغلقة — وغيابُه يعني نافذتَين مفتوحتَين لمحادثةٍ واحدة،
 *   أي فاتورةً مزدوجةً على العميل نفسه في نفس الـ٢٤ ساعة.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * التشغيل على الخادم — `ops/` و`scripts/` تُوصَلان وقت التشغيل:
 *
 *   docker compose run --rm -T --no-deps \
 *     -v "$HOME/aibot-drill/load-test.ts:/app/apps/worker/scripts/load-test.ts:ro" \
 *     -e TENANT_SLUG=drill -e LEVELS=10,25,50 -e PROVIDER_MS=1200 \
 *     api node --import tsx apps/worker/scripts/load-test.ts < /dev/null
 *
 * ★ ولا تُنبِته على `| tee`: رمزُ خروج الأنبوب هو رمزُ `tee` لا رمزُ الاختبار،
 *   فبوّابةٌ تقرأه ترى نجاحاً والاختبار طبع ❌ (وقع فعلاً في أوّل تشغيلٍ كامل).
 *   إن أردت سجلّاً ومخرَجاً معاً: `set -o pipefail` أو `> log 2>&1` ثمّ اقرأه.
 *
 * وينظّف أثره كلَّه في النهاية ولو فشل، ولا يلمس مستأجراً غير `drill*`.
 * ═════════════════════════════════════════════════════════════════════════
 */
import { createHmac } from 'node:crypto';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  getDb, closeDb, withPlatform, withTenant,
  tenants, tenantChannels, botConfigs, botVersions,
  contacts, channelIdentities, conversations, messages, conversationWindows,
  aiRuns, incidents, eq, and, sql,
} from '@aibot/db';
import { publicId, seal, fingerprint } from '@aibot/crypto';

/* ───────────────────────────── الإعداد ───────────────────────────── */

const SLUG = process.env.TENANT_SLUG ?? 'drill';
/** مستأجرون حقيقيّون — بوتاهما يعملان. لا يلمسهما هذا السكربت بحالٍ. */
const LIVE_TENANTS = ['nuskjo', 'baitalsham'];

/** `own` = مكدسٌ معزول ببديلَين وهميَّين. `prod` = ضخٌّ على api الإنتاج ببوتٍ مطفأ. */
const STACK = (process.env.STACK ?? 'own') as 'own' | 'prod';
const LEVELS = (process.env.LEVELS ?? process.env.CONV ?? '50')
  .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
/** زمنُ المزوّد الوهميّ: القياسُ للمنصّة، وهذا وسيطٌ مُعلَن لا رقمٌ مخفيّ. */
const PROVIDER_MS = Number(process.env.PROVIDER_MS ?? '1200');
const PROVIDER_JITTER_MS = Number(process.env.PROVIDER_JITTER_MS ?? '400');
const GRAPH_MS = Number(process.env.GRAPH_MS ?? '250');
const REDIS_DB = Number(process.env.REDIS_DB ?? '9');
const LOCAL_API_PORT = Number(process.env.LOCAL_API_PORT ?? '4199');
const PROD_API_URL = process.env.PROD_API_URL ?? 'http://api:4100';
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? '500');
/** مهلةُ استواءِ مستوىً واحد. تأخيرُ الدمج ٢s + الطابور + هامش. */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? '240000');
/** بعد آخر ردّ: نُكمل المراقبة لنرى الانحسار — **وليصل أيُّ ردٍّ مكرَّرٍ متأخّر.** */
const DRAIN_MS = Number(process.env.DRAIN_MS ?? '6000');
/** حُقنةُ النافذة المزدوجة: رسائلُ متزامنة على محادثةٍ واحدة. 0 = تخطَّها. */
const BURST = Number(process.env.BURST ?? '3');
const MODEL = process.env.MODEL ?? 'gemini-2.5-flash';
const PROVIDER = process.env.PROVIDER ?? 'google';
const APP_SECRET = process.env.DRILL_APP_SECRET ?? 'drill-app-secret-for-load-test';
const FAKE_TOKEN = 'DRILL_LOAD_FAKE_TOKEN';
const RUN_ID = Date.now().toString(36);

/* الحارس الأوّل — قبل أيّ اتّصالٍ بأيّ شيء. */
if (LIVE_TENANTS.includes(SLUG)) {
  console.error(`\n🔴 ${SLUG} مستأجرٌ حقيقيٌّ وبوتُه يعمل — الضخّ عليه ممنوع.\n`);
  process.exit(2);
}
if (!/^drill/.test(SLUG)) {
  console.error(`\n🔴 TENANT_SLUG=${SLUG} — اختبارُ التحمّل لا يُشغَّل إلّا على مستأجرٍ يبدأ بـdrill.\n`);
  process.exit(2);
}
if (STACK === 'own' && REDIS_DB === 0) {
  console.error('\n🔴 REDIS_DB=0 هي قاعدةُ طوابير الإنتاج — العزل شرطُ تشغيل.\n');
  process.exit(2);
}

/* ───────────────────────────── أدوات ───────────────────────────── */

function log(msg: string, extra?: unknown): void {
  console.log(extra === undefined ? `  ${msg}` : `  ${msg} ${JSON.stringify(extra)}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const num = (n: number, d = 0): string => n.toFixed(d);

function pct(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}
function bar(n: number, max: number, width = 26): string {
  if (max <= 0 || n <= 0) return '';
  return '█'.repeat(Math.max(1, Math.round((n / max) * width)));
}
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padStart(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

/** رقمٌ دوليٌّ بشكل ما ترسله ميتا، والصيغةُ المخزَّنة التي يوحّدها `normalizeAnyPhone`. */
function phonePair(level: number, i: number): { wa: string; stored: string } {
  const wa = `962791${String(400000 + level * 1000 + i)}`;
  return { wa, stored: `0${wa.slice(3)}` };
}

/** حمولةُ ميتا — الشكل الحقيقيّ حرفيّاً، فالمحلّل نفسه هو من يقرأها. */
function metaPayload(o: {
  phoneNumberId: string; wa: string; text: string; externalId: string; name: string;
}): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: `WABA_DRILL_${RUN_ID}`,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '962790000000', phone_number_id: o.phoneNumberId },
          contacts: [{ profile: { name: o.name }, wa_id: o.wa }],
          messages: [{
            from: o.wa,
            id: o.externalId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: o.text },
          }],
        },
      }],
    }],
  });
}

function signature(raw: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');
}

/* ───────────────────────── البديلان الوهميّان ───────────────────────── */

interface Stubs {
  graphBase: string;
  aiBase: string;
  /** لحظةُ وصول كلّ إرسالٍ إلى القناة، مفتاحُها الرقمُ كما تراه طبقةُ الإرسال. */
  sends: Map<string, number[]>;
  reads: number;
  aiCalls: number;
  close(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('تعذّر حجزُ منفذٍ للبديل الوهميّ');
  return addr.port;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

function json(reply: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  reply.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  reply.end(s);
}

async function startStubs(): Promise<Stubs> {
  const state = { sends: new Map<string, number[]>(), reads: 0, aiCalls: 0, seq: 0 };

  /** بديلُ Graph — يسجّل **لحظةَ وصول الردّ الصادر**، وهي نهايةُ القياس. */
  const graph = createServer((req, reply) => {
    void (async () => {
      const body = await readBody(req);
      if (req.method !== 'POST') return json(reply, 200, { ok: true });
      const m = /\/([^/]+)\/messages$/.exec(req.url ?? '');
      if (!m) return json(reply, 404, { error: { message: 'مسارٌ غير متوقَّع', code: 100 } });

      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { /* يُعامَل فارغاً */ }

      if (parsed.status === 'read') {
        state.reads += 1;
        return json(reply, 200, { success: true });
      }

      /* التسجيل **قبل** التأخير: المقيس هو وصولُ الردّ إلى القناة لا إقرارُها. */
      const to = String(parsed.to ?? 'مجهول');
      const at = Date.now();
      const list = state.sends.get(to);
      if (list) list.push(at); else state.sends.set(to, [at]);

      if (GRAPH_MS > 0) await sleep(GRAPH_MS);
      state.seq += 1;
      json(reply, 200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: to, wa_id: to }],
        messages: [{ id: `wamid.LOAD${RUN_ID}${state.seq}` }],
      });
    })();
  });

  /** بديلُ Gemini — شكلُ الاستجابة الحقيقيّ، وزمنٌ واقعيٌّ بتشتّت. */
  const ai = createServer((req, reply) => {
    void (async () => {
      await readBody(req);
      const url = req.url ?? '';
      if (url.includes(':batchEmbedContents')) {
        return json(reply, 200, { embeddings: [{ values: new Array(768).fill(0.001) }] });
      }
      if (!url.includes(':generateContent')) return json(reply, 404, { error: { message: 'غير مدعوم' } });

      state.aiCalls += 1;
      const n = state.aiCalls;
      const jitter = PROVIDER_JITTER_MS > 0
        ? Math.round((Math.random() * 2 - 1) * PROVIDER_JITTER_MS) : 0;
      await sleep(Math.max(0, PROVIDER_MS + jitter));

      json(reply, 200, {
        candidates: [{
          content: {
            role: 'model',
            /* نصٌّ مختلفٌ لكلّ نداء: حارسُ التكرار يبتلع المتماثل، فيصير
               «ردٌّ مفقود» عطلاً في القياس لا في المنصّة. */
            parts: [{ text: `أهلاً فيك. ساعات العمل من ٩ صباحاً حتّى ٥ مساءً، وجاهزين نخدمك. (م${n})` }],
          },
          finishReason: 'STOP',
        }],
        usageMetadata: {
          promptTokenCount: 900 + (n % 40),
          candidatesTokenCount: 48 + (n % 7),
          totalTokenCount: 948 + (n % 40) + (n % 7),
        },
      });
    })();
  });

  const gp = await listen(graph);
  const ap = await listen(ai);

  return {
    graphBase: `http://127.0.0.1:${gp}/v21.0`,
    aiBase: `http://127.0.0.1:${ap}/v1beta`,
    get sends() { return state.sends; },
    get reads() { return state.reads; },
    get aiCalls() { return state.aiCalls; },
    close: async () => {
      await new Promise<void>((r) => graph.close(() => r()));
      await new Promise<void>((r) => ai.close(() => r()));
    },
  };
}

/* ───────────────── تزامنُ العمّال — يُقرأ من الإنتاج لا يُنسخ ───────────────── */

/**
 * ★ اختبارُ تحمّلٍ يُعلن تزامناً غيرَ تزامن الإنتاج **يكذب**، والكذبُ صامت.
 *   فبدل نسخ الأرقام هنا، تُقرأ من `apps/worker/src/main.ts` وتُطابَق. تعديلٌ
 *   في الإنتاج بلا تعديلٍ هنا يُفشل الاختبار بصوتٍ عالٍ قبل أن يقيس شيئاً.
 */
const PROD_CONCURRENCY: Record<string, number> = {
  'ch-inbound': 10,
  'bot-reply': 3,
  'ch-outbound': 5,
};

/**
 * تشغيلٌ استكشافيّ: تزامنُ الردّ من البيئة بدل ٣.
 * ★ لماذا يستحقّ مفتاحاً: عنقُ الزجاجة الذي يقيسه هذا الاختبار هو الرقم ٣،
 *   لا العتاد. وتوصيةٌ برفعه بلا قياسٍ **رأي**؛ ومع قياسٍ **رقم**. والمفتاح
 *   يُعلن نفسه بصوتٍ عالٍ في المخرَج فلا يُقرأ رقمٌ استكشافيٌّ كرقمِ إنتاج.
 */
const SCALE_REPLY = Number(process.env.SCALE_REPLY ?? '0');

async function assertConcurrencyMatchesProd(): Promise<void> {
  const src = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const bad: string[] = [];
  for (const [queue, expect] of Object.entries(PROD_CONCURRENCY)) {
    if (queue === 'bot-reply' && SCALE_REPLY > 0) continue;
    const re = new RegExp(`new Worker\\('${queue}'[\\s\\S]{0,400}?concurrency:\\s*(\\d+)`);
    const m = re.exec(src);
    if (!m) { bad.push(`${queue}: لم أجد تزامنه في main.ts`); continue; }
    if (Number(m[1]) !== expect) bad.push(`${queue}: الإنتاج ${m[1]} والاختبار ${expect}`);
  }
  if (bad.length) {
    throw new Error(
      'تزامنُ العمّال في الاختبار لا يطابق الإنتاج — صحِّح PROD_CONCURRENCY:\n    ' + bad.join('\n    '),
    );
  }
  log('تزامنُ العمّال مطابقٌ لـmain.ts', PROD_CONCURRENCY);
  if (SCALE_REPLY > 0) {
    console.log(`\n  ⚠⚠ تشغيلٌ استكشافيّ: تزامنُ bot-reply = ${SCALE_REPLY} بدل `
      + `${PROD_CONCURRENCY['bot-reply']} — هذه الأرقام **لا تمثّل الإنتاج الحاليّ**.\n`);
  }
}

/* ───────────────────────── تهيئة المستأجر ───────────────────────── */

interface Ctx {
  tenantId: string;
  channelId: string;
  publicId: string;
  versionId: string | null;
}

async function prepareTenant(botEnabled: boolean): Promise<Ctx> {
  const db = getDb();
  return withPlatform(db, 'اختبار التحمّل: تهيئة مستأجرٍ تجريبيّ وقناةٍ ونسخةٍ منشورة', async (tx) => {
    let t = (await tx.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
    if (!t) {
      [t] = await tx.insert(tenants).values({
        slug: SLUG, name: `مستأجر اختبار التحمّل (${SLUG})`, status: 'active', publicId: publicId(),
      }).returning();
    }
    const tenantId = t!.id;
    if (LIVE_TENANTS.includes(t!.slug)) throw new Error('حارسٌ داخليّ: مستأجرٌ حقيقيّ — توقّف');

    const sealedToken = seal(FAKE_TOKEN);
    const sealedSecret = seal(APP_SECRET);
    let ch = (await tx.select().from(tenantChannels).where(and(
      eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud'),
    )).limit(1))[0];
    const chValues = {
      status: 'connected' as const,
      externalAccountId: `DRILL_${SLUG}`,
      displayName: 'قناة اختبار التحمّل (لا تصل إلى ميتا)',
      tokenEnc: sealedToken.enc,
      tokenFingerprint: fingerprint(FAKE_TOKEN),
      appSecretEnc: sealedSecret.enc,
      verifyToken: `drill-verify-${SLUG}`,
      keyVersion: sealedToken.keyVersion,
    };
    if (!ch) {
      [ch] = await tx.insert(tenantChannels)
        .values({ tenantId, kind: 'whatsapp_cloud', ...chValues }).returning();
    } else {
      await tx.update(tenantChannels).set(chValues).where(eq(tenantChannels.id, ch.id));
    }

    /* صفحةٌ بيضاء: بقايا تشغيلٍ سابقٍ تُخلط بنتيجة هذا التشغيل — والعدُّ هو الحكم. */
    await wipeTenant(tx, tenantId);

    let versionId: string | null = null;
    if (botEnabled) {
      const last = (await tx.select({ v: botVersions.version }).from(botVersions)
        .where(eq(botVersions.tenantId, tenantId)).orderBy(sql`version desc`).limit(1))[0];
      const [ver] = await tx.insert(botVersions).values({
        tenantId,
        version: (last?.v ?? 0) + 1,
        persona: 'أنت موظّف خدمة زبائن لمحلّ تمرين. أجب بسطرٍ واحدٍ قصير.',
        knowledgeBase: 'ساعات العمل من ٩ صباحاً إلى ٥ مساءً.',
        provider: PROVIDER,
        model: MODEL,
        /* `full` عمداً: لا تضمينَ ولا استرجاعَ — القياسُ لمسار الردّ لا للمعرفة. */
        knowledgeMode: 'full',
        embedStatus: 'skipped',
        publishedAt: new Date(),
        note: 'اختبار التحمّل',
      }).returning();
      versionId = ver!.id;
    }

    const cfg = (await tx.select().from(botConfigs)
      .where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
    const cfgValues = { enabled: botEnabled, publishedVersionId: versionId };
    if (!cfg) await tx.insert(botConfigs).values({ tenantId, ...cfgValues });
    else await tx.update(botConfigs).set(cfgValues).where(eq(botConfigs.tenantId, tenantId));

    return { tenantId, channelId: ch!.id, publicId: t!.publicId, versionId };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** حذفُ أثر التمرين — بالترتيب العكسيّ للمراجع. */
async function wipeTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.delete(aiRuns).where(eq(aiRuns.tenantId, tenantId));
  await tx.delete(incidents).where(eq(incidents.tenantId, tenantId));
  await tx.delete(messages).where(eq(messages.tenantId, tenantId));
  await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, tenantId));
  await tx.delete(conversations).where(eq(conversations.tenantId, tenantId));
  await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, tenantId));
  await tx.delete(contacts).where(eq(contacts.tenantId, tenantId));
}

/* ───────────────────── الـAPI عمليّةٌ منفصلة كما في الإنتاج ───────────────────── */

async function startLocalApi(): Promise<ChildProcess> {
  const entry = new URL('../../api/src/main.ts', import.meta.url).pathname;
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const show = (prefix: string) => (buf: Buffer) => {
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      if (process.env.API_LOG === '1' || /"level":(40|50|60)/.test(line)) {
        console.log(`    [api${prefix}] ${line.slice(0, 300)}`);
      }
    }
  };
  child.stdout?.on('data', show(''));
  child.stderr?.on('data', show('!'));

  const url = `http://127.0.0.1:${LOCAL_API_PORT}/api/health`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`api الاختبار خرج برمز ${child.exitCode}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const body = await res.text();
      if (res.ok && body.includes('"service":"aibot"')) {
        log('api الاختبار حيّ', { port: LOCAL_API_PORT, health: body.slice(0, 120) });
        return child;
      }
    } catch { /* لم يُقلع بعد */ }
    await sleep(500);
  }
  throw new Error('api الاختبار لم يُقلع في ٩٠ ثانية');
}

/* ───────────────────────── العمّال المُراقَبون ───────────────────────── */

interface Marks {
  phone: string;
  wa: string;
  externalId: string;
  t0: number;
  ack?: number;
  status?: number;
  stored?: number;
  sent?: number;
}

interface Harness {
  marks: Map<string, Marks>;
  byExternalId: Map<string, string>;
  replyRuns: Map<string, { start: number; end?: number; err?: string }>;
  inboundJobs: number;
  close(): Promise<void>;
}

async function startWorkers(conn: IORedis, state: Harness): Promise<Array<{ close(): Promise<void> }>> {
  const { handleInbound } = await import('../src/inbound.js');
  const { handleReply } = await import('../src/reply.js');
  const { sendOutbound } = await import('../src/outbound.js');

  const inbound = new Worker('ch-inbound', async (job) => {
    const data = job.data as { parsed?: { messages?: Array<{ externalId: string }> } };
    await handleInbound(job.data as Parameters<typeof handleInbound>[0]);
    const at = Date.now();
    state.inboundJobs += 1;
    for (const m of data.parsed?.messages ?? []) {
      const phone = state.byExternalId.get(m.externalId);
      const mark = phone ? state.marks.get(phone) : undefined;
      if (mark && mark.stored === undefined) mark.stored = at;
    }
  }, { connection: conn, concurrency: PROD_CONCURRENCY['ch-inbound']! });

  const reply = new Worker('bot-reply', async (job) => {
    const convId = String((job.data as { conversationId?: string }).conversationId ?? '');
    const rec = { start: Date.now() } as { start: number; end?: number; err?: string };
    state.replyRuns.set(`${convId}#${job.attemptsMade}`, rec);
    try {
      await handleReply(job.data as Parameters<typeof handleReply>[0]);
      rec.end = Date.now();
    } catch (e) {
      rec.end = Date.now();
      rec.err = (e as Error).message;
      throw e;
    }
  }, { connection: conn, concurrency: SCALE_REPLY > 0 ? SCALE_REPLY : PROD_CONCURRENCY['bot-reply']! });

  const outbound = new Worker('ch-outbound', async (job) => {
    await sendOutbound(job.data as Parameters<typeof sendOutbound>[0]);
  }, {
    connection: conn,
    concurrency: PROD_CONCURRENCY['ch-outbound']!,
    limiter: { max: 10, duration: 1000 },
  });

  for (const w of [inbound, reply, outbound]) {
    w.on('failed', (job, err) => {
      console.log(`    ⚠ فشل ${w.name}#${job?.id ?? '?'} (شوط ${job?.attemptsMade ?? 0}): ${err?.message}`);
    });
  }
  return [inbound, reply, outbound];
}

/* ───────────────────────────── العيّنات ───────────────────────────── */

interface Sample {
  at: number;
  depths: Record<string, { waiting: number; active: number; delayed: number; failed: number }>;
  sent: number;
  pgSessions: number;
  pgActive: number;
  pgLockWaits: number;
  pgMaxLockWaitS: number;
  pgUngranted: number;
  samplerMs: number;
  load1: number;
  rssMb: number;
}

const QUEUES = ['ch-inbound', 'bot-reply', 'ch-outbound'] as const;

async function takeSample(queues: Queue[], sentCount: () => number): Promise<Sample> {
  const t = Date.now();
  const depths: Sample['depths'] = {};
  for (const q of queues) {
    const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
    depths[q.name] = {
      waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0,
    };
  }
  let pg = { sessions: 0, active: 0, lockWaits: 0, maxWait: 0, ungranted: 0 };
  try {
    const rows = await getDb().execute(sql`
      select
        (select count(*)::int from pg_stat_activity where datname = current_database()) as sessions,
        (select count(*)::int from pg_stat_activity
           where datname = current_database() and state = 'active') as active,
        (select count(*)::int from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock') as lock_waits,
        (select coalesce(max(extract(epoch from (now() - state_change))), 0)::float8
           from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock') as max_wait,
        (select count(*)::int from pg_locks where not granted) as ungranted
    `) as unknown as Array<{
      sessions: number; active: number; lock_waits: number; max_wait: number; ungranted: number;
    }>;
    const r = rows[0];
    if (r) {
      pg = {
        sessions: Number(r.sessions), active: Number(r.active), lockWaits: Number(r.lock_waits),
        maxWait: Number(r.max_wait), ungranted: Number(r.ungranted),
      };
    }
  } catch { /* عيّنةٌ ضائعة لا تُسقط الضخّ */ }

  return {
    at: t,
    depths,
    sent: sentCount(),
    pgSessions: pg.sessions,
    pgActive: pg.active,
    pgLockWaits: pg.lockWaits,
    pgMaxLockWaitS: pg.maxWait,
    pgUngranted: pg.ungranted,
    samplerMs: Date.now() - t,
    load1: loadavg()[0] ?? 0,
    rssMb: process.memoryUsage().rss / 1048576,
  };
}

async function deadlockCount(): Promise<number> {
  try {
    const rows = await getDb().execute(sql`
      select deadlocks::int as n from pg_stat_database where datname = current_database()
    `) as unknown as Array<{ n: number }>;
    return Number(rows[0]?.n ?? -1);
  } catch { return -1; }
}

/* ───────────────────────────── الضخّ ───────────────────────────── */

interface LevelResult {
  conv: number;
  samples: Sample[];
  marks: Marks[];
  sends: Map<string, number[]>;
  elapsedMs: number;
  rows: ConvRow[];
  inboundJobs: number;
  aiCalls: number;
  failed: Record<string, number>;
  deadlockDelta: number;
  verdicts: Array<{ ok: boolean; label: string; detail: string }>;
}

interface ConvRow {
  conv_id: string; phone: string;
  ins: number; outs: number; wins: number; open_wins: number; billed_wins: number;
  win_in: number; win_out: number; runs: number;
}

async function readConvRows(tenantId: string): Promise<ConvRow[]> {
  const rows = await withTenant(getDb(), tenantId, (tx) => tx.execute(sql`
    select
      c.id::text as conv_id,
      ci.external_id as phone,
      (select count(*)::int from messages m
         where m.conversation_id = c.id and m.direction = 'in') as ins,
      (select count(*)::int from messages m
         where m.conversation_id = c.id and m.direction = 'out') as outs,
      (select count(*)::int from conversation_windows w where w.conversation_id = c.id) as wins,
      (select count(*)::int from conversation_windows w
         where w.conversation_id = c.id and w.closed_at is null) as open_wins,
      (select count(*)::int from conversation_windows w
         where w.conversation_id = c.id and w.billed_at is not null) as billed_wins,
      (select coalesce(sum(w.messages_in), 0)::int from conversation_windows w
         where w.conversation_id = c.id) as win_in,
      (select coalesce(sum(w.messages_out), 0)::int from conversation_windows w
         where w.conversation_id = c.id) as win_out,
      (select count(*)::int from ai_runs r where r.conversation_id = c.id) as runs
    from conversations c
    join channel_identities ci on ci.id = c.identity_id
    where c.tenant_id = ${tenantId}
    order by ci.external_id
  `)) as unknown as ConvRow[];
  return rows.map((r) => ({
    ...r,
    ins: Number(r.ins), outs: Number(r.outs), wins: Number(r.wins),
    open_wins: Number(r.open_wins), billed_wins: Number(r.billed_wins),
    win_in: Number(r.win_in), win_out: Number(r.win_out), runs: Number(r.runs),
  }));
}

async function runLevel(o: {
  level: number; conv: number; ctx: Ctx; queues: Queue[]; state: Harness;
  stubs: Stubs | null; webhookUrl: string; expectReply: boolean;
}): Promise<LevelResult> {
  const { conv, ctx, queues, state, stubs, webhookUrl, expectReply } = o;

  /* صفحةٌ بيضاء لكلّ مستوى — والعدُّ هو الحكم. */
  await withPlatform(getDb(), 'اختبار التحمّل: تفريغ المستأجر قبل المستوى', (tx) => wipeTenant(tx, ctx.tenantId));
  state.marks.clear();
  state.byExternalId.clear();
  state.replyRuns.clear();
  state.inboundJobs = 0;
  stubs?.sends.clear();
  const aiBefore = stubs?.aiCalls ?? 0;
  const dlBefore = await deadlockCount();
  /* الفاشلاتُ تتراكم في الطابور — فالمقيس هو الفرق لا المجموع. */
  const failedBefore: Record<string, number> = {};
  for (const q of queues) failedBefore[q.name] = (await q.getJobCounts('failed')).failed ?? 0;

  const samples: Sample[] = [];
  const sentCount = (): number => {
    if (!stubs) return 0;
    let n = 0;
    for (const list of stubs.sends.values()) n += list.length;
    return n;
  };
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      samples.push(await takeSample(queues, sentCount));
      await sleep(SAMPLE_MS);
    }
  })();

  /* ① الضخّ — دفعةٌ واحدةٌ متزامنة، لا تتابعٌ مُقنَّع. */
  const t0All = Date.now();
  await Promise.all(Array.from({ length: conv }, async (_unused, i) => {
    const { wa, stored } = phonePair(o.level, i);
    const externalId = `wamid.LOAD-${RUN_ID}-L${o.level}-${i}`;
    const body = metaPayload({
      phoneNumberId: `DRILL_${SLUG}`,
      wa,
      externalId,
      name: `زبون تحمّل ${i + 1}`,
      text: `مرحبا، بدّي أعرف ساعات العمل. (${i + 1})`,
    });
    const mark: Marks = { phone: stored, wa, externalId, t0: Date.now() };
    state.marks.set(stored, mark);
    state.byExternalId.set(externalId, stored);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature(body, APP_SECRET),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      await res.text();
      mark.ack = Date.now();
      mark.status = res.status;
    } catch (e) {
      mark.status = -1;
      log(`⚠ فشل POST للرقم ${stored}: ${(e as Error).message}`);
    }
  }));
  const pumpMs = Date.now() - t0All;
  log(`ضُخَّت ${conv} محادثة متزامنة في ${pumpMs}ms`,
    { ack2xx: [...state.marks.values()].filter((m) => m.status === 200).length });

  /* ② الاستواء: ننتظر ظهور الردّ الصادر لكلّ محادثة — أو مهلة. */
  const deadline = Date.now() + SETTLE_MS;
  let lastProgress = Date.now();
  let seen = 0;
  while (Date.now() < deadline) {
    await sleep(250);
    if (expectReply && stubs) {
      const n = stubs.sends.size;
      if (n !== seen) { seen = n; lastProgress = Date.now(); }
      if (n >= conv) break;
    } else {
      /* البوت مطفأ: نهايةُ القياس هي وصولُ الوارد إلى القاعدة.
         دقّةُ ٢٥٠ms مُعلَنة — لا أدقّ في مكدسٍ لا نملك عمّاله. */
      await pollStored(ctx.tenantId, state);
      const n = [...state.marks.values()].filter((m) => m.stored !== undefined).length;
      if (n !== seen) { seen = n; lastProgress = Date.now(); }
      if (n >= conv) break;
    }
    if (Date.now() - lastProgress > 60_000) {
      log('⚠ ٦٠ ثانية بلا تقدّم — أُنهي الانتظار وأُبلّغ بما وقع');
      break;
    }
  }

  /* ③ الانحسار: نُكمل المراقبة — وأيُّ ردٍّ ثانٍ يصل الآن هو ردٌّ مكرَّر. */
  await sleep(DRAIN_MS);
  sampling = false;
  await sampler;

  /* ④ ما وقع في القاعدة فعلاً. */
  if (stubs) {
    for (const [to, list] of stubs.sends) {
      const mark = state.marks.get(to);
      if (mark && list.length) mark.sent = Math.min(...list);
    }
  }
  const rows = await readConvRows(ctx.tenantId);
  const failed: Record<string, number> = {};
  for (const q of queues) {
    failed[q.name] = ((await q.getJobCounts('failed')).failed ?? 0) - (failedBefore[q.name] ?? 0);
  }

  return {
    conv,
    samples,
    marks: [...state.marks.values()],
    sends: new Map(stubs ? [...stubs.sends] : []),
    elapsedMs: Date.now() - t0All,
    rows,
    inboundJobs: state.inboundJobs,
    aiCalls: (stubs?.aiCalls ?? 0) - aiBefore,
    failed,
    deadlockDelta: (await deadlockCount()) - dlBefore,
    verdicts: [],
  };
}

/** في مكدس الإنتاج لا عامل في أيدينا — فالوصولُ يُلتقط بالاستقصاء. */
async function pollStored(tenantId: string, state: Harness): Promise<void> {
  const ids = [...state.marks.values()].filter((m) => m.stored === undefined).map((m) => m.externalId);
  if (!ids.length) return;
  const rows = await withTenant(getDb(), tenantId, (tx) => tx.execute(sql`
    select external_id from messages
     where tenant_id = ${tenantId} and direction = 'in'
       and external_id = any(${sql.raw(`array[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')}]`)})
  `)) as unknown as Array<{ external_id: string }>;
  const at = Date.now();
  for (const r of rows) {
    const phone = state.byExternalId.get(r.external_id);
    const mark = phone ? state.marks.get(phone) : undefined;
    if (mark && mark.stored === undefined) mark.stored = at;
  }
}

/* ───────────────────── حُقنةُ النافذة المزدوجة ───────────────────── */

interface BurstResult {
  ran: boolean;
  phone: string;
  fired: number;
  storedMsgs: number;
  openWindows: number;
  totalWindows: number;
  billedWindows: number;
  ok: boolean;
  note: string;
}

async function burstProbe(o: {
  ctx: Ctx; state: Harness; webhookUrl: string; stubs: Stubs | null;
}): Promise<BurstResult> {
  const out: BurstResult = {
    ran: false, phone: '', fired: BURST, storedMsgs: 0,
    openWindows: 0, totalWindows: 0, billedWindows: 0, ok: false, note: '',
  };
  if (BURST < 2) { out.note = 'مُتخطّاة (BURST < 2)'; return out; }

  const db = getDb();
  /* محادثةٌ واحدة قائمةٌ من المستوى السابق، ونافذتُها **مغلقة** — وهي الحالة
     التي تُنتجها صيانةُ `closeExpiredWindows` كلَّ عشر دقائق. */
  const pick = await withTenant(db, o.ctx.tenantId, (tx) => tx.execute(sql`
    select c.id::text as conv_id, ci.external_id as phone
      from conversations c
      join channel_identities ci on ci.id = c.identity_id
     where c.tenant_id = ${o.ctx.tenantId}
     order by ci.external_id
     limit 1
  `)) as unknown as Array<{ conv_id: string; phone: string }>;
  const target = pick[0];
  if (!target) { out.note = 'لا محادثةً باقيةً للحقن'; return out; }

  out.ran = true;
  out.phone = target.phone;
  await withPlatform(db, 'اختبار التحمّل: إغلاق نافذة المحادثة كما تفعل الصيانة', (tx) => tx.execute(sql`
    update conversation_windows set closed_at = now()
     where conversation_id = ${target.conv_id} and closed_at is null
  `));

  const wa = `962${target.phone.slice(1)}`;
  const ids: string[] = [];
  await Promise.all(Array.from({ length: BURST }, async (_u, i) => {
    const externalId = `wamid.BURST-${RUN_ID}-${i}`;
    ids.push(externalId);
    const body = metaPayload({
      phoneNumberId: `DRILL_${SLUG}`, wa, externalId,
      name: 'زبون الحقنة', text: `سطر ${i + 1} — رسائل متزامنة على نفس المحادثة`,
    });
    const mark: Marks = { phone: target.phone, wa, externalId, t0: Date.now() };
    o.state.byExternalId.set(externalId, `burst-${i}`);
    o.state.marks.set(`burst-${i}`, mark);
    const res = await fetch(o.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature(body, APP_SECRET) },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    await res.text();
  }));

  /* انتظارُ استواء: الرسائل تُخزَّن، ثمّ الردُّ الواحد بعد الدمج. */
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(500);
    const st = await withTenant(db, o.ctx.tenantId, (tx) => tx.execute(sql`
      select
        (select count(*)::int from messages
           where conversation_id = ${target.conv_id} and direction = 'in') as ins,
        (select count(*)::int from conversation_windows
           where conversation_id = ${target.conv_id} and closed_at is null) as open_wins
    `)) as unknown as Array<{ ins: number; open_wins: number }>;
    if (Number(st[0]?.ins ?? 0) >= BURST + 1) break;
  }
  await sleep(4000);

  const st = await withTenant(db, o.ctx.tenantId, (tx) => tx.execute(sql`
    select
      (select count(*)::int from messages
         where conversation_id = ${target.conv_id} and direction = 'in') as ins,
      (select count(*)::int from conversation_windows
         where conversation_id = ${target.conv_id}) as wins,
      (select count(*)::int from conversation_windows
         where conversation_id = ${target.conv_id} and closed_at is null) as open_wins,
      (select count(*)::int from conversation_windows
         where conversation_id = ${target.conv_id} and billed_at is not null
           and closed_at is null) as billed_open
  `)) as unknown as Array<{ ins: number; wins: number; open_wins: number; billed_open: number }>;
  const r = st[0]!;
  out.storedMsgs = Number(r.ins);
  out.totalWindows = Number(r.wins);
  out.openWindows = Number(r.open_wins);
  out.billedWindows = Number(r.billed_open);
  out.ok = out.openWindows === 1;
  out.note = out.ok
    ? 'نافذةٌ مفتوحةٌ واحدة — القيدُ الجزئيّ (أو التسلسل) صانَ الفوترة'
    : `${out.openWindows} نافذةٍ مفتوحةٍ لمحادثةٍ واحدة — فوترةٌ مزدوجةٌ في نفس الـ٢٤ ساعة`;
  return out;
}

/* ───────────────────────────── التقرير ───────────────────────────── */

function judge(res: LevelResult, expectReply: boolean, stubs: Stubs | null): void {
  const v = res.verdicts;
  const acks = res.marks.filter((m) => m.status === 200).length;
  v.push({
    ok: acks === res.conv,
    label: 'بوّابة الويبهوك ردّت 200 لكلّ ندءٍ',
    detail: `${acks}/${res.conv}`,
  });

  const stored = res.rows.reduce((n, r) => n + r.ins, 0);
  v.push({
    ok: stored === res.conv && res.rows.length === res.conv,
    label: 'صفر رسالةٍ ضائعة',
    detail: `${stored} رسالة في ${res.rows.length} محادثة (المتوقَّع ${res.conv}/${res.conv})`,
  });

  if (expectReply) {
    const outs = res.rows.reduce((n, r) => n + r.outs, 0);
    const dupConv = res.rows.filter((r) => r.outs > 1).length;
    const noneConv = res.rows.filter((r) => r.outs === 0).length;
    v.push({
      ok: outs === res.conv && dupConv === 0 && noneConv === 0,
      label: 'ردٌّ واحدٌ لكلّ محادثة — صفر مكرَّر وصفر مفقود',
      detail: `${outs} ردّاً · محادثاتٌ بردَّين ${dupConv} · بلا ردّ ${noneConv}`,
    });

    let dupSends = 0;
    for (const list of res.sends.values()) if (list.length > 1) dupSends += 1;
    v.push({
      ok: res.sends.size === res.conv && dupSends === 0,
      label: 'القناة استلمت إرسالاً واحداً لكلّ رقم',
      detail: `${res.sends.size} رقماً · بإرسالَين ${dupSends} · أشواطُ مزوّدٍ ${res.aiCalls}`,
    });

    const runs = res.rows.reduce((n, r) => n + r.runs, 0);
    v.push({
      ok: runs === res.conv,
      label: 'شوطُ نموذجٍ واحدٌ لكلّ محادثة (لا نداءَ مُهدَر)',
      detail: `${runs} شوطاً`,
    });

    const billed = res.rows.filter((r) => r.billed_wins === 1).length;
    const overBilled = res.rows.filter((r) => r.billed_wins > 1).length;
    const manyWins = res.rows.filter((r) => r.wins > 1).length;
    v.push({
      ok: billed === res.conv && overBilled === 0 && manyWins === 0,
      label: 'نافذةٌ واحدةٌ مفوترةٌ مرّةً واحدةً لكلّ محادثة',
      detail: `مفوترة ${billed} · مفوترةٌ مرّتين ${overBilled} · محادثاتٌ بنافذتَين ${manyWins}`,
    });

    const winOut = res.rows.reduce((n, r) => n + r.win_out, 0);
    v.push({
      ok: winOut === res.conv,
      label: 'عدّادُ صادرِ النافذة يطابق الردود',
      detail: `${winOut} (المتوقَّع ${res.conv})`,
    });
  }

  const failedTotal = Object.values(res.failed).reduce((a, b) => a + b, 0);
  v.push({
    ok: failedTotal === 0,
    label: 'صفر مهمّةٍ فاشلة في الطوابير',
    detail: Object.entries(res.failed).map(([k, n]) => `${k}=${n}`).join(' · '),
  });

  const maxLock = Math.max(0, ...res.samples.map((s) => s.pgMaxLockWaitS));
  const maxUngranted = Math.max(0, ...res.samples.map((s) => s.pgUngranted));
  v.push({
    ok: res.deadlockDelta === 0,
    label: 'صفر deadlock في Postgres',
    detail: `Δdeadlocks=${res.deadlockDelta} · أطولُ انتظارِ قفلٍ ${maxLock.toFixed(2)}s · أقفالٌ غيرُ ممنوحة ${maxUngranted}`,
  });

  if (stubs) {
    v.push({
      ok: true,
      label: 'إشعاراتُ القراءة إلى القناة',
      detail: `${stubs.reads}`,
    });
  }
}

function reportLevel(res: LevelResult, expectReply: boolean): void {
  const lat = (pick: (m: Marks) => number | undefined): number[] =>
    res.marks.map((m) => { const x = pick(m); return x === undefined ? NaN : x - m.t0; })
      .filter((n) => Number.isFinite(n));

  const ack = lat((m) => m.ack);
  const stored = lat((m) => m.stored);
  const sent = expectReply ? lat((m) => m.sent) : [];
  const end = expectReply ? sent : stored;

  console.log(`\n  ── ${res.conv} محادثة متزامنة ─────────────────────────────`);
  console.log(`  زمنٌ كلّيّ حتّى آخر ردّ: ${(res.elapsedMs / 1000).toFixed(1)}s`
    + `   خرجٌ فعليّ: ${(end.length / (res.elapsedMs / 1000)).toFixed(2)} ردّ/ث`);
  const line = (name: string, xs: number[]): void => {
    if (!xs.length) { console.log(`  ${pad(name, 26)} —`); return; }
    console.log(`  ${pad(name, 26)} وسيط ${padStart(num(pct(xs, 50)), 6)}ms`
      + `  ٩٥٪ ${padStart(num(pct(xs, 95)), 6)}ms`
      + `  الأسوأ ${padStart(num(Math.max(...xs)), 6)}ms`
      + `  (${xs.length})`);
  };
  line('إقرار 200 من البوّابة', ack);
  line('حتّى تخزين الوارد', stored);
  if (expectReply) line('حتّى وصول الردّ للقناة', sent);

  if (expectReply) {
    const gap = res.marks
      .filter((m) => m.sent !== undefined && m.stored !== undefined)
      .map((m) => m.sent! - m.stored!);
    line('طابورُ الردّ + الدمج + النموذج', gap);
  }

  /* رسمٌ نصّيّ: عمقُ الطوابير والردودُ المكتملة عبر الزمن. */
  const t0 = res.samples[0]?.at ?? Date.now();
  const maxDepth = Math.max(1, ...res.samples.map((s) =>
    Math.max(...QUEUES.map((q) => {
      const d = s.depths[q];
      return d ? d.waiting + d.active + d.delayed : 0;
    }))));
  console.log('\n  عمقُ الطوابير عبر الزمن (و=منتظرة ن=نشطة ج=مؤجَّلة):');
  console.log(`  ${pad('ث', 6)}${pad('ch-inbound', 14)}${pad('bot-reply', 14)}`
    + `${pad('صادر', 7)}${pad('جلسات pg', 10)}${pad('قفل', 5)}حملُ المضيف`);
  const step = Math.max(1, Math.ceil(res.samples.length / 40));
  res.samples.forEach((s, i) => {
    if (i % step !== 0 && i !== res.samples.length - 1) return;
    const inb = s.depths['ch-inbound'];
    const rep = s.depths['bot-reply'];
    const dIn = inb ? inb.waiting + inb.active + inb.delayed : 0;
    const dRp = rep ? rep.waiting + rep.active + rep.delayed : 0;
    console.log(`  ${pad(((s.at - t0) / 1000).toFixed(1), 6)}`
      + pad(`${padStart(String(dIn), 3)} ${bar(dIn, maxDepth, 9)}`, 14)
      + pad(`${padStart(String(dRp), 3)} ${bar(dRp, maxDepth, 9)}`, 14)
      + pad(String(s.sent), 7)
      + pad(`${s.pgActive}/${s.pgSessions}`, 10)
      + pad(String(s.pgLockWaits), 5)
      + `${s.load1.toFixed(2)}  rss ${s.rssMb.toFixed(0)}MB`
      + (s.samplerMs > 500 ? `  ⚠ العيّنة ${s.samplerMs}ms` : ''));
  });

  const tail = res.samples[res.samples.length - 1];
  if (tail) {
    const left = QUEUES.reduce((n, q) => {
      const d = tail.depths[q];
      return n + (d ? d.waiting + d.active + d.delayed : 0);
    }, 0);
    console.log(`  انحسارٌ بعد التوقّف: ${left === 0 ? 'نعم — الطوابير صفر' : `لا — بقي ${left}`}`);
  }

  console.log('');
  for (const v of res.verdicts) {
    console.log(`  ${v.ok ? '✅' : '❌'} ${pad(v.label, 44)} ${v.detail}`);
  }
}

/* ───────────────────────────── main ───────────────────────────── */

async function main(): Promise<void> {
  const baseRedis = process.env.REDIS_URL;
  if (!baseRedis) throw new Error('REDIS_URL غير مضبوط');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL غير مضبوط');

  console.log(`\n▶ اختبار التحمّل — مكدس ${STACK} · مستويات ${LEVELS.join(',')}`
    + ` · مزوّدٌ وهميّ ${PROVIDER_MS}±${PROVIDER_JITTER_MS}ms · Graph وهميّ ${GRAPH_MS}ms`);
  console.log(`  المضيف: ${cpus().length} نواة · حملٌ قبل البدء ${loadavg().map((n) => n.toFixed(2)).join(' ')}\n`);

  let stubs: Stubs | null = null;
  let api: ChildProcess | null = null;
  let conn: IORedis | null = null;
  let queues: Queue[] = [];
  let workers: Array<{ close(): Promise<void> }> = [];
  let ctx: Ctx | null = null;
  const results: LevelResult[] = [];
  let burst: BurstResult | null = null;
  const rss0 = process.memoryUsage().rss;

  const state: Harness = {
    marks: new Map(), byExternalId: new Map(), replyRuns: new Map(),
    inboundJobs: 0, close: async () => undefined,
  };

  try {
    const expectReply = STACK === 'own';
    ctx = await prepareTenant(expectReply);
    log('المستأجر التجريبيّ جاهز', {
      slug: SLUG, tenantId: ctx.tenantId, publicId: ctx.publicId,
      bot: expectReply ? `مفعَّل على ${MODEL}` : 'مطفأ',
    });

    let webhookUrl: string;
    if (STACK === 'own') {
      await assertConcurrencyMatchesProd();
      stubs = await startStubs();
      /* ⚠️ الترتيب شرط: `GRAPH_BASE` و`GOOGLE_AI_BASE` تُقرآن **مرّةً** عند
         تحميل الوحدة، فضبطُهما يجب أن يسبق أيَّ استيرادٍ لها — ولذلك
         استيرادُ العمّال ديناميكيّ، ولا تُستورد `@aibot/channels` في الرأس. */
      process.env.GRAPH_BASE = stubs.graphBase;
      process.env.GOOGLE_AI_BASE = stubs.aiBase;
      process.env.REDIS_URL = (() => { const u = new URL(baseRedis); u.pathname = `/${REDIS_DB}`; return u.toString(); })();
      process.env.PORT = String(LOCAL_API_PORT);
      process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
      log('البديلان الوهميّان يعملان', { graph: stubs.graphBase, ai: stubs.aiBase });

      conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
      if (conn.options.db !== REDIS_DB || REDIS_DB === 0) {
        throw new Error(`حارسُ العزل: قاعدةُ ريدِس ${conn.options.db} ليست ${REDIS_DB}`);
      }
      await conn.flushdb();
      log('قاعدةُ طوابيرٍ معزولةٌ ونظيفة', { redisDb: REDIS_DB });

      queues = QUEUES.map((n) => new Queue(n, { connection: conn! }));
      workers = await startWorkers(conn, state);
      api = await startLocalApi();
      webhookUrl = `http://127.0.0.1:${LOCAL_API_PORT}/api/webhooks/wa/${ctx.publicId}`;
    } else {
      conn = new IORedis(baseRedis, { maxRetriesPerRequest: null, enableReadyCheck: false });
      queues = QUEUES.map((n) => new Queue(n, { connection: conn! }));
      webhookUrl = `${PROD_API_URL}/api/webhooks/wa/${ctx.publicId}`;
      log('مكدس الإنتاج — البوت مطفأ، والقياسُ حتّى تخزين الوارد', { webhookUrl });
    }

    for (const [idx, conv] of LEVELS.entries()) {
      const res = await runLevel({
        level: idx + 1, conv, ctx, queues, state, stubs, webhookUrl, expectReply,
      });
      judge(res, expectReply, stubs);
      reportLevel(res, expectReply);
      results.push(res);
      if (idx < LEVELS.length - 1) await sleep(2000);
    }

    burst = await burstProbe({ ctx, state, webhookUrl, stubs });
    console.log('\n  ── حُقنةُ النافذة المزدوجة ─────────────────────────────');
    if (!burst.ran) {
      console.log(`  ⓘ ${burst.note}`);
    } else {
      console.log(`  ${BURST} رسالةً متزامنةً على محادثةٍ واحدة نافذتُها مغلقة (${burst.phone})`);
      console.log(`  رسائلُ الوارد: ${burst.storedMsgs}   نوافذُ المحادثة: ${burst.totalWindows}`
        + `   منها مفتوحة: ${burst.openWindows}   ومفتوحةٌ مفوترة: ${burst.billedWindows}`);
      console.log(`  ${burst.ok ? '✅' : '❌'} ${burst.note}`);
    }

    /* الذاكرة بعد الانتهاء: تسرّبٌ يعني رقماً لا يعود. */
    const rss1 = process.memoryUsage().rss;
    await sleep(3000);
    const rss2 = process.memoryUsage().rss;
    console.log('\n  ── الذاكرة والمعالج (عمليّةُ العمّال) ─────────────────');
    console.log(`  RSS قبل ${(rss0 / 1048576).toFixed(0)}MB · بعد الضخّ ${(rss1 / 1048576).toFixed(0)}MB`
      + ` · بعد ٣ ثوانٍ سكون ${(rss2 / 1048576).toFixed(0)}MB`);
    const cpu = process.cpuUsage();
    console.log(`  CPU للعمليّة: مستخدم ${(cpu.user / 1e6).toFixed(1)}s · نظام ${(cpu.system / 1e6).toFixed(1)}s`);
    console.log(`  حملُ المضيف الآن: ${loadavg().map((n) => n.toFixed(2)).join(' ')}`);

    /* ملخّصُ المستويات — منه يُقرأ حدُّ التدهور. */
    console.log('\n  ── الملخّص ───────────────────────────────────────────');
    console.log(`  ${pad('محادثات', 9)}${pad('وسيط', 9)}${pad('٩٥٪', 9)}${pad('الأسوأ', 9)}`
      + `${pad('خرج/ث', 8)}${pad('أقصى عمقٍ للردّ', 16)}${pad('قفل', 6)}الحكم`);
    for (const r of results) {
      const end = expectReply
        ? r.marks.filter((m) => m.sent !== undefined).map((m) => m.sent! - m.t0)
        : r.marks.filter((m) => m.stored !== undefined).map((m) => m.stored! - m.t0);
      const maxRep = Math.max(0, ...r.samples.map((s) => {
        const d = s.depths['bot-reply'];
        return d ? d.waiting + d.active + d.delayed : 0;
      }));
      const okAll = r.verdicts.every((v) => v.ok);
      console.log(`  ${pad(String(r.conv), 9)}`
        + pad(num(pct(end, 50)), 9) + pad(num(pct(end, 95)), 9)
        + pad(num(Math.max(0, ...end)), 9)
        + pad((end.length / (r.elapsedMs / 1000)).toFixed(2), 8)
        + pad(String(maxRep), 16)
        + pad(Math.max(0, ...r.samples.map((s) => s.pgLockWaits)).toString(), 6)
        + (okAll ? '✅ صحيح' : '❌ خلل'));
    }

    const allOk = results.every((r) => r.verdicts.every((v) => v.ok))
      && (burst === null || !burst.ran || burst.ok);
    console.log('');
    console.log(allOk
      ? '✅ اجتاز الاختبار — لا رسالةَ ضائعة ولا ردَّ مكرَّر ولا نافذةَ مزدوجة'
      : '❌ الاختبار كشف خللاً — راجع الأسطر المُعلَّمة ❌ أعلاه');
    process.exitCode = allOk ? 0 : 1;
  } finally {
    /* التنظيف — أوّلاً العمّال (فلا تُستأنف مهمّةٌ على بياناتٍ نحذفها). */
    for (const w of workers) await w.close().catch(() => undefined);
    if (api) {
      api.kill('SIGTERM');
      const gone = await Promise.race([
        new Promise<boolean>((r) => api!.once('exit', () => r(true))),
        sleep(4000).then(() => false),
      ]);
      if (!gone) api.kill('SIGKILL');
    }
    await stubs?.close().catch(() => undefined);
    if (ctx) {
      await withPlatform(getDb(), 'اختبار التحمّل: حذف أثر الضخّ وإطفاء البوت', async (tx) => {
        await tx.update(botConfigs).set({ enabled: false, publishedVersionId: null })
          .where(eq(botConfigs.tenantId, ctx!.tenantId));
        await wipeTenant(tx, ctx!.tenantId);
        await tx.delete(botVersions).where(eq(botVersions.tenantId, ctx!.tenantId));
      }).catch((e) => log(`⚠ تعذّر التنظيف: ${(e as Error).message}`));
      log('نُظّف أثرُ الضخّ، والبوت التجريبيّ مطفأ (المستأجر يبقى لتشغيلٍ لاحق)');
    }
    for (const q of queues) await q.close().catch(() => undefined);
    if (STACK === 'own' && conn && conn.options.db === REDIS_DB && REDIS_DB !== 0) {
      await conn.flushdb().catch(() => undefined);
    }
    await conn?.quit().catch(() => undefined);
    await closeDb().catch(() => undefined);
  }
}

/**
 * ⚠️ خروجٌ صريح. `tsx` يُبقي خادمَ esbuild ابناً للعمليّة، فحلقةُ الأحداث لا
 *    تفرغ و`docker compose run` يبقى معلّقاً إلى الأبد **بعد** طبع الحكم — وقع
 *    فعلاً في أوّل تشغيل، والمخرَج كامل والحاوية حيّة. ولذلك تخرج كلّ تمارين
 *    هذا المجلّد صريحةً.
 */
main()
  .then(() => { process.exit(process.exitCode ?? 0); })
  .catch(async (e) => {
    console.error('\n❌ فشل اختبار التحمّل:', (e as Error).message);
    console.error((e as Error).stack);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
