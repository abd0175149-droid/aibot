/**
 * يجعل ترحيلاً مولَّداً من drizzle-kit **متماثلاً** (idempotent).
 *
 * ★ لماذا وُجد: `deploy.sh` يُطبّق **كلّ** الترحيلات في كلّ نشرة — وهذا قرارٌ
 *   صحيح (لا جدول هجرات، ولا حالةٌ تتباعد بين بيئتَين). لكنّ drizzle يُولّد
 *   `CREATE TABLE "x"` بلا `IF NOT EXISTS`، فيسقط الترحيل على أوّل جدولٍ قائم.
 *
 *   والنتيجة أنّ `deploy.sh` **لم يكن قادراً على النجاح على قاعدةٍ قائمة قطّ**
 *   — أي أنّ قاعدة التنفيذ «النشر بـdeploy.sh وحده» كانت مستحيلةً عمليّاً،
 *   وكلّ نشرةٍ جرت بأوامر docker يدويّة بلا نسخةٍ احتياطيّة ولا بوّابة صحّة
 *   ولا تراجع. اكتُشف عند أوّل تشغيلٍ فعليّ للسكربت.
 *
 * ثلاثة تحويلات، وكلٌّ منها يحفظ الدلالة:
 *  ① `CREATE TABLE "x"`            ⟶ `CREATE TABLE IF NOT EXISTS "x"`
 *  ② `CREATE [UNIQUE] INDEX "x"`   ⟶ `… IF NOT EXISTS "x"`
 *  ③ `ALTER TABLE … ADD CONSTRAINT …` ⟶ كتلة DO تبتلع `duplicate_object` وحده
 *
 * ولماذا ③ كتلةٌ لكلّ عبارةٍ لا كتلةٌ واحدة: كتلةٌ واحدة تُلغي كلّ ما بعد
 * أوّل استثناء. وابتلاع `duplicate_object` **وحده** مقصود: خطأُ مرجعٍ ناقصٍ
 * أو عمودٍ غير موجود يجب أن يظهر ويُفشل النشر.
 *
 * يُشغَّل: node --import tsx packages/db/scripts/idempotent.ts [ملفّ…]
 * ومتماثلٌ هو نفسه: تشغيله مرّتين لا يُغيّر شيئاً.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';

const DEFAULT_FILES = ['packages/db/migrations/0001_tables.sql'];

export function makeIdempotent(sql: string): { out: string; counts: Record<string, number> } {
  const counts = { tables: 0, indexes: 0, constraints: 0 };

  let out = sql.replace(/^CREATE TABLE (?!IF NOT EXISTS)/gm, () => {
    counts.tables += 1;
    return 'CREATE TABLE IF NOT EXISTS ';
  });

  out = out.replace(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/gm, (_m, uniq) => {
    counts.indexes += 1;
    return `CREATE ${uniq ?? ''}INDEX IF NOT EXISTS `;
  });

  /* العبارة سطرٌ واحد ينتهي بـ`;` وقد يتبعه تعليق فاصل من drizzle.
     نلتقط الجسم بلا الفاصلة المنقوطة ونُعيد التعليق كما هو. */
  out = out.replace(
    /^(ALTER TABLE .*? ADD CONSTRAINT .*?);(\s*--> statement-breakpoint)?$/gm,
    (_m, body: string, tail: string | undefined) => {
      counts.constraints += 1;
      return `DO $$ BEGIN\n  ${body};\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;${tail ?? ''}`;
    },
  );

  return { out, counts };
}

function main(): void {
  const files = argv.slice(2).length ? argv.slice(2) : DEFAULT_FILES;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const { out, counts } = makeIdempotent(src);
    if (out === src) {
      console.log(`= ${f} — متماثلٌ أصلاً، لا تغيير`);
      continue;
    }
    writeFileSync(f, out);
    console.log(
      `+ ${f} — جداول: ${counts.tables} · فهارس: ${counts.indexes} · قيود: ${counts.constraints}`,
    );
  }
}

// لا يُنفَّذ عند الاستيراد من الاختبار
if (import.meta.url === `file:///${argv[1]?.replace(/\\/g, '/')}`) main();
