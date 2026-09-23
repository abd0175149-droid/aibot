import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, contacts, channelIdentities, conversations, conversationWindows,
  optouts, auditLog, tenantChannels, sql, eq, and, type Tx,
} from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { requireAuth, tenantOf, PERMISSIONS } from '../auth.js';

/**
 * جهات الاتّصال — **الشخص الواحد عبر قنواته**.
 *
 * ★ لماذا توجد هذه الشاشة: الزبون نفسه يراسلك من واتساب ومن إنستجرام فيصير
 *   **شخصَين** في نظامك. تُجيبه مرّتين، وتحسب إنفاقه مرّتين، ولا ترى أنّه
 *   عميلٌ متكرّر. وقاعدة البيانات تعرف هذا أصلاً: `contacts` هو الإنسان و
 *   `channel_identities` هي مقابضه — والدمج تحويلُ مقبضٍ من إنسانٍ إلى آخر،
 *   لا ترحيلُ بيانات.
 *
 * ── ثلاثة قيودٍ تحكم كلّ ما هنا ───────────────────────────────────────────
 *  ① **مراجعةٌ قبل الدمج**: `GET /contacts/merge-preview` يعيد **ما سيتحرّك
 *    بالاسم** — كلّ مقبضٍ وكلّ محادثةٍ وعددُ رسائلها وكلّ حقلٍ يتغيّر على
 *    البطاقة الباقية. فلا دمجَ بضغطةٍ على رقمٍ مجمَّع.
 *  ② **الدمج لا يفقد رسالة**: كلُّ ما يتعلّق بالبطاقة المُدمَجة يُحوَّل قبل
 *    حذفها — المقابض والمحادثات ونوافذ الفوترة. (والسبب أدناه: الحذفُ
 *    يتسلسل.)
 *  ③ **يُسجَّل في `audit_log`** بصورةٍ كاملةٍ تكفي **للتراجع**: فعلٌ يغيّر
 *    تاريخ زبونٍ لا يكون صامتاً ولا نهائيّاً.
 *
 * ★ **العطل الذي كان في نقطة الدمج القائمة** — وهو أخطر ما في هذا الملفّ:
 *   كانت تحوّل **هويّةً واحدة** ثمّ `DELETE` على البطاقة التي كانت تحملها.
 *   و`channel_identities` و`conversations` و`conversation_windows` كلُّها
 *   `ON DELETE CASCADE` من `contacts`، و`messages` تتسلسل من `conversations`.
 *   فبطاقةٌ لها مقبضان: يُحوَّل أحدهما، ثمّ يمحو الحذفُ **الآخرَ ومحادثتَه
 *   وكلَّ رسائلها ونوافذَ فوترتها**. دمجٌ يُقدَّم للعميل «توحيداً» وهو يمحو
 *   نصفَ تاريخ زبونه بلا خطأٍ ولا سجلّ. ولذلك صار الدمج **على مستوى البطاقة**
 *   لا المقبض: كلُّ مقابض المُدمَجة تتحوّل، والمراجعةُ تعدّها قبل الضغط.
 */

/** صفحةُ القائمة — ترقيمٌ بالمؤشّر لأنّ «آخر نشاط» يتغيّر تحت المستخدم. */
const PAGE = 40;

/** سقفُ أزواج الترشيح: اقتراحٌ يُراجَع بالعين، لا تقريرٌ لا ينتهي. */
const PAIRS = 60;

/* ═══════════════════ ما لا يحتاج قاعدةً — فيُختبَر وحده ═══════════════════ */

/**
 * ★ حقول البطاقة التي **تُدمَج** — مجرّدةٌ عن الصفّ عمداً.
 *
 * والتجريدُ ليس تجميلاً: قرارُ «أيّ قيمةٍ تبقى» هو الموضع الذي يُفقد فيه
 * رقمُ هاتفٍ أو يُنسى فيه **عدولٌ عن الاشتراك**، وهو أمرٌ لا يجوز أن يسقط
 * في دمج. فالقرار دالّةٌ خالصةٌ لها اختبارٌ لا فرعٌ داخل معاملة.
 */
export interface ContactCore {
  phone: string | null;
  displayName: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  /** ISO — أو `null`. والتواريخ نصوصٌ هنا كي تبقى الدالّة خالصةً وقابلةً للمقارنة. */
  optedOutAt: string | null;
  blockedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** سطرٌ يُقرأ في المراجعة: ما كان، وما سيصير، ولماذا. */
export interface FoldNote {
  k: keyof ContactCore;
  label: string;
  was: string | null;
  now: string | null;
  why: string;
}

function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function later(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * ★ دمجُ حقلَي بطاقتين — والقواعد مكتوبةٌ لأنّ كلَّ واحدةٍ منها خسارةٌ لو عُكست:
 *
 *  · **الباقيةُ تفوز بما تملك**، والمُدمَجةُ تسدّ الفراغ وحده (`phone` ·
 *    `displayName`). فلا يُبدَّل اسمٌ كتبه صاحبُ الحساب بمقبضٍ جاء من ميتا.
 *  · **الوسوم اتّحادٌ**: وسمٌ وُضع على أحد الوجهين وُضع على الإنسان نفسه.
 *  · **السماتُ تُدمَج والباقيةُ تغلب** عند التعارض — لا حذفَ لمفتاحٍ كان
 *    موجوداً في أحدهما.
 *  · **العدولُ عن الاشتراك والحجبُ: الأسبقُ يفوز.** وهذا معكوسُ ما يبدو
 *    «الأحدثَ أصحّ»: من قال «لا تراسلني» على رقمه القديم قال ذلك عن نفسه لا
 *    عن مقبضه، ودمجٌ يُسقط ذلك يُعيد مراسلةَ من طلب أن يُترك.
 *  · **أوّلُ ظهورٍ أقدمُهما، وآخرُ نشاطٍ أحدثُهما** — وإلّا بدا عميلٌ قديمٌ
 *    جديداً أو نشِطٌ صامتاً.
 */
export function foldContacts(
  keep: ContactCore,
  absorb: ContactCore,
): { patch: Partial<ContactCore>; notes: FoldNote[] } {
  const patch: Partial<ContactCore> = {};
  const notes: FoldNote[] = [];

  if (!keep.phone && absorb.phone) {
    patch.phone = absorb.phone;
    notes.push({
      k: 'phone', label: 'الرقم', was: null, now: absorb.phone,
      why: 'البطاقة الباقية بلا رقم، فأخذت رقم المُدمَجة',
    });
  } else if (keep.phone && absorb.phone && keep.phone !== absorb.phone) {
    notes.push({
      k: 'phone', label: 'الرقم', was: keep.phone, now: keep.phone,
      why: `رقمُ المُدمَجة (${absorb.phone}) يبقى مقبضاً في محادثته ولا يستبدل الرقم الأساس`,
    });
  }

  if (!keep.displayName && absorb.displayName) {
    patch.displayName = absorb.displayName;
    notes.push({
      k: 'displayName', label: 'الاسم', was: null, now: absorb.displayName,
      why: 'البطاقة الباقية بلا اسم، فأخذت اسم المُدمَجة',
    });
  } else if (keep.displayName && absorb.displayName && keep.displayName !== absorb.displayName) {
    notes.push({
      k: 'displayName', label: 'الاسم', was: keep.displayName, now: keep.displayName,
      why: `اسمُ المُدمَجة (${absorb.displayName}) لا يُستبدل به اسمُ البطاقة الباقية`,
    });
  }

  const addedTags = absorb.tags.filter((t) => !keep.tags.includes(t));
  if (addedTags.length) {
    patch.tags = [...keep.tags, ...addedTags];
    notes.push({
      k: 'tags', label: 'الوسوم', was: keep.tags.join(' · ') || null,
      now: patch.tags.join(' · '),
      why: 'وسمٌ على أحد الوجهين وسمٌ على الإنسان نفسه',
    });
  }

  const newKeys = Object.keys(absorb.attributes).filter((k) => !(k in keep.attributes));
  if (newKeys.length) {
    patch.attributes = { ...absorb.attributes, ...keep.attributes };
    notes.push({
      k: 'attributes', label: 'السمات', was: String(Object.keys(keep.attributes).length),
      now: String(Object.keys(patch.attributes).length),
      why: `أُضيفت سماتٌ من المُدمَجة: ${newKeys.join(' · ')}`,
    });
  }

  const opted = earlier(keep.optedOutAt, absorb.optedOutAt);
  if (opted !== keep.optedOutAt) {
    patch.optedOutAt = opted;
    notes.push({
      k: 'optedOutAt', label: 'عدولٌ عن الاشتراك', was: keep.optedOutAt, now: opted,
      why: 'العدولُ يسري على الإنسان لا على مقبضه — فالأسبق يفوز ولا يُلغى بالدمج',
    });
  }

  const blocked = earlier(keep.blockedAt, absorb.blockedAt);
  if (blocked !== keep.blockedAt) {
    patch.blockedAt = blocked;
    notes.push({
      k: 'blockedAt', label: 'الحجب', was: keep.blockedAt, now: blocked,
      why: 'الحجبُ يسري على الإنسان — فالأسبق يفوز',
    });
  }

  const first = earlier(keep.firstSeenAt, absorb.firstSeenAt)!;
  if (first !== keep.firstSeenAt) {
    patch.firstSeenAt = first;
    notes.push({
      k: 'firstSeenAt', label: 'أوّل ظهور', was: keep.firstSeenAt, now: first,
      why: 'عميلٌ قديمٌ لا يصير جديداً بدمج',
    });
  }

  const last = later(keep.lastSeenAt, absorb.lastSeenAt);
  if (last !== keep.lastSeenAt) {
    patch.lastSeenAt = last;
    notes.push({
      k: 'lastSeenAt', label: 'آخر نشاط', was: keep.lastSeenAt, now: last,
      why: 'آخرُ نشاطٍ أحدثُ الوجهين',
    });
  }

  return { patch, notes };
}

/**
 * ★ التراجع **لا يستعيد إلّا ما لم يتغيّر بعده.**
 *
 * لو حُرّر اسمُ البطاقة بعد الدمج، فإعادةُ الاسم القديم تمحو تحريراً لم
 * يطلب أحدٌ محوَه — وهذا تراجعٌ يفقد بياناً، أي بعينه ما وُجد ليمنعه. فلكلّ
 * حقلٍ شرطٌ واحد: **قيمتُه الآن هي التي كتبها الدمج**.
 */
export function undoPatch(
  before: Partial<ContactCore>,
  after: Partial<ContactCore>,
  current: ContactCore,
): { patch: Partial<ContactCore>; skipped: Array<keyof ContactCore> } {
  const patch: Partial<ContactCore> = {};
  const skipped: Array<keyof ContactCore> = [];
  for (const k of Object.keys(after) as Array<keyof ContactCore>) {
    const same = JSON.stringify(current[k]) === JSON.stringify(after[k]);
    if (!same) { skipped.push(k); continue; }
    (patch as Record<string, unknown>)[k] = before[k] ?? null;
  }
  return { patch, skipped };
}

/**
 * مؤشّرُ الصفحة: `آخر نشاط|المعرّف`.
 *
 * ★ وهو مركَّبٌ من حقلَين لا من الوقت وحده: جهتان بنفس `last_seen_at`
 *   (بذرةٌ واحدة، أو توريدٌ مجمَّع) تجعلان المؤشّرَ الزمنيَّ يُسقط إحداهما
 *   أو يُعيدها إلى الأبد. والمعرّفُ uuid v7 مرتَّبٌ زمنيّاً فيصلح فاصلاً.
 */
export function encodeCursor(lastSeenAt: Date | string, id: string): string {
  return `${typeof lastSeenAt === 'string' ? lastSeenAt : lastSeenAt.toISOString()}|${id}`;
}

export function decodeCursor(raw: string | undefined): { ts: string; id: string } | null {
  if (!raw) return null;
  const at = raw.indexOf('|');
  if (at <= 0) return null;
  const ts = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (Number.isNaN(Date.parse(ts))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { ts, id };
}

/**
 * ★ تسويةُ الاسم العربيّ قبل المقارنة — وهي نصفُ عمل الترشيح.
 *
 * «أحمد» و«احمد» و«اَحمد» ثلاثةُ نصوصٍ مختلفةٍ بايتاً وشخصٌ واحد: الهمزةُ
 * تُكتب ولا تُكتب، والتاءُ المربوطة تُكتب هاءً، والحركاتُ والتطويلُ يدخلان
 * من لوحات المفاتيح. فبلا تسويةٍ يُقارَن `similarity` بين صيغتَي كتابةٍ
 * لنفس الاسم فيُرجع رقماً منخفضاً، ويسقط أظهرُ تكرارٍ في القاعدة.
 *
 * ومكتوبةٌ هنا بالـSQL نفسِه (`translate` · `regexp_replace`) لأنّ المقارنة
 * تجري في القاعدة: نسخةٌ في TS ونسخةٌ في SQL تتباعدان — وهذه الدالّة هي
 * **النسخةُ المفحوصة**، وSQL أدناه يطابقها حرفاً بحرف.
 */
const AR_FROM = 'أإآٱىةًٌٍَُِّْـ';
const AR_TO = 'اااايه';

export function nameKey(raw: string | null | undefined): string {
  if (!raw) return '';
  let out = '';
  for (const ch of raw) {
    const at = AR_FROM.indexOf(ch);
    if (at < 0) out += ch;
    else if (at < AR_TO.length) out += AR_TO[at];
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** ذيلُ الرقم: تسعُ خاناتٍ تُسقط رمزَ الدولة والصفرَ الوطنيّ فيتطابق 07 مع 9627. */
export function phoneTail(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 7 ? digits.slice(-9) : '';
}

/* ═══════════════════ ما يحتاج قاعدةً ═══════════════════ */

type Frag = ReturnType<typeof sql>;

/** نفسُ تسوية `nameKey` بلغة القاعدة — والتطابقُ مقصودٌ ومفحوص. */
const NAME_KEY = (col: Frag): Frag =>
  /* ★ `[[:space:]]` لا `\s`: قالبُ JS يأكل الشرطةَ المائلة فيصل إلى القاعدة
     `'s+'` — تعبيرٌ يستبدل **حرف s** بمسافة ولا يطوي مسافةً واحدة. عطلٌ
     صامتٌ تماماً: الاستعلام ينجح، والترشيحُ يخطئ على كلّ اسمٍ لاتينيّ. */
  sql`lower(btrim(regexp_replace(translate(coalesce(${col}, ''), ${AR_FROM}, ${AR_TO}), '[[:space:]]+', ' ', 'g')))`;

const TAIL = (col: Frag): Frag =>
  sql`nullif(right(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), 9), '')`;

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
async function summaries(tx: Tx, tenantId: string, o: {
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
    const like = `%${o.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const tail = phoneTail(o.q);
    const byTail = tail
      ? sql` or ${TAIL(sql`c.phone`)} = ${tail}
             or exists (select 1 from channel_identities i2
                         where i2.contact_id = c.id and ${TAIL(sql`i2.external_id`)} = ${tail})`
      : sql.empty();
    where.push(sql`(
      c.display_name ilike ${like}
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

function iso(v: unknown): string | null {
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
function dupPairs(tenantId: string): Frag {
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
 * معرّفاتُ كلّ من له مرشَّحٌ — تُقرأ **مرّةً** ثمّ تُمرَّر مرشِّحاً للقائمة.
 *
 * ★ والبديلُ الذي تُرك: `exists (…)` مرتبطٌ بكلّ صفّ، فيُعاد حسابُ الأزواج
 *   كلِّها لكلّ جهةٍ في الصفحة — استعلامٌ صحيحٌ يصير ثقيلاً بمقدار مربّع
 *   عدد الجهات. وهذا يعمل على قاعدةٍ صغيرة ويسقط على أوّل قاعدةٍ حقيقيّة،
 *   وهو أسوأُ شكلٍ للعطل: لا يظهر في التجربة ويظهر عند العميل.
 */
async function dupIds(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx.execute(sql`
    select distinct x.id::text as "id"
      from (select p.a as id from ${dupPairs(tenantId)} p
            union select p.b from ${dupPairs(tenantId)} p) x
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => String(r.id));
}

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
async function planMerge(
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
            from ${dupPairs(tenantId)} p
           where p.a = ${id}::uuid or p.b = ${id}::uuid
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
