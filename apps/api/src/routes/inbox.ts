import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, conversations, messages, contacts, channelIdentities,
  conversationWindows, tenantChannels, users, eq, and, isNull, desc, lt, sql,
} from '@aibot/db';
import { AppError, ErrorCode, SendMessageBody } from '@aibot/shared';
import { getAdapter, type ChannelKind } from '@aibot/channels';
import { open as decrypt } from '@aibot/crypto';
import { requireAuth, tenantOf, PERMISSIONS } from '../auth.js';
import { applyMerge, isUuid } from './contacts.js';
import { TAIL, likePattern, nameMatch, phoneTail } from '../search.js';
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
/**
 * مؤشّرُ الإنبوكس: `"<طابع ISO>|<uuid>"`.
 *
 * ويُقرأ متسامحاً لا صارماً: مؤشّرٌ مشوّهٌ من رابطٍ نُسخ أو تبويبٍ قديم
 * يُهمَل فتُعاد الصفحةُ الأولى — لا 500 ولا `Invalid Date` يتسلّل إلى
 * الاستعلام فيُفرغ القائمة بلا سبب. والشكلُ القديم (طابعٌ وحده) يبقى مقروءاً
 * فلا تنكسر تبويبةٌ مفتوحةٌ ساعةَ النشر.
 */
export function parseCursor(raw: string | undefined): { at: string; id: string } | null {
  if (!raw) return null;
  const [at, id] = raw.split('|');
  if (!at || Number.isNaN(Date.parse(at))) return null;
  const iso = new Date(at).toISOString();
  /* بلا معرّفٍ صالح: **أصغرُ** uuid — فيصير الشرطُ المركَّب مطابقاً تماماً
     للشرط القديم «أقلّ من هذا الطابع»، ولا صفَّ يُعاد مرّتين على تبويبةٍ
     تحمل مؤشّراً بالشكل السابق. (وأكبرُ uuid كان سيُعيد صفوفَ الثانية
     نفسها كلَّها — تكراراً مرئيّاً في القائمة.) */
  return { at: iso, id: id && isUuid(id) ? id : '00000000-0000-0000-0000-000000000000' };
}

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

        /* ★ **المؤشّرُ مركَّبٌ: الطابعُ ثمّ المعرّف.**
           كان `lt(lastMessageAt, cursor)` وحده، وطوابعُ واتساب **بدقّة
           الثانية**: عشرُ رسائل في ثانيةٍ واحدة أمرٌ عاديٌّ في ساعة الذروة.
           فالصفحةُ تنتهي في منتصف ثانيةٍ، والمؤشّرُ يقول «أقلّ من هذه
           الثانية» فيقفز فوق بقيّة صفوفها — محادثاتٌ **تختفي** من «المزيد»
           ولا شيء يقول إنّها كانت هناك. والفرزُ يُكمَّل بالمعرّف ليكون
           الترتيبُ كلّيّاً لا جزئيّاً. */
        const cur = parseCursor(cursor);
        if (cur) {
          where.push(sql`(${conversations.lastMessageAt}, ${conversations.id})
                         < (${cur.at}::timestamptz, ${cur.id}::uuid)`);
        }
        /* ★ **بحثُ الإنبوكس كان يفشل في نصف الحالات — وثلاثةُ أسبابٍ معاً.**
           ① الاسمُ يُقارَن خاماً: «أحمد» لا يجد «احمد»، وهما اسمٌ واحدٌ كتبه
             الزبون في واتساب بإملاءٍ آخر والموظّفُ يبحث بالذي في رأسه.
           ② الرقمُ يُقارَن خاماً: `0791234567` لا يجد `962791234567` — وهذا
             أشيعُ ما يُكتب، فالموظّف يتلقّى مكالمةً ويكتب الرقم كما رآه.
             وشاشةُ جهات الاتّصال تَعِد بهذا صراحةً وتفي، فيتعلّم الموظّف أنّ
             «البحث أحياناً يشتغل».
           ③ و`%` و`_` بلا تهريب: بحثٌ عن «50%» **يطابق كلّ شيء**.
           والقطعةُ الآن واحدةٌ في `search.ts` تقرؤها الشاشتان. */
        if (q) {
          const like = likePattern(q);
          const tail = phoneTail(q);
          const byTail = tail
            ? sql` or ${TAIL(channelIdentities.externalId)} = ${tail}`
            : sql.empty();
          where.push(sql`(
            ${nameMatch(contacts.displayName, q)}
            or ${channelIdentities.externalId} ilike ${like}
            or ${channelIdentities.displayHandle} ilike ${like}
            or ${nameMatch(conversations.lastMessagePreview, q)}
            ${byTail}
          )`);
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
            /* ★ من يتولّاها — وكان العمود موجوداً في المخطّط ولا يقرؤه أحد.
               فالشاشة تكتب «تولّيتَها» بصيغة المخاطَب لكلّ من يفتح الإنبوكس،
               ويظنّ الثاني أنّه هو، أو يردّ بالتوازي مع زميله. */
            assignedUserId: conversations.assignedUserId,
            assignedName: users.name,
          })
          .from(conversations)
          .innerJoin(tenantChannels, eq(tenantChannels.id, conversations.channelId))
          .innerJoin(contacts, eq(contacts.id, conversations.contactId))
          .innerJoin(channelIdentities, eq(channelIdentities.id, conversations.identityId))
          .leftJoin(users, eq(users.id, conversations.assignedUserId))
          .where(and(...where))
          .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
          .limit(40);

        /* ★ **عدُّ «يحتاجك الآن» من القاعدة لا من الصفحة.**
           كانت الشاشة تجمّع الصفوف الأربعين المحمَّلة، فالمحادثة المنتظرة
           منذ أمس — وهي **أوّل** من يستحقّ الردّ — أوّلُ من يسقط خارج
           الأربعين لأنّها الأقدم زمنيّاً. فالرقمُ الذي بُنيت الشاشة حوله
           يكذب تحديداً في الحالة التي وُجد لأجلها: يقرأ الموظّف «٥ بانتظار
           ردّك» فيردّ على الخمسة ويغلق هاتفه، والسادس ينتظر يوماً. */
        const attnWhere = [eq(conversations.tenantId, tenantId), eq(conversations.needsAttention, true)];
        if (status) attnWhere.push(eq(conversations.status, status as 'open' | 'closed'));
        const attn = (await tx
          .select({
            count: sql<number>`count(*)::int`,
            oldestAt: sql<string | null>`min(${conversations.lastMessageAt})`,
          })
          .from(conversations)
          .where(and(...attnWhere)))[0];

        const last = rows[rows.length - 1];
        return {
          items: rows,
          attention: { count: attn?.count ?? 0, oldestAt: attn?.oldestAt ?? null },
          nextCursor: rows.length === 40 && last?.lastMessageAt
            ? `${last.lastMessageAt.toISOString()}|${last.id}`
            : null,
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
          /* ★ الحوارُ يحمل معرّفَ محادثته.
             الواجهةُ تُبدّل المحادثات بالخطّاف نفسه، فاستجابةٌ متأخّرةٌ لا
             يُعرف لمن هي إلّا بهذا الحقل. وبدونه يقع أسوأ ما في هذه الشاشة:
             كلامُ زبونٍ تحت اسم زبونٍ آخر — والموظّف يردّ على ما يقرأ. */
          conversationId: req.params.id,
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
   * ★ **فتحُ ما أرسله الزبون — الوسيلةُ كانت موجودةً بلا طريقٍ إليها.**
   *
   *   `adapter.fetchMedia` مكتوبةٌ في المحوّل منذ أن كُتب، ولا نقطةَ واحدةٌ
   *   في الـAPI تناديها. فالموظّف يقرأ «📎 صورة» ويضطرّ إلى سؤال الزبون «شو
   *   بعتت؟» — والصورةُ عند ميتا، والتوكن عندنا، والدالّةُ جاهزة.
   *
   *   وثلاثة قيودٍ تجعل هذا المسار آمناً:
   *    ① الرسالةُ تُقرأ **داخل** `withTenant`، فـRLS يمنع قراءةَ وسيطِ
   *      مستأجرٍ آخر ولو خُمّن معرّفُها — لا فحصَ ملكيّةٍ يدويّ يُنسى.
   *    ② `no-store` صريحة: الوسيطُ محتوى زبونٍ خاصّ، وكاشٌ مشتركٌ عند وسيطٍ
   *      أو CDN يسرّبه إلى طلبٍ آخر.
   *    ③ التوكن يُفكّ في الذاكرة وقت الاستعمال ولا يُعاد ولا يُسجَّل.
   */
  app.get<{ Params: { id: string; mid: string } }>(
    '/conversations/:id/messages/:mid/media',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const tenantId = tenantOf(req);
      if (!isUuid(req.params.id) || !isUuid(req.params.mid)) {
        throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);
      }

      const found = await withTenant(getDb(), tenantId, async (tx) => {
        const m = (await tx.select({ payload: messages.payload, channelId: messages.channelId })
          .from(messages)
          .where(and(
            eq(messages.id, req.params.mid),
            eq(messages.conversationId, req.params.id),
            isNull(messages.deletedAt),
          )).limit(1))[0];
        if (!m) return null;

        const mediaId = (m.payload as { mediaId?: string | null } | null)?.mediaId ?? null;
        if (!mediaId) return null;

        const ch = (await tx.select().from(tenantChannels)
          .where(eq(tenantChannels.id, m.channelId)).limit(1))[0];
        if (!ch?.tokenEnc) return null;
        return { mediaId, ch };
      });

      if (!found) throw new AppError(ErrorCode.VALIDATION, 'لا وسيطَ لهذه الرسالة', 404);

      const adapter = getAdapter(found.ch.kind as ChannelKind);
      const file = await adapter.fetchMedia(
        {
          channelId: found.ch.id,
          tenantId,
          kind: found.ch.kind as ChannelKind,
          token: decrypt(found.ch.tokenEnc!, found.ch.keyVersion),
          externalAccountId: found.ch.externalAccountId ?? '',
          config: (found.ch.config ?? {}) as Record<string, unknown>,
        },
        found.mediaId,
      );

      /* ★ 404 لا 500: ميتا تحذف الوسائط بعد مدّة، وانتهاءُ صلاحيّتها حالةٌ
         عاديّةٌ تُقال للموظّف لا عطلٌ في النظام. */
      if (!file) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'تعذّر جلبُ المرفَق من القناة — قد تكون مهلةُ حفظه عند المزوّد قد انتهت.',
          404,
        );
      }

      return reply
        .header('content-type', file.mime)
        .header('cache-control', 'no-store, private')
        .header('content-disposition', 'inline')
        .send(file.data);
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

        /* ★ أوّلُ ردٍّ يُعيّن صاحبَه — إن لم يكن معيَّناً.
           فمن يردّ بلا أن يضغط «تولَّ المحادثة» يصير صاحبَها في نظر زملائه،
           وهو ما يفعله الموظّف فعلاً: يقرأ ويردّ. و`is null` شرطٌ لا زينة:
           بلاه يسرق كلُّ ردٍّ المحادثةَ من متولّيها عند أوّل تعليق. */
        await tx.update(conversations)
          .set({ assignedUserId: req.auth!.sub })
          .where(and(eq(conversations.id, req.params.id), isNull(conversations.assignedUserId)));

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

        /* ★ **التولّي يُسجَّل باسمٍ، لا يبقى إسكاتاً مجهولاً.**
           كان «تولّي» المحادثة مجرّدَ `botPausedUntil`، وعمودُ
           `assigned_user_id` موجودٌ في المخطّط منذ نموذج البيانات ولا يقرؤه
           ولا يكتبه أحد. فالشاشةُ تكتب «تولّيتَها» بصيغة المخاطَب لكلّ من
           يفتح الإنبوكس: يقرؤها الموظّف الثاني فيظنّ أنّه هو، أو يفتح
           المحادثة ويردّ بالتوازي مع زميله — ردّان متناقضان على زبونٍ واحدٍ
           في الدقيقة نفسها، وبلا سجلٍّ يقول من ردّ.
           وإعادةُ البوت تُفرغ التعيين: انتهى عملُ الموظّف على المحادثة. */
        const takingOver = req.body?.pauseMinutes != null || req.body?.enabled === false;
        const resuming = req.body?.enabled === true || req.body?.pauseMinutes === 0;
        if (takingOver && !resuming) set.assignedUserId = req.auth!.sub;
        else if (resuming) set.assignedUserId = null;

        const row = orMissing((await tx.update(conversations).set(set)
          .where(eq(conversations.id, req.params.id)).returning())[0]);
        emitToTenant(tenantId, 'conversation:update', row);
        return row;
      });
    },
  );

  /**
   * ★ **التعيينُ الصريح — «حوّلها لزميل» كان وسماً نصّيّاً لا يقول لأيّ زميل.**
   *
   *   والوسمُ لا يصل أحداً: لا يظهر في قائمة زميلك، ولا يُنبَّه به، ولا
   *   يمنع اثنَين من الردّ معاً. فالتحويلُ كان اعترافاً مكتوباً بأنّ شيئاً
   *   لم يحدث. وهذا المسار يُحدثه: صفٌّ واحدٌ يقول من صاحب المحادثة الآن.
   */
  app.post<{ Params: { id: string }; Body: { userId?: string | null } }>(
    '/conversations/:id/assign',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      const raw = req.body?.userId ?? null;
      if (raw !== null && !isUuid(raw)) {
        throw new AppError(ErrorCode.VALIDATION, 'معرّف مستخدمٍ غير صالح', 400);
      }
      return withTenant(getDb(), tenantId, async (tx) => {
        /* ★ العضويّةُ تُفحص داخل `withTenant`: RLS يحجب مستخدمي المستأجرين
           الآخرين، فاستعلامُ الوجود **هو** فحصُ العضويّة. وبلا هذا الفحص
           يُقبل أيُّ uuid فيصير التعيينُ إلى شبح — والقيدُ الخارجيُّ وحده
           يعطي 500 بدل رسالةٍ مفهومة. */
        if (raw) {
          const u = (await tx.select({ id: users.id }).from(users)
            .where(and(eq(users.id, raw), eq(users.isActive, true))).limit(1))[0];
          if (!u) throw new AppError(ErrorCode.VALIDATION, 'لا عضوَ بهذا المعرّف في فريقك', 404);
        }
        const row = orMissing((await tx.update(conversations)
          .set({ assignedUserId: raw })
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
