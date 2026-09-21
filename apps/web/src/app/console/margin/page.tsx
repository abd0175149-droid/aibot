'use client';

import { useApi, fmt } from '@/lib/useApi';
import { Loading, ErrorBox, Empty } from '@/components/Shell';

interface Row {
  id: string;
  name: string;
  plan: string | null;
  revenue: number | null;
  aiCost: number;
  windows: number;
  avgTokensPerReply: number;
}

const JOD_PER_USD = 0.709;

export default function MarginPage() {
  const { data, loading, error, reload } = useApi<{ period: string; items: Row[] }>('/console/usage');

  if (loading) return <Loading rows={5} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  const max = Math.max(1, ...items.map((r) => Number(r.revenue ?? 0)));
  const totalRev = items.reduce((a, r) => a + Number(r.revenue ?? 0), 0);
  const totalCost = items.reduce((a, r) => a + r.aiCost * JOD_PER_USD, 0);

  return (
    <>
      <div className="vh">
        <div>
          <h1>الهامش</h1>
          <p>
            الإيراد مقابل كلفة النماذج، لكلّ عميلٍ ولكلّ شهر. الهدف: أن ترى عميلاً يستهلك
            أكثر ممّا يدفع <b>في شهره الأوّل</b> لا في السادس.
          </p>
        </div>
        <div className="sp"><span className="pill nt">{data?.period}</span></div>
      </div>

      <div className="tiles">
        <div className="tl good">
          <span className="v">{totalRev.toFixed(0)}<small> د.أ</small></span>
          <span className="k">الإيراد</span>
        </div>
        <div className="tl hot">
          <span className="v">{totalCost.toFixed(2)}<small> د.أ</small></span>
          <span className="k">كلفة النماذج</span>
        </div>
        <div className="tl">
          <span className="v">{totalRev ? fmt.pct((totalRev - totalCost) / totalRev) : '—'}</span>
          <span className="k">الهامش الإجماليّ</span>
        </div>
      </div>

      {!items.length ? (
        <Empty title="لا بيانات لهذا الشهر" hint="ستظهر أرقام الهامش بعد أوّل اشتراكٍ فعّال." />
      ) : (
        <div className="card">
          {items.map((r) => {
            const rev = Number(r.revenue ?? 0);
            const cost = r.aiCost * JOD_PER_USD;
            const margin = rev ? (rev - cost) / rev : 0;
            const low = margin < 0.5;
            return (
              <div key={r.id} style={{ marginBottom: 15 }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'baseline', fontSize: 12.5, marginBottom: 5 }}>
                  <strong>{r.name}</strong>
                  {r.plan && <span className="pill nt">{r.plan}</span>}
                  <span className="num" style={{ marginInlineStart: 'auto' }}>
                    {rev.toFixed(0)} − {cost.toFixed(2)} ={' '}
                    <b style={{ color: low ? 'var(--crit)' : 'var(--ok)' }}>{fmt.pct(margin)}</b>
                  </span>
                </div>
                <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--rule)' }}>
                  <div style={{
                    width: `${(rev / max) * 100}%`, background: 'var(--accent)',
                    display: 'flex', alignItems: 'center', paddingInlineStart: 7,
                    fontSize: 9.5, color: '#fff', fontFamily: 'IBM Plex Mono, monospace',
                  }}>{rev.toFixed(0)}</div>
                  <div style={{ width: 2, background: 'var(--surface)' }} />
                  <div style={{
                    width: `${Math.max((cost / max) * 100, 3)}%`, background: 'var(--amber)',
                    display: 'flex', alignItems: 'center', paddingInlineStart: 5,
                    fontSize: 9.5, color: '#fff', fontFamily: 'IBM Plex Mono, monospace',
                  }}>{cost.toFixed(1)}</div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
                  {fmt.num(r.windows)} نافذة · وسيط {fmt.num(r.avgTokensPerReply)} توكن لكلّ ردّ
                  {low && <b style={{ color: 'var(--crit)' }}> · هامشٌ دون 50% — راجع التسعير أو حجم معرفته</b>}
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-2)', marginTop: 4 }}>
            <span><i style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', display: 'inline-block', marginInlineEnd: 5 }} />إيراد (د.أ)</span>
            <span><i style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--amber)', display: 'inline-block', marginInlineEnd: 5 }} />كلفة النماذج (د.أ)</span>
          </div>
        </div>
      )}

      <div className="note w">
        <b>راجع هذه الشاشة أسبوعيّاً.</b> عميلٌ هامشه دون 50% يعني أحد أمرين: التسعير خاطئ،
        أو معرفته أكبر من باقته. والثاني يُعالَج بتحويله إلى وضع الاسترجاع — فتصير كلفة
        ردّه مستقلّةً عن حجم معرفته.
      </div>
    </>
  );
}
