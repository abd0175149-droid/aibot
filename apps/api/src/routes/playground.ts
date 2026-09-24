import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, botConfigs, botVersions, botTools, knowledgeSources, kbChunks,
  aiRuns, messages, tenantChannels, tenants, auditLog, eq, and, desc, isNull, sql,
} from '@aibot/db';
import {
  AppError, ErrorCode, tenantBlocked, TENANT_BLOCKED_AR,
} from '@aibot/shared';
import { getAdapter, type ChannelKind } from '@aibot/channels';
import { decideKnowledgeMode, estimateTokens } from '@aibot/core';
import { DEFAULT_CHAT_MODEL } from '@aibot/ai';
import { requireAuth, tenantOf } from '../auth.js';
import { runDryReply } from '../queues.js';

/**
 * الساحة — تجربةُ البوت قبل أن يراه زبون.
 *
 * ★ **لماذا توجد هذه الشاشة**: صاحب النشاط يضبط شخصيّةَ بوته ومعرفتَه، ولا
 *   يعرف **ماذا سيقول للزبون** إلّا حين يقوله لزبونٍ حقيقيّ. فالخطأ يُكتشف
 *   على أوّل زبونٍ يخسره. والساحةُ تُزيل هذا: يجرّب، ويرى الردّ، ويرى **لماذا**
 *   كان الردّ هكذا، ويعدّل قبل أن يكلّفه خطأٌ زبوناً.
 *
 * ★ **والقيد الحاكم**: لا إرسالَ إلى واتساب ولا إنستجرام أبداً، ولا محادثةٌ
 *   حقيقيّةٌ تُخلَق، ولا نافذةٌ مفوترة. والتشغيلُ في العامل حيث يسكن كلُّ ما
 *   يُشغّل البوت — وهذا المسار وسيطُه (‏`runDryReply`). راجع
 *   `apps/worker/src/playground.ts`.
 *
 * ★ **والصلاحيّة `settings`** لا `requireAuth()` المجرّدة: الجرّب **يُنفِق**
 *   توكنز الحساب ويكشف شخصيّةَ البوت ومعرفتَه ووسائطَ أدواته. وهو نفسُ ما
 *   يفتح بندَ التنقّل (`needs: 'settings'`) — فلا يرى الموظّفُ بنداً يُرفَض
 *   عليه. والانتحالُ قراءةٌ فقط، فمالكُ المنصّة المنتحلُ لا يُنفِق مال العميل:
 *   الحدُّ يفرضه `requireAuth` على كلّ فعلٍ كاتبٍ بلا سطرٍ هنا.
 */

/** أسئلةٌ شائعةٌ في كلّ نشاطٍ — تُعرض حين لا تاريخَ بعد. */
const COMMON: string[] = [
  'بكم السعر؟',
  'وين موقعكم بالضبط؟',
  'شو أوقات الدوام؟',
  'في توصيل؟',
  'بحتاج أحجز — كيف؟',
  'ممكن أحكي مع موظّف؟',
];

/** سقفُ الجرّب: نداءُ النموذج يُحاسَب، فضغطٌ متسارعٌ يُنفق بلا أن يُقرأ ردّ. */
const PER_MIN = 10;

/**
 * ★ **إلحاقُ معرفةٍ بنصٍّ قائم — دالّةٌ خالصةٌ لأنّها تكتب في معرفة عميل.**
 *
 *   ثلاثة حدودٍ فيها، وكلٌّ منها عطلٌ لو سقط:
 *    ① **العنوانُ من السؤال** (`## …`): `chunkText` يقطّع على العناوين، ومقطعٌ
 *      بلا عنوانٍ يفقد سياقه («٢ دينار» لأيّ خدمة؟). فهذا شرطُ استرجاعٍ لا تنسيق.
 *    ② **سطرٌ فاصلٌ وسطرٌ أخير**: الإلحاقُ على نصٍّ بلا سطرٍ أخيرٍ يلصق الكتلةَ
 *      بآخر سطرٍ فيه فتذوب في المقطع السابق — وهو بعينه ما أنتج `;;` في ملفّ
 *      ترحيلٍ اليوم. و`trimEnd` يمنع تراكمَ الأسطر مع كلّ إضافة.
 *    ③ **لا يمحو ما قبله أبداً**: المعرفةُ القائمة تعود كما هي حرفيّاً في صدر
 *      الناتج — وهذا ما يحرسه الاختبار.
 */
export function appendKnowledge(base: string, question: string, answer: string): string {
  const q = question.replace(/\s+/g, ' ').trim().slice(0, 120);
  const block = `## ${q}\n${answer.trim()}`;
  return base.trim() ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

/**
 * أسئلةٌ جاهزةٌ من **رسائل الزبائن الواردة** — وهي أصدقُ اختبارٍ لبوتك.
 *
 * وثلاثةُ مرشّحاتٍ تمنع اقتراحاً لا يصلح تجربة: المكرّر (نفسُ السؤال من عشرة
 * زبائن)، والقصيرُ جدّاً («تمام») فلا يُجرَّب به شيء، والطويلُ جدّاً (رسالةُ
 * شكوى) فهي ليست سؤالاً.
 */
export function pickPresets(bodies: Array<string | null | undefined>, limit = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of bodies) {
    const t = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < 6 || t.length > 120) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export async function registerPlayground(app: FastifyInstance) {
  const auth = requireAuth({ settings: true });

  /**
   * ملخّصُ ما يمكن تجريبُه — ومعه خطُّ الأساس الذي يُقرأ به رقمُ الشاشة.
   *
   * ★ `liveAvg` ليس زينة: «1,240 توكناً لهذا الردّ» خبرٌ لا حكم. و«ووسطيُّ
   *   ردٍّ حقيقيٍّ عندك 1,100» يجعله قراراً — أغلى أم أرخص، وبكم.
   */
  app.get('/playground', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const cfg = (await tx.select().from(botConfigs)
        .where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];

      const pub = cfg?.publishedVersionId
        ? (await tx.select().from(botVersions)
          .where(eq(botVersions.id, cfg.publishedVersionId)).limit(1))[0]
        : undefined;

      const draft = (cfg?.draft ?? {}) as { persona?: string; knowledgeBase?: string; model?: string };
      const draftKb = String(draft.knowledgeBase ?? '');
      const draftPersona = String(draft.persona ?? '');
      const hasDraft = Boolean(draftPersona.trim() || draftKb.trim());

      const chans = await tx.select({ kind: tenantChannels.kind, status: tenantChannels.status })
        .from(tenantChannels).where(eq(tenantChannels.tenantId, tenantId));
      const chKind = (chans.find((c) => c.status === 'connected')?.kind ?? chans[0]?.kind ?? null);
      const caps = getAdapter((chKind ?? 'whatsapp_cloud') as ChannelKind).capabilities;

      const tools = await tx.select({
        key: botTools.key, titleAr: botTools.titleAr, enabled: botTools.enabled,
        confirmRequired: botTools.confirmRequired, disabledReason: botTools.disabledReason,
      }).from(botTools).where(eq(botTools.tenantId, tenantId));

      const sources = (await tx.select({ n: sql<number>`count(*)::int` })
        .from(knowledgeSources).where(eq(knowledgeSources.tenantId, tenantId)))[0]?.n ?? 0;
      const chunks = pub
        ? (await tx.select({ n: sql<number>`count(*)::int` }).from(kbChunks)
          .where(and(eq(kbChunks.versionId, pub.id), eq(kbChunks.kind, 'chunk'))))[0]?.n ?? 0
        : 0;

      /* ★ أسئلةٌ **حقيقيّة** قبل المخترعة: آخرُ ما سأله زبونٌ فعلاً هو أصدقُ
         اختبارٍ لبوتك — وهو موجودٌ عندك ولا يُستعمل. والمخترعةُ احتياطٌ لمن
         لا تاريخَ له بعد. */
      const recent = await tx.select({ body: messages.body })
        .from(messages)
        .where(and(
          eq(messages.tenantId, tenantId),
          eq(messages.direction, 'in'),
          isNull(messages.deletedAt),
        ))
        .orderBy(desc(messages.createdAt))
        .limit(80);

      const real = pickPresets(recent.map((m) => m.body));

      /* استهلاكُ الساحة نفسِها — فلا يُفاجأ أحدٌ بتوكنز أنفقها في التجربة. */
      const spend = (await tx.select({
        runs: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)::int`,
        usd: sql<string>`coalesce(sum(${aiRuns.costUsd}), 0)::text`,
      }).from(aiRuns).where(and(
        eq(aiRuns.tenantId, tenantId),
        eq(aiRuns.source, 'playground'),
        sql`${aiRuns.createdAt} >= date_trunc('month', now())`,
      )))[0];

      const live = (await tx.select({
        runs: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(avg(${aiRuns.totalTokens}), 0)::int`,
        usd: sql<string>`coalesce(avg(${aiRuns.costUsd}), 0)::text`,
      }).from(aiRuns).where(and(
        eq(aiRuns.tenantId, tenantId),
        eq(aiRuns.source, 'live'),
        sql`${aiRuns.createdAt} > now() - interval '30 days'`,
      )))[0];

      return {
        botEnabled: Boolean(cfg?.enabled),
        draft: hasDraft
          ? {
            personaChars: draftPersona.length,
            kbChars: draftKb.length,
            /* النموذجُ الذي **سيُجرَّب فعلاً** — نفسُ احتياط العامل، فلا يُعرَض
               اسمٌ ويُنادى غيرُه. */
            model: String(draft.model ?? DEFAULT_CHAT_MODEL),
            kbTokens: estimateTokens(draftKb),
            /** وضعُ المعرفة **بعد** النشر — يختلف عن الجرّب، ويُقال قبله لا بعده */
            modeAfterPublish: decideKnowledgeMode(estimateTokens(draftKb)),
            /** هل تختلف عن المنشورة فعلاً؟ فلا يُقال «غيّرتَ» لمن لم يغيّر */
            differs: !pub || pub.persona !== draftPersona || pub.knowledgeBase !== draftKb,
          }
          : null,
        published: pub
          ? {
            version: pub.version,
            provider: pub.provider,
            model: pub.model,
            knowledgeMode: pub.knowledgeMode,
            embedStatus: pub.embedStatus,
            publishedAt: pub.publishedAt,
            kbTokens: estimateTokens(pub.knowledgeBase),
          }
          : null,
        channel: { kind: chKind, connected: chans.some((c) => c.status === 'connected'), maxTextLen: caps.maxTextLen },
        tools: tools.map((t) => ({
          key: t.key,
          titleAr: t.titleAr,
          confirmRequired: t.confirmRequired,
          live: t.enabled && !t.disabledReason,
          disabledReason: t.disabledReason,
        })),
        knowledge: { sources, chunks },
        presets: [
          ...real.map((text) => ({ text, kind: 'real' as const })),
          ...COMMON.filter((c) => !real.length).map((text) => ({ text, kind: 'common' as const })),
        ],
        spend: {
          runs: spend?.runs ?? 0,
          tokens: spend?.tokens ?? 0,
          usd: Number(spend?.usd ?? 0),
        },
        liveAvg: live?.runs
          ? { runs: live.runs, tokens: live.tokens, usd: Number(live.usd) }
          : null,
      };
    });
  });

  /**
   * الجرّب الجافّ.
   *
   * ★ سقفٌ لكلّ دقيقة **محسوبٌ من `ai_runs` نفسِها** لا من عدّادٍ في الذاكرة:
   *   الـAPI قد يعمل بنسختَين، وعدّادُ الذاكرة يُضاعف السقفَ بصمت. والمصدرُ
   *   هو نفسُ الصفوف التي تُحاسَب عليها — فلا يكذب العدّاد على الفاتورة.
   */
  app.post<{ Body: { text?: string; use?: string; history?: Array<{ role?: string; text?: string }> } }>(
    '/playground/run',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);
      const text = String(req.body?.text ?? '').trim();
      if (!text) throw new AppError(ErrorCode.VALIDATION, 'اكتب رسالةَ الزبون أوّلاً.', 400);
      if (text.length > 1200) {
        throw new AppError(ErrorCode.VALIDATION, 'الرسالة أطولُ ممّا يكتبه زبون — اختصرها.', 400);
      }

      const recent = await withTenant(getDb(), tenantId, async (tx) =>
        (await tx.select({ n: sql<number>`count(*)::int` }).from(aiRuns).where(and(
          eq(aiRuns.tenantId, tenantId),
          eq(aiRuns.source, 'playground'),
          sql`${aiRuns.createdAt} > now() - interval '1 minute'`,
        )))[0]?.n ?? 0);
      /* ★ **حسابٌ موقوفٌ كان يُنفق توكنز الساحة بلا حدّ.**
         الإيقافُ كان مفروضاً على الويبهوك وحده — أي على ما يدفعه الزبون —
         وتُرك ما تدفعه المنصّة مفتوحاً: كلُّ تجربةٍ نداءٌ حقيقيٌّ بمفتاح
         المنصّة حين لا يملك العميلُ مفتاحاً. */
      const t = await withTenant(getDb(), tenantId, async (tx) =>
        (await tx.select({ status: tenants.status }).from(tenants)
          .where(eq(tenants.id, tenantId)).limit(1))[0]);
      if (tenantBlocked(t?.status)) {
        throw new AppError(ErrorCode.TENANT_SUSPENDED, TENANT_BLOCKED_AR, 403);
      }

      if (recent >= PER_MIN) {
        throw new AppError(
          ErrorCode.RATE_LIMITED,
          `${PER_MIN} تجاربَ في الدقيقة سقفٌ مقصود — كلُّ تجربةٍ نداءٌ حقيقيٌّ يُحاسَب. انتظر قليلاً.`,
          429,
        );
      }

      const out = await runDryReply({
        tenantId,
        text,
        use: req.body?.use === 'published' ? 'published' : 'draft',
        history: (Array.isArray(req.body?.history) ? req.body!.history! : [])
          .slice(-10)
          .map((h) => ({
            role: h?.role === 'model' ? ('model' as const) : ('user' as const),
            text: String(h?.text ?? ''),
          }))
          .filter((h) => h.text.trim()),
      });

      // فشلٌ متوقَّع يعود بكودٍ ورسالةٍ بشريّة — لا «خطأ داخليّ» على حالةٍ معروفة
      if (!out.ok) throw new AppError(ErrorCode.VALIDATION, out.message, 400);
      return out.trace;
    },
  );

  /**
   * «هذا الردّ خطأ» ⟵ المعرفةُ الناقصة.
   *
   * ★ **ولماذا تُكتب في مسوّدةِ المعرفة لا في `knowledge_sources`.**
   *   هذا هو الفرق بين طريقٍ يعمل وطريقٍ يبدو أنّه يعمل:
   *    · البوتُ في وضع `full` (وهو وضعُ كلّ معرفةٍ تحت 8,000 توكن، أي أكثرُ
   *      العملاء) يقرأ `bot_versions.knowledge_base` **وحدَه** — ومصادرُ
   *      المعرفة لا تُقرأ في هذا الوضع إطلاقاً. فصفٌّ جديدٌ في
   *      `knowledge_sources` يُعرَض في شاشة المعرفة و**لا يصل الزبون أبداً**:
   *      زرٌّ يبدو أنّه أصلح شيئاً ولم يُصلح.
   *    · وأخطرُ من ذلك في `hybrid`/`rag`: عاملُ التضمين يقطّع **المصادر إن
   *      وُجدت، وإلّا `knowledge_base`** — فأوّلُ مصدرٍ يُضاف لحسابٍ لا مصادرَ
   *      له يُسقط نصَّ معرفته كلَّه من النسخة التالية. أي أنّ إضافةَ سطرٍ
   *      تمحو المعرفة.
   *   فالإضافةُ تذهب حيث يقرأ البوتُ فعلاً: مسوّدةُ المعرفة. والعميل يجرّبها
   *   **في الساحة قبل النشر** — وهذه حلقةُ الساحة كلُّها: أخطأ ⟵ أضِف ⟵ جرّب
   *   ⟵ انشر.
   *
   * ★ وقراءةٌ فكتابةٌ **داخل معاملةٍ واحدة**: `PUT /bot/draft` يستبدل الجسم
   *   كلَّه، فلو دمجت الواجهةُ بيدها لمحت تعديلاً جارياً في شاشة البوت.
   */
  app.post<{ Body: { question?: string; answer?: string } }>(
    '/playground/knowledge',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);
      const question = String(req.body?.question ?? '').replace(/\s+/g, ' ').trim();
      const answer = String(req.body?.answer ?? '').trim();
      if (!question || !answer) {
        throw new AppError(ErrorCode.VALIDATION, 'السؤال والجواب الصحيح مطلوبان.', 400);
      }
      if (answer.length > 4000) {
        throw new AppError(ErrorCode.VALIDATION, 'الجواب أطولُ من 4000 حرف — اختصره أو ارفعه ملفّاً.', 400);
      }

      return withTenant(getDb(), tenantId, async (tx) => {
        const cfg = (await tx.select().from(botConfigs)
          .where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
        if (!cfg) throw new AppError(ErrorCode.VALIDATION, 'لا إعداداتَ بوتٍ لحسابك بعد.', 404);

        const draft = (cfg.draft ?? {}) as Record<string, unknown>;
        const pub = cfg.publishedVersionId
          ? (await tx.select({ persona: botVersions.persona, kb: botVersions.knowledgeBase })
            .from(botVersions).where(eq(botVersions.id, cfg.publishedVersionId)).limit(1))[0]
          : undefined;

        /* مسوّدةٌ فارغةٌ تبدأ من المنشورة لا من الصفر — وإلّا محا أوّلُ تصحيحٍ
           شخصيّةَ البوت ومعرفتَه كلَّها عند أوّل نشر. */
        const persona = String(draft.persona ?? pub?.persona ?? '');
        const base = String(draft.knowledgeBase ?? pub?.kb ?? '');

        /* عنوانٌ من السؤال: `chunkText` يقطّع على العناوين، والمقطعُ بلا عنوانٍ
           يفقد سياقه — فهذا ليس تنسيقاً بل شرطُ استرجاعٍ صحيح. */
        const block = `## ${question.slice(0, 120)}\n${answer}`;
        const knowledgeBase = base.trim() ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;

        await tx.insert(botConfigs)
          .values({ tenantId, draft: { ...draft, persona, knowledgeBase }, updatedBy: req.auth!.sub })
          .onConflictDoUpdate({
            target: botConfigs.tenantId,
            set: {
              draft: { ...draft, persona, knowledgeBase },
              updatedBy: req.auth!.sub,
              updatedAt: new Date(),
            },
          });

        await tx.insert(auditLog).values({
          tenantId, actorUserId: req.auth!.sub,
          action: 'bot.knowledge_gap_filled', entity: 'bot_config', entityId: cfg.id, ip: req.ip,
        });

        const tokens = estimateTokens(knowledgeBase);
        return {
          ok: true,
          kbTokens: tokens,
          kbChars: knowledgeBase.length,
          modeAfterPublish: decideKnowledgeMode(tokens),
        };
      });
    },
  );
}
