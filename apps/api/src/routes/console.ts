import type { FastifyInstance } from 'fastify';
import {
  getDb, withPlatform, tenants, users, sessions, plans, subscriptions, tenantChannels,
  conversationWindows, aiRuns, incidents, auditLog, botConfigs,
  eq, and, isNull, desc, asc, sql,
} from '@aibot/db';
import { AppError, ErrorCode, billingPeriod, DEFAULT_TZ } from '@aibot/shared';
import { publicId, seal, sha256 } from '@aibot/crypto';
import { requireAuth, signAccess, hashPassword } from '../auth.js';
import { isUniqueViolation } from './team.js';
import { emitToPlatform } from '../realtime.js';

/**
 * لوحة المالك.
 *
 * كلّ مسارٍ هنا يستعمل `withPlatform` — الدور المتجاوز لـRLS — ولذلك
 * كلٌّ منه يمرّر **سبباً مكتوباً**، ويُسجَّل ما يستحقّ التسجيل في `audit_log`.
 * الوصول العابر للمستأجرين لا يكون صامتاً.
 */
/** نفسُ حارس `team.ts`: معرّفٌ مشوّهٌ «لا شيءَ بهذا الاسم» لا «عطبٌ عندنا». */
const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * ★ 23505 على `tenants.slug` أو `users.email` (فريدٌ على المنصّة كلّها) كان
 *   يُردّ 500 «عطبٌ عندنا» — وهو أكثرُ خطأٍ يقع فيه من يُنشئ عميلاً. والقيدُ
 *   يُسمّى من `constraint_name` الذي يمرّره postgres.js، فتُقال العلّةُ بعينها.
 */
function uniqueMessage(e: unknown): string {
  const c = String((e as { constraint_name?: unknown }).constraint_name ?? '');
  if (/slug/.test(c)) return 'هذا المعرّف مستعملٌ لعميلٍ آخر — اختر معرّفاً غيره.';
  if (/email/.test(c)) return 'بريدُ المالك مستعملٌ على المنصّة سلفاً — لكلّ حسابٍ بريدٌ واحد.';
  return 'قيمةٌ مكرّرة: المعرّف أو بريد المالك مستعملٌ سلفاً.';
}

export async function registerConsole(app: FastifyInstance) {
  const owner = requireAuth({ console: true, role: ['platform_owner'] });

  /** الجدول مرتَّبٌ **بالمخاطرة** لا بالاسم: الأسوأ صحّةً أوّلاً ثمّ الأقرب لسقفه. */
  app.get<{ Querystring: { archived?: string } }>('/console/tenants', { preHandler: owner }, async (req) => {
    const db = getDb();
    /* ★ المؤرشَفون يختفون من الجدول عمداً — ويُطلبون صراحةً: أرشفةٌ بلا طريقِ
       عودةٍ إلى الصفّ هي حذفٌ بثوبٍ آخر، والاستعادةُ تحتاج أن تراه. */
    const includeArchived = req.query.archived === '1';
    /* ★ و`coalesce(bv.mode, 'full')` يُقنّع الغياب، فعميلٌ بلا نسخةٍ منشورةٍ
       إطلاقاً كان يُوسَم في اللوحة «حقنٌ كامل» — يُقرأ «بوتُه يعمل» على تهيئةٍ لم
       تبدأ. فـ`botSeeded` علَمٌ صريحٌ يُرى منه النقص.
       و`ownerPending` («مالكٌ لم يدخل قطّ وكلمتُه مؤقّتة») هي بعينها علامةُ
       معالجٍ أُغلق قبل أن تُنسخ الكلمة — وهي تُعرض مرّةً واحدةً ولا تُخزَّن. */
    return withPlatform(db, 'عرض جدول العملاء في لوحة المالك', async (tx) => {
      const rows = await tx.execute(sql`
        SELECT t.id, t.name, t.status, t.public_id AS "publicId",
               p.name AS plan, (p.limits->>'windows')::int AS "windowLimit",
               coalesce(w.billed, 0)          AS "windowsUsed",
               coalesce(w.cost, 0)::float     AS "aiCost",
               coalesce(inc.open_critical, 0) AS "openCritical",
               coalesce(ch.worst, 'none')     AS "channelHealth",
               coalesce(bv.mode, 'full')      AS "knowledgeMode",
               (bv.mode IS NOT NULL)          AS "botSeeded",
               ow.email                       AS "ownerEmail",
               coalesce(ow.pending, false)    AS "ownerPending",
               t.archived_at                  AS "archivedAt",
               (bc.platform_locked_at IS NOT NULL) AS "botLocked"
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
          LEFT JOIN LATERAL (
            SELECT u.email,
                   (u.must_change_password AND u.last_login_at IS NULL) AS pending
              FROM users u
             WHERE u.tenant_id = t.id AND u.role = 'tenant_owner' AND u.is_active
             ORDER BY u.created_at ASC
             LIMIT 1) ow ON true
          LEFT JOIN LATERAL (
            SELECT platform_locked_at FROM bot_configs WHERE tenant_id = t.id) bc ON true
         WHERE ${includeArchived ? sql`true` : sql`t.status <> 'archived'`}
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
      /* ⚠️ التجزئةُ **قبل** فتح المعاملة: argon2 نحو مئة مِلّي ثانية، وكان
         يُنفَّذ داخل `withPlatform` فيحتجز واحداً من عشرة اتّصالاتٍ في البِركة
         بلا عملِ قاعدةٍ أصلاً — ونفسُ القاعدة تمنع نداءَ الشبكة داخل معاملة. */
      const ownerHash = await hashPassword(temp);

      return withPlatform(db, 'إنشاء مستأجرٍ جديد من لوحة المالك', async (tx) => {
        /* ★ الباقةُ تُحلّ **قبل** أيّ إدراج: `planId` مفتاحٌ أجنبيٌّ على صفّ
           المستأجر، فمعرّفُ باقةٍ خاطئٌ كان يرفع 23503 ويُردّ 500 قبل أن يصل
           إلى فحص الـ400 الذي كُتب له. */
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

        let tenant: typeof tenants.$inferSelect | undefined;
        try {
          [tenant] = await tx.insert(tenants).values({
            publicId: publicId(), name: b.name!, slug: b.slug!,
            status: 'trial', planId: plan.id,
          }).returning();
        /* ولماذا يبقى `planId` على المستأجر رغم الاشتراك: هو ما تقرأه لوحة
           العملاء في صفٍّ واحدٍ بلا ضمّ. والمصدرُ الحاكم للسقف هو الاشتراك. */

          await tx.insert(users).values({
            tenantId: tenant!.id, email: b.ownerEmail!.toLowerCase(),
            passwordHash: ownerHash,
            name: b.ownerName ?? b.name!, role: 'tenant_owner', mustChangePassword: true,
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new AppError(ErrorCode.VALIDATION, uniqueMessage(e), 409);
          throw e;
        }

        await tx.insert(botConfigs).values({ tenantId: tenant!.id });

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
    if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);
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
          /* ★★ والمطالبةُ تُحمَل لا تُخلَق: هذا المسارُ نفسُه خلف `owner` الذي
             يشترط `mfa === 'ok'`، فالتوكنُ الجديد يرث ما أثبته القديم. وبلا
             حملِها يفشل توكنُ الانتحال في بوّابته هو، فيُصاب الانتحالُ بالشلل
             بـ٤٠٣ لا يفهمها مالكُ المنصّة. */
          { sub: req.auth!.sub, tid: t.id, role: 'platform_owner', sid: req.auth!.sid, imp: t.id, mfa: 'ok' },
          30 * 60,
        ),
        tenant: { id: t.id, name: t.name },
        notice: 'قراءةٌ فقط · 30 دقيقة · مسجَّلٌ ويراه العميل في سجلّه',
      };
    });
  });

  /**
   * ★ **إعادةُ كلمةِ مرورٍ مؤقّتةٍ لمالك عميل — البابُ الذي كان `ssh` وحده.**
   *
   *   `tempPassword` تُعرض **مرّةً واحدةً** في الخطوة الثانية من المعالج ولا
   *   تُخزَّن نصّاً في أيّ مكان. ومعالجٌ يُغلق بنقرةٍ على الخلفيّة يترك مالكاً لا
   *   يملك كلمته ولا بابَ استعادة: الانتحالُ قراءةٌ فقط عن قصد،
   *   و`/team/:id/reset-password` مُقيَّدٌ بمستأجر التوكن. فكان المخرجُ الوحيد
   *   `ops/set-password.ts` على الخادم.
   *
   * ★ ونفسُ حدود `/team/:id/reset-password` الثلاثة: كلمةٌ مولَّدةٌ يعرفها من
   *   عيّنها ⇒ `mustChangePassword` مرفوعٌ دائماً، وكلُّ الجلسات تسقط في نفس
   *   المعاملة (تعطيلٌ لا يطرد ليس تعطيلاً)، والأثرُ مسجَّلٌ باسم الفاعل.
   */
  app.post<{ Params: { id: string } }>(
    '/console/tenants/:id/owner/reset-password',
    { preHandler: owner },
    async (req) => {
      /* ⚠️ معرّفٌ مشوّهٌ يُردّ عليه ٤٠٤ لا ٥٠٠: `${id}` في `sql` يُحوَّل إلى
         uuid في القاعدة، فخطأٌ مطبعيٌّ كان يرفع 22P02 ويقرأ المالكُ «عطبٌ
         عندنا» عن خطئه هو. والفحصُ قبل argon2 فلا يُهدَر مئةُ مِلّي ولا اتّصال. */
      if (!UUID_RE.test(req.params.id)) {
        throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);
      }
      const db = getDb();
      const temp = publicId().slice(0, 12);
      const hash = await hashPassword(temp);

      const out = await withPlatform(db, 'إعادةُ كلمةِ مرورٍ مؤقّتةٍ لمالك عميل', async (tx) => {
        const target = (await tx.select({ id: users.id, email: users.email }).from(users)
          .where(and(
            eq(users.tenantId, req.params.id),
            eq(users.role, 'tenant_owner'),
            eq(users.isActive, true),
          ))
          .orderBy(asc(users.createdAt)).limit(1))[0];
        if (!target) throw new AppError(ErrorCode.VALIDATION, 'لا مالكَ نشطاً لهذا العميل', 404);

        await tx.update(users)
          .set({ passwordHash: hash, mustChangePassword: true })
          .where(eq(users.id, target.id));

        const revoked = await tx.update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });

        await tx.insert(auditLog).values({
          tenantId: req.params.id, actorUserId: req.auth!.sub,
          action: 'tenant.owner_password_reset', entity: 'user', entityId: target.id, ip: req.ip,
          diff: { email: target.email, generated: true, sessionsRevoked: revoked.length },
        });
        return { email: target.email, sessionsRevoked: revoked.length };
      });

      // تُعرض مرّةً واحدةً كما في المعالج — ولا تُخزَّن نصّاً في أيّ مكان
      return { ...out, tempPassword: temp };
    },
  );

  /**
   * ★ **بيانا الويبهوك لعميلٍ موصولٍ سلفاً — وكانا يخرجان بـ`ssh` وحده.**
   *
   *   `verifyToken` يُستَرّ عمداً: `GET /channels` يُسقطه من الردّ، وهو في قائمة
   *   الحجب في `packages/crypto`. فإن أغلق العميلُ معالجَه قبل الخطوة الخامسة
   *   ضاع منه الـCallback URL وتوكنُ التحقّق، ولا يعودان إلّا بإعادة إدخال
   *   التوكن الدائم وسرّ التطبيق — وهما ما لا يملكه مالكُ المنصّة.
   *
   * ⚠️ ولذلك مسارٌ مستقلٌّ يُطلب عند الحاجة، لا حقلٌ في قائمة العملاء: سرٌّ
   *    يُشحن مع كلّ صفٍّ في كلّ فتحةٍ للوحة سرٌّ مُذاعٌ لا مُتاح.
   */
  app.get<{ Params: { id: string } }>(
    '/console/tenants/:id/channel',
    { preHandler: owner },
    async (req) => {
      if (!UUID_RE.test(req.params.id)) {
        throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);
      }
      return withPlatform(getDb(), 'قراءةُ بيانات ويبهوك عميلٍ لإعادة إعطائها له', async (tx) => {
        const t = (await tx.select({ publicId: tenants.publicId }).from(tenants)
          .where(eq(tenants.id, req.params.id)).limit(1))[0];
        if (!t) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);

        const rows = await tx.select({
          kind: tenantChannels.kind,
          status: tenantChannels.status,
          verifyToken: tenantChannels.verifyToken,
        }).from(tenantChannels).where(eq(tenantChannels.tenantId, req.params.id));

        await tx.insert(auditLog).values({
          tenantId: req.params.id, actorUserId: req.auth!.sub,
          action: 'tenant.channel_secrets_read', entity: 'tenant', entityId: req.params.id,
          ip: req.ip, diff: { channels: rows.length },
        });
        return { publicId: t.publicId, channels: rows };
      });
    },
  );

  /** مفتاح إيقافٍ فوريّ لبوت عميل — الفعل الذي تحتاجه الثالثة فجراً. */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/console/tenants/:id/kill-bot', { preHandler: owner }, async (req) => {
    const db = getDb();
    if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);
    /* ★★ قفلٌ لا إطفاء: `enabled=false` وحده كان يُلغيه العميل بضغطة «شغّل».
       فيُكتب معه `platform_locked_at` وسببٌ يراه العميلُ في شاشته، ويرفض
       `/bot/toggle` التشغيلَ ما دام مكتوباً. */
    const reason = String(req.body?.reason ?? '').trim().slice(0, 200) || 'إيقافٌ من فريق المنصّة';
    return withPlatform(db, 'إيقاف بوت عميلٍ فوريّاً', async (tx) => {
      /* ★ `.returning()` لا `void`: معرّفٌ بلا صفٍّ كان يُصيب صفرَ صفوفٍ ويردّ
         `{ ok: true }` — الشاشةُ تقول «أُوقف» ولا شيء أُوقف، في الفعل الذي
         يُضغط الثالثةَ فجراً بالذات. */
      const hit = await tx.update(botConfigs)
        .set({ enabled: false, platformLockedAt: new Date(), platformLockReason: reason })
        .where(eq(botConfigs.tenantId, req.params.id)).returning({ tenantId: botConfigs.tenantId });
      if (!hit.length) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا بوتَ لعميلٍ بهذا المعرّف — ولم يُوقَف شيء', 404);
      await tx.insert(auditLog).values({
        tenantId: req.params.id, actorUserId: req.auth!.sub,
        action: 'tenant.kill_bot', entity: 'tenant', entityId: req.params.id, ip: req.ip,
        diff: { reason },
      });
      return { ok: true };
    });
  });

  /** ★ رفعُ إيقاف المنصّة — يفتح للعميل زرَّه ولا يشغّل البوتَ عنه: التشغيلُ قرارُه هو. */
  app.post<{ Params: { id: string } }>('/console/tenants/:id/unlock-bot', { preHandler: owner }, async (req) => {
    if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);
    return withPlatform(getDb(), 'رفعُ إيقاف المنصّة عن بوت عميل', async (tx) => {
      const hit = await tx.update(botConfigs)
        .set({ platformLockedAt: null, platformLockReason: null })
        .where(and(eq(botConfigs.tenantId, req.params.id), sql`${botConfigs.platformLockedAt} is not null`))
        .returning({ tenantId: botConfigs.tenantId });
      if (!hit.length) throw new AppError(ErrorCode.VALIDATION, 'لا إيقافَ من المنصّة على بوت هذا العميل', 404);
      await tx.insert(auditLog).values({
        tenantId: req.params.id, actorUserId: req.auth!.sub,
        action: 'tenant.unlock_bot', entity: 'tenant', entityId: req.params.id, ip: req.ip,
      });
      return { ok: true };
    });
  });

  /**
   * ★★★ **دورةُ حياة العميل — كانت بلا فعلٍ واحد.**
   *
   *   كلُّ عميلٍ يُنشأ `trial` ولا يصير `active` أبداً، ولا مسارَ إيقافٍ ولا
   *   أرشفة. والحالةُ تُقرأ في خمسة مواضع (الدخول، التجديد، الويبهوك، الإرسال،
   *   لوحةُ الهامش) ولا يكتبها أحد. فثلاثةُ انتقالاتٍ مسمّاةٍ لا حقلٌ حرّ:
   *   `activate` · `suspend` · `archive` — وكلُّ واحدٍ يُقيَّد بحالاتٍ يخرج منها.
   *
   * ⚠️ **الإيقافُ يطرد.** توكنُ الوصول لا يسأل عن حالة المستأجر في كلّ طلب،
   *    فبلا إسقاط الجلسات يبقى الموقوفُ يعمل ربعَ ساعة ويُجدَّد ما دام الكوكي
   *    حيّاً. والإسقاطُ في نفس المعاملة — إيقافٌ لا يطرد ليس إيقافاً.
   */
  const TENANT_TRANSITIONS = {
    activate: { from: ['trial', 'suspended', 'archived'], to: 'active', msg: 'صار الحسابُ فعّالاً' },
    suspend:  { from: ['trial', 'active'], to: 'suspended', msg: 'أُوقف الحساب — لا دخولَ ولا رسائلَ حتّى يُعاد' },
    archive:  { from: ['trial', 'active', 'suspended'], to: 'archived', msg: 'أُرشف الحساب — يختفي من الجدول ويُستعاد بـ«فعّل»' },
  } as const;
  type Transition = keyof typeof TENANT_TRANSITIONS;

  app.post<{ Params: { id: string; action: string } }>(
    '/console/tenants/:id/status/:action',
    { preHandler: owner },
    async (req) => {
      if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);
      if (!(req.params.action in TENANT_TRANSITIONS)) {
        throw new AppError(ErrorCode.VALIDATION, 'انتقالٌ غيرُ معروف — activate أو suspend أو archive', 400);
      }
      const tr = TENANT_TRANSITIONS[req.params.action as Transition];
      const out = await withPlatform(getDb(), 'تغييرُ حالة عميل من لوحة المالك', async (tx) => {
        const t = (await tx.select().from(tenants).where(eq(tenants.id, req.params.id)).limit(1))[0];
        if (!t) throw new AppError(ErrorCode.TENANT_NOT_FOUND, 'لا عميلَ بهذا المعرّف', 404);
        if (!(tr.from as readonly string[]).includes(t.status)) {
          throw new AppError(ErrorCode.VALIDATION, `لا انتقالَ من حالة «${t.status}» بهذا الفعل`, 409);
        }
        const [next] = await tx.update(tenants)
          .set({ status: tr.to, archivedAt: tr.to === 'archived' ? new Date() : null })
          .where(eq(tenants.id, t.id)).returning();
        let sessionsRevoked = 0;
        if (tr.to !== 'active') {
          const revoked = await tx.update(sessions).set({ revokedAt: new Date() })
            .where(and(
              isNull(sessions.revokedAt),
              sql`${sessions.userId} in (select id from users where tenant_id = ${t.id})`,
            ))
            .returning({ id: sessions.id });
          sessionsRevoked = revoked.length;
        }
        await tx.insert(auditLog).values({
          tenantId: t.id, actorUserId: req.auth!.sub,
          action: 'tenant.status', entity: 'tenant', entityId: t.id, ip: req.ip,
          diff: { from: t.status, to: tr.to, sessionsRevoked },
        });
        return { tenant: next!, sessionsRevoked };
      });
      emitToPlatform('tenant:update', out.tenant);
      return { ok: true, message: tr.msg, status: out.tenant.status, sessionsRevoked: out.sessionsRevoked };
    },
  );

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
          /* ★ المعرّفُ مع الاسم: الاسمُ للعين، والمعرّفُ للطريق إلى ورقة العميل. */
          detail: incidents.detail, tenantId: incidents.tenantId, tenantName: tenants.name,
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
      /* ★ المعاملُ نصٌّ حرٌّ في وقت التشغيل مهما قال النوع: `/incidents/:id/whatever`
         كان يقع في فرع «غير ack» فيحلّ الحادثةَ بأيّ كلمة. */
      if (req.params.action !== 'ack' && req.params.action !== 'resolve') {
        throw new AppError(ErrorCode.VALIDATION, 'فعلٌ غيرُ معروف — ack أو resolve', 400);
      }
      if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.VALIDATION, 'لا حادثةَ بهذا المعرّف', 404);
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
    /* ★ حين لا يُطلب شهرٌ بعينه فالشهرُ **لكلّ عميلٍ بمنطقته** — كان شهرَ UTC
       للجميع، فعدّادُ النوافذ (مختومٌ بمنطقة العميل) وعدّادُ التوكنز اختلفا
       ثلاثَ ساعاتٍ عند رأس كلّ شهر. والمطلوبُ صراحةً يُطبَّق كما هو. */
    const asked = req.query.period ?? null;
    const period = asked ?? billingPeriod(new Date(), DEFAULT_TZ);
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
          LEFT JOIN conversation_windows w ON w.tenant_id = t.id
                             AND w.billing_period = coalesce(${asked}::text, to_char(now() AT TIME ZONE t.timezone, 'YYYY-MM'))
          LEFT JOIN ai_runs r ON r.tenant_id = t.id
                             AND to_char(r.created_at AT TIME ZONE t.timezone, 'YYYY-MM')
                               = coalesce(${asked}::text, to_char(now() AT TIME ZONE t.timezone, 'YYYY-MM'))
         -- ★ كان «= 'active'» — ولا عميلَ يصير active من المعالج، فخلت اللوحةُ من
         --   كلّ من أُنشئ منه. التجريبيُّ والموقوفُ يكلّفان أيضاً؛ المؤرشَفُ وحده خارجها.
         WHERE t.status <> 'archived'
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
