import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, conversations, messages, contacts, channelIdentities,
  conversationWindows, tenantChannels, eq, and, isNull, desc, lt, sql,
} from '@aibot/db';
import { AppError, ErrorCode, SendMessageBody } from '@aibot/shared';
import { requireAuth, tenantOf } from '../auth.js';
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

      await enqueueOutbound({
        tenantId,
        conversationId: req.params.id,
        source: 'agent',
        userId: req.auth!.sub,
        idempotencyKey: key,
        message: parsed.data.text
          ? { kind: 'text', body: parsed.data.text }
          : { kind: 'choices', body: parsed.data.choices!.body, options: parsed.data.choices!.options },
      });

      return reply.code(202).send({ queued: true });
    },
  );

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
        const [row] = await tx.update(conversations).set(set)
          .where(eq(conversations.id, req.params.id)).returning();
        emitToTenant(tenantId, 'conversation:update', row);
        return row;
      });
    },
  );

  app.post<{ Params: { id: string } }>('/conversations/:id/read', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const [row] = await tx.update(conversations)
        .set({ unreadCount: 0 }).where(eq(conversations.id, req.params.id)).returning();
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
        const cur = (await tx.select({ tags: conversations.tags }).from(conversations)
          .where(eq(conversations.id, req.params.id)).limit(1))[0];
        const next = new Set(cur?.tags ?? []);
        for (const t of req.body?.add ?? []) next.add(t);
        for (const t of req.body?.remove ?? []) next.delete(t);
        const [row] = await tx.update(conversations).set({ tags: [...next] })
          .where(eq(conversations.id, req.params.id)).returning();
        emitToTenant(tenantId, 'conversation:update', row);
        return row;
      });
    },
  );

  /**
   * ★ دمج هويّتين في إنسانٍ واحد.
   * زرٌّ في الواجهة لا ترحيل — وهذا بالضبط ما اشتراه جدول `channel_identities`.
   * والنوافذ تبقى منفصلة: الفوترة لكلّ قناة لا لكلّ إنسان.
   */
  app.post<{ Body: { keepContactId?: string; mergeIdentityId?: string } }>(
    '/contacts/merge',
    { preHandler: requireAuth({ settings: true }) },
    async (req) => {
      const tenantId = tenantOf(req);
      const { keepContactId, mergeIdentityId } = req.body ?? {};
      if (!keepContactId || !mergeIdentityId) {
        throw new AppError(ErrorCode.VALIDATION, 'keepContactId و mergeIdentityId مطلوبان', 400);
      }
      return withTenant(getDb(), tenantId, async (tx) => {
        const ident = (await tx.select().from(channelIdentities)
          .where(eq(channelIdentities.id, mergeIdentityId)).limit(1))[0];
        if (!ident) throw new AppError(ErrorCode.VALIDATION, 'هويّةٌ غير موجودة', 404);
        const orphan = ident.contactId;

        await tx.update(channelIdentities).set({ contactId: keepContactId })
          .where(eq(channelIdentities.id, mergeIdentityId));
        await tx.update(conversations).set({ contactId: keepContactId })
          .where(eq(conversations.identityId, mergeIdentityId));
        if (orphan !== keepContactId) {
          await tx.delete(contacts).where(eq(contacts.id, orphan));
        }
        return { ok: true, contactId: keepContactId };
      });
    },
  );
}
