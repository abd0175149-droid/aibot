/**
 * تمرين الفشل الأوّل: **إعادة تشغيل العامل وسط تدفّق رسائل.**
 *
 * ★ هذا شرط قبول المرحلة الأولى حرفيّاً — «إعادة تشغيل الحاويات أثناء التدفّق
 *   لا تُضيّع رسالةً واحدة (اختبرها عمداً)» — ولم يُجرَّب قطّ. والنظام كلّه
 *   مبنيٌّ على هذا الوعد: كلّ رسالةٍ تُدفع للطابور ولا تُعالَج في دورة الطلب،
 *   حتّى إن سقط العامل تبقى في ريدِس وتُستأنف. وعدٌ بلا اختبارٍ ليس وعداً.
 *
 * ماذا يقيس بالضبط: **متانة الوارد**. يُدخل N مهمّةً في `ch-inbound` بحمولاتٍ
 * مصنوعة، ويقتل العامل في منتصفها، ثمّ يُثبت أنّ N صفّاً وصلت القاعدة.
 *
 * ولماذا مستأجرٌ تجريبيٌّ ببوتٍ مطفأ: نعزل الخاصيّة المُختبَرة. بوتٌ مفعَّل
 * يعني نداء نموذجٍ وكلفةً ومحاولةَ إرسالٍ إلى أرقامٍ لا وجود لها — ضجيجٌ
 * يُخفي ما نقيسه، وكلفةٌ بلا مقابل. المتانة في الوارد لا في الردّ.
 *
 * يُشغَّل على الخادم:
 *   TENANT_SLUG=drill COUNT=40 KILL_AFTER_MS=900 \
 *     node --import tsx ops/testing/drill-restart.ts
 *
 * ولا يترك أثراً: يحذف ما أنشأه في النهاية ولو فشل.
 */
import { execFileSync } from 'node:child_process';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  getDb, closeDb, withPlatform, tenants, tenantChannels, botConfigs,
  contacts, channelIdentities, conversations, messages, conversationWindows,
  eq, and, sql,
} from '@aibot/db';
import { publicId } from '@aibot/crypto';

const SLUG = process.env.TENANT_SLUG ?? 'drill';
const COUNT = Number(process.env.COUNT ?? '40');
const KILL_AFTER_MS = Number(process.env.KILL_AFTER_MS ?? '900');
const WORKER = process.env.WORKER_CONTAINER ?? 'aibot-worker-1';
/** بادئةٌ تميّز رسائل التمرين فلا تُخلط بحركةٍ حقيقيّة ولا تُحذف غيرها. */
const TAG = `drill-${Date.now()}`;

function log(msg: string, extra?: unknown): void {
  console.log(extra === undefined ? `  ${msg}` : `  ${msg} ${JSON.stringify(extra)}`);
}

/** حمولةٌ بشكل واتساب الحقيقيّ — نفس المحلّل، فلا مسارٌ موازٍ يُختبر. */
function inboundJob(tenantId: string, channelId: string, i: number) {
  const at = new Date();
  return {
    tenantId,
    channelId,
    kind: 'whatsapp_cloud' as const,
    parsed: {
      messages: [{
        externalId: `${TAG}-${i}`,
        from: `9627900${String(100000 + i)}`,
        fromHandle: `زبون التمرين ${i}`,
        at,
        type: 'text' as const,
        text: `رسالة تمرين ${i}`,
        buttonPayload: null,
        mediaId: null,
        raw: { drill: true, i },
      }],
      statuses: [],
      accountEvents: [],
    },
  };
}

async function main(): Promise<void> {
  const db = getDb();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL غير مضبوط');

  console.log(`\n▶ تمرين المتانة — ${COUNT} رسالة، وقتل العامل بعد ${KILL_AFTER_MS}ms\n`);

  /* ① مستأجرٌ وقناةٌ للتمرين، ببوتٍ مطفأ. */
  const ctx = await withPlatform(db, 'تمرين: تهيئة مستأجر وقناة للاختبار', async (tx) => {
    let t = (await tx.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
    if (!t) {
      [t] = await tx.insert(tenants).values({
        slug: SLUG, name: 'مستأجر تمرين المتانة', status: 'active', publicId: publicId(),
      }).returning();
    }
    let ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, t!.id), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) {
      [ch] = await tx.insert(tenantChannels).values({
        tenantId: t!.id, kind: 'whatsapp_cloud',
        externalAccountId: `DRILL_${SLUG}`,
        displayName: 'قناة تمرين (لا ترسل شيئاً)',
        status: 'connected',
      }).returning();
    }
    // بوتٌ مطفأ: نعزل متانة الوارد عن سلوك الردّ
    const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, t!.id)).limit(1))[0];
    if (!cfg) {
      await tx.insert(botConfigs).values({ tenantId: t!.id, enabled: false });
    } else if (cfg.enabled) {
      await tx.update(botConfigs).set({ enabled: false }).where(eq(botConfigs.tenantId, t!.id));
    }
    return { tenantId: t!.id, channelId: ch!.id };
  });
  log('مستأجر التمرين جاهز، والبوت مطفأ', ctx);

  /* ② ضخّ المهامّ. */
  const conn = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const q = new Queue('ch-inbound', { connection: conn });

  const killAt = Date.now() + KILL_AFTER_MS;
  let killed = false;
  let killedAfter = 0;

  for (let i = 0; i < COUNT; i += 1) {
    await q.add('inbound', inboundJob(ctx.tenantId, ctx.channelId, i), {
      attempts: 3,
      backoff: { type: 'exponential', delay: 500 },
      removeOnComplete: 1000,
    });

    /* ★ القتل **وسط** التدفّق لا قبله ولا بعده: مهامٌّ منتظرة، وواحدةٌ على
       الأقلّ قيد التنفيذ. و`kill` لا `stop`: الإغلاق اللطيف يُنهي ما بيده
       فيُخفي ما نقيسه — نريد انقطاعاً قاسياً كانقطاع الكهرباء. */
    if (!killed && Date.now() >= killAt) {
      killed = true;
      killedAfter = i + 1;
      log(`✂ قتل العامل قسراً بعد ضخّ ${killedAfter}`);
      execFileSync('docker', ['kill', WORKER], { stdio: 'ignore' });
      execFileSync('docker', ['start', WORKER], { stdio: 'ignore' });
      log('أُعيد تشغيل العامل');
    }
  }

  if (!killed) {
    log('⚠ انتهى الضخّ قبل موعد القتل — أطِل KILL_AFTER_MS أو زِد COUNT');
    execFileSync('docker', ['kill', WORKER], { stdio: 'ignore' });
    execFileSync('docker', ['start', WORKER], { stdio: 'ignore' });
    killedAfter = COUNT;
  }

  log(`ضُخَّت ${COUNT} مهمّة`);

  /* ③ الانتظار حتّى يستوي الطابور — بمهلةٍ قصوى فلا تعليق. */
  const deadline = Date.now() + 120_000;
  let stored = 0;
  let waiting = 0;
  let active = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
    waiting = (counts.waiting ?? 0) + (counts.delayed ?? 0);
    active = counts.active ?? 0;
    failed = counts.failed ?? 0;

    stored = await withPlatform(db, 'تمرين: عدّ الرسائل المخزَّنة', async (tx) => {
      const [r] = await tx.select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(eq(messages.tenantId, ctx.tenantId), sql`${messages.externalId} like ${TAG + '%'}`));
      return r?.n ?? 0;
    });

    if (stored >= COUNT && waiting === 0 && active === 0) break;
  }

  /* ④ الحكم. */
  const ok = stored === COUNT && failed === 0;
  console.log('');
  console.log(`  المضخوخ:   ${COUNT}`);
  console.log(`  المخزَّن:    ${stored}`);
  console.log(`  الفاشل:    ${failed}`);
  console.log(`  قُتل بعد:  ${killedAfter}`);
  console.log('');
  console.log(ok
    ? `✅ نجح التمرين — لم تُضَع رسالةٌ واحدة عبر انقطاعٍ قاسٍ وسط التدفّق`
    : `❌ فشل التمرين — ضاعت ${COUNT - stored} رسالة، وفشلت ${failed} مهمّة`);

  /* ⑤ التنظيف — بالترتيب العكسيّ للمراجع. */
  await withPlatform(db, 'تمرين: حذف أثر الاختبار', async (tx) => {
    await tx.delete(messages).where(and(
      eq(messages.tenantId, ctx.tenantId), sql`${messages.externalId} like ${TAG + '%'}`,
    ));
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, ctx.tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, ctx.tenantId));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, ctx.tenantId));
    await tx.delete(contacts).where(eq(contacts.tenantId, ctx.tenantId));
  });
  log('نُظّف أثر التمرين (المستأجر يبقى لتمرينٍ لاحق)');

  await q.close();
  await conn.quit();
  await closeDb();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
