import type { FastifyInstance } from 'fastify';
import {
  getDb, withPlatform, notifications, pushSubscriptions, users,
  eq, and, isNull, desc, sql,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { requireAuth } from '../auth.js';

/**
 * ★★★ **صندوقُ التنبيهات داخل التطبيق — الاحتياطُ الذي لم يكن.**
 *
 *   `notifications` جدولٌ يكتبه العامل في كلّ تنبيهٍ حرج (توكنٌ منتهٍ · ويبهوك
 *   صامت · سقفٌ بلغ · فشلُ مزوّد) — **ولا مسارَ واحدٌ يقرؤه، ولا شاشةَ تعرضه**.
 *   فالصفوف تُكتب وتُحذف بالاحتفاظ بعد تسعين يوماً ولا يراها إنسانٌ قطّ.
 *
 *   وقناةُ الدفع (Web Push) لا تكفي وحدها، وهذا هو بيتُ القصيد: الإذنُ يُرفض،
 *   أو يُسحب من إعدادات المتصفّح، أو يُبدَّل مفتاح VAPID فتموت الاشتراكاتُ
 *   كلُّها بصمت، أو يفتح المالكُ الحسابَ على جهازٍ جديد. وفي كلّ حالةٍ منها
 *   **لا يصل التنبيهُ ولا يعلم أحدٌ أنّه لم يصل**. والصندوقُ هنا يجعل التنبيه
 *   موجوداً حيث ينظر المستخدمُ أصلاً: داخل التطبيق.
 *
 * ⚠️ `notifications` مفتاحُه `user_id` و`tenant_id` فيه قابلٌ للفراغ (مالكُ
 *    المنصّة يُشعَر أيضاً)، فهو خارج عزل المستأجر — ولذلك `withPlatform`
 *    بسببٍ مكتوب. والعزلُ يُفرض بالشرط على `user_id` من التوكن **لا** من
 *    الجسم: بلا ذلك يقرأ موظّفٌ تنبيهاتِ مالكِ المنصّة بمعرّفٍ خمّنه.
 */

/** سقفُ ما يُعاد: الصندوقُ لمحةٌ لا أرشيف، والأرشيفُ يحكمه الاحتفاظ. */
const PAGE = 30;

export async function registerNotifications(app: FastifyInstance) {
  /**
   * قائمةُ التنبيهات وعددُ غير المقروء.
   *
   * ★ والعدُّ في نفس النداء لا في نداءٍ ثانٍ: الجرسُ يحتاج الرقمَ في كلّ
   *   استقصاء، ونداءان يعنيان ضِعفَ الحمل على مسارٍ يُنادى كلَّ دقيقة.
   */
  app.get('/notifications', { preHandler: requireAuth() }, async (req) => {
    const userId = req.auth!.sub;
    return withPlatform(getDb(), 'تنبيهات: صندوقُ مستخدمٍ واحد', async (tx) => {
      const rows = await tx
        .select({
          id: notifications.id,
          tag: notifications.tag,
          title: notifications.title,
          body: notifications.body,
          data: notifications.data,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(PAGE);

      const unread = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))))[0]?.n ?? 0;

      return { items: rows, unread };
    });
  });

  /**
   * تعليمُ تنبيهٍ مقروءاً.
   *
   * ⚠️ والشرطُ مزدوج (المعرّف **و**المستخدم): المعرّفُ يأتي من العميل، وتحديثٌ
   *    بلا شرطِ مستخدمٍ يجعل موظّفاً يُسكت تنبيهَ مالكِ المنصّة بمعرّفٍ خمّنه —
   *    وهو أسوأُ ما يُفعل بقناة تنبيه.
   */
  app.post<{ Params: { id: string } }>(
    '/notifications/:id/read',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const rows = await withPlatform(getDb(), 'تنبيهات: تعليمُ تنبيهٍ مقروءاً', (tx) =>
        tx.update(notifications)
          .set({ readAt: new Date() })
          .where(and(
            eq(notifications.id, req.params.id),
            eq(notifications.userId, req.auth!.sub),
            isNull(notifications.readAt),
          ))
          .returning({ id: notifications.id }));

      /* صفرُ صفوفٍ لا يُبلَّغ نجاحاً: إمّا ليس له، أو مقروءٌ سابقاً — والنمطُ
         نفسُه في `push.ts` و`inbox.ts`. */
      if (!rows.length) {
        return reply.code(404).send({
          error: { code: ErrorCode.VALIDATION, message: 'لا تنبيه بهذا المعرّف' },
        });
      }
      return { ok: true };
    },
  );

  /** تعليمُ الكلّ مقروءاً — الجرسُ يمتلئ بسرعةٍ عند عطلٍ متكرّر. */
  app.post('/notifications/read-all', { preHandler: requireAuth() }, async (req) => {
    const rows = await withPlatform(getDb(), 'تنبيهات: تعليمُ الكلّ مقروءاً', (tx) =>
      tx.update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, req.auth!.sub), isNull(notifications.readAt)))
        .returning({ id: notifications.id }));
    return { ok: true, n: rows.length };
  });
}

/**
 * ★★★ **هل يوجد مشتركٌ واحدٌ يُبلَّغ أصلاً؟**
 *
 *   هذا هو السؤالُ الذي لم يكن يُطرح. كلُّ ما بُني في `notify.ts` و`incidents.ts`
 *   و`quota.ts` يفترض أنّ لمالك المنصّة اشتراكَ دفعٍ مسجَّلاً، و`Promise.all`
 *   على مصفوفةٍ **فارغة** ينجح — فالتنبيهُ الحرج «يُرسَل» بنجاحٍ إلى لا أحد،
 *   ولا سطرَ في السجلّ يشير إلى ذلك.
 *
 *   فالفحصُ يقلب الصمتَ إلى خبر: صفرُ اشتراكاتٍ لمالكي المنصّة يعني أنّ
 *   المنصّةَ **عمياء**، وهذه حالةٌ تُعلَن لا تُفترض.
 */
export async function alertingReachable(): Promise<{ ok: boolean; owners: number; subs: number }> {
  return withPlatform(getDb(), 'صحّة: هل لمالكي المنصّة اشتراكُ تنبيهٍ واحد', async (tx) => {
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'platform_owner'), eq(users.isActive, true)));
    if (!owners.length) return { ok: false, owners: 0, subs: 0 };

    const subs = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(sql`${pushSubscriptions.userId} IN (${sql.join(owners.map((o) => sql`${o.id}`), sql`, `)})`)
    )[0]?.n ?? 0;

    return { ok: subs > 0, owners: owners.length, subs };
  }).catch(() => ({ ok: false, owners: -1, subs: -1 }));
}

/** يُرمى عند غياب تهيئة الدفع كلّها — يُستعمل في الفحص الدوريّ لا في مسار. */
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export { AppError };
