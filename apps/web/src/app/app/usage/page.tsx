'use client';

import { useApi, fmt } from '@/lib/useApi';
import { Loading, ErrorBox, Empty } from '@/components/Shell';

interface Window {
  id: string;
  handle: string;
  contactName: string | null;
  channelKind: string;
  openedAt: string;
  billedAt: string | null;
  messagesIn: number;
  messagesOut: number;
  aiCostUsd: string;
}

interface Usage {
  period: string;
  windowsBilled: number;
  windowsOpened: number;
  windowsLimit: number;
  aiTokens: number;
  aiTokensLimit: number;
  aiCostUsd: number;
  avgRepliesPerWindow: number;
  items: Window[];
}

const CH: Record<string, { label: string; cls: string }> = {
  whatsapp_cloud: { label: 'واتساب', cls: 'acc' },
  instagram: { label: 'إنستجرام', cls: 'vio' },
};

export default function UsagePage() {
  const { data, loading, error, reload } = useApi<Usage>('/usage');

  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const pct = data.windowsLimit ? data.windowsBilled / data.windowsLimit : 0;
  const unbilled = data.windowsOpened - data.windowsBilled;

  return (
    <>
      <div className="vh">
        <div>
          <h1>الاستهلاك</h1>
          <p>هذا هو جدول النوافذ نفسه الذي تُفوتَر عليه — لا ملخّصاً مشتقّاً منه.</p>
        </div>
        <div className="sp">
          <span className="pill nt">{data.period}</span>
          <a className="btn sm" href="/api/usage/windows.csv" download>تصدير CSV</a>
        </div>
      </div>

      <div className="tiles">
        <div className={`tl ${pct >= 1 ? 'bad' : pct >= 0.8 ? 'hot' : ''}`}>
          <span className="v">{fmt.num(data.windowsBilled)}<small> / {fmt.num(data.windowsLimit)}</small></span>
          <span className="k">
            نوافذ مُفوتَرة
            <span className={`meter ${pct >= 1 ? 'crit' : pct >= 0.8 ? 'warn' : ''}`}>
              <i style={{ width: `${Math.min(pct * 100, 100)}%` }} />
            </span>
          </span>
        </div>
        <div className="tl">
          <span className="v">{fmt.num(data.windowsOpened)}</span>
          <span className="k">نافذة فُتحت — منها <b>{fmt.num(unbilled)}</b> بلا ردّ فلم تُفوتَر</span>
        </div>
        <div className="tl">
          <span className="v">{(data.aiTokens / 1e6).toFixed(1)}<small>M</small></span>
          <span className="k">توكن · من {(data.aiTokensLimit / 1e6).toFixed(0)}M</span>
        </div>
        <div className="tl good">
          <span className="v">{data.avgRepliesPerWindow.toFixed(1)}</span>
          <span className="k">وسيط الردود لكلّ نافذة</span>
        </div>
      </div>

      {!data.items.length ? (
        <Empty title="لا نوافذ هذا الشهر" hint="ستظهر هنا أوّل ما يراسلك زبونٌ ويردّ عليه بوتك." />
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>الزبون</th><th>القناة</th><th>فُتحت</th><th>فُوتِرت</th>
                <th>رسائل</th><th>كلفة الذكاء</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((w) => (
                <tr key={w.id}>
                  <td>
                    <span className="mono" style={{ fontSize: 11.5 }}>{w.contactName ?? w.handle}</span>
                  </td>
                  <td><span className={`pill ${CH[w.channelKind]?.cls ?? 'nt'}`}>{CH[w.channelKind]?.label ?? w.channelKind}</span></td>
                  <td>{fmt.when(w.openedAt)}</td>
                  <td>
                    {w.billedAt
                      ? fmt.when(w.billedAt)
                      : <span className="pill nt">لم تُفوتَر — لا ردّ</span>}
                  </td>
                  <td className="num">{w.messagesIn + w.messagesOut}</td>
                  <td className="num">{fmt.money(w.aiCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="note">
        <b>النافذة لكلّ قناة لا لكلّ إنسان.</b> زبونٌ يراسلك على واتساب وإنستجرام يستهلك
        نافذتين — لأنّهما محادثتان منفصلتان عند ميتا، وكلفتهما علينا منفصلة.
      </div>

      <div className="note">
        <b>صفّ «لم تُفوتَر» هو أهمّ صفٍّ في الجدول.</b> الرسالة التي لم يردّ عليها أحدٌ لا
        تُحسب عليك. العدّاد كلّه أمامك لتراجعه بنفسك — وتصدّره متى شئت.
      </div>
    </>
  );
}
