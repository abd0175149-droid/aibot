/**
 * تمرين الفشل (و): **رسائلُ زبونٍ تصل أثناء توليد الردّ.**
 *
 * الحرّاسُ السكونيّة في `reply-serialization.test.ts` تفحص الشكل: هل يُؤخذ
 * القفل؟ هل الإفراجُ في `finally`؟ هل السكربتُ ذرّيّ؟ ولا تفحص **الدلالة**:
 * هل ريدِس يتصرّف كما نظنّ؟ وهذا التمرينُ يفحصها على ريدِس الحقيقيّ.
 *
 * ★ والعطلُ الذي وُلد منه قِيس لا استُنتج. مسبارٌ على طابورٍ مؤقّتٍ في هذه
 *   الحاوية نفسِها أعطى:
 *
 *       start:conv-X       live=1
 *       start:conv-X-next  live=2
 *       MAX_CONCURRENT_ON_SAME_CONVERSATION=2
 *
 *   أي أنّ قفلَ BullMQ — وهو لكلّ **معرّفِ مهمّة** لا لكلّ محادثة — سمح
 *   بردَّين متوازيَين على المحادثة نفسها، وتزامنُ `bot-reply` ثلاثة. وكلٌّ
 *   يقرأ تاريخاً لا يحوي ردَّ الآخر: ترحيبان للزبون، وضِعفُ الكلفة للمالك.
 *
 * ثلاثةُ أسئلةٍ بالدليل:
 *  ① **هل يتسلسل؟** مهمّتان على محادثةٍ واحدة — واحدةٌ تعمل والأخرى تخرج؟
 *  ② **هل تضيع رسالة؟** المحجوبُ يكتب علامةً، وحاملُ القفل **يقرؤها**؟
 *  ③ **هل يُفرِج عن قفل غيره؟** رمزٌ لا يطابق لا يحذف قفلاً ليس له؟
 *
 * ولا يمسّ الإنتاج: مفاتيحُ محادثةٍ موهومةٍ باسمٍ فيه `drill-`، وطابورٌ
 * مؤقّتٌ لا يستهلكه عاملٌ، ويُنظَّف كلُّه في النهاية ولو فشل.
 *
 * يُشغَّل من داخل حاوية العامل:
 *   docker compose exec -T -w /app/apps/worker worker \
 *     node --import tsx scripts/drill-conv-lock.ts
 */
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { acquireConvLock, releaseConvLock } from '../src/enqueue.js';

const ID = `drill-lock-${process.pid}`;
const conn = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const failures: string[] = [];

function ck(name: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failures.push(`${name}: got ${String(got)} want ${String(want)}`);
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `  (got ${String(got)})`}`);
}

async function lockSemantics(): Promise<void> {
  console.log('\n▶ ① دلالةُ القفل والعلامة على ريدِس الحقيقيّ');
  const a = await acquireConvLock(ID);
  ck('أوّلُ آخذٍ ينجح', typeof a, 'string');
  ck('  ولا علامةَ تُكتب', await conn.exists(`conv:${ID}:dirty`), 0);

  const b = await acquireConvLock(ID);
  ck('★ الثاني محجوب', b, null);
  ck('  والعلامةُ كُتبت في العمليّة نفسِها', await conn.exists(`conv:${ID}:dirty`), 1);

  await acquireConvLock(ID);
  await acquireConvLock(ID);
  ck('  ثلاثةُ محجوبين ⟶ علامةٌ واحدة', await conn.exists(`conv:${ID}:dirty`), 1);

  ck('★ رمزٌ خاطئٌ لا يُفرِج عن قفلِ غيره',
    await releaseConvLock(ID, 'not-my-token').then(() => conn.exists(`conv:${ID}:lock`)), 1);

  /* ولماذا يُقرأ العلمُ ولو لم يُطابق الرمز: الاتّجاهُ الآمنُ أن نوقظ بلا
     داعٍ لا أن ننام على رسالة. راجع تعليقَ `RELEASE_AND_TAKE`. */
  ck('★ صاحبُ الرمز يُفرِج ويقرأ العلامة', await releaseConvLock(ID, a!), false);
  ck('  والقفلُ تحرّر', await conn.exists(`conv:${ID}:lock`), 0);

  const c = await acquireConvLock(ID);
  await acquireConvLock(ID);                       // محجوبٌ يكتب علامة
  ck('★★ الإفراجُ يُبلّغ عن العلامة المنتظِرة', await releaseConvLock(ID, c!), true);
  ck('  واستُهلكت مرّةً واحدة', await conn.exists(`conv:${ID}:dirty`), 0);
}

/**
 * ② التوازي نفسُه: نُعيد المسبارَ الذي كشف العطل، ثمّ نُدخل القفلَ عليه.
 *    فإن أعطى ١ بعد القفل وكان يُعطي ٢ قبله فالعلاجُ يعمل، لا يُظنّ.
 */
async function serialization(): Promise<void> {
  console.log('\n▶ ② التوازي على طابورٍ مؤقّت — قبل القفل وبعده');
  const name = `drill-lock-q-${process.pid}`;
  const queue = new Queue(name, { connection: conn });

  for (const guarded of [false, true]) {
    let live = 0;
    let max = 0;
    const w = new Worker(name, async () => {
      const tok = guarded ? await acquireConvLock(ID) : 'off';
      if (!tok) return;                                  // محجوبٌ يخرج فوراً
      live += 1; max = Math.max(max, live);
      await new Promise((r) => setTimeout(r, 1200));     // «نداءُ النموذج»
      live -= 1;
      if (guarded) await releaseConvLock(ID, tok);
    }, { connection: conn, concurrency: 3 });

    await queue.add('reply', {}, { jobId: `conv-${ID}`, delay: 0 });
    await queue.add('reply', {}, { jobId: `conv-${ID}-next`, delay: 600 });
    await new Promise((r) => setTimeout(r, 3500));
    await w.close();
    for (const j of await queue.getJobs()) await j.remove().catch(() => {});
    console.log(`  ${guarded ? 'مع القفل ' : 'بلا القفل'}: أقصى تزامنٍ = ${max}`);
    if (!guarded) ck('  بلا القفل: ردّان معاً (العطل)', max, 2);
    else ck('★★★ مع القفل: ردٌّ واحدٌ فقط', max, 1);
  }
  await queue.obliterate({ force: true });
  await queue.close();
}

try {
  await lockSemantics();
  await serialization();
} finally {
  await conn.del(`conv:${ID}:lock`, `conv:${ID}:dirty`);
  await conn.quit();
}

console.log(failures.length
  ? `\n✘ ${failures.length} إخفاق:\n  ${failures.join('\n  ')}`
  : '\n✅ التسلسلُ مُثبَتٌ على ريدِس الحقيقيّ — ولا رسالةَ تضيع');
process.exit(failures.length ? 1 : 0);
