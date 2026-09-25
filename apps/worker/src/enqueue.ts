import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE } from '@aibot/shared';

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
  /**
   * قيد التوليد الآن: لا تلمسه، **ولا تُضِف مهمّةً ثانية** — اكتب علامةً
   * يقرؤها حاملُ القفل عند تحرّره.
   *
   * ★ وكان اسمُها `sidecar` لأنّها كانت تُضيف مهمّةً جانبيّة، وتلك المهمّة
   *   كانت تعمل **بالتوازي** مع الردّ الجاري (قُيس: مهمّتان بمعرّفَين
   *   مختلفَين على المحادثة نفسها عملتا معاً). فالعلامةُ بدلٌ عنها.
   */
  | 'mark-dirty';

export function decideEnqueue(state: string | undefined): EnqueueAction {
  if (!state || state === 'unknown') return 'add';
  if (state === 'delayed' || state === 'waiting' || state === 'waiting-children' || state === 'prioritized') {
    return 'replace';
  }
  if (state === 'active') return 'mark-dirty';
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
 * ★★★ **قفلُ المحادثة وعلامتُها — ولماذا هما في ريدِس لا في الذاكرة.**
 *
 *   تزامنُ `bot-reply` ثلاثة، وقفلُ BullMQ لكلّ **معرّفِ مهمّة** لا لكلّ
 *   محادثة. فمهمّتان بمعرّفَين مختلفَين على المحادثة نفسها تعملان معاً —
 *   وهذا قِيس لا استُنتج: مسبارٌ على طابورٍ مؤقّتٍ أعطى
 *   `MAX_CONCURRENT_ON_SAME_CONVERSATION=2`. ونتيجتُه نداءان للنموذج، كلٌّ
 *   يقرأ تاريخاً لا يحوي ردَّ الآخر، فيصل الزبونَ ترحيبان ويدفع المالكُ
 *   مرّتين. وقد يكتب الاثنان `pendingAction` مختلفَين على الصفّ نفسه.
 *
 *   وفي ريدِس لأنّ العامل قد يكون أكثر من عمليّةٍ واحدة: قفلٌ في ذاكرة
 *   العمليّة يحرس نفسه وحده ويكذب على الآخرين.
 *
 * ⚠️ **والذرّيّةُ هي كلُّ الفائدة.** «افحص القفل ثمّ اكتب العلامة» عبارتان،
 *    وبينهما قد يُفرَج عن القفل فلا يقرأ العلامةَ أحدٌ أبداً: رسالةُ زبونٍ
 *    تُهجَر بلا ردٍّ ولا أثر. ولذلك العمليّتان في سكربت Lua واحد — وريدِس
 *    أحاديُّ الخيط فينفّذه بلا مُقاطع.
 */
const lockKey = (id: string): string => `conv:${id}:lock`;
const dirtyKey = (id: string): string => `conv:${id}:dirty`;

/** أطولُ نداءِ نموذجٍ مع حلقةِ أدواتٍ معقول + هامش. يُفرَج عنه عادةً قبله. */
const LOCK_TTL_SEC = 180;
/** أطولُ من القفل بكثير: علامةٌ تنتهي قبل أن تُقرأ = رسالةٌ بلا ردّ. */
const DIRTY_TTL_SEC = 900;

/** خُذ القفل، أو — إن كان مأخوذاً — اكتب العلامة. عمليّةٌ واحدةٌ لا اثنتان. */
const ACQUIRE_OR_MARK = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
  return 1
end
redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
return 0
`;

/**
 * أفرِج عن قفلك **وحدك**، واقرأ العلامةَ واحذفها. عمليّةٌ واحدةٌ لا اثنتان.
 *
 * ★ والعلامةُ تُقرأ ولو لم يُطابق الرمزُ — وهذا مقصود. الرمزُ لا يُطابق إلّا
 *   إن انتهت مهلةُ قفلنا وأخذه سوانا (نداءُ نموذجٍ تجاوز ثلاثَ دقائق). فلو
 *   تركنا العلامةَ حينها خرجنا بلا جدولةٍ، وحاملُ القفل الجديد قد لا يرى
 *   علامةً تُكتب بعد إفراجه — فتُهجَر رسالة. أمّا قراءتُها فأسوأُ ما تُنتج
 *   متابعةً زائدة، وهي تمرّ على بوّابة «لا ردَّ بلا جديد» فلا تُرسل شيئاً.
 *   **الاتّجاهُ الآمنُ أن نوقظ بلا داعٍ، لا أن ننام على رسالة.**
 */
const RELEASE_AND_TAKE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
if redis.call('DEL', KEYS[2]) == 1 then
  return 1
end
return 0
`;

/**
 * يُرجع رمزَ القفل إن نجح، و`null` إن كان ردٌّ آخرُ يعمل — وفي الثانية تكون
 * العلامةُ قد كُتبت ذرّيّاً، فحاملُ القفل يجدول المتابعة عند تحرّره.
 *
 * ⚠️ والرمزُ ليس زينة: قفلٌ يُفرَج عنه بـ`DEL` أعمى يُفرِج عن قفلِ **غيرك**
 *    إن انتهت مهلتُك وأخذه سواك — فيعود التوازي من حيث أُغلق.
 */
export async function acquireConvLock(conversationId: string): Promise<string | null> {
  const token = `${process.pid}-${randomUUID()}`;
  const got = await connection().eval(
    ACQUIRE_OR_MARK, 2,
    lockKey(conversationId), dirtyKey(conversationId),
    token, String(LOCK_TTL_SEC), String(DIRTY_TTL_SEC),
  );
  return Number(got) === 1 ? token : null;
}

/** يُفرِج عن القفل ويُرجع `true` إن كانت هناك علامةٌ تنتظر — أي رسائلُ جديدة. */
export async function releaseConvLock(conversationId: string, token: string): Promise<boolean> {
  const dirty = await connection().eval(
    RELEASE_AND_TAKE, 2,
    lockKey(conversationId), dirtyKey(conversationId),
    token,
  );
  return Number(dirty) === 1;
}

/**
 * يجدول متابعةً واحدة على أوّل خانةٍ حرّةٍ من الخانتَين.
 *
 * ★ وخانتان لا واحدة لأنّ المنادي **نفسَه** يشغل إحداهما وهو جارٍ: لا يمكن
 *   إضافةُ مهمّةٍ بمعرّفٍ قيدَ التنفيذ. وخانتان لا ثلاث لأنّ المعرّفات
 *   المفتوحة (`-next-${Date.now()}`) هي بعينها العطلُ الذي وُلد منه كلُّ هذا.
 *
 * ⚠️ وإن كانت الخانتان جاريتَين — نافذةٌ دون المِلّي — تُعاد العلامةُ ويلتقطها
 *    المسحُ الدوريّ أدناه. ولا تُهمَل بصمت.
 */
export async function scheduleFollowUp(conversationId: string, delayMs = 500): Promise<boolean> {
  const queue = q(QUEUE.reply);
  const base = `conv-${conversationId}`;
  for (const jobId of [base, `${base}-next`]) {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const st = await existing.getState();
      if (st === 'active') continue;
      /* سباقٌ ممكن: قد تُلتقط بين الفحص والحذف. لا يُسقط المتابعةَ. */
      try { await existing.remove(); } catch { continue; }
    }
    await queue.add('reply', { conversationId }, { ...REPLY_OPTS, jobId, delay: delayMs });
    return true;
  }
  await connection().set(dirtyKey(conversationId), '1', 'EX', DIRTY_TTL_SEC);
  return false;
}

/**
 * ★ **شبكةُ الأمان: محادثةٌ موسومةٌ لا يعمل عليها أحد.**
 *
 *   العلامةُ يقرؤها حاملُ القفل عند تحرّره — فإن **مات** العامل بينهما
 *   (نشرةٌ، أو قاتلُ الذاكرة، أو انقطاعٌ) بقيت العلامةُ ولا مهمّةَ تقرؤها:
 *   رسالةُ زبونٍ بلا ردٍّ إلى الأبد، بلا خطأٍ ولا سجلّ. وهذا عطلٌ واقعيٌّ لا
 *   نظريّ: كلُّ نشرةٍ تقتل العامل في منتصف مهمّة.
 *
 *   والمسحُ لا يعمل إلّا على ما لا حارسَ له: قفلٌ قائمٌ يعني ردّاً يعمل الآن،
 *   ومهمّةٌ مؤجَّلةٌ أو منتظرةٌ تعني ردّاً سيعمل — وكلاهما يقرأ العلامة.
 */
export async function sweepStrandedConversations(): Promise<number> {
  const c = connection();
  const queue = q(QUEUE.reply);
  let cursor = '0';
  let woken = 0;
  do {
    const [next, keys] = await c.scan(cursor, 'MATCH', 'conv:*:dirty', 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      const id = key.slice('conv:'.length, -':dirty'.length);
      if (!id) continue;
      if (await c.exists(lockKey(id))) continue;          // ردٌّ يعمل الآن
      let guarded = false;
      for (const jobId of [`conv-${id}`, `conv-${id}-next`]) {
        const job = await queue.getJob(jobId);
        if (!job) continue;
        const st = await job.getState();
        if (st === 'active' || st === 'delayed' || st === 'waiting') { guarded = true; break; }
      }
      if (guarded) continue;                               // ردٌّ سيعمل
      /* الجدولةُ **قبل** حذف العلامة: لو انقلب الترتيبُ وسقطنا بينهما ضاعت
         الرسالة. وحذفٌ بعد جدولةٍ ناجحةٍ أسوأُ ما يُنتج مهمّةً زائدةً واحدة،
         وهي تمرّ على بوّابة «لا ردَّ بلا جديد» فلا تُرسل شيئاً. */
      if (await scheduleFollowUp(id, 0)) {
        await c.del(dirtyKey(id));
        woken += 1;
      }
    }
  } while (cursor !== '0');
  return woken;
}

/**
 * دمج الرسائل المتتالية بلا مؤقّتٍ في الذاكرة:
 * معرّفٌ ثابتٌ لكلّ محادثة + تأخيرٌ قصير — رسالةٌ جديدة تستبدل المهمّة
 * المؤجَّلة. العميل يكتب ثلاثة أسطر فيردّ البوت مرّةً واحدة.
 */
export async function enqueueReply(conversationId: string, delayMs = REPLY_OPTS.delay): Promise<void> {
  const jobId = `conv-${conversationId}`;
  const queue = q(QUEUE.reply);
  const existing = await queue.getJob(jobId);
  const action = decideEnqueue(existing ? await existing.getState() : undefined);

  if (action === 'mark-dirty') {
    /* ★★ **علامةٌ لا مهمّة.** كان فرعُ «قيد التوليد» يُضيف مهمّةً بمعرّفٍ
       مستقلّ تنطلق بعد ثانيتين بينما نداءُ النموذج يستغرق من ثلاثٍ إلى
       عشرين — فتعمل **بالتوازي** مع الردّ الجاري. قِيس هذا التوازي على
       طابورٍ مؤقّت: `MAX_CONCURRENT_ON_SAME_CONVERSATION=2`. وكلٌّ من
       المهمّتين يقرأ التاريخَ لحظةَ بدئه فلا يرى ردَّ الأخرى: يصل الزبونَ
       ترحيبان متداخلان، ويدفع المالكُ نداءَين لسؤالٍ واحد.

       والعلامةُ تُبطل ذلك من أصله: لا مهمّةَ ثانية تُضاف إطلاقاً. حاملُ
       القفل يقرؤها **ذرّيّاً** عند تحرّره ويجدول متابعةً **واحدة** ترى
       التاريخَ كاملاً بما فيه ردُّه — فردّان متسلسلان لا أربعةٌ متوازية. */
    await connection().set(dirtyKey(conversationId), '1', 'EX', DIRTY_TTL_SEC);
    return;
  }

  if (existing && action !== 'add') await existing.remove();
  await queue.add('reply', { conversationId }, { ...REPLY_OPTS, jobId, delay: delayMs });
}
