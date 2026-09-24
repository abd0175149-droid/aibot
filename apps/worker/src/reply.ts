import {
  getDb, withTenant, withPlatform, conversations, messages, botConfigs, botVersions, botTools,
  aiRuns, contacts, tenantChannels, conversationWindows,
  eq, and, desc, isNull, sql,
} from '@aibot/db';
import { getAdapter, type ChannelKind } from '@aibot/channels';
import {
  assembleContext, runAgent, buildToolDeclarations, choicesMessage, BUILTIN_TOOLS,
  FullKnowledge, buildRetrievalQuery, PLATFORM_RULES, withinBusinessHours, sanitizePromptField,
  type KnowledgeProvider, type BusinessHours,
} from '@aibot/core';
import { getProvider, computeCost, DEFAULT_CHAT_MODEL, AiError, type ToolCall } from '@aibot/ai';
import { mediaPlaceholder, type OutboundMessage } from '@aibot/shared';
import {
  sendOutbound, checkQuota, WindowClosedError, QuotaExceededError, TenantBlockedError,
} from './outbound.js';
import { RagKnowledge } from './retrieval.js';
import { execTenantTool } from './tools.js';
import { raiseIncident, resolveOpenOfKinds } from './incidents.js';
import { resolveAiKey, priceAt } from './pricing.js';

/**
 * عامل الردّ.
 *
 * البوّابات تُفحص بالترتيب قبل أيّ نداءٍ للنموذج — ونداءٌ واحدٌ بلا داعٍ
 * هو كلفةٌ حقيقيّة على هامشك، لا مجرّد بطء.
 */
export async function handleReply(job: { conversationId: string }): Promise<void> {
  const db = getDb();

  /* ★ استنتاج المستأجر من المحادثة — عمليّةٌ عابرةٌ للمستأجرين بطبيعتها.
     حمولة المهمّة تحمل `conversationId` وحده، فلا سياق مستأجرٍ بعد لنضبطه.
     وبلا `withPlatform` يحجب RLS هذا الاستعلام فيرجع صفراً، فيخرج العامل
     صامتاً في ثماني مِلّي — لا خطأ ولا سجلّ ولا ردّ. كلّفنا هذا رسائل
     حقيقيّة قبل أن يُكتشف؛ راجع اختبار `db-context.test.ts`. */
  const head = await withPlatform(db, 'ردّ البوت: استنتاج المستأجر من معرّف المحادثة', (tx) => tx
    .select({ conv: conversations, ch: tenantChannels })
    .from(conversations)
    .innerJoin(tenantChannels, eq(tenantChannels.id, conversations.channelId))
    .where(eq(conversations.id, job.conversationId))
    .limit(1));
  if (!head[0]) return;
  const tenantId = head[0].conv.tenantId;

  /* ★ **الاستئناف قبل التخطيط** — وهو ما يجعل هذه المهمّة محتمِلةً لإعادة
     المحاولة. كانت `handleReply` تُودع آثاراً جانبيّةً باهظة (نداءُ نموذجٍ
     مدفوع · أدواتُ HTTP نُفِّذت فعلاً · `pendingAction` مُسح) ثمّ تُرسل. فأيّ
     فشلِ إرسالٍ يُعيد المهمّة **من الصفر**: نداءٌ ثانٍ يُحاسَب، ورسائلُ نجحت
     تُرسل مرّةً ثانية، وفي فرع التأكيد يُقرأ الزرّ ثانيةً و`pendingAction`
     فارغٌ فيُقال لزبونٍ سُجِّل حجزُه «انتهت صلاحيّة هذا الطلب».
     والصفوف المحجوزة (`queued`) هي ذاكرةُ ما خُطِّط ولم يُسلَّم: وجودُها يعني
     أنّ التخطيط تمّ وأُودع، فلا يُعاد — يُستأنف التسليم وحده. */
  const pending = await withTenant(db, tenantId, (tx) => tx
    .select({ id: messages.id, payload: messages.payload, aiRunId: messages.aiRunId, source: messages.source })
    .from(messages)
    .where(and(
      eq(messages.conversationId, job.conversationId),
      eq(messages.direction, 'out'),
      eq(messages.status, 'queued'),
    ))
    .orderBy(messages.createdAt));

  if (pending.length) {
    for (const m of pending) {
      await safeSend({
        tenantId,
        conversationId: job.conversationId,
        source: m.source === 'agent' ? 'agent' : m.source === 'system' ? 'system' : 'bot',
        message: m.payload as OutboundMessage,
        aiRunId: m.aiRunId ?? undefined,
        messageId: m.id,
      });
    }
    return;
  }

  /**
   * ★ المعاملة تُخطِّط، ولا تُرسل.
   *
   * القفل الذاتيّ الذي وُلد منه هذا الشكل: تحديث كلفة النافذة يقفل صفّها،
   * ثمّ كان الإرسال يُنادى **داخل** نفس المعاملة، وهو يفتح معاملةً ثانية
   * على اتّصالٍ آخر ليختم الفوترة على **الصفّ نفسه** — فينتظر قفلاً لا
   * يُفرَج عنه إلّا بانتهاء المعاملة الأولى، وهي تنتظره. تجمّدت المهمّة في
   * `active` إلى الأبد: لا خطأ، ولا فشل، ولا إعادة محاولة.
   *   pid A  idle in transaction   update conversation_windows set ai_cost_usd …
   *   pid B  active (تنتظر)        update conversation_windows set billed_at …
   * ولذلك قاعدةٌ صريحة: **لا نداءَ شبكةٍ داخل معاملة.** المعاملة تكتب
   * وتُسلّم خطّة إرسال، والإرسال يجري بعد الإيداع.
   */
  /* نموذجٌ بلا صفّ سعرٍ يُفوتَر صفراً — فنجمعه هنا ونُبلّغ بعد المعاملة. */
  let unpriced: { provider: string; model: string } | null = null;
  /* هل نُودي النموذج ونجح؟ لا يُستنتج من وجود خطّة: معالجُ الأزرار الحتميّ
     يُنتج خطّةً بلا نداءِ نموذجٍ إطلاقاً. والعلمُ بهذا شرطُ حلِّ حادثة
     `ai_error` حلّاً صادقاً. */
  let modelOk = false;

  const plan = await withTenant(db, tenantId, async (tx): Promise<SendPlan | null> => {
    const conv = head[0]!.conv;
    const ch = head[0]!.ch;

    /* ── البوّابات ── */
    const cfgRows = await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1);
    const cfg = cfgRows[0];
    if (!cfg?.enabled) return null;                                   // البوت مطفأ عامّاً
    if (!conv.botEnabled) return null;                                 // مطفأ لهذه المحادثة
    if (conv.botPausedUntil && conv.botPausedUntil > new Date()) return null; // موظّفٌ تولّاها

    const verRows = cfg.publishedVersionId
      ? await tx.select().from(botVersions).where(eq(botVersions.id, cfg.publishedVersionId)).limit(1)
      : [];
    const ver = verRows[0];
    if (!ver) return null;                  // لا نسخةَ منشورة — البوت الحيّ لا يقرأ المسوّدة أبداً
    if (ver.embedStatus === 'pending') return null; // المعرفة قيد التجهيز — النسخة القديمة تخدم

    const win = await tx.select().from(conversationWindows).where(and(
      eq(conversationWindows.conversationId, conv.id),
      isNull(conversationWindows.closedAt),
    )).limit(1);
    if (!win[0] || new Date(win[0].expiresAt) <= new Date()) return null; // نافذةٌ مغلقة: لا نداء نموذج

    /* ═══ المعالج الحتميّ لضغط الأزرار ═══
       يسبق النموذج عن قصد. نمط الزرّ كان نصفَ نمط: الأزرار تُرسَل، وضغط
       «أكّد» يصل ويُخزَّن في `messages.payload` **ولا يقرأه أحد** — فلا
       `request_quote` تُنفَّذ ولا `confirm_booking`، ثمّ يقول النموذج للزبون
       «تم تسجيل طلبك» وهو لم يُسجَّل. رصدناه على زبونٍ حقيقيّ على رقم LIVE.

       ولماذا حتميّ لا عبر النموذج: الزبون ضغط زرّاً، فالفعل معروفٌ تماماً
       ولا شيء يُستنتَج. وإقحام النموذج هنا يعني احتمال أن يكذب على الزبون
       أو يبدّل الوسائط — ولا مقابلَ لذلك إطلاقاً. */
    /* ★ الضغطة تُبحَث في **كلّ الواردات منذ آخر صادر** لا في آخرِ واردٍ وحده.
       الزبون كثيراً ما يضغط «أكّد» ثمّ يكتب تفصيلاً خلال ثانيتين، ودمجُ
       الرسائل يجعل النصَّ هو الأخير — فلا يُدخَل فرعُ التأكيد، ولا يُنفَّذ
       الإجراء، ويرى النموذجُ «أكّد» في التاريخ فقد يقول «تمّ التسجيل» وهو لم
       يُسجَّل. وهي فئةُ العطل نفسها التي وُلد منها المعالجُ الحتميّ أصلاً. */
    const lastOutAt = (await tx
      .select({ at: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'out')))
      .orderBy(desc(messages.createdAt))
      .limit(1))[0]?.at;

    const pressed = await tx
      .select({ payload: messages.payload })
      .from(messages)
      .where(and(
        eq(messages.conversationId, conv.id),
        eq(messages.direction, 'in'),
        ...(lastOutAt ? [sql`${messages.createdAt} > ${lastOutAt}`] : []),
      ))
      .orderBy(desc(messages.createdAt))
      .limit(10);
    // الأحدثُ أوّلاً: ضغطتان متتاليتان تعنيان الأخيرة
    const press = String(
      pressed.map((m) => (m.payload as { buttonPayload?: string } | null)?.buttonPayload)
        .find((x) => x) ?? '',
    );

    if (press.startsWith('cancel:')) {
      await tx.update(conversations).set({ pendingAction: null }).where(eq(conversations.id, conv.id));
      return {
        conversationId: conv.id,
        sends: [{ source: 'system', message: { kind: 'text', body: 'تمّ الإلغاء. في خدمتك لو احتجت شي تاني.' } }],
      };
    }

    if (press.startsWith('confirm:')) {
      const pending = conv.pendingAction as { key?: string; args?: Record<string, unknown>; expiresAt?: string } | null;
      const wanted = press.slice('confirm:'.length);

      const stale = isPendingStale(pending, wanted);

      await tx.update(conversations).set({ pendingAction: null }).where(eq(conversations.id, conv.id));

      // `!pending?.key` مكرّرٌ عمداً: هو ما يُضيّق النوع، فلا نحتاج `!` يُخرس المدقّق
      if (stale || !pending?.key) {
        return {
          conversationId: conv.id,
          sends: [{ source: 'system', message: { kind: 'text', body: 'انتهت صلاحيّة هذا الطلب. اكتب لي تفاصيلك من جديد ورح جهّزه إلك.' } }],
        };
      }
      const actionKey = pending.key;

      const confirmTools = await tx.select().from(botTools).where(and(
        eq(botTools.tenantId, tenantId), eq(botTools.enabled, true), isNull(botTools.disabledReason),
      ));
      const confirmCaps = getAdapter(ch.kind as ChannelKind).capabilities;
      const confirmEmits: OutboundMessage[] = [];

      const exec = await execTenantTool({
        tx,
        /* نداءٌ نُصنّعه نحن لا النموذج: `raw` فارغٌ لأنّه لا يعود لمزوّد،
           و`id` وسمُ مصدرٍ يميّزه في أيّ تشخيصٍ لاحق. */
        call: {
          id: `confirm-${Date.now()}`,
          name: actionKey,
          args: { ...pending.args, __confirmed: true },
          raw: null,
        } satisfies ToolCall,
        tenantId,
        conversationId: conv.id,
        versionId: ver.id,
        caps: confirmCaps,
        tools: confirmTools,
        emits: confirmEmits,
        deferred: [],
      });

      const titleAr = confirmTools.find((t) => t.key === actionKey)?.titleAr ?? actionKey;
      const data = (exec.result as { data?: Record<string, unknown> } | null)?.data ?? {};
      const reference = data.reference ?? data.id ?? null;

      if (exec.failed) {
        /* فشل التنفيذ **بعد** أن أكّد الزبون: لا نبتلعه ولا نُجمّله.
           نصدُق معه ونحوّله لموظّف — ونوسم المحادثة فلا تضيع. */
        await tx.update(conversations).set({ needsAttention: true }).where(eq(conversations.id, conv.id));
        return {
          conversationId: conv.id,
          sends: [{ source: 'system', message: { kind: 'text', body: `تعذّر تسجيل «${titleAr}» حالياً لخلل تقني. حوّلتك لموظّف ورح يتواصل معك.` } }],
        };
      }

      return {
        conversationId: conv.id,
        sends: [
          ...confirmEmits.map((message) => ({ source: 'system' as const, message })),
          {
            source: 'system',
            message: {
              kind: 'text',
              body: reference
                ? `تمّ تسجيل «${titleAr}». الرقم المرجعي: ${String(reference)}. موظّفنا رح يتواصل معك.`
                : `تمّ تسجيل «${titleAr}». موظّفنا رح يتواصل معك.`,
            },
          },
        ],
      };
    }

    /* ★ السقفُ يُفحص **قبل** نداء النموذج — وكان يُفحص بعده.
       `checkQuota` لا تُنادى إلّا في `outbound.ts` (الخطوة ③ من الإرسال)، أي
       بعد أن نُودي النموذجُ ودُفعت كلفتُه وكُتب صفُّ `ai_runs`. فعند بلوغ
       السقف تدفع المنصّة ثمنَ ردٍّ لكلّ رسالةٍ ثمّ تُهمله — والمحادثةُ لا
       تُوسَم للموظّف فلا يعلم أحد.
       والفحصُ هنا **لا يُغني** عن فحص الإرسال: ذاك هو الحارس الذي يختم
       الفوترة ولا يُتجاوَز. وهذا يمنع الإنفاق قبل أن يقع. */
    const gate = await checkQuota(db, tenantId).catch(() => null);
    if (gate && !gate.allowed) {
      await tx.update(conversations)
        .set({ needsAttention: true })
        .where(eq(conversations.id, conv.id));
      return gate.policy === 'handoff_only' && cfg.failMessage
        ? {
          conversationId: conv.id,
          sends: [{ source: 'system' as const, message: { kind: 'text' as const, body: cfg.failMessage } }],
        }
        : null;
    }

    /**
     * ★ **رسالةُ خارج الدوام تُقال مرّةً لا مع كلّ رسالة.**
     *
     *   كانت تُرسَل لكلّ مهمّة ردّ: الزبون الذي يكتب ثلاث رسائل متباعدةٍ
     *   ليلاً يستلم ثلاثَ نسخٍ متطابقةٍ من «مغلقون الآن». وذاك مزعجٌ، لكنّ
     *   الأثقل أنّها تخرج بمصدر `system` عبر طبقة الإرسال — **فتختم نافذة
     *   الفوترة** كأنّها ردُّ بوت. أي أنّ العميل يدفع نافذةً كاملةً ثمنَ
     *   ردٍّ آليٍّ يقول «نحن مغلقون».
     *
     *   والشرطُ أن تكون آخرُ رسالةٍ صادرةٍ في هذه المحادثة ليست هي نفسَها:
     *   فتُقال مرّةً في كلّ فترة إغلاق، وتُقال من جديدٍ بعد أن يردّ البوتُ
     *   أو الموظّف في الدوام التالي.
     */
    if (!withinBusinessHours(cfg.businessHours as BusinessHours | null)) {
      if (!cfg.outsideHoursMessage) return null;

      const lastOutbound = (await tx
        .select({ body: messages.body })
        .from(messages)
        .where(and(
          eq(messages.conversationId, conv.id),
          eq(messages.direction, 'out'),
          isNull(messages.deletedAt),
        ))
        .orderBy(desc(messages.createdAt))
        .limit(1))[0];

      if (lastOutbound?.body?.trim() === cfg.outsideHoursMessage.trim()) return null;

      return {
        conversationId: conv.id,
        sends: [{ source: 'system', message: { kind: 'text', body: cfg.outsideHoursMessage } }],
      };
    }

    /* ── السياق ── */
    const history = await tx
      .select({
        direction: messages.direction, source: messages.source,
        body: messages.body, type: messages.type,
      })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(cfg.contextMessages);
    history.reverse();

    /**
     * ★ **الوسيطةُ بلا تعليقٍ تدخل السياق موصوفةً — وكانت تختفي.**
     *
     *   كان الترشيحُ `filter((m) => m.body)`، ورسالةٌ صوتيّةٌ أو صورةٌ بلا
     *   تعليقٍ تُحفظ بـ`body` فارغ. فتُسقَط من السياق تماماً، ويصير
     *   `lastUser` **سؤالاً أقدم** — فيردّ البوت على ما مضى، والزبون يقرأ
     *   جواباً عن غير سؤاله.
     *   وإن كانت أوّلَ رسالةٍ في المحادثة خرجت `contents` **فارغة**، فيرفضها
     *   Gemini بـ400، وتُرفَع حادثةُ `ai_error` حرجة تُنبّه المالكَ والمنصّة —
     *   والزبون يستلم صمتاً تامّاً. أي أنّ أشيع ما يرسله زبونٌ عربيٌّ على
     *   واتساب كان يُسقط الردَّ ويُطلق إنذاراً في آنٍ واحد.
     *
     *   والوصفُ صريحٌ بأنّه وصف: النموذج يُخبَر أنّ وسيطةً وصلت ولا يُعطى
     *   محتواها، فلا يخمّن. و`PLATFORM_RULES` تقول له ما يفعل حينها.
     */
    const turns = history
      .filter((m) => m.type !== 'reaction')
      .map((m) => ({
        role: m.direction === 'in' ? ('user' as const) : ('model' as const),
        text: m.body?.trim() ? m.body : (m.direction === 'in' ? mediaPlaceholder(m.type) : ''),
      }))
      .filter((t) => t.text);
    const lastUser = [...turns].reverse().find((t) => t.role === 'user')?.text ?? '';
    const lastOut = [...history].reverse().find((m) => m.direction === 'out')?.body ?? null;

    const knowledge: KnowledgeProvider =
      ver.knowledgeMode === 'full'
        ? new FullKnowledge(ver.knowledgeBase)
        : new RagKnowledge(tx, tenantId, ver.id, ver.knowledgeMode);

    const contact = (await tx.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1))[0];
    const caps = getAdapter(ch.kind as ChannelKind).capabilities;

    const toolRows = await tx.select().from(botTools).where(and(
      eq(botTools.tenantId, tenantId), eq(botTools.enabled, true), isNull(botTools.disabledReason),
    ));
    const enabledKeys = new Set<string>([
      ...Object.entries((ver.toolsConfig ?? {}) as Record<string, boolean>).filter(([, v]) => v).map(([k]) => k),
      ...toolRows.map((t) => t.key),
    ]);
    const decls = buildToolDeclarations(caps, enabledKeys, toolRows.map((t) => ({
      key: t.key,
      description: t.description,
      paramsSchema: t.paramsSchema as Record<string, unknown>,
      requires: t.requiresCapabilities,
    })));

    const built = await assembleContext({
      persona: ver.persona,
      tenantConstraints: ((ver.params ?? {}) as { constraints?: string }).constraints ?? '',
      toolDeclarations: decls.map((d) => `- ${d.name}: ${d.description}`).join('\n'),
      liveFacts: '',
      nowLocal: nowIn('Asia/Amman'),
      contactCard: renderContactCard(contact),
      history: turns,
      query: buildRetrievalQuery(lastUser, turns),
      knowledge,
      budget: (ver.knowledgeBudget ?? {}) as Record<string, number>,
      capabilities: caps,
    });

    /* ── المفتاح: مفتاح العميل يُعفيه من سقف التوكنز؛ مفتاح المنصّة لا يُستعمل بعد التجاوز ──
       والحلُّ في `pricing.ts` يشاركه الحيُّ والساحة — وكانت كتلتان منسوختان
       بسلوكَين مختلفَين عند غياب المفتاح. */
    const key = await resolveAiKey(tx, tenantId, ver.provider);
    if (!key) {
      throw new AiError('NO_KEY', 'لا مفتاحَ ذكاءٍ مضبوطٌ — لا للعميل ولا للمنصّة', false);
    }
    const { apiKey, owner: keyOwner } = key;

    const emits: OutboundMessage[] = [];
    const deferred: Array<{ key: string; args: Record<string, unknown> }> = [];
    const result = await runAgent({
      provider: getProvider(ver.provider),
      apiKey,
      model: ver.model || DEFAULT_CHAT_MODEL,
      system: built.system,
      contents: built.contents,
      tools: decls,
      maxLoops: cfg.maxToolLoops,
      fallbackText: cfg.failMessage ?? 'ما قدرت أجاوب على هالسؤال — بحوّلك لموظّف.',
      guard: {
        allowedLinkHosts: ((ver.params ?? {}) as { linkHosts?: string[] }).linkHosts ?? [],
        maxLen: Math.min(caps.maxTextLen, 900),
        lastOutboundText: lastOut,
        toolNames: decls.map((d) => d.name),
      },
      execTool: (call: ToolCall) =>
        execTenantTool({ tx, call, tenantId, conversationId: conv.id, versionId: ver.id, caps, tools: toolRows, emits, deferred }),
    });
    modelOk = true;

    /* ── القياس: صفٌّ لكلّ ردّ، وكلفةٌ بالسعر **السارِي** لحظةَ العرض ──
       و«السارِي» شرطٌ لا زينة: كان الاستعلام يأخذ أحدثَ `effective_from`
       مطلقاً، فصفُّ سعرٍ أُدخل بتاريخ سريانٍ لاحق يُطبَّق فوراً — كلفةُ اليوم
       بسعر الغد، وهامشٌ خاطئٌ في التقارير بلا أن يلاحظ أحد. */
    const price = await priceAt(tx, ver.provider, ver.model);

    /* ★ لا صفّ سعرٍ = كلفةٌ صفريّة **صامتة**، أي هامشٌ غير مرئيّ.
       والصفر هنا أخطر من الخطأ: التقارير تُظهر ربحاً كاملاً عن نموذجٍ يُكلّفك
       فعلاً. فالغياب يُسجَّل في الشوط ويُرفَع حادثةً بدل أن يمرّ. */
    if (!price) unpriced = { provider: ver.provider, model: ver.model };

    const cost = price ? computeCost(result.usage, price) : 0;

    const [run] = await tx.insert(aiRuns).values({
      tenantId, conversationId: conv.id, source: 'live',
      provider: ver.provider, model: ver.model, calls: result.calls,
      promptTokens: result.usage.promptTokens, outputTokens: result.usage.outputTokens,
      thoughtsTokens: result.usage.thoughtsTokens, cachedTokens: result.usage.cachedTokens,
      totalTokens: result.usage.totalTokens,
      costUsd: String(cost), keyOwner, latencyMs: result.latencyMs,
      tools: result.toolsUsed,
      flags: price ? result.flags : { ...result.flags, priceMissing: true },
      contextMeta: built.meta,
    }).returning({ id: aiRuns.id });

    await tx.update(conversationWindows)
      .set({ aiCostUsd: sql`${conversationWindows.aiCostUsd} + ${String(cost)}::numeric` })
      .where(eq(conversationWindows.id, win[0]!.id));

    if (result.flags.handoff) {
      await tx.update(conversations)
        .set({ needsAttention: true, botPausedUntil: new Date(Date.now() + cfg.pauseMinutes * 60_000) })
        .where(eq(conversations.id, conv.id));
    } else if (result.flags.usedFallback || result.flags.unknown) {
      /* ★ **العجزُ يُرفَع إلى الموظّف — والوعدُ كان فارغاً.**
         نصُّ العجز الافتراضيّ يقول للزبون «بحوّلك لموظّف»، ولم يكن يحوّل:
         لا `needsAttention` ولا شيءٌ في أيّ شاشة. فالزبون ينتظر تحويلاً
         وُعد به ولا يعلم أحدٌ أنّه وُعد. والحالةُ أشيع مما تبدو: ردٌّ فارغٌ
         من النموذج (تفكيرٌ استهلك السقف) يمرّ من هنا أيضاً.
         ولا إيقافَ للبوت هنا بخلاف التحويل الصريح: «لا أعرف» عن سؤالٍ واحد
         لا تُسكِت البوت ربعَ ساعةٍ عن بقيّة الحوار — تُرفع المحادثةُ إلى
         سلّة «يحتاجك الآن» وتبقى تعمل. */
      await tx.update(conversations)
        .set({ needsAttention: true })
        .where(eq(conversations.id, conv.id));
    }

    /* ★ إجراءٌ أُجِّل ⟵ يُحفظ على المحادثة، **ونصّ النموذج يُطرح**.
       النموذج يُخبَر «انتظر ضغط الزبون — لا تنفّذ شيئاً» فيكتب رغم ذلك
       «تم تسجيل طلبك». والملاحظة توجيهٌ لا حدّ، فالحدّ يفرضه التنفيذ:
       حين يكون هناك إجراءٌ معلَّق لا يخرج إلّا نصّ التأكيد وأزراره.
       رسالةٌ ناقصة أهون من كذبةٍ على زبون. */
    if (deferred.length) {
      const last = deferred[deferred.length - 1]!;
      await tx.update(conversations).set({
        pendingAction: {
          key: last.key,
          args: last.args,
          // صلاحيّةٌ قصيرة: زرٌّ عمره ساعة لا يُنفّذ بوسائط بائتة
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        },
      }).where(eq(conversations.id, conv.id));

      return {
        conversationId: conv.id,
        sends: emits.map((message) => ({ source: 'bot' as const, message, aiRunId: run!.id })),
      };
    }

    /* الترتيب مقصود: ما أنتجته الأدوات أوّلاً، ثمّ نصّ النموذج. */
    return {
      conversationId: conv.id,
      sends: [...emits, ...(result.text ? [{ kind: 'text', body: result.text } as OutboundMessage] : [])]
        .map((message) => ({ source: 'bot' as const, message, aiRunId: run!.id })),
    };
  }).catch(async (e: unknown): Promise<never> => {
    /* ★ فشلُ المزوّد كان **صامتاً تماماً**: النوع `ai_error` مسجَّلٌ في
       `AUTO_RESOLVABLE` وفي شاشة الحوادث ولا موضعَ واحد يرفعه. فمزوّدٌ يعيد
       ٥٠٠ يُفشل المهمّة، وBullMQ يستهلك المحاولتَين، ثمّ لا شيء: لا صفَّ في
       `incidents`، ولا `ai_runs` (النداء داخل معاملةٍ تتراجع)، ولا كلمةً
       للزبون. كشفه `drill-provider.ts`.

       والحادثةُ تُرفع لكلّ محاولة، والبصمة تجمعها: صفٌّ واحدٌ يتزايد عدّاده
       لا مئتا إشعار. و`causeKey` بكود المزوّد فيُفرَّق 429 عن 503. */
    if (e instanceof AiError) {
      await raiseIncident({
        tenantId,
        channelId: head[0]!.ch.id,
        kind: 'ai_error',
        severity: 'critical',
        title: `فشل نداء مزوّد النموذج (${e.code})`,
        detail: {
          code: e.code, status: e.status ?? null, retryable: e.retryable,
          message: e.message.slice(0, 300), conversationId: job.conversationId,
        },
        causeKey: e.code,
      }).catch(() => undefined);
    }
    /* ★ إعادةُ المحاولة **تحترم `retryable`** — وكانت تتجاهله.
       طبقةُ المزوّد تميّز بعنايةٍ بين عابرٍ ودائم (429 و5xx تُعاد، و400 و403
       والحجب لا تُعاد)، وهذا السطر كان يرمي كلَّ شيء: مخطّطُ أداةٍ غير صالح
       يُنتج 400 فيُعاد أربع مرّاتٍ بتراجعٍ أُسّيّ لكلّ رسالةٍ لكلّ زبون —
       وأربعُ نداءاتٍ مدفوعةٍ لطلبٍ لن ينجح أبداً.
       و`UnrecoverableError` تُنهي المهمّة فوراً وتضعها في `failed` مع
       الحادثة المرفوعة أعلاه — فيبقى الأثر ويتوقّف النزف. */
    if (e instanceof AiError && !e.retryable) {
      const { UnrecoverableError } = await import('bullmq');
      throw new UnrecoverableError(e.message);
    }
    throw e; // إعادة المحاولة تتولّاها BullMQ — والحادثة لا تُلغي الفشل
  });

  /* نجاحٌ لاحقٌ يُبطل ما قبله: نداءُ نموذجٍ تمّ يعني أنّ العطل العابر مضى.
     و`price_missing` تُغلق معه **إن وُجد سعر**: الحادثة تقول «الكلفة تُحسب
     صفراً»، وشوطٌ سُعِّر فعلاً هو دليل زوالها. وبلا هذا تبقى مفتوحةً بعد
     إدخال صفّ السعر إلى الأبد — ومعها يصمت كلُّ تكرارٍ حقيقيٍّ للنقص. */
  if (modelOk) {
    await resolveOpenOfKinds(tenantId, unpriced ? ['ai_error'] : ['ai_error', 'price_missing'])
      .catch(() => 0);
  }

  if (unpriced) {
    const u = unpriced as { provider: string; model: string };
    await raiseIncident({
      tenantId, kind: 'price_missing', severity: 'warn',
      title: `لا سعرَ مسجَّلٌ للنموذج ${u.model} — الكلفة تُحسب صفراً`,
      detail: u,
      // بصمةٌ بالنموذج: حادثةٌ واحدة لكلّ نموذجٍ لا واحدة لكلّ ردّ
      causeKey: `${u.provider}:${u.model}`,
    }).catch(() => undefined);
  }

  if (!plan) return;

  /* ★ **البوّابة تُعاد قراءتها بعد التوليد** — وكانت تُقرأ مرّةً واحدة.
     البوّابات الثلاث (بوتٌ مطفأ · مطفأٌ لهذه المحادثة · موظّفٌ تولّاها) تُقرأ
     عند بدء المعاملة، والمعاملةُ نفسها تحمل نداء النموذج وحلقةَ الأدوات وقد
     تستغرق دقائق. فموظّفٌ يتولّى المحادثة في تلك الأثناء لا يُفحَص، ويهبط
     ردُّ البوت **بعد** ردّه على الزبون نفسه.
     والقراءةُ الثانية خارج المعاملة رخيصة، وتقع قبل حجز الصفوف فلا تترك
     أثراً يُنظَّف. */
  const now2 = await withTenant(db, tenantId, (tx) => tx
    .select({ botEnabled: conversations.botEnabled, pausedUntil: conversations.botPausedUntil })
    .from(conversations).where(eq(conversations.id, job.conversationId)).limit(1));
  const g = now2[0];
  if (g && (!g.botEnabled || (g.pausedUntil && g.pausedUntil > new Date()))) {
    console.log(JSON.stringify({
      level: 'info', svc: 'worker', msg: 'تولّى موظّفٌ المحادثة أثناء التوليد — أُسقط ردّ البوت',
      tenantId, conversationId: job.conversationId,
    }));
    return;
  }

  /* ★ حجزُ صفوف الخطّة — في معاملةٍ **قصيرةٍ مستقلّة** بعد إيداع التخطيط.
     ولماذا لا داخل معاملة التخطيط: تلك تحمل نداءَ النموذج وحلقةَ الأدوات
     وقد تستغرق دقائق، وإطالتُها بكتابةٍ إضافيّةٍ تزيد احتجازَ اتّصالٍ من
     بِركةٍ عشريّة. وفجوةٌ بين الإيداعين لا تُنتج إلّا فقدَ خطّةٍ لم تُرسَل
     — وهو ما كان يقع في **كلّ** الحالات قبل هذا. */
  const rows = await withTenant(db, tenantId, async (tx) => {
    const out: Array<{ id: string; s: SendPlan['sends'][number] }> = [];
    for (const s of plan.sends) {
      const [m] = await tx.insert(messages).values({
        tenantId,
        conversationId: plan.conversationId,
        channelId: head[0]!.ch.id,
        direction: 'out',
        source: s.source,
        type: s.message.kind === 'choices' ? 'interactive' : s.message.kind,
        body: 'body' in s.message ? s.message.body : null,
        payload: s.message as object,
        status: 'queued',
        aiRunId: s.aiRunId ?? null,
      }).returning({ id: messages.id });
      out.push({ id: m!.id, s });
    }
    return out;
  });

  /* ── التسليم: بعد الإيداع، وبلا أيّ قفلٍ في اليد ── */
  for (const r of rows) {
    await safeSend({
      tenantId, conversationId: plan.conversationId, ...r.s, messageId: r.id,
    });
  }
}

/** ما تُسلّمه المعاملة للإرسال — لا اتّصال قاعدةٍ ولا قفلٌ فيه. */
interface SendPlan {
  conversationId: string;
  sends: Array<{ source: 'bot' | 'system'; message: OutboundMessage; aiRunId?: string }>;
}

/**
 * الإرسال لا يُسقط المهمّة.
 * نافذةٌ أُغلقت بين البناء والإرسال حالةٌ طبيعيّة (سباق)، لا عطل.
 * أمّا فشل القناة فحادثةٌ تُرفع ويُشعَر بها.
 */
async function safeSend(job: Parameters<typeof sendOutbound>[0]): Promise<void> {
  try {
    await sendOutbound(job);
  } catch (e) {
    if (e instanceof WindowClosedError) return;
    /* ★ الإيقافُ ليس فشلاً ولا يُصلحه تكرار: بلا هذا الفرع يقع في الفرع
       العامّ فتُرفَع **حادثةٌ حرجة** «فشل إرسال رسالة» عند كلّ ردٍّ من بوتٍ
       ما زال يعمل على نوافذَ مفتوحة، ويُعاد المحاولة أسّيّاً — ضجيجٌ يُغرق
       سيلَ الحوادث في اللحظة التي تكون فيها المنصّةُ قد أوقفت الحسابَ قصداً. */
    if (e instanceof TenantBlockedError) return;
    if (e instanceof QuotaExceededError) {
      await raiseIncident({
        tenantId: job.tenantId, kind: 'quota_exceeded', severity: 'warn',
        title: 'بلغ الحساب سقف نوافذ الباقة', detail: { policy: e.policy },
      });
      return;
    }
    await raiseIncident({
      tenantId: job.tenantId, kind: 'send_failed', severity: 'critical',
      title: 'فشل إرسال رسالة', detail: { error: (e as Error).message },
    });
    throw e; // إعادة المحاولة الأسّيّة تتولّاها BullMQ
  }
}

/* ───────────────────────── مساعدات ───────────────────────── */

/**
 * هل الإجراء المحفوظ غير صالحٍ للتنفيذ؟ ثلاثة فحوصٍ — والضغط وحده لا يكفي:
 *  ① يوجد إجراءٌ محفوظ  ② يطابق الزرّ المضغوط  ③ لم تنقضِ صلاحيّته.
 *
 * ② يمنع زرّاً قديماً من تنفيذ إجراءٍ أحدث استبدله (الزبون ضغط «أكّد» في
 *    رسالةٍ أعلى الشاشة بعد أن طلب شيئاً آخر).
 * ③ يمنع زرّاً عمره يومان من التنفيذ بوسائطٍ بائتة — سعرٌ تغيّر أو مقعدٌ نُفد.
 * وغياب `expiresAt` يُعامَل كصلاحٍ: البيانات القديمة قبل هذا العمود لا
 * تُرفَض بأثرٍ رجعيّ، والكتابة الجديدة تضبطه دائماً.
 */
export function isPendingStale(
  pending: { key?: string; args?: Record<string, unknown>; expiresAt?: string } | null | undefined,
  wantedKey: string,
  at = new Date(),
): boolean {
  if (!pending?.key) return true;
  if (pending.key !== wantedKey) return true;
  return pending.expiresAt ? new Date(pending.expiresAt) <= at : false;
}

/**
 * ★ مُعادةُ التصدير من `@aibot/core` — والنسخةُ كانت هنا وحدها.
 *
 *   والنقلُ ليس ترتيباً: أداةُ `check_business_hours` تحتاج نفسَ الحساب،
 *   والساحةُ تحتاجه، والـAPI يتحقّق من نفس الشكل. وثلاثُ نسخٍ لقاعدةِ «متى
 *   نحن مفتوحون» تعني بوتاً يقول شيئاً وشاشةً تقول غيرَه.
 *   و`billing.test.ts` يستورد هذا الاسم من هنا، فيبقى مصدَّراً.
 */
export { withinBusinessHours };

function nowIn(tz: string): string {
  return new Intl.DateTimeFormat('ar-JO', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  }).format(new Date());
}

/**
 * ★ **كلُّ حقلٍ هنا يملكه المهاجم — والبطاقةُ تسكن `system`.**
 *
 *   الاسمُ يأتي من ملفّ الزبون على واتساب (‏`profile.name`، يضبطه بنفسه)، أو
 *   ممّا أملاه على `collect_lead`. والسماتُ من `set_contact_attribute` بما
 *   قاله. وكانت تُلصق **خاماً** تحت «# الآن» في الموجّه — أعلى نصٍّ ثقةً —
 *   فسطرٌ جديدٌ يتبعه «# قاعدة: …» يُقرأ قاعدةً من المنصّة.
 *   وهو يبقى في الصفّ: يعبر كلَّ ردٍّ في كلّ محادثةٍ لاحقة، لا تلك الرسالة.
 *
 * ★ وعدَدُ السمات محدودٌ أيضاً: `save_note` تُلحق بلا سقف، وكلُّ سمةٍ تدخل
 *   موجّهَ **كلّ ردّ** — كلفةٌ متكرّرةٌ تنمو بلا أن يلاحظها أحد.
 */
const MAX_ATTRS = 12;

function renderContactCard(c: { displayName: string | null; tags: string[]; attributes: unknown } | undefined): string {
  if (!c) return '';
  const attrs = Object.entries((c.attributes ?? {}) as Record<string, unknown>)
    .slice(0, MAX_ATTRS)
    .map(([k, v]) => `${sanitizePromptField(k, 40)}: ${sanitizePromptField(v, 160)}`)
    .filter((x) => !x.startsWith(': '))
    .join(' · ');
  const name = sanitizePromptField(c.displayName, 60);
  const tags = c.tags.slice(0, 20).map((t) => sanitizePromptField(t, 40)).filter(Boolean);
  return [name && `الاسم: ${name}`, tags.length && `وسوم: ${tags.join('، ')}`, attrs]
    .filter(Boolean).join('\n');
}
