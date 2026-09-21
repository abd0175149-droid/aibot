'use client';

import Link from 'next/link';
import { useApi, fmt } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { Loading, ErrorBox } from '@/components/Shell';

interface Overview {
  conversationsToday: number;
  botReplies: number;
  windowsUsed: number;
  windowsLimit: number;
  selfResolvedRate: number;
  medianLatencyMs: number;
  needsAttention: number;
  botEnabled: boolean;
  channels: Array<{ kind: string; status: string; displayName: string | null }>;
  overagePolicy: string;
}

interface Gap {
  query: string;
  times: number;
  retrieved: number;
  diagnosis: string;
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp_cloud: 'واتساب', instagram: 'إنستجرام' };

export default function HomePage() {
  const { me } = useSession();
  const hasTenant = Boolean(me?.tenant);
  const { data, error, loading, reload } = useApi<Overview>(hasTenant ? '/reports/overview' : null);
  const gaps = useApi<Gap[]>(hasTenant ? '/bot/knowledge/gaps' : null);

  // مالك المنصّة يُحوَّل إلى /console من Shell — هذا فقط لتفادي وميضٍ
  if (!hasTenant) return <Loading rows={4} />;
  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const pct = data.windowsLimit ? data.windowsUsed / data.windowsLimit : 0;
  const atCap = pct >= 1;

  return (
    <>
      <div className="vh">
        <div>
          <h1>الرئيسيّة</h1>
          <p>نبض اليوم</p>
        </div>
      </div>

      {atCap && (
        <div className="note c">
          <b>بلغتَ سقف الباقة لهذا الشهر.</b>{' '}
          {data.overagePolicy === 'handoff_only'
            ? 'البوت توقّف، والرسائل ما زالت تصل وتُوسَم «يحتاج تدخّلاً». فريقك يردّ يدويّاً بلا حدّ — لا زبونٌ يُترك بلا ردّ، ولا فاتورةٌ مفاجئة.'
            : data.overagePolicy === 'block'
              ? 'البوت يرسل رسالةً واحدة مهذّبة ثمّ يصمت.'
              : 'البوت يستمرّ، والتجاوز يُسجَّل ويُفوتَر.'}{' '}
          <Link href="/app/usage">شاهد الاستهلاك</Link>
        </div>
      )}

      <div className="tiles">
        <div className="tl">
          <span className="v">{fmt.num(data.conversationsToday)}</span>
          <span className="k">محادثة اليوم</span>
        </div>
        <div className="tl">
          <span className="v">{fmt.num(data.botReplies)}</span>
          <span className="k">ردّ بوت</span>
        </div>
        <div className={`tl ${atCap ? 'bad' : pct >= 0.8 ? 'hot' : ''}`}>
          <span className="v">{fmt.num(data.windowsUsed)}<small> / {fmt.num(data.windowsLimit)}</small></span>
          <span className="k">
            نوافذ الشهر
            <span className={`meter ${atCap ? 'crit' : pct >= 0.8 ? 'warn' : ''}`}>
              <i style={{ width: `${Math.min(pct * 100, 100)}%` }} />
            </span>
          </span>
        </div>
        <div className="tl good">
          <span className="v">{fmt.pct(data.selfResolvedRate)}</span>
          <span className="k">أنهاها البوت بلا موظّف</span>
        </div>
        <div className="tl">
          <span className="v">{(data.medianLatencyMs / 1000).toFixed(1)}<small> ث</small></span>
          <span className="k">وسيط زمن الردّ</span>
        </div>
        <div className={`tl ${data.needsAttention ? 'bad' : ''}`}>
          <span className="v">{fmt.num(data.needsAttention)}</span>
          <span className="k">تحتاج تدخّلاً الآن</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <div className="card">
          <h2>حالة بوتك</h2>
          <dl className="kv">
            <dt>البوت</dt>
            <dd>
              {atCap ? <span className="pill crit">متوقّف — السقف</span>
                : data.botEnabled ? <span className="pill ok">يعمل</span>
                  : <span className="pill nt">مطفأ</span>}
            </dd>
            {data.channels.map((c) => (
              <div key={c.kind} style={{ display: 'contents' }}>
                <dt>{CHANNEL_LABEL[c.kind] ?? c.kind}</dt>
                <dd>
                  <span className={`dot ${c.status === 'connected' ? 'ok' : c.status === 'error' ? 'crit' : 'off'}`} />{' '}
                  {c.displayName ?? (c.status === 'connected' ? 'موصول' : 'غير موصول')}
                </dd>
              </div>
            ))}
            {!data.channels.length && (
              <>
                <dt>القنوات</dt>
                <dd><Link href="/app/channels">لم تربط قناةً بعد</Link></dd>
              </>
            )}
          </dl>
        </div>

        <div className="card">
          <h2>فرصة تحسين — لا عطل</h2>
          {gaps.loading && <div className="skel" style={{ height: 40 }} />}
          {!gaps.loading && !gaps.data?.length && (
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
              لا أسئلة عجز عنها بوتك هذا الشهر. 🌿
            </p>
          )}
          {!!gaps.data?.length && (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: '0 0 10px' }}>
                <b>{gaps.data.length}</b> سؤالاً عجز عنها بوتك. أضِفها لمعرفته وسترتفع نسبة ما يحلّه بنفسه.
              </p>
              {gaps.data.slice(0, 3).map((g) => (
                <div key={g.query} style={{
                  background: 'var(--surface-2)', borderRadius: 5, padding: '7px 10px',
                  fontSize: 11.5, marginBottom: 6, lineHeight: 1.6,
                }}>
                  «{g.query}» — سُئل {g.times} مرّات
                  <br />
                  <span className="mono" style={{ color: g.retrieved === 0 ? 'var(--crit)' : 'var(--amber)' }}>
                    {g.diagnosis}
                  </span>
                </div>
              ))}
              <Link className="btn sm" href="/app/bot?tab=kb">افتح المعرفة</Link>
            </>
          )}
        </div>
      </div>

      <div className="note">
        <b>تمييزٌ يوفّر عليك أسبوعاً.</b> «بحث ولم يجد» يعني أنّ المعلومة ناقصةٌ من معرفتك —
        أضِفها. و«وجد ولم يُجب» يعني أنّها موجودةٌ والمشكلة في شخصيّة البوت — راسلنا.
        بلا هذا التمييز تضيف محتوًى لمشكلةٍ ليست فيه.
      </div>
    </>
  );
}
