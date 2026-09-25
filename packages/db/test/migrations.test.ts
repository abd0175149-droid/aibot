import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeIdempotent } from '../scripts/idempotent';

/**
 * ★ `deploy.sh` يُطبّق **كلّ** الترحيلات في كلّ نشرة — وهو قرارٌ صحيح: لا جدول
 * هجراتٍ يتباعد بين بيئتَين، ولا حالةٌ خفيّة. وثمنه أنّ كلّ ترحيلٍ **يجب** أن
 * يكون متماثلاً.
 *
 * العطل الذي وُلد منه هذا الملفّ: drizzle-kit يُولّد `CREATE TABLE "x"` بلا
 * `IF NOT EXISTS`، فسقط الترحيل على أوّل جدولٍ قائم. والنتيجة أنّ `deploy.sh`
 * **لم يكن قادراً على النجاح على قاعدةٍ قائمة قطّ** — أي أنّ قاعدة التنفيذ
 * «النشر بـdeploy.sh وحده» كانت مستحيلةً عمليّاً، وكلّ نشرةٍ جرت بأوامر docker
 * يدويّة: بلا نسخةٍ احتياطيّة، ولا بوّابة صحّة، ولا تراجع. مضى شهرٌ من النشر
 * الأعمى قبل أن يُكتشف عند أوّل تشغيلٍ فعليّ للسكربت.
 */
const DIR = join(__dirname, '..', 'migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

describe('الترحيلات — متماثلةٌ لأنّ النشر يُطبّقها كلّها كلّ مرّة', () => {
  it('يوجد ترحيلٌ واحدٌ على الأقلّ — وإلّا فالاختبار يمرّ على الفراغ', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s — لا عبارة إنشاءٍ بلا حمايةٍ من التكرار', (name) => {
    const sql = readFileSync(join(DIR, name), 'utf8');
    const { out } = makeIdempotent(sql);
    // الرسالة تقول ما يُفعل، لا «توقّعتُ صحيحاً»
    expect(
      out,
      `${name} يحوي عبارةً تسقط على قاعدةٍ قائمة. `
      + 'شغّل: node --import tsx packages/db/scripts/idempotent.ts',
    ).toBe(sql);
  });

  it('لا نهايات أسطر CRLF في أيّ ترحيل', () => {
    // بنفس سبب deploy.sh: `\r` في SQL يمرّ، لكنّه يُفسد المقارنة والتشخيص
    const withCr = files.filter((f) => readFileSync(join(DIR, f), 'utf8').includes('\r'));
    expect(withCr).toEqual([]);
  });
});

describe('محوّل التماثل — يُفحص بنفسه', () => {
  it('يحمي الجداول والفهارس', () => {
    const { out } = makeIdempotent(
      'CREATE TABLE "a" (x int);\nCREATE INDEX "i" ON "a" (x);\nCREATE UNIQUE INDEX "u" ON "a" (x);\n',
    );
    expect(out).toContain('CREATE TABLE IF NOT EXISTS "a"');
    expect(out).toContain('CREATE INDEX IF NOT EXISTS "i"');
    expect(out).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "u"');
  });

  it('يلفّ القيد في كتلةٍ تبتلع التكرار وحده', () => {
    const { out } = makeIdempotent(
      'ALTER TABLE "a" ADD CONSTRAINT "a_fk" FOREIGN KEY ("x") REFERENCES "b"("id");',
    );
    expect(out).toContain('DO $$ BEGIN');
    expect(out).toContain('EXCEPTION WHEN duplicate_object THEN NULL;');
    // ★ التكرار وحده: مرجعٌ ناقصٌ أو عمودٌ غير موجود يجب أن يُفشل النشر
    expect(out).not.toContain('WHEN others');
  });

  it('كتلةٌ لكلّ قيدٍ لا كتلةٌ واحدة — فكتلةٌ واحدة تُلغي ما بعد أوّل استثناء', () => {
    const { out, counts } = makeIdempotent(
      'ALTER TABLE "a" ADD CONSTRAINT "c1" FOREIGN KEY ("x") REFERENCES "b"("id");\n'
      + 'ALTER TABLE "a" ADD CONSTRAINT "c2" FOREIGN KEY ("y") REFERENCES "b"("id");',
    );
    expect(counts.constraints).toBe(2);
    expect(out.match(/DO \$\$ BEGIN/g)).toHaveLength(2);
  });

  it('يحفظ تعليق الفصل الذي يستعمله drizzle', () => {
    const { out } = makeIdempotent(
      'ALTER TABLE "a" ADD CONSTRAINT "c" FOREIGN KEY ("x") REFERENCES "b"("id");--> statement-breakpoint',
    );
    expect(out.endsWith('--> statement-breakpoint')).toBe(true);
  });

  it('متماثلٌ هو نفسه — تطبيقه مرّتين لا يُغيّر شيئاً', () => {
    const once = makeIdempotent('CREATE TABLE "a" (x int);').out;
    expect(makeIdempotent(once).out).toBe(once);
  });

  it('لا يلمس ALTER التي ليست إضافة قيد', () => {
    const src = 'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_action jsonb;';
    expect(makeIdempotent(src).out).toBe(src);
  });
});

describe('★★ العمودُ الجديد — العطلُ الذي اسمُه «لا نشرَ بعد اليوم»', () => {
  /**
   * `deploy.sh` يُطبّق **كلّ** ملفّات الترحيل في **كلّ** نشرة، عن قصدٍ مكتوب
   * (لا جدولَ هجراتٍ يتباعد بين بيئتَين). فالتماثلُ ليس أناقةً بل شرطُ بقاء.
   *
   * و`ALTER TABLE … ADD COLUMN` بلا `IF NOT EXISTS` ينجح في النشرة الأولى
   * ويسقط في كلّ نشرةٍ بعدها — والملفُّ يبقى في المجلَّد، فلا يعود أحدٌ قادراً
   * على النشر حتّى يُحرَّر يدويّاً. و`README.md` يدلّ كلَّ قادمٍ جديدٍ على
   * `pnpm --filter @aibot/db run generate` بالنصّ، وdrizzle يُولّد الشكلَ
   * العاري. أي أنّ الفخَّ منصوبٌ ومُشارٌ إليه.
   */
  it('★ يحمي العمودَ الجديد بالشكل الذي يولّده drizzle', () => {
    const gen = 'ALTER TABLE "conversations" ADD COLUMN "bot_answered_at" timestamp with time zone;';
    const { out, counts } = makeIdempotent(gen);
    expect(out).toContain('ADD COLUMN IF NOT EXISTS "bot_answered_at"');
    expect(counts.columns).toBe(1);
  });

  it('★ ولا يلمس ما حُمي سلفاً — فالمحوّل متماثلٌ هو نفسه', () => {
    const safe = 'ALTER TABLE "x" ADD COLUMN IF NOT EXISTS "y" text;';
    expect(makeIdempotent(safe).out).toBe(safe);
    expect(makeIdempotent(makeIdempotent(safe).out).out).toBe(safe);
  });

  it('★ ولا يخلط العمودَ بالقيد — لكلٍّ علاجُه', () => {
    /* القيدُ يُلَفّ في كتلة DO (لا `IF NOT EXISTS` له في بوستجرس)، والعمودُ
       له الرايةُ مباشرةً. وخلطُهما يُنتج SQL لا يُصرَّف. */
    const c = 'ALTER TABLE "a" ADD CONSTRAINT "a_fk" FOREIGN KEY ("b") REFERENCES "c"("id");';
    const out = makeIdempotent(c).out;
    expect(out).toContain('DO $$ BEGIN');
    expect(out).not.toContain('ADD CONSTRAINT IF NOT EXISTS');
    expect(makeIdempotent(c).counts.columns).toBe(0);
  });
});

describe('★★★ لا عبارةَ تحذف في ترحيلٍ يُعاد تطبيقُه كلَّ نشرة', () => {
  /**
   * وهذا أخطرُ من سقوط النشر: عبارةٌ تحذف تُعاد **في كلّ نشرة**.
   *  · `DROP TABLE IF EXISTS` لا يسقط — يحذف بصمتٍ كلَّ مرّة.
   *  · `ALTER TABLE … DROP COLUMN` يسقط في الثانية فيمنع النشرَ إلى الأبد.
   *  · `TRUNCATE` و`DELETE FROM` بلا شرطٍ تُفرغان جداولَ عملاءَ كلَّ نشرة.
   *
   * والاستثناءُ الوحيد `DROP POLICY`: تُحذف وتُعاد في **نفس** المعاملة داخل
   * `0002_rls.sql` (‏`--single-transaction`)، فلا لحظةَ يكون فيها جدولٌ
   * RLS-مفعّلاً بلا سياسة. وهو مشروحٌ في `deploy.sh` بالنصّ.
   */
  const DESTRUCTIVE: Array<{ re: RegExp; why: string }> = [
    { re: /^\s*DROP\s+TABLE\b/im, why: 'DROP TABLE يُعاد كلَّ نشرة' },
    { re: /\bDROP\s+COLUMN\b/i, why: 'DROP COLUMN يسقط في النشرة الثانية فيمنع النشر' },
    { re: /^\s*TRUNCATE\b/im, why: 'TRUNCATE يُفرغ الجدول كلَّ نشرة' },
    { re: /^\s*DROP\s+SCHEMA\b/im, why: 'DROP SCHEMA يمحو كلَّ شيء' },
    { re: /^\s*DROP\s+DATABASE\b/im, why: 'DROP DATABASE يمحو كلَّ شيء' },
  ];

  it.each(files)('%s — لا حذفَ يُعاد', (name) => {
    const sql = readFileSync(join(DIR, name), 'utf8');
    const hits = DESTRUCTIVE.filter((d) => d.re.test(sql)).map((d) => d.why);
    expect(
      hits,
      `${name} يحوي عبارةً تحذف، والنشرُ يُطبّق كلَّ ملفٍّ في كلّ مرّة. `
      + 'إن كان الحذفُ لازماً فاجعله في نفس المعاملة مع إعادة الإنشاء، واشرح لماذا.',
    ).toEqual([]);
  });

  it('★ الماسحُ يمسك الأشكال فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    expect(DESTRUCTIVE.some((d) => d.re.test('DROP TABLE "x";'))).toBe(true);
    expect(DESTRUCTIVE.some((d) => d.re.test('ALTER TABLE "x" DROP COLUMN "y";'))).toBe(true);
    expect(DESTRUCTIVE.some((d) => d.re.test('TRUNCATE messages;'))).toBe(true);
    // و`DROP POLICY` مسموحٌ عمداً — تُحذف وتُعاد في نفس المعاملة
    expect(DESTRUCTIVE.some((d) => d.re.test('DROP POLICY IF EXISTS p ON t;'))).toBe(false);
  });

  it('★ و`DROP POLICY` موجودٌ فعلاً — فالاستثناءُ حيٌّ لا نظريّ', () => {
    /* استثناءٌ مكتوبٌ لحالةٍ لا وجودَ لها يُربك القارئ: يبحث عن شيءٍ ليس هناك. */
    const all = files.map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');
    expect(all).toMatch(/DROP POLICY/i);
  });
});

describe('★★★ لقطةُ drizzle تُطابق المخطَّط — وإلّا فالفخُّ يُنصب من جديد', () => {
  /**
   * `README.md` يدلّ كلَّ قادمٍ جديد على `pnpm --filter @aibot/db run generate`.
   * وحين كانت اللقطةُ متأخّرةً، أنتج ذلك الأمرُ — جُرِّب فعلاً — ملفّاً فيه:
   *   · `CREATE TABLE "quota_alerts"` عاريةً،
   *   · **سبعُ** `ADD COLUMN` عارية،
   *   · واسمٌ (`0001_chubby_zuras.sql`) يسبق `0001_tables.sql` في الترتيب
   *     الأبجديّ — فيُنشئ جدولاً بمفتاحٍ أجنبيٍّ إلى جداولَ لم تُنشأ بعد.
   * أي أنّ أوّلَ من يتّبع الوثيقةَ يكسر النشرَ لكلّ من بعده.
   *
   * واللقطةُ الآن أساسٌ واحدٌ يُطابق `schema.ts`، فـ`generate` يقول «لا تغييرات».
   * وهذا الحارسُ يُبقيها كذلك: عمودٌ يُضاف إلى `schema.ts` بلا تحديث اللقطة
   * يُمسَك هنا، لا في نشرةٍ مكسورةٍ بعد أسابيع.
   *
   * ⚠️ والمطابقةُ **مقيّدةٌ بالجدول** لا بالاسم وحده: `id` و`status` و
   *    `created_at` تظهر في كلّ جدولٍ تقريباً، فبحثٌ عن الاسم في النصّ كلِّه
   *    يمرّ على عمودٍ مفقودٍ فعلاً — وهو بعينه «اختبارٌ يمرّ دائماً».
   */
  const snapPath = join(DIR, 'meta', '0000_snapshot.json');
  const snap = JSON.parse(readFileSync(snapPath, 'utf8')) as {
    tables: Record<string, { columns: Record<string, unknown> }>;
  };
  const schemaSrc = readFileSync(join(DIR, '..', 'src', 'schema.ts'), 'utf8')
    + readdirSync(join(DIR, '..', 'src', 'schema'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(DIR, '..', 'src', 'schema', f), 'utf8'))
      .join('\n');

  /** `pgTable('name', { colKey: type('col_name') … })` — مقيّدٌ بحدود الكتلة. */
  function declared(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const marks: Array<{ name: string; at: number }> = [];
    for (const m of schemaSrc.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) {
      marks.push({ name: m[1]!, at: m.index! });
    }
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1]!.at : schemaSrc.length;
      const body = schemaSrc.slice(mk.at, end);
      const cols = [...body.matchAll(/\b(?:uuid|text|integer|boolean|jsonb|timestamp|numeric|varchar|real|doublePrecision|bigint|smallint|date|vector|customType)\s*\(\s*'([a-z0-9_]+)'/g)]
        .map((c) => c[1]!);
      out.set(mk.name, [...new Set(cols)]);
    });
    return out;
  }

  const tables = declared();

  it('الماسحُ يقرأ المخطَّط فعلاً (فحصٌ ذاتيّ)', () => {
    expect(tables.size).toBeGreaterThan(20);
    expect(tables.get('conversations')).toContain('bot_answered_at');
    expect(Object.keys(snap.tables).length).toBeGreaterThan(20);
  });

  it('★ كلُّ جدولٍ في المخطَّط له مثيلٌ في اللقطة', () => {
    const missing = [...tables.keys()].filter((t) => !(`public.${t}` in snap.tables));
    expect(
      missing,
      'جدولٌ في schema.ts غائبٌ عن لقطة drizzle. شغّل داخل packages/db: '
      + 'drizzle-kit generate إلى مجلَّدٍ مؤقّت، وانقل meta/ الناتجة — أو حدّث اللقطة يدويّاً.',
    ).toEqual([]);
  });

  it('★★ وكلُّ عمودٍ — **مقيّداً بجدوله** لا بالاسم وحده', () => {
    const missing: string[] = [];
    for (const [t, cols] of tables) {
      const known = snap.tables[`public.${t}`]?.columns ?? {};
      for (const c of cols) if (!(c in known)) missing.push(`${t}.${c}`);
    }
    expect(
      missing,
      'عمودٌ في schema.ts غائبٌ عن لقطة drizzle — وأوّلُ `generate` سيُولّد له '
      + 'ترحيلاً يصطدم بما هو قائمٌ في القاعدة.',
    ).toEqual([]);
  });

  it('★ ولا لقطةَ ثانيةٌ تتراكم — أساسٌ واحدٌ يُطابق اليوم', () => {
    const snaps = readdirSync(join(DIR, 'meta')).filter((f) => f.endsWith('_snapshot.json'));
    expect(snaps, 'لقطاتٌ متعدّدة تُعيد سلسلةَ الفروق التي وُلد منها الانحراف').toEqual(['0000_snapshot.json']);
  });
});

describe('★ ترتيبُ ملفّات الترحيل — النشرُ يطبّقها بترتيبٍ أبجديّ', () => {
  it('كلُّ ملفٍّ يبدأ برقمٍ من أربع خانات، ولا رقمَ مكرَّر', () => {
    /* 🔴 `deploy.sh` يستعمل `for f in …/*.sql` — وهو ترتيبٌ أبجديّ لا زمنيّ.
       فملفٌّ اسمُه `0001_chubby_zuras.sql` يسبق `0001_tables.sql` ويُنشئ
       جدولاً بمفتاحٍ أجنبيٍّ إلى جداولَ لم تُنشأ بعد. وهذا ما يولّده drizzle
       فعلاً: اسمٌ عشوائيٌّ بعد الرقم. */
    const nums = files.map((f) => /^(\d{4})_/.exec(f)?.[1]);
    expect(nums.filter((n) => !n), `ملفّاتٌ بلا رقمٍ رباعيّ: ${files.join(', ')}`).toEqual([]);
    const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
    expect(dup, 'رقمٌ مكرَّر — والترتيبُ بينهما يقرّره الاسمُ العشوائيّ').toEqual([]);
  });
});
