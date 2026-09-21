import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { closeDb } from '@aibot/db';
import { handleInbound } from './inbound.js';
import { handleReply } from './reply.js';
import { handleEmbed } from './embed.js';
import { sendOutbound } from './outbound.js';
import { runHealthPoll } from './health.js';

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
  new Worker('ch:inbound', async (job) => handleInbound(job.data), {
    connection,
    concurrency: 10,
  }),
  new Worker('bot:reply', async (job) => handleReply(job.data), {
    connection,
    // تزامنٌ محدود: ردّان متوازيان في نفس المحادثة يتضاربان، والقفل
    // في BullMQ عبر jobId الثابت يمنع ذلك أصلاً.
    concurrency: 3,
  }),
  new Worker('ch:outbound', async (job) => { await sendOutbound(job.data); }, {
    connection,
    // حدّ معدّلٍ عامّ؛ الحدّ لكلّ مستأجر يُضاف بمجموعةِ معدّلٍ في المرحلة الرابعة
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  }),
  new Worker('kb:embed', async (job) => handleEmbed(job.data), {
    connection,
    concurrency: 1, // تضمينٌ واحدٌ في كلّ مرّة — تقدّمٌ مرئيّ لا سباق
  }),
  new Worker('health:poll', async (job) => runHealthPoll(job.data), {
    connection,
    concurrency: 5,
  }),
];

for (const w of workers) {
  w.on('completed', (job) => log('مهمّة تمّت', { queue: w.name, id: job.id }));
  w.on('failed', (job, err) =>
    console.error(JSON.stringify({
      level: 'error', svc: 'worker', queue: w.name, id: job?.id,
      attempts: job?.attemptsMade, msg: err?.message,
    })),
  );
}

log('العمّال يعملون', { queues: workers.map((w) => w.name), rev: process.env.GIT_REV });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    log('إغلاقٌ لطيف — إنهاء المهامّ الجارية قبل الخروج');
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    await closeDb();
    process.exit(0);
  });
}
