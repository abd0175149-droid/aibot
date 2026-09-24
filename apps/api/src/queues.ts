import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import type { ChannelKind, ParsedWebhook } from '@aibot/channels';
import { AppError, ErrorCode, QUEUE, type PlaygroundJob, type PlaygroundResult } from '@aibot/shared';

/* ★ الأسماء من `@aibot/shared` — مصدرٌ واحدٌ يراه الطرفان. راجع التعليق هناك. */
export { QUEUE } from '@aibot/shared';

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

/**
 * ★ عمقُ إعادة المحاولة هنا **أعمقُ من كلّ الطوابير** — ولسببٍ واحد:
 *   بعد أن يردّ الويبهوك 200 على ميتا تصير هذه المهمّة **النسخة الوحيدة**
 *   من رسالة الزبون. ميتا لن تُعيد ما أُقرّ به، ولا مصدرَ آخر تُقرأ منه.
 *
 *   وكانت `attempts: 3` بتراجعٍ من ثانية: تغطيةٌ قدرها ثلاث ثوانٍ. وأيّ
 *   اضطرابٍ في القاعدة يتجاوزها — إعادةُ تشغيلٍ، ضغطُ ذاكرة، انقطاعُ شبكةٍ
 *   داخل دوكر — يُنهي المحاولات وتسقط الرسالة في `failed` بلا حادثةٍ ولا
 *   أداةِ إعادةِ دفع. وهو الدرس نفسه الذي رفع عمقَ `bot-reply` من محاولتين
 *   إلى أربع بعد تمرين الشبكة، ولم يُطبَّق هنا — والأولى أن يُطبَّق هنا أشدّ.
 *
 *   ستٌّ بتراجعٍ أُسّيٍّ من ثانيتين: 2 · 4 · 8 · 16 · 32 ≈ دقيقةٌ من التغطية.
 *   وما تجاوز الدقيقة عطلٌ يستحقّ حادثةً — وهي تُرفع أدناه في العامل.
 */
export async function enqueueInbound(job: InboundJob): Promise<void> {
  await q(QUEUE.inbound).add('inbound', job, {
    attempts: 6,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

/* ★ وكانت هنا نسخةٌ ثانية من `enqueueReply` **تحمل العطل الذي أُصلح في
   العامل**: تحذف المهمّة في حالتَي `delayed`/`waiting` وحدهما، فتبقى
   المكتملةُ حاجزةً للمعرّف — «ردٌّ واحدٌ لكلّ محادثةٍ في عمرها كلّه».
   ولا مستدعيَ لها في الـAPI إطلاقاً، لكنّ وجودَها فخٌّ: أوّلُ مسارٍ يضيف
   «أعد المحادثة إلى البوت» كان سيستوردها بثقة. فحُذفت — ومنتِجُ الردّ
   الوحيد هو `apps/worker/src/enqueue.ts` ومعه `decideEnqueue`. */

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

/**
 * ★ آخرُ نبضةٍ للعامل — يُقرأ من ريدِس لا من العامل.
 *
 *   والسؤال الذي يجيب عنه لم يكن له جواب: «هل العامل حيّ؟». بوّابةُ النشر
 *   تطابق `rev` الـAPI، وcompose بلا فحصِ صحّةٍ للعامل، فنشرةٌ تكسر مسار
 *   العامل وحده تُطبع ✅ بينما كلُّ الردود متوقّفة.
 *
 *   والغياب هو الخبر: المفتاح بعمرٍ محدود يكتبه العامل كلّ خمس عشرة ثانية،
 *   فانقطاعُه — سقوطاً أو قتلاً أو حلقةً عالقة — يُقرأ هنا بلا أن يُسأل أحد.
 */
export interface WorkerBeat { alive: boolean; ageSec: number | null; rev: string | null }

export async function workerBeat(): Promise<WorkerBeat> {
  try {
    const raw = await Promise.race([
      connection().get('aibot:worker:beat'),
      new Promise<null>((r) => { setTimeout(() => r(null), PING_TIMEOUT_MS); }),
    ]);
    if (!raw) return { alive: false, ageSec: null, rev: null };
    const b = JSON.parse(raw) as { at?: string; rev?: string };
    const ageSec = b.at ? Math.round((Date.now() - Date.parse(b.at)) / 1000) : null;
    return { alive: true, ageSec, rev: b.rev ?? null };
  } catch {
    return { alive: false, ageSec: null, rev: null };
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
  /** صفُّ الصادر المحجوز بحالة `queued` — راجع `SendJob` في العامل. */
  messageId?: string;
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
 * ★ إشعارٌ لمستخدم — أوّل منتِجٍ لطابور `notify-push` في المستودع.
 *
 *   الطابور كان مسجَّلاً في العامل بلا منتِجٍ واحد، والحوادث الحرجة تُنبَّه
 *   بنداءٍ مباشر داخل العامل. فكلّ ما ليس حادثةً حرجة — تحويلٌ إلى موظّف،
 *   عتبةُ سقف، تنبيهٌ تجريبيّ — لم يكن له طريقٌ إلى الإشعار إطلاقاً.
 *
 * `jobId` من الوسم والمستخدم: دفعتان لنفس الموضوع في ثانيةٍ واحدة إشعارٌ
 * واحد، وهو الدرس نفسه الذي وُلد منه الفريدُ الجزئيّ على `notifications`.
 */
export interface NotifyJob {
  userId: string;
  tenantId?: string | null;
  tag: string;
  title: string;
  body?: string;
  url?: string;
  severity?: 'info' | 'warn' | 'critical';
}

export async function enqueueNotify(job: NotifyJob): Promise<void> {
  await q(QUEUE.notify).add('notify', job, {
    jobId: `n-${job.userId}-${job.tag}-${Math.floor(Date.now() / 1000)}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 200,
    removeOnFail: 1000,
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
