'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, idempotencyKey, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { Empty, ErrorBox } from '@/components/Shell';
import { useSocket } from '@/lib/socket';

interface Conv {
  id: string;
  status: string;
  needsAttention: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  tags: string[];
  botEnabled: boolean;
  botPausedUntil: string | null;
  channelKind: string;
  contactName: string | null;
  handle: string;
  displayHandle: string | null;
}

interface Msg {
  id: string;
  direction: 'in' | 'out';
  source: string;
  type: string;
  body: string | null;
  payload: { options?: Array<{ id: string; title: string }> } | null;
  status: string | null;
  createdAt: string;
}

interface Thread {
  items: Msg[];
  window: { expiresAt: string | null; open: boolean; billedAt: string | null };
}

const CH: Record<string, { label: string; cls: string }> = {
  whatsapp_cloud: { label: 'واتساب', cls: 'acc' },
  instagram: { label: 'إنستجرام', cls: 'vio' },
};

const FILTERS = [
  { id: '', label: 'الكلّ' },
  { id: 'attn', label: 'يحتاج تدخّلاً' },
  { id: 'unread', label: 'غير مقروء' },
  { id: 'whatsapp_cloud', label: 'واتساب' },
  { id: 'instagram', label: 'إنستجرام' },
];

export default function InboxPage() {
  const can = useCan();
  const { toast, node: toastNode } = useToast();
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const qs = filter === 'attn' ? '?needsAttention=true'
    : filter === 'unread' ? '?unread=true'
      : filter ? `?channel=${filter}` : '';

  const list = useApi<{ items: Conv[] }>(`/conversations${qs}`, [filter]);
  const thread = useApi<Thread>(active ? `/conversations/${active}/messages` : null, [active]);
  const threadRef = useRef<HTMLDivElement>(null);

  // التحديث الحيّ يكتب في الكاش مباشرةً — لا يُعيد الجلب.
  // إنبوكسٌ بعشر محادثاتٍ نشطة يُرهق الشبكة لو أعاد الجلب مع كلّ حدث.
  useSocket({
    'message:new': (p: { conversationId: string; message: Msg }) => {
      if (p.conversationId === active) {
        thread.setData((t) => (t ? { ...t, items: [...t.items, p.message] } : t));
      }
      void list.reload();
    },
    'conversation:update': () => void list.reload(),
  });

  useEffect(() => {
    if (!active && list.data?.items.length) setActive(list.data.items[0]!.id);
  }, [list.data, active]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.data?.items.length]);

  const conv = list.data?.items.find((c) => c.id === active) ?? null;
  const win = thread.data?.window;
  const remaining = win?.expiresAt ? fmt.remaining(win.expiresAt) : null;
  const paused = conv?.botPausedUntil && new Date(conv.botPausedUntil) > new Date();

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active || sending) return;
    setSending(true);
    try {
      await post(`/conversations/${active}/messages`, { text }, { 'idempotency-key': idempotencyKey() });
      setDraft('');
      toast('ردّك أوقف البوت تلقائيّاً — بلا أن تضغط شيئاً');
      await thread.reload();
      await list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر الإرسال');
    } finally {
      setSending(false);
    }
  }

  async function toggleBot(pauseMinutes?: number) {
    if (!active) return;
    await post(`/conversations/${active}/bot`, pauseMinutes != null ? { pauseMinutes } : { enabled: true });
    await list.reload();
    toast(pauseMinutes != null ? 'تولّيتَ المحادثة — البوت توقّف' : 'أُعيد البوت للعمل');
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1>الإنبوكس</h1>
          <p>
            {can.settings
              ? 'تدخّلك يوقف البوت تلقائيّاً، ومؤقّت النافذة ظاهرٌ قبل أن تكتب.'
              : 'تقرأ وتردّ وتوسم. الإعدادات والفوترة لمالك الحساب.'}
          </p>
        </div>
      </div>

      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

      <div className="inbox">
        {/* ── القائمة ── */}
        <div className="ibcol">
          <div className="ibhead">
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {FILTERS.map((f) => (
                <button
                  key={f.id} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
                  style={{
                    fontSize: 10.5, padding: '2px 8px', borderRadius: 9,
                    border: `1px solid ${filter === f.id ? 'var(--accent)' : 'var(--rule)'}`,
                    background: filter === f.id ? 'var(--accent-wash)' : 'var(--surface)',
                    color: filter === f.id ? 'var(--accent-ink)' : 'var(--muted)',
                  }}
                >{f.label}</button>
              ))}
            </div>
          </div>

          <div className="convs">
            {list.loading && [0, 1, 2].map((i) => (
              <div key={i} style={{ padding: 12 }}><div className="skel" /></div>
            ))}
            {!list.loading && !list.data?.items.length && (
              <div className="empty" style={{ padding: 28 }}>
                <b>لا محادثات</b>
                {filter ? 'بدّل المرشّح لترى غيرها' : 'ستظهر هنا أوّل ما يراسلك زبون'}
              </div>
            )}
            {list.data?.items.map((c) => (
              <button
                key={c.id} className="conv" aria-current={c.id === active}
                onClick={() => { setActive(c.id); void post(`/conversations/${c.id}/read`).catch(() => {}); }}
              >
                <span className="r1">
                  <span className={`pill ${CH[c.channelKind]?.cls ?? 'nt'}`}>{CH[c.channelKind]?.label ?? c.channelKind}</span>
                  <span className="nm">{c.contactName ?? c.displayHandle ?? c.handle}</span>
                  <span className="tm">{fmt.when(c.lastMessageAt)}</span>
                </span>
                <span className="pv">{c.lastMessagePreview ?? '—'}</span>
                <span className="r3">
                  {c.needsAttention && <span className="pill crit">يحتاج تدخّلاً</span>}
                  {c.unreadCount > 0 && <span className="pill nt">{c.unreadCount} جديد</span>}
                  {c.tags.map((t) => <span className="pill nt" key={t}>{t}</span>)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── المحادثة ── */}
        <div className="ibcol">
          {!conv ? (
            <div className="empty" style={{ margin: 'auto' }}><b>اختر محادثة</b></div>
          ) : (
            <>
              <div className="ibhead" style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{conv.contactName ?? conv.displayHandle ?? conv.handle}</strong>
                <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{conv.handle}</span>
                <span className={`pill ${CH[conv.channelKind]?.cls ?? 'nt'}`}>{CH[conv.channelKind]?.label}</span>
                <span className={`pill ${win?.open ? 'ok' : 'warn'}`} style={{ marginInlineStart: 'auto' }}>
                  {win?.open ? `تبقّى ${remaining ?? '—'}` : 'النافذة مغلقة'}
                </span>
              </div>

              <div className="thread" ref={threadRef}>
                {thread.loading && <div className="skel" style={{ height: 60 }} />}
                {thread.data?.items.map((m) => {
                  if (m.source === 'system') return <div className="bub sys" key={m.id}>{m.body}</div>;
                  const cls = m.direction === 'in' ? 'in' : m.source === 'agent' ? 'agent' : 'bot';
                  return (
                    <div className={`bub ${cls}`} key={m.id}>
                      {m.direction === 'out' && (
                        <span className="src">{m.source === 'agent' ? 'موظّف' : 'بوت'}</span>
                      )}
                      {m.body}
                      {!!m.payload?.options?.length && (
                        <span className="chips">
                          {m.payload.options.map((o) => <span className="c" key={o.id}>{o.title}</span>)}
                        </span>
                      )}
                      <span className="mt">
                        {fmt.clock(m.createdAt)}
                        {m.direction === 'out' && m.status ? ` · ${STATUS[m.status] ?? m.status}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="takeover">
                <span className={`dot ${paused ? 'warn' : conv.botEnabled ? 'ok' : 'off'}`} />
                <strong>{paused ? 'تولّيتَ المحادثة' : conv.botEnabled ? 'البوت يردّ' : 'البوت متوقّف'}</strong>
                <span style={{ color: 'var(--muted)' }}>
                  {paused
                    ? `يعود ${fmt.when(conv.botPausedUntil)}`
                    : conv.botEnabled ? 'وسيتوقّف تلقائيّاً لحظة ما تردّ' : ''}
                </span>
                <button
                  className="btn sm" style={{ marginInlineStart: 'auto' }}
                  onClick={() => toggleBot(paused ? undefined : 30)}
                  disabled={can.readOnly}
                >
                  {paused ? 'أعِد البوت الآن' : 'تولّيتُ المحادثة'}
                </button>
              </div>

              {win?.open === false ? (
                <div className="locked">
                  <strong>لا يمكن الإرسال — نافذة الـ24 ساعة مغلقة.</strong> تُفتح من جديد حين
                  يُرسل الزبون رسالة. عطّلنا حقل الكتابة <strong>قبل</strong> أن تكتب، فلا تُرفض
                  رسالةٌ بعد كتابتها.
                </div>
              ) : (
                <form className="composer" onSubmit={send}>
                  <input
                    value={draft} onChange={(e) => setDraft(e.target.value)}
                    placeholder="اكتب ردّك…" disabled={sending || can.readOnly} aria-label="نصّ الردّ"
                  />
                  <button className="btn pri" type="submit" disabled={sending || !draft.trim() || can.readOnly}>
                    {sending ? '…' : 'إرسال'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {/* ── بطاقة الزبون ── */}
        <div className="ibcol">
          <div className="pane">
            {conv && (
              <>
                <div className="ph">بطاقة الزبون</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{conv.contactName ?? '—'}</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 10 }}>
                  {conv.handle}
                </div>

                <div className="ph">هويّاته عبر القنوات</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`pill ${CH[conv.channelKind]?.cls ?? 'nt'}`}>{CH[conv.channelKind]?.label}</span>
                  <span className="mono" style={{ fontSize: 10.5 }}>{conv.handle}</span>
                </div>

                <div className="ph">الوسوم</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {conv.tags.length
                    ? conv.tags.map((t) => <span className="pill nt" key={t}>{t}</span>)
                    : <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>لا وسوم</span>}
                </div>

                {!can.settings && (
                  <>
                    <div className="ph">مقفل عليك</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                      إعدادات البوت · المعرفة · الفوترة · حذف جهة الاتّصال.
                      اطلبها من مالك الحساب.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {toastNode}
    </>
  );
}

const STATUS: Record<string, string> = {
  queued: 'في الطابور', sent: '✓', delivered: '✓✓', read: '✓✓ قُرئت', failed: 'فشلت',
};
