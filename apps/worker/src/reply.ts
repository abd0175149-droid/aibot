import {
  getDb, withTenant, withPlatform, conversations, messages, botConfigs, botVersions, botTools,
  aiRuns, aiKeys, prices, contacts, tenantChannels, conversationWindows,
  eq, and, desc, isNull, sql,
} from '@aibot/db';
import { getAdapter, type ChannelKind } from '@aibot/channels';
import { open as decrypt } from '@aibot/crypto';
import {
  assembleContext, runAgent, buildToolDeclarations, choicesMessage, BUILTIN_TOOLS,
  FullKnowledge, buildRetrievalQuery, PLATFORM_RULES, type KnowledgeProvider,
} from '@aibot/core';
import { getProvider, computeCost, DEFAULT_CHAT_MODEL, type ToolCall } from '@aibot/ai';
import type { OutboundMessage } from '@aibot/shared';
import { sendOutbound, WindowClosedError, QuotaExceededError } from './outbound.js';
import { RagKnowledge } from './retrieval.js';
import { execTenantTool } from './tools.js';
import { raiseIncident } from './incidents.js';

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
    const pressed = await tx
      .select({ payload: messages.payload })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'in')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const press = String((pressed[0]?.payload as { buttonPayload?: string } | null)?.buttonPayload ?? '');

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

    if (!withinBusinessHours(cfg.businessHours as BusinessHours | null)) {
      return cfg.outsideHoursMessage
        ? { conversationId: conv.id, sends: [{ source: 'system', message: { kind: 'text', body: cfg.outsideHoursMessage } }] }
        : null;
    }

    /* ── السياق ── */
    const history = await tx
      .select({ direction: messages.direction, source: messages.source, body: messages.body })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(cfg.contextMessages);
    history.reverse();

    const turns = history
      .filter((m) => m.body)
      .map((m) => ({ role: m.direction === 'in' ? ('user' as const) : ('model' as const), text: m.body! }));
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

    /* ── المفتاح: مفتاح العميل يُعفيه من سقف التوكنز؛ مفتاح المنصّة لا يُستعمل بعد التجاوز ── */
    const keyRow = (await tx.select().from(aiKeys).where(and(
      eq(aiKeys.tenantId, tenantId), eq(aiKeys.provider, ver.provider), eq(aiKeys.isActive, true),
    )).limit(1))[0];
    const apiKey = keyRow ? decrypt(keyRow.keyEnc, keyRow.keyVersion) : process.env.PLATFORM_AI_KEY!;
    const keyOwner = keyRow ? 'tenant' : 'platform';

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

    /* ── القياس: صفٌّ لكلّ ردّ، وكلفةٌ بسعرٍ لحظة العرض ── */
    const price = (await tx.select().from(prices).where(and(
      eq(prices.provider, ver.provider), eq(prices.model, ver.model),
    )).orderBy(desc(prices.effectiveFrom)).limit(1))[0];

    /* ★ لا صفّ سعرٍ = كلفةٌ صفريّة **صامتة**، أي هامشٌ غير مرئيّ.
       والصفر هنا أخطر من الخطأ: التقارير تُظهر ربحاً كاملاً عن نموذجٍ يُكلّفك
       فعلاً. فالغياب يُسجَّل في الشوط ويُرفَع حادثةً بدل أن يمرّ. */
    if (!price) unpriced = { provider: ver.provider, model: ver.model };

    const cost = price
      ? computeCost(result.usage, {
          input: Number(price.input), output: Number(price.output),
          cachedInput: price.cachedInput === null ? null : Number(price.cachedInput),
        })
      : 0;

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
  });

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

  /* ── الإرسال: بعد الإيداع، وبلا أيّ قفلٍ في اليد ── */
  for (const s of plan.sends) {
    await safeSend({ tenantId, conversationId: plan.conversationId, ...s });
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

interface BusinessHours {
  tz?: string;
  days?: Record<string, Array<[string, string]>>;
}

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

export function withinBusinessHours(bh: BusinessHours | null, at = new Date()): boolean {
  if (!bh?.days) return true;
  const tz = bh.tz ?? 'Asia/Amman';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const day = fmt.find((p) => p.type === 'weekday')!.value.toLowerCase();
  const hh = fmt.find((p) => p.type === 'hour')!.value;
  const mm = fmt.find((p) => p.type === 'minute')!.value;
  const cur = `${hh}:${mm}`;
  const ranges = bh.days[day];
  if (!ranges?.length) return false;
  return ranges.some(([from, to]) =>
    // نطاقٌ يعبر منتصف الليل: 12:00–00:00 تعني حتّى نهاية اليوم
    to <= from ? cur >= from || cur < to : cur >= from && cur < to);
}

function nowIn(tz: string): string {
  return new Intl.DateTimeFormat('ar-JO', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  }).format(new Date());
}

function renderContactCard(c: { displayName: string | null; tags: string[]; attributes: unknown } | undefined): string {
  if (!c) return '';
  const attrs = Object.entries((c.attributes ?? {}) as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${v}`).join(' · ');
  return [c.displayName && `الاسم: ${c.displayName}`, c.tags.length && `وسوم: ${c.tags.join('، ')}`, attrs]
    .filter(Boolean).join('\n');
}
