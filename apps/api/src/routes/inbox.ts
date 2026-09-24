import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, conversations, messages, contacts, channelIdentities,
  conversationWindows, tenantChannels, eq, and, isNull, desc, lt, sql,
} from '@aibot/db';
import { AppError, ErrorCode, SendMessageBody } from '@aibot/shared';
import { requireAuth, tenantOf, PERMISSIONS } from '../auth.js';
import { applyMerge, isUuid } from './contacts.js';
import { emitToTenant } from '../realtime.js';
import { enqueueOutbound } from '../queues.js';

/**
 * الإنبوكس.
 *
 * قاعدتان تحكمان هذه المسارات:
 *  • الترقيم **بالمؤشّر** لا بالصفحات — الإنبوكس يتغيّر تحت المستخدم،
 *    فالصفحة الثانية بترقيمٍ رقميّ تُعيد ما قرأه أو تُسقط ما لم يقرأه.
 *  • `tenantId` من التوكن لا من الطلب. لا يُرسل معرّف مستأجرٍ في جسمٍ ولا مسار.
 */
export async function registerInbox(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string; needsAttention?: string; channel?: string; q?: string; cursor?: string } }>(
    '/conversations',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      const { status, needsAttention, channel, q, cursor } = req.query;

      return withTenant(getDb(), tenantId, async (tx) => {
        const where = [eq(conversations.tenantId, tenantId)];
        if (status) where.push(eq(conversations.status, status as 'open' | 'closed'));
        if (needsAttention === 'true') where.push(eq(conversations.needsAttention, true));
        if (channel) where.push(eq(tenantChannels.kind, channel as 'whatsapp_cloud' | 'instagram'));
        if (cursor) where.push(lt(conversations.lastMessageAt, new Date(cursor)));
        if (q) {
          where.push(sql`(${contacts.displayName} ilike ${'%' + q + '%'}
                       or ${channelIdentities.externalId} ilike ${'%' + q + '%'}
                       or ${conversations.lastMessagePreview} ilike ${'%' + q + '%'})`);
        }

        const rows = await tx
          .select({
            id: conversations.id,
            status: conversations.status,
            needsAttention: conversations.needsAttention,
            unreadCount: conversations.unreadCount,
            lastMessageAt: conversations.lastMessageAt,
            lastMessagePreview: conversations.lastMessagePreview,
            tags: conversations.tags,
            botEnabled: conversations.botEnabled,
            botPausedUntil: conversations.botPausedUntil,
            channelKind: tenantChannels.kind,
            contactName: contacts.displayName,
            handle: channelIdentities.externalId,
            displayHandle: channelIdentities.displayHandle,
          })
          .from(conversations)
          .innerJoin(tenantChannels, eq(tenantChannels.id, conversations.channelId))
          .innerJoin(contacts, eq(contacts.id, conversations.contactId))
          .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
          .where(and(...where))
          .orderBy(desc(conversations.lastMessageAt))
          .limit(40);

        return {
          items: rows,
          nextCursor: rows.length === 40 ? rows[rows.length - 1]!.lastMessageAt?.toISOString() ?? null : null,
        };
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    '/conversations/:id/messages',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      return withTenant(getDb(), tenantId, async (tx) => {
        const where = [eq(messages.conversationId, req.params.id), isNull(messages.deletedAt)];
        if (req.query.before) where.push(lt(messages.createdAt, new Date(req.query.before)));

        const rows = await tx.select().from(messages)
          .where(and(...where)).orderBy(desc(messages.createdAt)).limit(50);

        const win = await tx.select().from(conversationWindows).where(and(
          eq(conversationWindows.conversationId, req.params.id),
          isNull(conversationWindows.closedAt),
        )).limit(1);

        return {
          items: rows.reverse(),
          // النافذة تُعرض للموظّف **قبل** أن يكتب لا بعد أن يُرفض
          window: win[0]
            ? { expiresAt: win[0].expiresAt, open: new Date(win[0].expiresAt) > new Date(), billedAt: win[0].billedAt }
            : { expiresAt: null, open: false, billedAt: null },
        };
      });
    },
  );

  /**
   * إرسال ردّ موظّف.
   * `Idempotency-Key` إلزاميّ: ضغطتان على «إرسال» لا ترسلان رسالتين —
   * وهذا أكثر ما يحدث فعلاً على هاتفٍ بشبكةٍ بطيئة.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/conversations/:id/messages',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const tenantId = tenantOf(req);
      const key = req.headers['idempotency-key'];
      if (!key || typeof key !== 'string') {
        throw new AppError(ErrorCode.VALIDATION, 'ترويسة Idempotency-Key مطلوبة', 400);
      }
      const parsed = SendMessageBody.safeParse(req.body);
      if (!parsed.success) throw new AppError(ErrorCode.VALIDATION, 'محتوى غير صالح', 400, parsed.error.issues);

      const win = await withTenant(getDb(), tenantId, async (tx) =>
        (await tx.select().from(conversationWindows).where(and(
          eq(conversationWindows.conversationId, req.params.id),
          isNull(conversationWindows.closedAt),
        )).limit(1))[0]);

      // حارس النافذة يُفحص هنا أيضاً ليعطي خطأً مفهوماً قبل الطابور —
      // والحارس الحقيقيّ يبقى في طبقة الإرسال ولا يُتجاوز.
      if (!win || new Date(win.expiresAt) <= new Date()) {
        throw new AppError(
          ErrorCode.WINDOW_CLOSED,
          'نافذة الـ24 ساعة مغلقة. تُفتح حين يُرسل الزبون رسالة.',
          409,
        );
      }

      const message = parsed.data.text
        ? { kind: 'text' as const, body: parsed.data.text }
        : { kind: 'choices' as const, body: parsed.data.choices!.body, options: parsed.data.choices!.options };

      /* ★ الرسالة تُحجز صفّاً **قبل** الطابور بحالة `queued`.
         كان المسار يدفع المهمّة ويعيد 202، والصفُّ لا يُدرَج إلّا بعد نجاح
         الإرسال. ففشلُ الإرسال — توكنٌ باطل، نافذةٌ أُغلقت بين الفحصَين،
         رفضٌ من ميتا — يترك المحادثةَ بلا أثرٍ إطلاقاً: لا فقاعة ولا حالة ولا
         حادثة، والواجهةُ قد أعلنت «وصل ردّك». الموظّف يظنّ أنّه ردّ والزبون
         ينتظر، ولا أحد يعلم.
         والصفُّ المحجوز يُصلح الاتّجاهين: الفقاعة تظهر فوراً بحالة «قيد
         الإرسال»، وتصير `sent` أو `failed` برسالةٍ بشريّةٍ في مكانها. */
      const row = await withTenant(getDb(), tenantId, async (tx) => {
        const conv = (await tx.select({ channelId: conversations.channelId }).from(conversations)
          .where(eq(conversations.id, req.params.id)).limit(1))[0];
        if (!conv) throw new AppError(ErrorCode.VALIDATION, 'لا محادثةَ بهذا المعرّف', 404);
        const [m] = await tx.insert(messages).values({
          tenantId,
          conversationId: req.params.id,
          channelId: conv.channelId,
          direction: 'out',
          source: 'agent',
          type: message.kind === 'choices' ? 'interactive' : 'text',
          body: 'body' in message ? message.body : null,
          payload: message as object,
          status: 'queued',
          userId: req.auth!.sub,
        }).returning({ id: messages.id, createdAt: messages.createdAt });
        return m!;
      });

      /* البثّ فوراً: الفقاعة تظهر عند كلّ من يشاهد المحادثة — بما فيهم من
         أرسلها على جهازٍ آخر — قبل أن يُعرف مصيرُها. */
      emitToTenant(tenantId, 'message:new', {
        conversationId: req.params.id,
        message: {
          id: row.id,
          direction: 'out',
          source: 'agent',
          type: message.kind === 'choices' ? 'interactive' : 'text',
          body: 'body' in message ? message.body : null,
          payload: message,
          status: 'queued',
          createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
        },
      });

      await enqueueOutbound({
        tenantId,
        conversationId: req.params.id,
        source: 'agent',
        userId: req.auth!.sub,
        idempotencyKey: key,
        messageId: row.id,
        message,
      });

      return reply.code(202).send({ queued: true, messageId: row.id });
    },
  );

  /**
   * ★ إعادةُ محاولةِ رسالةٍ فشل إرسالها.
   *
   *   بلا هذا يكون «لم تصل» طريقاً مسدوداً: يكتب الموظّف الرسالة من جديد
   *   بمفتاح تكرارٍ جديد، فإن كان العطل عابراً وصلت الرسالتان معاً. وإعادةُ
   *   المحاولة على **الصفّ نفسه** تُنهي الاثنين: لا نسخةَ ثانية، والأثرُ
   *   يبقى واحداً في الحوار.
   */
  app.post<{ Params: { id: string; messageId: string } }>(
    '/conversations/:id/messages/:messageId/retry',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const tenantId = tenantOf(req);
      if (!isUuid(req.params.messageId)) {
        throw new AppError(ErrorCode.VALIDATION, 'لا رسالةَ بهذا المعرّف', 404);
      }

      const row = await withTenant(getDb(), tenantId, async (tx) => {
        const [m] = await tx.update(messages)
          .set({ status: 'queued', errorMessage: null })
          .where(and(
            eq(messages.id, req.params.messageId),
            eq(messages.conversationId, req.params.id),
            eq(messages.direction, 'out'),
            eq(messages.status, 'failed'),
          ))
          .returning({ id: messages.id, payload: messages.payload, source: messages.source });
        return m;
      });

      // صفرُ صفوفٍ لا يُبلَّغ عنه نجاحاً — ولا تُعاد رسالةٌ وصلت أصلاً
      if (!row) {
        throw new AppError(ErrorCode.VALIDATION, 'لا رسالةَ فاشلةٌ بهذا المعرّف في هذه المحادثة', 404);
      }

      emitToTenant(tenantId, 'message:status', {
        conversationId: req.params.id, id: row.id, status: 'queued', errorMessage: null,
      });

      await enqueueOutbound({
        tenantId,
        conversationId: req.params.id,
        source: row.source === 'agent' ? 'agent' : row.source === 'system' ? 'system' : 'bot',
        userId: req.auth!.sub,
        messageId: row.id,
        message: row.payload,
      });
      return reply.code(202).send({ queued: true, messageId: row.id });
    },
  );

  /**
   * ★ **صفرُ صفوفٍ لا يُبلَّغ عنه نجاحاً** — والثلاثةُ التالية كانت تفعل ذلك.
   *
   *   قِيس على الخادم الحيّ (٢٣ أيلول ٢٠٢٦): مستأجرٌ ينادي هذه النقاط بمعرّف
   *   محادثةِ مستأجرٍ آخر فتعود **٢٠٠ بجسمٍ فارغ**. RLS منعت التحديث (ولا صفٌّ
   *   عند الآخر تغيّر — مُتحقَّقٌ منه)، لكنّ `returning()` عادت فارغةً و
   *   `row` صار `undefined`، فـ:
   *    · الردُّ ٢٠٠ على فعلٍ لم يحدث — والواجهةُ تُحدِّث حالتَها على كذب.
   *    · و`emitToTenant(..., undefined)` يبثّ حدثاً بحمولةٍ فارغةٍ إلى غرفة
   *      المستأجر، فكلّ مستمعٍ يقرأ `row.id` يرمي في متصفّح مستخدمٍ آخر.
   *   والحدُّ واحدٌ في الثلاثة: لا صفَّ ⟶ ٤٠٤ قبل أيّ بثّ.
   */
  const orMissing = <T>(row: T | undefined): T => {
    if (!row) throw new AppError(ErrorCode.VALIDATION, 'لا محادثةَ بهذا المعرّف', 404);
    return row;
  };

  app.post<{ Params: { id: string }; Body: { enabled?: boolean; pauseMinutes?: number } }>(
    '/conversations/:id/bot',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      return withTenant(getDb(), tenantId, async (tx) => {
        const set: Record<string, unknown> = {};
        if (typeof req.body?.enabled === 'boolean') set.botEnabled = req.body.enabled;
        if (req.body?.pauseMinutes != null) {
          set.botPausedUntil = new Date(Date.now() + req.body.pauseMinutes * 60_000);
          set.needsAttention = false;
        }
        const row = orMissing((await tx.update(conversations).set(set)
          .where(eq(conversations.id, req.params.id)).returning())[0]);
        emitToTenant(tenantId, 'conversation:update', row);
        return row;
      });
    },
  );

  app.post<{ Params: { id: string } }>('/conversations/:id/read', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const row = orMissing((await tx.update(conversations)
        .set({ unreadCount: 0 }).where(eq(conversations.id, req.params.id)).returning())[0]);
      emitToTenant(tenantId, 'conversation:update', row);
      return row;
    });
  });

  app.post<{ Params: { id: string }; Body: { add?: string[]; remove?: string[] } }>(
    '/conversations/:id/tags',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      return withTenant(getDb(), tenantId, async (tx) => {
        const cur = orMissing((await tx.select({ tags: conversations.tags }).from(conversations)
          .where(eq(conversations.id, req.params.id)).limit(1))[0]);
        const next = new Set(cur.tags ?? []);
        for (const t of req.body?.add ?? []) next.add(t);
        for (const t of req.body?.remove ?? []) next.delete(t);
        const row = orMissing((await tx.update(conversations).set({ tags: [...next] })
          .where(eq(conversations.id, req.params.id)).returning())[0]);
        emitToTenant(tenantId, 'conversation:update', row);
        return row;
      });
    },
  );

  /**
   * ★ دمج جهتين في إنسانٍ واحد — **نقطةُ الدمج القائمة، وقد صارت لها واجهة.**
   *
   * والعقدُ محفوظٌ كما كان: نفسُ المسار، و`keepContactId` مع `mergeIdentityId`
   * (وأُضيف `mergeContactId` لأنّ الواجهة تدمج **أشخاصاً** لا مقابض). وثلاثةٌ
   * تغيّرت، كلٌّ منها لأنّ غيابه كان عطلاً:
   *  ① **المنطقُ في موضعٍ واحد** (`routes/contacts.ts` → `applyMerge`)، وهو
   *    نفسُه الذي تحسب به ورقةُ المراجعة (`/contacts/merge-preview`) — فما
   *    يُرى قبل الضغط هو ما يُنفَّذ بعده، لا نسختان تتباعدان.
   *  ② **الدمجُ على مستوى البطاقة لا المقبض.** كان يحوّل مقبضاً واحداً ثمّ
   *    يحذف البطاقة التي كانت تحمله — و`channel_identities` و`conversations`
   *    و`conversation_windows` تتسلسل من `contacts`، و`messages` من
   *    `conversations`. فبطاقةٌ لها مقبضان: يُنقل أحدهما ويُمحى الآخرُ
   *    ومحادثتُه وكلُّ رسائلها. الشرحُ كاملاً عند `applyMerge`.
   *  ③ **سطرٌ في `audit_log`** بصورةٍ تكفي للتراجع (`POST /contacts/merge-undo`)
   *    — فعلٌ يغيّر تاريخ زبونٍ لا يكون صامتاً ولا بلا رجعة.
   */
  app.post<{ Body: { keepContactId?: string; mergeIdentityId?: string; mergeContactId?: string } }>(
    '/contacts/merge',
    { preHandler: requireAuth({ settings: true }) },
    async (req) => {
      const tenantId = tenantOf(req);
      const { keepContactId, mergeIdentityId, mergeContactId } = req.body ?? {};
      if (!keepContactId || !(mergeIdentityId || mergeContactId)) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'keepContactId ومعه mergeContactId أو mergeIdentityId مطلوبان',
          400,
        );
      }
      /* معرّفٌ مشوّهٌ يصل إلى القاعدة يرجع خطأَ نوعٍ (22P02) فيُقرأ 500 —
         والمستخدم يرى «خطأ عندنا» على مدخلٍ غير صالح. فالفحص هنا. */
      for (const v of [keepContactId, mergeIdentityId, mergeContactId]) {
        if (v !== undefined && !isUuid(v)) {
          throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);
        }
      }

      return withTenant(getDb(), tenantId, async (tx) => {
        let absorbContactId = mergeContactId ?? null;
        if (!absorbContactId) {
          const ident = (await tx.select({ contactId: channelIdentities.contactId })
            .from(channelIdentities)
            .where(eq(channelIdentities.id, mergeIdentityId!)).limit(1))[0];
          if (!ident) throw new AppError(ErrorCode.VALIDATION, 'هويّةٌ غير موجودة', 404);
          absorbContactId = ident.contactId;
        }

        const { auditId, plan } = await applyMerge(tx, tenantId, {
          keepContactId,
          absorbContactId,
          actorUserId: req.auth!.sub,
          ip: req.ip,
          withCost: PERMISSIONS[req.auth!.role].billing,
        });

        return {
          ok: true,
          contactId: keepContactId,
          /* المعرّفُ يرجع إلى الواجهة لأنّه **مفتاحُ التراجع** — لا للسجلّ. */
          auditId,
          moved: {
            identities: plan.moves.identities.length,
            conversations: plan.moves.conversations.length,
            windows: plan.moves.windows,
            messages: plan.moves.messages,
          },
        };
      });
    },
  );
}
