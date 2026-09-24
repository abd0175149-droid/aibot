import {
  getDb, withPlatform, tenantChannels, healthChecks, conversations, messages, tenants,
  eq, and, sql, desc, inArray,
} from '@aibot/db';
import { getAdapter, type ChannelKind } from '@aibot/channels';
import { open as decrypt } from '@aibot/crypto';
import { raiseIncident, resolveOpenOfKinds } from './incidents.js';

/**
 * المراقبة.
 *
 * السؤال التصميميّ ليس «كيف نسجّل الأخطاء» بل: **كم يمرّ بين تعطّل بوتٍ ومعرفتك؟**
 * الهدف دقيقتان.
 *
 * والدرس المدفوع: قناة التنبيه يجب ألّا تمرّ بالنظام الذي تراقبه.
 * حين حُظر الوصول سابقاً ماتت التنبيهات مع الحظر نفسه لأنّها كانت عبر واتساب.
 * لذلك التنبيه Web Push، ولا شيء غيره.
 */

export async function runHealthPoll(job: { channelId?: string } = {}): Promise<void> {
  const db = getDb();
  /* المراقبة **عابرةٌ للمستأجرين بطبيعتها**: تفحص كلّ القنوات.
     كشف أوّل تشغيلٍ بدورٍ عاديّ أنّها كانت تُرجع صفراً بصمت — ومراقبٌ
     يُرجع صفراً بصمت أسوأ من غياب المراقبة، لأنّه يبدو سليماً. */
  const rows = await withPlatform(db, 'مراقبة: فحص صحّة كلّ القنوات', (tx) =>
    job.channelId
      ? tx.select().from(tenantChannels).where(eq(tenantChannels.id, job.channelId))
      /* ★ `error` تُفحص أيضاً — وإلّا فالتنزيل طريقٌ بلا عودة.
         حين صار الفحص يُنزل الحالة عند العطل، كان الاستعلامُ يقصر على
         `connected` فقط: أوّلُ تنزيلٍ يُخرج القناة من المراقبة إلى الأبد،
         فلا تُرفع حالتُها ولا تُحلّ حادثتُها ولو عاد التوكن سليماً. */
      : tx.select().from(tenantChannels)
        .where(inArray(tenantChannels.status, ['connected', 'error'])));

  for (const ch of rows) {
    await pollChannel(ch).catch(() => undefined); // عطلُ قناةٍ لا يوقف فحص البقيّة
  }
  await negativeSignals();
}

async function pollChannel(ch: typeof tenantChannels.$inferSelect): Promise<void> {
  const db = getDb();
  if (!ch.tokenEnc) return;

  const adapter = getAdapter(ch.kind as ChannelKind);
  const started = Date.now();
  const report = await adapter.healthCheck({
    channelId: ch.id,
    tenantId: ch.tenantId,
    kind: ch.kind as ChannelKind,
    token: decrypt(ch.tokenEnc, ch.keyVersion),
    externalAccountId: ch.externalAccountId ?? '',
    config: (ch.config ?? {}) as Record<string, unknown>,
  });

  await withPlatform(db, 'مراقبة: تسجيل نتيجة الفحص', (tx) => tx.insert(healthChecks).values({
    tenantId: ch.tenantId,
    channelId: ch.id,
    level: report.level,
    tokenValid: report.tokenValid,
    webhookSubscribed: report.webhookSubscribed,
    detail: report.detail as object,
    issues: report.issues as object,
    latencyMs: Date.now() - started,
  }));

  /* التنبيه عند **تغيّر الحالة** لا عند كلّ فحص — وإلّا فتنبيهٌ كلّ عشر دقائق.
     ويُقرأ **قبل** تحديث الحالة لأنّ القرار يعتمد عليه. و`prev[0]` هو الفحص
     الذي كُتب للتوّ، و`prev[1]` سابقُه. */
  const prev = await withPlatform(db, 'مراقبة: قراءة آخر فحصين', (tx) =>
    tx.select({ level: healthChecks.level }).from(healthChecks)
      .where(eq(healthChecks.channelId, ch.id))
      .orderBy(desc(healthChecks.checkedAt)).limit(3));

  /* ★ الحالة تُنزَّل فعلاً — وكانت لا تُنزَّل أبداً.
     السطر كان `report.level === 'ok' ? 'connected' : ch.status`: فشلٌ يكتب
     `lastError` ويترك الحالة `connected` كما هي. وكلّ شاشات المالك تُشتقّ من
     `status`، فبقيت الرئيسيّة وصفحة القنوات خضراوين وتوكن القناة باطل —
     وهي حالةُ مستأجرٍ حيٍّ قِيست: `token_invalid` بعدّادٍ يتجاوز ٣٥٠ وقناةٌ
     «موصولة». وبينما كان الفحص اليدويّ في `reports.ts` يُنزلها فوراً:
     قاعدتان لنفس النتيجة، والمستخدم يرى أيّهما صادف.
     والتنزيل بعد **فحصين متتاليين** لا واحد — تماثلاً مع الرفع، فلا تُقلَب
     الشاشة على تعثّرٍ عابرٍ عند ميتا. و`degraded` تبقى موصولة: تعمل بجودةٍ
     أقلّ لا معطوبة — نفسُ تمييز الفحص اليدويّ. */
  const twoBad = report.level !== 'ok' && report.level !== 'degraded'
    && prev.length >= 2 && prev[1]?.level !== 'ok' && prev[1]?.level !== 'degraded';

  await withPlatform(db, 'مراقبة: تحديث حالة القناة', (tx) => tx.update(tenantChannels).set({
    qualityRating: report.qualityRating,
    messagingTier: report.messagingTier,
    lastCheckedAt: new Date(),
    lastError: report.issues[0] ?? null,
    status: report.level === 'ok' || report.level === 'degraded'
      ? 'connected'
      : twoBad ? 'error' : ch.status,
  }).where(eq(tenantChannels.id, ch.id)));

  if (report.level === 'ok') {
    // الرفع التلقائيّ بعد **فحصين سليمين متتاليين** لا واحد
    if (prev.length >= 2 && prev[1]?.level === 'ok') {
      /* ★ الأربعة لا اثنان: `webhook_unsubscribed` و`quality_drop` كانتا
         تُرفَعان هنا ولا تُحلّان في أيّ موضع — فتبقيان مفتوحتين إلى الأبد
         بعد أن يُصلح العميل السبب. */
      await resolveOpenOfKinds(ch.tenantId, [
        'channel_down', 'token_invalid', 'webhook_unsubscribed', 'quality_drop',
      ]);
    }
    return;
  }

  const kind = !report.tokenValid ? 'token_invalid'
    : report.webhookSubscribed === false ? 'webhook_unsubscribed'
    : report.qualityRating === 'RED' ? 'quality_drop'
    : 'channel_down';

  await raiseIncident({
    tenantId: ch.tenantId,
    channelId: ch.id,
    kind,
    severity: report.level === 'degraded' ? 'warn' : 'critical',
    title: report.issues[0] ?? 'عطلٌ في القناة',
    detail: { issues: report.issues, channel: ch.kind, account: ch.displayName },
    causeKey: kind,
  });
}

/**
 * الإشارات السلبيّة — الأخطر، لأنّها **لا تُكتشف بالفحص**.
 * كلّ شيءٍ يبدو سليماً بينما لا تصل رسالةٌ واحدة.
 */
export async function negativeSignals(): Promise<void> {
  const db = getDb();

  /* ① صمت الويبهوك: لا وارد منذ 3× متوسّط الفجوة التاريخيّة لهذا العميل،
        بحدٍّ أدنى 3 ساعات. المتوسّط لكلّ عميلٍ لا عتبةٌ ثابتة — فمطعمٌ يستقبل
        رسالةً كلّ دقيقة ليس كصيدليّةٍ تستقبل رسالةً كلّ ساعة. */
  /* ⚠️ لا يجوز تعشيش `lag() OVER` داخل `avg()` — بوستجرس يرفضه:
     «aggregate function calls cannot contain window function calls».
     فالفجوات تُحسب في مرحلةٍ أولى ثمّ تُجمَّع في الثانية. */
  const silent = await withPlatform(db, 'مراقبة: كشف صمت الويبهوك', (tx) =>
    tx.execute<{ tenant_id: string; channel_id: string; hours: number }>(sql`
    WITH pairs AS (
      SELECT m.tenant_id, m.channel_id, m.created_at,
             lag(m.created_at) OVER (PARTITION BY m.channel_id ORDER BY m.created_at) AS prev_at
        FROM messages m
       WHERE m.direction = 'in' AND m.created_at > now() - interval '14 days'
    ), gaps AS (
      SELECT tenant_id, channel_id,
             avg(extract(epoch FROM (created_at - prev_at))) AS avg_gap,
             max(created_at) AS last_in
        FROM pairs
       GROUP BY tenant_id, channel_id
    )
    SELECT tenant_id, channel_id,
           extract(epoch FROM (now() - last_in)) / 3600 AS hours
      FROM gaps
     WHERE last_in < now() - greatest(
             make_interval(secs => coalesce(avg_gap, 10800) * 3), interval '3 hours')
  `));

  for (const r of silent as unknown as Array<{ tenant_id: string; channel_id: string; hours: number }>) {
    await raiseIncident({
      tenantId: r.tenant_id, channelId: r.channel_id,
      kind: 'webhook_silent', severity: 'critical',
      title: `لا رسالة واردة منذ ${Math.round(r.hours)} ساعة`,
      detail: { hours: r.hours, hint: 'الأرجح: اشتراك حقل messages سقط، أو التطبيق رجع لوضع التطوير' },
      causeKey: 'silent',
    });
  }

  /* ② رسائل بلا ردود: ≥3 واردات بلا صادرٍ خلال 10 دقائق والبوت مفعَّل.
        معناها: العامل متوقّف أو الطابور مسدود — وهذا عطل منصّةٍ لا عطل قناة. */
  const stalled = await withPlatform(db, 'مراقبة: رسائل بلا ردود', (tx) =>
    tx.execute<{ tenant_id: string; conversation_id: string; n: number }>(sql`
    SELECT c.tenant_id, c.id AS conversation_id, count(m.id)::int AS n
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
                     AND m.direction = 'in'
                     AND m.created_at > now() - interval '10 minutes'
     WHERE c.bot_enabled
       AND (c.bot_paused_until IS NULL OR c.bot_paused_until < now())
       AND NOT EXISTS (
         SELECT 1 FROM messages o
          WHERE o.conversation_id = c.id AND o.direction = 'out'
            AND o.created_at > now() - interval '10 minutes')
     GROUP BY 1, 2
    HAVING count(m.id) >= 3
  `));

  for (const r of stalled as unknown as Array<{ tenant_id: string; conversation_id: string; n: number }>) {
    await raiseIncident({
      tenantId: r.tenant_id, kind: 'no_reply', severity: 'critical',
      title: `${r.n} رسائل بلا ردّ خلال 10 دقائق`,
      detail: { conversationId: r.conversation_id },
      causeKey: r.conversation_id,
    });
  }

  /* ③ ارتفاع الإخفاق: >20% من الصادر فشل خلال 15 دقيقة. */
  const failing = await withPlatform(db, 'مراقبة: ارتفاع الإخفاق', (tx) =>
    tx.execute<{ tenant_id: string; channel_id: string; rate: number }>(sql`
    SELECT tenant_id, channel_id,
           (count(*) FILTER (WHERE status = 'failed'))::float / greatest(count(*), 1) AS rate
      FROM messages
     WHERE direction = 'out' AND created_at > now() - interval '15 minutes'
     GROUP BY 1, 2
    HAVING count(*) >= 5
       AND (count(*) FILTER (WHERE status = 'failed'))::float / count(*) > 0.2
  `));

  for (const r of failing as unknown as Array<{ tenant_id: string; channel_id: string; rate: number }>) {
    await raiseIncident({
      tenantId: r.tenant_id, channelId: r.channel_id,
      kind: 'send_failure_rate', severity: 'critical',
      title: `${Math.round(r.rate * 100)}% من الرسائل الصادرة تفشل`,
      detail: { rate: r.rate },
      causeKey: 'rate',
    });
  }
}

/**
 * صيانةٌ دوريّة: إغلاق النوافذ المنتهية.
 * الإغلاق لا يُفوتِر شيئاً — الفوترة تمّت عند أوّل صادر. هذا تنظيفٌ فقط،
 * وهو ما يجعل القيد «نافذةٌ مفتوحةٌ واحدة لكلّ محادثة» صحيحاً دائماً.
 */
export async function closeExpiredWindows(): Promise<number> {
  const res = await withPlatform(getDb(), 'صيانة: إغلاق النوافذ المنتهية', (tx) =>
    tx.execute<{ n: number }>(sql`
    WITH closed AS (
      UPDATE conversation_windows
         SET closed_at = expires_at
       WHERE closed_at IS NULL AND expires_at <= now()
      RETURNING 1)
    SELECT count(*)::int AS n FROM closed
  `));
  return (res as unknown as Array<{ n: number }>)[0]?.n ?? 0;
}
