/**
 * ★ **دمجُ جهتَي اتّصال والتراجعُ عنه — الكتابةُ التي لا رجعةَ فيها.**
 *
 *   `planMerge` يصف ما سيحدث، و`applyMerge` ينفّذه في معاملةٍ واحدةٍ مع صورةٍ
 *   في `audit_log` تكفي للتراجع، و`undoMerge` يقرؤها ويعكسها. القرارُ الخالص
 *   («أيُّ قيمةٍ تبقى») في `contacts-core.ts`، والقراءاتُ في `contacts-query.ts`.
 *   (كانت الثلاثةُ ومساراتُها في ملفٍّ واحدٍ من ١٢٠٠ سطر — #84.)
 */
import {
  getDb, withTenant, contacts, channelIdentities, conversations, conversationWindows,
  optouts, auditLog, tenantChannels, sql, eq, and, type Tx,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { type ContactCore, type FoldNote, foldContacts, undoPatch } from './contacts-core.js';
import { type ContactSummary, summaries, iso } from './contacts-query.js';

export interface MergePlan {
  keep: ContactSummary;
  absorb: ContactSummary;
  moves: {
    identities: Array<{ id: string; externalId: string; displayHandle: string | null; channelKind: string; channelName: string | null }>;
    conversations: Array<{ id: string; channelKind: string; handle: string; messages: number; lastMessageAt: string | null; status: string }>;
    windows: number;
    messages: number;
  };
  fields: FoldNote[];
  /** عدولٌ عن الاشتراك على البطاقة المُدمَجة — يُرفع صريحاً لأنّه أخطرُ ما يُنقل. */
  optout: boolean;
}

/**
 * خطّةُ الدمج — **نفسُ الحساب** الذي تقرؤه المراجعة والذي ينفّذه الفعل.
 *
 * ★ ولا نسختان: لو حسبت المراجعةُ شيئاً ونفّذ الفعلُ غيرَه لصار «رأيتُ ما
 *   سيحدث» كذبةً مؤدَّبة. فالمعاينةُ تعرض هذه البنية، والتنفيذُ يبنيها ثمّ
 *   يطبّقها في نفس المعاملة.
 */
export async function planMerge(
  tx: Tx, tenantId: string, keepId: string, absorbId: string, withCost: boolean,
): Promise<MergePlan & { keepRow: typeof contacts.$inferSelect; absorbRow: typeof contacts.$inferSelect }> {
  if (keepId === absorbId) {
    throw new AppError(ErrorCode.VALIDATION, 'لا تُدمج بطاقةٌ في نفسها', 400);
  }
  const rows = await tx.select().from(contacts)
    .where(sql`${contacts.id} in (${keepId}::uuid, ${absorbId}::uuid)`);
  const keepRow = rows.find((r) => r.id === keepId);
  const absorbRow = rows.find((r) => r.id === absorbId);
  if (!keepRow || !absorbRow) {
    throw new AppError(ErrorCode.VALIDATION, 'إحدى البطاقتين غير موجودة', 404);
  }

  const idents = await tx
    .select({
      id: channelIdentities.id,
      externalId: channelIdentities.externalId,
      displayHandle: channelIdentities.displayHandle,
      channelKind: tenantChannels.kind,
      channelName: tenantChannels.displayName,
    })
    .from(channelIdentities)
    .innerJoin(tenantChannels, eq(tenantChannels.id, channelIdentities.channelId))
    .where(eq(channelIdentities.contactId, absorbId));

  const convRows = await tx.execute(sql`
    select v.id::text as "id", ch.kind as "channelKind", i.external_id as "handle",
           v.status as "status", v.last_message_at as "lastMessageAt",
           (select count(*)::int from messages m
             where m.conversation_id = v.id and m.deleted_at is null) as "messages"
      from conversations v
      join tenant_channels ch on ch.id = v.channel_id
      join channel_identities i on i.id = v.identity_id
     where v.contact_id = ${absorbId}::uuid
     order by v.last_message_at desc nulls last
  `) as unknown as Array<Record<string, unknown>>;

  const [counts] = await tx.execute(sql`
    select
      (select count(*)::int from conversation_windows w where w.contact_id = ${absorbId}::uuid) as "windows",
      (select count(*)::int from messages m join conversations v on v.id = m.conversation_id
        where v.contact_id = ${absorbId}::uuid and m.deleted_at is null) as "messages"
  `) as unknown as Array<Record<string, unknown>>;

  const both = await summaries(tx, tenantId, { ids: [keepId, absorbId], withCost, limit: 2 });
  const keep = both.find((s) => s.id === keepId)!;
  const absorb = both.find((s) => s.id === absorbId)!;
  const { notes } = foldContacts(coreOf(keepRow), coreOf(absorbRow));

  return {
    keep,
    absorb,
    keepRow,
    absorbRow,
    fields: notes,
    optout: Boolean(absorbRow.optedOutAt),
    moves: {
      identities: idents.map((i) => ({
        id: i.id,
        externalId: i.externalId,
        displayHandle: i.displayHandle,
        channelKind: String(i.channelKind),
        channelName: (i.channelName as string | null) ?? null,
      })),
      conversations: convRows.map((r) => ({
        id: String(r.id),
        channelKind: String(r.channelKind),
        handle: String(r.handle),
        messages: Number(r.messages ?? 0),
        lastMessageAt: iso(r.lastMessageAt),
        status: String(r.status),
      })),
      windows: Number(counts?.windows ?? 0),
      messages: Number(counts?.messages ?? 0),
    },
  };
}

function coreOf(r: typeof contacts.$inferSelect): ContactCore {
  return {
    phone: r.phone,
    displayName: r.displayName,
    attributes: (r.attributes ?? {}) as Record<string, unknown>,
    tags: r.tags ?? [],
    optedOutAt: iso(r.optedOutAt),
    blockedAt: iso(r.blockedAt),
    firstSeenAt: iso(r.firstSeenAt)!,
    lastSeenAt: iso(r.lastSeenAt)!,
  };
}

/** يعيد رقعةَ الحقول إلى شكل الأعمدة — التواريخ نصوصٌ في الحساب وكائناتٌ في القاعدة. */
function patchToDb(patch: Partial<ContactCore>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('phone' in patch) out.phone = patch.phone ?? null;
  if ('displayName' in patch) out.displayName = patch.displayName ?? null;
  if ('attributes' in patch) out.attributes = patch.attributes ?? {};
  if ('tags' in patch) out.tags = patch.tags ?? [];
  if ('optedOutAt' in patch) out.optedOutAt = patch.optedOutAt ? new Date(patch.optedOutAt) : null;
  if ('blockedAt' in patch) out.blockedAt = patch.blockedAt ? new Date(patch.blockedAt) : null;
  if ('firstSeenAt' in patch && patch.firstSeenAt) out.firstSeenAt = new Date(patch.firstSeenAt);
  if ('lastSeenAt' in patch && patch.lastSeenAt) out.lastSeenAt = new Date(patch.lastSeenAt);
  return out;
}

/**
 * ★ تنفيذُ الدمج — ويُستدعى من نقطة الدمج القائمة في `routes/inbox.ts`.
 *
 * والترتيبُ ليس ذوقاً: **كلُّ ما يتسلسل يُحوَّل قبل الحذف**. وما ينقله:
 *  · المقابض (`channel_identities`) — وهي ما يجعل الرسالة القادمة تصل للإنسان الصحيح.
 *  · المحادثات (`conversations`) — فتبقى **كلتا المحادثتين مرئيّةً** تحت
 *    البطاقة الموحَّدة، ولا تُدمجان في خيطٍ واحد: هما محادثتان عند ميتا،
 *    ونافذةُ كلٍّ منهما تُفوتَر وحدها.
 *  · نوافذُ الفوترة (`conversation_windows`) — سجلٌّ ماليٌّ لا يُمحى بدمج.
 *  · صفُّ العدول (`optouts`) إن لم يكن للباقية صفٌّ — والحالةُ نفسها محفوظةٌ
 *    في العمود على أيّ حال (`foldContacts`: الأسبقُ يفوز).
 *
 * ثمّ يُسجَّل السطرُ في `audit_log` بصورةٍ **كاملة** — لا خبراً بأنّ الدمج
 * وقع، بل ما يكفي لإعادة الحال: قيمُ البطاقة الباقية قبلَه وبعدَه، والصفُّ
 * المحذوف كلُّه، ومعرّفاتُ كلّ ما تحرّك.
 */
export async function applyMerge(tx: Tx, tenantId: string, o: {
  keepContactId: string;
  absorbContactId: string;
  actorUserId: string;
  ip?: string;
  withCost: boolean;
}): Promise<{ auditId: string; plan: MergePlan }> {
  const plan = await planMerge(tx, tenantId, o.keepContactId, o.absorbContactId, o.withCost);
  const { keepRow, absorbRow } = plan;

  const before = coreOf(keepRow);
  const { patch } = foldContacts(before, coreOf(absorbRow));

  await tx.update(channelIdentities).set({ contactId: keepRow.id })
    .where(eq(channelIdentities.contactId, absorbRow.id));
  await tx.update(conversations).set({ contactId: keepRow.id })
    .where(eq(conversations.contactId, absorbRow.id));
  /* معرّفاتُ النوافذ تُقرأ **قبل** نقلها: السجلُّ يحمل ما تحرّك بعينه، فيُعيده
     التراجعُ بلا استنتاجٍ من محادثةٍ ربّما تحرّكت مرّةً أخرى بعده. */
  const winRows = await tx.select({ id: conversationWindows.id }).from(conversationWindows)
    .where(eq(conversationWindows.contactId, absorbRow.id));
  await tx.update(conversationWindows).set({ contactId: keepRow.id })
    .where(eq(conversationWindows.contactId, absorbRow.id));

  const keepOut = await tx.select({ id: optouts.id }).from(optouts)
    .where(eq(optouts.contactId, keepRow.id)).limit(1);
  const absorbOut = await tx.select({ id: optouts.id }).from(optouts)
    .where(eq(optouts.contactId, absorbRow.id)).limit(1);
  const movedOptout = Boolean(absorbOut[0] && !keepOut[0]);
  if (movedOptout) {
    await tx.update(optouts).set({ contactId: keepRow.id })
      .where(eq(optouts.contactId, absorbRow.id));
  }

  if (Object.keys(patch).length) {
    await tx.update(contacts).set(patchToDb(patch)).where(eq(contacts.id, keepRow.id));
  }

  /* الحذفُ آخرُ خطوة، وقد صار بلا تسلسلٍ يفقد شيئاً: لا مقبضَ ولا محادثةَ
     ولا نافذةَ تشير إلى الصفّ المحذوف. */
  await tx.delete(contacts).where(eq(contacts.id, absorbRow.id));

  const diff = {
    v: 1,
    keep: { id: keepRow.id, before, after: { ...before, ...patch } },
    absorbed: { id: absorbRow.id, core: coreOf(absorbRow) },
    moved: {
      identities: plan.moves.identities.map((i) => i.id),
      conversations: plan.moves.conversations.map((c) => c.id),
      windows: winRows.map((w) => w.id),
      optout: movedOptout,
    },
    counts: {
      identities: plan.moves.identities.length,
      conversations: plan.moves.conversations.length,
      windows: plan.moves.windows,
      messages: plan.moves.messages,
    },
    /* ما يُقرأ في السجلّ بعد سنةٍ بلا فكِّ jsonb بالعين.
       ★ والسهمُ `←` لا `→`: الواجهةُ عربيّةٌ RTL، والسهمُ **لا يُقلب** بقواعد
       الاتّجاه (ليس من محارف المرآة) — فسهمٌ يمينيٌّ في سطرٍ يُقرأ من اليمين
       يقول عكسَ ما جرى: أنّ الباقية دُمجت في الزائلة. */
    label: `${plan.absorb.displayName ?? plan.absorb.phone ?? absorbRow.id} ← ${plan.keep.displayName ?? plan.keep.phone ?? keepRow.id}`,
  };

  const [row] = await tx.insert(auditLog).values({
    tenantId,
    actorUserId: o.actorUserId,
    action: 'contact.merge',
    entity: 'contact',
    entityId: keepRow.id,
    diff,
    ip: o.ip ?? null,
  }).returning({ id: auditLog.id });

  return { auditId: row!.id, plan };
}

/**
 * ★ التراجع — وهو ما يجعل الدمج قراراً لا قفزة.
 *
 * ويُعيد **ما نقله الدمج** لا ما يشبهه: المقابض والمحادثات ونوافذُ الفوترة
 * تُعاد بمعرّفاتها المسجَّلة، وبشرطِ أن تكون **ما زالت** على البطاقة الباقية.
 * فلو نقلها دمجٌ ثانٍ إلى ثالثةٍ لم يسحبها هذا التراجعُ من تحته.
 *
 * وما لا يُعاد يُقال صريحاً في الرسالة: **الرسائلُ التي وصلت بعد الدمج تبقى
 * مع محادثتها** — وهذا صوابٌ لا نقص: المحادثةُ تعود إلى بطاقتها ومعها كلُّ
 * تاريخها.
 */
export async function undoMerge(tx: Tx, tenantId: string, o: {
  auditId: string;
  actorUserId: string;
  ip?: string;
}): Promise<{ restoredContactId: string; keepContactId: string; moved: { identities: number; conversations: number; windows: number }; skipped: string[] }> {
  const [entry] = await tx.select().from(auditLog).where(and(
    eq(auditLog.id, o.auditId),
    eq(auditLog.action, 'contact.merge'),
  )).limit(1);
  if (!entry) throw new AppError(ErrorCode.VALIDATION, 'لا سجلَّ دمجٍ بهذا المعرّف', 404);

  const done = await tx.execute(sql`
    select 1 from audit_log a
     where a.action = 'contact.merge_undo' and a.diff->>'ofAuditId' = ${o.auditId}
     limit 1
  `) as unknown as Array<Record<string, unknown>>;
  if (done.length) {
    throw new AppError(ErrorCode.VALIDATION, 'تراجَعتَ عن هذا الدمج سابقاً', 409);
  }

  const d = (entry.diff ?? {}) as {
    keep?: { id?: string; before?: Partial<ContactCore>; after?: Partial<ContactCore> };
    absorbed?: { id?: string; core?: ContactCore };
    moved?: { identities?: string[]; conversations?: string[]; windows?: string[]; optout?: boolean };
  };
  const keepId = d.keep?.id;
  const absorbedId = d.absorbed?.id;
  const core = d.absorbed?.core;
  if (!keepId || !absorbedId || !core) {
    throw new AppError(ErrorCode.VALIDATION, 'سجلُّ الدمج أقدمُ من التراجع ولا يحمل صورةً كاملة', 409);
  }

  const exists = await tx.select({ id: contacts.id }).from(contacts)
    .where(eq(contacts.id, absorbedId)).limit(1);
  if (exists[0]) {
    throw new AppError(ErrorCode.VALIDATION, 'البطاقة المُدمَجة موجودةٌ أصلاً — لا شيء يُستعاد', 409);
  }
  const [keepNow] = await tx.select().from(contacts).where(eq(contacts.id, keepId)).limit(1);
  if (!keepNow) {
    throw new AppError(ErrorCode.VALIDATION, 'البطاقة الباقية حُذفت بعد الدمج — لا تراجع', 409);
  }

  await tx.insert(contacts).values({
    id: absorbedId,
    tenantId,
    phone: core.phone ?? null,
    displayName: core.displayName ?? null,
    attributes: core.attributes ?? {},
    tags: core.tags ?? [],
    optedOutAt: core.optedOutAt ? new Date(core.optedOutAt) : null,
    blockedAt: core.blockedAt ? new Date(core.blockedAt) : null,
    firstSeenAt: new Date(core.firstSeenAt),
    lastSeenAt: new Date(core.lastSeenAt),
  });

  const identIds = d.moved?.identities ?? [];
  const convIds = d.moved?.conversations ?? [];
  const winIds = d.moved?.windows ?? [];

  let identities = 0;
  if (identIds.length) {
    const back = await tx.update(channelIdentities).set({ contactId: absorbedId })
      .where(and(
        sql`${channelIdentities.id} in (${sql.join(identIds.map((i) => sql`${i}::uuid`), sql`, `)})`,
        eq(channelIdentities.contactId, keepId),
      )).returning({ id: channelIdentities.id });
    identities = back.length;
  }

  let conversationsBack = 0;
  if (convIds.length) {
    const back = await tx.update(conversations).set({ contactId: absorbedId })
      .where(and(
        sql`${conversations.id} in (${sql.join(convIds.map((i) => sql`${i}::uuid`), sql`, `)})`,
        eq(conversations.contactId, keepId),
      )).returning({ id: conversations.id });
    conversationsBack = back.length;
  }

  let windowsBack = 0;
  if (winIds.length) {
    const wins = await tx.update(conversationWindows).set({ contactId: absorbedId })
      .where(and(
        sql`${conversationWindows.id} in (${sql.join(winIds.map((i) => sql`${i}::uuid`), sql`, `)})`,
        eq(conversationWindows.contactId, keepId),
      )).returning({ id: conversationWindows.id });
    windowsBack = wins.length;
  }

  if (d.moved?.optout) {
    await tx.update(optouts).set({ contactId: absorbedId })
      .where(eq(optouts.contactId, keepId));
  }

  const { patch, skipped } = undoPatch(d.keep?.before ?? {}, d.keep?.after ?? {}, coreOf(keepNow));
  if (Object.keys(patch).length) {
    await tx.update(contacts).set(patchToDb(patch)).where(eq(contacts.id, keepId));
  }

  await tx.insert(auditLog).values({
    tenantId,
    actorUserId: o.actorUserId,
    action: 'contact.merge_undo',
    entity: 'contact',
    entityId: keepId,
    diff: {
      v: 1,
      ofAuditId: o.auditId,
      restored: absorbedId,
      moved: { identities, conversations: conversationsBack, windows: windowsBack },
      /* حقولٌ لم تُستعَد لأنّ أحداً غيّرها بعد الدمج — تُسجَّل فلا يُسأل عنها لاحقاً */
      skipped,
    },
    ip: o.ip ?? null,
  });

  return {
    restoredContactId: absorbedId,
    keepContactId: keepId,
    moved: { identities, conversations: conversationsBack, windows: windowsBack },
    skipped: skipped.map(String),
  };
}
