import type { FastifyInstance } from 'fastify';
import { getDb, withTenant, auditLog, users, eq, desc } from '@aibot/db';
import { requireAuth, tenantOf } from '../auth.js';

/**
 * ★★ **سجلُّ الحساب — الوعدُ الذي كتبته لافتةُ الانتحال ولم يُبنَ له شيء.**
 *
 *   «مسجَّلٌ ويراه العميل في سجلّه» — قالتها اللافتةُ وصفحةُ الخصوصيّة وأربعةُ
 *   تعليقاتٍ في الكود، و`audit_log` يُكتب منذ اليوم الأوّل. ولا مسارَ واحدٌ
 *   يقرؤه لمستأجر: `GET /console/audit` لمالك المنصّة وحده. فكان الوعدُ
 *   صادقاً في القاعدة وكاذباً في الشاشة.
 *
 * ⚠️ الفاعلُ من فريق المنصّة **لا يُرى** تحت RLS: صفُّه في `users` بلا
 *    `tenant_id` فيعود `actorName` فارغاً — وهذا هو المطلوب لا عيبٌ يُرقَّع.
 *    الواجهةُ تسمّيه «فريق المنصّة» من اسم الفعل، ولا يتسرّب اسمُ موظّفٍ
 *    عندنا إلى عميل.
 *
 * ⚠️ ولا `diff` في الردّ: يحمل بريدَ مالكٍ وعددَ جلساتٍ أُسقطت وتفاصيلَ دمجٍ
 *    لا حاجةَ للشاشة بها — والعمودُ الذي لا يُرسَل لا يتسرّب.
 *
 *   والقراءةُ لصاحب الإعدادات (المالك): السجلُّ يقول من عطّل من ومن غيّر
 *   دورَ من، وليس ممّا يُعرض على موظّف.
 */
export async function registerAudit(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>(
    '/audit',
    { preHandler: requireAuth({ settings: true }) },
    async (req) => {
      const tenantId = tenantOf(req);
      const asked = Number(req.query.limit ?? 100);
      const limit = Math.min(Math.max(Number.isFinite(asked) ? asked : 100, 1), 200);

      const items = await withTenant(getDb(), tenantId, (tx) => tx
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          createdAt: auditLog.createdAt,
          ip: auditLog.ip,
          actorName: users.name,
          actorEmail: users.email,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit));

      return { items };
    },
  );
}
