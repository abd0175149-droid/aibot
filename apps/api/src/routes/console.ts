import type { FastifyInstance } from 'fastify';
import {
  getDb, withPlatform, tenants, users, plans, subscriptions, tenantChannels,
  conversationWindows, aiRuns, incidents, auditLog, botConfigs,
  eq, and, desc, asc, sql,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { publicId, seal, sha256 } from '@aibot/crypto';
import { requireAuth, signAccess, hashPassword } from '../auth.js';
import { emitToPlatform } from '../realtime.js';

/**
 * لوحة المالك.
 *
 * كلّ مسارٍ هنا يستعمل `withPlatform` — الدور المتجاوز لـRLS — ولذلك
 * كلٌّ منه يمرّر **سبباً مكتوباً**، ويُسجَّل ما يستحقّ التسجيل في `audit_log`.
 * الوصول العابر للمستأجرين لا يكون صامتاً.
 */
export async function registerConsole(app: FastifyInstance) {
  const owner = requireAuth({ console: true, role: ['platform_owner'] });

  /** الجدول مرتَّبٌ **بالمخاطرة** لا بالاسم: الأسوأ صحّةً أوّلاً ثمّ الأقرب لسقفه. */
  app.get('/console/tenants', { preHandler: owner }, async () => {
    const db = getDb();
    return withPlatform(db, 'عرض جدول العملاء في لوحة المالك', async (tx) => {
      const rows = await tx.execute(sql`
        SELECT t.id, t.name, t.status, t.public_id AS "publicId",
               p.name AS plan, (p.limits->>'windows')::int AS "windowLimit",
               coalesce(w.billed, 0)          AS "windowsUsed",
               coalesce(w.cost, 0)::float     AS "aiCost",
               coalesce(inc.open_critical, 0) AS "openCritical",
               coalesce(ch.worst, 'none')     AS "channelHealth",
               coalesce(bv.mode, 'full')      AS "knowledgeMode"
          FROM tenants t
          LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
          LEFT JOIN plans p ON p.id = s.plan_id
          LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE billed_at IS NOT NULL) AS billed,
                   sum(ai_cost_usd) AS cost
              FROM conversation_windows
             WHERE tenant_id = t.id
               AND billing_period = to_char(now() AT TIME ZONE t.timezone, 'YYYY-MM')) w ON true
          LEFT JOIN LATERAL (
            SELECT count(*) AS open_critical FROM incidents
             WHERE tenant_id = t.id AND status <> 'resolved' AND severity = 'critical') inc ON true
          LEFT JOIN LATERAL (
            SELECT min(CASE status WHEN 'error' THEN 'error' WHEN 'pending' THEN 'pending'
                                   ELSE 'connected' END) AS worst
              FROM tenant_channels WHERE tenant_id = t.id) ch ON true
          LEFT JOIN LATERAL (
            SELECT bv.knowledge_mode AS mode FROM bot_configs bc
              JOIN bot_versions bv ON bv.id = bc.published_version_id
             WHERE bc.tenant_id = t.id) bv ON true
         WHERE t.status <> 'archived'
         ORDER BY inc.open_critical DESC NULLS LAST,
                  (coalesce(w.billed,0)::float / greatest((p.limits->>'windows')::int, 1)) DESC
      `);
      return { items: rows };
    });
  });

  /**
   * إنشاء مستأجر.
   * يولّد `publicId` غير قابلٍ للتخمين (26 حرفاً) وتوكن تحقّقٍ للويبهوك،
   * ويُنشئ حساب المالك بكلمةِ مرورٍ مؤقّتة يجب تغييرها.
   */
  app.post<{ Body: { name?: string; slug?: string; ownerEmail?: string; ownerName?: string; planId?: string } }>(
    '/console/tenants',
    { preHandler: owner },
    async (req) => {
      const b = req.body ?? {};
      if (!b.name || !b.slug || !b.ownerEmail) {
        throw new AppError(ErrorCode.VALIDATION, 'الاسم والمعرّف وبريد المالك مطلوبة', 400);
      }
      const db = getDb();
      const temp = publicId().slice(0, 12);

      return withPlatform(db, 'إنشاء مستأجرٍ جديد من لوحة المالك', async (tx) => {
        const [tenant] = await tx.insert(tenants).values({
          publicId: publicId(), name: b.name!, slug: b.slug!,
          status: 'trial', planId: b.planId ?? null,
        }).returning();
        /* ولماذا يبقى `planId` على المستأجر رغم الاشتراك: هو ما تقرأه لوحة
           العملاء في صفٍّ واحدٍ بلا ضمّ. والمصدرُ الحاكم للسقف هو الاشتراك. */

        await tx.insert(users).values({
          tenantId: tenant!.id, email: b.ownerEmail!.toLowerCase(),
          passwordHash: await hashPassword(temp),
          name: b.ownerName ?? b.name!, role: 'tenant_owner', mustChangePassword: true,
        });

        await tx.insert(botConfigs).values({ tenantId: tenant!.id });

        /* ★ اشتراكٌ لكلّ عميلٍ يُنشأ — ولا عميلَ بسقفٍ لا نهائيّ.
           العطل الذي وُلد منه هذا: المعالج كان يكتب `planId` على صفّ المستأجر
           ولا يُنشئ صفّ `subscriptions` إطلاقاً، و`checkQuota` ترجع عند غياب
           الاشتراك `{ allowed: true, limit: Infinity }`. فكلُّ عميلٍ أُنشئ من
           اللوحة كان بلا سقفٍ ولا عتباتِ إنذارٍ ولا سياسةِ تجاوز — وشاشةُ
           الاستهلاك عنده تقول «من 0». مُثبَتٌ على الخادم الحيّ: مستأجرٌ
           قائمٌ بلا صفّ اشتراك.
           والباقة تُحلّ صراحةً: معرّفٌ غير موجود يُردّ عليه 400 لا 500. */
        const plan = b.planId
          ? (await tx.select().from(plans).where(eq(plans.id, b.planId)).limit(1))[0]
          : (await tx.select().from(plans).where(eq(plans.isPublic, true))
              .orderBy(asc(plans.sort)).limit(1))[0];
        if (!plan) {
          throw new AppError(
            ErrorCode.VALIDATION,
            b.planId ? 'الباقة المختارة غير موجودة' : 'لا باقةَ منشورة — أضِف باقةً قبل إنشاء عميل',
            400,
          );
        }

        /* ⚠️ المدّة سنةٌ لا شهر **عن قصد**: `checkQuota` تختار الاشتراك النشط
           بأبعد `period_end` ولا تقرأ التاريخ إطلاقاً، والتجديد يدويٌّ اليوم
           بقرارٍ مكتوب. فشهرٌ ينقضي بلا تجديدٍ آليٍّ يُنتج عميلاً يبدو منتهياً
           في التقارير بينما سقفه يعمل — وهو التباسٌ لا حاجة إليه. */
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
        await tx.insert(subscriptions).values({
          tenantId: tenant!.id,
          planId: plan.id,
          status: 'active',
          periodStart: now,
          periodEnd,
        });

        await tx.insert(auditLog).values({
          tenantId: tenant!.id, actorUserId: req.auth!.sub,
          action: 'tenant.create', entity: 'tenant', entityId: tenant!.id, ip: req.ip,
        });

        /* ★ `tenant!` في السطور أعلاه، والبثُّ بلا `!` — فكان يمرّر
           `undefined` إلى الغرفة لو لم يُدرَج الصفّ: حدثٌ بلا معرّف تقرؤه
           لوحةُ المالك فتحدّث صفّاً لا وجودَ له. والعقدُ المنمَّط أمسكها. */
        if (tenant) emitToPlatform('tenant:update', tenant);
        return {
          tenant,
          // كلمة المرور المؤقّتة تُعرض **مرّةً واحدة** ولا تُخزَّن نصّاً في أيّ مكان
          tempPassword: temp,
          webhookUrl: `${process.env.PUBLIC_URL}/api/webhooks/wa/${tenant!.publicId}`,
        };
      });
    },
  );

  /**
   * الانتحال.
   * قراءةٌ فقط (كلّ فعلٍ كاتبٍ يُرفض في `requireAuth`)، صلاحيّته 30 دقيقة،
   * **ويُسجَّل في سجلّ المستأجر نفسه فيراه العميل**. لا انتحالٌ صامت.
   */
  app.post<{ Params: { id: string } }>('/console/tenants/:id/impersonate', { preHandler: owner }, async (req) => {
    const db = getDb();
    return withPlatform(db, 'انتحال قراءةٍ لدعم عميل', async (tx) => {
      const t = (await tx.select().from(tenants).where(eq(tenants.id, req.params.id)).limit(1))[0];
      if (!t) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'مستأجرٌ غير موجود', 404);

      await tx.insert(auditLog).values({
        tenantId: t.id, actorUserId: req.auth!.sub,
        action: 'tenant.impersonate', entity: 'tenant', entityId: t.id, ip: req.ip,
        diff: { readOnly: true, minutes: 30 },
      });

      return {
        access: signAccess(
          { sub: req.auth!.sub, tid: t.id, role: 'platform_owner', sid: req.auth!.sid, imp: t.id },
          30 * 60,
        ),
        tenant: { id: t.id, name: t.name },
        notice: 'قراءةٌ فقط · 30 دقيقة · مسجَّلٌ ويراه العميل في سجلّه',
      };
    });
  });

  /** مفتاح إيقافٍ فوريّ لبوت عميل — الفعل الذي تحتاجه الثالثة فجراً. */
  app.post<{ Params: { id: string } }>('/console/tenants/:id/kill-bot', { preHandler: owner }, async (req) => {
    const db = getDb();
    return withPlatform(db, 'إيقاف بوت عميلٍ فوريّاً', async (tx) => {
      await tx.update(botConfigs).set({ enabled: false }).where(eq(botConfigs.tenantId, req.params.id));
      await tx.insert(auditLog).values({
        tenantId: req.params.id, actorUserId: req.auth!.sub,
        action: 'tenant.kill_bot', entity: 'tenant', entityId: req.params.id, ip: req.ip,
      });
      return { ok: true };
    });
  });

  app.get<{ Querystring: { status?: string; severity?: string } }>(
    '/console/incidents',
    { preHandler: owner },
    async (req) => {
      const db = getDb();
      return withPlatform(db, 'عرض سيل الحوادث', async (tx) => {
        const where = [];
        if (req.query.status) where.push(eq(incidents.status, req.query.status as 'open' | 'ack' | 'resolved'));
        else where.push(sql`${incidents.status} <> 'resolved'`);
        if (req.query.severity) where.push(eq(incidents.severity, req.query.severity as 'info' | 'warn' | 'critical'));

        return tx.select({
          id: incidents.id, kind: incidents.kind, severity: incidents.severity,
          title: incidents.title, status: incidents.status, count: incidents.count,
          firstSeenAt: incidents.firstSeenAt, lastSeenAt: incidents.lastSeenAt,
          detail: incidents.detail, tenantName: tenants.name,
        }).from(incidents)
          .leftJoin(tenants, eq(tenants.id, incidents.tenantId))
          .where(and(...where))
          .orderBy(desc(incidents.lastSeenAt)).limit(100);
      });
    },
  );

  app.post<{ Params: { id: string; action: 'ack' | 'resolve' } }>(
    '/console/incidents/:id/:action',
    { preHandler: owner },
    async (req) => {
      const db = getDb();
      return withPlatform(db, 'تحديث حالة حادثة', async (tx) => {
        const set = req.params.action === 'ack'
          ? { status: 'ack' as const }
          : { status: 'resolved' as const, resolvedAt: new Date(), resolvedBy: req.auth!.sub };
        const [row] = await tx.update(incidents).set(set).where(eq(incidents.id, req.params.id)).returning();
        /* ★ حادثةٌ بمعرّفٍ لا وجودَ له تُصيب صفرَ صفوف، فيعود `undefined`.
           وكان يُبثّ كما هو ويُردّ **جسماً فارغاً بـ200**: الشاشة تقول
           «حُلَّت» ولا شيء حُلّ. والعقدُ المنمَّط أمسك البثّ، والحالةُ نفسُها
           تستحقّ ٤٠٤ لا ٢٠٠. */
        if (!row) throw new AppError(ErrorCode.VALIDATION, 'لا حادثةَ بهذا المعرّف', 404);
        emitToPlatform('incident:update', row);
        return row;
      });
    },
  );

  /** ★ لوحة الهامش — أهمّ تقاريرك: ترى من يستهلك أكثر ممّا يدفع في شهره الأوّل. */
  app.get<{ Querystring: { period?: string } }>('/console/usage', { preHandler: owner }, async (req) => {
    const db = getDb();
    const period = req.query.period ?? new Date().toISOString().slice(0, 7);
    return withPlatform(db, 'تقرير الهامش الشهريّ', async (tx) => {
      const rows = await tx.execute(sql`
        SELECT t.id, t.name,
               p.name                                   AS plan,
               p.price_monthly::float                   AS revenue,
               coalesce(sum(w.ai_cost_usd), 0)::float   AS "aiCost",
               count(w.id) FILTER (WHERE w.billed_at IS NOT NULL)::int AS windows,
               coalesce(avg(r.total_tokens), 0)::int    AS "avgTokensPerReply"
          FROM tenants t
          LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
          LEFT JOIN plans p ON p.id = s.plan_id
          LEFT JOIN conversation_windows w ON w.tenant_id = t.id AND w.billing_period = ${period}
          LEFT JOIN ai_runs r ON r.tenant_id = t.id
                             AND to_char(r.created_at, 'YYYY-MM') = ${period}
         WHERE t.status = 'active'
         GROUP BY t.id, t.name, p.name, p.price_monthly
         ORDER BY (p.price_monthly::float - coalesce(sum(w.ai_cost_usd), 0)::float) ASC
      `);
      return { period, items: rows };
    });
  });

  app.get('/console/health', { preHandler: owner }, async () => {
    const { queueDepths } = await import('../queues.js');
    const db = getDb();
    return withPlatform(db, 'صحّة المنصّة', async (tx) => {
      const stalled = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM conversation_windows
         WHERE closed_at IS NULL AND expires_at < now() - interval '1 hour'
      `);
      return {
        queues: await queueDepths(),
        expiredWindowsPending: (stalled as unknown as Array<{ n: number }>)[0]?.n ?? 0,
      };
    });
  });

  app.get('/console/audit', { preHandler: owner }, async () => {
    const db = getDb();
    return withPlatform(db, 'سجلّ التدقيق العابر للمستأجرين', async (tx) =>
      tx.select({
        id: auditLog.id, action: auditLog.action, entity: auditLog.entity,
        entityId: auditLog.entityId, createdAt: auditLog.createdAt,
        ip: auditLog.ip, tenantName: tenants.name, actor: users.name,
      }).from(auditLog)
        .leftJoin(tenants, eq(tenants.id, auditLog.tenantId))
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .orderBy(desc(auditLog.createdAt)).limit(200));
  });
}
