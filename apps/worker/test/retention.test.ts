import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حارسٌ ساكن على مهمّة الاحتفاظ — وُلد من عطلٍ **حدث فعلاً** يوم كتابتها.
 *
 *   أوّلُ نسخةٍ من `retention.ts` حذفت من جدولٍ اسمه `channel_payload`. لا
 *   وجودَ له في المخطَّط إطلاقاً. والملفّ تَرجم (`tsc` لا يعرف أسماءَ الجداول:
 *   هي نصٌّ داخل `sql.identifier`)، ومرّت المراجعة، ولم يُكتشف الأمر إلّا حين
 *   نُفِّذت العبارةُ يدوياً على القاعدة الحيّة داخل `BEGIN … ROLLBACK`:
 *
 *       ERROR:  relation "channel_payload" does not exist
 *
 *   ولو وصلت إلى الإنتاج لكانت فشلت كلَّ ستّ ساعاتٍ صامتةً إلى الأبد — لأنّ
 *   `catch(() => -1)` كانت تُخفي السبب خلف رقم. فالحارسُ هنا يربط اسمَ كلّ
 *   جدولٍ وعمودٍ في المهمّة بمصدرِ الحقيقة الوحيد: تعريفاتُ `pgTable`.
 *
 * ⚠️ ويُفحص الاسمُ بالشكل لا بالنيّة: `sql.identifier('x')` نصٌّ لا نوع، فلا
 *    مترجمٌ ولا مدقّقٌ يمسكه — هذا الملفّ هو المدقّق الوحيد.
 */

const REPO = join(__dirname, '..', '..', '..');
const SRC = readFileSync(join(REPO, 'apps', 'worker', 'src', 'retention.ts'), 'utf8');

/** كلُّ جداول المخطَّط: الاسمُ في القاعدة ← نصُّ تعريفه كما كُتب. */
function schemaTables(): Map<string, string> {
  const dir = join(REPO, 'packages', 'db', 'src', 'schema');
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    /* التعريفُ يبدأ بـ`pgTable('name', {` وينتهي عند التعريف التالي أو نهاية
       الملفّ — ويكفي هذا القدرُ من الدقّة: نحن نبحث عن أسماءِ أعمدةٍ بين
       علامتَي تنصيصٍ داخل كتلةٍ نعرف بدايتها. */
    const re = /pgTable\(\s*'([a-z0-9_]+)'/g;
    const marks: Array<{ name: string; at: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) marks.push({ name: m[1]!, at: m.index });
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1]!.at : src.length;
      out.set(mk.name, src.slice(mk.at, end));
    });
  }
  return out;
}

/** مدخلاتُ `PLATFORM_TABLES` و`TENANT_TABLES` كما كُتبت في المهمّة. */
function retentionEntries(): Array<{ table: string; column: string; tenantScoped: boolean }> {
  const out: Array<{ table: string; column: string; tenantScoped: boolean }> = [];
  for (const [konst, scoped] of [['PLATFORM_TABLES', false], ['TENANT_TABLES', true]] as const) {
    const at = SRC.indexOf(`const ${konst}`);
    expect(at, `${konst} غائب عن retention.ts`).toBeGreaterThan(-1);
    const end = SRC.indexOf('];', at);
    expect(end, `${konst} بلا نهاية`).toBeGreaterThan(at);
    const block = SRC.slice(at, end);
    const re = /table:\s*'([a-z0-9_]+)'\s*,\s*column:\s*'([a-z0-9_]+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      out.push({ table: m[1]!, column: m[2]!, tenantScoped: scoped });
    }
  }
  return out;
}

describe('مهمّةُ الاحتفاظ — الأسماءُ تُطابق المخطَّط', () => {
  const tables = schemaTables();
  const entries = retentionEntries();

  it('تقرأ المهمّةُ أربعةَ جداولٍ على الأقلّ', () => {
    /* لو انكسر الاستخراجُ وأعاد صفراً لمرّت كلُّ الفحوصات أدناه بلا أن تفحص
       شيئاً — وحارسٌ يمرّ على لا شيء أسوأُ من غيابه. */
    expect(entries.length).toBeGreaterThanOrEqual(4);
  });

  it('يُستخرج المخطَّطُ كاملاً (فحصٌ ذاتيٌّ للماسح)', () => {
    expect(tables.size).toBeGreaterThan(20);
    expect(tables.has('health_checks')).toBe(true);
    /* ★ وهذا هو العطلُ نفسه: الجدولُ الذي اختُرع لا يوجد. فإن ظهر يوماً في
       المخطَّط فليُحدَّث هذا السطر — لا أن يُحذف الفحص. */
    expect(tables.has('channel_payload')).toBe(false);
  });

  for (const e of entries) {
    it(`${e.table} موجودٌ في المخطَّط`, () => {
      expect(
        tables.has(e.table),
        `retention.ts يحذف من «${e.table}» ولا تعريفَ له في packages/db/src/schema`,
      ).toBe(true);
    });

    it(`${e.table}.${e.column} عمودٌ حقيقيّ`, () => {
      const decl = tables.get(e.table) ?? '';
      expect(
        decl.includes(`'${e.column}'`),
        `«${e.column}» لا يظهر في تعريف ${e.table}`,
      ).toBe(true);
    });

    if (e.tenantScoped) {
      it(`${e.table} فيه tenant_id (المهمّةُ تربط عليه)`, () => {
        /* عبارةُ المستأجرين تقول `JOIN lim ON lim.tenant_id = x.tenant_id`؛
           جدولٌ بلا هذا العمود يُنتج خطأً وقتَ التنفيذ لا وقتَ الترجمة. */
        expect(tables.get(e.table) ?? '').toContain("'tenant_id'");
      });
    }
  }
});

describe('مهمّةُ الاحتفاظ — لا حذفٌ بلا سقفٍ ولا خطأٌ صامت', () => {
  /* التعليقاتُ تُعمّى قبل كلّ فحصٍ سالب: هذا الملفّ يشرح العطلَ الذي يحرسه
     بأسطرٍ تحمل ذكرَ `catch(() => -1)` نفسِه، فبلا تعمية يمسك الحارسُ شرحَه. */
  const bare = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('كلُّ DELETE محدودٌ بـLIMIT', () => {
    const deletes = (bare.match(/DELETE FROM/g) ?? []).length;
    /* وسقفُ المؤرشَفين ثابتٌ مسمًّى آخر — الحارسُ يقبل السقفَين لا الرقمَ الحرفيّ. */
    const limits = (bare.match(/LIMIT \$\{(BATCH|PURGE_TENANTS_PER_CYCLE)\}/g) ?? []).length;
    expect(deletes).toBeGreaterThanOrEqual(2);
    /* 🔴 `DELETE` بلا سقفٍ يحتجز اتّصالاً من بِركةٍ فيها عشرة ويقفل صفوفاً
       دقائقَ — فيتكدّس الويبهوك خلفه. وحذفٌ يُعطّل الاستلام أسوأُ من جدولٍ
       كبير: ما لم يُحذف اليوم يُحذف في الدورة التالية. */
    expect(limits).toBe(deletes);
  });

  it('لا ابتلاعَ صامتٍ للأخطاء', () => {
    /* `catch(() => -1)` أخفت «relation does not exist» كلَّ ستّ ساعات. */
    expect(bare).not.toMatch(/catch\(\s*\(\s*\)\s*=>/);
    expect(bare).toMatch(/catch\(\s*\(\s*e\s*\)\s*=>/);
    expect(bare).toContain('تعذّر الاحتفاظ في');
  });

  it('لا نداءَ شبكةٍ داخل المعاملة', () => {
    /* بِركةٌ من عشرة اتّصالات ونداءٌ شبكيٌّ داخل معاملةٍ مفتوحةٍ = نفادُها. */
    expect(bare).not.toMatch(/\bfetch\s*\(/);
    expect(bare).not.toMatch(/\baxios\b/);
  });

  it('الافتراضُ عند غياب الباقة ٣٦٥ يوماً — لا حذفٌ على الشكّ', () => {
    expect(bare).toContain("coalesce((p.limits->>'retentionDays')::int, 365)");
  });

  it('المهمّةُ مسجَّلةٌ في جدول العامل', () => {
    const main = readFileSync(join(REPO, 'apps', 'worker', 'src', 'main.ts'), 'utf8');
    /* حارسٌ مكتوبٌ على مهمّةٍ لا يُجدولها أحدٌ حارسٌ على لا شيء. */
    expect(main).toContain('retention');
  });
});
