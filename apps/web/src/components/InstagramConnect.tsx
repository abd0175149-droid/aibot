'use client';

import { useEffect, useState } from 'react';
import { get, post, ApiError } from '@/lib/api';
import { Button, Note, Sheet, Stack } from '@/components/ui';

/**
 * ★★ ربطُ إنستجرام من شاشة القنوات — «تسجيل الدخول بفيسبوك للأعمال».
 *
 *   ① زرٌّ يطلب من الخادم رابطَ نافذة فيسبوك ويذهب إليه.
 *   ② فيسبوك يعيد المالكَ إلى `/app/channels?ig=<nonce>` (أو `?ig_error=`)،
 *      فتُفتح ورقةٌ بصفحاته التي لها حسابُ إنستجرام.
 *   ③ يختار صفحةً فيُربط الحساب — والخادمُ يشترك باسمها في إشعارات الرسائل.
 *
 * ⚠️ وحين لا يكون تطبيقُ AiBot مهيّأً عند ميتا يُقال ذلك نصّاً ولا يُعرض زرٌّ
 *    يفتح نافذةً ثمّ يفشل.
 */

interface Page { pageId: string; pageName: string; igId: string; igUsername: string | null }

const ERR: Record<string, string> = {
  state: 'انتهت مهلة الربط أو الرابط غير صالح — ابدأ من جديد.',
  denied: 'لم تكتمل الموافقة في فيسبوك — لم يربط شيء.',
  unavailable: 'ربط إنستجرام غير مفعّل على المنصّة بعد.',
  no_pages: 'لم نجد صفحة فيسبوك مربوطا بها حساب إنستجرام احترافيّ. اربط الحساب بصفحتك ثمّ أعد المحاولة.',
  exchange: 'ميتا رفضت إتمام الربط — أعد المحاولة بعد دقائق.',
};

export function InstagramConnect({ readOnly, onConnected }: { readOnly: boolean; onConnected: () => void }) {
  const [avail, setAvail] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [pick, setPick] = useState<string>('');

  useEffect(() => {
    get<{ available: boolean; reason: string | null }>('/channels/instagram/status')
      .then(setAvail).catch(() => setAvail({ available: false, reason: 'تعذّر التحقّق من إتاحة الربط.' }));
    /* العودة من فيسبوك: المعاملُ في العنوان تُقرأ مرّةً ثمّ تُمحى — فلا يُعاد
       فتحُ الورقة عند تحديث الصفحة، ولا يبقى الرمزُ في سجلّ المتصفّح. */
    const q = new URLSearchParams(window.location.search);
    const n = q.get('ig');
    const e = q.get('ig_error');
    if (n || e) window.history.replaceState(null, '', window.location.pathname);
    if (e) setErr(ERR[e] ?? 'تعذّر الربط.');
    if (n && /^[0-9a-f]{24}$/.test(n)) {
      setNonce(n);
      get<{ pages: Page[] }>(`/channels/instagram/pending/${n}`)
        .then((r) => { setPages(r.pages); setPick(r.pages[0]?.pageId ?? ''); })
        .catch((x) => setErr(x instanceof ApiError ? x.message : 'تعذّر جلب صفحاتك.'));
    }
  }, []);

  async function start() {
    setBusy(true); setErr(null);
    try {
      const r = await post<{ url: string }>('/channels/instagram/start');
      window.location.assign(r.url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر بدء الربط.');
      setBusy(false);
    }
  }

  async function connect() {
    if (!nonce || !pick) return;
    setBusy(true); setErr(null);
    try {
      await post('/channels/instagram/connect', { nonce, pageId: pick });
      setPages(null); setNonce(null);
      onConnected();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر الربط.');
    } finally { setBusy(false); }
  }

  return (
    <>
      {err && <Note tone="crit">{err}</Note>}
      {avail && !avail.available && <p className="muted-p">{avail.reason}</p>}
      {avail?.available && (
        <Button variant="primary" busy={busy && !pages} disabled={readOnly}
          reason={readOnly ? 'حسابك للقراءة فقط' : undefined} onClick={() => void start()}>
          اربط عبر فيسبوك
        </Button>
      )}

      <Sheet open={Boolean(pages)} title="اختر صفحتك" onClose={() => { setPages(null); setNonce(null); }}
        footer={(
          <Button variant="primary" busy={busy} disabled={!pick || readOnly} onClick={() => void connect()}>
            اربط هذا الحساب
          </Button>
        )}>
        <Stack gap="sm">
          <p className="muted-p">الصفحات التي لها حساب إنستجرام احترافيّ. الرسائل تصل عبر الصفحة التي تختارها.</p>
          <div className="opts" role="radiogroup" aria-label="الصفحات">
            {(pages ?? []).map((p) => (
              <button key={p.pageId} type="button" className="opt" role="radio" aria-checked={pick === p.pageId}
                aria-pressed={pick === p.pageId} onClick={() => setPick(p.pageId)}>
                <span className="opt-t">
                  <span dir="auto">{p.pageName}</span>
                  <span className="opt-n" dir="ltr">{p.igUsername ? `@${p.igUsername}` : p.igId}</span>
                </span>
                {pick === p.pageId ? <span className="opt-ck" aria-hidden="true">✓</span> : <span />}
              </button>
            ))}
          </div>
        </Stack>
      </Sheet>
    </>
  );
}
