/**
 * الطورُ ③ — **وهو الإثبات**: يفكّ الصفَّ والمفتاحُ القديم غيرُ مضبوطٍ
 * إطلاقاً. فإن نجح فقد تحرّرت القاعدةُ منه فعلاً ويجوز حذفُه.
 *
 * ولولا هذا الطور لكان «نجح التدوير» ادّعاءً: الفكُّ كان سيمرّ بالقديم
 * وهو ما زال في البيئة، فلا يُثبت أنّ الصفَّ أُعيد ختمُه بالجديد.
 */
import { getDb, closeDb, withPlatform, sql, type Tx } from '../packages/db/src/index';
import { open as decrypt, configuredKeyVersions } from '../packages/crypto/src/index';
/* ⚠️ من ملفّ الثوابت لا من ملفّ البذر: استيرادُ ذاك يُنفّذ بذراً جديداً
   فيتحقّق هذا الطورُ من صفٍّ كتبه بنفسه — ويمرّ دائماً. */
import { DRILL_SECRET, DRILL_CHANNEL as CHANNEL } from './drill-rot-const';


async function main(): Promise<void> {
  const db = getDb();
  const rows = await withPlatform(db, 'تمرين التدوير: قراءةُ الصفّ', (tx: Tx) => tx.execute(
    sql`SELECT token_enc, key_version FROM tenant_channels WHERE id = ${CHANNEL}`,
  )) as unknown as Array<{ token_enc: string; key_version: number }>;

  const r = rows[0];
  if (!r) throw new Error('لا صفَّ — الطورُ ① لم يبذر');

  const have = configuredKeyVersions();
  console.log(`  المفاتيحُ المضبوطة الآن: ${JSON.stringify(have)}`);
  console.log(`  إصدارُ الصفّ: ${r.key_version}`);
  if (have.includes(1)) throw new Error('المفتاحُ القديم ما زال مضبوطاً — الطورُ لا يُثبت شيئاً');
  if (Number(r.key_version) !== 2) throw new Error('الإصدارُ لم يُرفع');

  if (decrypt(r.token_enc, Number(r.key_version)) !== DRILL_SECRET) {
    throw new Error('القيمةُ المفكوكة لا تطابق الأصل');
  }
  console.log('  ✔ فُكَّ بالمفتاح الجديد وحده، والقيمةُ مطابقةٌ للأصل');
  console.log('');
  console.log('✅ التدويرُ مُثبَتٌ دورةً كاملة');
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error('  ✘ فشل التحقّق:', (e as Error).message);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
