/**
 * تمرين الفشل (د): **مزوّد النموذج يعيد ٥٠٠.**
 *
 * الحقنة: `AI_FAULT_STATUS=500` في `packages/ai/src/google.ts` — تصنع **ردّاً**
 * بالحالة المطلوبة ويمرّ عبر نفس مسار التحويل إلى `AiError`، فالمقيس هو تعامل
 * النظام مع ٥٠٠ لا فرعٌ موازٍ. والحقنة تُمرَّر لحاوية تمرينٍ وحدها.
 *
 * ★ المِنصَّة معزولةٌ تماماً: ريدِسٌ ثانٍ وعاملٌ ثانٍ من نفس صورة الإنتاج ونفس
 *   أمرها. فعاملُ الإنتاج لا يُوقف، وبوتا `nuskjo` و`baitalsham` يعملان أثناء
 *   التمرين كلّه. (عاملان على نفس الطابور يتسابقان على المهامّ، فيقيس التمرين
 *   أيّهما التقطها — أي لا يقيس شيئاً.)
 *
 * ثلاثة أسئلةٍ بالدليل:
 *  ① **هل يُعاد المحاولة؟** وبأيّ تراجع؟ يُقرأ من المهمّة نفسها:
 *     `attempts` و`backoff` و`attemptsMade` — لا من تقديرٍ للأزمنة.
 *  ② **هل يُخبَر الزبون بشيء أم يُترك صامتاً؟** صفوفُ `messages` الصادرة.
 *  ③ **هل تُسجَّل الكلفة الجزئيّة؟** صفوفُ `ai_runs`. ونداءُ النموذج يجري
 *     **داخل** معاملة المستأجر، فأيّ توكنز أُنفقت قبل الفشل تتراجع معها.
 *
 * ثمّ تُرفع الحقنة **من نفس المِنصَّة** (يُعاد إنشاء العامل بلا المتغيّر)
 * ويُقاس التعافي بشوطٍ ناجحٍ في `ai_runs`.
 *
 * ولماذا نموذجٌ **مسعَّر** (`gemini-3.5-flash-lite`): شوطُ التعافي يجب أن
 * يُظهر كلفةً غير صفريّة، وإلّا خُلط «لا كلفةَ لأنّ النداء فشل» بـ«لا كلفةَ
 * لأنّ النموذج بلا سعر» — وذاك عطلٌ آخر يقيسه `drill-reply-cost.ts`.
 *
 * يُشغَّل على الخادم من مضيفه (البيئة في رأس `drill-kit.ts`):
 *   TENANT_SLUG=drill-provider MODEL=gemini-3.5-flash-lite \
 *     node --import tsx apps/worker/scripts/drill-provider.ts
 *
 * ويهدم المِنصَّة حتماً في `finally`.
 */
import { Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  closeDb, withPlatform, aiRuns, conversations, messages, prices, eq, and, sql,
} from '@aibot/db';
import {
  sleep, log, step, docker, compose, ensureDrillTenant, purgeDrillData, inboundJob,
  storedCount, incidentsSince, reportRecovery, getDbOrDie,
} from './drill-kit.js';

const SLUG = process.env.TENANT_SLUG ?? 'drill-provider';
const PROVIDER = process.env.PROVIDER ?? 'google';
const MODEL = process.env.MODEL ?? 'gemini-3.5-flash-lite';
const FAULT = process.env.AI_FAULT_STATUS ?? '500';
const PORT = Number(process.env.DRILL_REDIS_PORT ?? '6398');
const NETWORK = process.env.DOCKER_NETWORK ?? 'aibot_default';
const RIG_REDIS = 'aibot-prov-redis';
const RIG_WORKER = 'aibot-prov-worker';
const REDIS_IMAGE = process.env.REDIS_IMAGE ?? 'redis:7-alpine';
const FROM = process.env.FROM ?? '962790002222';
const TAG = `prov-${Date.now()}`;

/* ★ حالةُ المِنصَّة على مستوى الوحدة: مُعالِجُ السقوط الأخير كان يهدم **دائماً**
   — أي ينادي `docker` حتّى لو سقط السكربت قبل أن يبني شيئاً. */
let rigBuilt = false;

function rigRedisUp(): void {
  rigBuilt = true;
  docker(['run', '-d', '--name', RIG_REDIS, '--network', NETWORK, '--network-alias', 'prov-redis',
    '-p', `127.0.0.1:${PORT}:6379`, REDIS_IMAGE,
    'redis-server', '--appendonly', 'yes', '--appendfsync', 'everysec']);
}

/** عاملٌ من نفس صورة الإنتاج — يختلف في `REDIS_URL` وفي الحقنة وحدهما. */
function rigWorkerUp(fault: string | null): void {
  const env = ['-e', 'REDIS_URL=redis://prov-redis:6379'];
  if (fault) env.push('-e', `AI_FAULT_STATUS=${fault}`);
  compose(['run', '-d', '--no-deps', '--name', RIG_WORKER, ...env, 'worker']);
}

function rigWorkerDown(): void {
  docker(['rm', '-f', RIG_WORKER], { allowFail: true });
}

function rigDown(): void {
  rigWorkerDown();
  docker(['rm', '-f', RIG_REDIS], { allowFail: true });
}

interface ReplyEvidence {
  attempts: number | undefined;
  backoff: unknown;
  attemptsMade: number;
  state: string;
  failedReason: string;
  /** الفاصل بين بداية أوّل تنفيذٍ ونهاية آخره — التراجع يظهر هنا أو لا يظهر. */
  spanMs: number;
}

async function replyEvidence(q: Queue, conversationId: string): Promise<ReplyEvidence | null> {
  const job: Job | undefined = await q.getJob(`conv-${conversationId}`);
  if (!job) return null;
  return {
    attempts: job.opts.attempts,
    backoff: job.opts.backoff ?? null,
    attemptsMade: job.attemptsMade,
    state: await job.getState(),
    failedReason: String(job.failedReason ?? '').slice(0, 160),
    spanMs: (job.finishedOn ?? 0) - (job.timestamp ?? 0),
  };
}

async function runsOf(db: ReturnType<typeof getDbOrDie>, tenantId: string) {
  return withPlatform(db, 'تمرين المزوّد: قراءة أشواط الردّ', (tx) => tx
    .select({
      id: aiRuns.id, model: aiRuns.model, cost: aiRuns.costUsd,
      prompt: aiRuns.promptTokens, output: aiRuns.outputTokens, calls: aiRuns.calls,
    })
    .from(aiRuns).where(eq(aiRuns.tenantId, tenantId)));
}

async function outboundOf(db: ReturnType<typeof getDbOrDie>, tenantId: string) {
  return withPlatform(db, 'تمرين المزوّد: قراءة الصادر إلى الزبون', (tx) => tx
    .select({ body: messages.body, source: messages.source, status: messages.status })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.direction, 'out'))));
}

async function main(): Promise<void> {
  const db = getDbOrDie();

  console.log(`\n▶ تمرين (د) المزوّد يعيد ${FAULT} — مِنصَّةٌ معزولة، والإنتاج يعمل\n`);

  /* ① صفّ السعر أوّلاً: فشلٌ هنا يوفّر بناء مِنصَّةٍ كاملةٍ بلا داعٍ. */
  const price = await withPlatform(db, 'تمرين المزوّد: قراءة صفّ سعر النموذج', (tx) => tx
    .select({ input: prices.input, output: prices.output }).from(prices)
    .where(and(eq(prices.provider, PROVIDER), eq(prices.model, MODEL))).limit(1));
  if (!price[0]) throw new Error(`لا صفَّ سعرٍ لـ${PROVIDER}/${MODEL} — شوطُ التعافي سيُقرأ صفراً ويُخلط بعطلٍ آخر`);
  log('صفّ السعر موجود', price[0]);

  const ctx = await ensureDrillTenant(db, {
    slug: SLUG,
    name: 'مستأجر تمرين المزوّد',
    bot: {
      provider: PROVIDER, model: MODEL,
      persona: 'أنت موظّف خدمة زبائن لمحلّ تمرين. أجب بسطرٍ واحدٍ قصير.',
      knowledgeBase: 'ساعات العمل من ٩ صباحاً إلى ٥ مساءً.',
    },
  });
  log('مستأجر التمرين جاهز، والبوت مفعَّلٌ على نموذجٍ مسعَّر', { tenantId: ctx.tenantId });

  let conn: IORedis | null = null;
  let inbound: Queue | null = null;
  let reply: Queue | null = null;
  const verdict = {
    retried: false, backoffDeclared: false, customerTold: false,
    partialCostRecorded: false, incident: false, recovered: false,
  };

  try {
    step('بناء المِنصَّة المعزولة والحقنة مفعَّلة');
    rigRedisUp();
    rigWorkerUp(FAULT);
    await sleep(Number(process.env.RIG_BOOT_MS ?? '12000'));
    log('سجلّ عامل المِنصَّة (آخر سطر)',
      docker(['logs', '--tail', '1', RIG_WORKER], { allowFail: true }).slice(0, 200));

    conn = new IORedis(`redis://127.0.0.1:${PORT}`, {
      maxRetriesPerRequest: 2, enableReadyCheck: true, enableOfflineQueue: false,
    });
    inbound = new Queue('ch-inbound', { connection: conn });
    reply = new Queue('bot-reply', { connection: conn });

    /* ② رسالةٌ واحدة — نداءُ نموذجٍ واحدٌ يكفي، والحقنة تجعله ٥٠٠. */
    step('رسالةٌ والمزوّد يعيد الفشل');
    const since = new Date();
    await inbound.add('inbound', inboundJob({
      tenantId: ctx.tenantId, channelId: ctx.channelId,
      externalId: `${TAG}-0`, from: FROM, text: 'شو ساعات العمل؟',
    }), { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000 });
    log('ضُخَّت رسالةٌ واحدة');

    const deadline = Date.now() + Number(process.env.WAIT_FAIL_MS ?? '90000');
    let convId = '';
    let ev: ReplyEvidence | null = null;
    while (Date.now() < deadline) {
      await sleep(2500);
      if (!convId) {
        const rows = await withPlatform(db, 'تمرين المزوّد: إيجاد محادثة التمرين', (tx) => tx
          .select({ id: conversations.id }).from(conversations)
          .where(eq(conversations.tenantId, ctx.tenantId)).limit(1));
        convId = rows[0]?.id ?? '';
      }
      if (convId) {
        ev = await replyEvidence(reply, convId);
        if (ev && (ev.state === 'failed' || ev.state === 'completed')) break;
      }
    }

    const storedIn = await storedCount(db, ctx.tenantId, TAG);
    const runsDuring = await runsOf(db, ctx.tenantId);
    const outDuring = await outboundOf(db, ctx.tenantId);
    const incDuring = await incidentsSince(db, since);

    log(`الوارد محفوظ؟ ${storedIn}/1`);
    log('مهمّة الردّ', ev ?? '(لم تُوجد)');
    log(`أشواط ai_runs: ${runsDuring.length} · صادرٌ للزبون: ${outDuring.length}`);
    log('حوادثُ ظهرت', incDuring.length ? incDuring.map((r) => `${r.kind}/${r.severity}×${r.count}`) : '—');

    /* ★ «هل أُخبر الزبون؟» لا يُقاس بصفوف الصادر: التوكن توكنُ تمرين، والصفُّ
       في `messages` يُكتب **بعد** نجاح الإرسال (‏`outbound.ts` الخطوة ⑥) — فصفرٌ
       هنا يعني «لم يُرسَل» لا «لم يُحاوَل». والمقيسُ الصادق هو **المحاولة**:
       `safeSend` يرفع `send_failed` عند فشل القناة. */
    const sendAttempted = incDuring.some((r) => r.kind === 'send_failed');
    verdict.retried = (ev?.attemptsMade ?? 0) > 1;
    verdict.backoffDeclared = ev?.backoff !== null && ev?.backoff !== undefined;
    verdict.customerTold = sendAttempted;
    verdict.partialCostRecorded = runsDuring.length > 0;
    verdict.incident = incDuring.some((r) => r.kind === 'ai_error');

    /* ③ رفع الحقنة على نفس المِنصَّة — يُعاد إنشاء العامل بلا المتغيّر. */
    step('رفع الحقنة وقياس التعافي');
    rigWorkerDown();
    rigWorkerUp(null);
    await sleep(Number(process.env.RIG_BOOT_MS ?? '12000'));

    await inbound.add('inbound', inboundJob({
      tenantId: ctx.tenantId, channelId: ctx.channelId,
      externalId: `${TAG}-1`, from: FROM, text: 'وبعد رفع الحقنة، شو ساعات العمل؟',
    }), { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000 });

    const recDeadline = Date.now() + Number(process.env.RECOVER_MS ?? '150000');
    let runsAfter = runsDuring;
    while (Date.now() < recDeadline) {
      await sleep(3000);
      runsAfter = await runsOf(db, ctx.tenantId);
      if (runsAfter.length > runsDuring.length) break;
    }
    const incAll = await incidentsSince(db, since);
    verdict.recovered = runsAfter.length > runsDuring.length
      && runsAfter.some((r) => Number(r.cost) > 0);

    /* ④ الحكم. */
    step('الحكم');
    console.log('');
    console.log(`  الحقنة:                  AI_FAULT_STATUS=${FAULT}`);
    console.log(`  إعادة المحاولة المعلَنة:  attempts=${ev?.attempts ?? '?'} · backoff=${JSON.stringify(ev?.backoff ?? null)}`);
    console.log(`  محاولاتٌ جرت فعلاً:        ${ev?.attemptsMade ?? 0} · الحالة ${ev?.state ?? '?'} · المدّة ${ev?.spanMs ?? 0}ms`);
    console.log(`  سببُ الفشل:               ${ev?.failedReason || '—'}`);
    console.log(`  ai_runs أثناء الحقنة:     ${runsDuring.length}`);
    console.log(`  ai_runs بعد الرفع:        ${runsAfter.length}`
      + `${runsAfter.length ? ` (كلفة ${runsAfter.map((r) => `$${r.cost}`).join(', ')})` : ''}`);
    console.log(`  صادرٌ إلى الزبون:         ${outDuring.length ? outDuring.map((o) => `${o.source}:${String(o.body).slice(0, 30)}`).join(' | ') : '— لا شيء'}`);
    console.log(`  حوادث:                   ${incAll.length ? incAll.map((r) => `${r.kind}×${r.count}`).join(' · ') : '—'}`);
    console.log('');
    console.log(`① إعادة المحاولة:  ${verdict.retried
      ? `✅ ${ev?.attemptsMade} محاولة`
      : `❌ محاولةٌ واحدة (${ev?.attemptsMade ?? 0})`}`
      + ` · التراجع: ${verdict.backoffDeclared
        ? `✅ ${JSON.stringify(ev?.backoff)}`
        : '❌ **لا تراجعَ أُسّيّ** — المحاولة الثانية تضرب المزوّد الفاشل فوراً'}`);
    console.log(`② الحادثة:        ${verdict.incident
      ? '✅ ai_error مسجَّلة'
      : '❌ لا حادثة — فشلُ المزوّد يمرّ صامتاً'}`
      + ` · الزبون: ${verdict.customerTold
        ? '✅ جرت محاولةُ إرسال'
        : '❌ صمتٌ تامّ — لا محاولةَ إرسالٍ أصلاً'}`);
    console.log(`③ الكلفة:         ${verdict.partialCostRecorded
      ? '✅ صفُّ ai_runs موجود'
      : '❌ لا صفَّ ai_runs — النداء داخل معاملةٍ تتراجع، فأيّ توكنز أُنفقت تُفقد من القياس'}`);
    console.log(`④ التعافي:        ${verdict.recovered
      ? '✅ شوطٌ ناجحٌ بكلفةٍ غير صفريّة بعد رفع الحقنة'
      : '❌ لا شوطَ ناجحٍ بعد الرفع'}`);
  } finally {
    step('هدم المِنصَّة');
    await inbound?.close().catch(() => undefined);
    await reply?.close().catch(() => undefined);
    await conn?.quit().catch(() => undefined);
    rigDown();
    await purgeDrillData(db, ctx.tenantId).catch((e) => log(`تعذّر التنظيف: ${(e as Error).message}`));
    log('نُظّف أثر التمرين، والبوت التجريبيّ مطفأ');
  }

  const guard = await reportRecovery(db);
  await closeDb().catch(() => undefined);

  const pass = verdict.recovered && guard;
  console.log(`\n${pass
    ? '✅ التمرين اكتمل — المِنصَّة تعافت بعد رفع الحقنة'
    : '❌ التمرين كشف عطلاً — راجع الأحكام أعلاه'}`);
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  if (rigBuilt) rigDown();
  await closeDb().catch(() => undefined);
  process.exit(1);
});
