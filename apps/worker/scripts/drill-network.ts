/**
 * تمرين الفشل (ب): **انزع الشبكة عن حاوية العامل.**
 *
 * ما يُقطع بالضبط: **الخروج إلى الإنترنت وحده**. قاعدةٌ في `OUTPUT` داخل
 * نطاق شبكة حاوية العامل تسمح بالنطاقات الخاصّة (فتبقى `db` و`redis` في
 * متناوله) وترفض ما عداها. فيفشل نداءُ Gemini ونداءُ ميتا، ويبقى كلّ شيءٍ
 * آخر سليماً — وهذا هو العطل الحقيقيّ الذي يقع في الحياة: مزوّدٌ لا يُطال،
 * لا خادمٌ مات.
 *
 * ★ ولماذا ليس `docker network disconnect`: ذاك يقطع القاعدةَ والطابورَ معاً،
 *   فيقيس «عاملٌ معزولٌ كلّيّاً» لا «نداءٌ خارجيٌّ يفشل». وهو مقيسٌ مفيدٌ
 *   أيضاً، ولذلك يُتاح بـ`MODE=partition` — بحكمٍ مختلفٍ يُعلن نفسه.
 *
 * ★ وكيف تُضاف القاعدة بلا `NET_ADMIN` على حاوية العامل: حاويةٌ جانبيّة
 *   تشترك **نطاق شبكتها** (`--network container:…`) وتحمل `NET_ADMIN`.
 *   القاعدة تسكن في النطاق فتبقى بعد خروج الجانبيّة، وتُرفع بجانبيّةٍ أخرى.
 *   فلا تُعاد بناءُ حاوية العامل ولا يُمَسّ إعداد compose.
 *
 * ثلاثة أسئلةٍ بالدليل:
 *  ① **هل يتعافى؟** بعد رفع الحصار، هل يُنتج ردٌّ جديد شوطاً ناجحاً في
 *     `ai_runs` بلا إعادة تشغيلٍ ولا يدٍ بشريّة؟
 *  ② **هل يُنتج حادثةً؟** فشلُ نداء المزوّد — هل يُسجَّل في `incidents`؟
 *  ③ **هل ضاع شيء؟** الرسالة الواردة محفوظة؟ وهل أُخبر الزبون بشيء أم بقي
 *     صامتاً؟ (صفوفُ `messages` الصادرة هي الجواب.)
 *
 * ★ وقياسٌ رابع يُطبع دائماً: **إعداد إعادة المحاولة كما هو في المهمّة نفسها**
 *   (`job.opts.attempts` و`job.opts.backoff`). سؤال «بأيّ تراجعٍ أُسّيّ؟»
 *   يُجاب بقراءة المهمّة لا بتقدير الأزمنة.
 *
 * يُشغَّل على الخادم من مضيفه (البيئة في رأس `drill-kit.ts`):
 *   TENANT_SLUG=drill-net MODEL=gemini-3.5-flash-lite \
 *     node --import tsx apps/worker/scripts/drill-network.ts
 *
 * ويرفع الحصار حتماً في `finally` — ولو سقط السكربت.
 */
import { Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  closeDb, withPlatform, aiRuns, conversations, messages, eq, and, sql,
} from '@aibot/db';
import {
  sleep, log, step, requireEnv, docker, isRunning, ensureDrillTenant, purgeDrillData,
  inboundJob, storedCount, incidentsSince, reportRecovery, getDbOrDie,
} from './drill-kit.js';

const SLUG = process.env.TENANT_SLUG ?? 'drill-net';
const MODEL = process.env.MODEL ?? 'gemini-3.5-flash-lite';
const PROVIDER = process.env.PROVIDER ?? 'google';
const WORKER = process.env.WORKER_CONTAINER ?? 'aibot-worker-1';
const NETWORK = process.env.DOCKER_NETWORK ?? 'aibot_default';
const MODE = (process.env.MODE ?? 'egress') as 'egress' | 'partition';
const SIDECAR_IMAGE = process.env.SIDECAR_IMAGE ?? 'alpine:latest';
const FROM = process.env.FROM ?? '962790001111';
const TAG = `net-${Date.now()}`;

/** ما يُسمح به أثناء الحصار: المحليّ والنطاقات الخاصّة — أي كلّ ما داخل الخادم. */
const PRIVATE = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

function sidecar(script: string): string {
  return docker([
    'run', '--rm', `--network=container:${WORKER}`, '--cap-add=NET_ADMIN',
    SIDECAR_IMAGE, 'sh', '-c', `apk add --no-cache iptables >/dev/null 2>&1; ${script}`,
  ]);
}

/** لقطةُ القواعد قبل التمرين — فالتنظيف يُقاس لا يُفترض. */
function rulesSnapshot(): string {
  return sidecar('iptables -S OUTPUT').split('\n').map((l) => l.trim()).filter(Boolean).join(' | ');
}

function blockEgress(): void {
  const allow = PRIVATE.map((net) => `iptables -A OUTPUT -d ${net} -j ACCEPT`).join('; ');
  sidecar(`iptables -A OUTPUT -o lo -j ACCEPT; ${allow}; `
    + 'iptables -A OUTPUT -j REJECT --reject-with icmp-host-unreachable; iptables -S OUTPUT');
}

function unblockEgress(): void {
  /* حذفٌ موجَّه بالعكس لا `-F`: `-F` يمحو قواعد غيرنا لو وُجدت. */
  const del = ['iptables -D OUTPUT -j REJECT --reject-with icmp-host-unreachable',
    ...PRIVATE.slice().reverse().map((net) => `iptables -D OUTPUT -d ${net} -j ACCEPT`),
    'iptables -D OUTPUT -o lo -j ACCEPT'].map((c) => `${c} 2>/dev/null || true`).join('; ');
  sidecar(`${del}; iptables -S OUTPUT`);
}

/** هل الخروج ممنوعٌ فعلاً؟ قياسٌ من داخل نطاق العامل نفسه. */
function egressBlocked(): boolean {
  const out = docker([
    'run', '--rm', `--network=container:${WORKER}`, SIDECAR_IMAGE,
    'sh', '-c', 'wget -q -T 5 -O /dev/null https://generativelanguage.googleapis.com/ && echo REACHABLE || echo BLOCKED',
  ], { allowFail: true });
  return out.includes('BLOCKED');
}

interface ReplyEvidence {
  jobId: string | null;
  attempts: number | undefined;
  backoff: unknown;
  attemptsMade: number;
  state: string;
  failedReason: string;
  spanMs: number;
}

async function replyEvidence(q: Queue, conversationId: string): Promise<ReplyEvidence> {
  const jobId = `conv-${conversationId}`;
  const job: Job | undefined = await q.getJob(jobId);
  if (!job) {
    return { jobId: null, attempts: undefined, backoff: undefined, attemptsMade: 0,
      state: 'مفقودة', failedReason: '', spanMs: 0 };
  }
  return {
    jobId,
    attempts: job.opts.attempts,
    backoff: job.opts.backoff ?? null,
    attemptsMade: job.attemptsMade,
    state: await job.getState(),
    failedReason: String(job.failedReason ?? '').slice(0, 140),
    spanMs: (job.finishedOn ?? Date.now()) - (job.processedOn ?? Date.now()),
  };
}

async function main(): Promise<void> {
  const db = getDbOrDie();
  const redisUrl = requireEnv('REDIS_URL');

  console.log(`\n▶ تمرين (ب) انزع الشبكة — الوضع ${MODE}، النموذج ${PROVIDER}/${MODEL}\n`);
  if (!isRunning(WORKER)) throw new Error(`${WORKER} لا يعمل — لا معنى للتمرين`);

  const ctx = await ensureDrillTenant(db, {
    slug: SLUG,
    name: 'مستأجر تمرين الشبكة',
    bot: {
      provider: PROVIDER, model: MODEL,
      persona: 'أنت موظّف خدمة زبائن لمحلّ تمرين. أجب بسطرٍ واحدٍ قصير.',
      knowledgeBase: 'ساعات العمل من ٩ صباحاً إلى ٥ مساءً.',
    },
  });
  log('مستأجر التمرين جاهز، والبوت مفعَّلٌ على نموذجٍ مسعَّر', { tenantId: ctx.tenantId });

  const conn = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const inbound = new Queue('ch-inbound', { connection: conn });
  const reply = new Queue('bot-reply', { connection: conn });

  let blocked = false;
  let disconnected = false;
  let before = '';
  const verdict = { recovered: false, incident: false, messageKept: false, customerTold: false };

  try {
    if (MODE === 'egress') {
      before = rulesSnapshot();
      log('قواعد OUTPUT قبل الحصار', before || '(فارغة)');
    }

    /* ① الحصار. */
    step('فرض العطل');
    const since = new Date();
    if (MODE === 'egress') {
      blockEgress();
      blocked = true;
      log(`الخروج ممنوع؟ ${egressBlocked() ? 'نعم ✂' : 'لا ⚠ — القاعدة لم تُطبَّق'}`);
    } else {
      docker(['network', 'disconnect', NETWORK, WORKER]);
      disconnected = true;
      log(`فُصل ${WORKER} عن ${NETWORK} — القاعدة والطابور مقطوعان أيضاً`);
    }

    /* ② رسالةٌ واحدة أثناء العطل: نداءُ نموذجٍ واحدٌ يكفي للقياس، والكلفة صفر
       لأنّ النداء لا يصل المزوّد أصلاً. */
    step('رسالةٌ أثناء العطل');
    await inbound.add('inbound', inboundJob({
      tenantId: ctx.tenantId, channelId: ctx.channelId,
      externalId: `${TAG}-0`, from: FROM, text: 'شو ساعات العمل؟',
    }), { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000 });
    log('ضُخَّت رسالةٌ واحدة');

    /* في وضع `partition` العامل لا يرى الطابور أصلاً، فلا شيء يُنفَّذ قبل
       إعادة الوصل — وذاك جوابٌ بنفسه. */
    const waitFail = Number(process.env.WAIT_FAIL_MS ?? '60000');
    const deadline = Date.now() + waitFail;
    let convId = '';
    let ev: ReplyEvidence | null = null;
    while (Date.now() < deadline) {
      await sleep(2500);
      if (!convId) {
        const rows = await withPlatform(db, 'تمرين الشبكة: إيجاد محادثة التمرين', (tx) => tx
          .select({ id: conversations.id }).from(conversations)
          .where(eq(conversations.tenantId, ctx.tenantId)).limit(1));
        convId = rows[0]?.id ?? '';
      }
      if (convId) {
        ev = await replyEvidence(reply, convId);
        if (ev.state === 'failed' || ev.state === 'completed') break;
      }
    }

    const storedIn = await storedCount(db, ctx.tenantId, TAG);
    const runsDuring = await withPlatform(db, 'تمرين الشبكة: عدّ أشواط الردّ أثناء العطل', (tx) => tx
      .select({ n: sql<number>`count(*)::int` }).from(aiRuns).where(eq(aiRuns.tenantId, ctx.tenantId)));
    const outDuring = await withPlatform(db, 'تمرين الشبكة: عدّ الصادر أثناء العطل', (tx) => tx
      .select({ n: sql<number>`count(*)::int` }).from(messages)
      .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.direction, 'out'))));

    log(`الرسالة الواردة مخزَّنة؟ ${storedIn}/1`);
    log('مهمّة الردّ', ev ?? '(لم تُوجد محادثة — الوارد نفسه لم يُنفَّذ)');
    log(`أشواط ai_runs أثناء العطل: ${runsDuring[0]?.n ?? 0} · صادرٌ للزبون: ${outDuring[0]?.n ?? 0}`);

    const incDuring = await incidentsSince(db, since);
    log('حوادثُ ظهرت', incDuring.length ? incDuring.map((r) => `${r.kind}/${r.severity}×${r.count}`) : '—');

    /* ★ «هل أُخبر الزبون؟» **لا يُقاس بصفوف الصادر** على هذه المِنصَّة: التوكن
       توكنُ تمرين، والصفُّ في `messages` يُكتب **بعد** نجاح الإرسال (‏`outbound.ts`
       الخطوة ⑥) — فصفرٌ هنا يعني «لم يُرسَل» لا «لم يُحاوَل»، وهما مختلفان
       تماماً. والمقيسُ الصادق هو **المحاولة**: `safeSend` يرفع `send_failed`
       عند فشل القناة، فوجودُها دليلُ محاولةٍ وغيابُها دليلُ صمتٍ تامّ. */
    const sendAttempted = incDuring.some((r) => r.kind === 'send_failed');
    log(`محاولةُ إرسالٍ للزبون؟ ${sendAttempted ? 'نعم (حادثة send_failed)' : 'لا — لا محاولةَ إطلاقاً'}`);

    /* ③ رفع العطل ثمّ قياس التعافي برسالةٍ ثانية. */
    step('رفع العطل والتعافي');
    if (MODE === 'egress') {
      unblockEgress();
      blocked = false;
      log(`الخروج ممنوع بعد الرفع؟ ${egressBlocked() ? 'نعم ❌' : 'لا ✅'}`);
      log('قواعد OUTPUT بعد الرفع', rulesSnapshot() || '(فارغة)');
    } else {
      docker(['network', 'connect', NETWORK, WORKER]);
      disconnected = false;
      log(`أُعيد وصل ${WORKER} بـ${NETWORK}`);
    }

    await inbound.add('inbound', inboundJob({
      tenantId: ctx.tenantId, channelId: ctx.channelId,
      externalId: `${TAG}-1`, from: FROM, text: 'وبعد الرفع، شو ساعات العمل؟',
    }), { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000 });

    const recDeadline = Date.now() + Number(process.env.RECOVER_MS ?? '150000');
    let runsAfter = 0;
    while (Date.now() < recDeadline) {
      await sleep(3000);
      const rows = await withPlatform(db, 'تمرين الشبكة: عدّ أشواط الردّ بعد الرفع', (tx) => tx
        .select({ n: sql<number>`count(*)::int` }).from(aiRuns).where(eq(aiRuns.tenantId, ctx.tenantId)));
      runsAfter = rows[0]?.n ?? 0;
      if (runsAfter > (runsDuring[0]?.n ?? 0)) break;
    }

    const incAll = await incidentsSince(db, since);

    /* ④ الحكم. */
    step('الحكم');
    verdict.recovered = runsAfter > (runsDuring[0]?.n ?? 0);
    verdict.incident = incAll.some((r) => r.kind === 'ai_error');
    verdict.messageKept = storedIn >= 1;
    verdict.customerTold = sendAttempted;

    console.log('');
    console.log(`  إعادة المحاولة المعلَنة:  attempts=${ev?.attempts ?? '?'} · backoff=${JSON.stringify(ev?.backoff ?? null)}`);
    console.log(`  محاولاتٌ جرت فعلاً:        ${ev?.attemptsMade ?? 0} · الحالة ${ev?.state ?? '?'}`);
    console.log(`  سببُ الفشل:               ${ev?.failedReason || '—'}`);
    console.log(`  حوادثُ ظهرت:              ${incAll.length ? incAll.map((r) => `${r.kind}×${r.count}`).join(' · ') : '—'}`);
    console.log('');
    console.log(`① التعافي:  ${verdict.recovered
      ? '✅ شوطُ ردٍّ ناجح بعد رفع الحصار بلا إعادة تشغيل'
      : '❌ لا شوطَ ناجحٍ بعد الرفع — العامل لم يتعافَ وحده'}`);
    console.log(`② الحادثة:  ${verdict.incident
      ? `✅ ${incAll.map((r) => r.kind).join(', ')}`
      : '❌ لا حادثة — فشلُ نداء المزوّد يمرّ صامتاً'}`);
    console.log(`③ الضائع:   ${verdict.messageKept
      ? '✅ الرسالة الواردة محفوظة'
      : '❌ الرسالة الواردة نفسها ضاعت'}`
      + ` · إخبارُ الزبون: ${verdict.customerTold
        ? '✅ جرت محاولةُ إرسال'
        : '❌ صمتٌ تامّ — لا محاولةَ إرسالٍ أصلاً، فلا اعتذارَ ولا تحويلَ لموظّف'}`);
  } finally {
    /* رفعُ العطل غيرُ مشروط. */
    if (blocked) {
      log('⚠ السكربت يسقط والحصار قائم — أرفعه الآن');
      try { unblockEgress(); } catch (e) { log(`تعذّر الرفع: ${(e as Error).message}`); }
    }
    if (disconnected) {
      log('⚠ السكربت يسقط والعامل مفصول — أُعيد وصله الآن');
      docker(['network', 'connect', NETWORK, WORKER], { allowFail: true });
    }
    await purgeDrillData(db, ctx.tenantId).catch((e) => log(`تعذّر التنظيف: ${(e as Error).message}`));
    log('نُظّف أثر التمرين، والبوت التجريبيّ مطفأ');
    await inbound.close().catch(() => undefined);
    await reply.close().catch(() => undefined);
    await conn.quit().catch(() => undefined);
  }

  const guard = await reportRecovery(db);
  await closeDb().catch(() => undefined);

  const pass = verdict.recovered && verdict.messageKept && guard;
  console.log(`\n${pass
    ? '✅ التمرين اكتمل — النظام تعافى ولم تُضَع رسالةٌ واردة'
    : '❌ التمرين كشف عطلاً — راجع الأحكام أعلاه'}`);
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
