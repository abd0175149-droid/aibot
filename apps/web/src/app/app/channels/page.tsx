'use client';

import { useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { Loading, ErrorBox } from '@/components/Shell';
import { useCan } from '@/lib/session';
import { post, ApiError } from '@/lib/api';

interface Channel {
  id: string;
  kind: 'whatsapp_cloud' | 'instagram';
  status: 'pending' | 'connected' | 'error' | 'disabled';
  displayName: string | null;
  tokenFingerprint: string | null;
  qualityRating: string | null;
  messagingTier: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  capabilities: { buttons: number; quickReplies: number; location: boolean; windowHours: number };
  webhookUrl?: string;
  verifyToken?: string;
}

const QUALITY: Record<string, { label: string; cls: string }> = {
  GREEN: { label: 'أخضر', cls: 'ok' },
  YELLOW: { label: 'أصفر', cls: 'warn' },
  RED: { label: 'أحمر', cls: 'crit' },
};

interface TestReport {
  level: 'ok' | 'degraded' | 'blocked' | 'unreachable';
  tokenValid: boolean;
  webhookSubscribed: boolean | null;
  issues: string[];
}

const LEVEL: Record<string, { label: string; cls: string }> = {
  ok: { label: 'سليمة', cls: 'ok' },
  degraded: { label: 'تعمل بجودةٍ أقلّ', cls: 'warn' },
  blocked: { label: 'محجوبة', cls: 'crit' },
  unreachable: { label: 'لا تستجيب', cls: 'crit' },
};

export default function ChannelsPage() {
  const can = useCan();
  const { data, loading, error, reload } = useApi<{ items: Channel[] }>('/channel');
  const [testing, setTesting] = useState(false);
  const [report, setReport] = useState<TestReport | null>(null);
  const { toast, node: toastNode } = useToast();

  /* فحصٌ حقيقيٌّ عند ميتا لا قراءةُ صفٍّ عندنا — وأهمّ سطرٍ فيه اشتراك
     الويبهوك، وهو السبب الأوّل لـ«البوت لا يردّ» بينما كلّ شيءٍ يبدو سليماً. */
  async function runTest(channelId?: string) {
    setTesting(true);
    setReport(null);
    try {
      const r = await post<TestReport>('/channel/test', channelId ? { channelId } : {});
      setReport(r);
      toast(r.level === 'ok' ? 'القناة سليمة' : 'الفحص انتهى — اقرأ التفاصيل');
      await reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر الفحص');
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const wa = data?.items.find((c) => c.kind === 'whatsapp_cloud');
  const ig = data?.items.find((c) => c.kind === 'instagram');

  return (
    <>
      {toastNode}
      <div className="vh">
        <div>
          <h1>القنوات</h1>
          <p>نفس البوت ونفس المعرفة على كلّ قناة. ما يختلف هو ما تسمح به القناة.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        {/* ── واتساب ── */}
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 11 }}>
            <span className="pill acc">واتساب</span>
            <strong>{wa?.status === 'connected' ? 'موصول' : 'غير موصول'}</strong>
            <span className={`dot ${wa?.status === 'connected' ? 'ok' : wa?.status === 'error' ? 'crit' : 'off'}`}
              style={{ marginInlineStart: 'auto' }} />
          </div>

          {wa?.status === 'connected' ? (
            <dl className="kv">
              <dt>الرقم</dt><dd className="mono">{wa.displayName ?? '—'}</dd>
              <dt>بصمة التوكن</dt><dd className="mono">{wa.tokenFingerprint ?? '—'}</dd>
              <dt>الجودة</dt>
              <dd>
                {wa.qualityRating
                  ? <span className={`pill ${QUALITY[wa.qualityRating]?.cls ?? 'nt'}`}>
                      {QUALITY[wa.qualityRating]?.label ?? wa.qualityRating}
                    </span>
                  : '—'}
              </dd>
              <dt>مستوى الإرسال</dt><dd className="mono">{wa.messagingTier ?? '—'}</dd>
              <dt>آخر فحص</dt><dd>{fmt.when(wa.lastCheckedAt)}</dd>
              <dt>النافذة</dt><dd>{wa.capabilities.windowHours} ساعة من آخر رسالةٍ للزبون</dd>
              <dt>الأزرار</dt><dd><span className="pill ok">مدعومة</span> · {wa.capabilities.buttons} كحدّ أقصى</dd>
              <dt>إرسال الموقع</dt><dd><span className="pill ok">مدعوم</span></dd>
            </dl>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.7 }}>
              <p style={{ marginTop: 0 }}>
                رقمك وحسابك عند ميتا — لا عندنا. فاتورة ميتا عليك، وتأخذ رقمك معك إن رحلت.
              </p>
              <p style={{ marginBottom: 0 }}>
                الربط يحتاج أربع قيمٍ من لوحتك عند ميتا، ونقوم بها معك على مكالمة —
                <b> 30 إلى 60 دقيقة أوّل مرّة</b>.
              </p>
            </div>
          )}

          {wa?.lastError && <div className="note c" style={{ marginBottom: 0 }}>{wa.lastError}</div>}

          {report && (
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>نتيجة الفحص</dt>
              <dd><span className={`pill ${LEVEL[report.level]?.cls ?? 'nt'}`}>{LEVEL[report.level]?.label ?? report.level}</span></dd>
              <dt>التوكن</dt>
              <dd>{report.tokenValid ? <span className="pill ok">صالح</span> : <span className="pill crit">منتهٍ أو مسحوب</span>}</dd>
              <dt>اشتراك الويبهوك</dt>
              <dd>
                {report.webhookSubscribed === null ? <span className="pill nt">تعذّر التحقّق</span>
                  : report.webhookSubscribed ? <span className="pill ok">مشترك</span>
                    : <span className="pill crit">غير مشترك — لن تصل رسالة</span>}
              </dd>
              {report.issues.map((x) => (
                <div key={x} style={{ display: 'contents' }}>
                  <dt>ملاحظة</dt><dd>{x}</dd>
                </div>
              ))}
            </dl>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <button
              className="btn sm"
              disabled={can.readOnly || testing || wa?.status !== 'connected'}
              onClick={() => runTest(wa?.id)}
            >
              {testing ? 'يفحص…' : 'اختبر الاتّصال'}
            </button>
            {/* الربط واستبدال التوكن ما زالا يدويَّين — والزرّ المعطَّل بسببٍ
                مكتوبٍ أصدق من زرٍّ يبدو صالحاً ولا يفعل شيئاً. */}
            <button className="btn sm" disabled title="الربط يجري معك على مكالمة حتّى نُنهي معالج التهيئة">
              {wa?.status === 'connected' ? 'استبدل التوكن' : 'ابدأ الربط'}
            </button>
          </div>
        </div>

        {/* ── إنستجرام ── */}
        <div className="card" style={{ borderColor: 'var(--violet)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 11 }}>
            <span className="pill vio">إنستجرام</span>
            <strong>{ig?.status === 'connected' ? 'موصول' : 'غير موصول'}</strong>
            <span className={`dot ${ig?.status === 'connected' ? 'ok' : 'off'}`}
              style={{ marginInlineStart: 'auto' }} />
          </div>

          {ig?.status === 'connected' ? (
            <dl className="kv">
              <dt>الحساب</dt><dd className="mono">{ig.displayName ?? '—'}</dd>
              <dt>ما لصقتَه</dt><dd><b>لا شيء</b> — الربط بموافقةٍ لا بتوكن</dd>
              <dt>آخر فحص</dt><dd>{fmt.when(ig.lastCheckedAt)}</dd>
              <dt>النافذة</dt><dd>{ig.capabilities.windowHours} ساعة · <b>مستقلّة عن واتساب</b></dd>
              <dt>الأزرار</dt>
              <dd><span className="pill warn">تصير ردوداً سريعة</span> · {ig.capabilities.quickReplies}</dd>
              <dt>إرسال الموقع</dt>
              <dd><span className="pill nt">غير مدعوم — الأداة مخفيّة</span></dd>
            </dl>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.7 }}>
              <p style={{ marginTop: 0 }}>
                ثلاث ضغطات، ولا سرَّ تلصقه: تختار حسابك التجاريّ وتمنحنا قراءة الرسائل
                والردّ عليها. لا صلاحيّة نشرٍ ولا إعلانات.
              </p>
              <p style={{ marginBottom: 0 }}>
                نفس البوت ونفس المعرفة — ونافذةٌ مستقلّة تُحتسب على حدة.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {ig?.status === 'connected' ? (
              <>
                <button className="btn sm" disabled title="تدفّق الموافقة قيد البناء">أعِد المنح</button>
                <button className="btn sm dgr" disabled title="تدفّق الموافقة قيد البناء">افصل الحساب</button>
              </>
            ) : (
              <button className="btn sm pri" disabled title="تدفّق الموافقة قيد البناء — راسلنا لنربطه لك الآن">
                اربط حساب إنستجرام
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="note">
        <b>لماذا الربط مختلف بين القناتين.</b> واتساب على حسابك أنت، فالمسؤوليّة والرقم لك —
        والثمن تهيئةٌ أطول. وإنستجرام على تطبيقنا، فالربط بضغطة — والرسائل المباشرة بلا
        قوالب ولا حملات، فسطح المخالفة أضيق بكثير.
      </div>
    </>
  );
}
