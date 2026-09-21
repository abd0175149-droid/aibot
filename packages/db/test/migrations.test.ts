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
