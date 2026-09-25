import { getDb, withPlatform, sql } from '@aibot/db';

/**
 * ★★★ **الاحتفاظ — جداولٌ تنمو بلا سقف، ووعدٌ مكتوبٌ لا يُنفَّذ.**
 *
 *   `retentionDays` بندٌ في `plans.limits` لكلّ باقة (٦٠ · ١٨٠ · ٣٦٥)،
 *   وصفحةُ الخصوصيّة **المنشورة** تقول للزبون: «مدّة الاحتفاظ بالمحادثات بندٌ
 *   في باقة كلّ عميل، وتُحذف آليّاً بعدها». ولم يكن في المستودع كلِّه سطرٌ
 *   واحدٌ يحذف صفّاً — فالوعدُ مكتوبٌ والبيانُ باقٍ إلى الأبد.
 *
 *   وأربعةُ جداولٍ تكبر بلا حدّ على قرصٍ هو أصلاً فوق الثمانين بالمئة:
 *   `health_checks` (صفٌّ لكلّ قناةٍ كلَّ عشر دقائق)، و`ai_runs` (صفٌّ لكلّ
 *   نداءِ نموذج)، و`kb_retrievals` (صفٌّ لكلّ استرجاع)، و`channel_payload`
 *   (حمولةُ كلّ ويبهوك). وقرصٌ يمتلئ لا يُسقط خدمةً واحدة: تتوقّف القاعدةُ عن
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

/**
 * سجلّاتُ المنصّة — ليست بيانات عميلٍ ولا يحكمها `retentionDays`.
 *
 * `health_checks` لا يُقرأ منه إلّا آخرُ صفوفٍ قليلة، و`channel_payload`
 * حمولةٌ خامٌّ تُحفظ للتشخيص وحده.
 */
const PLATFORM_TABLES: Array<{ table: string; column: string; days: number }> = [
  { table: 'health_checks', column: 'checked_at', days: 30 },
  { table: 'channel_payload', column: 'received_at', days: 30 },
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
    }).catch(() => -1);
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
    }).catch(() => -1);
    out.push({ table: t.table, deleted: n });
  }

  return out;
}
