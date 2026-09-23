/**
 * تحقّقٌ على الخادم: **كلفةُ الردّ رقمٌ غير صفر، ولا حادثة `price_missing`.**
 *
 * 🔴 العطل الذي وُلد منه: نسخةُ بوتٍ نُشرت على `gemini-3.5-flash-lite` ولا
 *    صفَّ سعرٍ له في `prices`. والغياب **صامتٌ ومزدوج**: كلفةُ كلّ ردٍّ
 *    تُحسب صفراً — فتُظهر التقارير هامشاً كاملاً عن نموذجٍ يُكلّف فعلاً —
 *    وكلُّ ردٍّ يرفع حادثة `price_missing` فتغرق شاشة الحوادث.
 *    (‏تسعةُ أشواطٍ في `ai_runs` بكلفةٍ صفريّة على هذا النموذج بالضبط.)
 *
 * والإصلاح كان **إضافة سعرٍ صحيح** لا تبديلَ النموذج: الاسم ليس خطأً
 * مطبعيّاً، `gemini-3.5-flash-lite` نموذجٌ قائمٌ فعلاً. السعر ومصدره في
 * `packages/db/migrations/0005_price_gemini_3_5_flash_lite.sql`.
 *
 * وهذا السكربت يُجرّب الإصلاح على **نفس النموذج الذي كان بلا سعر** — لا على
 * نموذجٍ آخر مسعَّرٍ من قبل، فذاك لا يُثبت شيئاً. يُنشئ مستأجراً تجريبيّاً
 * ببوتٍ منشورٍ على ذلك النموذج، يضخّ رسالةً واحدة، ثمّ يُثبت:
 *   ① وُجد شوطُ ردٍّ (`ai_runs`) — أي أنّ النموذج نُودي فعلاً،
 *   ② وكلفته **أكبر من صفر**،
 *   ③ ولا `flags.priceMissing` في الشوط،
 *   ④ ولا حادثة `price_missing` لهذا المستأجر.
 *
 * ⚠️ الإرسال إلى واتساب **سيفشل** (توكن الخادم غير صالح) فتُعيد BullMQ مهمّة
 *    الردّ مرّةً (‏`attempts: 2`) — فقد يكون الشوط شوطَين. وهذا لا يُفسد ما
 *    نقيسه: المقيس أنّ **كلّ** شوطٍ كلفته غير صفريّة. والحوادث التي يُولّدها
 *    الإرسال الفاشل تُحذف في التنظيف.
 *
 * يُشغَّل على الخادم:
 *   TENANT_SLUG=drill-price MODEL=gemini-3.5-flash-lite \
 *     node --import tsx apps/worker/scripts/drill-reply-cost.ts
 *
 * ولا يترك أثراً: يحذف ما أنشأه في النهاية ولو فشل.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  getDb, closeDb, withPlatform, tenants, tenantChannels, botConfigs, botVersions,
  contacts, channelIdentities, conversations, messages, conversationWindows,
  aiRuns, incidents, prices,
  eq, and, sql,
} from '@aibot/db';
import { publicId, seal, fingerprint } from '@aibot/crypto';

const SLUG = process.env.TENANT_SLUG ?? 'drill-price';
const PROVIDER = process.env.PROVIDER ?? 'google';
/** النموذج الذي كان بلا سعر — هو المقصود بالتجربة. */
const MODEL = process.env.MODEL ?? 'gemini-3.5-flash-lite';
const FROM = process.env.FROM ?? '962790000888';
const TAG = `price-${Date.now()}`;
const FAKE_TOKEN = 'DRILL_PRICE_FAKE_TOKEN';

function log(msg: string, extra?: unknown): void {
  console.log(extra === undefined ? `  ${msg}` : `  ${msg} ${JSON.stringify(extra)}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

async function main(): Promise<void> {
  const db = getDb();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL غير مضبوط');

  console.log(`\n▶ تحقّق كلفة الردّ — النموذج ${PROVIDER}/${MODEL}\n`);

  /* ① أوّلاً: هل للنموذج صفّ سعرٍ أصلاً؟ فشلٌ هنا يوفّر نداء نموذجٍ بلا داعٍ. */
  const priceRow = await withPlatform(db, 'تحقّق الكلفة: قراءة صفّ سعر النموذج', async (tx) => tx
    .select({ input: prices.input, output: prices.output, cachedInput: prices.cachedInput })
    .from(prices)
    .where(and(eq(prices.provider, PROVIDER), eq(prices.model, MODEL)))
    .limit(1));
  if (!priceRow[0]) {
    throw new Error(`لا صفَّ سعرٍ لـ${PROVIDER}/${MODEL} — طبّق الترحيل 0005 قبل هذا التحقّق`);
  }
  log('صفّ السعر موجود', priceRow[0]);

  /* ② مستأجرٌ تجريبيّ ببوتٍ منشورٍ على ذلك النموذج. */
  const ctx = await withPlatform(db, 'تحقّق الكلفة: تهيئة مستأجر وبوت منشور', async (tx) => {
    let t = (await tx.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
    if (!t) {
      [t] = await tx.insert(tenants).values({
        slug: SLUG, name: 'مستأجر تحقّق الكلفة', status: 'active', publicId: publicId(),
      }).returning();
    }
    const tenantId = t!.id;

    const sealed = seal(FAKE_TOKEN);
    let ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) {
      [ch] = await tx.insert(tenantChannels).values({
        tenantId, kind: 'whatsapp_cloud',
        externalAccountId: `DRILL_${SLUG}`,
        displayName: 'قناة تحقّق الكلفة (توكن تمرين)',
        status: 'connected',
        tokenEnc: sealed.enc, tokenFingerprint: fingerprint(FAKE_TOKEN), keyVersion: sealed.keyVersion,
      }).returning();
    } else {
      await tx.update(tenantChannels).set({
        status: 'connected', tokenEnc: sealed.enc,
        tokenFingerprint: fingerprint(FAKE_TOKEN), keyVersion: sealed.keyVersion,
      }).where(eq(tenantChannels.id, ch.id));
    }
    const channelId = ch!.id;

    /* صفحةٌ بيضاء: أشواطٌ أو حوادثُ من تشغيلٍ سابق تُخلط بنتيجة هذا التشغيل. */
    await tx.delete(aiRuns).where(eq(aiRuns.tenantId, tenantId));
    await tx.delete(incidents).where(eq(incidents.tenantId, tenantId));
    await tx.delete(messages).where(eq(messages.tenantId, tenantId));
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, tenantId));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, tenantId));
    await tx.delete(contacts).where(eq(contacts.tenantId, tenantId));

    /* نسخةٌ منشورة على النموذج المقصود. معرفةٌ قصيرةٌ جدّاً: وضع `full`
       فلا تضمينَ يُنتظر، وسياقٌ صغير فلا كلفةَ بلا مقابل. */
    const last = (await tx.select({ v: botVersions.version }).from(botVersions)
      .where(eq(botVersions.tenantId, tenantId)).orderBy(sql`version desc`).limit(1))[0];
    const [ver] = await tx.insert(botVersions).values({
      tenantId,
      version: (last?.v ?? 0) + 1,
      persona: 'أنت موظّف خدمة زبائن لمحلّ تمرين. أجب بسطرٍ واحدٍ قصير.',
      knowledgeBase: 'ساعات العمل من ٩ صباحاً إلى ٥ مساءً.',
      provider: PROVIDER,
      model: MODEL,
      knowledgeMode: 'full',
      embedStatus: 'skipped',
      publishedAt: new Date(),
      note: 'تحقّق كلفة الردّ',
    }).returning();

    const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
    if (!cfg) {
      await tx.insert(botConfigs).values({ tenantId, enabled: true, publishedVersionId: ver!.id });
    } else {
      await tx.update(botConfigs).set({ enabled: true, publishedVersionId: ver!.id })
        .where(eq(botConfigs.tenantId, tenantId));
    }

    return { tenantId, channelId, versionId: ver!.id };
  });
  log('مستأجر التحقّق جاهز، والبوت مفعَّل على النموذج المقصود', ctx);

  const conn = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const inbound = new Queue('ch-inbound', { connection: conn });

  let ok = false;
  try {
    /* ③ رسالةٌ واحدة — نداءُ نموذجٍ واحدٌ يكفي للقياس. */
    await inbound.add('inbound', {
      tenantId: ctx.tenantId,
      channelId: ctx.channelId,
      kind: 'whatsapp_cloud' as const,
      parsed: {
        messages: [{
          externalId: `${TAG}-0`,
          from: FROM,
          fromHandle: 'زبون تحقّق الكلفة',
          at: new Date(),
          type: 'text' as const,
          text: 'شو ساعات العمل؟',
          buttonPayload: null,
          mediaId: null,
          raw: { drill: 'price' },
        }],
        statuses: [],
        accountEvents: [],
      },
    }, { attempts: 3, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: 1000 });
    log('ضُخَّت رسالةٌ واحدة');

    /* ④ انتظار شوط الردّ: تأخير الدمج 2s + نداء النموذج + هامش. */
    const deadline = Date.now() + 90_000;
    let runs: Array<{
      id: string; model: string; cost: string; prompt: number; output: number;
      thoughts: number; cached: number; flags: Record<string, unknown>;
    }> = [];
    while (Date.now() < deadline) {
      await sleep(1500);
      runs = await withPlatform(db, 'تحقّق الكلفة: قراءة أشواط الردّ', async (tx) => (await tx
        .select({
          id: aiRuns.id, model: aiRuns.model, cost: aiRuns.costUsd,
          prompt: aiRuns.promptTokens, output: aiRuns.outputTokens,
          thoughts: aiRuns.thoughtsTokens, cached: aiRuns.cachedTokens, flags: aiRuns.flags,
        })
        .from(aiRuns)
        .where(eq(aiRuns.tenantId, ctx.tenantId)))
        .map((r) => ({ ...r, flags: (r.flags ?? {}) as Record<string, unknown> })));
      if (runs.length) break;
    }

    const priceMissing = await withPlatform(db, 'تحقّق الكلفة: عدّ حوادث price_missing', async (tx) => tx
      .select({ n: sql<number>`count(*)::int` })
      .from(incidents)
      .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.kind, 'price_missing'))));
    const missingIncidents = priceMissing[0]?.n ?? 0;

    const allIncidents = await withPlatform(db, 'تحقّق الكلفة: قراءة حوادث التمرين', async (tx) => tx
      .select({ kind: incidents.kind, n: incidents.count })
      .from(incidents)
      .where(eq(incidents.tenantId, ctx.tenantId)));

    const nonZero = runs.length > 0 && runs.every((r) => Number(r.cost) > 0);
    const flagClean = runs.every((r) => r.flags.priceMissing !== true);
    ok = runs.length > 0 && nonZero && flagClean && missingIncidents === 0;

    console.log('');
    console.log(`  أشواط الردّ:          ${runs.length}`);
    for (const r of runs) {
      console.log(`     ${r.model} · توكنز ${r.prompt}/${r.output}+${r.thoughts} (كاش ${r.cached})`
        + ` · كلفة $${r.cost}${r.flags.priceMissing === true ? '  ⚠ priceMissing' : ''}`);
    }
    console.log(`  حوادث price_missing:  ${missingIncidents}`);
    console.log(`  حوادثُ أخرى للتمرين:  ${allIncidents.map((i) => `${i.kind}×${i.n}`).join(' · ') || '—'}`);
    console.log('');
    console.log(ok
      ? `✅ نجح التحقّق — كلفةُ كلّ شوطٍ على ${MODEL} رقمٌ غير صفر، ولا حادثة price_missing`
      : runs.length === 0
        ? `❌ فشل التحقّق — لا شوطَ ردٍّ إطلاقاً: النموذج ${MODEL} لم يُنادَ أو رفضه المزوّد`
        : `❌ فشل التحقّق — كلفةٌ صفريّة أو حادثةُ سعرٍ ناقص`);
    console.log('  ⓘ فشل الإرسال إلى واتساب متوقَّع (توكن تمرين) ولا يمسّ ما يقيسه هذا السكربت.');
  } finally {
    /* ⑤ التنظيف — بالترتيب العكسيّ للمراجع، والبوت يُطفأ فلا يردّ بعد الآن. */
    await withPlatform(db, 'تحقّق الكلفة: حذف أثر الاختبار', async (tx) => {
      await tx.update(botConfigs).set({ enabled: false, publishedVersionId: null })
        .where(eq(botConfigs.tenantId, ctx.tenantId));
      await tx.delete(aiRuns).where(eq(aiRuns.tenantId, ctx.tenantId));
      await tx.delete(incidents).where(eq(incidents.tenantId, ctx.tenantId));
      await tx.delete(messages).where(eq(messages.tenantId, ctx.tenantId));
      await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, ctx.tenantId));
      await tx.delete(conversations).where(eq(conversations.tenantId, ctx.tenantId));
      await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, ctx.tenantId));
      await tx.delete(contacts).where(eq(contacts.tenantId, ctx.tenantId));
      await tx.delete(botVersions).where(eq(botVersions.tenantId, ctx.tenantId));
    }).catch(() => undefined);
    log('نُظّف أثر التحقّق، والبوت التجريبيّ مطفأ');
    await inbound.close().catch(() => undefined);
    await conn.quit().catch(() => undefined);
    await closeDb().catch(() => undefined);
  }

  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التحقّق:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
