import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, contacts, channelIdentities, conversations, messages, conversationWindows,
  optouts, botVersions, auditLog, eq, sql, asc, desc, inArray,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { requireAuth, tenantOf } from '../auth.js';
import { emitToTenant } from '../realtime.js';

/**
 * ★★★ **ثلاثةُ وعودٍ في صفحة الخصوصيّة المنشورة لم يكن لها مسارٌ واحد.**
 *
 *   «يستطيع صاحب النشاط حذف أيّ جهة اتّصال وكلّ بياناتها بزرٍّ واحد» · «وعند
 *   انتهاء العلاقة: تصديرٌ كامل يُرسل إليه، ثمّ حذفٌ بعد 60 يوماً» · «للاطّلاع على
 *   بياناتك … راسل النشاط التجاريّ». وثلاثتُها تحتاج مساراتٍ لم تُكتب: لا حذفَ
 *   جهةٍ في الـAPI كلِّه، ولا تصديرَ لجهةٍ ولا لحساب. (المحوُ بعد ستّين يوماً في
 *   `worker/retention.ts`.)
 *
 * ⚠️ الحذفُ **نهائيٌّ يتعاقب**: الجهةُ ← هويّاتُها ومحادثاتُها ← رسائلُها ونوافذُها
 *    وعدولُها. ونوافذُ الفوترة تسقط معها فيتراجع عدّادُ الشهر — وهذا مقصودٌ لا
 *    عيب: الوعدُ «كلّ بياناتها». فيُكتب الأثرُ **أعداداً** في `audit_log` قبل
 *    المحو (رسائل · محادثات · نوافذ مفوترة · كلفة) ليبقى للفوترة ما يُطابَق به.
 *
 * ⚠️ ولصاحب الإعدادات وحده: موظّفٌ يحذف زبوناً بكلّ تاريخه ليس قراراً يُترك
 *    لكلّ من يملك توكناً.
 */
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** سقفُ رسائلِ تصدير الحساب في ردٍّ واحد — وما فوقه يُقال صراحةً لا يُقطع بصمت. */
const EXPORT_MESSAGE_CAP = 50_000;

export async function registerPrivacy(app: FastifyInstance) {
  const owner = requireAuth({ settings: true });

  /** ① تصديرُ جهةٍ واحدة — ما تعرفه المنصّة عن هذا الإنسان، برسائله. */
  app.get<{ Params: { id: string } }>('/contacts/:id/export', { preHandler: owner }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const id = req.params.id;
    if (!UUID_RE.test(id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);

    const bundle = await withTenant(getDb(), tenantId, async (tx) => {
      const [c] = await tx.select().from(contacts).where(eq(contacts.id, id)).limit(1);
      if (!c) throw new AppError(ErrorCode.VALIDATION, 'لا جهةَ بهذا المعرّف', 404);
      const identities = await tx.select({
        id: channelIdentities.id, channelId: channelIdentities.channelId,
        externalId: channelIdentities.externalId, displayHandle: channelIdentities.displayHandle,
      }).from(channelIdentities).where(eq(channelIdentities.contactId, id));
      const convs = await tx.select({
        id: conversations.id, channelId: conversations.channelId, status: conversations.status,
        tags: conversations.tags, createdAt: conversations.createdAt, lastMessageAt: conversations.lastMessageAt,
      }).from(conversations).where(eq(conversations.contactId, id));
      const convIds = convs.map((x) => x.id);
      const msgs = convIds.length
        ? await tx.select({
          id: messages.id, conversationId: messages.conversationId, direction: messages.direction,
          source: messages.source, type: messages.type, body: messages.body, status: messages.status,
          createdAt: messages.createdAt,
        }).from(messages).where(inArray(messages.conversationId, convIds)).orderBy(asc(messages.createdAt))
        : [];
      const outs = await tx.select({ reason: optouts.reason, createdAt: optouts.createdAt })
        .from(optouts).where(eq(optouts.contactId, id));

      await tx.insert(auditLog).values({
        tenantId, actorUserId: req.auth!.sub,
        action: 'contact.export', entity: 'contact', entityId: id, ip: req.ip,
        diff: { conversations: convs.length, messages: msgs.length },
      });

      return {
        exportedAt: new Date().toISOString(),
        contact: c,
        identities,
        optouts: outs,
        conversations: convs.map((cv) => ({ ...cv, messages: msgs.filter((m) => m.conversationId === cv.id) })),
      };
    });

    return reply
      .header('content-disposition', `attachment; filename="contact-${id}.json"`)
      .header('content-type', 'application/json; charset=utf-8')
      .send(JSON.stringify(bundle, null, 2));
  });

  /** ② حذفُ جهةٍ وكلِّ بياناتها — بزرٍّ واحد، نهائيّاً، وبأثرٍ عدديٍّ في السجلّ. */
  app.delete<{ Params: { id: string } }>('/contacts/:id', { preHandler: owner }, async (req) => {
    const tenantId = tenantOf(req);
    const id = req.params.id;
    if (!UUID_RE.test(id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);

    const out = await withTenant(getDb(), tenantId, async (tx) => {
      const [c] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).limit(1);
      if (!c) throw new AppError(ErrorCode.VALIDATION, 'لا جهةَ بهذا المعرّف', 404);

      const convs = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, id));
      const convIds = convs.map((x) => x.id);
      const [m] = convIds.length
        ? await tx.select({ n: sql<number>`count(*)::int` }).from(messages).where(inArray(messages.conversationId, convIds))
        : [{ n: 0 }];
      const [w] = await tx.select({
        n: sql<number>`count(*) filter (where ${conversationWindows.billedAt} is not null)::int`,
        cost: sql<string>`coalesce(sum(${conversationWindows.aiCostUsd}), 0)::text`,
      }).from(conversationWindows).where(eq(conversationWindows.contactId, id));

      /* الأثرُ **قبل** المحو وفي نفس المعاملة: لو فشل الحذفُ تراجع السطرُ معه. */
      await tx.insert(auditLog).values({
        tenantId, actorUserId: req.auth!.sub,
        action: 'contact.delete', entity: 'contact', entityId: id, ip: req.ip,
        diff: { conversations: convIds.length, messages: m?.n ?? 0, windowsBilled: w?.n ?? 0, aiCostUsd: w?.cost ?? '0' },
      });

      /* `.returning()` ثمّ ٤٠٤: حذفٌ يُصيب صفرَ صفوفٍ (سياقٌ خاطئ) لا يُعلن نجاحاً. */
      const gone = await tx.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id });
      if (!gone.length) throw new AppError(ErrorCode.VALIDATION, 'لا جهةَ بهذا المعرّف', 404);

      return { conversationIds: convIds, messages: m?.n ?? 0, windowsBilled: w?.n ?? 0 };
    });

    /* البثُّ **بعد** الإيداع: الإنبوكسُ المفتوح يُسقط صفوفَها بدل أن يعرض صفّاً يردّ ٤٠٤. */
    for (const cid of out.conversationIds) emitToTenant(tenantId, 'conversation:removed', { id: cid });

    return {
      ok: true,
      message: `حُذفت الجهةُ نهائيّاً — ومعها ${out.conversationIds.length} محادثة و${out.messages} رسالة.`,
      conversations: out.conversationIds.length,
      messages: out.messages,
      windowsBilled: out.windowsBilled,
    };
  });

  /** ③ تصديرُ الحساب كاملاً — الوعدُ عند إنهاء العلاقة، ومتاحٌ في أيّ وقت. */
  app.get('/export', { preHandler: owner }, async (req, reply) => {
    const tenantId = tenantOf(req);

    const bundle = await withTenant(getDb(), tenantId, async (tx) => {
      const cs = await tx.select().from(contacts).orderBy(asc(contacts.firstSeenAt));
      const identities = await tx.select({
        id: channelIdentities.id, contactId: channelIdentities.contactId, channelId: channelIdentities.channelId,
        externalId: channelIdentities.externalId, displayHandle: channelIdentities.displayHandle,
      }).from(channelIdentities);
      const convs = await tx.select({
        id: conversations.id, contactId: conversations.contactId, channelId: conversations.channelId,
        status: conversations.status, tags: conversations.tags,
        createdAt: conversations.createdAt, lastMessageAt: conversations.lastMessageAt,
      }).from(conversations);
      const msgs = await tx.select({
        id: messages.id, conversationId: messages.conversationId, direction: messages.direction,
        source: messages.source, type: messages.type, body: messages.body, status: messages.status,
        createdAt: messages.createdAt,
      }).from(messages).orderBy(asc(messages.createdAt)).limit(EXPORT_MESSAGE_CAP + 1);
      const truncated = msgs.length > EXPORT_MESSAGE_CAP;
      const outs = await tx.select({ contactId: optouts.contactId, reason: optouts.reason, createdAt: optouts.createdAt })
        .from(optouts);
      const [bot] = await tx.select({
        version: botVersions.version, persona: botVersions.persona,
        knowledgeBase: botVersions.knowledgeBase, publishedAt: botVersions.publishedAt,
      }).from(botVersions).orderBy(desc(botVersions.version)).limit(1);

      await tx.insert(auditLog).values({
        tenantId, actorUserId: req.auth!.sub,
        action: 'tenant.export', entity: 'tenant', entityId: tenantId, ip: req.ip,
        diff: { contacts: cs.length, conversations: convs.length, messages: Math.min(msgs.length, EXPORT_MESSAGE_CAP), truncated },
      });

      return {
        exportedAt: new Date().toISOString(),
        truncated,
        note: truncated
          ? `الرسائلُ مقطوعةٌ عند ${EXPORT_MESSAGE_CAP} — اطلب من الدعم تصديراً مجزّأً لما بعدها.`
          : null,
        contacts: cs,
        identities,
        conversations: convs,
        messages: msgs.slice(0, EXPORT_MESSAGE_CAP),
        optouts: outs,
        bot: bot ?? null,
      };
    });

    return reply
      .header('content-disposition', `attachment; filename="aibot-export-${tenantId}.json"`)
      .header('content-type', 'application/json; charset=utf-8')
      .send(JSON.stringify(bundle));
  });
}
