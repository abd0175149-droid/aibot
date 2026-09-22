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
    return { tenantId: v.tenantId, event: v.event, payload: v.payload ?? null };
  } catch {
    return null;
  }
}
