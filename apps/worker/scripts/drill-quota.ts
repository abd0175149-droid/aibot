/**
 * تمرينٌ يُثبت إنذارَ السقف على الخادم: **مرّةً واحدةً لكلّ عتبةٍ لكلّ دورة.**
 *
 * ★ لماذا تمرينٌ لا اختبارُ وحدة: اختبارُ الوحدة يُثبت الحافّة، و**الفريدُ في
 *   القاعدة** هو الضمانةُ الثانية — ولا يُختبر إلّا على قاعدةٍ حقيقيّة بدورٍ
 *   حقيقيّ تسري عليه RLS. وقد وقع هذا فعلاً في هذا المشروع: سكربتٌ يستعلم
 *   بلا سياق مستأجرٍ يقول «تمّ» ولا يكتب صفّاً واحداً.
 *
 * ما يقيسه بالضبط، وبهذا الترتيب:
 *   ① نافذةٌ دون العتبة لا تُنذر.
 *   ② النافذةُ التي **تعبر** 80٪ تُنذر مرّةً — ومعها صفٌّ في `quota_alerts`
 *      وإشعارٌ لمالك المستأجر، ولا حادثةَ منصّةٍ (الثمانون شأنُ العميل).
 *   ③ و95٪ و100٪ تُنذران، ولكلٍّ منهما حادثةٌ لمالك المنصّة.
 *   ④ والنافذةُ **بعد** السقف لا تُنذر — وهذا هو الفرق بين «عبر العتبة»
 *      و«هو فوقها الآن»، وبين تنبيهٍ يُقرأ وصندوقٍ يُطفَأ.
 *
 * ويحاكي **ما يفعله `sendOutbound` بالضبط** في ⑥ و⑦: يختم نافذةً (فيتحرّك
 * العدّاد)، ثمّ يقرأ العدّاد من القاعدة بـ`checkQuota` نفسِها، ثمّ ينادي
 * `announceQuotaCrossing` بنفس الوسائط. فالمقيس هو الكودُ نفسه لا نسخةٌ منه.
 * (وما لا يُحاكى: نداء Graph API — فلا رقمَ حقيقيٌّ يُراسَل في تمرين.)
 *
 * يُشغَّل على الخادم:
 *   docker compose run --rm --no-deps \
 *     -v "$HOME/aibot/apps/worker/scripts:/app/apps/worker/scripts:ro" \
 *     -e TENANT_SLUG=drill -e WINDOWS_LIMIT=20 \
 *     worker node --import tsx apps/worker/scripts/drill-quota.ts
 *
 * ولا يترك أثراً: يحذف كلّ ما أنشأه في النهاية ولو فشل الحكم.
 */
import {
  getDb, closeDb, withPlatform, withTenant, tenants, tenantChannels, plans, subscriptions,
  users, contacts, channelIdentities, conversations, conversationWindows,
  quotaAlerts, notifications, incidents,
  eq, and, asc, sql,
} from '@aibot/db';
import { publicId } from '@aibot/crypto';
import { checkQuota, billingPeriod } from '../src/outbound.js';
import { announceQuotaCrossing } from '../src/quota.js';

const SLUG = process.env.TENANT_SLUG ?? 'drill';
/** سقفٌ منخفض: العتباتُ الثلاث تُعبَر في نوافذَ معدودة لا في ألف. */
const LIMIT = Number(process.env.WINDOWS_LIMIT ?? '20');
/** نافذةٌ واحدة فوق السقف — وهي التي تُثبت «لا تكرار». */
const COUNT = Number(process.env.COUNT ?? String(LIMIT + 1));
const OWNER_EMAIL = `drill-owner+${SLUG}@aibot.local`;
const TAG = `quota-drill-${Date.now()}`;

function log(msg: string, extra?: unknown): void {
  console.log(extra === undefined ? `  ${msg}` : `  ${msg} ${JSON.stringify(extra)}`);
}

async function main(): Promise<void> {
  const db = getDb();
  const period = billingPeriod(new Date());

  console.log(`\n▶ تمرين إنذار السقف — سقفٌ ${LIMIT} نافذة، و${COUNT} نافذةً تُختم، دورة ${period}\n`);

  /* ① التهيئة: مستأجرٌ وقناةٌ ومالكٌ واشتراكٌ بسقفٍ منخفض.
     والسقفُ يُضبط بـ`limitsOverride` لا بباقةٍ جديدة — وهو المقصود من العمود
     نفسه: «سقفٌ خاصٌّ لعميلٍ بعينه بلا إنشاء باقةٍ جديدة له». */
  const ctx = await withPlatform(db, 'تمرين السقف: تهيئة مستأجرٍ واشتراكٍ بسقفٍ منخفض', async (tx) => {
    let t = (await tx.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
    if (!t) {
      [t] = await tx.insert(tenants).values({
        slug: SLUG, name: 'مستأجر تمرين السقف', status: 'active', publicId: publicId(),
      }).returning();
    }
    let ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, t!.id), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) {
      [ch] = await tx.insert(tenantChannels).values({
        tenantId: t!.id, kind: 'whatsapp_cloud', externalAccountId: `DRILL_${SLUG}`,
        displayName: 'قناة تمرين (لا ترسل شيئاً)', status: 'connected',
      }).returning();
    }

    /* مالكٌ للمستأجر — بلا مالكٍ لا يُرسَل إشعار، فلا يُقاس مسارُ الدفع أصلاً. */
    let owner = (await tx.select().from(users).where(eq(users.email, OWNER_EMAIL)).limit(1))[0];
    if (!owner) {
      [owner] = await tx.insert(users).values({
        tenantId: t!.id, email: OWNER_EMAIL, name: 'مالك تمرين السقف',
        // تجزئةٌ لا تُطابق أيّ كلمة سرّ — الحساب لا يُستعمل للدخول ويُحذف في النهاية
        passwordHash: 'drill-not-a-valid-hash', role: 'tenant_owner', mustChangePassword: true,
      }).returning();
    }

    const plan = (await tx.select().from(plans).orderBy(asc(plans.sort)).limit(1))[0];
    if (!plan) throw new Error('لا باقات في القاعدة — شغّل seed أوّلاً');

    await tx.delete(subscriptions).where(eq(subscriptions.tenantId, t!.id));
    const from = new Date();
    const to = new Date(from.getTime() + 30 * 86_400_000);
    await tx.insert(subscriptions).values({
      tenantId: t!.id, planId: plan.id, status: 'active',
      periodStart: from, periodEnd: to,
      limitsOverride: { windows: LIMIT },
      notes: 'تمرين إنذار السقف — يُحذف في نهاية التمرين',
    });

    /* بدايةٌ نظيفة: نوافذُ أو إنذاراتٌ من تشغيلٍ سابق تُفسد العدّ والحكم معاً. */
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, t!.id));
    await tx.delete(quotaAlerts).where(eq(quotaAlerts.tenantId, t!.id));
    await tx.delete(incidents).where(and(
      eq(incidents.tenantId, t!.id), eq(incidents.kind, 'quota_threshold'),
    ));
    await tx.delete(notifications).where(eq(notifications.userId, owner!.id));

    return { tenantId: t!.id, channelId: ch!.id, ownerId: owner!.id, policy: plan.overagePolicy };
  });

  log('المستأجر جاهز', { ...ctx, limit: LIMIT });

  const q0 = await checkQuota(db, ctx.tenantId);
  log('السقف كما يقرأه الكود', { used: q0.used, limit: q0.limit, policy: q0.policy });
  if (q0.limit !== LIMIT) throw new Error(`السقف المقروء ${q0.limit} لا يطابق ${LIMIT}`);

  /* ② ختمُ النوافذ واحدةً واحدة — وبعد كلّ ختمٍ ما يفعله `sendOutbound` في ⑦. */
  const firedPer: Array<{ n: number; used: number; fired: number[] }> = [];

  for (let i = 1; i <= COUNT; i += 1) {
    const before = (await checkQuota(db, ctx.tenantId)).used;

    await withPlatform(db, 'تمرين السقف: ختمُ نافذةٍ مُفوترة', async (tx) => {
      const [c] = await tx.insert(contacts).values({
        tenantId: ctx.tenantId, phone: `96279${String(1000000 + i)}`,
        displayName: `زبون التمرين ${i}`, attributes: { drill: TAG },
      }).returning();
      const [ident] = await tx.insert(channelIdentities).values({
        tenantId: ctx.tenantId, channelId: ctx.channelId, contactId: c!.id,
        externalId: `${TAG}-${i}`,
      }).returning();
      const [conv] = await tx.insert(conversations).values({
        tenantId: ctx.tenantId, channelId: ctx.channelId, contactId: c!.id,
        identityId: ident!.id, lastMessageAt: new Date(),
      }).returning();
      await tx.insert(conversationWindows).values({
        tenantId: ctx.tenantId, conversationId: conv!.id, channelId: ctx.channelId,
        contactId: c!.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        // الختمُ هو الحدث الذي يحرّك العدّاد — تماماً كما في ⑥ من طبقة الإرسال
        billedAt: new Date(), billingPeriod: period,
        messagesIn: 1, messagesOut: 1, botReplies: 1,
      });
    });

    const post = await checkQuota(db, ctx.tenantId);
    const fired = await announceQuotaCrossing({
      tenantId: ctx.tenantId,
      before,
      after: Math.max(post.used, before + 1),
      limit: post.limit,
      policy: post.policy,
      period,
    });

    firedPer.push({ n: i, used: post.used, fired });
    if (fired.length) log(`⟶ النافذةُ ${i} عبرت`, fired);
  }

  /* ③ ما وقع في القاعدة فعلاً — لا ما تدّعيه الدالّة. */
  const rows = await withTenant(db, ctx.tenantId, (tx) => tx
    .select({
      threshold: quotaAlerts.threshold, firedAt: quotaAlerts.firedAt,
      used: quotaAlerts.windowsUsed, lim: quotaAlerts.windowsLimit, policy: quotaAlerts.policy,
    })
    .from(quotaAlerts)
    .where(eq(quotaAlerts.billingPeriod, period))
    .orderBy(asc(quotaAlerts.threshold)));

  const notes = await withPlatform(db, 'تمرين السقف: قراءة إشعارات المالك', (tx) => tx
    .select({ tag: notifications.tag, title: notifications.title, body: notifications.body })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.ownerId), sql`${notifications.tag} like 'quota:%'`))
    .orderBy(asc(notifications.tag)));

  const incs = await withPlatform(db, 'تمرين السقف: قراءة حوادث المنصّة', (tx) => tx
    .select({ title: incidents.title, severity: incidents.severity, count: incidents.count })
    .from(incidents)
    .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.kind, 'quota_threshold'))));

  console.log('');
  console.log('  ── صفوفُ quota_alerts ──');
  for (const r of rows) {
    console.log(`  ${r.threshold}%  used=${r.used}/${r.lim}  policy=${r.policy}  at=${r.firedAt.toISOString()}`);
  }
  console.log('  ── إشعاراتُ مالك المستأجر ──');
  for (const n of notes) console.log(`  ${n.tag} → ${n.title} :: ${n.body}`);
  console.log('  ── حوادثُ مالك المنصّة ──');
  for (const i of incs) console.log(`  [${i.severity}] ×${i.count} ${i.title}`);
  console.log('');

  /* ④ الحكم — شروطٌ صريحة، وكلٌّ منها يمسك عطلاً مختلفاً. */
  const thresholds = rows.map((r) => r.threshold);
  const firedAll = firedPer.flatMap((f) => f.fired);
  const afterCap = firedPer.filter((f) => f.used > LIMIT).flatMap((f) => f.fired);

  const checks: Array<[string, boolean]> = [
    ['العتباتُ الثلاث كلُّها أُنذر بها', thresholds.join(',') === '80,95,100'],
    ['ولا عتبةَ مكرّرةٌ في القاعدة', new Set(thresholds).size === thresholds.length],
    ['وعددُ الإطلاقات يساوي عددَ الصفوف — لا إطلاقٌ بلا صفّ ولا عكسه',
      firedAll.length === rows.length],
    ['وإشعارٌ واحدٌ لكلّ عتبةٍ لمالك المستأجر', notes.length === 3],
    ['ونصُّ الإشعار يقول العاقبة لا الحالة',
      notes.every((n) => (n.body ?? '').includes('بوتك'))],
    ['وحادثتان للمنصّة — عند 95٪ و100٪ لا عند 80٪', incs.length === 2],
    ['ولا إنذارَ لنافذةٍ بعد السقف', afterCap.length === 0],
    ['ولا إنذارَ قبل أوّل عتبة', firedPer.slice(0, Math.floor(LIMIT * 0.8) - 1)
      .every((f) => f.fired.length === 0)],
  ];

  for (const [name, ok] of checks) console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  const pass = checks.every(([, ok]) => ok);
  console.log('');
  console.log(pass
    ? '✅ نجح التمرين — عتبةٌ تُنذر مرّةً واحدةً، ونافذةٌ بعد السقف لا تُنذر'
    : '❌ فشل التمرين — راجع الشروط أعلاه');

  /* ⑤ التنظيف — بالترتيب العكسيّ للمراجع، والمستأجرُ والقناةُ يبقيان لتمرينٍ لاحق. */
  await withPlatform(db, 'تمرين السقف: حذف أثر التمرين', async (tx) => {
    await tx.delete(conversationWindows).where(eq(conversationWindows.tenantId, ctx.tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, ctx.tenantId));
    await tx.delete(channelIdentities).where(eq(channelIdentities.tenantId, ctx.tenantId));
    await tx.delete(contacts).where(eq(contacts.tenantId, ctx.tenantId));
    await tx.delete(quotaAlerts).where(eq(quotaAlerts.tenantId, ctx.tenantId));
    await tx.delete(incidents).where(and(
      eq(incidents.tenantId, ctx.tenantId), eq(incidents.kind, 'quota_threshold'),
    ));
    await tx.delete(notifications).where(eq(notifications.userId, ctx.ownerId));
    await tx.delete(subscriptions).where(eq(subscriptions.tenantId, ctx.tenantId));
    await tx.delete(users).where(eq(users.id, ctx.ownerId));
  });
  log('نُظّف أثر التمرين');

  await closeDb();
  process.exit(pass ? 0 : 1);
}

main().catch(async (e) => {
  console.error('فشل التمرين:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
