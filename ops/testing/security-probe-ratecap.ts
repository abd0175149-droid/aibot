/**
 * إثباتُ سقف الساحة (١٠/دقيقة) على الخادم الحيّ — مراجعة ٠٥.٩ البند ⑧.
 *
 * ★ لماذا صفوفٌ مصنوعةٌ لا أحدَ عشرَ نداءً حقيقيّاً: السقفُ محسوبٌ من
 *   `ai_runs` نفسِها (‏`source='playground'` في الدقيقة الأخيرة)، وفحصُه يقع
 *   **قبل** أيّ نداءٍ للنموذج. فعشرةُ صفوفٍ تُنصب الشرط، ونداءٌ واحدٌ يُثبت
 *   أنّ الحارس يطلق — بلا أحد عشر نداءً يُحاسَب عليها أحدٌ.
 *
 * ولا يُشغَّل إلّا على مستأجرِ تمرين، والصفوف بكلفةٍ صفرٍ ووسمٍ يُميّزها.
 *
 * الاستعمال (على الخادم):
 *   docker compose run --rm --no-deps -v "$HOME/aibot/ops:/app/ops:ro" \
 *     -e TENANT_SLUG=drill -e ACTION=fill|clear \
 *     api node --import tsx ops/testing/security-probe-ratecap.ts
 */
import {
  getDb, closeDb, withPlatform, withTenant, tenants, aiRuns, eq, and, sql,
} from '../../packages/db/src/index';

/** حاجزٌ صلب: لا يُلمس مستأجرٌ حقيقيّ من سكربت تمرين. */
const ALLOWED = new Set(['drill', 'drill-price', 'drill-debounce', 'drill-window-cap']);

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG ?? 'drill';
  if (!ALLOWED.has(slug)) throw new Error(`slug غير مسموح للتمرين: ${slug}`);
  const action = process.env.ACTION ?? 'fill';
  const count = Number(process.env.COUNT ?? '10');

  const db = getDb();
  const t = await withPlatform(db, 'تمرين أمنيّ: إيجاد مستأجر التمرين', async (tx) =>
    (await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1))[0]);
  if (!t) throw new Error(`لا مستأجر بـslug=${slug}`);

  const out = await withTenant(db, t.id, async (tx) => {
    if (action === 'clear') {
      const del = await tx.delete(aiRuns).where(and(
        eq(aiRuns.tenantId, t.id),
        eq(aiRuns.source, 'playground'),
        sql`${aiRuns.contextMeta}->>'probe' = 'ratecap'`,
      )).returning({ id: aiRuns.id });
      return { action, removed: del.length };
    }
    for (let i = 0; i < count; i += 1) {
      await tx.insert(aiRuns).values({
        tenantId: t.id, conversationId: null, source: 'playground',
        provider: 'google', model: 'probe-no-model',
        calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0,
        costUsd: '0', latencyMs: 0,
        contextMeta: { probe: 'ratecap', i },
      });
    }
    const n = (await tx.select({ n: sql<number>`count(*)::int` }).from(aiRuns).where(and(
      eq(aiRuns.tenantId, t.id), eq(aiRuns.source, 'playground'),
      sql`${aiRuns.createdAt} > now() - interval '1 minute'`,
    )))[0]?.n ?? 0;
    return { action, inserted: count, recentLastMinute: n };
  });

  console.log(JSON.stringify(out));
  await closeDb();
}

main().catch((e) => { console.error('فشل:', e); process.exit(1); });
