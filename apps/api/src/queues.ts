import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import type { ChannelKind, ParsedWebhook } from '@aibot/channels';
import { AppError, ErrorCode, type PlaygroundJob, type PlaygroundResult } from '@aibot/shared';

/**
 * الطوابير — الأسماء محايدةٌ للقناة عمداً (`ch:` لا `wa:`).
 * قناةٌ ثانية لا تضيف طابوراً؛ تضيف `channelId` في الحمولة.
 */
/**
 * ⚠️ لا نقطتين في اسم الطابور **ولا في معرّف المهمّة**: BullMQ 5 يرفض الاثنين
 *    («Queue name cannot contain :» و«Custom Id cannot contain :»).
 *    كشفهما أوّل تشغيلٍ على الخادم، واحداً بعد الآخر — والثاني لم يظهر إلّا
 *    بعد إصلاح الأوّل، فالرسالة لم تصل إلى مرحلة الجدولة قبله.
 */
export const QUEUE = {
  inbound: 'ch-inbound',
  reply: 'bot-reply',
  outbound: 'ch-outbound',
  embed: 'kb-embed',
  health: 'health-poll',
  notify: 'notify-push',
  ingest: 'kb-ingest',
  dry: 'bot-dry',
} as const;

let conn: IORedis | null = null;
const queues = new Map<string, Queue>();

function connection(): IORedis {
  if (conn) return conn;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL غير مضبوط');
  // maxRetriesPerRequest: null شرطٌ في BullMQ — بدونه تُرمى المهامّ عند تذبذب الشبكة
  conn = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  return conn;
}

export function q(name: string): Queue {
  let existing = queues.get(name);
  if (!existing) {
    existing = new Queue(name, { connection: connection() });
    queues.set(name, existing);
  }
  return existing;
}

export interface InboundJob {
  tenantId: string;
  channelId: string;
  kind: ChannelKind;
  parsed: ParsedWebhook;
}

export async function enqueueInbound(job: InboundJob): Promise<void> {
  await q(QUEUE.inbound).add('inbound', job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

/**
 * دمج الرسائل المتتالية بلا مؤقّتٍ في الذاكرة.
 *
 * `jobId` ثابتٌ لكلّ محادثة + تأخير 2000ms: رسالةٌ جديدة تستبدل المهمّة
 * المؤجَّلة نفسها بدل أن تُنشئ ثانية. فالعميل يكتب ثلاثة أسطر فيردّ البوت مرّةً.
 *
 * وهذا ما يجعل إعادة تشغيل الخادم غير مُضيِّعةٍ لردّ: المهمّة في ريدِس لا في
 * `setTimeout` يموت مع العمليّة.
 */
export async function enqueueReply(conversationId: string, delayMs = 2000): Promise<void> {
  const jobId = `conv-${conversationId}`;
  const queue = q(QUEUE.reply);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'delayed' || state === 'waiting') await existing.remove();
  }
  await queue.add('reply', { conversationId }, {
    jobId,
    delay: delayMs,
    attempts: 4,
    /* ★ كان `backoff` ناقصاً هنا كما في `apps/worker/src/enqueue.ts`، وكشفه
       تمرين المزوّد: بلا تراجعٍ تُعاد المحاولة **فوراً** فتُستهلك المحاولتان
       على نفس اللحظة الفاشلة. ثمّ رفع تمرينُ الشبكة العددَ من اثنتين إلى
       أربع: محاولتان بتراجعِ خمسٍ تغطّيان خمسَ ثوانٍ من انقطاعٍ لا غير،
       وقد ماتت مهمّةٌ حقيقيّةٌ بسببها في التمرين. والقيمة نفسها في الموضعَين
       عن قصد: مسارٌ واحد بسلوكَين هو عطلٌ ينتظر ساعته — والحارس في
       `apps/worker/test/retry-policy.test.ts` يفشل إن تباعدا. */
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 2000,
  });
}

/**
 * ★ المهلة ليست احتياطاً — هي الفرق بين «٥٠٣» و«لا جواب أبداً».
 *
 * كشفه بناءُ تمرين ريدِس (`apps/worker/scripts/drill-redis.ts`): الاتّصال
 * مضبوطٌ بـ`maxRetriesPerRequest: null` وطابورُ عدم الاتّصال مفتوح، فأمرٌ
 * يُصدَر وريدِس مطفأ **لا يفشل ولا ينجح — ينتظر إلى الأبد**. فكان
 * `/api/health` يتوقّف على `Promise.all` بلا نهاية: مراقبٌ خارجيّ يرى مهلةً
 * منقضية لا 503، و`deploy.sh` يحرس على نفس البوّابة فيُقرأ «الخادم لا يردّ»
 * بدل «ريدِس مقطوع» — وهما تشخيصان مختلفان تماماً.
 *
 * والمهلة **هنا وحدها**، لا على `enqueueInbound`: انتظارُ الدفع هو ما يحفظ
 * رسالةً وصلت أثناء انقطاعٍ قصير، فقطعُه يُحوّل التأخيرَ إلى فقدان. البوّابةُ
 * تُخبر، والدفعُ يصبر.
 */
const PING_TIMEOUT_MS = Number(process.env.REDIS_PING_TIMEOUT_MS ?? '2000');

export async function pingRedis(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const pong = await Promise.race([
      connection().ping(),
      new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), PING_TIMEOUT_MS); }),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function queueDepths(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of Object.values(QUEUE)) {
    try {
      const counts = await q(name).getJobCounts('waiting', 'active', 'delayed', 'failed');
      out[name] = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
      out[`${name}:failed`] = counts.failed ?? 0;
    } catch {
      out[name] = -1;
    }
  }
  return out;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((x) => x.close()));
  queues.clear();
  await dryEvents?.close();
  dryEvents = null;
  await conn?.quit();
  conn = null;
}

/* ───────────────────── الساحة: مهمّةٌ يُنتظر جوابُها ───────────────────── */

/**
 * ★ **لماذا طابورٌ لطلبٍ متزامن.**
 *
 *   الجرّب الجافّ يشتغل في العامل لأنّ كلَّ ما يُشغّل البوت هناك: الاسترجاع
 *   الهجين وكاشُ التضمين وحلقةُ الوكيل والحرّاس. والـAPI لا يستورد من
 *   `apps/worker` ولا يجوز أن يفعل — فنسخُ الاسترجاع هنا يُنتج ساحةً تشهد
 *   على مسارٍ **غير** الذي يعمل في الإنتاج، وذاك أسوأ من غياب الساحة.
 *
 *   فالمهمّة تُدفع ويُنتظر **ناتجُها** (`waitUntilFinished`) بدل أن يُبثّ
 *   حدثٌ ويُستعلَم عنه. والانتظارُ محدودٌ بمهلة: عاملٌ ساقطٌ يعني رسالةً
 *   واضحةً بعد دقيقةٍ ونصف، لا طلباً معلّقاً إلى الأبد.
 *
 * ⚠️ `QueueEvents` اتّصالٌ **حاجز** (blocking) لا يُشارَك مع اتّصال الطوابير،
 *    ولذلك نسخةٌ واحدةٌ مُنشأةٌ تأخيراً تُغلَق مع البقيّة — ونسخةٌ لكلّ طلبٍ
 *    تعني اتّصالَ ريدِسٍ لكلّ ضغطةِ «جرّب».
 *
 * ⚠️ و`removeOnComplete` **بعدد لا بصفر**: `waitUntilFinished` تسأل عن حالة
 *    المهمّة بعد تسجيل مستمعيها، فمهمّةٌ حُذفت في تلك اللحظة تُترك الطلبَ
 *    معلّقاً حتّى المهلة.
 */
let dryEvents: QueueEvents | null = null;

function events(): QueueEvents {
  dryEvents ??= new QueueEvents(QUEUE.dry, { connection: connection().duplicate() });
  return dryEvents;
}

const DRY_TIMEOUT_MS = 90_000;

export async function runDryReply(payload: PlaygroundJob): Promise<PlaygroundResult> {
  const job = await q(QUEUE.dry).add('dry', payload, {
    // محاولةٌ واحدة: النداء يُحاسَب، وإعادةٌ صامتةٌ تضاعف كلفةَ ضغطةٍ واحدة
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
  });
  try {
    return await job.waitUntilFinished(events(), DRY_TIMEOUT_MS) as PlaygroundResult;
  } catch (e) {
    /* فشلُ العامل أو المهلة — لا يُعاد نصُّ الاستثناء للمستخدم: يُسجَّل
       ويُقال له ما يفعل. */
    throw new AppError(
      ErrorCode.INTERNAL,
      'تعذّر تشغيل التجربة الآن. حاول ثانيةً بعد لحظات — وإن تكرّر فأبلغنا.',
      503,
      { cause: (e as Error).message },
    );
  }
}

export interface OutboundJob {
  tenantId: string;
  conversationId: string;
  message: unknown;
  source: 'bot' | 'agent' | 'system';
  userId?: string;
  aiRunId?: string;
  idempotencyKey?: string;
}

/**
 * الإرسال.
 * `jobId` من مفتاح التكرار: ضغطتان على «إرسال» تُنتجان مهمّةً واحدة —
 * BullMQ يرفض المعرّف المكرّر بلا رمي.
 */
export async function enqueueOutbound(job: OutboundJob): Promise<void> {
  await q(QUEUE.outbound).add('outbound', job, {
    ...(job.idempotencyKey ? { jobId: `out-${job.tenantId}-${job.idempotencyKey}` } : {}),
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

/**
 * استيعاب ملفّ معرفة.
 *
 * ★ كان عامل `kb-ingest` مسجَّلاً **بلا منتِجٍ إطلاقاً** — أي أنّ رفع الملفّات
 *   ميزةٌ مبنيّةٌ وميّتة: المستخرِج جاهز ولا شيء يُدخل له مهمّة. هذه الدالّة هي
 *   المنتِج الناقص.
 *
 * `jobId` بمعرّف المصدر: ضغطتان على «ارفع» لا تُنتجان استيعابَين.
 */
export async function enqueueIngest(job: {
  tenantId: string; sourceId: string; path: string; mime: string;
}): Promise<void> {
  await q(QUEUE.ingest).add('ingest', job, {
    jobId: `ingest-${job.sourceId}`,
    attempts: 2,
    backoff: { type: 'exponential', delay: 1500 },
    removeOnComplete: 200,
    removeOnFail: 500,
  });
}

export async function enqueueEmbed(job: { tenantId: string; versionId: string }): Promise<void> {
  await q(QUEUE.embed).add('embed', job, {
    // مرّةٌ واحدة بتقدّمٍ مرئيّ — لا إعادة محاولةٍ صامتة تُنتج تضميناً مزدوجاً
    jobId: `embed-${job.versionId}`,
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
