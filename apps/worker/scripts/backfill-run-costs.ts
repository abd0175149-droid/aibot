/**
 * إصلاحٌ بأثرٍ رجعيّ: **أشواطُ ردٍّ كلفتها صفرٌ لأنّ النموذج كان بلا سعر.**
 *
 * 🔴 ما حدث: نُشرت نسخةُ بوتٍ على نموذجٍ لا صفَّ سعرٍ له، فكتب العامل
 *    `cost_usd = 0` في كلّ شوط — **بلا خطأ**. والصفر هنا أخطر من العطل:
 *    تقاريرُ الربحيّة تُظهر هامشاً كاملاً عن نموذجٍ يُكلّفك فعلاً، وكلفةُ
 *    المستأجر في `conversation_windows.ai_cost_usd` تبقى صفراً معها.
 *    وإضافةُ صفّ السعر تُصلح ما يأتي ولا تُصلح ما مضى — فهذا السكربت يُصلحه.
 *
 * ★ الكلفة تُحسب بـ`computeCost` **نفسها** التي يستعملها العامل، لا بصيغةٍ
 *   مكتوبةٍ هنا. صيغةٌ ثانية تتباعد عن الأولى عند أوّل تعديلٍ على تسعير
 *   الكاش، فتصير أرقام الإصلاح أكذبَ من الأصفار التي أصلحها.
 *
 * ★ والسعر يُقرأ **لحظة العرض**: أحدثُ صفٍّ `effective_from <= created_at`
 *   للشوط، تماماً كما يقتضي تعليق جدول `prices`. فسعرٌ يُضاف اليوم بتاريخٍ
 *   سابقٍ يُصحّح التاريخ، وسعرٌ يبدأ غداً لا يُطبَّق على الأمس.
 *
 * ★ ومتَماثِل: لا يلمس إلّا شوطاً كلفته صفرٌ وله توكنزٌ فعليّة وله سعرٌ الآن.
 *   تشغيله مرّتين لا يُغيّر شيئاً في الثانية.
 *
 * ويُحدّث معها `conversation_windows.ai_cost_usd` — وإلّا لبقي مجموع النافذة
 * صفراً بينما أشواطها صارت مسعَّرة، فيتناقض رقمان يُعرَضان معاً على شاشةٍ واحدة.
 *
 * ولماذا هنا لا في `ops/`: يستورد `computeCost` من `@aibot/ai`، و`apps/worker`
 * داخل تغطية `tsc` فمرجعٌ ميّتٌ يسقط قبل الشحن — و`ops/` خارجها.
 *
 * يُشغَّل على الخادم:
 *   [DRY_RUN=1] node --import tsx apps/worker/scripts/backfill-run-costs.ts
 */
import {
  getDb, closeDb, withPlatform, aiRuns, prices, conversationWindows,
  eq, and, lte, desc, gt, sql,
} from '@aibot/db';
import { computeCost } from '@aibot/ai';

const DRY_RUN = process.env.DRY_RUN === '1';

interface Fix {
  runId: string;
  tenantId: string;
  conversationId: string | null;
  model: string;
  cost: number;
}

async function main(): Promise<void> {
  const db = getDb();

  console.log(`\n▶ إصلاح كلفة الأشواط الصفريّة${DRY_RUN ? ' — تجربةٌ جافّة، لا كتابة' : ''}\n`);

  const fixes: Fix[] = [];
  let skippedNoPrice = 0;
  let skippedNoTokens = 0;

  await withPlatform(db, 'إصلاح الكلفة: مسح الأشواط الصفريّة وتسعيرها بسعر لحظتها', async (tx) => {
    const zero = await tx
      .select({
        id: aiRuns.id, tenantId: aiRuns.tenantId, conversationId: aiRuns.conversationId,
        provider: aiRuns.provider, model: aiRuns.model, createdAt: aiRuns.createdAt,
        promptTokens: aiRuns.promptTokens, outputTokens: aiRuns.outputTokens,
        thoughtsTokens: aiRuns.thoughtsTokens, cachedTokens: aiRuns.cachedTokens,
        totalTokens: aiRuns.totalTokens,
      })
      .from(aiRuns)
      .where(sql`${aiRuns.costUsd}::numeric = 0`);

    console.log(`  أشواطٌ كلفتها صفر: ${zero.length}`);

    for (const r of zero) {
      if (r.totalTokens === 0 && r.promptTokens === 0) { skippedNoTokens += 1; continue; }

      /* سعرُ لحظة العرض: أحدثُ صفٍّ سارٍ عند إنشاء الشوط. */
      const p = (await tx.select({
        input: prices.input, output: prices.output, cachedInput: prices.cachedInput,
      }).from(prices)
        .where(and(
          eq(prices.provider, r.provider), eq(prices.model, r.model),
          lte(prices.effectiveFrom, r.createdAt),
        ))
        .orderBy(desc(prices.effectiveFrom)).limit(1))[0];

      if (!p) { skippedNoPrice += 1; continue; }

      const cost = computeCost({
        promptTokens: r.promptTokens, outputTokens: r.outputTokens,
        thoughtsTokens: r.thoughtsTokens, cachedTokens: r.cachedTokens,
        totalTokens: r.totalTokens,
      }, {
        input: Number(p.input), output: Number(p.output),
        cachedInput: p.cachedInput === null ? null : Number(p.cachedInput),
      });

      if (cost <= 0) { skippedNoTokens += 1; continue; }
      fixes.push({
        runId: r.id, tenantId: r.tenantId, conversationId: r.conversationId,
        model: r.model, cost,
      });
    }

    if (DRY_RUN) return;

    for (const f of fixes) {
      await tx.update(aiRuns)
        .set({ costUsd: String(f.cost), flags: sql`${aiRuns.flags} - 'priceMissing'` })
        .where(eq(aiRuns.id, f.runId));

      /* مجموع النافذة يتبع أشواطها — وإلّا تناقض رقمان على شاشةٍ واحدة.
         النافذة تُستنتَج من المحادثة: شوطٌ بلا محادثةٍ (ساحةُ تجريب) لا نافذةَ له. */
      if (!f.conversationId) continue;
      await tx.update(conversationWindows)
        .set({ aiCostUsd: sql`${conversationWindows.aiCostUsd} + ${String(f.cost)}::numeric` })
        .where(and(
          eq(conversationWindows.conversationId, f.conversationId),
          eq(conversationWindows.tenantId, f.tenantId),
        ));
    }
  });

  const total = fixes.reduce((s, f) => s + f.cost, 0);
  const byModel = new Map<string, { n: number; cost: number }>();
  for (const f of fixes) {
    const cur = byModel.get(f.model) ?? { n: 0, cost: 0 };
    byModel.set(f.model, { n: cur.n + 1, cost: cur.cost + f.cost });
  }

  console.log('');
  for (const [model, v] of byModel) {
    console.log(`  ${model}: ${v.n} شوط ⟶ $${v.cost.toFixed(6)}`);
  }
  console.log(`  تُخطّيت (لا سعرَ بعد):   ${skippedNoPrice}`);
  console.log(`  تُخطّيت (لا توكنز):      ${skippedNoTokens}`);
  console.log('');
  console.log(DRY_RUN
    ? `ⓘ تجربةٌ جافّة — كان سيُصحَّح ${fixes.length} شوطاً بمجموع $${total.toFixed(6)}`
    : `✔ صُحِّح ${fixes.length} شوطاً بمجموع $${total.toFixed(6)}`);
  if (skippedNoPrice) {
    console.log('  ⚠ بقيت أشواطٌ بلا سعر — أضِف صفّها في prices ثمّ أعِد التشغيل.');
  }

  /* حارسٌ صغير: هل بقي شوطٌ صفريٌّ له توكنزٌ وسعر؟ */
  const left = await withPlatform(db, 'إصلاح الكلفة: عدّ ما بقي صفريّاً', async (tx) => tx
    .select({ n: sql<number>`count(*)::int` })
    .from(aiRuns)
    .where(and(sql`${aiRuns.costUsd}::numeric = 0`, gt(aiRuns.totalTokens, 0))));
  console.log(`  أشواطٌ صفريّةٌ باقيةٌ بتوكنز: ${left[0]?.n ?? 0}`);

  await closeDb();
}

main().catch(async (e) => {
  console.error('فشل الإصلاح:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
