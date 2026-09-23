import { Queue } from 'bullmq';
import IORedis from 'ioredis';

let conn: IORedis | null = null;
const queues = new Map<string, Queue>();

function connection(): IORedis {
  if (!conn) conn = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null, enableReadyCheck: false });
  return conn;
}
function q(name: string): Queue {
  let x = queues.get(name);
  if (!x) { x = new Queue(name, { connection: connection() }); queues.set(name, x); }
  return x;
}

/**
 * ما نفعله بمهمّةٍ تحمل المعرّف نفسه.
 *
 * ★ الفخّ الذي وُلدت منه هذه الدالّة: **BullMQ يتجاهل بصمت** `add` بمعرّفٍ
 *   موجود — لا يرمي ولا يُبلّغ. وكان الكود يحذف المهمّة القديمة في حالتَي
 *   `delayed`/`waiting` وحدهما، فبقيت المهمّة المكتملة في مجموعة `completed`
 *   (وعمرها 500 مهمّة)، فصار المعرّف محجوزاً إلى الأبد:
 *   **كلّ محادثة تأخذ ردّاً واحداً في عمرها كلّه، والباقي يُهمَل بصمت.**
 *   ولم يكن في السجلّ سطرٌ واحد يدلّ عليه.
 *
 * مفصولةٌ عن ريدِس عمداً لتُختبر بلا بنيةٍ تحتيّة — القرار هو ما ينكسر،
 * لا استدعاء الشبكة.
 */
export type EnqueueAction =
  /** لا مهمّة بالمعرّف — أضِف مباشرةً. */
  | 'add'
  /** مؤجَّلة أو منتظرة: احذفها وأضِف — وهذا هو دمج الرسائل المتتالية. */
  | 'replace'
  /** مكتملة أو فاشلة: احذفها وأضِف — وإلّا حُجز المعرّف إلى الأبد. */
  | 'clear-then-add'
  /** قيد التوليد الآن: لا تلمسه، وجدوِل تالياً بمعرّفٍ مستقلّ. */
  | 'sidecar';

export function decideEnqueue(state: string | undefined): EnqueueAction {
  if (!state || state === 'unknown') return 'add';
  if (state === 'delayed' || state === 'waiting' || state === 'waiting-children' || state === 'prioritized') {
    return 'replace';
  }
  if (state === 'active') return 'sidecar';
  // completed · failed — ومعهما أيّ حالةٍ نهائيّة تضيفها BullMQ لاحقاً
  return 'clear-then-add';
}

/**
 * ★ `backoff` لم يكن هنا إطلاقاً — وكشفه تمرين المزوّد (`drill-provider.ts`).
 *   بلا `backoff` تُعيد BullMQ المحاولة **فوراً**: مزوّدٌ يعيد ٥٠٠ يُضرَب
 *   ضربتَين في أقلّ من ثانية، ثمّ تُستهلك المحاولتان وتموت المهمّة — أي أنّ
 *   «إعادة المحاولة» كانت اسماً بلا مُسمّى، فالعطل العابر لم يُمنَح وقتاً
 *   ليمرّ.
 *
 * ★ ثمّ **عمّقها تمرينُ الشبكة** (`drill-network.ts`) حين شُغِّل على الخادم
 *   لأوّل مرّة: محاولتان بتراجعٍ خمسِ ثوانٍ تغطّيان **خمس ثوانٍ من انقطاع**
 *   (المحاولة الأولى عند صفر والثانية عند الخامسة). وقد قُطعت الشبكة فاستُهلكت
 *   المحاولتان وهي مقطوعة، فماتت المهمّة ولم تُستأنف بعد عودتها — والعاملُ
 *   نفسه كان سليماً يستهلك الطوابير. أي أنّ العطل لم يكن في التعافي بل في
 *   **عمقٍ لا يبلغ أيّ انقطاعٍ واقعيّ**: وميضُ واي-فاي، أو نومُ لابتوب، أو
 *   فُواقُ مزوّدٍ — كلُّها تتجاوز خمس ثوانٍ.
 *
 *   أربعٌ بتراجعٍ أُسّيٍّ من خمس: 5 ثمّ 10 ثمّ 20 — نحو خمسٍ وثلاثين ثانيةً من
 *   التغطية. ولم تُرفع أكثر لأنّ لكلّ محاولةٍ ثمناً عند مزوّدٍ يُحاسِب، ولأنّ
 *   انقطاعاً يتجاوز الدقيقة عطلٌ يستحقّ حادثةً لا صبراً صامتاً.
 *
 * و`removeOnFail` حدٌّ لا زينة: مجموعةُ الفاشلة بلا حدٍّ تكبر إلى الأبد في
 * ريدِس، وهو الذاكرة الوحيدة للمهامّ التي لم تُنفَّذ بعد.
 */
const REPLY_OPTS = {
  delay: 2000,
  attempts: 4,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 500,
  removeOnFail: 2000,
} as const;

/**
 * دمج الرسائل المتتالية بلا مؤقّتٍ في الذاكرة:
 * معرّفٌ ثابتٌ لكلّ محادثة + تأخيرٌ قصير — رسالةٌ جديدة تستبدل المهمّة
 * المؤجَّلة. العميل يكتب ثلاثة أسطر فيردّ البوت مرّةً واحدة.
 */
export async function enqueueReply(conversationId: string, delayMs = REPLY_OPTS.delay): Promise<void> {
  const jobId = `conv-${conversationId}`;
  const queue = q('bot-reply');
  const existing = await queue.getJob(jobId);
  const action = decideEnqueue(existing ? await existing.getState() : undefined);

  if (action === 'sidecar') {
    /* ردٌّ قيد التوليد لا يرى الرسالة التي وصلت للتوّ، فلو انتظرنا ضاعت.
       معرّفٌ مستقلّ يضمن ردّاً تالياً — ونقبل احتمال ردَّين متقاربَين،
       فهو أهون بكثيرٍ من رسالةٍ بلا ردّ. */
    await queue.add('reply', { conversationId },
      { ...REPLY_OPTS, jobId: `${jobId}-next-${Date.now()}`, delay: delayMs });
    return;
  }

  if (existing && action !== 'add') await existing.remove();
  await queue.add('reply', { conversationId }, { ...REPLY_OPTS, jobId, delay: delayMs });
}
