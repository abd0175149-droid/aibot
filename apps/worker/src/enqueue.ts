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
 * دمج الرسائل المتتالية بلا مؤقّتٍ في الذاكرة:
 * jobId ثابتٌ لكلّ محادثة + تأخير 2000ms — رسالةٌ جديدة تستبدل المهمّة المؤجَّلة.
 * العميل يكتب ثلاثة أسطر فيردّ البوت مرّةً واحدة.
 */
export async function enqueueReply(conversationId: string, delayMs = 2000): Promise<void> {
  const jobId = `conv-${conversationId}`;
  const queue = q('bot-reply');
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'delayed' || state === 'waiting') await existing.remove();
  }
  await queue.add('reply', { conversationId }, { jobId, delay: delayMs, attempts: 2, removeOnComplete: 500 });
}
