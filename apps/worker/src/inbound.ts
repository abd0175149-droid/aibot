import {
  getDb, withTenant, contacts, channelIdentities, conversations, messages,
  conversationWindows, tenantChannels, eq, and, isNull, sql,
} from '@aibot/db';
import { capabilitiesFor, type ChannelKind, type ParsedWebhook } from '@aibot/channels';

export interface InboundJob {
  tenantId: string;
  channelId: string;
  kind: ChannelKind;
  parsed: ParsedWebhook;
}

/**
 * معالجة الوارد.
 *
 * كلّ خطوةٍ هنا idempotent عمداً: ميتا تُعيد إرسال الحمولة نفسها عند أيّ
 * تأخّرٍ في الردّ، والمهمّة نفسها قد تُعاد ثلاث مرّات. فالقيد الفريد
 * `(channel_id, external_id)` هو ما يجعل التكرار بلا أثر — لا فحصٌ في الكود.
 */
export async function handleInbound(job: InboundJob): Promise<void> {
  const db = getDb();
  const caps = capabilitiesFor(job.kind);

  await withTenant(db, job.tenantId, async (tx) => {
    for (const m of job.parsed.messages) {
      /* ① الهويّة: (قناة، معرّف خارجيّ) — لا الهاتف.
         هذا ما يجعل IGSID مواطناً من الدرجة الأولى بلا ترحيلٍ لاحق. */
      const identity = await upsertIdentity(tx, job, m.from, m.fromHandle, caps.identityKind);

      /* ② المحادثة: واحدةٌ لكلّ هويّة — أي لكلّ قناة. */
      const conv = await upsertConversation(tx, job, identity);

      /* ③ الرسالة: التكرار يسقط على القيد الفريد بلا رمي. */
      const inserted = await tx
        .insert(messages)
        .values({
          tenantId: job.tenantId,
          conversationId: conv.id,
          channelId: job.channelId,
          externalId: m.externalId,
          direction: 'in',
          source: 'customer',
          type: m.type,
          body: m.text,
          payload: { buttonPayload: m.buttonPayload, mediaId: m.mediaId },
          channelPayload: m.raw as object,
          createdAt: m.at,
        })
        .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
        .returning({ id: messages.id });

      if (inserted.length === 0) continue; // مكرَّرة — لا نافذة تُمدَّد ولا ردّ يُجدوَل

      /* ④ النافذة: تُفتح أو تُمدَّد. ولا تُختم هنا —
         الختم عند أوّل صادرٍ داخلها، فرسالةٌ بلا ردٍّ لا تُفوتَر. */
      await openOrExtendWindow(tx, job, conv.id, identity.contactId, caps.windowHours);

      await tx
        .update(conversations)
        .set({
          lastInboundAt: m.at,
          lastMessageAt: m.at,
          lastMessagePreview: (m.text ?? `[${m.type}]`).slice(0, 160),
          unreadCount: sql`${conversations.unreadCount} + 1`,
        })
        .where(eq(conversations.id, conv.id));

      /* ⑤ جدولة الردّ بتأخيرٍ ومعرّفٍ ثابت — دمج الرسائل المتتالية. */
      const { enqueueReply } = await import('./enqueue.js');
      await enqueueReply(conv.id);
    }

    for (const s of job.parsed.statuses) {
      await tx
        .update(messages)
        .set({ status: s.status, errorCode: s.errorCode, errorMessage: s.errorMessage })
        .where(and(eq(messages.channelId, job.channelId), eq(messages.externalId, s.externalId)));
    }
  });

  /* ⑥ أحداث الحساب (جودة الرقم، مراجعة WABA) خارج معاملة المستأجر —
     تُنتج حوادث لا رسائل. تُنفَّذ في المرحلة الخامسة. */
}

async function upsertIdentity(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  job: InboundJob,
  externalId: string,
  handle: string | null,
  identityKind: 'phone' | 'scoped_id',
) {
  const found = await tx
    .select()
    .from(channelIdentities)
    .where(and(
      eq(channelIdentities.channelId, job.channelId),
      eq(channelIdentities.externalId, externalId),
    ))
    .limit(1);
  if (found[0]) return found[0];

  // إنسانٌ جديد. الهاتف يُملأ فقط حين تكون هويّة القناة هاتفاً أصلاً —
  // وإلّا بقي فارغاً حتّى يربطه العميل يدويّاً بهويّةٍ أخرى.
  const [contact] = await tx
    .insert(contacts)
    .values({
      tenantId: job.tenantId,
      phone: identityKind === 'phone' ? externalId : null,
      displayName: handle,
    })
    .returning();

  const [identity] = await tx
    .insert(channelIdentities)
    .values({
      tenantId: job.tenantId,
      channelId: job.channelId,
      contactId: contact!.id,
      externalId,
      displayHandle: handle,
    })
    .onConflictDoNothing({
      target: [channelIdentities.tenantId, channelIdentities.channelId, channelIdentities.externalId],
    })
    .returning();

  if (identity) return identity;
  const again = await tx
    .select()
    .from(channelIdentities)
    .where(and(
      eq(channelIdentities.channelId, job.channelId),
      eq(channelIdentities.externalId, externalId),
    ))
    .limit(1);
  return again[0]!;
}

async function upsertConversation(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  job: InboundJob,
  identity: { id: string; contactId: string },
) {
  const found = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.identityId, identity.id))
    .limit(1);
  if (found[0]) return found[0];

  const [created] = await tx
    .insert(conversations)
    .values({
      tenantId: job.tenantId,
      channelId: job.channelId,
      contactId: identity.contactId,
      identityId: identity.id,
    })
    .onConflictDoNothing({ target: [conversations.tenantId, conversations.identityId] })
    .returning();
  if (created) return created;

  const again = await tx
    .select().from(conversations).where(eq(conversations.identityId, identity.id)).limit(1);
  return again[0]!;
}

/**
 * النافذة.
 * التمديد **لا يفتح نافذةً جديدة** — التعريف زمنيّ لا سلوكيّ: محادثةٌ تُغلق
 * وتُفتح خلال الـ24 ساعة تبقى نافذةً واحدة. والقيد الفريد الجزئيّ في القاعدة
 * (`closed_at IS NULL`) هو ما يضمن ذلك عند تدفّقٍ متزامن، لا هذا الكود.
 */
async function openOrExtendWindow(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  job: InboundJob,
  conversationId: string,
  contactId: string,
  windowHours: number,
) {
  const open = await tx
    .select()
    .from(conversationWindows)
    .where(and(
      eq(conversationWindows.conversationId, conversationId),
      isNull(conversationWindows.closedAt),
    ))
    .limit(1);

  const expires = sql`now() + ${`${windowHours} hours`}::interval`;

  if (open[0]) {
    await tx
      .update(conversationWindows)
      .set({ expiresAt: expires as never, messagesIn: sql`${conversationWindows.messagesIn} + 1` })
      .where(eq(conversationWindows.id, open[0].id));
    return;
  }

  await tx
    .insert(conversationWindows)
    .values({
      tenantId: job.tenantId,
      conversationId,
      channelId: job.channelId,
      contactId,
      expiresAt: expires as never,
      messagesIn: 1,
    })
    .onConflictDoNothing();
}
