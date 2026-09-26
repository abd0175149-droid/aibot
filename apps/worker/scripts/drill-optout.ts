/**
 * تمرين العدول (#106): **«توقف» عبر ويبهوك واتساب الحقيقيّ — موقَّعاً — ثمّ «اشترك».**
 *
 * ما يُثبته بالتنفيذ لا بقراءة الكود:
 *  ① «توقف» تصل الـAPI بتوقيعٍ صحيح، تمرّ الطابورَ والعاملَ، وتترك أثرها الثلاثيّ:
 *     `contacts.opted_out_at` مكتوب، صفٌّ في `optouts`، والمحادثةُ موسومةٌ
 *     `needs_attention` — والرسالةُ نفسُها محفوظةٌ (الدليلُ يبقى).
 *  ② رسالةٌ عاديّةٌ من زبونٍ عادلٍ تُحفظ ولا تفتح شيئاً ولا تُلغي عدولَه.
 *  ③ «اشترك» تمحو الحقلَ والصفَّ معاً.
 *
 * ولماذا بوتٌ مطفأ: نعزل ما يُقاس — الكشفُ والحفظُ والعودة — عن نداء النموذج
 * وكلفته. وبوّابتا الردّ والإرسال يحرسهما اختبارُ `optout-handoff.test.ts`.
 *
 * يُشغَّل على الخادم من مضيفه (البيئة في رأس `drill-kit.ts`):
 *   node --import tsx apps/worker/scripts/drill-optout.ts
 *
 * ولا يترك أثراً: يحذف ما أنشأه في النهاية ولو فشل.
 */
import { createHmac } from 'node:crypto';
import {
  closeDb, withPlatform, contacts, optouts, conversations, messages, channelIdentities,
  eq, and, sql,
} from '@aibot/db';
import {
  sleep, log, step, ensureDrillTenant, purgeDrillData, waWebhookBody, getDbOrDie,
} from './drill-kit.js';

const SLUG = process.env.TENANT_SLUG ?? 'drill-optout';
const API = process.env.API_URL ?? 'http://127.0.0.1:4100';
const FROM = process.env.FROM ?? '962791230077';
const WAIT_MS = Number(process.env.WAIT_MS ?? '45000');
const TAG = `optout-${Date.now()}`;

type Db = ReturnType<typeof getDbOrDie>;

async function post(pid: string, secret: string, externalId: string, text: string): Promise<number> {
  const body = JSON.stringify(waWebhookBody({ externalId, from: FROM, text, phoneNumberId: `DRILL_${SLUG}` }));
  /* التوقيع على البايتات كما تُرسَل — الـAPI يحسبه على `rawBody`. */
  const sig = `sha256=${createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
  const res = await fetch(`${API}/api/webhooks/wa/${pid}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return res.status;
}

interface Snap {
  contactId: string | null;
  optedOutAt: Date | null;
  optoutRows: number;
  attention: boolean | null;
  stored: number;
  /** كيف حُفظ معرّفُ الزبون فعلاً — يُطبع دليلاً. */
  identity?: string | null;
}

/**
 * الأثرُ يُقرأ من **الرسالة** إلى محادثتها إلى جهتها — لا من هويّة القناة:
 * أوّلُ تشغيلٍ بحث بـ`channel_identities.external_id = FROM` فلم يجد شيئاً
 * (المعرّفُ يُطبَّع قبل الحفظ) وأعلن ❌ على مسارٍ سليم. والرسالةُ المحفوظةُ
 * بوسم التمرين طريقٌ لا يخطئ: هي الدليلُ الذي يبقى بالتعريف.
 */
async function snap(db: Db, tenantId: string): Promise<Snap> {
  return withPlatform(db, 'تمرين العدول: قراءة الأثر', async (tx) => {
    const mine = await tx.select({ conversationId: messages.conversationId }).from(messages)
      .where(and(eq(messages.tenantId, tenantId), sql`${messages.externalId} like ${`${TAG}%`}`));
    const stored = mine.length;
    const convId = mine[0]?.conversationId;
    if (!convId) return { contactId: null, optedOutAt: null, optoutRows: 0, attention: null, stored };
    const [conv] = await tx.select({ contactId: conversations.contactId, attention: conversations.needsAttention })
      .from(conversations).where(eq(conversations.id, convId)).limit(1);
    if (!conv) return { contactId: null, optedOutAt: null, optoutRows: 0, attention: null, stored };
    const [c] = await tx.select({ optedOutAt: contacts.optedOutAt }).from(contacts)
      .where(eq(contacts.id, conv.contactId)).limit(1);
    const [o] = await tx.select({ n: sql<number>`count(*)::int` }).from(optouts)
      .where(eq(optouts.contactId, conv.contactId));
    const [ident] = await tx.select({ externalId: channelIdentities.externalId }).from(channelIdentities)
      .where(eq(channelIdentities.contactId, conv.contactId)).limit(1);
    return {
      contactId: conv.contactId, optedOutAt: c?.optedOutAt ?? null, optoutRows: o?.n ?? 0,
      attention: conv.attention, stored, identity: ident?.externalId ?? null,
    };
  });
}

/** ينتظر حتّى يصدق الشرطُ أو تنقضي المهلة — ويُعيد آخرَ لقطةٍ في الحالين. */
async function until(db: Db, tenantId: string, ok: (s: Snap) => boolean): Promise<Snap> {
  const deadline = Date.now() + WAIT_MS;
  let s = await snap(db, tenantId);
  while (!ok(s) && Date.now() < deadline) {
    await sleep(1500);
    s = await snap(db, tenantId);
  }
  return s;
}

async function main(): Promise<number> {
  const db = getDbOrDie();
  console.log(`\n▶ تمرين العدول — «توقف» ثمّ رسالةٌ عاديّة ثمّ «اشترك» عبر الويبهوك الموقَّع\n`);

  const ctx = await ensureDrillTenant(db, { slug: SLUG, name: 'مستأجر تمرين العدول', bot: null });
  log('مستأجر التمرين جاهز، والبوت مطفأ', { tenantId: ctx.tenantId, publicId: ctx.publicId });

  const verdict = { optout: false, silentWhileMuted: false, optin: false };
  try {
    step('① «توقف»');
    const st1 = await post(ctx.publicId, ctx.appSecret, `${TAG}-1`, 'توقف');
    log(`ويبهوك: HTTP ${st1}`);
    const s1 = await until(db, ctx.tenantId, (s) => s.optedOutAt != null && s.optoutRows > 0);
    log('الأثر بعد «توقف»', s1);
    verdict.optout = s1.optedOutAt != null && s1.optoutRows === 1 && s1.stored >= 1 && s1.attention === true;

    step('② رسالةٌ عاديّةٌ من زبونٍ عادل');
    const st2 = await post(ctx.publicId, ctx.appSecret, `${TAG}-2`, 'شو أسعار الغرف؟');
    log(`ويبهوك: HTTP ${st2}`);
    const s2 = await until(db, ctx.tenantId, (s) => s.stored >= 2);
    log('الأثر بعد الرسالة العاديّة', s2);
    /* تُحفظ (دليل) ولا تُلغي العدول — و`optouts` كما هو. */
    verdict.silentWhileMuted = s2.stored >= 2 && s2.optedOutAt != null && s2.optoutRows === 1;

    step('③ «اشترك»');
    const st3 = await post(ctx.publicId, ctx.appSecret, `${TAG}-3`, 'اشترك');
    log(`ويبهوك: HTTP ${st3}`);
    const s3 = await until(db, ctx.tenantId, (s) => s.stored >= 3 && s.optedOutAt == null);
    log('الأثر بعد «اشترك»', s3);
    /* ⚠️ مشروطٌ بنجاح ①: «لا عدولَ بعد اشترك» يصدق فارغاً لو لم يُسجَّل عدولٌ
       أصلاً — وأوّلُ تشغيلٍ أعلن ✅ هنا على مسارٍ لم يُثبت شيئاً. */
    verdict.optin = verdict.optout && s3.optedOutAt == null && s3.optoutRows === 0 && s3.stored >= 3;
  } finally {
    step('تنظيف');
    await purgeDrillData(db, ctx.tenantId);
    log('حُذف أثرُ التمرين والبوت مطفأ');
  }

  console.log('');
  console.log(`  ① العدولُ يُكشف ويُكتب ثلاثيّاً:   ${verdict.optout ? '✅' : '❌'}`);
  console.log(`  ② رسالةُ العادلِ تُحفظ ولا تُلغيه: ${verdict.silentWhileMuted ? '✅' : '❌'}`);
  console.log(`  ③ «اشترك» تمحو الحقلَ والصفّ:    ${verdict.optin ? '✅' : '❌'}`);
  const ok = verdict.optout && verdict.silentWhileMuted && verdict.optin;
  console.log(`\n${ok ? '✅ تمرين العدول ناجح' : '❌ تمرين العدول فاشل'}\n`);
  return ok ? 0 : 1;
}

main()
  .then(async (code) => { await closeDb(); process.exit(code); })
  .catch(async (e) => { console.error('✘ سقط التمرين:', e); await closeDb(); process.exit(2); });
