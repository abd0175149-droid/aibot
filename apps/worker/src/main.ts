import { QUEUE } from '@aibot/shared';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { closeDb } from '@aibot/db';
import { handleInbound } from './inbound.js';
import { handleReply } from './reply.js';
import { sweepStrandedConversations } from './enqueue.js';
import { handleEmbed } from './embed.js';
import { sendOutbound } from './outbound.js';
import { runHealthPoll, closeExpiredWindows, negativeSignals } from './health.js';
import { handleNotify, flushDigest, checkAlerting, checkKeyCoverage } from './notify.js';
import { runRetention } from './retention.js';
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
  new Worker(QUEUE.inbound, async (job) => handleInbound(job.data), {
    connection,
    concurrency: 10,
  }),
  new Worker(QUEUE.reply, async (job) => handleReply(job.data), {
    connection,
    // تزامنٌ محدود: ردّان متوازيان في نفس المحادثة يتضاربان، والقفل
    // في BullMQ عبر jobId الثابت يمنع ذلك أصلاً.
    concurrency: 3,
  }),
  new Worker(QUEUE.outbound, async (job) => { await sendOutbound(job.data); }, {
    connection,
    // حدّ معدّلٍ عامّ؛ الحدّ لكلّ مستأجر يُضاف بمجموعةِ معدّلٍ في المرحلة الرابعة
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  }),
  new Worker(QUEUE.embed, async (job) => handleEmbed(job.data), {
    connection,
    concurrency: 1, // تضمينٌ واحدٌ في كلّ مرّة — تقدّمٌ مرئيّ لا سباق
  }),
  new Worker(QUEUE.health, async (job) => runHealthPoll(job.data), {
    connection,
    concurrency: 5,
  }),
  new Worker(QUEUE.notify, async (job) => handleNotify(job.data), {
    connection,
    concurrency: 5,
  }),
  new Worker(QUEUE.ingest, async (job) => handleIngest(job.data), {
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
  new Worker(QUEUE.dry, async (job) => runPlayground(job.data), {
    connection,
    concurrency: 3,
  }),
  new Worker(QUEUE.maintenance, async (job) => {
    if (job.name === 'windows') {
      const n = await closeExpiredWindows();
      log('أُغلقت نوافذ منتهية', { n });
    } else if (job.name === 'signals') {
      await negativeSignals();
    } else if (job.name === 'retention') {
      const r = await runRetention();
      /* يُسجَّل دائماً ولو كان صفراً: «لم يُحذف شيء» خبرٌ يُقرأ، و«لم يعمل
         الاحتفاظ منذ أسبوع» هو ما لا يُرى بلا هذا السطر. */
      log('احتفاظ', Object.fromEntries(r.map((x) => [x.table, x.deleted])));
    } else if (job.name === 'digest') {
      await flushDigest();
    } else if (job.name === 'keycover') {
      const k = await checkKeyCoverage();
      /* يُسجَّل في الحالتَين: «كلُّ إصدارٍ مغطّى» خبرٌ يُقرأ بعد تدوير، و
         «إصدارٌ بلا مفتاح» هو الخبرُ الذي كان يضيع في صمتٍ تامّ. */
      log(k.ok ? 'مفاتيحُ التشفير تغطّي كلَّ الصفوف' : '🔴 صفوفٌ بإصدارٍ بلا مفتاح', k);
    } else if (job.name === 'alerting') {
      const a = await checkAlerting();
      /* ويُسجَّل في الحالتَين: «القناة تعمل» خبرٌ يُقرأ بعد إصلاحٍ، و«صفر
         مشتركين» هو الخبرُ الذي لم يكن يُكتب إطلاقاً. */
      log(a.ok ? 'قناةُ التنبيه موصولة' : '🔴 قناةُ التنبيه بلا مشترك', a);
    } else if (job.name === 'stranded') {
      const n = await sweepStrandedConversations();
      /* صفرٌ هو الحالةُ السليمة ولا يُسجَّل: سطرٌ كلَّ دقيقةٍ ضجيجٌ يملأ قرصاً
         هو على ٨٦٪. وما يُقرأ هو الشذوذ — محادثةٌ أُنقذت. */
      if (n > 0) log('محادثاتٌ موسومةٌ بلا حارسٍ أُعيدت جدولتُها', { n });
    }
  }, { connection, concurrency: 1 }),
];

/**
 * ★★★ **المجدوِلات — و«عاملٌ يعمل بلا مجدوِلات» كان لا يكشفه شيء.**
 *
 *   كان التسجيلُ `catch` يطبع سطراً ويمضي. فعاملٌ فشلت جدولتُه يبقى حيّاً
 *   ونبضتُه خضراء، بينما: لا فحصَ صحّةٍ للقنوات، ولا إغلاقَ نوافذَ (فالفوترة
 *   تُحسب على نوافذَ لا تُغلق)، ولا إشارةً سلبيّةً «رسائلُ بلا ردود»، ولا
 *   تجميعَ إشعارات. أي أنّ كلَّ ما يُنبِّه أنّ شيئاً تعطّل **هو نفسُه** ما
 *   تعطّل — وكلُّ شاشةٍ خضراء.
 *
 * ★ والروسترُ صريحٌ ومعدود، والعددُ المتوقَّع يأتي من **هنا** لا من رقمٍ مكتوبٍ
 *   في bash: فإضافةُ مجدوِلٍ خامسٍ غداً لا تُفشل النشر بلا سبب.
 */
const SCHED = [
  { q: QUEUE.health, name: 'poll', jobId: 'health-poll', every: 10 * 60_000 },
  { q: QUEUE.maintenance, name: 'windows', jobId: 'close-windows', every: 10 * 60_000 },
  { q: QUEUE.maintenance, name: 'signals', jobId: 'negative-signals', every: 5 * 60_000 },
  // التجميع كلّ 15 دقيقة — الحرج يخترقه ويمرّ فوراً
  { q: QUEUE.maintenance, name: 'digest', jobId: 'digest', every: 15 * 60_000 },
  /* ★ الاحتفاظ مرّةً كلّ ستّ ساعات: الحذفُ دفعاتٌ محدودة، وما يبقى
     يُحذف في الدورة التالية — فلا حاجةَ إلى تواترٍ أعلى، والتواترُ العالي
     يعني قفلَ صفوفٍ أكثر بلا فائدة. */
  { q: QUEUE.maintenance, name: 'retention', jobId: 'retention', every: 6 * 60 * 60_000 },
  /* ★ مسحُ المحادثات الموسومة كلَّ دقيقة — وهو شبكةُ أمانٍ لا آليّةُ عمل.
     الطريقُ العاديّ أنّ حاملَ القفل يقرأ العلامةَ عند تحرّره؛ وهذا المسحُ
     لمن مات حاملُه في الأثناء (نشرةٌ، أو قاتلُ الذاكرة). ودقيقةٌ لأنّها
     تأخيرُ ردٍّ مقبولٌ في أسوأ حالةٍ، والمسحُ `SCAN` على مفاتيحَ قليلةٍ
     فكلفتُه لا تُذكر. */
  { q: QUEUE.maintenance, name: 'stranded', jobId: 'stranded-convs', every: 60_000 },
  /* ★ فحصُ بلوغِ التنبيه كلَّ ساعة — لا عند الإقلاع وحده. الاشتراكُ يموت بلا
     حدثٍ يُعلنه (إذنٌ يُسحب، مفتاحُ VAPID يُبدَّل، جهازٌ يُمسح)، فالعمياءُ
     تُولد في منتصف الطريق لا عند البداية. */
  { q: QUEUE.maintenance, name: 'alerting', jobId: 'alerting-check', every: 60 * 60_000 },
  /* ★ تغطيةُ مفاتيح التشفير كلَّ ساعة — مع فحص التنبيه وبنفس السبب: كلاهما
     يسأل «هل ما نعتمد عليه موجودٌ أصلاً؟»، وكلاهما يكشف صمتاً لا عطلاً. */
  { q: QUEUE.maintenance, name: 'keycover', jobId: 'keycover-check', every: 60 * 60_000 },
] as const;

export const SCHED_EXPECTED = SCHED.length;

/**
 * يُسجّل المتكرّرات ثمّ **يقرأ من ريدِس كم منها سُجّل فعلاً**.
 *
 * ⚠️ والقراءةُ بعد الكتابة هي كلُّ الفائدة: `add` قد يُرجع بلا خطأ ولا يُنتج
 *    متكرّراً (اتّصالٌ يُعاد، أو مفتاحٌ مُحيت عليه الكتابة)، فالنيّةُ ليست
 *    دليلاً. والعددُ المقروء هو ما يُعلَن في النبضة وتحرس عليه بوّابةُ النشر.
 */
async function scheduleRepeatables(): Promise<number> {
  const { Queue } = await import('bullmq');
  const queues = new Map<string, InstanceType<typeof Queue>>();
  for (const s of SCHED) {
    if (!queues.has(s.q)) queues.set(s.q, new Queue(s.q, { connection }));
    await queues.get(s.q)!.add(s.name, {}, {
      repeat: { every: s.every }, jobId: s.jobId, removeOnComplete: 10,
    });
  }
  let n = 0;
  /* `getJobSchedulersCount` لا `getRepeatableJobs().length`: الثانيةُ تجلب
     الصفوفَ كلَّها لتعدّها، والأولى عدٌّ في ريدِس. */
  for (const [, queue] of queues) n += await queue.getJobSchedulersCount();
  return n;
}

/**
 * ★★ والفشلُ يَقتل لا يُسجَّل: عاملٌ لا يستطيع الجدولة ليس عاملاً يعمل، وبقاؤه
 *   حيّاً بنبضةٍ خضراء هو الكذبةُ بعينها. والخروجُ يجعل compose يُعيد تشغيله،
 *   فإن كان العطلُ عابراً شُفي، وإن كان دائماً بقيت الحاويةُ تتهاوى **ظاهرةً**
 *   بدل أن تُعلن صحّةً كاذبة.
 */
const schedCount = await scheduleRepeatables().catch((e) => {
  console.error(JSON.stringify({
    level: 'error', svc: 'worker', msg: 'فشل جدولة المتكرّرات', err: String(e),
  }));
  return -1;
});

/* ⚠️ `<` لا `!==`: عددٌ **أكبر** يعني مجدوِلاً قديماً بقي في ريدِس بعد إعادة
   تسمية — وهو نفايةٌ تُنظَّف، لا سببٌ لمنع النشر. و`!==` كانت ستُسقط أوّلَ
   نشرةٍ بعد أيّ تغييرِ اسم: انقطاعٌ نصنعه بأيدينا لأجل صفٍّ زائدٍ في ريدِس. */
if (schedCount < SCHED_EXPECTED) {
  console.error(JSON.stringify({
    level: 'fatal', svc: 'worker', msg: 'المجدوِلات ناقصة — لا إقلاع',
    expected: SCHED_EXPECTED, got: schedCount,
  }));
  process.exit(1);
}

for (const w of workers) {
  /* 🔴 سطرٌ لكلّ مهمّةٍ **تمّت** ليس تشخيصاً بل ضجيج: النجاحُ هو الحالةُ
     الغالبة، فيُغرق السجلَّ بما لا يُقرأ ويدفن الإخفاقات بينه — ويملأ قرصاً
     هو أصلاً على ٨٦٪. والفشلُ يبقى مسجَّلاً كاملاً أدناه: **الخبرُ هو ما
     شذّ**. ويبقى الإحصاءُ متاحاً من عمق الطوابير في `/api/health/deep`. */
  if (process.env.LOG_COMPLETED === '1') {
    w.on('completed', (job) => log('مهمّة تمّت', { queue: w.name, id: job.id }));
  }
  w.on('failed', (job, err) => {
    const finalAttempt = !job || (job.attemptsMade >= (job.opts?.attempts ?? 1));
    console.error(JSON.stringify({
      level: 'error', svc: 'worker', queue: w.name, id: job?.id,
      tenantId: (job?.data as { tenantId?: string } | undefined)?.tenantId,
      attempts: job?.attemptsMade, final: finalAttempt, msg: err?.message,
      /* ★ **الأثر، لا الرسالةُ وحدها.** مهمّةٌ فشلت برسالةٍ عامّةٍ مثل
         «The "string" argument must be of type string … Received an instance
         of Date» لا تدلّ على موضعٍ واحد: بحثتُ عنها في سبعة مواضع محتملة قبل
         أن أدرك أنّ السجلّ نفسه هو النقص. وأربعةُ إطاراتٍ تكفي لتسمية الملفّ
         والسطر، ولا تُغرق سجلّاً على قرصٍ ضيّق. */
      stack: err?.stack?.split('\n').slice(1, 5).map((l) => l.trim()),
    }));

    /* ★ الفشل **النهائيّ** يُنتج حادثة — وكان يُكتب سطرَ سجلٍّ لا يقرؤه أحد.
       ومهمّةُ `ch-inbound` الفاشلة نهائيّاً تعني **رسالةَ زبونٍ ضاعت**: ميتا
       تلقّت 200 ولن تُعيد، والمجموعة الفاشلة تُقصّ عند 5000. فالحادثة هي
       الأثر الوحيد الذي يبقى — وبدونها كان الفقد صامتاً تماماً. */
    if (!finalAttempt) return;
    const tenantId = (job?.data as { tenantId?: string } | undefined)?.tenantId;
    void import('./incidents.js').then(({ raiseIncident }) => raiseIncident({
      tenantId: tenantId ?? null,
      kind: 'job_failed',
      severity: w.name === 'ch-inbound' ? 'critical' : 'warn',
      title: w.name === 'ch-inbound'
        ? 'رسالةُ زبونٍ لم تُعالَج بعد كلّ المحاولات'
        : `مهمّةٌ فشلت نهائيّاً في ${w.name}`,
      detail: { queue: w.name, jobId: String(job?.id ?? ''), error: err?.message?.slice(0, 300) },
      /* بصمةٌ بالطابور لا بالمهمّة: عشرُ رسائلَ ضاعت في انقطاعٍ واحد حادثةٌ
         واحدة بعدّادٍ عشرة — لا عشرُ حوادثَ تُغرق الشاشة. */
      causeKey: w.name,
    })).catch(() => undefined);
  });
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
    /* ★ وعددُ المجدوِلات في النبضة: «حيٌّ» وحدها لا تُفرّق عاملاً يعمل من
       عاملٍ يدور بلا شيءٍ يفعله. وهو مقروءٌ من ريدِس لا منويٌّ في الكود. */
    JSON.stringify({
      at: new Date().toISOString(),
      rev: process.env.GIT_REV ?? 'unknown',
      pid: process.pid,
      sched: schedCount,
    }),
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
