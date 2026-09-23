import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  getDb, withTenant, conversations, conversationWindows, messages, aiRuns,
  tenantChannels, contacts, channelIdentities, botConfigs, subscriptions, plans, tenants,
  auditLog, withPlatform, quotaAlerts,
  eq, and, asc, desc, isNull, sql,
} from '@aibot/db';
import { capabilitiesFor, getAdapter, type ChannelKind } from '@aibot/channels';
import { open as decrypt, seal, fingerprint, publicId } from '@aibot/crypto';
import { requireAuth, tenantOf } from '../auth.js';
import { AppError, ErrorCode, capConsequence } from '@aibot/shared';

/** الشهر بتوقيت المستأجر — نافذةٌ تُفتح آخر الشهر تُفوتَر على شهر فتحها. */
function period(tz = 'Asia/Amman'): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
}

/**
 * العتباتُ التي أُنذر بها العميل في هذه الدورة.
 *
 * ★ تُقرأ من نفس الجدول الذي يكتبه العامل (`quota_alerts`) — فالشاشة تعرض
 *   **ما أُرسل فعلاً** لا ما كان يُفترض أن يُرسَل. وشاشةٌ تقول «أنذرناك» وهي
 *   تستنتج ذلك من النسبة تكذب حين يتعطّل الدفع، وهي أسوأ كذبةٍ ممكنة هنا.
 */
async function alertsOf(tx: never, period: string): Promise<Array<{ threshold: number; firedAt: Date }>> {
  return (tx as unknown as ReturnType<typeof getDb>)
    .select({ threshold: quotaAlerts.threshold, firedAt: quotaAlerts.firedAt })
    .from(quotaAlerts)
    .where(eq(quotaAlerts.billingPeriod, period))
    .orderBy(asc(quotaAlerts.threshold));
}

async function limitsOf(tx: never, tenantId: string): Promise<Record<string, number>> {
  const rows = await (tx as unknown as ReturnType<typeof getDb>)
    .select({ limits: plans.limits, override: subscriptions.limitsOverride })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  return {
    ...((rows[0]?.limits ?? {}) as Record<string, number>),
    ...((rows[0]?.override ?? {}) as Record<string, number>),
  };
}

export async function registerReports(app: FastifyInstance) {
  /** نبض اليوم — تُقرأ في كلّ تحميلٍ للوحة، فكلّ استعلامٍ هنا مفهرس. */
  app.get('/reports/overview', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const lim = await limitsOf(tx as never, tenantId);
      const p = period();

      const [today] = await tx.execute<{
        conversations: number; bot_replies: number; needs_attention: number; median_latency: number;
        self_resolved: number; total_convs: number;
      }>(sql`
        SELECT
          (SELECT count(DISTINCT conversation_id)::int FROM messages
            WHERE tenant_id = ${tenantId} AND created_at > now() - interval '24 hours') AS conversations,
          (SELECT count(*)::int FROM messages
            WHERE tenant_id = ${tenantId} AND source = 'bot' AND created_at > now() - interval '24 hours') AS bot_replies,
          (SELECT count(*)::int FROM conversations
            WHERE tenant_id = ${tenantId} AND needs_attention) AS needs_attention,
          (SELECT coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::int FROM ai_runs
            WHERE tenant_id = ${tenantId} AND created_at > now() - interval '7 days') AS median_latency,
          (SELECT count(*)::int FROM conversation_windows
            WHERE tenant_id = ${tenantId} AND billing_period = ${p}
              AND billed_at IS NOT NULL AND bot_replies > 0
              AND NOT EXISTS (SELECT 1 FROM messages m
                               WHERE m.conversation_id = conversation_windows.conversation_id
                                 AND m.source = 'agent'
                                 AND m.created_at >= conversation_windows.opened_at)) AS self_resolved,
          (SELECT count(*)::int FROM conversation_windows
            WHERE tenant_id = ${tenantId} AND billing_period = ${p} AND billed_at IS NOT NULL) AS total_convs
      `) as unknown as Array<Record<string, number>>;

      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(conversationWindows)
        .where(and(
          eq(conversationWindows.billingPeriod, p),
          sql`${conversationWindows.billedAt} is not null`,
        ));

      const channels = await tx
        .select({
          kind: tenantChannels.kind, status: tenantChannels.status,
          displayName: tenantChannels.displayName,
        })
        .from(tenantChannels).where(eq(tenantChannels.tenantId, tenantId));

      const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
      const sub = (await tx.select({ policy: plans.overagePolicy }).from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
        .limit(1))[0];

      const alerts = await alertsOf(tx as never, p);

      const wLimit = Number(lim.windows ?? 0);
      const wUsed = used?.n ?? 0;
      const totalConvs = Number(today?.total_convs ?? 0);
      return {
        conversationsToday: Number(today?.conversations ?? 0),
        botReplies: Number(today?.bot_replies ?? 0),
        needsAttention: Number(today?.needs_attention ?? 0),
        medianLatencyMs: Number(today?.median_latency ?? 0),
        selfResolvedRate: totalConvs ? Number(today?.self_resolved ?? 0) / totalConvs : 0,
        windowsUsed: wUsed,
        windowsLimit: wLimit,
        botEnabled: Boolean(cfg?.enabled),
        overagePolicy: sub?.policy ?? 'handoff_only',
        /* ★ نصُّ العاقبة يأتي **من الخادم** لا من جدولٍ في الواجهة: هو نفسُه
           النصُّ الذي يدفعه العامل إشعاراً، ونسختان منه تتباعدان — وقد تباعدتا
           فعلاً، فكانت الواجهة تَعِد بأنّ «فريقك يردّ يدويّاً بلا حدّ» والحارسُ
           يرفض ردَّ الموظّف على محادثةٍ جديدة كما يرفض ردَّ البوت. */
        capConsequence: capConsequence(
          sub?.policy ?? 'handoff_only',
          wLimit > 0 && wUsed >= wLimit,
        ),
        /* ★ حالةُ العتبة: متى أُنذر العميل وبأيّ عتبة. الشاشةُ تفرّق بين
           «أنت على 84٪» و«أنذرناك عند 80٪ يوم الثلاثاء» — والثانية هي التي
           تُسقط «ما حذّرني أحد». */
        quotaAlerts: alerts,
        channels,
      };
    });
  });

  /** الاستهلاك — جدول النوافذ نفسه، لا ملخّصاً مشتقّاً منه. */
  app.get('/usage', { preHandler: requireAuth({ billing: true }) }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const lim = await limitsOf(tx as never, tenantId);
      const p = period();

      const items = await tx
        .select({
          id: conversationWindows.id,
          openedAt: conversationWindows.openedAt,
          billedAt: conversationWindows.billedAt,
          messagesIn: conversationWindows.messagesIn,
          messagesOut: conversationWindows.messagesOut,
          aiCostUsd: conversationWindows.aiCostUsd,
          channelKind: tenantChannels.kind,
          handle: channelIdentities.externalId,
          contactName: contacts.displayName,
        })
        .from(conversationWindows)
        .innerJoin(tenantChannels, eq(tenantChannels.id, conversationWindows.channelId))
        .innerJoin(conversations, eq(conversations.id, conversationWindows.conversationId))
        .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
        .innerJoin(contacts, eq(contacts.id, conversationWindows.contactId))
        .where(eq(conversationWindows.billingPeriod, p))
        .orderBy(desc(conversationWindows.openedAt))
        .limit(200);

      const [agg] = await tx.execute<{
        billed: number; opened: number; tokens: number; cost: number; avg_replies: number;
      }>(sql`
        SELECT count(*) FILTER (WHERE billed_at IS NOT NULL)::int AS billed,
               count(*)::int                                      AS opened,
               coalesce(sum(bot_replies), 0)::int                 AS avg_replies,
               coalesce(sum(ai_cost_usd), 0)::float               AS cost,
               (SELECT coalesce(sum(total_tokens), 0)::int FROM ai_runs
                 WHERE tenant_id = ${tenantId}
                   AND to_char(created_at, 'YYYY-MM') = ${p})     AS tokens
          FROM conversation_windows
         WHERE tenant_id = ${tenantId} AND billing_period = ${p}
      `) as unknown as Array<Record<string, number>>;

      const alerts = await alertsOf(tx as never, p);
      const pol = await tx.select({ policy: plans.overagePolicy }).from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
        .orderBy(desc(subscriptions.periodEnd))
        .limit(1);

      const billed = Number(agg?.billed ?? 0);
      const policy = pol[0]?.policy ?? 'handoff_only';
      const wLimit = Number(lim.windows ?? 0);
      return {
        period: p,
        windowsBilled: billed,
        windowsOpened: Number(agg?.opened ?? 0),
        windowsLimit: Number(lim.windows ?? 0),
        aiTokens: Number(agg?.tokens ?? 0),
        aiTokensLimit: Number(lim.aiTokens ?? 0),
        aiCostUsd: Number(agg?.cost ?? 0),
        avgRepliesPerWindow: billed ? Number(agg?.avg_replies ?? 0) / billed : 0,
        /* ★ السياسةُ والعتباتُ معاً: شاشةُ الاستهلاك كانت تُحيل إلى الرئيسيّة
           لتقول «ماذا يحدث عند السقف» — وهي الشاشة التي يُفتحها العميل وقت
           القلق. فصارت تحمل عاقبتَها بنفسها. */
        overagePolicy: policy,
        capConsequence: capConsequence(policy, wLimit > 0 && billed >= wLimit),
        quotaAlerts: alerts,
        items,
      };
    });
  });

  /** تصديرٌ يستطيع العميل مطابقته بنفسه — عدّادٌ لا يُراجَع يُنتج نزاعاً. */
  app.get('/usage/windows.csv', { preHandler: requireAuth({ billing: true }) }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const rows = await withTenant(getDb(), tenantId, async (tx) =>
      tx.select({
        handle: channelIdentities.externalId,
        kind: tenantChannels.kind,
        openedAt: conversationWindows.openedAt,
        billedAt: conversationWindows.billedAt,
        messagesIn: conversationWindows.messagesIn,
        messagesOut: conversationWindows.messagesOut,
        cost: conversationWindows.aiCostUsd,
      })
        .from(conversationWindows)
        .innerJoin(tenantChannels, eq(tenantChannels.id, conversationWindows.channelId))
        .innerJoin(conversations, eq(conversations.id, conversationWindows.conversationId))
        .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
        .where(eq(conversationWindows.billingPeriod, period()))
        .orderBy(desc(conversationWindows.openedAt)));

    const head = 'الزبون,القناة,فُتحت,فُوتِرت,واردة,صادرة,كلفة الذكاء';
    const body = rows.map((r) => [
      r.handle, r.kind, r.openedAt.toISOString(), r.billedAt?.toISOString() ?? '',
      r.messagesIn, r.messagesOut, r.cost,
    ].join(',')).join('\n');

    // BOM ليفتح إكسل العربيّة سليمةً — بدونه يعرض محارف مشوّهة
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="windows-${period()}.csv"`)
      .send('﻿' + head + '\n' + body);
  });

  /** القنوات — مع قدراتها، فالواجهة تعرض ما تدعمه كلٌّ منها بلا شرطٍ مكتوب. */
  app.get('/channel', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const rows = await tx.select().from(tenantChannels).where(eq(tenantChannels.tenantId, tenantId));
      return {
        items: rows.map(({ tokenEnc, appSecretEnc, verifyToken, ...safe }) => ({
          ...safe,
          // لا سرَّ يُعاد للواجهة أبداً — بصمةٌ وتاريخٌ فقط
          capabilities: capabilitiesFor(safe.kind as ChannelKind),
        })),
      };
    });
  });

  /**
   * ★ ربط قناة — والقاعدة التي يفرضها: **لا يُحفظ سرٌّ قبل أن يُثبت أنّه يعمل.**
   *
   * سببها مباشر: توكنٌ مكسورٌ محفوظٌ في القاعدة يُنتج **بوتاً صامتاً** لا عطلاً
   * ظاهراً — القناة تقول «موصولة»، والشاشات خضراء، ولا رسالة تصل. وذاك أسوأ
   * ما يقع لعميل. فنفحص عند ميتا أوّلاً، ولا نكتب شيئاً إن فشل الفحص.
   *
   * وما يُطلب أربع قيمٍ فقط — وهي حدّ ما يحتاجه واتساب BYO:
   * معرّف الرقم · التوكن · App Secret · (اختياريّاً) معرّف WABA.
   * وتوكن التحقّق **نولّده نحن** فلا يخترعه العميل ولا نطلبه منه.
   */
  interface ConnectBody {
    phoneNumberId?: string; token?: string; appSecret?: string; wabaId?: string;
  }

  async function connect(tenantId: string, b: ConnectBody, reply: FastifyReply) {
    if (!b.phoneNumberId || !b.token || !b.appSecret) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'معرّف الرقم والتوكن وApp Secret مطلوبة — وكلّها من لوحتك عند ميتا.',
        400,
      );
    }

    /* ① الفحص عند ميتا **قبل** أيّ كتابة، وخارج أيّ معاملة. */
    const adapter = getAdapter('whatsapp_cloud');
    const report = await adapter.healthCheck({
      channelId: 'pending', tenantId, kind: 'whatsapp_cloud',
      token: b.token, externalAccountId: b.phoneNumberId,
      config: b.wabaId ? { wabaId: b.wabaId } : {},
    }).catch((e) => ({
      level: 'unreachable' as const, tokenValid: false, webhookSubscribed: null,
      qualityRating: null, messagingTier: null, issues: [(e as Error).message], detail: {},
    }));

    if (!report.tokenValid) {
      return reply.code(422).send({
        error: 'لم نحفظ شيئاً — التوكن لا يعمل.',
        issues: report.issues,
        hint: 'الأشيع أنّه توكنٌ مؤقّت عمره 24 ساعة. أنشئ توكن «مستخدم نظام» بلا انتهاء.',
      });
    }

    /* ② الكتابة بعد الإثبات. وتوكن التحقّق يبقى كما هو إن وُجد، فلا يُبطِل
          تجديدُ توكنٍ ويبهوكاً مضبوطاً عند ميتا. */
    const detail = ((report.detail as Record<string, unknown>).phone ?? {}) as Record<string, string>;
    const saved = await withTenant(getDb(), tenantId, async (tx) => {
      /* `tenants` جدولٌ عامّ خارج RLS بصلاحيّة قراءةٍ لدور التطبيق — ومنه
         `publicId` الذي يبني مسار الويبهوك. وهو ليس في مطالبات التوكن عمداً:
         التوكن يحمل ما يُصرّح به لا ما يُعرَض. */
      const t = (await tx.select({ pid: tenants.publicId }).from(tenants)
        .where(eq(tenants.id, tenantId)).limit(1))[0];
      const cur = (await tx.select().from(tenantChannels).where(and(
        eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud'),
      )).limit(1))[0];

      const sealedToken = seal(b.token!);
      const sealedSecret = seal(b.appSecret!);
      const values = {
        tenantId, kind: 'whatsapp_cloud' as const,
        externalAccountId: b.phoneNumberId!,
        displayName: [detail.verified_name, detail.display_phone_number].filter(Boolean).join(' ') || null,
        config: b.wabaId ? { wabaId: b.wabaId } : (cur?.config ?? {}),
        tokenEnc: sealedToken.enc,
        tokenFingerprint: fingerprint(b.token!),
        appSecretEnc: sealedSecret.enc,
        keyVersion: sealedToken.keyVersion,
        verifyToken: cur?.verifyToken ?? publicId().slice(0, 20),
        status: 'connected' as const,
        qualityRating: report.qualityRating,
        messagingTier: report.messagingTier,
        lastCheckedAt: new Date(),
        lastError: report.issues[0] ?? null,
        connectedAt: cur?.connectedAt ?? new Date(),
      };

      const [row] = cur
        ? await tx.update(tenantChannels).set(values).where(eq(tenantChannels.id, cur.id)).returning()
        : await tx.insert(tenantChannels).values(values).returning();
      return { ...row!, tenantPublicId: t?.pid ?? '' };
    });

    return {
      id: saved.id,
      displayName: saved.displayName,
      tokenFingerprint: saved.tokenFingerprint,
      qualityRating: saved.qualityRating,
      webhookSubscribed: report.webhookSubscribed,
      issues: report.issues,
      /* ما يلصقه العميل في ميتا — يُعاد هنا لأنّه لا يُخزَّن في مكانٍ يراه. */
      webhookUrl: `${process.env.PUBLIC_URL ?? 'https://aibot.masaros.net'}/api/webhooks/wa/${saved.tenantPublicId}`,
      verifyToken: saved.verifyToken,
    };
  }

  /** العميل يربط قناته بنفسه. */
  app.post<{ Body: ConnectBody }>(
    '/channel/connect',
    { preHandler: requireAuth({ settings: true }) },
    async (req, reply) => connect(tenantOf(req), req.body ?? {}, reply),
  );

  /**
   * ومالك المنصّة يربطها **لعميلٍ يسمّيه صراحةً** — لا بالانتحال.
   *
   * ★ الانتحال قراءةٌ فقط، وذاك قرارٌ صحيح يُصان: لو سمحنا له بالكتابة صار
   *   لدينا مسارٌ يكتب في بيانات عميلٍ بهويّةٍ مستعارة، فيصير سجلّ التدقيق
   *   كاذباً. فالمسار هنا صريحٌ ومسجَّل، والمستأجر في العنوان لا في التوكن.
   *   وُجد لأنّ معالج التهيئة يحتاجه: المالك يربط القناة أوّل مرّةٍ مع العميل
   *   على مكالمة — وهذا واقع BYO.
   */
  app.post<{ Params: { id: string }; Body: ConnectBody }>(
    '/console/tenants/:id/channel/connect',
    { preHandler: requireAuth({ console: true }) },
    async (req, reply) => {
      const out = await connect(req.params.id, req.body ?? {}, reply);
      if (reply.sent) return out;
      await withPlatform(getDb(), 'تدقيق: ربط قناةٍ لعميل من لوحة المالك', (tx) =>
        tx.insert(auditLog).values({
          tenantId: req.params.id,
          actorUserId: req.auth!.sub,
          action: 'channel.connect',
          entity: 'tenant_channel',
          entityId: (out as { id: string }).id,
          ip: req.ip,
        }));
      return out;
    },
  );

  /**
   * ★ اختبار اتّصالٍ **حقيقيّ** بميتا — لا فحصُ صفٍّ في قاعدتنا.
   *
   * وُجد لأنّ زرّ «اختبر الاتّصال» كان موجوداً في الشاشة بلا معالج. وزرٌّ لا
   * يعمل يكسر الثقة أكثر من ميزةٍ غائبة: العميل يضغط فلا يحدث شيء، فيستنتج
   * أنّ النظام معطوب — لا أنّ الميزة لم تُبنَ.
   *
   * وأهمّ ما يفحصه **اشتراك الويبهوك**، وهو السبب الأوّل لـ«البوت لا يردّ»
   * بينما كلّ شيءٍ آخر يبدو سليماً: التوكن صالح، والرقم أخضر، ولا رسالة تصل.
   *
   * النتيجة تُحفظ في `last_checked_at` و`last_error` فتظهر في الشاشة بلا نداءٍ ثانٍ.
   */
  app.post<{ Body: { channelId?: string } }>(
    '/channel/test',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const tenantId = tenantOf(req);

      const ch = await withTenant(getDb(), tenantId, async (tx) => {
        const rows = await tx.select().from(tenantChannels).where(
          req.body?.channelId
            ? and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.id, req.body.channelId))
            : eq(tenantChannels.tenantId, tenantId),
        ).limit(1);
        return rows[0];
      });

      if (!ch) return reply.code(404).send({ error: 'لا قناةٌ لهذا الحساب' });
      if (!ch.tokenEnc) {
        return reply.code(409).send({ error: 'القناة غير مربوطة بعد — لا توكن محفوظ' });
      }

      /* النداء الشبكيّ **خارج** أيّ معاملة: فحص ميتا يأخذ ثوانٍ، ومعاملةٌ
         مفتوحة أثناءه تحتجز اتّصالاً من البِركة بلا داعٍ. */
      const adapter = getAdapter(ch.kind as ChannelKind);
      let report;
      try {
        report = await adapter.healthCheck({
          channelId: ch.id,
          tenantId,
          kind: ch.kind as ChannelKind,
          token: decrypt(ch.tokenEnc, ch.keyVersion),
          externalAccountId: ch.externalAccountId ?? '',
          config: (ch.config ?? {}) as Record<string, unknown>,
        });
      } catch (e) {
        report = {
          level: 'unreachable' as const,
          tokenValid: false, webhookSubscribed: null,
          qualityRating: null, messagingTier: null,
          issues: [(e as Error).message],
          detail: {},
        };
      }

      await withTenant(getDb(), tenantId, (tx) => tx.update(tenantChannels).set({
        lastCheckedAt: new Date(),
        lastError: report.issues[0] ?? null,
        qualityRating: report.qualityRating ?? ch.qualityRating,
        messagingTier: report.messagingTier ?? ch.messagingTier,
        // `error` فقط عند عطلٍ فعليّ: `degraded` تعني تعمل بجودةٍ أقلّ لا معطوبة
        status: report.level === 'ok' || report.level === 'degraded' ? 'connected' : 'error',
      }).where(eq(tenantChannels.id, ch.id)));

      return {
        level: report.level,
        tokenValid: report.tokenValid,
        webhookSubscribed: report.webhookSubscribed,
        qualityRating: report.qualityRating,
        messagingTier: report.messagingTier,
        issues: report.issues,
        checkedAt: new Date().toISOString(),
      };
    },
  );
}
