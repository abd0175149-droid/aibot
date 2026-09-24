import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { closeDb } from '@aibot/db';
import { handleInbound } from './inbound.js';
import { handleReply } from './reply.js';
import { handleEmbed } from './embed.js';
import { sendOutbound } from './outbound.js';
import { runHealthPoll, closeExpiredWindows, negativeSignals } from './health.js';
import { handleNotify, flushDigest } from './notify.js';
import { handleIngest } from './extract.js';
import { runPlayground } from './playground.js';

/**
 * عمّال الطوابير.
 *
 * القاعدة التي تُنقذ الرسائل: **كلّ رسالةٍ واردة تُكتب في القاعدة ثمّ تُدفع
 * للطابور**، ولا تُعالَج داخل دورة الطلب. فإن سقط العامل أثناء النشر بقيت
 * المهمّة في ريدِس واستؤنفت — بدل أن تضيع بلا أن يعلم أحد.
 * اختبر هذا عمداً: أعِد تشغيل الحاويات أثناء تدفّق رسائل.
 */

const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL غير مضبوط');
const connection = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });

const log = (msg: string, extra?: unknown) =>
  console.log(JSON.stringify({ level: 'info', svc: 'worker', msg, ...(extra as object) }));

const workers = [
  new Worker('ch-inbound', async (job) => handleInbound(job.data), {
    connection,
    concurrency: 10,
  }),
  new Worker('bot-reply', async (job) => handleReply(job.data), {
    connection,
    // تزامنٌ محدود: ردّان متوازيان في نفس المحادثة يتضاربان، والقفل
    // في BullMQ عبر jobId الثابت يمنع ذلك أصلاً.
    concurrency: 3,
  }),
  new Worker('ch-outbound', async (job) => { await sendOutbound(job.data); }, {
    connection,
    // حدّ معدّلٍ عامّ؛ الحدّ لكلّ مستأجر يُضاف بمجموعةِ معدّلٍ في المرحلة الرابعة
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  }),
  new Worker('kb-embed', async (job) => handleEmbed(job.data), {
    connection,
    concurrency: 1, // تضمينٌ واحدٌ في كلّ مرّة — تقدّمٌ مرئيّ لا سباق
  }),
  new Worker('health-poll', async (job) => runHealthPoll(job.data), {
    connection,
    concurrency: 5,
  }),
  new Worker('notify-push', async (job) => handleNotify(job.data), {
    connection,
    concurrency: 5,
  }),
  new Worker('kb-ingest', async (job) => handleIngest(job.data), {
    connection,
    concurrency: 2,
  }),
  /* ★ الساحة: جرّبٌ جافّ يُنتظر جوابُه.
     ولماذا في طابورٍ لا في الـAPI: كلُّ ما يُشغّل البوت هنا (الاسترجاع
     الهجين وكاشُ التضمين وحلقةُ الوكيل)، ونسخُه إلى الـAPI يُنتج ساحةً
     تشهد على مسارٍ غير الذي يعمل. والجوابُ **يُعاد** للمنتِج
     (‏`waitUntilFinished`) فلا يُخزَّن أثرٌ ولا يُبثّ حدث.
     ومحاولةٌ واحدةٌ لا إعادة: نداءُ النموذج يُحاسَب، وإعادةُ محاولةٍ
     صامتةٌ تضاعف كلفةَ العميل على ضغطةٍ واحدة. */
  new Worker('bot-dry', async (job) => runPlayground(job.data), {
    connection,
    concurrency: 3,
  }),
  new Worker('maintenance', async (job) => {
    if (job.name === 'windows') {
      const n = await closeExpiredWindows();
      log('أُغلقت نوافذ منتهية', { n });
    } else if (job.name === 'signals') {
      await negativeSignals();
    } else if (job.name === 'digest') {
      await flushDigest();
    }
  }, { connection, concurrency: 1 }),
];

/**
 * المجدوِلات المتكرّرة.
 * تُسجَّل بمعرّفاتٍ ثابتة، فإعادة التشغيل لا تُضاعفها.
 */
async function scheduleRepeatables(): Promise<void> {
  const { Queue } = await import('bullmq');
  const health = new Queue('health-poll', { connection });
  const maint = new Queue('maintenance', { connection });

  await health.add('poll', {}, {
    repeat: { every: 10 * 60 * 1000 }, jobId: 'health-poll', removeOnComplete: 10,
  });
  await maint.add('windows', {}, {
    repeat: { every: 10 * 60 * 1000 }, jobId: 'close-windows', removeOnComplete: 10,
  });
  await maint.add('signals', {}, {
    repeat: { every: 5 * 60 * 1000 }, jobId: 'negative-signals', removeOnComplete: 10,
  });
  await maint.add('digest', {}, {
    // التجميع كلّ 15 دقيقة — الحرج يخترقه ويمرّ فوراً
    repeat: { every: 15 * 60 * 1000 }, jobId: 'digest', removeOnComplete: 10,
  });
}

await scheduleRepeatables().catch((e) =>
  console.error(JSON.stringify({ level: 'error', svc: 'worker', msg: 'فشل جدولة المتكرّرات', err: String(e) })));

for (const w of workers) {
  w.on('completed', (job) => log('مهمّة تمّت', { queue: w.name, id: job.id }));
  w.on('failed', (job, err) =>
    console.error(JSON.stringify({
      level: 'error', svc: 'worker', queue: w.name, id: job?.id,
      attempts: job?.attemptsMade, msg: err?.message,
    })),
  );
}

/**
 * ★ نبضةُ العامل — **مفتاحُ الرجل الميّت**.
 *
 *   كلّ ما يجعل البوت يردّ يعيش في هذه العمليّة، ولا شيءَ خارجها يعرف إن كانت
 *   حيّة: بوّابةُ النشر تطابق `rev` الـAPI وحده، وcompose بلا فحصِ صحّةٍ
 *   للعامل، والإشارةُ السلبيّة «رسائل بلا ردود» تُحسب بمهمّةٍ متكرّرة يشغّلها
 *   العاملُ نفسه. فعاملٌ ساقطٌ يعني بوتاتٍ صامتةً لكلّ العملاء بينما كلُّ
 *   شاشةٍ خضراء.
 *
 *   والنبضةُ تُكتب من هذه العمليّة إلى ريدِس بعمرٍ محدود: **غيابُها هو الخبر**
 *   لا وجودُها. فلا تحتاج من يسأل العاملَ إن كان حيّاً — يكفي أن يسأل ريدِس
 *   متى نبض آخر مرّة. وهذا ما يجعلها تعمل حين تموت العمليّة فجأةً بلا وداع.
 *
 * ⚠️ والعمر ضعفُ الفترة وزيادة: نبضةٌ تأخّرت ثانيتين بسبب مهمّةٍ ثقيلة ليست
 *    عاملاً ميّتاً، وإنذارٌ يكذب مرّةً يُصبح إنذاراً لا يُقرأ.
 */
const BEAT_KEY = 'aibot:worker:beat';
const BEAT_EVERY_MS = 15_000;
const BEAT_TTL_SEC = 45;

async function beat(): Promise<void> {
  await connection.set(
    BEAT_KEY,
    JSON.stringify({ at: new Date().toISOString(), rev: process.env.GIT_REV ?? 'unknown', pid: process.pid }),
    'EX', BEAT_TTL_SEC,
  ).catch(() => undefined); // نبضةٌ فائتة ليست عطلاً يُسقط العامل
}

await beat();
const beatTimer = setInterval(() => { void beat(); }, BEAT_EVERY_MS);
// لا تُبقِ العمليّةَ حيّةً من أجل النبضة وحدها
beatTimer.unref?.();

log('العمّال يعملون', { queues: workers.map((w) => w.name), rev: process.env.GIT_REV });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    log('إغلاقٌ لطيف — إنهاء المهامّ الجارية قبل الخروج');
    clearInterval(beatTimer);
    /* النبضةُ تُمحى صراحةً عند الإغلاق اللطيف: انتظارُ انقضاء العمر يعني
       خمسَ وأربعين ثانيةً يقول فيها المراقبُ «حيّ» والعاملُ يُغلق. */
    await connection.del(BEAT_KEY).catch(() => undefined);
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    await closeDb();
    process.exit(0);
  });
}
