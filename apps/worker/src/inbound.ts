import {
  getDb, withTenant, contacts, channelIdentities, conversations, messages,
  conversationWindows, tenantChannels, eq, and, isNull, sql,
} from '@aibot/db';
import { emitToTenant } from './events.js';
import { capabilitiesFor, type ChannelKind, type ParsedWebhook } from '@aibot/channels';
import { typeLabel } from '@aibot/shared';

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
/**
 * ⚠️ حمولة المهمّة تمرّ عبر ريدِس **مُسلسَلةً بـJSON**، فكلّ `Date` تصل نصّاً.
 *    تمريرها كما هي إلى drizzle يرمي «value.toISOString is not a function»
 *    عند أوّل رسالةٍ حقيقيّة — ولا يكشفه أيّ اختبارٍ يستدعي الدالّة مباشرةً.
 *    الإحياء هنا، عند حدّ الطابور، لا في كلّ موضع استعمال.
 */
function reviveJob(job: InboundJob): InboundJob {
  return {
    ...job,
    parsed: {
      ...job.parsed,
      messages: job.parsed.messages.map((m) => ({ ...m, at: new Date(m.at) })),
      statuses: job.parsed.statuses.map((s) => ({ ...s, at: new Date(s.at) })),
    },
  };
}

export async function handleInbound(raw: InboundJob): Promise<void> {
  const job = reviveJob(raw);
  const db = getDb();
  const caps = capabilitiesFor(job.kind);
  /* هل وصلت رسالةُ زبونٍ فعلاً في هذه الدفعة؟ حالاتُ التسليم وحدها لا تُثبت
     أنّ الويبهوك يحمل رسائل، والحادثة التي تُحَلّ أدناه عن الرسائل لا عنها. */
  let sawInbound = false;
  /* ★ المحادثاتُ التي تستحقّ ردّاً — تُجمع هنا وتُجدوَل **بعد** الإيداع. */
  const toReply = new Set<string>();

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
          payload: { buttonPayload: m.buttonPayload, mediaId: m.mediaId, location: m.location ?? null },
          channelPayload: m.raw as object,
          createdAt: m.at,
        })
        .onConflictDoNothing({ target: [messages.channelId, messages.externalId] })
        .returning({ id: messages.id });

      if (inserted.length === 0) continue; // مكرَّرة — لا نافذة تُمدَّد ولا ردّ يُجدوَل

      /**
       * ★ **التفاعلُ حدثٌ لا رسالة.**
       *
       *   👍 على ردّ البوت أشيعُ ما يفعله الزبون العربيّ حين يرضى ويكتفي.
       *   وكان يصل `unsupported` فيُعامَل رسالةً تستحقّ ردّاً: تُمدَّد
       *   النافذة (فوترةٌ على «شكراً» بإيموجي)، ويرتفع عدّادُ غير المقروء
       *   (فتصعد المحادثةُ إلى أعلى قائمة الموظّف بلا سبب)، وتُجدوَل مهمّةُ
       *   ردٍّ سياقُها **مطابقٌ للشوط السابق حرفيّاً** — فيُنادى النموذج
       *   بكلفةٍ جديدة ليُعيد الجوابَ نفسَه على من قال إنّه فهم.
       *
       *   والصفُّ يُحفظ ويُبثّ: الموظّف يرى أنّ الزبون تفاعل. وهذا كلُّ ما
       *   في الأمر — خبرٌ لا طلب.
       */
      if (m.type === 'reaction') {
        emitToTenant(job.tenantId, 'message:new', {
          conversationId: conv.id,
          message: {
            id: inserted[0]!.id,
            direction: 'in',
            source: 'customer',
            type: m.type,
            body: m.text,
            payload: { buttonPayload: null, mediaId: null, location: null },
            status: null,
            createdAt: m.at.toISOString(),
          },
        });
        continue;
      }

      /* ④ النافذة: تُفتح أو تُمدَّد. ولا تُختم هنا —
         الختم عند أوّل صادرٍ داخلها، فرسالةٌ بلا ردٍّ لا تُفوتَر. */
      await openOrExtendWindow(tx, job, conv.id, identity.contactId, caps.windowHours, m.at);

      await tx
        .update(conversations)
        .set({
          lastInboundAt: m.at,
          lastMessageAt: m.at,
          /* ★ معاينةٌ يقرؤها إنسان: كان «[image]» و«[location]» — أسماءُ
             أنواعٍ تقنيّةٍ بالإنجليزيّة في قائمةٍ عربيّة، لا تقول للموظّف
             ما وصل ولا تُبحَث ولا تُقرأ بصوت. */
          lastMessagePreview: (m.text ?? typeLabel(m.type)).slice(0, 160),
          unreadCount: sql`${conversations.unreadCount} + 1`,
        })
        .where(eq(conversations.id, conv.id));

      /* ★ البثّ اللحظيّ — الجزء الذي كان مفقوداً كلّيّاً.
         الشاشة تستمع لـ`message:new` منذ اليوم الأوّل ولم يبثّه أحد، فرسالة
         الزبون لا تظهر حتّى يُحدّث الموظّف الصفحة. والبثّ **بعد** الكتابة
         عمداً: لا نُعلن رسالةً قد تُلغى بتراجع المعاملة. */
      emitToTenant(job.tenantId, 'message:new', {
        conversationId: conv.id,
        message: {
          id: inserted[0]!.id,
          direction: 'in',
          source: 'customer',
          type: m.type,
          body: m.text,
          payload: { buttonPayload: m.buttonPayload, mediaId: m.mediaId, location: m.location ?? null },
          status: null,
          createdAt: m.at.toISOString(),
        },
      });
      emitToTenant(job.tenantId, 'conversation:update', { id: conv.id });

      /* ⑤ المحادثةُ تستحقّ ردّاً — والجدولةُ نفسُها بعد الإيداع أدناه. */
      toReply.add(conv.id);
      sawInbound = true;
    }

    /* حالات التسليم: كانت تُكتب بلا بثّ، فعلامات ✓ و✓✓ و«فشلت» تتجمّد على
       ما جُلب عند فتح الشاشة. */
    for (const s of job.parsed.statuses) {
      const [row] = await tx
        .update(messages)
        .set({ status: s.status, errorCode: s.errorCode, errorMessage: s.errorMessage })
        .where(and(eq(messages.channelId, job.channelId), eq(messages.externalId, s.externalId)))
        .returning({ id: messages.id, conversationId: messages.conversationId });
      if (row) {
        emitToTenant(job.tenantId, 'message:status', {
          conversationId: row.conversationId,
          id: row.id,
          status: s.status,
          errorCode: s.errorCode,
          errorMessage: s.errorMessage,
        });
      }
    }
  });

  /* ★★★ **جدولةُ الردّ خارج المعاملة** — وكانت داخلها. سببان، كلاهما وقع:

     ① **نداءُ شبكةٍ داخل معاملةٍ يحتجز اتّصالاً.** `enqueueReply` نداءُ
        ريدِس، والمعاملةُ تنتظره وهي ممسكةٌ باتّصالٍ من بِركةٍ حجمُها عشرة
        وتزامنُ `ch-inbound` عشرة أيضاً. فحين يسقط ريدِس تتجمّد الاتّصالاتُ
        كلُّها في `idle in transaction` وتتوقّف القاعدةُ عن خدمة أيّ شيء —
        وهذا ما يقيسه `drill-redis.ts` بصفٍّ من `pg_stat_activity`، لا بقراءة
        الكود. والقاعدةُ المكتوبةُ في `reply.ts` صريحة: **لا نداءَ شبكةٍ
        داخل معاملة.**

     ② **ومعاملةٌ تتراجع تترك مهمّةَ ردٍّ على رسالةٍ لا وجودَ لها.** المهمّةُ
        في ريدِس لا تتراجع مع المعاملة: يقرأ العاملُ محادثةً بلا الرسالة
        التي وُلد من أجلها، فيردّ على ما قبلها أو لا يجد شيئاً.

     ⚠️ والفشلُ هنا لا يُبلع: مهمّةٌ لم تُجدوَل تعني رسالةَ زبونٍ بلا ردّ،
        وهو أحقُّ ما يُعاد له رمي الخطأ — تُعاد المهمّةُ كلُّها، وإدراجُ
        الرسائل متماثلٌ على القيد الفريد فلا يتكرّر صفٌّ. */
  if (toReply.size) {
    const { enqueueReply } = await import('./enqueue.js');
    for (const id of toReply) await enqueueReply(id);
  }

  /* ⑥ أحداث الحساب (جودة الرقم، مراجعة WABA) خارج معاملة المستأجر —
     تُنتج حوادث لا رسائل. تُنفَّذ في المرحلة الخامسة. */

  /* ★ ⑦ رسالةٌ وصلت ⟹ الويبهوك ليس صامتاً — والحادثة تُغلق.
     `webhook_silent` كانت مدرجةً في `AUTO_RESOLVABLE` ولا يناديها أحد، فبقيت
     مفتوحةً عند مستأجرٍ حيٍّ بعدّادٍ يتجاوز ٨٠٠ رغم أنّ الرسائل تصل. وحادثةٌ
     لا تُغلق ليست ضجيجاً فحسب: `raiseIncident` لا يُنبّه إلّا إن كانت البصمة
     **جديدة**، فما دامت مفتوحةً فإنّ أيّ انقطاعٍ حقيقيٍّ لاحق يُزيد العدّاد
     بصمتٍ ولا يُنبّه أحداً. أي أنّ الحادثة المفتوحة تُعمي عن نفسها.
     وخارج المعاملة: حلُّ حادثةٍ لا يستحقّ إبقاء معاملة المستأجر مفتوحة. */
  if (sawInbound) {
    const { resolveOpenOfKinds } = await import('./incidents.js');
    await resolveOpenOfKinds(job.tenantId, ['webhook_silent']).catch(() => 0);
  }
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
  /** طابعُ رسالة الزبون كما أرسلته ميتا — لا لحظةُ معالجتنا لها. */
  messageAt?: Date,
) {
  const open = await tx
    .select()
    .from(conversationWindows)
    .where(and(
      eq(conversationWindows.conversationId, conversationId),
      isNull(conversationWindows.closedAt),
    ))
    .limit(1);

  /* ⚠️ لا `sql` fragment في عمود timestamp: drizzle ينادي `.toISOString()`
     على القيمة فيرمي في وقت التشغيل («value.toISOString is not a function»).
     و`as never` كان يُخرس المدقّق فأخفى العطل حتّى أوّل رسالةٍ حقيقيّة. */
  /* ★ النافذة تُحسب من **طابع الرسالة** لا من لحظة المعالجة.
     نافذةُ ميتا تبدأ من طابع رسالة الزبون، والكود كان يبدأها من `Date.now()`.
     في الحالة العاديّة الفرقُ ثوانٍ، لكن بعد انقطاعٍ طويل تعيد ميتا تسليم
     الويبهوكات المتأخّرة فتُفتح نافذةٌ محلّيّةٌ أطولُ من الحقيقيّة بساعات:
     الموظّف يرى «مفتوحة» فيرسل، وميتا ترفض بـ131047. */
  const at = messageAt ?? new Date();
  const expires = new Date(at.getTime() + windowHours * 3600_000);

  if (open[0]) {
    /* ★ ونافذةٌ **انتهت ولم تُغلق بعد** لا تُمدَّد — تُغلق وتُفتح جديدة.
       الإغلاق يجري بمهمّةٍ كلّ عشر دقائق، و`openOrExtendWindow` كانت تعتبر
       أيّ صفٍّ بلا `closed_at` نافذةً حيّةً وتمدّده. فرسالةٌ تصل في تلك
       الفجوة تُمدّد نافذةً مختومةً أصلاً: `billed_at` موجودٌ فلا فحصَ سقفٍ
       ولا ختمٌ جديد، والنافذةُ الجديدة لا تُحتسب لا في السقف ولا في التقرير.
       وقد ثبت هذا الشكل على الخادم: ما بين الانتهاء والدورة التالية ضائع. */
    const cur = open[0];
    if (new Date(cur.expiresAt).getTime() > at.getTime()) {
      await tx
        .update(conversationWindows)
        .set({ expiresAt: expires, messagesIn: sql`${conversationWindows.messagesIn} + 1` })
        .where(eq(conversationWindows.id, cur.id));
      return;
    }
    await tx
      .update(conversationWindows)
      .set({ closedAt: cur.expiresAt })
      .where(eq(conversationWindows.id, cur.id));
    // ثمّ تُفتح جديدةٌ أدناه — والقيد الفريد يضمن ألّا تتزاحم اثنتان
  }

  await tx
    .insert(conversationWindows)
    .values({
      tenantId: job.tenantId,
      conversationId,
      channelId: job.channelId,
      contactId,
      expiresAt: expires,
      messagesIn: 1,
    })
    .onConflictDoNothing();
}
