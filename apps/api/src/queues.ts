import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { ChannelKind, ParsedWebhook } from '@aibot/channels';

/**
 * الطوابير — الأسماء محايدةٌ للقناة عمداً (`ch:` لا `wa:`).
 * قناةٌ ثانية لا تضيف طابوراً؛ تضيف `channelId` في الحمولة.
 */
export const QUEUE = {
  inbound: 'ch:inbound',
  reply: 'bot:reply',
  outbound: 'ch:outbound',
  embed: 'kb:embed',
  health: 'health:poll',
  notify: 'notify:push',
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
  const jobId = `conv:${conversationId}`;
  const queue = q(QUEUE.reply);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'delayed' || state === 'waiting') await existing.remove();
  }
  await queue.add('reply', { conversationId }, {
    jobId,
    delay: delayMs,
    attempts: 2,
    removeOnComplete: 500,
    removeOnFail: 2000,
  });
}

export async function pingRedis(): Promise<boolean> {
  try {
    return (await connection().ping()) === 'PONG';
  } catch {
    return false;
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
  await conn?.quit();
  conn = null;
}
