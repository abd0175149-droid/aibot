import type { FastifyInstance } from 'fastify';
import { getDb, withPlatform, pushSubscriptions, eq, and } from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { requireAuth } from '../auth.js';

/**
 * ★ اشتراك الإشعارات — الطرفُ الأخير المفقود في سلسلة المراقبة.
 *
 *   العطل الذي وُلدت منه هذه الملفّات: `push_subscriptions` جدولٌ يقرؤه العامل
 *   ويحدّثه ويحذف منه — **ولا مسارَ واحد يكتب فيه**، ولا سطرَ في الواجهة يطلب
 *   إذناً أو يسجّل اشتراكاً. فـ`notifyCritical` تقرأ جدولاً فارغاً أبداً
 *   وتُتمّ بنجاح: كلّ تنبيهٍ حرجٍ في المنصّة يُكتب في القاعدة ولا يصل أحداً.
 *   ونظامُ مراقبةٍ بلا مشتركٍ واحد نظامُ تسجيلٍ لا مراقبة.
 *
 * ⚠️ `push_subscriptions` جدولٌ عامّ مفتاحه `user_id` لا `tenant_id`، فهو خارج
 *    RLS — ولذلك `withPlatform` بسببٍ مكتوب. والعزلُ يُفرض هنا بالشرط على
 *    `user_id` من التوكن: لا يقرأ مستخدمٌ اشتراكَ غيره ولا يحذفه.
 *
 * ⚠️ ولا يُقبل `endpoint` إلّا `https`: نقطة الدفع عنوانٌ يأتي من المتصفّح،
 *    وقبولُ أيّ نصٍّ يعني صفّاً يُغذّي `web-push` بعنوانٍ داخليّ.
 */
export async function registerPush(app: FastifyInstance) {
  /**
   * المفتاح العامّ — يحتاجه المتصفّح قبل أن يشترك.
   * ولا يُقرأ من البيئة في الواجهة: الواجهة تُبنى مرّةً وتُشغَّل في متصفّحٍ لا
   * بيئةَ له، والمفتاح يتبدّل بتبدّل الخادم.
   */
  app.get('/push/key', { preHandler: requireAuth() }, async () => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'الإشعارات غير مهيّأة على الخادم — راجع مفاتيح الدفع.',
        503,
      );
    }
    return { key };
  });

  /**
   * تسجيل اشتراك.
   *
   * ★ متماثِل بالعنوان لا بالمستخدم: المتصفّح يعيد نفس `endpoint` ما دام
   *   الاشتراك حيّاً، فإعادة الفتح على جهازٍ واحد تحدّث الصفّ ولا تُنشئ ثانياً.
   *   و`onConflictDoUpdate` على العنوان يُصلح أيضاً حالةَ جهازٍ انتقل بين
   *   حسابين: الصفّ يتبع آخر مستخدمٍ اشترك منه.
   *
   * ★ و`failCount` يُصفَّر عند كلّ تسجيل: الاشتراك الجديد ليس مسؤولاً عن
   *   إخفاقات سابقه على نفس العنوان.
   */
  app.post<{ Body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>(
    '/push/subscribe',
    { preHandler: requireAuth() },
    async (req) => {
      const b = req.body ?? {};
      const endpoint = String(b.endpoint ?? '');
      const p256dh = String(b.keys?.p256dh ?? '');
      const auth = String(b.keys?.auth ?? '');

      if (!endpoint.startsWith('https://') || endpoint.length > 2048 || !p256dh || !auth) {
        throw new AppError(ErrorCode.VALIDATION, 'بيانات الاشتراك غير صالحة', 400);
      }

      const userId = req.auth!.sub;
      const tenantId = req.auth!.tid ?? null;

      await withPlatform(getDb(), 'إشعارات: تسجيل اشتراك دفعٍ لمستخدم', (tx) =>
        tx.insert(pushSubscriptions)
          .values({
            userId,
            tenantId,
            endpoint,
            p256dh,
            auth,
            userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
            failCount: 0,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: { userId, tenantId, p256dh, auth, failCount: 0, lastOkAt: null },
          }));

      return { ok: true };
    },
  );

  /**
   * إلغاء الاشتراك — بالعنوان وبشرط المستخدم معاً.
   * والشرط المزدوج ليس زينة: العنوان يأتي من العميل، والحذفُ بلا شرطِ مستخدمٍ
   * يجعل مستخدماً يُسكت إشعاراتِ غيره بعنوانٍ خمّنه.
   */
  app.delete<{ Body: { endpoint?: string } }>(
    '/push/subscribe',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const endpoint = String(req.body?.endpoint ?? '');
      if (!endpoint) throw new AppError(ErrorCode.VALIDATION, 'لا عنوان اشتراك', 400);

      const rows = await withPlatform(getDb(), 'إشعارات: إلغاء اشتراك دفعٍ لمستخدم', (tx) =>
        tx.delete(pushSubscriptions)
          .where(and(
            eq(pushSubscriptions.endpoint, endpoint),
            eq(pushSubscriptions.userId, req.auth!.sub),
          ))
          .returning({ id: pushSubscriptions.id }));

      // صفرُ صفوفٍ لا يُبلَّغ عنه نجاحاً — القاعدةُ نفسها في `inbox.ts`
      if (!rows.length) return reply.code(404).send({ error: { code: ErrorCode.VALIDATION, message: 'لا اشتراك بهذا العنوان' } });
      return { ok: true };
    },
  );

  /**
   * ★ «هل يصل التنبيه فعلاً؟» — سؤالٌ لا يُجاب عنه إلّا بتنبيهٍ يصل.
   *   يرسل إشعاراً حقيقيّاً عبر نفس المسار الذي تسلكه الحوادث، فيكشف عطل
   *   السلسلة (مفتاحٌ مبدَّل · اشتراكٌ ميّت · إذنٌ مسحوب) قبل الحادثة لا بعدها.
   */
  app.post('/push/test', { preHandler: requireAuth() }, async (req) => {
    const count = await withPlatform(getDb(), 'إشعارات: عدّ اشتراكات المستخدم', async (tx) =>
      (await tx.select({ id: pushSubscriptions.id }).from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, req.auth!.sub))).length);
    if (!count) {
      throw new AppError(ErrorCode.VALIDATION, 'لا اشتراك على هذا الحساب — فعّل الإشعارات أوّلاً.', 400);
    }

    const { enqueueNotify } = await import('../queues.js');
    await enqueueNotify({
      userId: req.auth!.sub,
      tenantId: req.auth!.tid ?? null,
      tag: 'push:test',
      title: 'تنبيه تجريبيّ من AiBot',
      body: 'وصلك هذا؟ إذن قناة التنبيه تعمل.',
      url: '/app',
      severity: 'info',
    });
    return { ok: true, subscriptions: count };
  });
}
