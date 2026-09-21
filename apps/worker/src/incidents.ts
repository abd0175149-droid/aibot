import { getDb, withPlatform, incidents, eq, and, sql } from '@aibot/db';
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
const AUTO_RESOLVABLE = new Set(['channel_down', 'token_invalid', 'webhook_silent', 'send_failed', 'ai_error']);

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
