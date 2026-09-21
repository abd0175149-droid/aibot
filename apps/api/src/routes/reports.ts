import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, conversations, conversationWindows, messages, aiRuns,
  tenantChannels, contacts, channelIdentities, botConfigs, subscriptions, plans,
  eq, and, desc, isNull, sql,
} from '@aibot/db';
import { capabilitiesFor, getAdapter, type ChannelKind } from '@aibot/channels';
import { open as decrypt } from '@aibot/crypto';
import { requireAuth, tenantOf } from '../auth.js';

/** الشهر بتوقيت المستأجر — نافذةٌ تُفتح آخر الشهر تُفوتَر على شهر فتحها. */
function period(tz = 'Asia/Amman'): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
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

      const totalConvs = Number(today?.total_convs ?? 0);
      return {
        conversationsToday: Number(today?.conversations ?? 0),
        botReplies: Number(today?.bot_replies ?? 0),
        needsAttention: Number(today?.needs_attention ?? 0),
        medianLatencyMs: Number(today?.median_latency ?? 0),
        selfResolvedRate: totalConvs ? Number(today?.self_resolved ?? 0) / totalConvs : 0,
        windowsUsed: used?.n ?? 0,
        windowsLimit: Number(lim.windows ?? 0),
        botEnabled: Boolean(cfg?.enabled),
        overagePolicy: sub?.policy ?? 'handoff_only',
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

      const billed = Number(agg?.billed ?? 0);
      return {
        period: p,
        windowsBilled: billed,
        windowsOpened: Number(agg?.opened ?? 0),
        windowsLimit: Number(lim.windows ?? 0),
        aiTokens: Number(agg?.tokens ?? 0),
        aiTokensLimit: Number(lim.aiTokens ?? 0),
        aiCostUsd: Number(agg?.cost ?? 0),
        avgRepliesPerWindow: billed ? Number(agg?.avg_replies ?? 0) / billed : 0,
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
