import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { up, down, type Env } from './harness';

/**
 * ★★★ **المسارُ الحرج يُنفَّذ — لا يُمسح نصُّه.**
 *
 *   هذا هو البندُ ٨١ بعينه: «١٣٨ اختباراً كانت خضراء بينما البوت لا يردّ
 *   إطلاقاً». واليومَ صارت أكثرَ من ألف، ومرّ من بينها عطلان أسقطا مسارَ
 *   الردّ في الإنتاج — كلاهما «كائن `Date` يُمرَّر خامّاً إلى السائق».
 *
 *   **والدورُ الثاني هو جوهرُ هذا الملفّ.** أحدُ العطلَين كان في استعلامٍ
 *   شرطُه `lastOutAt`، وهو لا يوجد إلّا **بعد أوّل صادر**. فالدورُ الأوّل
 *   ينجح دائماً، والثاني يسقط. ولا حارسَ ساكنٌ يمكنه إمساكُ ذلك: الشكلُ
 *   سليمٌ تماماً، والعطلُ في القيمة وقتَ التنفيذ.
 *
 * ⚠️ ويُشغَّل بـ`pnpm itest` وحدَه — لا يجمعه `npx vitest run` (لاحقةُ
 *    `.itest.ts`)، فبوّابةُ النشر تبقى بلا دوكر وبزمنها الحاليّ.
 */

let env: Env;

beforeAll(async () => {
  env = await up();
}, 300_000);

afterAll(async () => {
  await down(env);
}, 120_000);

describe('ويبهوك ← وارد ← ردّ ← صادر', () => {
  it('★ القاعدةُ حقيقيّةٌ ومُرحَّلةٌ والدورُ عاديٌّ (فحصٌ ذاتيّ)', async () => {
    /* حزامٌ يبدأ على قاعدةٍ ناقصةٍ يُنتج فشلاً يبدو عطلَ شيفرة. */
    const { getDb, withPlatform, sql } = await import('../packages/db/src/index');
    const rows = await withPlatform(getDb(), 'تكامل: فحصُ المخطَّط', (tx) => tx.execute(
      sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`,
    )) as unknown as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBeGreaterThan(20);
  });

  it('★★★ دوران متتاليان في المحادثة نفسها — والثاني هو المقصود', async () => {
    const { getDb, withPlatform, messages, conversations, eq, and, desc } = await import('../packages/db/src/index');
    const { ensureDrillTenant } = await import('../apps/worker/scripts/drill-kit');
    const { handleInbound } = await import('../apps/worker/src/inbound');
    const { handleReply } = await import('../apps/worker/src/reply');
    const { inboundJob } = await import('../apps/worker/scripts/drill-kit');

    const db = getDb();
    /* ⚠️ ولا `as never` هنا: أوّلُ نسخةٍ مرّرت `enableBot: true` — وهو اسمٌ
       لا وجودَ له (‏الحقلُ `bot`) — فأخرسَ الكاستُ المدقّقَ ومرّت بلا نسخةٍ
       منشورة، فردَّت البوّابةُ «مطفأ» والاختبارُ اتّهم الشيفرة. الكاستُ الذي
       يُسكت المدقّقَ في اختبارٍ يُحوّل عطلَ اختبارٍ إلى عطلٍ موهومٍ في المنتج. */
    const t = await ensureDrillTenant(db, {
      slug: 'itest-critical',
      name: 'تكامل: المسار الحرج',
      bot: {
        provider: 'google',
        model: 'gemini-3.5-flash-lite',
        persona: 'موظّفُ خدمةِ عملاءٍ مختصر.',
        knowledgeBase: 'ساعاتُ العمل من ٩ صباحاً إلى ٥ مساءً.',
      },
    });

    /** يدفع رسالةَ زبونٍ ثمّ يُشغّل الردَّ ويُعيد ما خرج. */
    async function turn(text: string, n: number): Promise<number> {
      env.fakes.setReply(`ردٌّ رقم ${n}`);
      await handleInbound(inboundJob({
        tenantId: t.tenantId,
        channelId: t.channelId,
        externalId: `wamid.IN_${n}`,
        from: '962790000001',
        text,
      }));

      const conv = (await withPlatform(db, 'تكامل: إيجادُ المحادثة', (tx) => tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.tenantId, t.tenantId))
        .orderBy(desc(conversations.createdAt))
        .limit(1)))[0];
      expect(conv, 'لم تُنشأ محادثةٌ من الوارد').toBeTruthy();

      await handleReply({ conversationId: conv!.id });

      const out = await withPlatform(db, 'تكامل: عدُّ الصادر', (tx) => tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, conv!.id), eq(messages.direction, 'out'))));
      return out.length;
    }

    /* ── الدورُ الأوّل: ينجح حتّى مع العطل ── */
    const after1 = await turn('مرحبا', 1);
    expect(after1, 'الدورُ الأوّل لم يُنتج صادراً').toBeGreaterThanOrEqual(1);

    /* ── الدورُ الثاني: **هنا كان يسقط** ──
       `lastOutAt` صار موجوداً، فيدخل الاستعلامُ الذي كان يُمرّر `Date` خامّاً
       إلى السائق فيرمي «Received an instance of Date» قبل نداء النموذج. */
    const after2 = await turn('بدّي أحجز', 2);
    expect(
      after2,
      'الدورُ الثاني لم يُنتج صادراً — وهذا بعينه العطلُ الذي لا يمسكه حارسٌ ساكن',
    ).toBeGreaterThan(after1);

    /* وما **خرج فعلاً** يُقرأ من سجلّ المزيَّف لا من القاعدة وحدها:
       القاعدةُ تقول ما حُجز، والسجلُّ يقول ما وصل ميتا. */
    expect(env.fakes.log.graphSends.length, 'لم يخرج شيءٌ إلى ميتا').toBeGreaterThanOrEqual(2);
    expect(env.fakes.log.modelCalls.length, 'لم يُنادَ النموذج مرّتَين').toBeGreaterThanOrEqual(2);
  }, 240_000);
});
