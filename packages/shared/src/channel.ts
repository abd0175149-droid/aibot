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
  /* ★ `reaction` و`sticker` صنفان قائمان بذاتهما — وكانا يقعان في
     `unsupported`، فيُعامَلان **رسالةً تستحقّ ردّاً**. وتفاعلُ 👍 على ردّ
     البوت أشيعُ ما يفعله الزبون العربيّ حين يرضى: تُجدوَل مهمّةُ ردّ،
     والسياقُ مطابقٌ للشوط السابق حرفيّاً، فيُنادى النموذج **بكلفةٍ جديدة**
     ليُعيد الجوابَ نفسَه على من قال «شكراً» بإيموجي. */
  type: z.enum([
    'text', 'button', 'interactive', 'image', 'audio', 'document', 'video',
    'location', 'story_reply', 'reaction', 'sticker', 'unsupported',
  ]),
  text: z.string().nullable(),
  /** نصّ الزرّ الذي ضُغط، إن كان الوارد ضغطة زرّ. */
  buttonPayload: z.string().nullable(),
  mediaId: z.string().nullable(),
  /**
   * ★ الموقعُ محفوظاً بإحداثيّاته لا مذكوراً في نصّ.
   *
   *   موقعُ الزبون هو **محتوى الطلب** في مطعمٍ يوصّل. وكان المحوّل يُسقط خطّ
   *   الطول والعرض والعنوان عند التطبيع (يبقيان في الحمولة الخام وحدها)،
   *   فلا يراهما الموظّف ولا البوت، وتصير المعاينةُ في القائمة «[location]».
   *   فيُسأل الزبونُ عن عنوانه من جديد بعد أن أرسله.
   */
  location: z.object({
    lat: z.number(), lng: z.number(),
    name: z.string().nullable(), address: z.string().nullable(),
  }).nullable().optional(),
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

/**
 * ★ **اسمُ نوع الرسالة بالعربيّة — نصٌّ واحدٌ لثلاثة قرّاء.**
 *
 *   كان كلٌّ يكتب نسختَه: العاملُ يضع `[image]` في معاينة القائمة، والشاشةُ
 *   تحمل خريطةً عربيّةً خاصّةً بها، وسياقُ النموذج لا يحمل شيئاً إطلاقاً.
 *   فيقرأ الموظّفُ في القائمة اسمَ نوعٍ تقنيٍّ بالإنجليزيّة داخل قائمةٍ
 *   عربيّة — لا يُقرأ بصوتٍ ولا يُبحَث — ويقرأ في الحوار اسماً آخر، ولا يرى
 *   النموذجُ شيئاً فيردّ على السؤال السابق.
 *
 *   والاسمُ هنا **ما يقوله الزبون لا ما يسمّيه البروتوكول**: «تسجيل صوتيّ»
 *   لا `audio`.
 */
export const MESSAGE_TYPE_AR: Record<string, string> = {
  text: 'رسالة',
  button: 'ضغطةُ زرّ',
  interactive: 'اختيارٌ من قائمة',
  image: 'صورة',
  audio: 'تسجيل صوتيّ',
  video: 'مقطع مرئيّ',
  document: 'ملفّ',
  location: 'موقع',
  story_reply: 'ردٌّ على ستوري',
  reaction: 'تفاعل',
  sticker: 'ملصق',
  unsupported: 'نوعٌ لا تدعمه القناة',
};

/** اسمُ النوع، وللمجهول اسمٌ مفهومٌ لا مفتاحٌ خام. */
export function typeLabel(type: string): string {
  return MESSAGE_TYPE_AR[type] ?? 'مرفَق';
}

/**
 * ما يُوضع مكانَ النصّ حين تصل وسيطةٌ بلا تعليق — **في سياق النموذج**.
 *
 * ★ وبلا هذا كانت الرسالةُ الصوتيّة تختفي من السياق تماماً (`turns` تُرشّح
 *   بـ`body`)، فيردّ البوت على السؤال **السابق**. وإن كانت أوّلَ رسالةٍ في
 *   المحادثة خرجت `contents` فارغةً فيرفضها Gemini بـ400، وتُرفَع حادثةُ
 *   `ai_error` **حرجة** تُنبّه المالكَ والمنصّة — والزبون يستلم صمتاً تامّاً.
 *   أي أنّ أشيع ما يرسله زبونٌ عربيّ على واتساب كان يُسقط الردَّ ويُنذر.
 */
export function mediaPlaceholder(type: string): string {
  return `[أرسل الزبون ${typeLabel(type)} بلا نصّ]`;
}

/* ══════════════ سلوكُ البوت الذي يضبطه المالك ══════════════ */

/**
 * ★ **أربعةُ سلوكيّاتٍ يستهلكها العاملُ ولا شاشةَ تضبطها.**
 *
 *   التبويبُ في شاشة البوت يشرحها للمالك بعناية — متى يسكت البوت بعد تدخّل
 *   موظّف، وماذا يقول حين يعجز، وماذا يقول خارج الدوام، وما ساعاتُ دوامه —
 *   ثمّ يقول إنّها «لا تُعدَّل من هنا». والحقيقةُ أنّها لم تكن تُعدَّل من أيّ
 *   مكان: لا مسارَ للمستأجر ولا للمنصّة ولا خطوةَ في معالج التهيئة. فكلُّ
 *   مستأجرٍ يعيش على الافتراضات إلّا بـSQL على الخادم.
 *
 *   والثمنُ ملموس: مطعمٌ يغلق منتصف الليل يظلّ بوته يأخذ حجوزاتٍ الثالثةَ
 *   فجراً ويعد بردّ موظّفٍ لا يأتي. والمالكُ الذي يقرأ «هذه الرسالة لا
 *   تُستعمل» لا يجد كيف يجعلها تُستعمل، و«اطلبها من فريقنا» تقود إلى فريقٍ
 *   لا يملك أداة.
 */
export const DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_AR: Record<DayKey, string> = {
  sat: 'السبت', sun: 'الأحد', mon: 'الإثنين', tue: 'الثلاثاء',
  wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة',
};

/** «HH:MM» بأربعٍ وعشرين ساعة — نفسُ ما يقارنه `withinBusinessHours` نصّاً. */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت بصيغة HH:MM');

/* ⚠️ والمفاتيحُ الثلاثيّة (`sat`…) ليست ذوقاً: `withinBusinessHours` يشتقّها
   من `Intl` بـ`weekday: 'short'` ثمّ `toLowerCase()`، فأيُّ اسمٍ آخر لا
   يُطابق شيئاً — وساعاتُ الدوام تصير «مغلقٌ دائماً» بصمت. */
export const BusinessHours = z.object({
  tz: z.string().min(1).max(64).default('Asia/Amman'),
  days: z.record(z.enum(DAY_KEYS), z.array(z.tuple([HHMM, HHMM])).max(4)),
});
export type BusinessHours = z.infer<typeof BusinessHours>;

export const BotBehaviorPatch = z.object({
  /** سكوتُ البوت بعد ردّ موظّف — بالدقائق. */
  pauseMinutes: z.number().int().min(1).max(1440).optional(),
  /** ما يقوله حين يعجز. فارغٌ يعني «أعِد الافتراضيّ». */
  failMessage: z.string().max(300).nullable().optional(),
  /** ما يقوله خارج الدوام. ولا يُرسَل إن لم تُضبط ساعاتُ الدوام أصلاً. */
  outsideHoursMessage: z.string().max(300).nullable().optional(),
  businessHours: BusinessHours.nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, 'لا شيءَ لتغييره');
export type BotBehaviorPatch = z.infer<typeof BotBehaviorPatch>;
