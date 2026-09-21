import {
  getDb, withTenant, conversations, conversationWindows, messages, tenantChannels,
  channelIdentities, subscriptions, plans, eq, and, isNull, sql, desc,
} from '@aibot/db';
import { getAdapter, degradeChoices, canRender, type ChannelKind } from '@aibot/channels';
import type { OutboundMessage } from '@aibot/shared';
import { open as decrypt } from '@aibot/crypto';

/**
 * ★ طبقة الإرسال — ولا مسار آخر إلى Graph API في هذا النظام.
 *
 * هنا يعيش **حارس النافذة**. ليس قاعدةً في دليل الموظّف ولا شرطاً في الواجهة:
 * شرطٌ في الكود على المسار الوحيد الذي يخرج منه أيّ حرفٍ إلى الزبون.
 * هذا وحده ما يمنع تكرار كارثة 31 تمّوز.
 *
 * وهنا أيضاً **تُختم النافذة للفوترة**: عند أوّل صادرٍ داخلها لا عند وصول
 * الوارد — فرسالةٌ مزعجة لا يردّ عليها أحدٌ لا تكلّف العميل شيئاً.
 */

export type SendSource = 'bot' | 'agent' | 'system';

export interface SendJob {
  tenantId: string;
  conversationId: string;
  message: OutboundMessage;
  source: SendSource;
  userId?: string;
  aiRunId?: string;
  /** مفتاح تكرار: ضغطتان على «إرسال» لا ترسلان رسالتين. */
  idempotencyKey?: string;
}

export class WindowClosedError extends Error {
  readonly code = 'WINDOW_CLOSED';
  constructor(public readonly expiredAt: Date | null) {
    super('نافذة الـ24 ساعة مغلقة — لا يمكن الإرسال حتّى يُرسل الزبون رسالة');
  }
}

export class QuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED';
  constructor(public readonly policy: string) {
    super('بلغ الحساب سقف نوافذ الباقة');
  }
}

export async function sendOutbound(job: SendJob): Promise<{ messageId: string; externalId: string }> {
  const db = getDb();

  const ctx = await withTenant(db, job.tenantId, async (tx) => {
    const rows = await tx
      .select({ conv: conversations, ch: tenantChannels, ident: channelIdentities })
      .from(conversations)
      .innerJoin(tenantChannels, eq(tenantChannels.id, conversations.channelId))
      .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
      .where(eq(conversations.id, job.conversationId))
      .limit(1);
    if (!rows[0]) throw new Error('محادثةٌ غير موجودة');

    const win = await tx
      .select()
      .from(conversationWindows)
      .where(and(
        eq(conversationWindows.conversationId, job.conversationId),
        isNull(conversationWindows.closedAt),
      ))
      .limit(1);

    return { ...rows[0], win: win[0] ?? null };
  });

  /* ① حارس النافذة — لا التفاف، ولا استثناء لمصدرٍ ولا لدور. */
  const now = Date.now();
  if (!ctx.win || new Date(ctx.win.expiresAt).getTime() <= now) {
    throw new WindowClosedError(ctx.win ? new Date(ctx.win.expiresAt) : null);
  }

  /* ② القناة موصولة؟ */
  if (ctx.ch.status !== 'connected' || !ctx.ch.tokenEnc) {
    throw new Error('القناة غير موصولة — راجع صفحة الربط');
  }

  /* ③ السقف — يُفحص قبل الختم لا بعده. */
  if (!ctx.win.billedAt) {
    const decision = await checkQuota(db, job.tenantId);
    if (!decision.allowed) throw new QuotaExceededError(decision.policy);
  }

  /* ④ تصيير النيّة إلى ما تفهمه القناة. */
  const adapter = getAdapter(ctx.ch.kind as ChannelKind);
  const caps = adapter.capabilities;
  let msg = job.message;
  if (!canRender(caps, msg.kind)) {
    if (msg.kind === 'choices') msg = degradeChoices(msg, caps);
    else throw new Error(`القناة ${ctx.ch.kind} لا تدعم ${msg.kind}`);
  }
  if (msg.kind === 'text' && msg.body.length > caps.maxTextLen) {
    msg = { kind: 'text', body: msg.body.slice(0, caps.maxTextLen) };
  }

  /* ⑤ الإرسال — التوكن يُفكّ في الذاكرة وقت الاستعمال فقط. */
  const token = decrypt(ctx.ch.tokenEnc, ctx.ch.keyVersion);
  const sent = await adapter.send(
    {
      channelId: ctx.ch.id,
      tenantId: job.tenantId,
      kind: ctx.ch.kind as ChannelKind,
      token,
      externalAccountId: ctx.ch.externalAccountId ?? '',
      config: (ctx.ch.config ?? {}) as Record<string, unknown>,
    },
    ctx.ident.externalId,
    msg,
  );

  /* ⑥ التخزين والختم — في معاملةٍ واحدة. */
  return withTenant(db, job.tenantId, async (tx) => {
    const [row] = await tx.insert(messages).values({
      tenantId: job.tenantId,
      conversationId: job.conversationId,
      channelId: ctx.ch.id,
      externalId: sent.externalId,
      direction: 'out',
      source: job.source === 'bot' ? 'bot' : job.source === 'agent' ? 'agent' : 'system',
      type: msg.kind === 'choices' ? 'interactive' : msg.kind,
      body: 'body' in msg ? msg.body : null,
      payload: msg as object,
      status: 'sent',
      userId: job.userId ?? null,
      aiRunId: job.aiRunId ?? null,
    }).onConflictDoNothing({ target: [messages.channelId, messages.externalId] }).returning();

    const messageId = row?.id ?? '';

    /* ختم الفوترة: **أوّل صادرٍ داخل النافذة وحده** يختمها. */
    const period = billingPeriod(new Date());
    await tx.update(conversationWindows).set({
      messagesOut: sql`${conversationWindows.messagesOut} + 1`,
      botReplies: job.source === 'bot'
        ? sql`${conversationWindows.botReplies} + 1`
        : conversationWindows.botReplies,
      billedAt: ctx.win!.billedAt ?? sql`now()`,
      billingPeriod: ctx.win!.billingPeriod ?? period,
      firstOutboundMessageId: ctx.win!.firstOutboundMessageId ?? messageId,
    }).where(eq(conversationWindows.id, ctx.win!.id));

    await tx.update(conversations).set({
      lastMessageAt: new Date(),
      lastMessagePreview: ('body' in msg ? msg.body : `[${msg.kind}]`).slice(0, 160),
      // ردّ الموظّف يُسكت البوت تلقائيّاً وينزع شارة الانتباه — بلا أن يضغط شيئاً.
      ...(job.source === 'agent'
        ? { botPausedUntil: sql`now() + interval '30 minutes'` as never, needsAttention: false }
        : {}),
    }).where(eq(conversations.id, job.conversationId));

    return { messageId, externalId: sent.externalId };
  });
}

/**
 * فحص السقف.
 * ⟵ تُحتسب النوافذ **المختومة** في الشهر الحاليّ، لا المفتوحة.
 *    فنافذةٌ فُتحت ولم يردّ عليها أحدٌ لا تدخل الحساب أصلاً.
 */
export async function checkQuota(
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<{ allowed: boolean; used: number; limit: number; policy: string }> {
  return withTenant(db, tenantId, async (tx) => {
    const sub = await tx
      .select({ limits: plans.limits, override: subscriptions.limitsOverride, policy: plans.overagePolicy })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
      .orderBy(desc(subscriptions.periodEnd))
      .limit(1);

    if (!sub[0]) return { allowed: true, used: 0, limit: Infinity, policy: 'handoff_only' };

    const limits = { ...(sub[0].limits as Record<string, number>), ...(sub[0].override as Record<string, number> ?? {}) };
    const limit = Number(limits.windows ?? Infinity);
    const period = billingPeriod(new Date());

    const counted = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(conversationWindows)
      .where(and(
        eq(conversationWindows.billingPeriod, period),
        sql`${conversationWindows.billedAt} is not null`,
      ));
    const used = counted[0]?.n ?? 0;
    const policy = sub[0].policy as string;

    // allow_bill يستمرّ ويُسجَّل التجاوز؛ block و handoff_only يوقفان البوت.
    return { allowed: used < limit || policy === 'allow_bill', used, limit, policy };
  });
}

/** الشهر بتوقيت المستأجر — نافذةٌ تُفتح آخر الشهر تُفوتَر على شهر فتحها فقط. */
export function billingPeriod(d: Date, timeZone = 'Asia/Amman'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}
