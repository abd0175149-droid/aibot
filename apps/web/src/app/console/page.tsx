'use client';

import { useApi, fmt } from '@/lib/useApi';
import { Loading, ErrorBox, Empty } from '@/components/Shell';

interface Row {
  id: string;
  name: string;
  status: string;
  plan: string | null;
  windowLimit: number | null;
  windowsUsed: number;
  aiCost: number;
  openCritical: number;
  channelHealth: string;
  knowledgeMode: string;
}

const HEALTH: Record<string, { dot: string; label: string }> = {
  connected: { dot: 'ok', label: 'سليم' },
  pending: { dot: 'warn', label: 'قيد الربط' },
  error: { dot: 'crit', label: 'عطل' },
  none: { dot: 'off', label: 'بلا قناة' },
};

export default function TenantsPage() {
  const { data, loading, error, reload } = useApi<{ items: Row[] }>('/console/tenants');

  if (loading) return <Loading rows={5} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  const totalCost = items.reduce((a, r) => a + Number(r.aiCost ?? 0), 0);
  const critical = items.filter((r) => r.openCritical > 0).length;

  return (
    <>
      <div className="vh">
        <div>
          <h1>العملاء</h1>
          <p>
            مرتَّبٌ <b>بالمخاطرة</b> لا بالاسم: الأسوأ صحّةً أوّلاً، ثمّ الأقرب إلى سقفه.
            هذا الترتيب هو الشاشة كلّها.
          </p>
        </div>
        <div className="sp"><button className="btn pri">+ عميل جديد</button></div>
      </div>

      <div className="tiles">
        <div className="tl"><span className="v">{fmt.num(items.length)}</span><span className="k">عملاء نشطون</span></div>
        <div className={`tl ${critical ? 'bad' : ''}`}>
          <span className="v">{fmt.num(critical)}</span><span className="k">عملاء بحوادث حرجة</span>
        </div>
        <div className="tl hot">
          <span className="v">{fmt.money(totalCost)}</span><span className="k">كلفة النماذج هذا الشهر</span>
        </div>
      </div>

      {!items.length ? (
        <Empty
          title="لا عملاء بعد"
          hint="أنشئ أوّل مستأجر — وابدأ ببوتك أنت: بياناتك، ومخاطرتك، وأصدق اختبارٍ ممكن."
          action={<button className="btn pri">+ عميل جديد</button>}
        />
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>العميل</th><th>الباقة</th><th>الصحّة</th><th>النوافذ / السقف</th>
                <th>الكلفة</th><th>المعرفة</th><th>حوادث</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const pct = r.windowLimit ? (r.windowsUsed / r.windowLimit) * 100 : 0;
                const h = HEALTH[r.channelHealth] ?? HEALTH.none!;
                return (
                  <tr key={r.id} className="clk">
                    <td><strong>{r.name}</strong></td>
                    <td>{r.plan ?? '—'}</td>
                    <td><span className={`dot ${h.dot}`} /> <span style={{ fontSize: 11.5 }}>{h.label}</span></td>
                    <td className="num">
                      {fmt.num(r.windowsUsed)} / {fmt.num(r.windowLimit)}
                      <span className={`meter ${pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : ''}`}>
                        <i style={{ width: `${Math.min(pct, 100)}%` }} />
                      </span>
                    </td>
                    <td className="num">{fmt.money(r.aiCost)}</td>
                    <td>
                      <span className={`pill ${r.knowledgeMode === 'full' ? 'nt' : 'acc'}`}>{r.knowledgeMode}</span>
                    </td>
                    <td>
                      {r.openCritical > 0
                        ? <span className="pill crit">{r.openCritical}</span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="note">
        <b>عمود «المعرفة» ليس زينة.</b> عميلٌ على <code>full</code> بمعرفةٍ تكبر هو الإنذار
        المبكّر لانفجار الكلفة — تراه هنا قبل أن تراه في الفاتورة.
      </div>
    </>
  );
}
