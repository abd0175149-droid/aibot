/**
 * شرط قبول المرحلة الأولى: **ثلاث رسائل متتالية ⟶ ردٌّ واحد.**
 *
 * ★ لماذا هذا السكربت موجود: المنطق (`decideEnqueue` + `enqueueReply`) مغطّى
 *   بوحداتٍ تُمرّر الحالات الخمس، لكنّ الوحدة تفحص **القرار** لا **الأثر**.
 *   والعطل الذي وُلدت منه الدالّة كان في الأثر وحده: BullMQ **يتجاهل بصمت**
 *   `add` بمعرّفٍ موجود، فبقاءُ المهمّة في مجموعة `completed` حجز المعرّف
 *   إلى الأبد — كلّ محادثةٍ تأخذ ردّاً واحداً في عمرها كلّه والباقي يُهمَل،
 *   ولا سطرَ في السجلّ يدلّ عليه. مثل هذا لا يمسكه إلّا ريدِسٌ حقيقيّ.
 *
 * ماذا يقيس بالضبط: **الدمج**. يضخّ ثلاث رسائل في محادثةٍ واحدة بفواصل
 * أقصرَ من تأخير الدمج، ثمّ يُثبت أربعة أشياء على طابور `bot-reply` الحقيقيّ:
 *   ① مهمّةُ ردٍّ **واحدة** لهذه المحادثة في كلّ مجموعات الطابور — لا ثلاث.
 *   ② ولا مهمّةٌ جانبيّة (`-next-`) بجانبها.
 *   ③ وأنّها **نُفِّذت فعلاً** (`finishedOn` مضبوط، ومحاولةٌ واحدة) — فلا
 *      يمرّ التمرين على طابورٍ متوقّف فيُعلن نجاحاً عن لا شيء.
 *   ④ وأنّها نُفِّذت **بعد** وصول الرسالة الأخيرة — وهذا ما يفرّق «دُمِجت
 *      الثلاث» عن «رُدَّ على الأولى وأُهملت الأخريان».
 *
 * ولماذا البوت **مطفأ**: نعزل الخاصيّة المُختبَرة. الدمج كلّه في
 * `enqueueReply` قبل أن يُنادى نموذج، وتمكينُ البوت يُضيف نداءَ نموذجٍ
 * وكلفةً ومحاولةَ إرسالٍ إلى توكن واتساب غير صالحٍ على هذا الخادم — والإرسال
 * الفاشل يُفشل مهمّة الردّ فتُعيدها BullMQ (‏`attempts: 2`) فيصير عدد الأشواط
 * اثنَين لسببٍ لا علاقة له بالدمج. أي أنّ تمكين البوت **يُفسد القياس نفسه**.
 * والعامل يستلم المهمّة ويُنفّذها ويخرج عند بوّابة `cfg.enabled`، فالمقيس هو
 * عددُ أشواط الردّ: شوطٌ واحد ⟶ ردٌّ واحد على الأكثر.
 * (كلفةُ الردّ وسعرُ النموذج يُقاسان في `drill-reply-cost.ts`.)
 *
 * يُشغَّل على الخادم:
 *   TENANT_SLUG=drill-debounce COUNT=3 GAP_MS=400 \
 *     node --import tsx apps/worker/scripts/drill-debounce.ts
 *
 * ولا يترك أثراً: يحذف ما أنشأه في النهاية ولو فشل.
 */
import { Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import {
  getDb, closeDb, withPlatform, tenants, tenantChannels, botConfigs,
  contacts, channelIdentities, conversations, messages, conversationWindows,
  eq, and, sql,
} from '@aibot/db';
import { publicId } from '@aibot/crypto';

const SLUG = process.env.TENANT_SLUG ?? 'drill-debounce';
const COUNT = Number(process.env.COUNT ?? '3');
/** تأخير الدمج في `enqueueReply` = 2000ms. الفاصل **أقصر** منه بكثيرٍ عمداً. */
const GAP_MS = Number(process.env.GAP_MS ?? '400');
const REPLY_DELAY_MS = 2000;
/** رقمٌ واحد لكلّ التمرين: ثلاث رسائل من نفس الزبون = محادثةٌ واحدة. */
const FROM = process.env.FROM ?? '962790000777';
const TAG = `debounce-${Date.now()}`;

function log(msg: string, extra?: unknown): void {
  console.log(extra === undefined ? `  ${msg}` : `  ${msg} ${JSON.stringify(extra)}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** حمولةٌ بشكل واتساب الحقيقيّ — نفس المحلّل، فلا مسارٌ موازٍ يُختبر. */
function inboundJob(tenantId: string, channelId: string, i: number) {
  return {
    tenantId,
    channelId,
    kind: 'whatsapp_cloud' as const,
    parsed: {
      messages: [{
        externalId: `${TAG}-${i}`,
        from: FROM,
        fromHandle: 'زبون تمرين الدمج',
        at: new Date(),
        type: 'text' as const,
        text: `سطر ${i + 1} من ${COUNT}`,
        buttonPayload: null,
        mediaId: null,
        raw: { drill: 'debounce', i },
      }],
      statuses: [],
      accountEvents: [],
    },
  };
}

/** كلّ مجموعات الطابور — فمهمّةٌ مخفيّةٌ في حالةٍ لا نفحصها تُنتج حكماً كاذباً. */
const ALL_STATES = [
  'waiting', 'waiting-children', 'prioritized', 'active', 'delayed', 'paused', 'completed', 'failed',
] as const;

async function replyJobsFor(q: Queue, conversationId: string): Promise<Job[]> {
  const jobs = await q.getJobs([...ALL_STATES], 0, 2000);
  return jobs.filter((j) => (j.data as { conversationId?: string } | undefined)?.conversationId === conversationId);
}

async function main(): Promise<void> {
  const db = getDb();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL غير مضبوط');

  console.log(`\n▶ تمرين الدمج — ${COUNT} رسالة بفواصل ${GAP_MS}ms (تأخير الدمج ${REPLY_DELAY_MS}ms)\n`);

  /* ① مستأجرٌ وقناةٌ للتمرين، ببوتٍ مطفأ — والسبب في رأس الملفّ. */
  const ctx = await withPlatform(db, 'تمرين الدمج: تهيئة مستأجر وقناة للاختبار', async (tx) => {
    let t = (await tx.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
    if (!t) {
      [t] = await tx.insert(tenants).values({
        slug: SLUG, name: 'مستأجر تمرين الدمج', status: 'active', publicId: publicId(),
      }).returning();
    }
    let ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, t!.id), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) {
      [ch] = await tx.insert(tenantChannels).values({
        tenantId: t!.id, kind: 'whatsapp_cloud',
        externalAccountId: `DRILL_${SLUG}`,
        displayName: 'قناة تمرين الدمج (لا ترسل شيئاً)',
        status: 'connected',
      }).returning();
    }
    const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, t!.id)).limit(1))[0];
    if (!cfg) await tx.insert(botConfigs).values({ tenantId: t!.id, enabled: false });
    else if (cfg.enabled) {
      await tx.update(botConfigs).set({ enabled: false }).where(eq(botConfigs.tenantId, t!.id));
    }

    /* ★ صفحةٌ بيضاء: محادثةٌ باقيةٌ من تشغيلٍ سابق تعني معرّفَ مهمّةٍ محجوزاً
       في `completed` — وهي بعينها العلّة التي يقيسها هذا التمرين، فتُخلط
       بقايا التشغيل السابق بنتيجة هذا التشغيل. */
    await tx.delete(messages).where(eq(messages.tenantId, t!.id));
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, t!.id));
    await tx.delete(conversations).where(eq(conversations.tenantId, t!.id));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, t!.id));
    await tx.delete(contacts).where(eq(contacts.tenantId, t!.id));

    return { tenantId: t!.id, channelId: ch!.id };
  });
  log('مستأجر التمرين جاهز، والبوت مطفأ', ctx);

  const conn = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const inbound = new Queue('ch-inbound', { connection: conn });
  const reply = new Queue('bot-reply', { connection: conn });

  let ok = false;
  let convId = '';
  let jobs: Job[] = [];
  let stored = 0;
  let lastStoredAt = 0;

  try {
    /* ② الضخّ — بفواصل أقصر من تأخير الدمج. */
    for (let i = 0; i < COUNT; i += 1) {
      await inbound.add('inbound', inboundJob(ctx.tenantId, ctx.channelId, i), {
        attempts: 3, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: 1000,
      });
      if (i < COUNT - 1) await sleep(GAP_MS);
    }
    log(`ضُخَّت ${COUNT} رسالة في محادثةٍ واحدة`);

    /* ③ انتظار وصول الرسائل إلى القاعدة — وهذا شرطُ صحّة القياس لا نتيجته:
       لو تأخّر الوارد حتّى انقضى تأخير الدمج لصار «ردَّان» سلوكاً صحيحاً،
       فالتمرين يُعلن أنّه لم يقس شيئاً بدل أن يُعلن فشلاً كاذباً. */
    const storeDeadline = Date.now() + 30_000;
    while (Date.now() < storeDeadline) {
      const rows = await withPlatform(db, 'تمرين الدمج: عدّ الرسائل المخزَّنة', async (tx) => tx
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(eq(messages.tenantId, ctx.tenantId), sql`${messages.externalId} like ${TAG + '%'}`)));
      stored = rows[0]?.n ?? 0;
      if (stored >= COUNT) break;
      await sleep(150);
    }
    lastStoredAt = Date.now();
    log(`وصلت ${stored} رسالة إلى القاعدة`);

    const convRows = await withPlatform(db, 'تمرين الدمج: قراءة محادثة التمرين', async (tx) => tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.tenantId, ctx.tenantId)));
    if (convRows.length !== 1) {
      throw new Error(`توقّعتُ محادثةً واحدة فوجدتُ ${convRows.length} — الرسائل كلّها من نفس الرقم`);
    }
    convId = convRows[0]!.id;
    log('محادثة التمرين', { convId });

    /* ④ انتظار استواء مهامّ الردّ: التأخير + هامشٌ للتنفيذ. */
    const settleDeadline = Date.now() + REPLY_DELAY_MS + 30_000;
    while (Date.now() < settleDeadline) {
      await sleep(500);
      const pending = (await replyJobsFor(reply, convId)).filter((j) => !j.finishedOn);
      if (Date.now() - lastStoredAt > REPLY_DELAY_MS + 4_000 && pending.length === 0) break;
    }

    jobs = await replyJobsFor(reply, convId);

    /* ⑤ الحكم — الشروط مجتمعةً. */
    const finished = jobs.filter((j) => j.finishedOn);
    const attempts = jobs.reduce((n, j) => n + Math.max(1, j.attemptsMade), 0);
    const sidecars = jobs.filter((j) => String(j.id ?? '').includes('-next-'));
    /* نُفِّذت بعد آخر رسالة: نسمح بهامشٍ للفرق بين ساعة هذه العمليّة وساعة
       العامل، ونطرح تأخير الدمج لأنّ `processedOn` يقع بعده بطبيعته. */
    const ranAfterLast = finished.every((j) => (j.processedOn ?? 0) >= lastStoredAt - REPLY_DELAY_MS);

    ok = stored === COUNT
      && jobs.length === 1
      && finished.length === 1
      && attempts === 1
      && sidecars.length === 0
      && ranAfterLast;

    console.log('');
    console.log(`  الرسائل المضخوخة:  ${COUNT}`);
    console.log(`  الرسائل المخزَّنة:   ${stored}`);
    console.log(`  مهامّ الردّ:         ${jobs.length}   ${jobs.map((j) => j.id).join(' · ') || '—'}`);
    console.log(`  منها مُنفَّذة:       ${finished.length}`);
    console.log(`  مجموع المحاولات:  ${attempts}`);
    console.log(`  مهامّ جانبيّة:      ${sidecars.length}`);
    console.log(`  نُفِّذت بعد الأخيرة: ${ranAfterLast ? 'نعم' : 'لا'}`);
    console.log('');
    console.log(ok
      ? `✅ نجح التمرين — ${COUNT} رسائل متتالية أنتجت شوط ردٍّ **واحداً**`
      : `❌ فشل التمرين — ${jobs.length} مهمّة ردٍّ و${attempts} محاولة لـ${stored} رسالة`);
    if (!ok && stored !== COUNT) {
      console.log('   ⚠ الرسائل لم تصل كلّها — التمرين لم يقس الدمج أصلاً');
    }
  } finally {
    /* ⑥ التنظيف — بالترتيب العكسيّ للمراجع، ولو فشل التمرين. */
    for (const j of jobs) await j.remove().catch(() => undefined);
    await withPlatform(db, 'تمرين الدمج: حذف أثر الاختبار', async (tx) => {
      await tx.delete(messages).where(eq(messages.tenantId, ctx.tenantId));
      await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, ctx.tenantId));
      await tx.delete(conversations).where(eq(conversations.tenantId, ctx.tenantId));
      await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, ctx.tenantId));
      await tx.delete(contacts).where(eq(contacts.tenantId, ctx.tenantId));
    }).catch(() => undefined);
    log('نُظّف أثر التمرين (المستأجر يبقى لتمرينٍ لاحق)');
    await inbound.close().catch(() => undefined);
    await reply.close().catch(() => undefined);
    await conn.quit().catch(() => undefined);
    await closeDb().catch(() => undefined);
  }

  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
