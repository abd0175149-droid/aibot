/**
 * تدويرُ `MASTER_KEY` — إعادةُ تشفير كلّ سرٍّ مخزَّنٍ بالمفتاح الجديد.
 *
 * ★ لماذا وُجد: `packages/crypto/src/index.ts` يَعِد في تعليقه منذ اليوم
 *   الأوّل بأنّ «تدوير المفتاح مهمّةُ خلفيّةٍ تعيد التشفير صفّاً صفّاً» —
 *   ولم توجد تلك المهمّة قطّ. فالوعدُ مكتوبٌ والأداةُ معدومة، والمالكُ الذي
 *   يظنّ أنّ مفتاحَه تسرّب لا يملك طريقاً لتبديله.
 *
 * 🔴 **وما يقع بلا هذه الأداة أسوأ من غيابها.** من يبدّل `MASTER_KEY` ويرفع
 *    `MASTER_KEY_VERSION` بلا إعادة تشفير يجد كلَّ صفٍّ قديمٍ يرمي عند الفكّ.
 *    والرميُ **لا يُرى**: في الويبهوك يُرسَل الردُّ 200 قبل الفكّ (وهو الصواب
 *    مع ميتا)، فيُبتلع الخطأ في سطرِ سجلٍّ وميتا لا تُعيد الإرسال —
 *    **كلُّ رسالةٍ تضيع**. فالتدويرُ الخاطئ يُسكت المنصّةَ بلا عطلٍ ظاهر.
 *
 * الإجراءُ كاملاً:
 *   ① ولّد مفتاحاً جديداً:  openssl rand -base64 32
 *   ② في `.env`: انقل الحاليَّ إلى `MASTER_KEY_V<الإصدار الحاليّ>`،
 *      وضع الجديدَ في `MASTER_KEY`، وارفع `MASTER_KEY_VERSION`.
 *   ③ `docker compose up -d api worker`  (المفاتيحُ تُقرأ عند الإقلاع)
 *   ④ جرِّب بلا كتابة:   node --import tsx ops/rotate-master-key.ts
 *   ⑤ نفِّذ:             APPLY=1 node --import tsx ops/rotate-master-key.ts
 *   ⑥ تأكّد أنّ التغطية كاملة، ثمّ — وبعدها وحدها — احذف `MASTER_KEY_V<n>`.
 *
 * ⚠️ والخطوةُ ⑥ هي التي تُنسى، ولها فخٌّ صامت: تركُ `MASTER_KEY_V<n>` بنفس
 *    رقم الإصدار الحاليّ كان يطمس المفتاحَ الرئيس فيُشفَّر الجديدُ بالقديم.
 *    و`loadKeys` يرفض ذلك صراحةً الآن.
 *
 * ⚠️ ولا يُطبع سرٌّ هنا إطلاقاً: لا مفتاح، ولا قيمةٌ مفكوكة، ولا بصمة.
 *    المخرَجُ أعدادُ صفوفٍ وأرقامُ إصداراتٍ لا غير.
 */
import { getDb, closeDb, withPlatform, sql, type Tx } from '../packages/db/src/index';
import {
  seal, open as decrypt, currentKeyVersion, configuredKeyVersions,
} from '../packages/crypto/src/index';

const APPLY = process.env.APPLY === '1';
/** دفعةٌ صغيرة: المعاملةُ تقفل الصفوف، والبِركةُ عشرةُ اتّصالات. */
const BATCH = Number(process.env.ROTATE_BATCH ?? '200');

/**
 * الأزواجُ الأربعة — عمودٌ مشفَّرٌ ورقمُ إصداره ومفتاحُ الصفّ.
 *
 * ⚠️ وقائمةٌ ناقصةٌ هنا أسوأ من غياب الأداة: تُعلن «تمّ التدوير» بينما جدولٌ
 *    كاملٌ ما زال بالمفتاح القديم، فيُحذف القديمُ ويضيع ما فيه. ويحرس
 *    `apps/worker/test/key-rotation.test.ts` أن تُطابق هذه القائمةُ كلَّ
 *    عمودٍ ينتهي بـ`_enc` في المخطَّط.
 */
const PAIRS: Array<{ table: string; col: string; ver: string }> = [
  { table: 'tenant_channels', col: 'token_enc', ver: 'key_version' },
  { table: 'tenant_channels', col: 'app_secret_enc', ver: 'key_version' },
  { table: 'bot_tools', col: 'secrets_enc', ver: 'key_version' },
  { table: 'ai_keys', col: 'key_enc', ver: 'key_version' },
  { table: 'users', col: 'mfa_secret_enc', ver: 'mfa_key_version' },
];

function say(msg: string, extra: Record<string, unknown> = {}): void {
  const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  console.log(`${msg}${tail}`);
}

async function main(): Promise<void> {
  const db = getDb();
  const target = currentKeyVersion();
  const have = configuredKeyVersions();

  console.log('');
  console.log('▶ تدوير مفتاح التشفير');
  say('  الإصدار الهدف', { target });
  say('  الإصداراتُ التي نملك مفاتيحَها', { have });
  if (!APPLY) console.log('  ℹ جرّبٌ جافّ — لا كتابة. أضِف APPLY=1 للتنفيذ.');
  console.log('');

  if (!have.includes(target)) {
    console.error('✘ لا مفتاحَ للإصدار الهدف — راجع MASTER_KEY وMASTER_KEY_VERSION.');
    process.exitCode = 1;
    return;
  }

  let totalPending = 0;
  let totalDone = 0;
  let blocked = 0;

  for (const p of PAIRS) {
    const label = `${p.table}.${p.col}`;

    /* ما زال بإصدارٍ غيرِ الهدف — وله قيمةٌ فعلاً. */
    const counts = await withPlatform(db, `تدوير: عدُّ ${label}`, (tx: Tx) => tx.execute(sql`
      SELECT ${sql.identifier(p.ver)} AS v, count(*)::int AS n
        FROM ${sql.identifier(p.table)}
       WHERE ${sql.identifier(p.col)} IS NOT NULL
         AND ${sql.identifier(p.ver)} IS DISTINCT FROM ${target}
       GROUP BY 1 ORDER BY 1
    `)) as unknown as Array<{ v: number; n: number }>;

    const pending = counts.reduce((a, r) => a + Number(r.n), 0);
    totalPending += pending;
    if (!pending) { say(`  ✔ ${label}`, { pending: 0 }); continue; }

    const versions = counts.map((r) => Number(r.v));
    const uncovered = versions.filter((v) => !have.includes(v));
    if (uncovered.length) {
      /* لا مفتاحَ لهذه الصفوف: لا تُلمس، وتُعلَن. محاولةُ فكِّها ترمي
         صفّاً صفّاً وتُطيل المخرَجَ بلا فائدة — والخبرُ هو أنّها محجوبة. */
      console.error(`  ✘ ${label}: إصداراتٌ بلا مفاتيح ${JSON.stringify(uncovered)} — اضبط MASTER_KEY_V<n> أوّلاً`);
      blocked += counts.filter((r) => uncovered.includes(Number(r.v)))
        .reduce((a, r) => a + Number(r.n), 0);
      continue;
    }

    say(`  … ${label}`, { pending, from: versions });
    if (!APPLY) continue;

    /* دفعاتٌ صغيرةٌ في معاملاتٍ مستقلّة: معاملةٌ واحدةٌ على كلّ الصفوف تقفل
       جداولَ حيّةً دقائق، والتدويرُ يجري على منصّةٍ تعمل. */
    for (;;) {
      const rows = await withPlatform(db, `تدوير: قراءةُ دفعةٍ من ${label}`, (tx: Tx) => tx.execute(sql`
        SELECT id, ${sql.identifier(p.col)} AS enc, ${sql.identifier(p.ver)} AS v
          FROM ${sql.identifier(p.table)}
         WHERE ${sql.identifier(p.col)} IS NOT NULL
           AND ${sql.identifier(p.ver)} IS DISTINCT FROM ${target}
         LIMIT ${BATCH}
      `)) as unknown as Array<{ id: string; enc: string; v: number }>;
      if (!rows.length) break;

      /* الفكُّ وإعادةُ الختم **خارج** المعاملة: عمليّةُ حسابٍ لا قاعدة،
         وإبقاءُ المعاملة مفتوحةً أثناءها يحتجز اتّصالاً بلا سبب. */
      const next = rows.map((r) => ({ id: r.id, enc: seal(decrypt(r.enc, Number(r.v))).enc }));

      await withPlatform(db, `تدوير: كتابةُ دفعةٍ في ${label}`, async (tx: Tx) => {
        for (const r of next) {
          /* ⚠️ الشرطُ يشمل `id` **والإصدارَ القديم** معاً: صفٌّ كُتب من
             الواجهة بين القراءة والكتابة يحمل الإصدارَ الهدف سلفاً، فلا
             يُكتب فوقه بقيمةٍ بُنيت من نسخةٍ بائتة. */
          await tx.execute(sql`
            UPDATE ${sql.identifier(p.table)}
               SET ${sql.identifier(p.col)} = ${r.enc},
                   ${sql.identifier(p.ver)} = ${target}
             WHERE id = ${r.id}
               AND ${sql.identifier(p.ver)} IS DISTINCT FROM ${target}
          `);
        }
      });
      totalDone += next.length;
      say(`    ↻ ${label}`, { done: next.length });
    }
  }

  console.log('');
  if (blocked) {
    console.error(`✘ ${blocked} صفّاً محجوبٌ بإصداراتٍ لا مفاتيحَ لها — لم يُدوَّر.`);
    process.exitCode = 1;
  } else if (!totalPending) {
    console.log('✅ كلُّ الصفوف على الإصدار الهدف — لا شيءَ للتدوير.');
  } else if (!APPLY) {
    console.log(`ℹ ${totalPending} صفّاً يحتاج تدويراً. أعِد التشغيل بـAPPLY=1.`);
  } else {
    console.log(`✅ دُوِّر ${totalDone} صفّاً إلى الإصدار ${target}.`);
    console.log('   تأكّد من /api/health/deep ثمّ — وبعدها وحدها — احذف المفتاح القديم من .env.');
  }
}

/* ⚠️ لا `await` في المستوى الأعلى: `tsx` على الخادم يُحوّل إلى CJS، و
   «Top-level await is currently not supported with the cjs output format».
   ونفسُ الشكل في بقيّة سكربتات `ops` — لا اجتهادَ جديد. */
main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error('فشل:', (e as Error).message);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
