/**
 * حذفُ مستأجري التمارين — بمعاملةٍ واحدةٍ وحارسٍ لا يُخطئ في الأسماء.
 *
 * يُشغَّل على الخادم (و`ops/` ليست في الصورة، فتُوصَل وقت التشغيل):
 *   docker compose run --rm --no-deps -v "$HOME/aibot/ops:/app/ops:ro" \
 *     api node --import tsx ops/purge-drill-tenants.ts            # تجربةٌ ترتدّ
 *   … -e PURGE_APPLY=1 … node --import tsx ops/purge-drill-tenants.ts   # تنفيذ
 *
 * ★ لماذا سكربتٌ لا أمرُ `psql` واحد: أمرُ الحذف نفسه سطرٌ واحد — والخطرُ كلُّه
 *   في الاسم. `slug LIKE 'drill%'` يقرأ صحيحاً اليوم، ويحذف مستأجراً حقيقيّاً
 *   اسمه `drilling-co` غداً. فالأسماء تُعدّ صراحةً، وتُطابَق تماماً، وتُقارَن
 *   بقائمةٍ محميّةٍ قبل أن تُلمس القاعدة.
 *
 * ★ ولماذا التجربةُ تحذف فعلاً ثمّ ترتدّ بدل أن «تتخيّل»: ما يُراد إثباته هو
 *   سلوكُ CASCADE وغيابُ الأيتام — وذاك لا يُثبت إلّا بحذفٍ حقيقيّ. تجربةٌ
 *   تَعدّ الصفوف ولا تحذفها تُثبت العدّ لا الحذف.
 *
 * ★ والترتيب: `ON DELETE CASCADE` قائمٌ من `tenants` على الجداول الخمسة
 *   والعشرين كلِّها (`0000_init.sql` يشرح لماذا)، فصفٌّ واحدٌ محذوفٌ من
 *   `tenants` هو المعاملةُ الواحدةُ التي تحترم التسلسل. والسكربت لا يثق بذلك:
 *   يَعدّ الأيتام بعد الحذف وقبل الإقرار، ويرتدّ إن وجد واحداً.
 */
import { getDb, closeDb, withPlatform, sql } from '../packages/db/src/index';

/* 🔴 المستأجرون الحقيقيّون — بوتاهما يعملان. لا يمسّهما هذا السكربت أبداً. */
const PROTECTED = ['nuskjo', 'baitalsham'] as const;

/* الهدف: يُعدّ صراحةً. لا نمطٌ ولا `LIKE`. */
const TARGETS = [
  'drill', 'drill-price', 'drill-debounce', 'drill-window-cap',
  /* أُضيفت بعد الجولة الثانية من التمارين — وكلُّها تولّد حوادثَ صوريّةً
     تُغرق سيلَ الحوادث وتُخفي الحقيقيّةَ عند العميلَين. */
  'drill-redis', 'drill-network', 'drill-disk', 'drill-provider',
] as const;

/** الجداول المستأجَرة التي يُبحث فيها عن أيتام بعد الحذف. */
const TENANT_TABLES = [
  'ai_keys', 'ai_runs', 'audit_log', 'bot_configs', 'bot_tools', 'bot_versions',
  'channel_identities', 'contacts', 'conversation_windows', 'conversations',
  'health_checks', 'incidents', 'kb_chunks', 'kb_evals', 'kb_retrievals',
  'knowledge_sources', 'messages', 'notifications', 'optouts',
  'push_subscriptions', 'quota_alerts', 'subscriptions', 'tenant_channels',
  'usage_daily', 'users',
] as const;

const APPLY = process.env.PURGE_APPLY === '1';

/* ★ علامةُ الارتداد: صنفٌ مميَّزٌ بذاته لا برسالته. مقارنةُ نصوص الأخطاء هي
     كيف يصير ارتدادٌ مقصودٌ فشلاً صامتاً حين تتغيّر الرسالة. */
class Rollback extends Error {}

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => r as unknown as Row[];
const n = (v: unknown): number => Number(v ?? 0);

/** مصفوفةُ نصوصٍ حرفيّة للاستعلام. الأسماء ثوابتُ الملفّ لا مُدخَلُ منادٍ. */
const textArray = (xs: readonly string[]): ReturnType<typeof sql.raw> =>
  sql.raw(`ARRAY[${xs.map((x) => `'${x}'`).join(',')}]::text[]`);

async function main(): Promise<void> {
  /* ── الحارس الأوّل: قبل أيّ اتّصال. تقاطعٌ بين الهدف والمحميّ = توقّف. */
  const forbidden = TARGETS.filter((t) => (PROTECTED as readonly string[]).includes(t));
  if (forbidden.length > 0) {
    throw new Error(`الهدف يحتوي مستأجراً محميّاً: ${forbidden.join(', ')}`);
  }

  const db = getDb();
  let applied = false;

  try {
    await withPlatform(db, 'تنظيف: حذف مستأجري تمارين الفشل واختبار التحمّل', async (tx) => {
      const found = rows(await tx.execute(sql`
        SELECT id, slug FROM tenants WHERE slug = ANY(${textArray(TARGETS)}) ORDER BY slug`));

      const missing = TARGETS.filter((t) => !found.some((f) => f.slug === t));
      if (missing.length > 0) console.log(`  غير موجودٍ أصلاً: ${missing.join(', ')}`);
      if (found.length === 0) { console.log('لا شيء يُحذف.'); return; }

      /* ── الحارس الثاني: المعرّفات لا الأسماء. سطرٌ اسمه `drill` ومعرّفه
            معرّفُ نُسك يمرّ من الحارس الأوّل ولا يمرّ من هذا. */
      const prot = rows(await tx.execute(sql`
        SELECT id, slug FROM tenants WHERE slug = ANY(${textArray(PROTECTED)})`));
      if (prot.length !== PROTECTED.length) {
        throw new Error(`المحميّون ${prot.length}/${PROTECTED.length} — لا حذفَ على قاعدةٍ لا أعرفها`);
      }
      const protIds = new Set(prot.map((p) => String(p.id)));
      for (const f of found) {
        if (protIds.has(String(f.id))) {
          throw new Error(`معرّفُ الهدف ${String(f.slug)} هو معرّفُ مستأجرٍ محميّ — توقّف`);
        }
      }

      /* بصمةُ ما يجب أن يبقى كما هو — تُقارَن بعد الحذف. */
      const snapshot = (): ReturnType<typeof tx.execute> => tx.execute(sql`
        SELECT (SELECT count(*) FROM tenants)                                  AS tenants,
               (SELECT count(*) FROM messages)                                 AS messages,
               (SELECT count(*) FROM conversations)                            AS conversations,
               (SELECT count(*) FROM incidents)                                AS incidents,
               (SELECT count(*) FROM users)                                    AS users,
               (SELECT count(*) FROM tenants WHERE slug = ANY(${textArray(PROTECTED)})) AS prot`);
      const before = rows(await snapshot())[0] ?? {};

      console.log('\n── سيُحذف');
      for (const f of found) console.log(`  ${String(f.slug).padEnd(18)} ${String(f.id)}`);

      /* ── الحذف: صفٌّ واحدٌ لكلّ مستأجر، والباقي بـCASCADE ── */
      const ids = found.map((f) => String(f.id));
      const idArray = sql.raw(`ARRAY[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]`);
      const del = rows(await tx.execute(sql`
        WITH gone AS (DELETE FROM tenants WHERE id = ANY(${idArray}) RETURNING slug)
        SELECT count(*)::int AS n FROM gone`))[0] ?? {};
      console.log(`\n  حُذف ${n(del.n)} صفّاً من tenants — والتابع بـCASCADE`);

      /* ── الأيتام: أيّ صفٍّ مستأجَرٍ بمعرّفٍ لا يقابله مستأجر ── */
      const orphans: string[] = [];
      for (const t of TENANT_TABLES) {
        const r = rows(await tx.execute(sql`
          SELECT count(*)::int AS n FROM ${sql.raw(`"${t}"`)} x
           WHERE x.tenant_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM tenants tt WHERE tt.id = x.tenant_id)`))[0] ?? {};
        if (n(r.n) > 0) orphans.push(`${t}=${n(r.n)}`);
      }
      if (orphans.length > 0) throw new Error(`صفوفٌ يتيمة بعد الحذف: ${orphans.join(' · ')}`);
      console.log(`  الأيتام: صفر في ${TENANT_TABLES.length} جدولاً`);

      /* ── والمحميّون: موجودون بعد الحذف كما كانوا قبله ── */
      const after = rows(await snapshot())[0] ?? {};
      if (n(after.prot) !== PROTECTED.length) {
        throw new Error(`اختفى مستأجرٌ محميّ — ${n(after.prot)}/${PROTECTED.length}`);
      }

      console.log('\n── الفرق (قبل ⟶ بعد)');
      for (const k of ['tenants', 'messages', 'conversations', 'incidents', 'users']) {
        console.log(`  ${k.padEnd(14)} ${n(before[k])} ⟶ ${n(after[k])}  (${n(after[k]) - n(before[k])})`);
      }

      if (!APPLY) throw new Rollback('تجربة');
      applied = true;
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    console.log('\n↩ تجربةٌ — ارتدّت المعاملة ولم يُحذف شيء. PURGE_APPLY=1 للتنفيذ.');
    await closeDb();
    return;
  }

  console.log(applied ? '\n✅ نُفِّذ وأُقِرّ.' : '\nلا شيء.');
  await closeDb();
}

main().catch(async (e) => {
  console.error('فشل:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
