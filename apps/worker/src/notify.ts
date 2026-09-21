import webpush from 'web-push';
import {
  getDb, pushSubscriptions, notifications, users, incidents,
  eq, and, isNull, sql, desc,
} from '@aibot/db';

/**
 * الإشعارات — Web Push بـVAPID، ولا شيء غيره.
 *
 * الدرس المدفوع: **قناة التنبيه يجب ألّا تمرّ بالنظام الذي تراقبه.**
 * حين حُظر الوصول سابقاً ماتت التنبيهات مع الحظر نفسه لأنّها كانت عبر واتساب.
 * ولا FCM ولا Firebase: المسار المزدوج يضاعف الأعطال بلا مقابل.
 *
 * ⚠️ مفاتيح VAPID **ثابتة**. تغييرها يُبطل كلّ الاشتراكات القائمة **بصمت** —
 *    لا خطأ ولا سجلّ، فقط إشعاراتٌ تتوقّف.
 */

let configured = false;
function configure(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.PUBLIC_URL ?? 'https://aibot.masaros.net', pub, priv);
  configured = true;
  return true;
}

export interface NotifyJob {
  userId: string;
  tenantId?: string | null;
  /** موضوع الإشعار — لا معرّفه. */
  tag: string;
  title: string;
  body?: string;
  url?: string;
  severity?: 'info' | 'warn' | 'critical';
}

/**
 * دورة حياةٍ واحدة لكلّ موضوع.
 *
 * `upsert` على `(user_id, tag)` حيث `read_at IS NULL`: إشعارٌ حيٌّ واحد لكلّ
 * محادثة يُحدَّث ولا يتكرّر، ويُحذف عند فتحها من أيّ جهاز.
 * (الدرس المدفوع: صفُّ إشعارٍ لكلّ دفعة أغرق الصندوق.)
 */
export async function handleNotify(job: NotifyJob): Promise<void> {
  const db = getDb();

  const existing = await db.select().from(notifications).where(and(
    eq(notifications.userId, job.userId),
    eq(notifications.tag, job.tag),
    isNull(notifications.readAt),
  )).limit(1);

  if (existing[0]) {
    await db.update(notifications)
      .set({ title: job.title, body: job.body ?? null, data: { url: job.url } as object, createdAt: new Date() })
      .where(eq(notifications.id, existing[0].id));
  } else {
    await db.insert(notifications).values({
      userId: job.userId, tenantId: job.tenantId ?? null,
      tag: job.tag, title: job.title, body: job.body ?? null,
      data: { url: job.url } as object,
    });
  }

  if (!configure()) return;

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, job.userId));

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({
          title: job.title,
          // ⚠️ لا محتوى رسالةٍ كاملاً: إشعارٌ على شاشة قفلِ موظّفٍ تسريبٌ محتمل
          body: (job.body ?? '').slice(0, 120),
          tag: job.tag,
          renotify: job.severity === 'critical',
          data: { url: job.url ?? '/app' },
        }),
        { urgency: job.severity === 'critical' ? 'high' : 'normal', TTL: 3600 },
      );
      await db.update(pushSubscriptions)
        .set({ lastOkAt: new Date(), failCount: 0 })
        .where(eq(pushSubscriptions.id, s.id));
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 410 Gone / 404: الاشتراك ميّت. احذفه فوراً وإلّا انتفخ الجدول بموتى.
      if (status === 410 || status === 404) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      } else {
        await db.update(pushSubscriptions)
          .set({ failCount: sql`${pushSubscriptions.failCount} + 1` })
          .where(eq(pushSubscriptions.id, s.id));
      }
    }
  }));
}

/**
 * التجميع — بلا هذا ستُطفئ الإشعارات بعد أسبوع.
 *
 * الحرج يمرّ فوراً. وما دونه يُجمَّع كلّ 15 دقيقة في إشعارٍ واحد
 * («3 تنبيهات في عميلين»)، وله سقفٌ يوميّ.
 */
export async function flushDigest(): Promise<void> {
  const db = getDb();

  const pending = await db.select({
    id: incidents.id, title: incidents.title, tenantId: incidents.tenantId,
    severity: incidents.severity,
  }).from(incidents).where(and(
    isNull(incidents.notifiedAt),
    sql`${incidents.severity} <> 'critical'`,
    sql`${incidents.status} <> 'resolved'`,
  )).limit(50);

  if (!pending.length) return;

  const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, 'platform_owner'));
  const tenantCount = new Set(pending.map((p) => p.tenantId)).size;

  for (const o of owners) {
    await handleNotify({
      userId: o.id,
      tag: 'digest',
      title: `${pending.length} تنبيهات في ${tenantCount} ${tenantCount === 1 ? 'عميل' : 'عملاء'}`,
      body: pending.slice(0, 3).map((p) => p.title).join(' · '),
      url: '/console/incidents',
      severity: 'warn',
    });
  }

  await db.update(incidents).set({ notifiedAt: new Date() })
    .where(sql`${incidents.id} in ${pending.map((p) => p.id)}`);
}

/** الحرج يخترق ساعات الهدوء والسقف اليوميّ — وحده. */
export async function notifyCritical(incidentId: string): Promise<void> {
  const db = getDb();
  const inc = (await db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1))[0];
  if (!inc || inc.notifiedAt) return;

  const recipients = await db.select({ id: users.id }).from(users).where(
    inc.tenantId
      ? sql`(${users.role} = 'platform_owner' or (${users.tenantId} = ${inc.tenantId} and ${users.role} = 'tenant_owner'))`
      : eq(users.role, 'platform_owner'),
  );

  for (const r of recipients) {
    await handleNotify({
      userId: r.id, tenantId: inc.tenantId,
      // البصمة نفسها تاجاً: حادثةٌ واحدة = إشعارٌ واحد يُحدَّث لا يتكرّر
      tag: `incident:${inc.fingerprint}`,
      title: inc.title,
      body: humanize(inc.kind),
      url: `/console/incidents?id=${inc.id}`,
      severity: 'critical',
    });
  }
  await db.update(incidents).set({ notifiedAt: new Date() }).where(eq(incidents.id, inc.id));
}

/** الأخطاء بلغةٍ بشريّة — لا «error 190: OAuthException». */
function humanize(kind: string): string {
  const map: Record<string, string> = {
    token_invalid: 'انتهت صلاحيّة ربط القناة — جدّدها من صفحة الربط',
    webhook_unsubscribed: 'التطبيق غير مشترك في حقول الويبهوك — لن تصل رسالة',
    webhook_silent: 'لا رسائل واردة منذ مدّة — راجع اشتراك الحقول ووضع التطبيق',
    quality_drop: 'هبط تقييم الرقم — أوقف أيّ إرسالٍ جماعيّ وراجع الردود',
    no_reply: 'رسائل تصل بلا ردّ — الأرجح أنّ عاملاً متوقّف',
    send_failed: 'فشل إرسال رسالة',
    quota_exceeded: 'بلغ الحساب سقف الباقة',
    kb_embed_failed: 'فشل تجهيز المعرفة — النسخة السابقة ما زالت تعمل',
  };
  return map[kind] ?? kind;
}
