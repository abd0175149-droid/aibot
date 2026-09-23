/**
 * تمرين الفشل (أ): **اقتل ريدِس أثناء تدفّق رسائل.**
 *
 * ريدِس ليس كاشاً في هذه المنصّة — هو **الذاكرة الوحيدة** لكلّ مهمّةٍ دُفعت
 * ولم تُنفَّذ بعد. ولذلك في `docker-compose.yml` سطرٌ مكتوبٌ بخطٍّ عريض:
 * `appendonly yes` ومعه «لا تُزل هذا». وعدٌ بلا اختبارٍ ليس وعداً.
 *
 * ثلاثة أسئلةٍ بالدليل:
 *  ① **هل يتعافى؟** بعد `start` تعود الطوابير وتُستأنف المهامّ بلا يدٍ بشريّة؟
 *  ② **هل يُنتج حادثةً؟** صفٌّ في `incidents` عن انقطاع ريدِس — أم صمت؟
 *  ③ **هل ضاع شيء؟** كلّ ما ضُخّ قبل الانقطاع، وكلّ ويبهوكٍ وصل **أثناءه**،
 *     يجب أن يظهر صفّاً في `messages`.
 *
 * ★ والقياس الذي يميّز هذا التمرين: `idle in transaction`. عامل الوارد
 *   ينادي `enqueueReply` (نداء ريدِس) **داخل** معاملة المستأجر. فحين يسقط
 *   ريدِس تتوقّف المعاملة على الانتظار وهي تحتجز اتّصالاً من مجمّعٍ حجمه
 *   عشرة، وتزامنُ `ch-inbound` عشرة أيضاً. القاعدة المكتوبة في `reply.ts`
 *   — «لا نداءَ شبكةٍ داخل معاملة» — تُقاس هنا بصفٍّ من `pg_stat_activity`
 *   لا بقراءة الكود.
 *
 * ولماذا بوتٌ مطفأ: نعزل ما يُقاس. متانةُ الوارد وبقاءُ الطوابير لا علاقةَ
 * لهما بنداء النموذج، وتفعيلُ البوت يُضيف كلفةً وضجيجَ إرسالٍ فاشل.
 *
 * يُشغَّل على الخادم من مضيفه (البيئة في رأس `drill-kit.ts`):
 *   TENANT_SLUG=drill-redis COUNT=40 OUTAGE_MS=20000 \
 *     node --import tsx apps/worker/scripts/drill-redis.ts
 *
 * ولا يترك أثراً: يحذف ما أنشأه في النهاية ولو فشل، ويُعيد ريدِس حتماً.
 */
import { createHmac } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { closeDb } from '@aibot/db';
import {
  sleep, log, step, requireEnv, compose, isRunning, ensureDrillTenant, purgeDrillData,
  inboundJob, waWebhookBody, storedCount, storedIds, incidentsSince, idleInTransaction,
  health, reportRecovery, getDbOrDie,
} from './drill-kit.js';

const SLUG = process.env.TENANT_SLUG ?? 'drill-redis';
const COUNT = Number(process.env.COUNT ?? '40');
/** مدّة الانقطاع. أطول من 15s عمداً: فاحصُ المهامّ العالقة في BullMQ دورتُه 30s. */
const OUTAGE_MS = Number(process.env.OUTAGE_MS ?? '20000');
/** ويبهوكاتٌ تصل **أثناء** الانقطاع — وهي أخطر ما في التمرين. */
const WEBHOOKS = Number(process.env.WEBHOOKS ?? '3');
const API = process.env.API_URL ?? 'http://127.0.0.1:4100';
const REDIS_CONTAINER = process.env.REDIS_CONTAINER ?? 'aibot-redis-1';
const TAG = `redis-${Date.now()}`;
/** مهلةُ الويبهوك: الـAPI يردّ 200 **قبل** المعالجة، فالردّ السريع متوقَّع. */
const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS ?? '15000');

/* حالةُ العطل على مستوى الوحدة لا داخل `main`: مُعالِجُ السقوط الأخير يحتاجها.
   ★ وبلا هذا كان ذاك المُعالِج ينادي `docker compose start redis` **دائماً** —
     حتّى لو سقط السكربت قبل أن يُوقف شيئاً، أو شُغِّل على غير الخادم. نداءٌ
     مُصلِحٌ لعطلٍ لم يحدث هو عطلٌ بذاته. */
let redisStopped = false;

interface WebhookProbe { i: number; externalId: string; status: number; ms: number; body: string }

async function postWebhook(
  pid: string, appSecret: string, phoneNumberId: string, externalId: string, i: number,
): Promise<WebhookProbe> {
  const body = JSON.stringify(waWebhookBody({
    externalId, from: `96279100${String(1000 + i)}`,
    text: `ويبهوك أثناء انقطاع ريدِس ${i}`, phoneNumberId,
  }));
  /* التوقيع على البايتات كما تُرسَل — الـAPI يحسبه على `rawBody` لا على JSON
     مُعاد تسلسله، فأيّ إعادة تسلسلٍ هنا تُنتج 403 يُقرأ عطلاً وهو خطأ قياس. */
  const sig = `sha256=${createHmac('sha256', appSecret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
  const started = Date.now();
  try {
    const res = await fetch(`${API}/api/webhooks/wa/${pid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const text = await res.text();
    return { i, externalId, status: res.status, ms: Date.now() - started, body: text.slice(0, 60) };
  } catch (e) {
    return { i, externalId, status: 0, ms: Date.now() - started, body: `تعذّر: ${(e as Error).message}` };
  }
}

async function main(): Promise<void> {
  const db = getDbOrDie();
  const redisUrl = requireEnv('REDIS_URL');

  console.log(`\n▶ تمرين (أ) اقتل ريدِس — ${COUNT} مهمّة، انقطاع ${OUTAGE_MS}ms، ${WEBHOOKS} ويبهوك أثناءه\n`);

  const ctx = await ensureDrillTenant(db, {
    slug: SLUG, name: 'مستأجر تمرين ريدِس', bot: null,
  });
  log('مستأجر التمرين جاهز، والبوت مطفأ', { tenantId: ctx.tenantId, publicId: ctx.publicId });

  const conn = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const inbound = new Queue('ch-inbound', { connection: conn });

  let verdict = { recovered: false, incident: false, lost: -1, webhooksLost: -1 };

  try {
    /* ① دفعةٌ سريعة: بلا فاصلٍ عن قصد، فيكون وقتَ القتل مهامٌّ **قيد التنفيذ**
       ومهامٌّ منتظرة معاً. الفاصل يُنتج طابوراً فارغاً فيقيس التمرين شيئاً آخر. */
    step('الضخّ ثمّ الانقطاع');
    const ids: string[] = [];
    for (let i = 0; i < COUNT; i += 1) {
      const externalId = `${TAG}-q${i}`;
      ids.push(externalId);
      await inbound.add('inbound', inboundJob({
        tenantId: ctx.tenantId, channelId: ctx.channelId, externalId,
        from: `96279000${String(1000 + i)}`, text: `رسالة تمرين ريدِس ${i}`,
      }), { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000 });
    }
    const atStop = await inbound.getJobCounts('waiting', 'active', 'delayed');
    log(`ضُخَّت ${COUNT} مهمّة`, atStop);

    const since = new Date();
    compose(['stop', 'redis']);
    redisStopped = true;
    log(`✂ أُوقف ريدِس — يعمل الآن؟ ${isRunning(REDIS_CONTAINER)}`);

    /* ② أثناء الانقطاع — ولا نلمس ريدِس من هذا السكربت هنا: كلّ أمرٍ يُصدَر
       الآن يقف في طابور ioredis غير المحدود فيُعلّق التمرين نفسه. */
    step('ما يحدث أثناء الانقطاع');
    const outHealth = await health();
    log('بوّابة الصحّة', outHealth);
    if (outHealth.status !== 503) {
      log('⚠ الصحّة لم تُعلن 503 وريدِس مطفأ — راجع بوّابة الصحّة');
    }

    const idle1 = await idleInTransaction(db);
    log(`اتّصالاتٌ عالقةٌ في معاملة (idle in transaction): ${idle1}`);

    const probes: WebhookProbe[] = [];
    for (let i = 0; i < WEBHOOKS; i += 1) {
      probes.push(await postWebhook(ctx.publicId, ctx.appSecret, `DRILL_${SLUG}`, `${TAG}-w${i}`, i));
    }
    for (const p of probes) log(`ويبهوك ${p.i}: HTTP ${p.status} في ${p.ms}ms — «${p.body}»`);

    const idle2 = await idleInTransaction(db);
    const midStored = await storedCount(db, ctx.tenantId, TAG);
    log(`اتّصالاتٌ عالقة بعد الويبهوكات: ${idle2} · مخزَّنٌ حتّى الآن: ${midStored}/${COUNT + WEBHOOKS}`);

    const remain = OUTAGE_MS - (Date.now() - since.getTime());
    if (remain > 0) await sleep(remain);

    /* ③ الرفع. */
    step('رفع العطل');
    compose(['start', 'redis']);
    redisStopped = false;
    log(`أُعيد ريدِس — يعمل؟ ${isRunning(REDIS_CONTAINER)}`);

    /* ④ التعافي: ننتظر استواء الطابور والقاعدة معاً، بمهلةٍ قصوى فلا تعليق.
       المهلة أوسع من دورة فاحص المهامّ العالقة (30s) مرّتين. */
    const expected = COUNT + WEBHOOKS;
    const deadline = Date.now() + Number(process.env.RECOVER_MS ?? '240000');
    let stored = 0;
    let waiting = 0;
    let active = 0;
    while (Date.now() < deadline) {
      await sleep(2000);
      const counts: Record<string, number> = await inbound
        .getJobCounts('waiting', 'active', 'delayed')
        .catch(() => ({} as Record<string, number>));
      waiting = (counts.waiting ?? 0) + (counts.delayed ?? 0);
      active = counts.active ?? 0;
      stored = await storedCount(db, ctx.tenantId, TAG);
      if (stored >= expected && waiting === 0 && active === 0) break;
    }

    const failedJobs = await inbound.getFailed(0, 500);
    const mine = failedJobs.filter((j) => (j.data as { tenantId?: string })?.tenantId === ctx.tenantId);
    const arrived = new Set(await storedIds(db, ctx.tenantId, TAG));
    const missingQueue = ids.filter((x) => !arrived.has(x));
    const missingWebhook = probes.map((p) => p.externalId).filter((x) => !arrived.has(x));

    /* ⑤ الحكم. */
    step('الحكم');
    const inc = await incidentsSince(db, since);
    const redisIncidents = inc.filter((r) => /redis|queue|infra|webhook/i.test(r.kind));

    /* ★ التعافي يُحكم بـ**معرّفات** مهامّ التمرين لا بعددٍ إجماليّ: `stored`
       يجمع رسائل الطابور ورسائل الويبهوك تحت نفس البادئة، فعدٌّ إجماليّ يجعل
       ويبهوكاً وصل يُغطّي على مهمّةٍ ضاعت — ويعلن تعافياً لم يحدث.

       و`waiting`/`active` طابوريّان لا خاصّان بالتمرين: مستأجرٌ حقيقيٌّ يعمل
       أثناء التمرين قد يُبقي مهمّةً جارية، فجعلُهما شرطاً يُنتج ❌ كاذباً.
       يُطبعان دليلاً، ولا يحكمان. */
    verdict = {
      recovered: missingQueue.length === 0,
      incident: redisIncidents.length > 0,
      lost: missingQueue.length,
      webhooksLost: missingWebhook.length,
    };

    console.log('');
    console.log(`  المضخوخ في الطابور:      ${COUNT}`);
    console.log(`  الويبهوكات أثناء العطل:  ${WEBHOOKS}`);
    console.log(`  المخزَّن بعد التعافي:      ${stored}/${expected}`);
    console.log(`  مهامّ التمرين الفاشلة:     ${mine.length}`);
    console.log(`  عالقٌ في معاملة (أثناء):  ${idle1} ← ${idle2}`);
    console.log(`  حوادثُ ظهرت بعد العطل:    ${inc.length ? inc.map((r) => `${r.kind}×${r.count}`).join(' · ') : '—'}`);
    console.log('');
    console.log(`  الطابور بعد التعافي:     منتظر ${waiting} · جارٍ ${active}`);
    console.log('');
    console.log(`① التعافي:  ${verdict.recovered
      ? `✅ كلّ مهامّ التمرين استُؤنفت وخُزّنت بلا تدخّل (منتظر ${waiting} · جارٍ ${active})`
      : `❌ ${missingQueue.length} مهمّةً لم تصل القاعدة — منتظر ${waiting} · جارٍ ${active}`}`);
    console.log(`② الحادثة:  ${verdict.incident
      ? `✅ ${redisIncidents.map((r) => r.kind).join(', ')}`
      : '❌ لا حادثة — انقطاعُ ريدِس كاملاً يمرّ صامتاً في incidents'}`);
    console.log(`③ الضائع:   ${verdict.lost === 0 && verdict.webhooksLost === 0
      ? '✅ لا رسالةَ ضاعت — لا من الطابور ولا من ويبهوكٍ وصل أثناء العطل'
      : `❌ من الطابور ${verdict.lost} · من الويبهوك ${verdict.webhooksLost}`}`);
    if (missingQueue.length) console.log(`    ضائعٌ من الطابور: ${missingQueue.slice(0, 8).join(', ')}`);
    if (missingWebhook.length) console.log(`    ضائعٌ من الويبهوك: ${missingWebhook.join(', ')}`);
  } finally {
    /* الرفع غيرُ مشروط: سكربتٌ يسقط وريدِس مطفأ يُحوّل تمريناً إلى عطل. */
    if (redisStopped) {
      log('⚠ السكربت يسقط وريدِس مطفأ — أُعيده الآن');
      compose(['start', 'redis'], { allowFail: true });
    }
    await purgeDrillData(db, ctx.tenantId).catch((e) => log(`تعذّر التنظيف: ${(e as Error).message}`));
    log('نُظّف أثر التمرين (المستأجر يبقى لتمرينٍ لاحق)');
    await inbound.close().catch(() => undefined);
    await conn.quit().catch(() => undefined);
  }

  const guard = await reportRecovery(db);
  await closeDb().catch(() => undefined);

  const pass = verdict.recovered && verdict.lost === 0 && verdict.webhooksLost === 0 && guard;
  console.log(`\n${pass
    ? '✅ التمرين اكتمل — النظام تعافى ولم تُضَع رسالة'
    : '❌ التمرين كشف عطلاً — راجع الأحكام أعلاه'}`);
  if (!verdict.incident) {
    console.log('⚠ وفي الحالتَين: لا حادثة. والصمت هو العطل في هذا المشروع.');
  }
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  if (redisStopped) compose(['start', 'redis'], { allowFail: true });
  await closeDb().catch(() => undefined);
  process.exit(1);
});
