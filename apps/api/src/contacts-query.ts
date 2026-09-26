/**
 * ★ **استعلاماتُ جهات الاتّصال — الملخّصاتُ والمكرّرون.**
 *
 *   بُناةُ SQL التي تقرؤها القائمةُ والورقةُ وشاشةُ المكرّرين. لا مساراتَ هنا
 *   ولا قرارَ دمج: هذه تصف **ما يُقرأ**، والقرارُ في `contacts-core.ts`،
 *   والكتابةُ في `contacts-merge.ts`. (كانت الثلاثةُ في ملفٍّ واحد — #84.)
 */
import {
  getDb, withTenant, contacts, channelIdentities, conversations, conversationWindows,
  optouts, auditLog, tenantChannels, sql, eq, and, type Tx,
} from '@aibot/db';
import { NAME_KEY, TAIL, likePattern, nameMatch, phoneTail } from './search.js';
import { decodeCursor, encodeCursor } from './contacts-core.js';

/** حجمُ الصفحة — تقرؤه القائمةُ وتضبط به الاستعلامُ `limit`. */
export const PAGE = 40;

type Frag = ReturnType<typeof sql>;

export interface ContactSummary {
  id: string;
  displayName: string | null;
  phone: string | null;
  tags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastMessageAt: string | null;
  optedOutAt: string | null;
  blockedAt: string | null;
  conversations: number;
  identities: number;
  kinds: string[];
  windowsBilled: number;
  /** كلفةُ الذكاء — `null` لمن لا يرى الفوترة. الرقمُ لا يُعرض لمن لا يملكه. */
  aiCostUsd: string | null;
}

/**
 * ملخّصُ الجهة — **استعلامٌ واحدٌ** تخدمه القائمةُ والملفُّ والمرشَّحون.
 *
 * ★ ولماذا واحد: ثلاثةُ استعلاماتٍ لنفس الملخّص تعني ثلاثةَ تعريفاتٍ لـ«عدد
 *   المحادثات» تتباعد بعد شهر. والرقمُ الذي يُقرأ في القائمة يجب أن يكون
 *   نفسَه في الملفّ وفي ورقة المراجعة، وإلّا فقد القارئُ الثقةَ في كليهما.
 */
export async function summaries(tx: Tx, tenantId: string, o: {
  ids?: string[];
  q?: string;
  cursor?: { ts: string; id: string } | null;
  filter?: string;
  limit?: number;
  withCost: boolean;
}): Promise<ContactSummary[]> {
  const where: Frag[] = [sql`c.tenant_id = ${tenantId}`];

  if (o.ids) {
    if (!o.ids.length) return [];
    where.push(sql`c.id in (${sql.join(o.ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  }

  if (o.q) {
    /* ★ `%` و`_` محرفا بدلٍ في `ilike`: بحثٌ عن «50%» بلا تهريبٍ يطابق كلَّ
       شيء، و«a_b» يطابق ما ليس منه. والتهريبُ بالشرطة المائلة الخلفيّة —
       وهي محرفُ الهروب الافتراضيّ في بوستجرس بلا `ESCAPE`. */
    const like = likePattern(o.q);
    const tail = phoneTail(o.q);
    const byTail = tail
      ? sql` or ${TAIL(sql`c.phone`)} = ${tail}
             or exists (select 1 from channel_identities i2
                         where i2.contact_id = c.id and ${TAIL(sql`i2.external_id`)} = ${tail})`
      : sql.empty();
    /* ★ الاسمُ مسوّىً من الطرفين: كانت المقارنة على العمود خاماً، فبحثُ
       «أحمد» لا يجد «احمد» — وهما اسمٌ واحدٌ كتبه الزبون بإملاءٍ آخر.
       (والتعليقُ خارجَ القالب: باكتيك داخل تعليقٍ داخل قالبٍ نصّيّ يُغلقه.) */
    where.push(sql`(
      ${nameMatch(sql`c.display_name`, o.q)}
      or c.phone ilike ${like}
      or exists (select 1 from channel_identities i1
                  where i1.contact_id = c.id
                    and (i1.external_id ilike ${like} or i1.display_handle ilike ${like}))
      ${byTail}
    )`);
  }

  if (o.filter === 'multi') {
    where.push(sql`(select count(distinct i3.channel_id) from channel_identities i3
                     where i3.contact_id = c.id) > 1`);
  } else if (o.filter === 'quiet') {
    where.push(sql`(c.opted_out_at is not null or c.blocked_at is not null)`);
  } else if (o.filter === 'whatsapp_cloud' || o.filter === 'instagram') {
    where.push(sql`exists (select 1 from channel_identities i4
                            join tenant_channels ch4 on ch4.id = i4.channel_id
                           where i4.contact_id = c.id and ch4.kind = ${o.filter})`);
  }

  if (o.cursor) {
    where.push(sql`(c.last_seen_at, c.id) < (${o.cursor.ts}::timestamptz, ${o.cursor.id}::uuid)`);
  }

  /* الكلفةُ على العميل تُعرض لمن يملك الفوترة وحده — والباقي يرى الحجمَ لا الثمن. */
  const cost = o.withCost
    ? sql`(select coalesce(sum(w.ai_cost_usd), 0)::text from conversation_windows w
            where w.contact_id = c.id)`
    : sql`null::text`;

  const rows = await tx.execute(sql`
    select
      c.id::text                                            as "id",
      c.display_name                                        as "displayName",
      c.phone                                               as "phone",
      c.tags                                                as "tags",
      c.first_seen_at                                       as "firstSeenAt",
      c.last_seen_at                                        as "lastSeenAt",
      c.opted_out_at                                        as "optedOutAt",
      c.blocked_at                                          as "blockedAt",
      (select count(*)::int from conversations v where v.contact_id = c.id)         as "conversations",
      (select count(*)::int from channel_identities i where i.contact_id = c.id)    as "identities",
      (select max(v.last_message_at) from conversations v where v.contact_id = c.id) as "lastMessageAt",
      (select coalesce(array_agg(distinct ch.kind), '{}'::text[])
         from channel_identities i join tenant_channels ch on ch.id = i.channel_id
        where i.contact_id = c.id)                          as "kinds",
      (select count(*)::int from conversation_windows w
        where w.contact_id = c.id and w.billed_at is not null) as "windowsBilled",
      ${cost}                                               as "aiCostUsd"
    from contacts c
    where ${sql.join(where, sql` and `)}
    order by c.last_seen_at desc, c.id desc
    limit ${o.limit ?? PAGE}
  `) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    displayName: (r.displayName as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    firstSeenAt: iso(r.firstSeenAt)!,
    lastSeenAt: iso(r.lastSeenAt)!,
    lastMessageAt: iso(r.lastMessageAt),
    optedOutAt: iso(r.optedOutAt),
    blockedAt: iso(r.blockedAt),
    conversations: Number(r.conversations ?? 0),
    identities: Number(r.identities ?? 0),
    kinds: (r.kinds as string[] | null) ?? [],
    windowsBilled: Number(r.windowsBilled ?? 0),
    aiCostUsd: (r.aiCostUsd as string | null) ?? null,
  }));
}

export function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * ★ **أزواجُ الترشيح — اقتراحٌ لا حكم.** ولا دمجَ آليٍّ أبداً:
 *   «محمد» و«محمود» يتشابهان ولا يتّحدان، والقرارُ لصاحب الحساب وحده.
 *
 * وسببان فقط، وكلٌّ منهما دليلٌ يُقرأ بالعين في الواجهة:
 *  ① **رقمٌ يطابق مُعرِّفاً**: ذيلُ تسع خاناتٍ من عمود الهاتف أو من مقبض
 *    أيّ هويّة. وهذا يمسك الحالةَ الأشيع: واتساب يعطي `9627…` وصاحبُ الحساب
 *    كتب `07…` بيده في بطاقةٍ أخرى — رقمان مختلفان نصّاً وهاتفٌ واحد.
 *  ② **تشابهُ اسمٍ** بعد التسوية العربيّة، بعتبة 0.62 على `pg_trgm`
 *    (مُثبَّتةٌ من الترحيل الأوّل). والعتبةُ مكتوبةٌ رقماً واحداً هنا لا في
 *    ثلاثة مواضع.
 *
 * والصفُّ يحمل سببَه ودرجتَه فتقرأ الواجهةُ **لماذا** اقتُرح، لا «اقتُرح».
 */
export function dupPairs(tenantId: string): Frag {
  return sql`(
    with n as (
      select c.id, nullif(${NAME_KEY(sql`c.display_name`)}, '') as nk
        from contacts c where c.tenant_id = ${tenantId}
    ),
    t as (
      select c.id as contact_id, ${TAIL(sql`c.phone`)} as tail
        from contacts c where c.tenant_id = ${tenantId}
      union
      select i.contact_id, ${TAIL(sql`i.external_id`)}
        from channel_identities i where i.tenant_id = ${tenantId}
    ),
    cand as (
      select x.contact_id as a, y.contact_id as b, 'phone'::text as why, 1::float as score
        from t x join t y on y.tail = x.tail and y.contact_id > x.contact_id
       where x.tail is not null and length(x.tail) >= 7
      union all
      select a.id, b.id, 'name'::text, similarity(a.nk, b.nk)::float
        from n a join n b on b.id > a.id
       where a.nk is not null and b.nk is not null
         and (a.nk = b.nk or similarity(a.nk, b.nk) >= 0.62)
    )
    select distinct on (a, b) a, b, why, score from cand order by a, b, score desc
  )`;
}

/**
 * ★★ مرشَّحو **جهةٍ واحدة** — خطّيٌّ في حجم القاعدة لا تربيعيّ.
 *
 *   كانت ورقةُ الجهة تنادي `dupPairs` (كلُّ الأزواج في المستأجر، ضمُّ n×n على
 *   `similarity`) ثمّ ترشّح بـ`where a = id or b = id`: عملُ الجدول كلِّه يُعاد
 *   عند فتح كلّ بطاقة. يعمل على مئة جهةٍ ويسقط على عشرة آلاف — وهو أسوأُ
 *   شكلٍ للعطل: لا يظهر في التجربة ويظهر عند العميل. هنا طرفٌ واحدٌ ثابت،
 *   ونفسُ السببَين ونفسُ العتبة (0.62) فلا يختلف الاقتراحُ بين القائمة والورقة.
 */
export function dupPairsFor(tenantId: string, contactId: string): Frag {
  return sql`(
    with me_n as (
      select nullif(${NAME_KEY(sql`c.display_name`)}, '') as nk
        from contacts c where c.tenant_id = ${tenantId} and c.id = ${contactId}::uuid
    ),
    me_t as (
      select ${TAIL(sql`c.phone`)} as tail
        from contacts c where c.tenant_id = ${tenantId} and c.id = ${contactId}::uuid
      union
      select ${TAIL(sql`i.external_id`)}
        from channel_identities i where i.tenant_id = ${tenantId} and i.contact_id = ${contactId}::uuid
    ),
    n as (
      select c.id, nullif(${NAME_KEY(sql`c.display_name`)}, '') as nk
        from contacts c where c.tenant_id = ${tenantId} and c.id <> ${contactId}::uuid
    ),
    t as (
      select c.id as contact_id, ${TAIL(sql`c.phone`)} as tail
        from contacts c where c.tenant_id = ${tenantId} and c.id <> ${contactId}::uuid
      union
      select i.contact_id, ${TAIL(sql`i.external_id`)}
        from channel_identities i where i.tenant_id = ${tenantId} and i.contact_id <> ${contactId}::uuid
    ),
    cand as (
      select ${contactId}::uuid as a, t.contact_id as b, 'phone'::text as why, 1::float as score
        from t join me_t on me_t.tail = t.tail
       where t.tail is not null and length(t.tail) >= 7
      union all
      select ${contactId}::uuid, n.id, 'name'::text, similarity(n.nk, me_n.nk)::float
        from n cross join me_n
       where n.nk is not null and me_n.nk is not null
         and (n.nk = me_n.nk or similarity(n.nk, me_n.nk) >= 0.62)
    )
    select distinct on (b) a, b, why, score from cand order by b, score desc
  )`;
}

/**
 * معرّفاتُ كلّ من له مرشَّحٌ — تُقرأ **مرّةً** ثمّ تُمرَّر مرشِّحاً للقائمة.
 *
 * ★ والبديلُ الذي تُرك: `exists (…)` مرتبطٌ بكلّ صفّ، فيُعاد حسابُ الأزواج
 *   كلِّها لكلّ جهةٍ في الصفحة — استعلامٌ صحيحٌ يصير ثقيلاً بمقدار مربّع
 *   عدد الجهات. وهذا يعمل على قاعدةٍ صغيرة ويسقط على أوّل قاعدةٍ حقيقيّة،
 *   وهو أسوأُ شكلٍ للعطل: لا يظهر في التجربة ويظهر عند العميل.
 */
export async function dupIds(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx.execute(sql`
    select distinct x.id::text as "id"
      from (select p.a as id from ${dupPairs(tenantId)} p
            union select p.b from ${dupPairs(tenantId)} p) x
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => String(r.id));
}
