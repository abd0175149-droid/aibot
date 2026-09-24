import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  getDb, withTenant, withPlatform, botConfigs, botVersions, botTools, knowledgeSources, aiRuns,
  kbChunks, auditLog, prices, eq, and, desc, sql, type Tx,
} from '@aibot/db';
import {
  AppError, ErrorCode, BotBehaviorPatch, BotToolUpsert, BotToolPatch,
} from '@aibot/shared';
import { seal } from '@aibot/crypto';
import { DEFAULT_CHAT_MODEL } from '@aibot/ai';
import { decideKnowledgeMode, estimateTokens, linkHostsFrom, execHttpTool, assertPublicUrl, type HttpToolSpec } from '@aibot/core';
import { requireAuth, tenantOf } from '../auth.js';
import { enforceRate } from '../ratelimit.js';
import { enqueueEmbed, enqueueIngest } from '../queues.js';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function registerBot(app: FastifyInstance) {
  const auth = requireAuth({ settings: true });

  app.get('/bot', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
      const published = cfg?.publishedVersionId
        ? (await tx.select().from(botVersions).where(eq(botVersions.id, cfg.publishedVersionId)).limit(1))[0]
        : null;
      return {
        config: cfg ?? null,
        published: published
          ? {
            ...published,
            /* يُرفَع من `params` إلى السطح: الشاشة تقارنه بما في القائمة
               لتعرف أنّ ملفّاً رُفع أو حُذف بعد آخر نشر. */
            sourceChars: ((published.params ?? {}) as { sourceChars?: number }).sourceChars ?? 0,
          }
          : null,
        draft: cfg?.draft ?? null,
        /* ★ طابعُ المسوّدة تحمله الشاشةُ وتُعيده عند الحفظ — فيُكتشف أنّ
           غيرَها كتب بعد أن قرأت، بدل أن تمحوَ عملَه بصمت. */
        draftUpdatedAt: cfg?.updatedAt?.toISOString() ?? null,
      };
    });
  });

  /**
   * ★ **سلوكُ البوت — أربعةُ حقولٍ يقرؤها العاملُ ولم يكن يكتبها أحد.**
   *
   *   `pause_minutes` و`fail_message` و`outside_hours_message` و`business_hours`
   *   كلُّها في المخطّط، ويقرؤها `reply.ts` في كلّ ردّ. ولا مسارَ يكتبها —
   *   لا للمالك ولا للمنصّة — ولا خطوةَ في معالج التهيئة. فمطعمٌ يغلق منتصف
   *   الليل يظلّ بوته يأخذ حجوزاتٍ الثالثةَ فجراً، ورسالةُ العجز الافتراضيّة
   *   بلهجةٍ قد لا تناسب النشاط لا تُستبدل.
   *
   * ★ وهي **ليست** من المسوّدة: لا تُنشر ولا تُراجَع ولا يُتراجَع عنها بنشر
   *   نسخةٍ قديمة. هي إعدادُ تشغيلٍ يسري لحظةَ حفظه — ولذلك مسارٌ مستقلّ
   *   وصفُّ تدقيقٍ معه، لا حقلٌ في `draft`.
   */
  app.patch<{ Body: unknown }>('/bot/config', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    const parsed = BotBehaviorPatch.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, 'قيمةٌ غير صالحة', 400, parsed.error.issues);
    }
    const p = parsed.data;

    /* ★ ونطاقٌ ينتهي قبل أن يبدأ يُرفَض هنا لا يُترك للعامل: `withinBusinessHours`
       يعامل `to <= from` نطاقاً **عابراً لمنتصف الليل**، فخطأٌ مطبعيٌّ
       («17:00–09:00» بدل «09:00–17:00») يفتح الدوامَ ستَّ عشرةَ ساعةً بدل
       ثمانٍ — بلا رسالةٍ ولا علامة. والقصدُ يُسأل عنه عند الكتابة. */
    if (p.businessHours) {
      for (const [day, ranges] of Object.entries(p.businessHours.days)) {
        for (const [from, to] of ranges ?? []) {
          if (to === from) {
            throw new AppError(
              ErrorCode.VALIDATION,
              `نطاقٌ في ${day} يبدأ وينتهي في اللحظة نفسها — احذفه أو صحّحه.`,
              400,
            );
          }
        }
      }
    }

    return withTenant(getDb(), tenantId, async (tx) => {
      const set: Record<string, unknown> = { updatedBy: req.auth!.sub, updatedAt: new Date() };
      if (p.pauseMinutes !== undefined) set.pauseMinutes = p.pauseMinutes;
      if (p.failMessage !== undefined) set.failMessage = p.failMessage?.trim() || null;
      if (p.outsideHoursMessage !== undefined) {
        set.outsideHoursMessage = p.outsideHoursMessage?.trim() || null;
      }
      if (p.businessHours !== undefined) set.businessHours = p.businessHours;

      const [row] = await tx.insert(botConfigs)
        .values({ tenantId, ...set } as typeof botConfigs.$inferInsert)
        .onConflictDoUpdate({ target: botConfigs.tenantId, set })
        .returning();

      await tx.insert(auditLog).values({
        tenantId, actorUserId: req.auth!.sub,
        action: 'bot.config', entity: 'bot_config', entityId: tenantId,
        diff: p as object, ip: req.ip,
      });
      return row;
    });
  });

  /**
   * ★ **حفظُ المسوّدة دمجٌ لا استبدال — وكان استبدالاً صامتاً يُفقد البوتَ نصفَه.**
   *
   *   الشاشةُ ترسل حقلَين (`persona` و`knowledgeBase`)، وهذا المسارُ كان يكتب
   *   جسمَ الطلب **مكان المسوّدة كلّها**. والنشرُ يقرأ من المسوّدة أيضاً:
   *   `toolsConfig` و`params` (وفيها `linkHosts` و`constraints`) و`provider`
   *   و`model` و`knowledgeBudget`. فأوّلُ حفظٍ روتينيٍّ من الشاشة يمحوها،
   *   وأوّلُ نشرٍ بعده يُعوّضها بالفراغ والافتراضات.
   *
   *   والأثرُ على مستأجرٍ حيٍّ **ثلاثةُ أعطالٍ دفعةً واحدة، بلا رسالةٍ ولا
   *   خطأ**: البوت يفقد أدواته المدمجة كلَّها — بما فيها التحويل لموظّف —
   *   وتُحذف كلُّ الروابط المسموحة من ردوده (فالحارسُ يمحو ما ليس في قائمةٍ
   *   فارغة)، ويُبدَّل نموذجُه إلى الافتراضيّ فتتغيّر فاتورتُه بلا قرارٍ من
   *   أحد. وكلُّ ذلك من ضغطة «حفظ» على تعديل جملةٍ في الشخصيّة.
   *
   * ★ **وتفاؤليّةُ التزامن فوق الدمج.** المسوّدةُ واحدةٌ لكلّ مستأجر،
   *   وتكتب فيها شاشةُ البوت **والساحةُ** معاً. فبلا شرطٍ على النسخة يفوز
   *   آخرُ كاتبٍ بصمت: تصحيحٌ أضافه المالك من الساحة يُمحى بحفظٍ تلقائيٍّ من
   *   تبويبٍ آخر مفتوح، والساحةُ قالت «أُضيف». ثمّ يعود البوتُ إلى الخطأ
   *   نفسِه أمام الزبون — فيفقد المالك ثقتَه بحلقة «أخطأ ← أضِف ← جرّب ← انشر»
   *   كلِّها، وهي حلقةُ المنتج الأساسيّة.
   */
  app.put<{ Body: Record<string, unknown> & { expectedUpdatedAt?: string | null } }>(
    '/bot/draft',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);
      const { expectedUpdatedAt, ...patch } = req.body ?? {};

      return withTenant(getDb(), tenantId, async (tx) => {
        const cfg = (await tx.select().from(botConfigs)
          .where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];

        /* ★ التعارضُ يُقال ولا يُبتلع: الشاشةُ تعرض «تغيّرت من مكانٍ آخر»
           وتُعطي زرَّ «حمّل الأحدث» بدل أن تكتب فوق عمل غيرها. */
        if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && cfg) {
          const seen = new Date(expectedUpdatedAt).getTime();
          const now = cfg.updatedAt?.getTime() ?? 0;
          if (Number.isFinite(seen) && seen !== now) {
            throw new AppError(
              ErrorCode.CONFLICT,
              'تغيّرت المسوّدة من مكانٍ آخر بعد أن فتحتَ هذه الشاشة — حمّل الأحدث قبل الحفظ.',
              409,
              { draft: cfg.draft ?? null, updatedAt: cfg.updatedAt?.toISOString() ?? null },
            );
          }
        }

        /* ★ والقاعدةُ التي تُملأ منها المسوّدةُ الغائبة هي **النسخة المنشورة**
           لا الفراغ: مستأجرٌ نُشرت نسختُه بسكربتٍ (وهو حالٌ قائم) لا مسوّدةَ
           له إطلاقاً، فأوّلُ حفظٍ كان يُنشئها من حقلَين وينسى الباقي. */
        const base = (cfg?.draft ?? {}) as Record<string, unknown>;
        const seed = Object.keys(base).length ? base : await seedFromPublished(tx, tenantId);
        const draft = { ...seed, ...patch };

        const [row] = await tx.insert(botConfigs)
          .values({ tenantId, draft: draft as object, updatedBy: req.auth!.sub })
          .onConflictDoUpdate({
            target: botConfigs.tenantId,
            set: { draft: draft as object, updatedBy: req.auth!.sub, updatedAt: new Date() },
          })
          .returning();
        return row;
      });
    },
  );

  /**
   * بذرةُ المسوّدة من النسخة المنشورة — كلُّ ما يقرؤه النشرُ ولا ترسله الشاشة.
   * وبلا هذا يكون «الاحتياط» فراغاً، والفراغُ في `linkHosts` يعني **حذفَ كلّ
   * رابطٍ** من كلّ ردّ، وفي `toolsConfig` يعني بوتاً لا يحوّل لموظّف.
   */
  async function seedFromPublished(tx: Tx, tenantId: string): Promise<Record<string, unknown>> {
    const cfg = (await tx.select({ v: botConfigs.publishedVersionId }).from(botConfigs)
      .where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
    if (!cfg?.v) return {};
    const ver = (await tx.select().from(botVersions).where(eq(botVersions.id, cfg.v)).limit(1))[0];
    if (!ver) return {};
    return {
      persona: ver.persona,
      knowledgeBase: ver.knowledgeBase,
      toolsConfig: ver.toolsConfig ?? {},
      params: ver.params ?? {},
      provider: ver.provider,
      model: ver.model,
      knowledgeBudget: ver.knowledgeBudget ?? {},
    };
  }

  /**
   * النشر.
   *
   * ينشئ نسخةً جديدة — ولا يعدّل في مكانه أبداً، فالتراجع نشرُ نسخةٍ قديمة.
   * وحين تتجاوز المعرفة العتبة، النشر **غير متزامن**: يُوسم `pending` ويُدفع
   * التضمين للطابور، والنسخة القديمة تخدم حتّى تجهز الجديدة. فلا محادثةٌ
   * جارية ترى معرفةً نصفَ مضمَّنة.
   */
  /**
   * النشر — مُستخرَجٌ بمعرّف مستأجرٍ صريح ليُستدعى من مسار العميل **ومن معالج
   * التهيئة في لوحة المالك** بلا نسخ منطق. نسخُ منطق النشر كان سيُنتج مسارَين
   * يتباعدان مع أوّل تعديلٍ على وضع المعرفة.
   */
  async function publishVersion(tenantId: string, actorUserId: string, note: string | null) {
    /* ★ **مهمّةُ التضمين تُدفع بعد الإيداع لا داخله.**
       كانت `enqueueEmbed` تُنادى داخل `withTenant`، أي **قبل** أن تُودَع
       المعاملة. وريديس أسرع من إيداعٍ في بوستجرس: العامل يبدأ ويقرأ
       `bot_versions` فلا يجد الصفّ بعد، فيخرج من `if (!ver) return` **ناجحاً**
       — مهمّةٌ «مكتملة» بلا عمل. والنسخة تبقى `embedStatus: 'pending'` إلى
       الأبد، وبوّابةُ `pending` في عامل الردّ تُسكت بوت العميل بلا رجعة وبلا
       حادثة. ولا يظهر العطل في التجربة: على مضيفٍ محمَّلٍ يتأخّر العامل
       فيمرّ، وعلى مضيفٍ سريعٍ يسبق فيُعطب.
       و`jobId` الثابت (`embed-<versionId>`) يجعل الدفعَ المتأخّر آمناً: لا
       نسخةَ ثانيةً من المهمّة أيّاً كان عدد النداءات. */
    let pendingEmbed: { tenantId: string; versionId: string } | null = null;

    const out = await withTenant(getDb(), tenantId, async (tx) => {
      const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
      const saved = (cfg?.draft ?? {}) as Record<string, unknown>;
      if (!cfg || !Object.keys(saved).length) {
        throw new AppError(ErrorCode.VALIDATION, 'لا مسوّدة لنشرها', 400);
      }

      /* ★ **الاحتياطُ هو النسخة المنشورة لا الفراغ.**
         كلُّ حقلٍ غائبٍ عن المسوّدة كان يُعوَّض بـ`{}` أو باسم نموذجٍ مكتوبٍ
         نصّاً. فمسوّدةٌ من حقلَين — وهو ما كانت الشاشةُ تنتجه — تُخرج نسخةً
         بلا أدواتٍ وبلا روابطَ مسموحة وبنموذجٍ غير الذي كان يعمل.
         والدمجُ في الحفظ يمنع هذا من الآن، وهذا يمنعه **بأثرٍ رجعيّ** عن
         كلّ مسوّدةٍ ناقصةٍ محفوظةٍ قبل اليوم. */
      const draft = { ...(await seedFromPublished(tx, tenantId)), ...saved };

      const last = (await tx.select({ v: botVersions.version }).from(botVersions)
        .where(eq(botVersions.tenantId, tenantId)).orderBy(desc(botVersions.version)).limit(1))[0];

      const kb = String(draft.knowledgeBase ?? '');

      /* ★ **المعرفةُ الفعّالة = نصُّ الحقل + الملفّاتُ الجاهزة.**
         كان القرار يُبنى على `estimateTokens(kb)` وحده، والتضمينُ يأخذ
         الملفّات **أو** النصّ لا كليهما. فصاحبُ مطعمٍ يرفع قائمةَ PDF ويكتب
         سطرَين يحصل على وضع `full` بنصٍّ من سطرَين — والقائمةُ كلُّها لا تصل
         النموذج أبداً، والشاشةُ خضراء والملفّ «استُخرج نصُّه». أي أنّ ميزة
         رفع الملفّات كانت ميّتةً عمليّاً لكلّ من نصُّه دون العتبة — وهي
         الشريحةُ المستهدَفة بعينها. */
      const ready = await tx.select({ id: knowledgeSources.id, text: knowledgeSources.extractedText })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.tenantId, tenantId), eq(knowledgeSources.status, 'ready')));
      const fileText = ready.map((r) => (r.text ?? '').trim()).filter(Boolean).join('\n\n');

      /* وفي وضع `full` تُحقن المعرفةُ كلُّها نصّاً، فالنسخةُ تحمل المركَّب.
         وفي غيره يُقطَّع الاثنان في `embed.ts` فلا حاجة إلى الدمج هنا. */
      const kbTokens = estimateTokens(kb) + estimateTokens(fileText);
      const mode = decideKnowledgeMode(kbTokens);
      const effectiveKb = mode === 'full' && fileText
        ? [kb.trim(), fileText].filter(Boolean).join('\n\n')
        : kb;

      const provider = String(draft.provider ?? 'google');
      /* ولا اسمَ نموذجٍ مكتوبٍ نصّاً: ثابتُ الحزمة يتغيّر في موضعٍ واحد. */
      const model = String(draft.model ?? DEFAULT_CHAT_MODEL);

      /* ★ لا نشرَ لنموذجٍ بلا سعر.
         العطل الذي وُلد منه هذا الفحص: نسخةٌ نُشرت على نموذجٍ لا صفَّ سعرٍ له،
         فصار كلّ ردٍّ يُفوتَر **صفراً** بصمت — والتقارير تُظهر هامشاً كاملاً
         عن نموذجٍ يُكلّف فعلاً — ويرفع حادثة price_missing مع كلّ ردّ.
         والمنع هنا لا في العامل: العامل يكتشفه بعد أن يُنفَق المال، وهذا
         يمنعه قبل أن يُنشر. والرسالة تقول ما يُفعل لا «قيمةٌ غير صالحة». */
      const priced = await tx.select({ model: prices.model }).from(prices)
        .where(and(eq(prices.provider, provider), eq(prices.model, model))).limit(1);
      if (!priced.length) {
        throw new AppError(
          ErrorCode.VALIDATION,
          `لا سعرَ مسجَّلٌ للنموذج ${model} — أضِف صفّه في جدول prices قبل النشر، `
          + 'وإلّا فكلفة كلّ ردٍّ تُحسب صفراً بصمت.',
          400,
        );
      }

      const [ver] = await tx.insert(botVersions).values({
        tenantId,
        version: (last?.v ?? 0) + 1,
        persona: String(draft.persona ?? ''),
        knowledgeBase: effectiveKb,
        toolsConfig: (draft.toolsConfig ?? {}) as object,
        provider,
        model,
        /* ★ `linkHosts` تُستخرج من الشخصيّة والمعرفة عند كلّ نشر — ولا تُملأ
           يدويّاً. كانت القائمة فارغةً عند كلّ مستأجر لأنّ لا مسارَ ولا شاشةَ
           تضبطها، فكان الحارس يحذف **كلّ** رابطٍ من كلّ ردّ: الزبون يقرأ
           «موقعنا على الخريطة:» ثمّ فراغاً. والقاعدة تبقى قائمةً كما هي —
           لا يخرج رابطٌ لم يكتبه المالك — لكنّ ما كتبه يخرج.
           وما ضبطه المالك صراحةً في المسوّدة يُضمّ ولا يُستبدل. */
        params: {
          ...((draft.params ?? {}) as Record<string, unknown>),
          /* ★ مجموع أحرف الملفّات التي دخلت هذه النسخة — وبه تعرف الشاشة
             أنّ ملفّاً رُفع بعدها فتفتح زرّ النشر. */
          sourceChars: ready.reduce((n, r) => n + (r.text ?? '').length, 0),
          linkHosts: [...new Set([
            ...(Array.isArray((draft.params as { linkHosts?: unknown })?.linkHosts)
              ? ((draft.params as { linkHosts: string[] }).linkHosts)
              : []),
            ...linkHostsFrom(String(draft.persona ?? ''), kb),
          ])],
        } as object,
        knowledgeMode: mode,
        /* ★ ميزانيّةٌ تسع المعرفة في وضع الحقن الكامل — وكانت تقصّها بصمت.
           `DEFAULT_BUDGET.core` ‏١٢٠٠ توكن، و`fit` تقصّ عند ١٢٠٠×٢٫٥ حرفاً
           ثمّ تكتب `trimmed` في `context_meta` ولا يقرؤه أحد. فكلّ معرفةٍ بين
           ١٢٠٠ و٨٠٠٠ توكن — وهي الشريحة الأشيع — كان البوت يجهل ما بعد أوّل
           ثلاثة آلاف حرفٍ منها، ويقول «لا أعرف» عن معلومةٍ مكتوبةٍ عنده.
           والسقفُ يُحسب من الحجم الفعليّ مع هامشٍ يسير، فلا يُقصّ ولا يُفتح
           بلا حدّ. */
        knowledgeBudget: {
          ...((draft.knowledgeBudget ?? {}) as Record<string, number>),
          ...(mode === 'full'
            ? { core: Math.max(1_200, Math.ceil(estimateTokens(effectiveKb) * 1.1) + 200) }
            : {}),
        } as object,
        embedStatus: mode === 'full' ? 'skipped' : 'pending',
        publishedBy: actorUserId,
        publishedAt: new Date(),
        note,
      }).returning();

      /* ★ **أوّلُ نشرٍ يُشعل البوت** — ولم يكن يفعل.
         `bot_configs.enabled` افتراضه `false`، والإنشاء من اللوحة لا يمسّه،
         والنشر لا يمسّه، ولا شيء في المسار يمسّه. فكان العميل ينشر بنجاح
         وتقول له الشاشة «بوتك يردّ بها من الآن» ويقول المعالج «منشورٌ
         ويستقبل» — والبوت مطفأ، وكلّ رسالةٍ تصل تُسقَط عند البوّابة الأولى
         في `reply.ts` بلا سجلٍّ ولا حادثة.
         والشرط `!cfg.publishedVersionId` لا زينة: **أوّل** نشرٍ وحده يُشعل.
         فمن أطفأ بوته عمداً ثمّ عدّل نصّه ونشر لا يُشعَل من تحته — وذاك قرارٌ
         له لا لنا. */
      const firstPublish = !cfg.publishedVersionId;

      // النسخة الجديدة تُنشر فوراً في وضع full، وتنتظر التضمين في غيره
      if (mode === 'full') {
        await tx.update(botConfigs)
          .set({ publishedVersionId: ver!.id, ...(firstPublish ? { enabled: true } : {}) })
          .where(eq(botConfigs.tenantId, tenantId));
      } else {
        if (firstPublish) {
          await tx.update(botConfigs).set({ enabled: true })
            .where(eq(botConfigs.tenantId, tenantId));
        }
        pendingEmbed = { tenantId, versionId: ver!.id };
      }

      /* `live` تقول الحقيقة للشاشة: هل يردّ البوت **الآن**؟ وهي شرطان معاً —
         مُشعَلٌ، ونسخةٌ منشورةٌ فعلاً (لا تنتظر تضميناً). */
      const live = (firstPublish || cfg.enabled) && mode === 'full';
      return {
        version: ver, knowledgeMode: mode, kbTokens, embedding: mode !== 'full', live,
        /* ما دخل النسخة فعلاً — تعرضه ورقة النشر بدل أن تُخمّن. */
        sources: { text: estimateTokens(kb), files: estimateTokens(fileText), fileCount: ready.length },
      };
    });

    /* الآن وقد أُودعت المعاملة، الصفُّ مقروءٌ لأيّ عاملٍ يبدأ في هذه اللحظة. */
    if (pendingEmbed) await enqueueEmbed(pendingEmbed);
    return out;
  }

  app.post<{ Body: { note?: string } }>('/bot/publish', { preHandler: auth }, async (req) =>
    publishVersion(tenantOf(req), req.auth!.sub, req.body?.note ?? null));

  /**
   * ★ بذرُ بوتٍ لعميلٍ من لوحة المالك — الخطوتان ٣ و٤ في معالج التهيئة.
   *
   * ولماذا مسارٌ صريحٌ لا انتحال: الانتحال **قراءةٌ فقط** وذاك قرارٌ يُصان،
   * فلو سُمح له بالكتابة صار لدينا مسارٌ يكتب في بيانات عميلٍ بهويّةٍ مستعارة
   * وصار سجلّ التدقيق كاذباً. هنا المستأجر في العنوان، والفعل مسجَّلٌ باسم
   * فاعلٍ حقيقيّ، والعميل يراه في سجلّه.
   *
   * وهو **بذرٌ لا استبدال**: يرفض إن كان للعميل نسخةٌ منشورةٌ أصلاً، فلا يمسح
   * معالجُ تهيئةٍ فُتح بالخطأ شخصيّةَ عميلٍ يعمل.
   */
  app.post<{ Params: { id: string }; Body: { persona?: string; knowledgeBase?: string; note?: string } }>(
    '/console/tenants/:id/bot/seed',
    { preHandler: requireAuth({ console: true }) },
    async (req) => {
      const tenantId = req.params.id;
      const persona = String(req.body?.persona ?? '').trim();
      const knowledgeBase = String(req.body?.knowledgeBase ?? '').trim();
      if (!persona || !knowledgeBase) {
        throw new AppError(ErrorCode.VALIDATION, 'الشخصيّة والمعرفة مطلوبتان', 400);
      }

      await withTenant(getDb(), tenantId, async (tx) => {
        const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
        if (!cfg) throw new AppError(ErrorCode.VALIDATION, 'لا إعداداتَ بوتٍ لهذا العميل', 404);
        if (cfg.publishedVersionId) {
          throw new AppError(
            ErrorCode.VALIDATION,
            'لهذا العميل نسخةٌ منشورةٌ بالفعل — عدّلها من شاشة بوته لا من معالج التهيئة.',
            409,
          );
        }
        await tx.update(botConfigs).set({ draft: { persona, knowledgeBase } })
          .where(eq(botConfigs.tenantId, tenantId));
      });

      const out = await publishVersion(tenantId, req.auth!.sub, req.body?.note ?? 'أوّل نشرٍ من معالج التهيئة');

      await withPlatform(getDb(), 'تدقيق: بذر بوتٍ لعميل من لوحة المالك', (tx) =>
        tx.insert(auditLog).values({
          tenantId, actorUserId: req.auth!.sub,
          action: 'bot.seed', entity: 'bot_version', entityId: out.version!.id, ip: req.ip,
        }));

      return out;
    },
  );

  app.get('/bot/versions', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) =>
      tx.select({
        id: botVersions.id, version: botVersions.version, note: botVersions.note,
        publishedAt: botVersions.publishedAt, knowledgeMode: botVersions.knowledgeMode,
        embedStatus: botVersions.embedStatus,
      }).from(botVersions).where(eq(botVersions.tenantId, tenantId))
        .orderBy(desc(botVersions.version)).limit(50));
  });

  /** التراجع = نشرُ نسخةٍ قديمة. لا تعديلَ في مكانه ولا فقدان تاريخ. */
  app.post<{ Params: { id: string } }>('/bot/versions/:id/rollback', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const ver = (await tx.select().from(botVersions).where(eq(botVersions.id, req.params.id)).limit(1))[0];
      if (!ver) throw new AppError(ErrorCode.VALIDATION, 'نسخةٌ غير موجودة', 404);
      if (ver.embedStatus === 'pending') {
        throw new AppError(ErrorCode.VALIDATION, 'هذه النسخة ما زالت تُضمَّن', 409);
      }

      /* ★ ولا تراجعَ إلى نسخةٍ **فشل** تضمينها.
         كان الفحص يمنع `pending` وحدها. و`failed` تعني أنّ `kb_chunks` لا
         يحمل عن هذه النسخة مقطعاً واحداً: فتُنشر، ويعمل البوت — ويجيب «لا
         أعرف» عن **كلّ** سؤالٍ في معرفته. وهذا أسوأ من بوتٍ صامت: المالك
         يرى بوته يردّ، فيقرأ العطل جهلاً في النموذج لا خللاً في نسخته، ولا
         شيء في الشاشة يربط الأمرَ بتضمينٍ فشل قبل أسبوع.
         والشاشة تعرض `embedStatus` في قائمة النسخ، فالرسالةُ تقول ما يُفعل. */
      if (ver.embedStatus === 'failed') {
        throw new AppError(
          ErrorCode.VALIDATION,
          'فشل تجهيزُ معرفة هذه النسخة، فلا مقاطعَ لها في قاعدة البحث — '
          + 'لو نُشرت أجاب البوت «لا أعرف» عن كلّ شيء. انشر مسوّدتك من جديد '
          + 'لتُجهَّز المعرفة، أو تراجَع إلى نسخةٍ مكتملة.',
          409,
        );
      }
      await tx.update(botConfigs).set({ publishedVersionId: ver.id })
        .where(eq(botConfigs.tenantId, tenantId));
      return { ok: true, version: ver.version };
    });
  });

  /**
   * ★ التبديل — ويُنشئ الصفّ إن لم يكن.
   *
   *   كان `update ... returning()` وحده: مستأجرٌ بلا صفّ `bot_configs` (وهو
   *   حالٌ قائمٌ على الخادم — عميلٌ أُنشئ خارج المعالج) يُصيب صفر صفوف، فيعود
   *   `undefined` ويُردّ **جسمٌ فارغ بـ200**. والزرّ يفشل دائماً بتوستةٍ عامّة،
   *   والمالك لا يعرف أنّ السبب صفٌّ ناقصٌ لا عطلٌ في الشبكة.
   *   و`onConflictDoUpdate` يُصلح الحالتين بعبارةٍ واحدة: يُنشئ الناقص،
   *   ويبدّل القائم — والصفّ الجديد يرث الافتراضات كما لو أُنشئ مع العميل.
   */
  app.post<{ Body: { enabled: boolean } }>('/bot/toggle', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    const enabled = Boolean(req.body?.enabled);
    return withTenant(getDb(), tenantId, async (tx) => {
      const [row] = await tx.insert(botConfigs)
        .values({ tenantId, enabled, updatedBy: req.auth!.sub })
        .onConflictDoUpdate({
          target: botConfigs.tenantId,
          set: { enabled, updatedBy: req.auth!.sub, updatedAt: new Date() },
        })
        .returning();
      return row;
    });
  });

  /* ───────────────────────── الأدوات ───────────────────────── */

  app.get('/bot/tools', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const rows = await tx.select().from(botTools).where(eq(botTools.tenantId, tenantId));
      // لا يُعاد سرٌّ للواجهة أبداً — حتّى وجوده يُعرض كعلمٍ لا كقيمة
      return rows.map(({ secretsEnc, ...rest }) => ({ ...rest, hasSecrets: Boolean(secretsEnc) }));
    });
  });

  app.post<{ Body: Record<string, any> }>('/bot/tools', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);

    /* ★ **مخطّطٌ واحدٌ خاطئ كان يُسكت كلَّ ردود هذا المستأجر.**
       الإعلاناتُ تذهب إلى المزوّد في مصفوفةٍ واحدة، فعنصرٌ مشوَّهٌ يُبطل
       الطلبَ كلَّه بـ400 — لا «أداةٌ لا تعمل» بل **لا ردَّ إطلاقاً** على كلّ
       رسالةٍ تصل. وكان المسارُ يقبل أيّ JSON: `String(b.key)` تحويلٌ لا
       تحقّق — `undefined` تصير النصّ «undefined»، وكائنٌ يصير
       «[object Object]»، والعربيّةُ تمرّ. */
    const parsed = BotToolUpsert.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, 'أداةٌ غير صالحة', 400, parsed.error.issues);
    }
    const b = parsed.data as Record<string, any>;
    if (b.http?.url) await assertPublicUrl(String(b.http.url)).catch((e) => {
      throw new AppError(ErrorCode.TOOL_BLOCKED, (e as Error).message, 400);
    });
    return withTenant(getDb(), tenantId, async (tx) => {
      const sealed = b.secrets ? seal(JSON.stringify(b.secrets)) : null;
      const [row] = await tx.insert(botTools).values({
        tenantId,
        key: String(b.key), titleAr: String(b.titleAr), description: String(b.description),
        kind: 'http',
        requiresCapabilities: Array.isArray(b.requiresCapabilities) ? b.requiresCapabilities : [],
        paramsSchema: b.paramsSchema ?? { type: 'object', properties: {} },
        http: b.http ?? null,
        responseMap: b.responseMap ?? null,
        secretsEnc: sealed?.enc ?? null,
        keyVersion: sealed?.keyVersion ?? 1,
        confirmRequired: Boolean(b.confirmRequired),
        confirmTemplate: b.confirmTemplate ?? null,
        /* ★ **تُنشأ معطَّلةً ما لم يُقَل غيرُ ذلك صراحةً.**
           التجربةُ تحتاج صفّاً محفوظاً (السرُّ مشفَّرٌ في القاعدة)، فالباني
           يحفظ عند أوّل ضغطةٍ على «جرّبها». وكان الصفُّ يُنشأ **مفعَّلاً**،
           وعاملُ الردّ يعرض كلَّ أداةٍ مفعَّلةٍ على النموذج في كلّ رسالة بلا
           علاقةٍ بالنسخة المنشورة. فأداةٌ نصفُ مبنيّةٍ — مسارٌ خاطئ، بلا
           خريطةِ ردّ، بلا تأكيد — تصير في متناول البوت أمام الزبائن من
           **لحظة الضغط على «جرّبها»**. ثمّ تُخفق حتّى يفتح قاطعُ الدائرة،
           فيقرأ المالك «أداةٌ عُطِّلت آليّاً» قبل أن يفهم ما جرى.
           و«احفظ الأداة» هو ما يُفعّلها. */
        enabled: b.enabled === true,
      }).returning();
      const { secretsEnc, ...safe } = row!;
      return safe;
    });
  });

  /**
   * زرّ «تجربة».
   * يُنفّذ النداء بعيّنةٍ ويعرض الطلب والاستجابة والحقول المستخرَجة **قبل الحفظ** —
   * فلا يكتشف العميل خطأ المسار من ردٍّ خاطئٍ لزبون.
   */
  app.post<{ Params: { id: string }; Body: { sampleParams?: Record<string, unknown> } }>(
    '/bot/tools/:id/test',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);

      /* ★ **حدٌّ على التجربة — وبلاه عطلٌ ذاتيٌّ عابرٌ للمستأجرين.**
         الطلبُ متاحٌ لكلّ صاحب صلاحيّةِ إعدادات، والنداءُ خارجيٌّ بمهلةٍ
         طويلة. فمالكٌ واحدٌ يضغط «جرّب» عشرَ مرّاتٍ على أداةٍ خادمُها لا
         يجيب كان يحتجز بِركةَ الاتّصالات كلَّها (عشرةٌ فقط) — فتتوقّف كلُّ
         مسارات الـAPI **لكلّ المستأجرين**، ويفشل الويبهوك في حلّ مستأجره.
         فعلٌ بريءٌ من مالكٍ واحدٍ يُسقط المنصّة. */
      await enforceRate(
        [{ key: `rl:tooltest:${tenantId}`, limit: 5, windowSec: 60 }],
        'جرّبتَ الأداة خمسَ مرّاتٍ في الدقيقة — انتظر قليلاً. والنداءُ الخارجيّ قد يكون بطيئاً.',
      );

      /* ★ **القراءةُ في معاملةٍ قصيرة، والنداءُ الخارجيُّ خارجها.**
         كان `execHttpTool` يجري **داخل** `withTenant`: خادمُ العميل البطيء
         يحتجز اتّصالَ قاعدةٍ ستَّ عشرةَ ثانية بلا سببٍ — والمشروعُ يوثّق
         العكسَ في `/channel/test`. والقاعدةُ عامّة: لا نداءَ شبكةٍ داخل
         معاملة. */
      const tool = await withTenant(getDb(), tenantId, async (tx) =>
        (await tx.select().from(botTools).where(eq(botTools.id, req.params.id)).limit(1))[0]);
      if (!tool) throw new AppError(ErrorCode.VALIDATION, 'أداةٌ غير موجودة', 404);

      const secrets: Record<string, string> = tool.secretsEnc
        ? JSON.parse((await import('@aibot/crypto')).open(tool.secretsEnc, tool.keyVersion))
        : {};
      const res = await execHttpTool(
        tool.http as HttpToolSpec,
        req.body?.sampleParams ?? {},
        secrets,
        (tool.responseMap ?? null) as Record<string, string> | null,
        { debug: true },
      );
      // الترويسات لا تُعاد — فيها السرّ الذي حقنّاه للتوّ
      return { ok: res.ok, status: res.status, mapped: res.mapped, error: res.error, ms: res.ms, debug: res.debug };
    },
  );

  /**
   * تعديل أداة.
   *
   * ★ `key` **لا يُعدَّل**: هو الاسم الذي يناديه النموذج، وتغييره يكسر كلّ
   *   إجراءٍ معلَّقٍ يحمله وكلّ سجلّ استعمالٍ سابق. الاسم يُستبدل بأداةٍ جديدة.
   *
   * و`secrets` تُستبدل أو تُترك: إغفالها يحفظ القديمة، و`{}` يمحوها. فلا
   * يمحو حفظُ تسميةٍ سرَّ الأداة بالخطأ.
   */
  app.patch<{ Params: { id: string }; Body: Record<string, any> }>(
    '/bot/tools/:id',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);

      /* ★ والتعديلُ يُحقَّق كالإنشاء: هو الطريقُ الذي يعود منه المخطّطُ
         المعطوب إلى الصفّ. و`key` مقبولٌ هنا وإن لم يُكتب — الباني يرسل
         الحمولة كاملةً، ورفضُه يمنع المالكَ من **تصحيح** الأداة المعطوبة،
         أي من الخروج من العطل نفسه. */
      const parsed = BotToolPatch.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(ErrorCode.VALIDATION, 'تعديلٌ غير صالح', 400, parsed.error.issues);
      }
      const b = parsed.data as Record<string, any>;
      if (b.http?.url) {
        await assertPublicUrl(String(b.http.url)).catch((e) => {
          throw new AppError(ErrorCode.TOOL_BLOCKED, (e as Error).message, 400);
        });
      }
      return withTenant(getDb(), tenantId, async (tx) => {
        const cur = (await tx.select().from(botTools).where(eq(botTools.id, req.params.id)).limit(1))[0];
        if (!cur) throw new AppError(ErrorCode.VALIDATION, 'أداةٌ غير موجودة', 404);

        const patch: Record<string, unknown> = {};
        if (b.titleAr !== undefined) patch.titleAr = String(b.titleAr);
        if (b.description !== undefined) patch.description = String(b.description);
        if (b.paramsSchema !== undefined) patch.paramsSchema = b.paramsSchema;
        if (b.http !== undefined) patch.http = b.http;
        if (b.responseMap !== undefined) patch.responseMap = b.responseMap;
        if (b.requiresCapabilities !== undefined) {
          patch.requiresCapabilities = Array.isArray(b.requiresCapabilities) ? b.requiresCapabilities : [];
        }
        if (b.confirmRequired !== undefined) patch.confirmRequired = Boolean(b.confirmRequired);
        if (b.confirmTemplate !== undefined) patch.confirmTemplate = b.confirmTemplate ?? null;
        if (b.secrets !== undefined) {
          const sealed = Object.keys(b.secrets ?? {}).length ? seal(JSON.stringify(b.secrets)) : null;
          patch.secretsEnc = sealed?.enc ?? null;
          patch.keyVersion = sealed?.keyVersion ?? cur.keyVersion;
        }
        if (b.enabled !== undefined) {
          patch.enabled = Boolean(b.enabled);
          /* التفعيل اليدويّ يُصفّر قاطع الدائرة وسببَ التعطيل: العميل أصلح
             الخلل عند نظامه، فإبقاء السبب يعطّلها من جديد عند أوّل نداء. */
          if (b.enabled) { patch.failureCount = 0; patch.disabledReason = null; }
        }

        const [row] = await tx.update(botTools).set(patch)
          .where(eq(botTools.id, req.params.id)).returning();
        const { secretsEnc, ...safe } = row!;
        return { ...safe, hasSecrets: Boolean(secretsEnc) };
      });
    },
  );

  /**
   * ★ **`{ok:true}` على صفٍّ لم يُحذف كذبٌ**، ولذلك `returning()` ثمّ ٤٠٤.
   *
   *   قِيس على الخادم الحيّ (٢٣ أيلول ٢٠٢٦): مستأجرٌ يحذف بمعرّف أداةِ مستأجرٍ
   *   آخر فيعود **٢٠٠ `{"ok":true}`** والأداةُ عند صاحبها سليمة. RLS منعت
   *   الحذف — والردُّ قال إنّه تمّ. والعزلُ صحيحٌ والردُّ خاطئ، وهذا أسوأُ ما
   *   يكون: حارسٌ يعمل وواجهةٌ تُبلّغ بعكسه. ونفسُ الشكل يُخفي عطلَ سياقٍ
   *   حقيقيّاً يوماً ما — استعلامٌ بلا سياقِ مستأجرٍ يحذف صفراً ويقول «تمّ».
   */
  app.delete<{ Params: { id: string } }>('/bot/tools/:id', { preHandler: auth }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const gone = await tx.delete(botTools)
        .where(eq(botTools.id, req.params.id)).returning({ id: botTools.id });
      if (!gone.length) throw new AppError(ErrorCode.VALIDATION, 'أداةٌ غير موجودة', 404);
      return { ok: true };
    });
  });

  /* ───────────────────────── المعرفة ───────────────────────── */

  app.get('/bot/knowledge', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const sources = await tx.select({
        id: knowledgeSources.id, kind: knowledgeSources.kind, title: knowledgeSources.title,
        charCount: knowledgeSources.charCount, status: knowledgeSources.status,
        createdAt: knowledgeSources.createdAt,
        /* ★ والتحذير — وكان محبوساً في نافذة المعاينة خلف ضغطةٍ إضافيّة.
           `extract.ts` يضع `status = 'ready'` متى وُجد **أيّ** نصّ، ويحفظ
           تحذير «الملفّ صورٌ على الأرجح ويحتاج OCR» في عمود `error`. وهذا
           المسار لم يكن يعيد الحقل، فقائمةٌ ممسوحةٌ يُستخرج منها سطران
           تُوسَم أخضرَ «استُخرج نصُّه» — والمالك ينشر ويظنّ أنّ القائمة صارت
           معرفة بوته، ثمّ يكتشف من شكوى زبون. */
        error: knowledgeSources.error,
      }).from(knowledgeSources).where(eq(knowledgeSources.tenantId, tenantId));

      const chunks = (await tx.select({ n: sql<number>`count(*)::int` })
        .from(kbChunks).where(eq(kbChunks.tenantId, tenantId)))[0]?.n ?? 0;

      const total = sources.reduce((a, s) => a + s.charCount, 0);
      const tokens = Math.ceil(total / 2.5);
      return { sources, chunks, chars: total, tokens, suggestedMode: decideKnowledgeMode(tokens) };
    });
  });

  /* ───────────────────── ملفّات المعرفة ───────────────────── */

  /**
   * ★ رفع ملفّ معرفة — الميزة التي كانت **مبنيّةً وميّتة**: عامل الاستيعاب
   *   مسجَّلٌ والمستخرِج جاهز، ولا نقطةَ رفعٍ ولا منتِجَ مهمّة. أي أنّ تبويب
   *   «المعرفة» كان يعرض قائمةً لا يمكن أن تمتلئ.
   *
   * ولماذا بايتاتٌ خام لا multipart: ملفٌّ واحدٌ لكلّ طلب — فلا حاجة لتحليل
   * حدودٍ ولا لمُلحقٍ جديد، والتقدّم والحالة تصير لكلّ ملفٍّ على حدة. الاسم
   * يأتي في ترويسةٍ مرمَّزة لأنّ الترويسات لاتينيّةٌ وأسماء الملفّات عربيّة.
   *
   * وثلاثة حدودٍ يفرضها الخادم:
   *  ① نوعٌ من قائمةٍ بيضاء — لا استنتاجَ من الامتداد.
   *  ② حجمٌ أقصى 12 ميجابايت.
   *  ③ الاسم يُطهَّر ولا يُستعمل مساراً — الملفّ يُحفظ بـuuid، والاسم الأصليّ
   *     بيانٌ في القاعدة فقط. بلا هذا يكتب `../../` في أيّ مكان.
   */
  const KB_MIMES = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]);
  const KB_MAX = 12 * 1024 * 1024;
  const KB_ROOT = process.env.MEDIA_ROOT ?? '/app/media';

  /* ★ محلّلٌ يبتلع البايتات كما وصلت — و**بلا** `bodyLimit`.
     `addContentTypeParser` يكتب على نسخة `/api` نفسِها (لا `register` ولا
     تغليف: `registerAuth` و`registerWebhooks` يشتركان في المحلّلات عينِها)،
     فـ`bodyLimit: KB_MAX` هنا كان يرفع السقف إلى اثني عشر ميجابايت على
     **كلّ** مسارٍ في `/api` — ومنها `POST /auth/login` لمجهول. والسقفُ
     يسكن المسارَ وحده أدناه. */
  for (const mime of KB_MIMES) {
    app.addContentTypeParser(mime, { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
  }

  /**
   * ★ **التوكن يُفحص قبل أن تُقرأ بايتةٌ واحدة.**
   *
   *   `preHandler` يعمل **بعد** التحليل في Fastify 5. فمجهولٌ بلا توكن كان
   *   يُنفق اثني عشر ميجابايت من ذاكرة الخادم قبل أن يُرمى ٤٠١ — وعشرةُ
   *   طلباتٍ متزامنةٍ مئةً وعشرين، بلا حدِّ معدّلٍ يوقفها.
   *   و`onRequest` أوّلُ ما يعمل: قبل المحلّل وقبل أن يُقرأ الجسم.
   */
  const authBeforeBody = async (req: FastifyRequest, reply: FastifyReply) => {
    await auth(req, reply);
  };

  app.post('/bot/knowledge/files', {
    bodyLimit: KB_MAX,
    onRequest: authBeforeBody,
  }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (!KB_MIMES.has(mime)) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'نوع ملفٍّ غير مدعوم. المدعوم: نصّ، Markdown، CSV، PDF، Word، Excel.',
        415,
      );
    }
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      throw new AppError(ErrorCode.VALIDATION, 'الملفّ فارغ', 400);
    }
    if (buf.length > KB_MAX) {
      throw new AppError(ErrorCode.VALIDATION, 'الملفّ أكبر من 12 ميجابايت', 413);
    }

    const raw = String(req.headers['x-file-name'] ?? 'ملفّ');
    let original = raw;
    try { original = decodeURIComponent(raw); } catch { /* اسمٌ غير مرمَّز — يُقبل كما هو */ }
    // ★ لا يُستعمل الاسم مساراً أبداً: نحفظ بـuuid، والاسم بيانٌ في القاعدة
    const title = original.replace(/\s+/g, ' ').slice(0, 160).trim() || 'ملفّ';

    const dir = join(KB_ROOT, 'kb', tenantId);
    const storagePath = join(dir, randomUUID());
    await mkdir(dir, { recursive: true });
    await writeFile(storagePath, buf);

    let sourceId: string;
    try {
      sourceId = await withTenant(getDb(), tenantId, async (tx) => {
        const [row] = await tx.insert(knowledgeSources).values({
          tenantId, kind: 'file', title,
          originalName: original.slice(0, 255),
          storagePath,
          status: 'pending',
        }).returning({ id: knowledgeSources.id });
        return row!.id;
      });
    } catch (e) {
      // لا ملفٌّ يتيمٌ على القرص إن فشل الصفّ — وإلّا امتلأ القرص بما لا يُرى
      await unlink(storagePath).catch(() => undefined);
      throw e;
    }

    await enqueueIngest({ tenantId, sourceId, path: storagePath, mime });
    return reply.code(202).send({ id: sourceId, title, status: 'pending' });
  });

  /** النصّ المستخرَج للمعاينة — «ready» لا تعني «معتمدة»: العميل يعاين ثمّ ينشر. */
  app.get<{ Params: { id: string } }>(
    '/bot/knowledge/files/:id',
    { preHandler: requireAuth() },
    async (req) => {
      const tenantId = tenantOf(req);
      return withTenant(getDb(), tenantId, async (tx) => {
        const row = (await tx.select().from(knowledgeSources)
          .where(eq(knowledgeSources.id, req.params.id)).limit(1))[0];
        if (!row) throw new AppError(ErrorCode.VALIDATION, 'مصدرٌ غير موجود', 404);
        return {
          id: row.id, title: row.title, status: row.status, error: row.error,
          charCount: row.charCount,
          // معاينةٌ لا تنزيل: أوّل 4000 محرفٍ تكفي للحكم على جودة الاستخراج
          preview: (row.extractedText ?? '').slice(0, 4000),
          truncated: (row.extractedText ?? '').length > 4000,
        };
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/bot/knowledge/files/:id',
    { preHandler: auth },
    async (req) => {
      const tenantId = tenantOf(req);
      const path = await withTenant(getDb(), tenantId, async (tx) => {
        const row = (await tx.select({ p: knowledgeSources.storagePath }).from(knowledgeSources)
          .where(eq(knowledgeSources.id, req.params.id)).limit(1))[0];
        // نفسُ علّة `DELETE /bot/tools/:id`: صفرُ صفوفٍ لا يُبلَّغ عنه نجاحاً
        if (!row) throw new AppError(ErrorCode.VALIDATION, 'مصدرٌ غير موجود', 404);
        await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, req.params.id));
        return row.p ?? null;
      });
      // الصفّ أوّلاً ثمّ الملفّ: ملفٌّ يتيمٌ أهون من صفٍّ يشير إلى لا شيء
      if (path) await unlink(path).catch(() => undefined);
      return { ok: true };
    },
  );

  /**
   * فجوات المعرفة — وتمييزٌ يوفّر على العميل أسبوعاً.
   *
   * «بحث ولم يجد» = المعرفة ناقصة، يحلّها العميل بإضافة نصّ.
   * «وجد ولم يُجب» = المعرفة موجودة والمشكلة في الشخصيّة أو التقطيع، تحلّها أنت.
   * بلا هذا التمييز يضيف العميل محتوًى لمشكلةٍ ليست فيه.
   */
  app.get('/bot/knowledge/gaps', { preHandler: requireAuth() }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const rows = await tx.execute<{
        query: string; times: number; retrieved: number;
      }>(sql`
        SELECT r.query_text                                   AS query,
               count(*)::int                                  AS times,
               coalesce(max(array_length(r.chunk_ids, 1)), 0)::int AS retrieved
          FROM ai_runs a
          -- ★ INNER لا LEFT: بلا صفّ استرجاعٍ لا نعرف **ماذا** سأل الزبون،
          --    فالبطاقة تعرض «(بلا استعلام)» وتشخيصاً مبنيّاً على لا شيء.
          --    وصفرُ صفوفٍ هنا ليس عطلاً: يعني أنّ السجلّ لم يُكتب بعد.
          INNER JOIN kb_retrievals r ON r.ai_run_id = a.id
         WHERE a.tenant_id = ${tenantId}
           AND (a.flags->>'unknown')::boolean IS TRUE
           AND a.created_at > now() - interval '30 days'
           AND btrim(coalesce(r.query_text, '')) <> ''
         GROUP BY 1
         ORDER BY times DESC
         LIMIT 50
      `);
      return (rows as unknown as Array<{ query: string; times: number; retrieved: number }>).map((r) => ({
        ...r,
        diagnosis: r.retrieved === 0 ? 'بحث ولم يجد — المعرفة ناقصة' : 'وجد ولم يُجب — راجع الشخصيّة أو التقطيع',
      }));
    });
  });
}
