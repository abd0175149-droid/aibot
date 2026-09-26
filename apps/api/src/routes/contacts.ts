import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, contacts, channelIdentities, conversations, conversationWindows,
  optouts, auditLog, tenantChannels, sql, eq, and, type Tx,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { emitToTenant } from '../realtime.js';
import { requireAuth, tenantOf, PERMISSIONS } from '../auth.js';
import { NAME_KEY, TAIL, likePattern, nameMatch, phoneTail } from '../search.js';


/** سقفُ أزواج الترشيح: اقتراحٌ يُراجَع بالعين، لا تقريرٌ لا ينتهي. */
const PAIRS = 60;

/* ★ #84: كان هذا الملفُّ ١٢٠٠ سطراً لخمسة مسارات. القرارُ الخالص في
   `../contacts-core.ts`، والاستعلاماتُ في `../contacts-query.ts`، والدمجُ
   وتراجعُه في `../contacts-merge.ts` — وهنا المساراتُ وحدها. والأسماءُ التي
   تختبرها `test/contacts.test.ts` تُعاد من هنا فلا يتبدّل عنوانُها. */
export {
  foldContacts, undoPatch, encodeCursor, decodeCursor,
  type ContactCore, type FoldNote,
} from '../contacts-core.js';
export { applyMerge, undoMerge, type MergePlan } from '../contacts-merge.js';
export type { ContactSummary } from '../contacts-query.js';
import { encodeCursor, decodeCursor } from '../contacts-core.js';
import { summaries, dupPairsFor, dupIds, dupPairs, iso, PAGE, type ContactSummary } from '../contacts-query.js';
import { planMerge, applyMerge, undoMerge, type MergePlan } from '../contacts-merge.js';

/**
 * ★ تسويةُ الاسم والرقم ومحارفُ البدل — **من `search.ts` لا هنا.**
 *
 *   كانت مكتوبةً في هذا الملفّ وحده، فوُصلت إلى اقتراح المكرّرين ولم تصل
 *   بحثَ القائمة في هذه الشاشة ولا بحثَ الإنبوكس إطلاقاً: شيفرةٌ صحيحةٌ
 *   موصولةٌ إلى المكان الخطأ. وموضعُها الآن واحدٌ تقرؤه الشاشتان.
 */
export { nameKey, phoneTail } from '../search.js';

/* ═══════════════════ المسارات ═══════════════════ */

export async function registerContacts(app: FastifyInstance) {
  /**
   * القائمة — بحثٌ وترقيمٌ بالمؤشّر.
   *
   * و`dup` مرشِّحٌ **على الخادم** لا على الصفحة المحمَّلة: مرشِّحٌ يعمل على
   * ما وصل فقط يكذب عند أوّل «المزيد».
   */
  app.get<{ Querystring: { q?: string; cursor?: string; filter?: string } }>(
    '/contacts',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      const withCost = PERMISSIONS[req.auth!.role].billing;
      const cursor = decodeCursor(req.query.cursor);
      const q = (req.query.q ?? '').trim().slice(0, 80);

      return withTenant(getDb(), tenantId, async (tx) => {
        /* «مكرّرٌ محتمل» مرشِّحٌ على **كلّ** القاعدة لا على الصفحة المحمَّلة:
           مرشِّحٌ يعمل على ما وصل وحده يكذب عند أوّل «المزيد». */
        const ids = req.query.filter === 'dup' ? await dupIds(tx, tenantId) : undefined;
        const items = await summaries(tx, tenantId, {
          ids,
          q: q || undefined,
          cursor,
          filter: req.query.filter,
          limit: PAGE + 1,
          withCost,
        });
        const page = items.slice(0, PAGE);
        const [tot] = await tx.execute(sql`
          select count(*)::int as "n" from contacts c where c.tenant_id = ${tenantId}
        `) as unknown as Array<Record<string, unknown>>;

        return {
          items: page,
          /* المؤشّرُ من آخر صفٍّ **معروض** لا من آخر صفٍّ مقروء — والحدّ زائدٌ
             بواحدٍ ليُعرف وجودُ التالي بلا عدٍّ ثانٍ. */
          nextCursor: items.length > PAGE && page.length
            ? encodeCursor(page[page.length - 1]!.lastSeenAt, page[page.length - 1]!.id)
            : null,
          total: Number(tot?.n ?? 0),
        };
      });
    },
  );

  /**
   * ★ المرشَّحون — ومنهم يُبنى الرقمُ البطوليّ في الشاشة.
   *
   * و`records` هو الجواب على «كم شخصاً مكرّراً على الأرجح في قاعدتك؟»:
   * عددُ **البطاقات الزائدة** (الطرفُ الثاني من كلّ زوج) لا عددُ الأزواج —
   * فثلاثُ بطاقاتٍ لشخصٍ واحدٍ تعطي ثلاثةَ أزواجٍ وبطاقتَين زائدتَين فقط.
   */
  app.get('/contacts/duplicates', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    const withCost = PERMISSIONS[req.auth!.role].billing;

    return withTenant(getDb(), tenantId, async (tx) => {
      const pairs = await tx.execute(sql`
        select p.a::text as "a", p.b::text as "b", p.why as "why", p.score::float as "score"
          from ${dupPairs(tenantId)} p
         order by p.score desc, p.a, p.b
         limit ${PAIRS}
      `) as unknown as Array<Record<string, unknown>>;

      const ids = [...new Set(pairs.flatMap((p) => [String(p.a), String(p.b)]))];
      const people = await summaries(tx, tenantId, { ids, withCost, limit: ids.length || 1 });
      const by = new Map(people.map((p) => [p.id, p]));

      const [tot] = await tx.execute(sql`
        select count(*)::int as "n" from contacts c where c.tenant_id = ${tenantId}
      `) as unknown as Array<Record<string, unknown>>;

      const items = pairs
        .map((p) => {
          const a = by.get(String(p.a));
          const b = by.get(String(p.b));
          if (!a || !b) return null;
          return {
            why: String(p.why),
            score: Number(p.score ?? 0),
            /* الاقتراحُ يقول أيّ بطاقةٍ تبقى: الأغنى تاريخاً، ثمّ الأقدم.
               وهو **اقتراحٌ يُقلب بضغطة** في ورقة المراجعة لا قرارٌ مفروض. */
            suggestKeep: pickKeep(a, b),
            a,
            b,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return {
        items,
        records: new Set(items.map((p) => (p.suggestKeep === p.a.id ? p.b.id : p.a.id))).size,
        total: Number(tot?.n ?? 0),
      };
    });
  });

  /**
   * ورقةُ المراجعة — **ما سيتحرّك بالاسم**.
   * وهي شرطُ القيد ①: لا دمجَ قبل أن يُرى ما الذي سيُدمج ومع ماذا.
   */
  app.get<{ Querystring: { keep?: string; absorb?: string } }>(
    '/contacts/merge-preview',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      const withCost = PERMISSIONS[req.auth!.role].billing;
      const keep = req.query.keep ?? '';
      const absorb = req.query.absorb ?? '';
      if (!isUuid(keep) || !isUuid(absorb)) {
        throw new AppError(ErrorCode.VALIDATION, 'keep و absorb مطلوبان', 400);
      }
      return withTenant(getDb(), tenantId, async (tx) => {
        const plan = await planMerge(tx, tenantId, keep, absorb, withCost);
        return {
          keep: plan.keep,
          absorb: plan.absorb,
          moves: plan.moves,
          fields: plan.fields,
          optout: plan.optout,
          /* التراجعُ ممكنٌ — والواجهةُ تقول ذلك نصّاً، ولا تقوله إلّا من هنا. */
          reversible: true,
        };
      });
    },
  );

  /** ملفُّ جهةٍ واحدة: مقابضُها · محادثاتُها · فوترتُها · مرشَّحوها · وسجلُّ دمجها. */
  app.get<{ Params: { id: string } }>(
    '/contacts/:id',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      const withCost = PERMISSIONS[req.auth!.role].billing;
      const id = req.params.id;
      if (!isUuid(id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);

      return withTenant(getDb(), tenantId, async (tx) => {
        const [contact] = await summaries(tx, tenantId, { ids: [id], withCost, limit: 1 });
        if (!contact) throw new AppError(ErrorCode.VALIDATION, 'لا جهةَ بهذا المعرّف', 404);

        const identities = await tx.execute(sql`
          select i.id::text as "id", i.external_id as "externalId", i.display_handle as "displayHandle",
                 i.first_seen_at as "firstSeenAt", ch.kind as "channelKind",
                 ch.display_name as "channelName", v.id::text as "conversationId"
            from channel_identities i
            join tenant_channels ch on ch.id = i.channel_id
            left join conversations v on v.identity_id = i.id
           where i.contact_id = ${id}::uuid
           order by i.first_seen_at asc
        `) as unknown as Array<Record<string, unknown>>;

        const convs = await tx.execute(sql`
          select v.id::text as "id", ch.kind as "channelKind", i.external_id as "handle",
                 v.status as "status", v.needs_attention as "needsAttention",
                 v.unread_count as "unreadCount", v.last_message_at as "lastMessageAt",
                 v.last_message_preview as "preview", v.tags as "tags",
                 (select count(*)::int from messages m
                   where m.conversation_id = v.id and m.deleted_at is null) as "messages"
            from conversations v
            join tenant_channels ch on ch.id = v.channel_id
            join channel_identities i on i.id = v.identity_id
           where v.contact_id = ${id}::uuid
           order by v.last_message_at desc nulls last
        `) as unknown as Array<Record<string, unknown>>;

        const [win] = await tx.execute(sql`
          select count(*)::int as "opened", count(w.billed_at)::int as "billed",
                 ${withCost
                   ? sql`coalesce(sum(w.ai_cost_usd), 0)::text`
                   : sql`null::text`} as "aiCostUsd"
            from conversation_windows w where w.contact_id = ${id}::uuid
        `) as unknown as Array<Record<string, unknown>>;

        /* سجلُّ ما جرى على هذه البطاقة — ومنه زرُّ التراجع. و`undoable` تُحسب
           في القاعدة: تراجعٌ وقع مرّةً لا يُعرض مرّةً ثانية. */
        const history = await tx.execute(sql`
          select a.id::text as "id", a.action as "action", a.created_at as "at",
                 a.diff->>'label' as "label", u.name as "actor",
                 (a.action = 'contact.merge' and not exists (
                    select 1 from audit_log b
                     where b.action = 'contact.merge_undo' and b.diff->>'ofAuditId' = a.id::text
                  )) as "undoable"
            from audit_log a
            left join users u on u.id = a.actor_user_id
           where a.entity = 'contact' and a.entity_id = ${id}
             and a.action like 'contact.%'
           order by a.created_at desc
           limit 20
        `) as unknown as Array<Record<string, unknown>>;

        const pairs = await tx.execute(sql`
          select p.a::text as "a", p.b::text as "b", p.why as "why", p.score::float as "score"
            from ${dupPairsFor(tenantId, id)} p
           order by p.score desc
           limit 10
        `) as unknown as Array<Record<string, unknown>>;

        const otherIds = pairs.map((p) => (String(p.a) === id ? String(p.b) : String(p.a)));
        const others = await summaries(tx, tenantId, {
          ids: otherIds, withCost, limit: otherIds.length || 1,
        });
        const byId = new Map(others.map((o) => [o.id, o]));

        return {
          contact,
          identities: identities.map((r) => ({
            id: String(r.id),
            externalId: String(r.externalId),
            displayHandle: (r.displayHandle as string | null) ?? null,
            channelKind: String(r.channelKind),
            channelName: (r.channelName as string | null) ?? null,
            firstSeenAt: iso(r.firstSeenAt),
            conversationId: (r.conversationId as string | null) ?? null,
          })),
          conversations: convs.map((r) => ({
            id: String(r.id),
            channelKind: String(r.channelKind),
            handle: String(r.handle),
            status: String(r.status),
            needsAttention: Boolean(r.needsAttention),
            unreadCount: Number(r.unreadCount ?? 0),
            lastMessageAt: iso(r.lastMessageAt),
            preview: (r.preview as string | null) ?? null,
            tags: (r.tags as string[] | null) ?? [],
            messages: Number(r.messages ?? 0),
          })),
          windows: {
            opened: Number(win?.opened ?? 0),
            billed: Number(win?.billed ?? 0),
            aiCostUsd: (win?.aiCostUsd as string | null) ?? null,
          },
          history: history.map((r) => ({
            id: String(r.id),
            action: String(r.action),
            at: iso(r.at),
            label: (r.label as string | null) ?? null,
            actor: (r.actor as string | null) ?? null,
            undoable: Boolean(r.undoable),
          })),
          candidates: pairs
            .map((p) => {
              const other = byId.get(String(p.a) === id ? String(p.b) : String(p.a));
              if (!other) return null;
              return {
                why: String(p.why),
                score: Number(p.score ?? 0),
                suggestKeep: pickKeep(contact, other),
                other,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
        };
      });
    },
  );

  /**
   * ★ التراجع عن دمج — فعلٌ كاتب، فصلاحيّتُه صلاحيّةُ الدمج نفسها.
   *   (والانتحال قراءةٌ فقط: `requireAuth` يرفضه قبل الوصول هنا.)
   */
  /**
   * ★★★ **الحجبُ والعدول — زرّان كانا موعودَين في صفحة الخصوصيّة ولا وجودَ لهما.**
   *
   *   المالكُ لم يملك طريقاً لحجب رقمٍ مزعج ولا لتسجيل عدولٍ إلّا حيلةَ الدمج.
   *   والحقلان في المخطَّط منذ اليوم الأوّل. وهذه الأفعالُ الأربعة تكتبهما،
   *   ويقرؤهما الواردُ والردُّ والإرسال (`inbound.ts` · `reply.ts` · `outbound.ts`).
   *
   *   · **العدول** (`optout`/`optin`) قرارُ **الزبون** يُسجّله الموظّفُ نيابةً — ولذلك
   *     صفُّ `optouts` بسبب، وتُلغيه العودةُ.
   *   · **الحجب** (`block`/`unblock`) قرارُ **المالك** — لا يُلغيه زبونٌ بكلمة «اشترك».
   *
   * ⚠️ وكلُّ فعلٍ صفٌّ في `audit_log`: «مَن أسكت هذا الرقم ومتى» سؤالٌ يُطرح بعد
   *    شهرٍ حين يشكو الزبونُ أنّه لا يصله شيء.
   */
  const CONTACT_FLAG_ACTIONS = {
    block:   { patch: () => ({ blockedAt: new Date() }),  action: 'contact.block',   msg: 'حُجب الرقم — لن يخرج إليه شيء' },
    unblock: { patch: () => ({ blockedAt: null }),        action: 'contact.unblock', msg: 'رُفع الحجب' },
    optout:  { patch: () => ({ optedOutAt: new Date() }), action: 'contact.optout',  msg: 'سُجّل العدول — لن يخرج إليه شيء' },
    optin:   { patch: () => ({ optedOutAt: null }),       action: 'contact.optin',   msg: 'أُعيد الاشتراك' },
  } as const;
  type FlagAction = keyof typeof CONTACT_FLAG_ACTIONS;

  app.post<{ Params: { id: string; action: string } }>(
    '/contacts/:id/:action',
    /* أيُّ مستخدمِ مستأجرٍ مصادَق: الأدوارُ الثلاثة تملك `write` في
       `PERMISSIONS`، والموظّفُ هو من يقرأ «توقف» في الإنبوكس ويسجّله. */
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      const id = req.params.id;
      if (!isUuid(id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);
      /* المعاملُ نصٌّ حرٌّ في وقت التشغيل مهما قال النوع — يُقيَّد صراحةً. */
      if (!(req.params.action in CONTACT_FLAG_ACTIONS)) {
        throw new AppError(ErrorCode.VALIDATION, 'فعلٌ غيرُ معروف', 400);
      }
      const act = CONTACT_FLAG_ACTIONS[req.params.action as FlagAction];

      const out = await withTenant(getDb(), tenantId, async (tx) => {
        const [before] = await tx
          .select({ id: contacts.id, optedOutAt: contacts.optedOutAt, blockedAt: contacts.blockedAt })
          .from(contacts).where(eq(contacts.id, id)).limit(1);
        if (!before) throw new AppError(ErrorCode.VALIDATION, 'لا جهةَ بهذا المعرّف', 404);

        await tx.update(contacts).set(act.patch()).where(eq(contacts.id, id));

        if (req.params.action === 'optout') {
          await tx.insert(optouts)
            .values({ tenantId, contactId: id, reason: 'سجّله موظّفٌ من بطاقة الجهة' })
            .onConflictDoNothing();
        } else if (req.params.action === 'optin') {
          await tx.delete(optouts).where(eq(optouts.contactId, id));
        }

        await tx.insert(auditLog).values({
          tenantId,
          actorUserId: req.auth!.sub,
          action: act.action,
          entity: 'contact',
          entityId: id,
          diff: { was: { optedOutAt: before.optedOutAt, blockedAt: before.blockedAt } },
          ip: req.ip ?? null,
        });

        const [after] = await tx
          .select({ optedOutAt: contacts.optedOutAt, blockedAt: contacts.blockedAt })
          .from(contacts).where(eq(contacts.id, id)).limit(1);
        return after!;
      });

      /* بثٌّ **بعد** الإيداع، ولكلّ محادثةٍ للجهة: الإنبوكسُ المفتوح يرى
         الحالةَ تتبدّل بلا تحديث. */
      const convs = await withTenant(getDb(), tenantId, (tx) =>
        tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, id)));
      for (const c of convs) emitToTenant(tenantId, 'conversation:update', { id: c.id });

      return { ok: true, message: act.msg, ...out };
    },
  );

  app.post<{ Body: { auditId?: string } }>(
    '/contacts/merge-undo',
    { preHandler: requireAuth({ settings: true }) },
    async (req) => {
      const tenantId = tenantOf(req);
      const auditId = req.body?.auditId ?? '';
      if (!isUuid(auditId)) {
        throw new AppError(ErrorCode.VALIDATION, 'auditId مطلوب', 400);
      }
      return withTenant(getDb(), tenantId, (tx) => undoMerge(tx, tenantId, {
        auditId, actorUserId: req.auth!.sub, ip: req.ip,
      }));
    },
  );
}

/**
 * أيُّ بطاقةٍ تبقى: **الأغنى تاريخاً** (محادثاتٌ ثمّ مقابض)، ثمّ الأقدمُ ظهوراً.
 * والغنى أوّلاً لأنّ التراجعَ يسهل على ما لم يُحرَّك كثيراً، ولأنّ البطاقة
 * التي عليها محادثاتٌ هي التي يعرفها الموظّف في الإنبوكس.
 */
function pickKeep(a: ContactSummary, b: ContactSummary): string {
  if (a.conversations !== b.conversations) return a.conversations > b.conversations ? a.id : b.id;
  if (a.identities !== b.identities) return a.identities > b.identities ? a.id : b.id;
  return Date.parse(a.firstSeenAt) <= Date.parse(b.firstSeenAt) ? a.id : b.id;
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
