/**
 * ★ عقدُ الطوابير — **مصدرٌ واحدٌ للأسماء بين العمليّتين**.
 *
 *   العطل الذي وُلد منه هذا الملفّ: الـAPI ينتج مهامّ والعامل يستهلكها عبر
 *   ريدِس، ولا شيء يربط الطرفين إلّا التطابق اليدويّ. الأسماء كانت مكتوبةً
 *   مرّةً كثابتٍ في `apps/api/src/queues.ts` ومرّتين نصوصاً حرفيّةً في
 *   `apps/worker/src/main.ts` و`enqueue.ts`. وtsc يرى ملفّين مستقلَّين ولا
 *   يشكو، وBullMQ يُنشئ أيّ طابورٍ باسمٍ جديد بلا اعتراض.
 *
 *   فإعادةُ تسميةٍ في طرفٍ واحد تُنتج رسائل تُدفع إلى طابورٍ لا يستهلكه أحد:
 *   تتراكم في ريدِس بصمت، والزبون بلا ردّ، ولا حادثةَ ولا خطأ. والعطل لا
 *   يظهر إلّا على زبونٍ حقيقيّ.
 *
 * ⚠️ لا نقطتين في اسم الطابور **ولا في معرّف المهمّة**: BullMQ 5 يرفض
 *    الاثنين، وكشفهما أوّل تشغيلٍ على الخادم واحداً بعد الآخر.
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
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** كلُّ الأسماء — يستعملها حارسُ «كلّ طابورٍ يُستهلَك يجب أن يُنتَج». */
export const QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUE);
