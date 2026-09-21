'use client';

import { useApi, useToast, fmt } from '@/lib/useApi';
import { post } from '@/lib/api';
import { Loading, ErrorBox, Empty } from '@/components/Shell';

interface Incident {
  id: string;
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  status: 'open' | 'ack' | 'resolved';
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  detail: Record<string, unknown> | null;
  tenantName: string | null;
}

/**
 * خطوات المعالجة مكتوبةٌ في البطاقة لأنّك ستفتح هذه الشاشة الثالثة فجراً.
 * حادثةٌ بلا خطوةٍ تالية ليست تنبيهاً — هي قلق.
 */
const RUNBOOK: Record<string, string[]> = {
  token_invalid: [
    'افتح بطاقة العميل ← القنوات',
    'اطلب منه توليد توكن مستخدم نظام بلا تاريخ انتهاء',
    'الصقه واضغط «اختبر الاتّصال»',
    'تُغلق الحادثة آليّاً بعد فحصين سليمين متتاليين',
  ],
  webhook_unsubscribed: [
    'في لوحة ميتا عند العميل: WhatsApp ← Configuration ← Webhook',
    'تأكّد من الاشتراك في: messages · message_template_status_update · phone_number_quality_update · account_update',
    'تأكّد أنّ التطبيق في وضع Live لا Development',
  ],
  webhook_silent: [
    'الأرجح: اشتراك حقل messages سقط عند ميتا',
    'أو أنّ التطبيق رجع إلى وضع التطوير فلا يستقبل إلّا من المختبِرين',
    'افحص الاشتراك، ثمّ أرسل رسالةً تجريبيّة من هاتفك',
  ],
  quality_drop: [
    'تحقّق أوّلاً: هل جرى إرسالٌ جماعيّ؟ (يجب أن يكون مقفلاً)',
    'راجع آخر خمسين ردّاً بحثاً عن محتوًى مزعج',
    'الإرسال الجماعيّ مقفلٌ آليّاً حتّى تعود الجودة للأخضر',
  ],
  no_reply: [
    'افحص عمق الطوابير في صحّة المنصّة',
    'الأرجح أنّ عامل bot:reply متوقّف أو الطابور مسدود',
    'راجع سجلّ الحاوية: docker compose logs -f worker',
  ],
  send_failed: [
    'راجع تفصيل الحادثة — كود الخطأ من ميتا يقول السبب',
    '131047 = نافذة مغلقة، وهذا صحيحٌ ومقصود',
    '190 = توكن منتهٍ ⟵ جدّد الربط',
  ],
  quota_exceeded: [
    'راجع استهلاك العميل وسياسة باقته',
    'إن كان النموّ حقيقيّاً: اقترح ترقية الباقة',
    'وإن كان انفجاراً مفاجئاً: افحص حلقة رسائل أو هجوماً',
  ],
  kb_embed_failed: [
    'النسخة السابقة ما زالت تخدم — لا انقطاع على العميل',
    'راجع تفصيل الخطأ، ثمّ اطلب منه إعادة النشر',
  ],
};

const SEV: Record<string, { cls: string; label: string }> = {
  critical: { cls: 'crit', label: 'حرج' },
  warn: { cls: 'warn', label: 'تحذير' },
  info: { cls: 'nt', label: 'معلومة' },
};

export default function IncidentsPage() {
  const { data, loading, error, reload } = useApi<Incident[]>('/console/incidents');
  const { toast, node } = useToast();

  async function act(id: string, action: 'ack' | 'resolve') {
    await post(`/console/incidents/${id}/${action}`);
    toast(action === 'ack'
      ? 'وُسمت «رأيتها» — لا إشعارَ جديد لهذه البصمة'
      : 'حُلّت — والحلّ الآليّ يحتاج فحصين سليمين متتاليين');
    await reload();
  }

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <>
      <div className="vh">
        <div>
          <h1>الحوادث</h1>
          <p>
            حادثةٌ واحدة لكلّ بصمة. تكرار العطل يرفع العدّاد ولا يُنشئ إشعاراً جديداً —
            وهذا ما يمنع مئتَي إشعارٍ من عطلٍ واحد.
          </p>
        </div>
      </div>

      {!data?.length ? (
        <Empty title="لا حوادث مفتوحة" hint="كلّ البوتات تعمل. 🌿" />
      ) : (
        data.map((i) => {
          const sev = SEV[i.severity] ?? SEV.info!;
          const steps = RUNBOOK[i.kind];
          return (
            <div className="card" key={i.id} style={{ borderInlineStart: `3px solid var(--${sev.cls === 'nt' ? 'rule' : sev.cls})` }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 7 }}>
                <span className={`pill ${sev.cls}`}>{sev.label}</span>
                <strong style={{ fontSize: 14 }}>{i.title}</strong>
                {i.tenantName && <span className="pill nt">{i.tenantName}</span>}
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {i.kind} · ×{i.count} · {fmt.when(i.lastSeenAt)}
                </span>
                <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 6 }}>
                  {i.status === 'open' && (
                    <button className="btn sm" onClick={() => act(i.id, 'ack')}>رأيتها</button>
                  )}
                  {i.status === 'ack' && <span className="pill warn">رأيتها</span>}
                  <button className="btn sm" onClick={() => act(i.id, 'resolve')}>حُلّت</button>
                </span>
              </div>

              {steps && (
                <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  <strong style={{ color: 'var(--ink)' }}>خطوات المعالجة:</strong>
                  <ol style={{ margin: '5px 0 0', paddingInlineStart: 19, lineHeight: 1.75 }}>
                    {steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                </div>
              )}

              {i.detail && Object.keys(i.detail).length > 0 && (
                <details style={{ marginTop: 9, fontSize: 11.5 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>التفصيل التقنيّ</summary>
                  <pre className="mono" style={{
                    background: 'var(--surface-2)', padding: 9, borderRadius: 5,
                    overflowX: 'auto', fontSize: 11, marginTop: 6,
                  }}>{JSON.stringify(i.detail, null, 2)}</pre>
                </details>
              )}
            </div>
          );
        })
      )}
      {node}
    </>
  );
}
