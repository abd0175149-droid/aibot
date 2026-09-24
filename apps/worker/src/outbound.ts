import {
  getDb, withTenant, conversations, conversationWindows, messages, tenantChannels,
  channelIdentities, subscriptions, plans, tenants, eq, and, isNull, sql, desc,
} from '@aibot/db';
import { getAdapter, degradeChoices, canRender, type ChannelKind } from '@aibot/channels';
import { tenantBlocked, type OutboundMessage } from '@aibot/shared';
import { open as decrypt } from '@aibot/crypto';
import { emitToTenant } from './events.js';
import { announceQuotaCrossing } from './quota.js';
import { resolveOpenOfKinds } from './incidents.js';

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
  /**
   * ★ صفُّ الصادر المحجوز مسبقاً بحالة `queued` — **صندوقُ الصادر**.
   *
   *   بدونه كان الصفّ يُدرَج **بعد** نجاح الإرسال وحده، ونتج عن ذلك عطلان:
   *   ① ردُّ الموظّف يُعلَن «وصل» على 202 ثمّ يفشل الإرسال فلا يبقى له أثرٌ
   *     إطلاقاً — لا فقاعة ولا حالة ولا حادثة. الموظّف يظنّ أنّه ردّ.
   *   ② مهمّةُ ردِّ البوت غيرُ متحمّلةٍ لإعادة المحاولة: الخطّة تُودَع (نداءُ
   *     نموذجٍ مدفوع، أدواتٌ نُفِّذت، `pendingAction` مُسح) ثمّ يُرسَل. ففشلُ
   *     الإرسال يُعيد المهمّة من الصفر: نداءٌ ثانٍ مدفوع، ورسائلُ نجحت تُرسل
   *     ثانيةً، وزبونٌ نُفِّذ حجزُه يُقال له «انتهت صلاحيّة هذا الطلب».
   *
   *   والحلّ واحدٌ للعطلَين: **تُحجز نيّةُ الإرسال صفّاً قبل التسليم**، ثمّ
   *   يُحدَّث الصفّ نفسه إلى `sent` أو `failed`. فالإرسال يصير مرحلةً
   *   مستقلّةً قابلةً للاستئناف، والفشلُ يترك أثراً يراه الموظّف.
   */
  messageId?: string;
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

/**
 * ★ **حسابٌ موقوفٌ كان يُرسل إلى واتساب كأنّ شيئاً لم يكن.**
 *
 *   حالةُ المستأجر كانت مفروضةً على الويبهوك وحده: يتوقّف **استقبالُ** رسائل
 *   الزبائن، ويبقى الإرسالُ مفتوحاً. فبوتٌ نُشر قبل الإيقاف يظلّ يردّ على
 *   نوافذَ مفتوحة، وموظّفٌ يظلّ يرسل من الإنبوكس — على حساب المنصّة عند
 *   ميتا، وباسم عميلٍ أُوقف حسابُه.
 *
 *   وصنفٌ خاصٌّ لا `Error` عامّة: `safeSend` تُصنّف الأخطاء، وما يقع في
 *   الفرع العامّ يُرفَع **حادثةً حرجة** «فشل إرسال رسالة» ويُعاد المحاولة.
 *   والإيقافُ ليس فشلاً ولا يُصلحه تكرار.
 */
export class TenantBlockedError extends Error {
  readonly code = 'TENANT_SUSPENDED';
  constructor() {
    super('حساب العميل موقوفٌ — لا إرسال');
  }
}

/**
 * يُعلّم الصفَّ المحجوز فاشلاً ويبثّ الحالة — فيرى الموظّف ما لم يصل.
 * ويُبتلع خطؤه: فشلُ تعليم الفشل لا يجوز أن يُخفي الفشل الأصليّ.
 */
async function markFailed(job: SendJob, err: unknown): Promise<void> {
  if (!job.messageId) return;
  const message = err instanceof Error ? err.message.slice(0, 300) : 'تعذّر الإرسال';
  await withTenant(getDb(), job.tenantId, (tx) => tx.update(messages)
    .set({ status: 'failed', errorMessage: message })
    .where(eq(messages.id, job.messageId!))).catch(() => undefined);
  emitToTenant(job.tenantId, 'message:status', {
    conversationId: job.conversationId,
    id: job.messageId,
    status: 'failed',
    errorMessage: message,
  });
}

/**
 * ★ الغلاف: **كلُّ** طريقٍ للخروج من الإرسال يترك أثراً على الصفّ المحجوز.
 *
 *   نافذةٌ أُغلقت وسقفٌ بلغ وتوكنٌ باطل: ثلاثتها «لم تصل الرسالة» عند الموظّف،
 *   وكانت ثلاثتها تختفي بلا فقاعةٍ ولا حالة. والرسالةُ البشريّةُ تُكتب على
 *   الصفّ فيقرأها في مكانها من الحوار — لا في سجلٍّ لا يفتحه.
 */
export async function sendOutbound(job: SendJob): Promise<{ messageId: string; externalId: string }> {
  try {
    return await sendOutboundInner(job);
  } catch (e) {
    await markFailed(job, e instanceof WindowClosedError
      ? new Error('أُغلقت نافذة الردّ الحرّ قبل الإرسال — لا يصل إلّا بقالبٍ معتمد')
      : e instanceof QuotaExceededError
        ? new Error('بلغ الحساب سقف الباقة — لم تُرسَل')
        : e instanceof TenantBlockedError
          ? new Error('حسابك موقوف — لم تُرسَل. تواصل معنا لرفع الإيقاف.')
          : e);
    throw e;
  }
}

async function sendOutboundInner(job: SendJob): Promise<{ messageId: string; externalId: string }> {
  const db = getDb();

  const ctx = await withTenant(db, job.tenantId, async (tx) => {
    const rows = await tx
      .select({
        conv: conversations, ch: tenantChannels, ident: channelIdentities,
        tenantStatus: tenants.status,
      })
      .from(conversations)
      .innerJoin(tenantChannels, eq(tenantChannels.id, conversations.channelId))
      .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
      .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
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

  /* ⓪ حالةُ الحساب — قبل كلّ شيء.
     ولا استثناءَ لمصدرٍ ولا لدور: بوتٌ نُشر قبل الإيقاف، أو موظّفٌ يكتب من
     الإنبوكس، كلاهما يُرسل باسم عميلٍ أُوقف حسابُه وعلى حساب المنصّة. */
  if (tenantBlocked(ctx.tenantStatus)) throw new TenantBlockedError();

  /* ① حارس النافذة — لا التفاف، ولا استثناء لمصدرٍ ولا لدور. */
  const now = Date.now();
  if (!ctx.win || new Date(ctx.win.expiresAt).getTime() <= now) {
    throw new WindowClosedError(ctx.win ? new Date(ctx.win.expiresAt) : null);
  }

  /* ② القناة موصولة؟ */
  if (ctx.ch.status !== 'connected' || !ctx.ch.tokenEnc) {
    throw new Error('القناة غير موصولة — راجع صفحة الربط');
  }

  /* ③ السقف — يُفحص قبل الختم لا بعده.
     والقرارُ يُحفظ لا يُهمَل: هو مصدرُ «كم كان العدّاد **قبل** هذه النافذة»،
     وبه يُحسب العبور على الحافّة في ⑦. وغيابُه (نافذةٌ مختومةٌ أصلاً) يعني
     أنّ العدّاد لم يتحرّك — فلا عتبةَ تُعبَر. */
  let quota: Awaited<ReturnType<typeof checkQuota>> | null = null;
  if (!ctx.win.billedAt) {
    quota = await checkQuota(db, job.tenantId);
    if (!quota.allowed) throw new QuotaExceededError(quota.policy);
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
  const period = billingPeriod(new Date());
  const result = await withTenant(db, job.tenantId, async (tx) => {
    /* ★ صفٌّ محجوز ⟹ **تحديث** لا إدراج: الرسالة موجودةٌ في الحوار منذ لحظة
       القبول بحالة `queued`، وهنا تصير `sent` ويُختم عليها معرّفُ ميتا. */
    const [row] = job.messageId
      ? await tx.update(messages).set({
        externalId: sent.externalId,
        status: 'sent',
        channelId: ctx.ch.id,
        type: msg.kind === 'choices' ? 'interactive' : msg.kind,
        body: 'body' in msg ? msg.body : null,
        payload: msg as object,
        errorMessage: null,
      }).where(eq(messages.id, job.messageId)).returning()
      : await tx.insert(messages).values({
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

    const messageId = row?.id ?? job.messageId ?? '';

    /* ختم الفوترة: **أوّل صادرٍ داخل النافذة وحده** يختمها. */
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
        ? { botPausedUntil: new Date(Date.now() + 30 * 60_000), needsAttention: false }
        : {}),
    }).where(eq(conversations.id, job.conversationId));

    /* ★ البثّ بعد الكتابة: ردّ البوت وردّ الموظّف يظهران لحظةَ إرسالهما
       بدل انتظار تحديثٍ يدويّ. والحدث خارج ما يُرجَع لأنّ من ينتظر النتيجة
       هو الطابور لا الشاشة. */
    if (job.messageId) {
      /* أُعلنت الرسالة عند القبول، فالخبرُ الآن **تبدُّلُ حالةٍ** لا ظهورُ
         فقاعةٍ ثانية — وبثُّ `message:new` عليها يُنتج نسخةً مكرّرةً في الشاشة. */
      emitToTenant(job.tenantId, 'message:status', {
        conversationId: job.conversationId,
        id: messageId,
        status: 'sent',
        errorMessage: null,
      });
    } else emitToTenant(job.tenantId, 'message:new', {
      conversationId: job.conversationId,
      message: {
        id: messageId,
        direction: 'out',
        source: job.source === 'bot' ? 'bot' : job.source === 'agent' ? 'agent' : 'system',
        type: msg.kind === 'choices' ? 'interactive' : msg.kind,
        body: 'body' in msg ? msg.body : null,
        /* ★ الحمولةُ المبثوثة **مبنيّةٌ صراحةً** لا نيّةُ الإرسال كما هي.
           كانت `payload: msg` — أي كائنُ `OutboundMessage` بحقوله الخاصّة
           بالإرسال (`kind`، `url`، `lat`…) — والشاشةُ تقرأ منه `options`
           وحدها. فما يُبثّ غيرُ ما يُقرأ، وكلُّ حقلٍ يُضاف للإرسال يعبر
           إلى الشاشة بلا أن يعرف أحد. والعقدُ المنمَّط أظهر ذلك. */
        payload: msg.kind === 'choices' ? { options: msg.options } : null,
        status: 'sent',
        createdAt: new Date().toISOString(),
      },
    });
    emitToTenant(job.tenantId, 'conversation:update', { id: job.conversationId });

    return { messageId, externalId: sent.externalId };
  });

  /* ★ إرسالٌ نجح ⟹ ما كان مفتوحاً عن الإرسال يُغلق.
     `send_failed` كانت في `AUTO_RESOLVABLE` بلا مُنادٍ، و`send_failure_rate`
     و`no_reply` لم تكونا فيها أصلاً — فثلاثةُ أنواعٍ حرجة تُرفع ولا تُحلّ
     أبداً. والدليل على أنّ العطل زال هو نفسه الذي تنتظره: رسالةٌ خرجت.
     وفشلُ الحلّ لا يُسقط إرسالاً تمّ. */
  await resolveOpenOfKinds(job.tenantId, ['send_failed', 'send_failure_rate', 'no_reply', 'quota_exceeded'])
    .catch(() => 0);

  /* ⑦ إنذارُ السقف — **بعد الإيداع**، وبعد أن صار العدّاد `quota.used + 1`.
     هنا وحده يُعرف أنّ نافذةً جديدة فُوتِرت فعلاً: الختم في ⑥ هو الحدث الذي
     يحرّك العدّاد، وقبله كلُّ حسابٍ تخمين.

     ⚠️ وخارج المعاملة قصداً: الإنذار يدفع Web Push عبر الشبكة، ومعاملةٌ مفتوحة
        أثناء ذلك تحتجز اتّصالاً لثوانٍ — وهو الدرس الذي جمّد عامل الردّ.

     وفشلُ الإنذار لا يُسقط رسالةً أُرسلت أصلاً: الزبون استلمها، والنافذة
     مختومة. فيُسجَّل ويُمضى — وإلّا أعادت BullMQ إرسال الرسالة نفسها. */
  if (quota) {
    /* ★ العدّادُ **يُقرأ من القاعدة بعد الإيداع** لا يُحسب `used + 1`.
       السبب سباقٌ حقيقيّ: نافذتان تُختمان في نفس اللحظة تقرآن العدّاد نفسه في
       ③ (78 مثلاً)، فتحسب كلٌّ منهما 79 — والحقيقةُ 80. فتُفلت عتبةُ الثمانين
       بلا إنذارٍ أصلاً، وهو العطل الذي يُصلحه هذا الملفّ كلُّه.
       وقراءةُ ما بعد الإيداع تشمل نافذةَ الشريك، فيغطّي مدى أحدِهما العتبةَ
       قطعاً — والحجزُ الفريد يضمن أن يُنذر واحدٌ لا اثنان. */
    const post = await checkQuota(db, job.tenantId).catch(() => null);
    await announceQuotaCrossing({
      tenantId: job.tenantId,
      before: quota.used,
      after: Math.max(post?.used ?? 0, quota.used + 1),
      limit: post?.limit ?? quota.limit,
      policy: post?.policy ?? quota.policy,
      period,
    }).catch((e) => {
      console.error(JSON.stringify({
        level: 'error', svc: 'worker', msg: 'فشل إنذارُ عتبةِ السقف',
        tenantId: job.tenantId, err: String(e),
      }));
    });
  }

  return result;
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
