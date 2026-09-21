import { z } from 'zod';

/** كلّ قناة تُعلن ما تستطيعه. لا شرطَ قناةٍ في أيّ مكانٍ آخر — يُفحص هذا بدلاً منه. */
export const ChannelCapabilities = z.object({
  /** عدد الأزرار التفاعليّة المدعومة. 0 = غير مدعومة. */
  buttons: z.number().int().min(0),
  /** عدد الردود السريعة المدعومة. 0 = غير مدعومة. */
  quickReplies: z.number().int().min(0),
  lists: z.boolean(),
  location: z.boolean(),
  templates: z.boolean(),
  maxTextLen: z.number().int().positive(),
  /** عمر نافذة الخدمة بالساعات. 24 للقناتين اليوم. */
  windowHours: z.number().int().positive(),
  /** هل هويّة الزبون رقم هاتف أم معرّفٌ خاصّ بالقناة؟ */
  identityKind: z.enum(['phone', 'scoped_id']),
  mediaKinds: z.array(z.enum(['image', 'audio', 'document', 'video', 'story_reply'])),
  /** أقصى طول لعنوان الزرّ/الردّ السريع. */
  choiceTitleLen: z.number().int().positive(),
});
export type ChannelCapabilities = z.infer<typeof ChannelCapabilities>;

export const ChannelKind = z.enum(['whatsapp_cloud', 'instagram']);
export type ChannelKind = z.infer<typeof ChannelKind>;

/** الرسالة الواردة بعد التطبيع — لا أثر للقناة فيها. */
export const NormalizedInbound = z.object({
  externalId: z.string(),
  from: z.string(),
  fromHandle: z.string().nullable(),
  at: z.date(),
  type: z.enum(['text', 'button', 'interactive', 'image', 'audio', 'document', 'video', 'location', 'story_reply', 'unsupported']),
  text: z.string().nullable(),
  /** نصّ الزرّ الذي ضُغط، إن كان الوارد ضغطة زرّ. */
  buttonPayload: z.string().nullable(),
  mediaId: z.string().nullable(),
  raw: z.unknown(),
});
export type NormalizedInbound = z.infer<typeof NormalizedInbound>;

export const InboundStatus = z.object({
  externalId: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  at: z.date(),
});
export type InboundStatus = z.infer<typeof InboundStatus>;

/**
 * نيّة الرسالة الصادرة — لا شكلها.
 * الأدوات تُنتج هذا، وطبقة الإرسال تُصيّره إلى ما تفهمه القناة.
 */
export type OutboundMessage =
  | { kind: 'text'; body: string }
  | { kind: 'choices'; body: string; options: Array<{ id: string; title: string }> }
  | { kind: 'location'; lat: number; lng: number; name?: string; address?: string }
  | { kind: 'image'; url: string; caption?: string };
