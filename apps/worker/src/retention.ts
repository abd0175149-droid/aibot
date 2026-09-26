import { getDb, withPlatform, sql } from '@aibot/db';

/** سطرٌ واحدٌ بصيغة السجلّ نفسِها في `main.ts` — بلا استيرادٍ دائريّ. */
function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', svc: 'worker', msg, ...extra }));
}

/**
 * ★★★ **الاحتفاظ — جداولٌ تنمو بلا سقف، ووعدٌ مكتوبٌ لا يُنفَّذ.**
 *
 *   `retentionDays` بندٌ في `plans.limits` لكلّ باقة (٦٠ · ١٨٠ · ٣٦٥)،
 *   وصفحةُ الخصوصيّة **المنشورة** تقول للزبون: «مدّة الاحتفاظ بالمحادثات بندٌ
 *   في باقة كلّ عميل، وتُحذف آليّاً بعدها». ولم يكن في المستودع كلِّه سطرٌ
 *   واحدٌ يحذف صفّاً — فالوعدُ مكتوبٌ والبيانُ باقٍ إلى الأبد.
 *
 *   وأربعةُ جداولٍ تكبر بلا حدّ على قرصٍ هو أصلاً فوق الثمانين بالمئة:
 *   `health_checks` (صفٌّ لكلّ قناةٍ كلَّ عشر دقائق)، و`notifications`، و
 *   `ai_runs` (صفٌّ لكلّ نداءِ نموذج)، و`kb_retrievals` (صفٌّ لكلّ استرجاع).
 *   وقرصٌ يمتلئ لا يُسقط خدمةً واحدة: تتوقّف القاعدةُ عن
 *   الكتابة، ويعجز دوكر عن بدء أيّ حاوية، ويفشل النسخُ الاحتياطيّ الذي كان
 *   سيُنقذ الموقف.
 *
 * ⚠️ **دفعةٌ محدودةٌ في كلّ دورة** لا حذفٌ واحدٌ كبير: البِركةُ عشرُ اتّصالات،
 *    و`DELETE` بلا سقفٍ يحتجز اتّصالاً ويقفل صفوفاً دقائقَ فيتكدّس الويبهوك
 *    خلفه — وحذفٌ يُعطّل الاستلام أسوأُ من جدولٍ كبير. فما لم يُحذف اليوم
 *    يُحذف في الدورة التالية.
 *
 * ⚠️ ولا نداءَ شبكةٍ هنا إطلاقاً: كلُّه SQL.
 */

/** أقصى ما يُحذف من جدولٍ واحدٍ في دورةٍ واحدة. */
const BATCH = 5_000;

/** مستأجرون مؤرشَفون يُمحَون في الدورة الواحدة — كلُّ واحدٍ تعاقبٌ كاملٌ في معاملة. */
const PURGE_TENANTS_PER_CYCLE = 3;

/**
 * سجلّاتُ المنصّة — ليست بيانات عميلٍ ولا يحكمها `retentionDays`.
 *
 * `health_checks` لا يُقرأ منه إلّا آخرُ صفوفٍ قليلة، و`notifications` سجلٌّ
 * يُراجَع لا سيلٌ يُقرأ مرّتين.
 */
const PLATFORM_TABLES: Array<{ table: string; column: string; days: number }> = [
  { table: 'health_checks', column: 'checked_at', days: 30 },
  /* ★ و`notifications` تكبر بلا سقفٍ أيضاً: صفٌّ لكلّ إشعار، وما قُرئ منها
     لا يُقرأ مرّتين. والتسعون يوماً سخيّةٌ عمداً — هي سجلٌّ يُراجَع لا سيل. */
  { table: 'notifications', column: 'created_at', days: 90 },
];

/** بياناتُ العميل — مدّتُها من باقته، وهي الوعدُ المكتوب في صفحة الخصوصيّة. */
const TENANT_TABLES: Array<{ table: string; column: string }> = [
  { table: 'ai_runs', column: 'created_at' },
  { table: 'kb_retrievals', column: 'created_at' },
];

export interface RetentionResult {
  table: string;
  deleted: number;
}

/**
 * يحذف ما تجاوز مدّته، ويُعيد ما حُذف من كلّ جدول.
 *
 * ⚠️ و`ctid` لا `id`: الحذفُ بمفتاحٍ فرعيٍّ محدودٍ بـ`LIMIT` يحتاج تعرّفاً على
 *    الصفّ، و`ctid` أرخصُ ما تملكه Postgres لذلك — ولا فهرسَ يُضاف من أجله.
 */
export async function runRetention(): Promise<RetentionResult[]> {
  const out: RetentionResult[] = [];
  const db = getDb();

  for (const t of PLATFORM_TABLES) {
    /* معاملةٌ لكلّ جدول: فشلُ واحدٍ لا يمنع البقيّة، ولا تُحتجز الاتّصالاتُ
       دفعةً واحدة. */
    const n = await withPlatform(db, `حذفُ ما تجاوز مدّته من ${t.table}`, async (tx) => {
      const r = await tx.execute(sql`
        WITH doomed AS (
          SELECT ctid FROM ${sql.identifier(t.table)}
           WHERE ${sql.identifier(t.column)} < now() - ${`${t.days} days`}::interval
           LIMIT ${BATCH}
        )
        DELETE FROM ${sql.identifier(t.table)} x USING doomed d WHERE x.ctid = d.ctid
      `);
      return (r as unknown as { rowCount?: number }).rowCount ?? 0;
    }).catch((e) => {
      /* ⚠️ **ولا ابتلاعَ صامت.** أوّلُ نسخةٍ من هذا الملفّ ذكرت جدولاً لا
         وجودَ له (`channel_payload`)، و`catch(() => -1)` كانت ستُخفي الخطأ خلف
         رقمٍ غامضٍ كلَّ ستّ ساعاتٍ إلى الأبد — والسببُ لا يُقرأ من `-1`. */
      log(`تعذّر الاحتفاظ في ${t.table}`, { err: String(e) });
      return -1;
    });
    out.push({ table: t.table, deleted: n });
  }

  for (const t of TENANT_TABLES) {
    /* ★ المدّةُ من باقة **كلّ** مستأجرٍ على حدة — لا رقمٌ واحدٌ للجميع: هذا هو
       البندُ المبيع، وتوحيدُه يعني إمّا حذفَ ما دفع العميلُ ليُحفظ أو حفظَ ما
       وعدنا بحذفه. والافتراضُ ٣٦٥ عند غياب الباقة: لا نحذف على الشكّ. */
    const n = await withPlatform(db, `حذفُ ما تجاوز مدّته من ${t.table}`, async (tx) => {
      const r = await tx.execute(sql`
        WITH lim AS (
          SELECT t.id AS tenant_id,
                 coalesce((p.limits->>'retentionDays')::int, 365) AS days
            FROM tenants t
            LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
            LEFT JOIN plans p ON p.id = s.plan_id
        ), doomed AS (
          SELECT x.ctid
            FROM ${sql.identifier(t.table)} x
            JOIN lim ON lim.tenant_id = x.tenant_id
           WHERE x.${sql.identifier(t.column)} < now() - (lim.days || ' days')::interval
           LIMIT ${BATCH}
        )
        DELETE FROM ${sql.identifier(t.table)} y USING doomed d WHERE y.ctid = d.ctid
      `);
      return (r as unknown as { rowCount?: number }).rowCount ?? 0;
    }).catch((e) => {
      log(`تعذّر الاحتفاظ في ${t.table}`, { err: String(e) });
      return -1;
    });
    out.push({ table: t.table, deleted: n });
  }

  /* ★★ **الوعدُ الثالث في صفحة الخصوصيّة: «تصديرٌ كامل، ثمّ حذفٌ بعد ٦٠ يوماً».**
     الأرشفةُ من لوحة المالك تُخفي العميلَ وتطرده، ولا شيءَ كان يحذفه — فبياناتُ
     علاقةٍ انتهت تبقى إلى الأبد. هنا يُحذف صفُّ المستأجر (فتتعاقب كلُّ جداوله)
     بعد ستّين يوماً من أرشفته: مدّةٌ يُطلب فيها التصديرُ ويُتراجَع فيها عن الأرشفة
     بـ«استعِده فعّالاً». ⚠️ ثلاثةٌ في الدورة لا أكثر: التعاقبُ يمسح رسائلَ ونوافذَ
     ومقاطعَ بمعاملةٍ واحدةٍ لكلّ مستأجر. ويُكتب اسمُه في السجلّ قبل المحو: صفوفُ
     `audit_log` تسقط معه، فهذا السطرُ هو الأثرُ الوحيد. */
  const purged = await withPlatform(db, 'حذفُ مستأجرين مؤرشَفين تجاوزوا مهلة الستّين يوماً', async (tx) => {
    const rows = await tx.execute(sql`
      DELETE FROM tenants
       WHERE id IN (
         SELECT id FROM tenants
          WHERE status = 'archived' AND archived_at < now() - ${`${PURGE_ARCHIVED_AFTER_DAYS} days`}::interval
          ORDER BY archived_at ASC
          LIMIT ${PURGE_TENANTS_PER_CYCLE})
       RETURNING id, slug, name, archived_at
    `) as unknown as Array<{ id: string; slug: string; name: string; archived_at: Date }>;
    for (const r of rows) log('حُذف مستأجرٌ مؤرشَفٌ بعد مهلة الستّين يوماً', { tenantId: r.id, slug: r.slug, archivedAt: r.archived_at });
    return rows.length;
  }).catch((e) => {
    log('تعذّر حذفُ المؤرشَفين', { err: String(e) });
    return -1;
  });
  out.push({ table: 'tenants(archived)', deleted: purged });

  return out;
}

/** مهلةُ الأرشفة قبل المحو — الرقمُ المكتوبُ في صفحة الخصوصيّة المنشورة. */
export const PURGE_ARCHIVED_AFTER_DAYS = 60;
