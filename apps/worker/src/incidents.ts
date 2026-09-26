import { getDb, withPlatform, incidents, eq, and, sql, inArray, isNull } from '@aibot/db';
import { sha256 } from '@aibot/crypto';

/**
 * الحوادث.
 *
 * البصمة هي كلّ شيء: `kind + tenant + channel + مفتاح السبب`.
 * حادثةٌ مفتوحةٌ بنفس البصمة **تُحدَّث ولا تُنشئ إشعاراً جديداً** — وهذا ما
 * يمنع 200 إشعارٍ من عطلٍ واحد، وهو الفرق بين تنبيهاتٍ تُقرأ وتنبيهاتٍ تُطفَأ
 * بعد أسبوع.
 *
 * والبصمة تشمل القناة عمداً: واتساب مقطوعةٌ وإنستجرام تعمل حادثتان مختلفتان.
 */

export interface IncidentInput {
  tenantId: string | null;
  channelId?: string | null;
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail?: unknown;
  /** ما يميّز هذه الحادثة عن غيرها من نفس النوع (كود خطأ، اسم أداة…). */
  causeKey?: string;
}

export function fingerprintOf(i: IncidentInput): string {
  return sha256([i.kind, i.tenantId ?? 'platform', i.channelId ?? '-', i.causeKey ?? ''].join('|')).slice(0, 32);
}

export async function raiseIncident(i: IncidentInput): Promise<{ id: string; isNew: boolean }> {
  const result = await recordIncident(i);

  /* ★ الحرج يُنبّه **الآن**، والباقي ينتظر التجميعة كلّ ١٥ دقيقة.
     كان هذا النداء غائباً تماماً: `notifyCritical` مكتوبةٌ ولا يناديها أحد،
     و`flushDigest` يستثني `critical` صراحةً — فلم تكن الحوادث الحرجة تُنتج
     إشعاراً واحداً، لا فوريّاً ولا مجمَّعاً. نظامُ مراقبةٍ لا يُنبّه هو نظام
     تسجيلٍ لا مراقبة.

     و`isNew` شرطٌ لا زينة: بصمةٌ مفتوحةٌ تتكرّر تُحدَّث ولا تُنبّه — وذاك ما
     يمنع مئتَي إشعارٍ من عطلٍ واحد.

     ⚠️ خارج المعاملة: النداء يدفع Web Push عبر الشبكة، ومعاملةٌ مفتوحة أثناء
        ذلك تحتجز اتّصالاً لثوانٍ — وهو الدرس نفسه الذي جمّد عامل الردّ. */
  if (result.isNew && i.severity === 'critical') {
    const { notifyCritical } = await import('./notify.js');
    await notifyCritical(result.id).catch((e) => {
      // فشل التنبيه لا يُلغي تسجيل الحادثة — وإلّا خسرنا الاثنين معاً
      console.error(JSON.stringify({
        level: 'error', svc: 'worker', msg: 'فشل تنبيه حادثةٍ حرجة',
        incidentId: result.id, err: String(e),
      }));
    });
  }

  return result;
}

async function recordIncident(i: IncidentInput): Promise<{ id: string; isNew: boolean }> {
  const db = getDb();
  const fingerprint = fingerprintOf(i);

  /* الحوادث عابرةٌ للمستأجرين: بعضها بلا مستأجرٍ أصلاً (عطل منصّة)،
     والمراقبة تكتبها من خارج أيّ سياق. */
  return withPlatform(db, 'حوادث: رفع أو تحديث حادثة', async (tx) => {
  const open = await tx.select().from(incidents).where(and(
    eq(incidents.fingerprint, fingerprint),
    sql`${incidents.status} <> 'resolved'`,
  )).limit(1);

  if (open[0]) {
    await tx.update(incidents).set({
      count: sql`${incidents.count} + 1`,
      lastSeenAt: new Date(),
      detail: (i.detail ?? open[0].detail) as object,
    }).where(eq(incidents.id, open[0].id));
    return { id: open[0].id, isNew: false }; // لا إشعارَ جديد — هذا هو بيت القصيد
  }

  const [row] = await tx.insert(incidents).values({
    tenantId: i.tenantId,
    channelId: i.channelId ?? null,
    kind: i.kind,
    severity: i.severity,
    title: i.title,
    detail: (i.detail ?? {}) as object,
    fingerprint,
  }).returning({ id: incidents.id });

  return { id: row!.id, isNew: true };
  });
}

/**
 * الحلّ الآليّ مسموحٌ **فقط** لما سببه عابر، و**بعد فحصين سليمين متتاليين**.
 * أمّا مخالفة حسابٍ عند ميتا فتبقى يدويّة — ذلك قرارٌ بشريّ لا يُؤتمت.
 */
const AUTO_RESOLVABLE = new Set([
  'channel_down', 'token_invalid', 'webhook_silent', 'send_failed', 'ai_error',
  /* ★ أربعةٌ أُضيفت بعد أن كُشف أنّ القائمة وحدها لا تحلّ شيئاً: النوع يكون
     فيها ولا يناديه أحد. وهذا ما أبقى `webhook_silent` مفتوحةً عند مستأجرٍ
     حيٍّ بعدّادٍ يتجاوز ٨٠٠ — وما دامت البصمة مفتوحة فإنّ `isNew` كاذبة،
     فلا إشعارَ لأيّ تكرارٍ حقيقيٍّ لاحق. أي أنّ حادثةً لا تُغلق **تُعمي
     عن نفسها**. */
  'webhook_unsubscribed', 'quality_drop', 'no_reply', 'send_failure_rate',
  /* واثنان كشفهما حارسُ «كلُّ ما يُرفع يُحلّ»: `price_missing` تزول بإدخال
     صفّ سعرٍ — ودليلُها شوطٌ لاحقٌ وجد سعراً؛ و`quota_exceeded` تزول بانقلاب
     الشهر أو رفع الباقة — ودليلُها إرسالٌ نجح بعدها. */
  'price_missing', 'quota_exceeded',
  /* ★ وحادثةُ المنصّة نفسِها: «قناةُ التنبيه بلا مشترك» تزول بتسجيل اشتراكٍ
     أو بتثبيت مفاتيح VAPID، ودليلُها فحصٌ دوريٌّ وجد القناةَ موصولة. وحادثةٌ
     لا تُغلق تُعمي عن نفسها: `isNew` تصير كاذبةً فلا يُنبّه أيّ انقطاعٍ لاحق. */
  'alerting_unsubscribed',
  /* ★ وتغطيةُ المفاتيح: تزول بضبط `MASTER_KEY_V<n>` أو بإتمام التدوير،
     ودليلُها فحصٌ دوريٌّ وجد كلَّ إصدارٍ مغطّى. */
  'key_version_uncovered',
]);

/**
 * حلٌّ آليٌّ **بالنوع** لا بالبصمة.
 *
 * ★ وُلدت من `ai_error`: النوع كان مسجَّلاً في `AUTO_RESOLVABLE` وفي شاشة
 *   الحوادث، ولا أحد يرفعه ولا أحد يحلّه — دلالةٌ ميّتةٌ في الطرفين. وحين
 *   صار يُرفع لم تكفِ `resolveIfAuto`: بصمتُها تشمل `causeKey`، وكود خطأ
 *   المزوّد يتغيّر بين فشلٍ وفشل (‏503 ثمّ 429)، فتبقى حوادثُ مفتوحةً إلى
 *   الأبد على أكوادٍ لم تتكرّر. ونجاحُ نداءِ نموذجٍ لهذا المستأجر يُبطل كلَّ
 *   ما سبقه من فشلٍ عليه — وهذا هو الفحص السليم بعينه.
 */
/**
 * ★ حلٌّ آليٌّ **بالنوع** لا بالبصمة، ولأنواعٍ عدّة في عبارةٍ واحدة.
 *
 *   ولماذا بالنوع: بصمةُ الحادثة تشمل `causeKey`، وكودُ خطأ المزوّد يتغيّر
 *   بين فشلٍ وفشل (‏503 ثمّ 429)، فحلٌّ بالبصمة يترك حوادثَ مفتوحةً إلى الأبد
 *   على أكوادٍ لم تتكرّر. ونجاحُ العمليّة نفسها — نداءٌ تمّ، رسالةٌ خرجت،
 *   واردٌ وصل — يُبطل كلَّ ما سبقه من فشلٍ من ذلك النوع على هذا المستأجر.
 *
 *   ويُنادى في المسار الساخن، فثلاثُ عباراتٍ لكلّ رسالة ثمنٌ لا يُدفع:
 *   تُجمع في `in (...)` واحدة تُصيب صفراً في الحالة الغالبة.
 */
/**
 * ⚠️ و`tenantId` يقبل `null`: حوادثُ المنصّة (‏`tenant_id IS NULL`‏) لم تكن
 *    تُحلّ آليّاً إطلاقاً — `eq(col, null)` لا يُطابق NULL في SQL، فيُنتج
 *    `= NULL` وهو دائماً غيرُ معروف. أي أنّ العبارةَ كانت تصيب صفراً بصمتٍ
 *    مهما كان في الجدول، وتُرجع 0 كأنّ لا حادثةَ هناك.
 */
export async function resolveOpenOfKinds(tenantId: string | null, kinds: string[]): Promise<number> {
  const allowed = kinds.filter((k) => AUTO_RESOLVABLE.has(k));
  if (!allowed.length) return 0;
  const res = await withPlatform(getDb(), 'حوادث: حلٌّ آليٌّ بعد نجاحٍ لاحق',
    (tx) => tx.update(incidents).set({
      status: 'resolved',
      resolvedAt: new Date(),
    }).where(and(
      tenantId === null ? isNull(incidents.tenantId) : eq(incidents.tenantId, tenantId),
      inArray(incidents.kind, allowed),
      sql`${incidents.status} <> 'resolved'`,
    )).returning({ id: incidents.id }));
  return res.length;
}

export async function resolveIfAuto(i: Pick<IncidentInput, 'tenantId' | 'channelId' | 'kind' | 'causeKey'>): Promise<boolean> {
  if (!AUTO_RESOLVABLE.has(i.kind)) return false;
  const fingerprint = fingerprintOf(i as IncidentInput);
  const res = await withPlatform(getDb(), 'حوادث: حلٌّ آليّ بعد فحصين سليمين',
    (tx) => tx.update(incidents).set({
    status: 'resolved',
    resolvedAt: new Date(),
  }).where(and(
    eq(incidents.fingerprint, fingerprint),
    sql`${incidents.status} <> 'resolved'`,
  )).returning({ id: incidents.id }));
  return res.length > 0;
}
