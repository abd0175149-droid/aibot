/**
 * ★ **إعادةُ تسعير ما مضى — فعلٌ صريحٌ مسجَّلٌ، لا وعدٌ ضمنيٌّ لا يقع.**
 *
 *   الكلفةُ تُجمَّد لحظةَ النداء في `ai_runs.cost_usd` وتُجمَع في
 *   `conversation_windows.ai_cost_usd` — كفاتورة. وكان مكتوباً في `pricing.ts`
 *   و`0005` أنّ «تصحيحَ سعرٍ يصحّح التاريخَ كلَّه» ولم يكن شيءٌ يفعله: تسعةُ
 *   أشواطٍ بقيت بصفرٍ بعد إضافة سعرِ نموذجها. فإن أُريد أثرٌ رجعيٌّ فهو **قرارٌ**
 *   يُتَّخذ ويُرى: تجربةٌ جافّةٌ تطبع الفرقَ لكلّ عميل، ثمّ كتابةٌ بـ`APPLY=1`،
 *   وسطرٌ في `audit_log` لكلّ عميلٍ مُسّت أرقامُه.
 *
 * يُشغَّل على الخادم من مضيفه (البيئة كما في `drill-kit.ts`):
 *   MODEL=gemini-3.5-flash-lite [PROVIDER=google] [SINCE=2026-09-01] [APPLY=1] \
 *     node --import tsx ops/reprice.ts
 *
 * ⚠️ النوافذُ تُعاد جمعُها من أشواطها بالزمن (`opened_at ≤ created_at < closed_at`)
 *    لأنّ `ai_runs` لا يحمل معرّفَ نافذة — وهذا تقريبٌ صادقٌ لا حسابٌ بديل:
 *    الشوطُ يقع داخل نافذةٍ واحدةٍ في المحادثة نفسِها بالتعريف.
 */
import { getDb, closeDb, withPlatform, sql } from '../packages/db/src/index';
import { computeCost } from '../packages/ai/src/index';

const MODEL = process.env.MODEL ?? '';
const PROVIDER = process.env.PROVIDER ?? 'google';
const SINCE = process.env.SINCE ? new Date(process.env.SINCE) : null;
const APPLY = process.env.APPLY === '1';
const CHUNK = 500;

interface RunRow {
  id: string; tenant_id: string; conversation_id: string | null;
  prompt_tokens: number; output_tokens: number; thoughts_tokens: number; cached_tokens: number; total_tokens: number;
  cost_usd: string; created_at: Date;
}
interface PriceRowDb { input: number; output: number; cachedInput: number | null; effective_from: Date }

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function main(): Promise<void> {
  if (!MODEL) throw new Error('MODEL مطلوب — مثال: MODEL=gemini-3.5-flash-lite');
  if (SINCE && Number.isNaN(SINCE.getTime())) throw new Error('SINCE ليس تاريخاً صالحاً');
  const db = getDb();

  await withPlatform(db, `إعادةُ تسعير أشواط ${MODEL}`, async (tx) => {
    const [price] = (await tx.execute(sql`
      SELECT input::float AS input, output::float AS output, cached_input::float AS "cachedInput", effective_from
        FROM prices WHERE provider = ${PROVIDER} AND model = ${MODEL}
       ORDER BY effective_from DESC LIMIT 1
    `)) as unknown as PriceRowDb[];
    if (!price) throw new Error(`لا صفَّ سعرٍ لـ${PROVIDER}/${MODEL} في prices — أضِفه أوّلاً`);

    const runs = (await tx.execute(sql`
      SELECT id, tenant_id, conversation_id, prompt_tokens, output_tokens, thoughts_tokens, cached_tokens,
             total_tokens, cost_usd::text AS cost_usd, created_at
        FROM ai_runs
       WHERE provider = ${PROVIDER} AND model = ${MODEL} AND source = 'live'
         ${SINCE ? sql`AND created_at >= ${SINCE.toISOString()}::timestamptz` : sql``}
       ORDER BY created_at
    `)) as unknown as RunRow[];

    const changes = runs
      .map((r) => ({
        ...r,
        next: computeCost({
          promptTokens: r.prompt_tokens, outputTokens: r.output_tokens, thoughtsTokens: r.thoughts_tokens,
          cachedTokens: r.cached_tokens, totalTokens: r.total_tokens,
        }, { input: price.input, output: price.output, cachedInput: price.cachedInput }),
      }))
      .filter((c) => Math.abs(c.next - Number(c.cost_usd)) >= 5e-7);

    const byTenant = new Map<string, { n: number; old: number; next: number }>();
    for (const c of changes) {
      const a = byTenant.get(c.tenant_id) ?? { n: 0, old: 0, next: 0 };
      a.n += 1; a.old += Number(c.cost_usd); a.next += c.next;
      byTenant.set(c.tenant_id, a);
    }

    console.log(`\n▶ ${PROVIDER}/${MODEL} — السعرُ الساري منذ ${price.effective_from.toISOString()}: إدخال $${price.input} · إخراج $${price.output} · كاش ${price.cachedInput == null ? '—' : `$${price.cachedInput}`}`);
    console.log(`  أشواطٌ مفحوصة: ${runs.length} · تتغيّر كلفتُها: ${changes.length}`);
    for (const [t, a] of byTenant) {
      console.log(`  · ${t}: ${a.n} شوطاً — من $${a.old.toFixed(6)} إلى $${a.next.toFixed(6)}`);
    }
    if (!changes.length) { console.log('  لا شيءَ يتغيّر.'); return; }
    if (!APPLY) { console.log('\n  تجربةٌ جافّة — لم يُكتب شيء. أضِف APPLY=1 للكتابة.\n'); return; }

    for (const part of chunks(changes, CHUNK)) {
      await tx.execute(sql`
        UPDATE ai_runs r SET cost_usd = v.c::numeric
          FROM (VALUES ${sql.join(part.map((c) => sql`(${c.id}::uuid, ${String(c.next)})`), sql`, `)}) AS v(id, c)
         WHERE r.id = v.id
      `);
    }

    const convIds = [...new Set(changes.map((c) => c.conversation_id).filter((x): x is string => Boolean(x)))];
    for (const part of chunks(convIds, CHUNK)) {
      await tx.execute(sql`
        UPDATE conversation_windows w SET ai_cost_usd = coalesce(s.total, 0)
          FROM (SELECT w2.id, sum(r.cost_usd) AS total
                  FROM conversation_windows w2
                  LEFT JOIN ai_runs r ON r.conversation_id = w2.conversation_id AND r.source = 'live'
                                     AND r.created_at >= w2.opened_at
                                     AND r.created_at < coalesce(w2.closed_at, w2.expires_at)
                 WHERE w2.conversation_id IN (${sql.join(part.map((id) => sql`${id}::uuid`), sql`, `)})
                 GROUP BY w2.id) s
         WHERE w.id = s.id
      `);
    }

    /* الأثرُ لكلّ عميلٍ مُسّت أرقامُه — بلا فاعلٍ بشريٍّ (سكربتُ تشغيل)، والسببُ في diff. */
    for (const [t, a] of byTenant) {
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
        VALUES (${t}::uuid, NULL, 'platform.reprice', 'tenant', ${t}::uuid,
                ${JSON.stringify({ provider: PROVIDER, model: MODEL, runs: a.n, oldUsd: a.old, newUsd: a.next, since: SINCE?.toISOString() ?? null })}::jsonb)
      `);
    }
    console.log(`\n✅ أُعيد تسعيرُ ${changes.length} شوطاً لدى ${byTenant.size} عميلاً، وجُمعت نوافذُ ${convIds.length} محادثة.\n`);
  });
}

/* ⚠️ لا `await` في المستوى الأعلى: `tsx` على الخادم يُحوّل إلى CJS. نفسُ الشكل في بقيّة `ops`. */
main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error('فشل:', (e as Error).message);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
