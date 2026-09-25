'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * ★★★ **جرسُ التنبيهات — الاحتياطُ الذي لم يكن.**
 *
 *   جدولُ `notifications` يكتبه العامل في كلّ تنبيهٍ حرج (توكنٌ منتهٍ · ويبهوك
 *   صامت · سقفٌ بلغ · فشلُ مزوّد) — ولم يقرأه مسارٌ ولا شاشةٌ إطلاقاً. فالصفوف
 *   تُكتب ويحذفها الاحتفاظُ بعد تسعين يوماً ولا يراها إنسانٌ قطّ.
 *
 *   والدفعُ (Web Push) لا يكفي وحده، وهذا بيتُ القصيد: الإذنُ يُرفض، أو يُسحب
 *   من إعدادات المتصفّح، أو يُبدَّل مفتاحُ VAPID فتموت الاشتراكاتُ كلُّها بصمت،
 *   أو يُفتح الحسابُ على جهازٍ جديد. وفي كلّ حالةٍ **لا يصل التنبيه ولا يعلم
 *   أحدٌ أنّه لم يصل**. فالجرسُ يجعله موجوداً حيث ينظر المستخدمُ أصلاً.
 *
 * ⚠️ ولا يُخفى عند الصفر. الجرسُ الذي يظهر عند وجود خبرٍ فقط يجعل غيابَه
 *    غامضاً: «لا تنبيهات» و«الجرسُ معطوب» يبدوان سواءً. فيبقى ظاهراً بلا
 *    شارةٍ — وهو نفسُه خبرٌ: القناةُ تعمل ولا جديد.
 */

interface Notif {
  id: string;
  tag: string;
  title: string;
  body: string | null;
  data: { url?: string } | null;
  readAt: string | null;
  createdAt: string;
}

/** كلُّ دقيقة: التنبيهُ الحرجُ يستحقّها، والنداءُ واحدٌ يُعيد العدّ والقائمة. */
const POLL_MS = 60_000;

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const h = Math.round(mins / 60);
  if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.round(h / 24)} ي`;
}

export function NotifBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Notif[]; unread: number }>('/notifications');
      setItems(r.items);
      setUnread(r.unread);
      setFailed(false);
    } catch {
      /* لا تُمسَح القائمةُ عند فشلٍ عابر: شاشةٌ تُفرَغ عند وميض شبكةٍ تقول
         «لا تنبيهات» وهي كذبة. تبقى الأخيرةُ ويُعلَن أنّها قديمة. */
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  /* الإغلاقُ بالضغط خارجَه وبـEscape: لوحةٌ تُفتح ولا تُغلق إلّا بزرّها تسجن
     من فتحها بالخطأ — ومن يستعمل المفتاح لا زرَّ يصل إليه. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function openOne(n: Notif) {
    /* التعليمُ أوّلاً ثمّ الانتقال: الانتقالُ يُفكّك هذا المكوّن، فنداءٌ
       بعده يُلغى ويبقى التنبيهُ غيرَ مقروءٍ إلى الأبد. */
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    }
    const url = n.data?.url;
    if (url) window.location.href = url;
    else setOpen(false);
  }

  async function readAll() {
    setUnread(0);
    setItems((xs) => xs.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    await api('/notifications/read-all', { method: 'POST' }).catch(() => undefined);
  }

  return (
    <div className="nb" ref={box}>
      <button
        type="button"
        className="nb-btn"
        aria-expanded={open}
        aria-label={unread ? `التنبيهات — ${unread} غير مقروء` : 'التنبيهات'}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">🔔</span>
        {/* الشارةُ رقمٌ لا نقطة: «واحد» و«سبعة عشر» قراران مختلفان.
            و`.num` تعزل الرقم LTR — ولا يُوضع فيها حرفٌ عربيّ أبداً. */}
        {unread > 0 && <span className="nb-badge num">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label="التنبيهات">
          <div className="nb-hd">
            <b>التنبيهات</b>
            {unread > 0 && (
              <button type="button" className="nb-all" onClick={() => void readAll()}>
                تعليم الكلّ مقروءاً
              </button>
            )}
          </div>

          {failed && <p className="nb-note bad">تعذّر تحديث التنبيهات — هذه آخرُ قائمةٍ وصلت.</p>}

          {items.length === 0 ? (
            /* «لا تنبيهات» تُقال صراحةً: لوحةٌ فارغةٌ تُقرأ عطلاً. */
            <p className="nb-note">لا تنبيهات. القناة تعمل ولا جديد.</p>
          ) : (
            <ul className="nb-list">
              {items.map((n) => (
                <li key={n.id} className={n.readAt ? 'nb-i' : 'nb-i new'}>
                  <button type="button" className="nb-it" onClick={() => void openOne(n)}>
                    <span className="nb-t">{n.title}</span>
                    {n.body && <span className="nb-b">{n.body}</span>}
                    <span className="nb-w">{when(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
