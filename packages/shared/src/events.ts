/**
 * جسر الأحداث اللحظيّة بين العامل والـAPI.
 *
 * ★ العطل الذي وُلد منه هذا الملفّ — وهو أخطر عطلٍ في الإنبوكس:
 *   الشاشة تستمع لـ`message:new` منذ اليوم الأوّل، و**لا يبثّه أحد**.
 *   العامل هو من يكتب الرسائل، والـAPI هو من يملك خادم السوكِت، وهما
 *   عمليّتان منفصلتان: `apps/worker` لا يستورد `realtime.ts` ولا يستطيع.
 *   فالنتيجة أنّ **رسالة الزبون لا تظهر حتّى تُحدَّث الصفحة يدويّاً** —
 *   إنبوكسٌ «حيّ» لم يكن حيّاً ولا مرّة، والموظّف يُحدّث الصفحة ليعرف
 *   إن كان أحدٌ راسله.
 *
 * ★ ولماذا pub/sub على ريدِس لا محوّل socket.io:
 *   `@socket.io/redis-adapter` يحتاج تبعيّةً جديدة **وخادم سوكِت في العامل
 *   أيضاً** — عمليّةٌ خلفيّةٌ بلا منفذٍ تُقيم خادم ويب لتبثّ حدثاً. وريدِس
 *   موجودٌ في العمليّتين أصلاً (`ioredis`)، وقناةٌ واحدةٌ تكفي.
 *
 * ★ والأحداث **أخبارٌ لا أوامر**: المشترك يُعيد بثّها في غرفة المستأجر ولا
 *   ينفّذ منها شيئاً. فلو تلوّثت القناة يوماً لم يكن أسوأ ما يقع إلّا
 *   تحديثَ شاشةٍ زائداً.
 */

/** قناةُ ريدِس الوحيدة. الاسم ثابتٌ في العمليّتين. */
export const EVENT_CHANNEL = 'aibot:events';

/**
 * ★ **عقدُ الأحداث — والجسرُ كان بلا نوعٍ عبر العمليّات الثلاث.**
 *
 *   العامل يبثّ اسماً **حرفيّاً** وحمولةً مبنيّةً بيده، والـAPI يعيد البثّ
 *   كما هو، والشاشةُ تستقبل `any` وتفترض شكلاً. لا شيءَ يربط الثلاثة — فحرفٌ
 *   واحدٌ في اسمٍ، أو حقلٌ يُعاد تسميتُه، يُعيد العطلَ الأصليَّ بعينه: حدثٌ
 *   يُستمع له ولا يبثّه أحد. والشاشةُ تعود إلى «حدّث الصفحة لتعرف إن راسلك
 *   أحد» ولا يشكو أيُّ اختبار.
 *
 *   و`EventMap` تُلزم الثلاثة بالاسم **والحمولة** معاً: اسمٌ خارجها لا
 *   يُترجم، وحقلٌ ناقصٌ لا يُترجم. والحارسُ هو `tsc` نفسُه لا اختبارٌ يُنسى.
 */
/**
 * حمولةُ الرسالة — **شكلٌ واحدٌ يكتبه العاملُ ويقرؤه الحوار.**
 * وكان `unknown` في البثّ و«شكلاً مفترَضاً» في الشاشة: إضافةُ حقلٍ في طرفٍ
 * لا تصل الآخر، فتُرسَم رسالةٌ ناقصةٌ بلا أن يشكو شيء.
 */
export interface MessagePayload {
  options?: Array<{ id: string; title: string }>;
  buttonPayload?: string | null;
  mediaId?: string | null;
  location?: { lat: number; lng: number; name: string | null; address: string | null } | null;
}

export interface MessageDTO {
  id: string;
  direction: 'in' | 'out';
  source: string;
  type: string;
  body: string | null;
  payload: MessagePayload | null;
  status: string | null;
  createdAt: string;
  errorMessage?: string | null;
}

export interface EventMap {
  'message:new': { conversationId: string; message: MessageDTO };
  'message:status': {
    conversationId: string;
    id: string;
    status: string;
    /** رمزُ خطأ المزوّد — يُبثّ ولا تعرضه الشاشة، ويُقرأ في التشخيص. */
    errorCode?: string | null;
    errorMessage?: string | null;
  };
  /** تحديثُ صفٍّ في القائمة. من الـAPI يحمل الصفَّ كاملاً، ومن العامل معرّفَه. */
  'conversation:update': { id: string; [k: string]: unknown };
  /** ★ محادثةٌ زالت (حُذفت جهتُها نهائيّاً): الإنبوكسُ المفتوح يُسقطها بدل أن يعرض صفّاً يردّ ٤٠٤. */
  'conversation:removed': { id: string };
}

/** أحداثُ غرفة المنصّة — قرّاؤها لوحةُ المالك وحدها. */
export interface PlatformEventMap {
  'tenant:update': { id: string; [k: string]: unknown };
  'incident:update': { id: string; [k: string]: unknown };
}

export type EventName = keyof EventMap;
export type PlatformEventName = keyof PlatformEventMap;

/** الأسماءُ في وقت التشغيل — يقرؤها `decodeEvent` فيرفض ما ليس منها. */
export const EVENT_NAMES = [
  'message:new', 'message:status', 'conversation:update', 'conversation:removed',
] as const satisfies readonly EventName[];

export const PLATFORM_EVENT_NAMES = [
  'tenant:update', 'incident:update',
] as const satisfies readonly PlatformEventName[];

const KNOWN = new Set<string>([...EVENT_NAMES, ...PLATFORM_EVENT_NAMES]);

export interface TenantEvent {
  tenantId: string;
  event: string;
  payload: unknown;
}

export function encodeEvent(e: TenantEvent): string {
  return JSON.stringify(e);
}

/**
 * يفكّ حمولةً من القناة. يُرجع `null` لأيّ شيءٍ لا يطابق الشكل — فحمولةٌ
 * مشوّهة لا تُسقط المشترك، ومشتركٌ ساقطٌ يُعيد الإنبوكس إلى ما كان.
 */
export function decodeEvent(raw: string): TenantEvent | null {
  try {
    const v = JSON.parse(raw) as Partial<TenantEvent>;
    if (typeof v.tenantId !== 'string' || !v.tenantId) return null;
    if (typeof v.event !== 'string' || !v.event) return null;
    /* ★ واسمٌ خارج العقد لا يُعاد بثّه. والسببُ ليس أماناً بل **وضوحاً**:
       بلا هذا يمرّ اسمٌ مطبوعٌ خطأً إلى الشاشة بصمت، فيبدو أنّ البثّ يعمل
       ولا أحدَ يستمع له — وهو بعينه الشكلُ الذي أخفى أنّ الإنبوكس لم يكن
       حيّاً يوماً. وهنا يسقط عند الحدّ بدل أن يتسرّب. */
    if (!KNOWN.has(v.event)) return null;
    return { tenantId: v.tenantId, event: v.event, payload: v.payload ?? null };
  } catch {
    return null;
  }
}
