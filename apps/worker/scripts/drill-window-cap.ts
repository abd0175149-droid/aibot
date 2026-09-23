/**
 * شرط قبول: **عميلٌ بسقف ٥ نوافذ — مرِّر ستّ محادثات.**
 *
 * (‏`drill-quota.ts` مجاورُه يقيس **إنذار العتبات** ٨٠/٩٥/١٠٠؛ وهذا يقيس
 *  **المنعَ عند التجاوز** ومطابقته لسياسة الباقة. ملفّان لأنّ المقيسَين
 *  مختلفان، ووكيلان يعملان عليهما.)
 *
 * ماذا يقيس: حارسَ السقف على المسار الحقيقيّ. لكلّ سياسةٍ من الثلاث يُعيد
 * الحال إلى الصفر، ثمّ يمرّ على ستّ محادثاتٍ واحدةً واحدة:
 *   · يسأل `checkQuota` (‏RLS حقيقيّ، واشتراكٌ وباقةٌ حقيقيّان، ومدّة فوترةٍ
 *     محسوبةٌ بتوقيت عمّان)،
 *   · ويختم النافذة كما يختمها أوّل صادرٍ ناجح، فيتقدّم العدّاد بصدق،
 *   · وعند السادسة يُنادي `sendOutbound` **نفسها** فتُجرَّب البوّابة ③ في
 *     موضعها من الكود لا في محاكاة.
 *
 * ★ السلوك المتوقَّع **مقروءٌ من الكود** لا مفترَض (`checkQuota`):
 *       allowed = used < limit || policy === 'allow_bill'
 *   فـ`block` و`handoff_only` كلاهما يرفع `QuotaExceededError`، و`allow_bill`
 *   يمرّ. وهذا ما يؤكّده التمرين حرفيّاً.
 *
 *   ⚠️ وملاحظةٌ تُرفَع ولا تُصلَح هنا: `handoff_only` و`block` **متطابقان**
 *      في الأثر اليوم — كلاهما يُسكت البوت ويرفع حادثة `quota_exceeded`،
 *      ولا يُسلّم المحادثة إلى موظّف (لا `needsAttention` ولا تكليف). أي أنّ
 *      «التسليم للموظّف» اسمُ سياسةٍ بلا فعلٍ يميّزها. منطق الحصص مِلكُ وكيلٍ
 *      آخر يعمل عليه الآن، فهذا التمرين يقرأ ولا يكتب فيه.
 *
 * ولماذا تُختَم النوافذ من السكربت لا بإرسالٍ حقيقيّ: الختم يقع عند **أوّل
 * صادرٍ ناجح**، وتوكن واتساب على هذا الخادم غير صالح، فلا نافذةَ تُختَم
 * أبداً — وتمرينٌ لا يبلغ السقف لا يختبر السقف. وقرار `checkQuota` لا يعتمد
 * إلّا على عدد النوافذ المختومة في المدّة، فطريقةُ ختمها لا تدخل في المقيس.
 *
 * يُشغَّل على الخادم:
 *   TENANT_SLUG=drill-window-cap WINDOWS=5 CONVS=6 \
 *     node --import tsx apps/worker/scripts/drill-window-cap.ts
 *
 * ولا يترك أثراً: يحذف ما أنشأه في النهاية ولو فشل.
 */
import {
  getDb, closeDb, withPlatform, tenants, tenantChannels, botConfigs, plans, subscriptions,
  contacts, channelIdentities, conversations, messages, conversationWindows,
  eq, and, inArray,
} from '@aibot/db';
import { publicId, seal, fingerprint } from '@aibot/crypto';
import { checkQuota, billingPeriod, sendOutbound, QuotaExceededError } from '../src/outbound.js';

const SLUG = process.env.TENANT_SLUG ?? 'drill-window-cap';
/** السقف المطلوب في شرط القبول. */
const LIMIT = Number(process.env.WINDOWS ?? '5');
/** والمحادثات المُمرَّرة — واحدةٌ فوق السقف. */
const CONVS = Number(process.env.CONVS ?? '6');
const PLAN_PREFIX = 'تمرين السقف · ';
const FAKE_TOKEN = 'DRILL_CAP_FAKE_TOKEN';

/** السياسات الثلاث، والمتوقَّع لكلٍّ منها **مقروءاً من `checkQuota`**. */
const POLICIES = [
  { policy: 'block' as const, expectSixth: 'blocked' as const },
  { policy: 'handoff_only' as const, expectSixth: 'blocked' as const },
  { policy: 'allow_bill' as const, expectSixth: 'allowed' as const },
];

/** حدودُ باقةٍ كاملة بسقف نوافذٍ صغير — الباقي واسعٌ فلا يحجب حدٌّ آخر القياس. */
const LIMITS = {
  windows: LIMIT, aiTokens: 5_000_000, kbChars: 20_000, seats: 2,
  customTools: 1, retentionDays: 60, dailySendCap: 200, contacts: 2000,
};

function log(msg: string, extra?: unknown): void {
  console.log(extra === undefined ? `  ${msg}` : `  ${msg} ${JSON.stringify(extra)}`);
}

interface Step {
  conv: number;
  used: number;
  limit: number;
  allowed: boolean;
}

interface PolicyRun {
  policy: string;
  steps: Step[];
  /** ما فعلته `sendOutbound` نفسها عند المحادثة السادسة. */
  gate: 'blocked' | 'allowed';
  gateDetail: string;
  ok: boolean;
}

async function main(): Promise<void> {
  const db = getDb();
  const period = billingPeriod(new Date());

  console.log(`\n▶ تمرين السقف — سقف ${LIMIT} نافذة، و${CONVS} محادثة، مدّة الفوترة ${period}\n`);

  /* ① مستأجرٌ وقناةٌ موصولة (بتوكن تمرينٍ مشفَّر: بوّابة «القناة موصولة» تسبق
       بوّابة السقف، فبلا توكنٍ يُفكّ لا نصل إلى ما نقيسه) ببوتٍ مطفأ. */
  const ctx = await withPlatform(db, 'تمرين السقف: تهيئة مستأجر وقناة وست محادثات', async (tx) => {
    let t = (await tx.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
    if (!t) {
      [t] = await tx.insert(tenants).values({
        slug: SLUG, name: 'مستأجر تمرين السقف', status: 'active', publicId: publicId(),
      }).returning();
    }
    const tenantId = t!.id;

    const sealed = seal(FAKE_TOKEN);
    let ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) {
      [ch] = await tx.insert(tenantChannels).values({
        tenantId, kind: 'whatsapp_cloud',
        externalAccountId: `DRILL_${SLUG}`,
        displayName: 'قناة تمرين السقف (توكن تمرين)',
        status: 'connected',
        tokenEnc: sealed.enc,
        tokenFingerprint: fingerprint(FAKE_TOKEN),
        keyVersion: sealed.keyVersion,
      }).returning();
    } else {
      await tx.update(tenantChannels).set({
        status: 'connected', tokenEnc: sealed.enc,
        tokenFingerprint: fingerprint(FAKE_TOKEN), keyVersion: sealed.keyVersion,
      }).where(eq(tenantChannels.id, ch.id));
    }
    const channelId = ch!.id;

    const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, tenantId)).limit(1))[0];
    if (!cfg) await tx.insert(botConfigs).values({ tenantId, enabled: false });
    else if (cfg.enabled) {
      await tx.update(botConfigs).set({ enabled: false }).where(eq(botConfigs.tenantId, tenantId));
    }

    /* صفحةٌ بيضاء: نوافذُ تشغيلٍ سابقٍ مختومةٌ في نفس المدّة تُزيّف العدّاد. */
    await tx.delete(messages).where(eq(messages.tenantId, tenantId));
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, tenantId));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, tenantId));
    await tx.delete(contacts).where(eq(contacts.tenantId, tenantId));

    const convIds: string[] = [];
    const windowIds: string[] = [];
    for (let i = 0; i < CONVS; i += 1) {
      const phone = `96279000${String(2000 + i)}`;
      const [contact] = await tx.insert(contacts).values({
        tenantId, phone, displayName: `زبون السقف ${i + 1}`,
      }).returning();
      const [ident] = await tx.insert(channelIdentities).values({
        tenantId, channelId, contactId: contact!.id, externalId: phone,
        displayHandle: `زبون السقف ${i + 1}`,
      }).returning();
      const [conv] = await tx.insert(conversations).values({
        tenantId, channelId, contactId: contact!.id, identityId: ident!.id,
        botEnabled: false, lastMessageAt: new Date(), lastMessagePreview: 'تمرين السقف',
      }).returning();
      const [win] = await tx.insert(conversationWindows).values({
        tenantId, conversationId: conv!.id, channelId, contactId: contact!.id,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        messagesIn: 1,
      }).returning();
      convIds.push(conv!.id);
      windowIds.push(win!.id);
    }

    return { tenantId, channelId, convIds, windowIds };
  });
  log(`مستأجر التمرين جاهز مع ${CONVS} محادثة ونافذة`, { tenantId: ctx.tenantId });

  const runs: PolicyRun[] = [];

  try {
    for (const { policy, expectSixth } of POLICIES) {
      /* ② باقةٌ بسقف ٥ لهذه السياسة، واشتراكٌ واحدٌ نشط، ونوافذُ غير مختومة. */
      await withPlatform(db, `تمرين السقف: باقة واشتراك بسياسة ${policy}`, async (tx) => {
        const name = PLAN_PREFIX + policy;
        let p = (await tx.select().from(plans).where(eq(plans.name, name)).limit(1))[0];
        if (!p) {
          [p] = await tx.insert(plans).values({
            name, priceMonthly: '0.00', limits: LIMITS,
            overagePolicy: policy, isPublic: false, sort: 999,
          }).returning();
        } else {
          await tx.update(plans).set({ limits: LIMITS, overagePolicy: policy, isPublic: false })
            .where(eq(plans.id, p.id));
        }

        await tx.delete(subscriptions).where(eq(subscriptions.tenantId, ctx.tenantId));
        await tx.insert(subscriptions).values({
          tenantId: ctx.tenantId, planId: p!.id, status: 'active',
          periodStart: new Date(Date.now() - 24 * 3600_000),
          periodEnd: new Date(Date.now() + 29 * 24 * 3600_000),
          notes: 'تمرين شرط القبول: عميلٌ بسقف ٥ نوافذ',
        });

        await tx.update(conversationWindows).set({
          billedAt: null, billingPeriod: null, firstOutboundMessageId: null,
          messagesOut: 0, botReplies: 0, closedAt: null,
          expiresAt: new Date(Date.now() + 24 * 3600_000),
        }).where(eq(conversationWindows.tenantId, ctx.tenantId));
      });

      /* ③ المرور على الستّ. */
      const steps: Step[] = [];
      for (let i = 0; i < CONVS; i += 1) {
        const d = await checkQuota(db, ctx.tenantId);
        steps.push({ conv: i + 1, used: d.used, limit: d.limit, allowed: d.allowed });
        if (d.allowed) {
          // الختم كما يختمه أوّل صادرٍ ناجح — فالعدّاد يتقدّم بصدق
          await withPlatform(db, 'تمرين السقف: ختم النافذة كما يختمها أوّل صادر', async (tx) => {
            await tx.update(conversationWindows).set({
              billedAt: new Date(), billingPeriod: period,
              messagesOut: 1, botReplies: 1,
            }).where(eq(conversationWindows.id, ctx.windowIds[i]!));
          });
        }
      }

      /* ④ البوّابة ③ في موضعها: `sendOutbound` على المحادثة السادسة.
         نُعيد فتح نافذتها أوّلاً — فنافذةٌ مختومة تتخطّى الفحص أصلاً. */
      await withPlatform(db, 'تمرين السقف: إعادة فتح نافذة السادسة قبل تجربة البوّابة', async (tx) => {
        await tx.update(conversationWindows).set({
          billedAt: null, billingPeriod: null, firstOutboundMessageId: null,
        }).where(eq(conversationWindows.id, ctx.windowIds[CONVS - 1]!));
      });

      let gate: PolicyRun['gate'];
      let gateDetail: string;
      try {
        await sendOutbound({
          tenantId: ctx.tenantId,
          conversationId: ctx.convIds[CONVS - 1]!,
          source: 'bot',
          message: { kind: 'text', body: 'رسالة تمرين السقف' },
        });
        gate = 'allowed';
        gateDetail = 'نجح الإرسال فعلاً (غير متوقَّع على توكن تمرين)';
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          gate = 'blocked';
          gateDetail = `QuotaExceededError policy=${e.policy}`;
        } else {
          /* ★ عبور البوّابة يُثبته **فشلٌ لاحقٌ لها**: خطأُ قناةٍ أو ميتا يعني
             أنّ الحارس سمح، والفشل جاء من التوكن الوهميّ وحده. */
          gate = 'allowed';
          gateDetail = `تجاوز الحارس ثمّ فشل بعده: ${(e as Error).message.slice(0, 110)}`;
        }
      }

      const firstFive = steps.slice(0, LIMIT).every((s) => s.allowed);
      const sixth = steps[CONVS - 1]!;
      const sixthMatches = expectSixth === 'allowed' ? sixth.allowed : !sixth.allowed;
      const ok = firstFive && sixthMatches && gate === expectSixth;
      runs.push({ policy, steps, gate, gateDetail, ok });

      console.log('');
      console.log(`  ── سياسة ${policy} — المتوقَّع للسادسة: ${expectSixth}`);
      for (const s of steps) {
        console.log(`     محادثة ${s.conv}: مستعمَل ${s.used}/${s.limit} ⟶ ${s.allowed ? 'مسموح' : 'ممنوع'}`);
      }
      console.log(`     البوّابة في sendOutbound: ${gate} — ${gateDetail}`);
      console.log(`     ${ok ? '✔ يطابق سياسة الباقة' : '✘ لا يطابق'}`);
    }

    const allOk = runs.every((r) => r.ok);
    console.log('');
    console.log(`  السقف:            ${LIMIT} نافذة`);
    console.log(`  المحادثات:        ${CONVS}`);
    console.log(`  السياسات المجرَّبة: ${runs.map((r) => `${r.policy}=${r.ok ? '✔' : '✘'}`).join(' · ')}`);
    console.log('');
    console.log(allOk
      ? '✅ نجح التمرين — الخمسُ الأولى تمرّ، والسادسة تتصرّف بحسب سياسة الباقة في كلّ الحالات'
      : '❌ فشل التمرين — سلوكٌ لا يطابق سياسة الباقة، والتفصيل أعلاه');
    console.log('  ⓘ handoff_only و block متطابقان في الأثر اليوم — لا تسليمَ فعليّاً لموظّف.');

    await cleanup(db, ctx.tenantId);
    await closeDb();
    process.exit(allOk ? 0 : 1);
  } catch (e) {
    await cleanup(db, ctx.tenantId).catch(() => undefined);
    throw e;
  }
}

/** التنظيف — بالترتيب العكسيّ للمراجع، والاشتراك قبل الباقة (لا cascade). */
async function cleanup(db: ReturnType<typeof getDb>, tenantId: string): Promise<void> {
  await withPlatform(db, 'تمرين السقف: حذف أثر الاختبار', async (tx) => {
    await tx.delete(messages).where(eq(messages.tenantId, tenantId));
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, tenantId));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, tenantId));
    await tx.delete(contacts).where(eq(contacts.tenantId, tenantId));
    await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    await tx.delete(plans).where(inArray(plans.name, POLICIES.map((p) => PLAN_PREFIX + p.policy)));
  });
  console.log('  نُظّف أثر التمرين — الباقات والاشتراك والمحادثات (المستأجر يبقى لتمرينٍ لاحق)');
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
