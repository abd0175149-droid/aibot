'use client';

import {
  Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi, useToast, fmt, AR_LOCALE } from '@/lib/useApi';
import { api, post, idempotencyKey, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { useSocket } from '@/lib/socket';
import { Pill, Dot, Note, Button, Skeleton, Empty, ErrorBox } from '@/components/ui';

/**
 * الإنبوكس.
 *
 * ★ العطل الذي كان يُفقد الشاشة قيمتها كلّها — ورآه المستخدم قبلي:
 *   **لا تمرير في الحوار.** `.thread` كان `flex: 1; overflow-y: auto` داخل
 *   عمودٍ مرن، و`min-height` الافتراضيّ لعنصرٍ مرن هو `auto` — أي أنّه
 *   **يرفض أن يصغر عن محتواه**. فلا يفيض شيءٌ أبداً، و`overflow` لا يشتغل،
 *   ويقصّه الأب بـ`overflow: hidden`. والأسوأ أنّ **المُنشئ وشريط التدخّل
 *   يُدفعان خارج الصندوق فيختفيان تماماً** — شاشةُ ردٍّ بلا حقل كتابة.
 *   والحلّ بنيويّ لا ترقيعيّ: `Shell` يثبّت هذه الشاشة بارتفاعٍ حقيقيّ،
 *   وكلّ عمودٍ مُمرِّرٍ يحمل `min-height: 0` صريحة.
 *
 * ★ وستّ قدراتٍ يقدّمها الخادم اليوم ولم تكن الشاشة تلمسها:
 *   البحث (`q`) · التصفيح بالمؤشّر (`cursor`) · رسائل أقدم (`before`) ·
 *   مدّة إسكاتٍ يختارها الموظّف · حدود القناة (`maxTextLen` — والخادم
 *   **يقصّ** الزائد بصمت فكان الموظّف لا يعلم أنّ رسالته بُترت) · وحالة
 *   القناة (كان يردّ على قناةٍ مقطوعة بلا إشارة).
 *
 * ★ والمحادثة المفتوحة في العنوان (`?c=`): فزرّ الرجوع في أندرويد وحركة
 *   الحافّة في آيفون تُغلقان الحوار — وهو أوّل ما تفعله اليد بلا تفكير.
 */

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
  payload: {
    options?: Array<{ id: string; title: string }>;
    buttonPayload?: string | null;
    mediaId?: string | null;
  } | null;
  status: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

interface Thread {
  items: Msg[];
  window: { expiresAt: string | null; open: boolean; billedAt: string | null };
}

interface ConvList { items: Conv[]; nextCursor: string | null }

interface ChannelCaps {
  kind: string;
  status: string;
  lastError: string | null;
  capabilities: { maxTextLen: number; windowHours: number; quickReplies: number; buttons: number };
}

const CH: Record<string, { label: string; tone: 'brand' | 'violet' }> = {
  whatsapp_cloud: { label: 'واتساب', tone: 'brand' },
  instagram: { label: 'إنستجرام', tone: 'violet' },
};

const FILTERS = [
  { id: '', label: 'الكلّ' },
  { id: 'attn', label: 'يحتاج تدخّلاً' },
  { id: 'whatsapp_cloud', label: 'واتساب' },
  { id: 'instagram', label: 'إنستجرام' },
] as const;

const DELIVERY: Record<string, string> = {
  queued: 'في الطابور', sent: '✓', delivered: '✓✓', read: '✓✓ قُرئت', failed: 'لم تصل',
};

const SOURCE: Record<string, { label: string; mark: string }> = {
  bot: { label: 'بوت', mark: '⬡' },
  agent: { label: 'موظّف', mark: '◆' },
  template: { label: 'قالب', mark: '▤' },
};

/** مدد الإسكات — الخادم يقبل أيّ عدد دقائق، والشاشة كانت تُثبّت ٣٠. */
const PAUSES = [
  { m: 30, label: 'نصف ساعة' },
  { m: 180, label: 'ثلاث ساعات' },
  { m: 1440, label: 'حتّى الغد' },
] as const;

/**
 * ★ رسائل الوسائط كانت تُرسَم **فقاعةً فارغة بتوقيتٍ وحده**: `type` مجلوبٌ
 *   ومُعلَنٌ ولا يُستعمَل، و`body` يكون `null` لكلّ وسيط. فزبونٌ يرسل صورة
 *   قائمةٍ أو تسجيلاً صوتيّاً يُنتج فراغاً — والموظّف يظنّ النظام معطوباً.
 *   لا نستطيع عرض الوسيط بعد (لا نقطة تنزيل)، و**قولُ ما وصل أصدق من فراغ**.
 */
const MEDIA: Record<string, string> = {
  image: 'صورة', audio: 'تسجيل صوتيّ', video: 'مقطع مرئيّ',
  document: 'ملفّ', location: 'موقع', story_reply: 'ردٌّ على ستوري',
  unsupported: 'نوعٌ لا تدعمه القناة',
};

function initial(name: string): string {
  const t = name.trim();
  return t ? [...t][0]!.toUpperCase() : '؟';
}

/** ما يُعرَض للموظّف عن ضغطةِ زرٍّ — لا «أكّد» عارية. */
function pressLabel(payload: string): { verb: string; action: string } {
  const [kind, ...rest] = payload.split(':');
  const action = rest.join(':') || '—';
  if (kind === 'confirm') return { verb: 'أكّد', action };
  if (kind === 'cancel') return { verb: 'ألغى', action };
  return { verb: 'اختار', action: payload };
}

/** يومٌ مقروء لفاصل الحوار — «اليوم» و«أمس» ثمّ تاريخ. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const n = new Date();
  const days = Math.floor(
    (new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
      - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000,
  );
  if (days === 0) return 'اليوم';
  if (days === 1) return 'أمس';
  return new Intl.DateTimeFormat(AR_LOCALE, { day: 'numeric', month: 'long' }).format(d);
}

function InboxScreen() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const { toast, node: toastNode } = useToast();

  const active = params.get('c');
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [extra, setExtra] = useState<Conv[]>([]);
  const [older, setOlder] = useState<Msg[]>([]);
  const [atBottom, setAtBottom] = useState(true);
  const [pauseOpen, setPauseOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  /* تهدئة البحث: الخادم يدعم `q` منذ البداية ولم تستعمله الشاشة إطلاقاً. */
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filter === 'attn') p.set('needsAttention', 'true');
    else if (filter) p.set('channel', filter);
    if (query) p.set('q', query);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [filter, query]);

  const list = useApi<ConvList>(`/conversations${qs}`, [qs]);
  const thread = useApi<Thread>(active ? `/conversations/${active}/messages` : null, [active]);
  const chans = useApi<{ items: ChannelCaps[] }>('/channel');

  useEffect(() => { setExtra([]); }, [qs]);
  useEffect(() => { setOlder([]); setDraft(''); setAtBottom(true); }, [active]);

  const items = useMemo(() => [...(list.data?.items ?? []), ...extra], [list.data, extra]);
  const conv = items.find((c) => c.id === active) ?? null;
  const msgs = useMemo(() => [...older, ...(thread.data?.items ?? [])], [older, thread.data]);

  const caps = chans.data?.items.find((c) => c.kind === conv?.channelKind);
  const maxLen = caps?.capabilities.maxTextLen ?? 4096;
  const win = thread.data?.window;
  const remaining = win?.expiresAt ? fmt.remaining(win.expiresAt) : null;
  const paused = Boolean(conv?.botPausedUntil && new Date(conv.botPausedUntil) > new Date());

  const open = useCallback((id: string | null) => {
    // العنوان يحمل المحادثة: زرّ الرجوع وحركة الحافّة يُغلقان الحوار
    router.push(id ? `/app/inbox?c=${id}` : '/app/inbox');
    if (id) void post(`/conversations/${id}/read`).catch(() => undefined);
  }, [router]);

  useSocket({
    'message:new': (p: { conversationId: string; message: Msg }) => {
      if (p.conversationId === active) {
        thread.setData((t) => {
          if (!t) return t;
          if (t.items.some((m) => m.id && m.id === p.message.id)) return t;
          return { ...t, items: [...t.items, p.message] };
        });
      }
      void list.reload();
    },
    'message:status': (p: { conversationId: string; id: string; status: string; errorMessage?: string | null }) => {
      if (p.conversationId !== active) return;
      thread.setData((t) => (t ? {
        ...t,
        items: t.items.map((m) => (m.id === p.id
          ? { ...m, status: p.status, errorMessage: p.errorMessage ?? null }
          : m)),
      } : t));
    },
    'conversation:update': () => void list.reload(),
  });

  /* التمرير للأحدث — ولا يُقفز إن كان الموظّف يقرأ أعلى الحوار. */
  useEffect(() => {
    const el = bodyRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [msgs.length, atBottom]);

  function onBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  async function loadMoreConvs() {
    const cursor = list.data?.nextCursor;
    if (!cursor) return;
    try {
      const more = await api<ConvList>(
        `/conversations${qs ? `${qs}&` : '?'}cursor=${encodeURIComponent(cursor)}`,
      );
      setExtra((x) => [...x, ...more.items]);
      list.setData((d) => (d ? { ...d, nextCursor: more.nextCursor } : d));
    } catch { toast('تعذّر جلب المزيد'); }
  }

  async function loadOlderMsgs() {
    const first = msgs[0];
    if (!first || !active) return;
    try {
      const more = await api<Thread>(
        `/conversations/${active}/messages?before=${encodeURIComponent(first.createdAt)}`,
      );
      setOlder((o) => [...more.items, ...o]);
    } catch { toast('تعذّر جلب الأقدم'); }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !active || sending) return;
    if (text.length > maxLen) {
      toast(`أطول من حدّ القناة (${maxLen} محرفاً) — والخادم يقصّ الزائد بصمت.`);
      return;
    }
    setSending(true);
    try {
      await post(`/conversations/${active}/messages`, { text }, { 'idempotency-key': idempotencyKey() });
      setDraft('');
      setAtBottom(true);
      toast('ردّك أوقف البوت تلقائيّاً — بلا أن تضغط شيئاً');
      await thread.reload();
      await list.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر الإرسال');
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter يُرسل، وShift+Enter سطرٌ جديد — فلا يُفقد ردٌّ من فقرتين
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  async function setBot(pauseMinutes?: number) {
    if (!active) return;
    setPauseOpen(false);
    await post(`/conversations/${active}/bot`, pauseMinutes != null ? { pauseMinutes } : { enabled: true });
    await list.reload();
    toast(pauseMinutes != null ? 'تولّيتَ المحادثة — البوت توقّف' : 'أُعيد البوت للعمل');
  }

  /** المحادثة التالية المحتاجة تدخّلاً — انتقالٌ بلا عودةٍ إلى القائمة. */
  const nextWaiting = items.find((c) => c.id !== active && c.needsAttention) ?? null;
  const channelDown = Boolean(caps && caps.status === 'error');

  return (
    <div className="ibx" data-pane={active ? 'thread' : 'list'}>
      {toastNode}

      {/* ══════ لوح القائمة ══════ */}
      <section className="ibx-list" aria-label="المحادثات">
        <header className="ibx-lhead">
          <input
            className="ibx-search" type="search" value={search} dir="auto"
            placeholder="ابحث باسمٍ أو رقمٍ أو نصّ رسالة…"
            aria-label="بحث في المحادثات"
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="ibx-chips" role="group" aria-label="مرشّحات">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="chipf"
                aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </header>

        <div className="ibx-body">
          {list.loading && <div className="ibx-pad"><Skeleton rows={5} height={52} /></div>}
          {list.error && <div className="ibx-pad"><ErrorBox message={list.error} onRetry={list.reload} /></div>}

          {!list.loading && !list.error && !items.length && (
            <div className="ibx-pad">
              <Empty
                title={query ? 'لا نتيجة' : 'لا محادثات'}
                hint={query
                  ? `لا محادثة تطابق «${query}». البحث يشمل الاسم والرقم ونصّ آخر رسالة.`
                  : filter
                    ? 'لا محادثة تطابق هذا المرشّح. بدّله لترى غيرها.'
                    : 'ستظهر هنا أوّل ما يراسلك زبون — خلال ثانيتين من وصول رسالته.'}
              />
            </div>
          )}

          {items.map((c) => {
            const name = c.contactName ?? c.displayHandle ?? c.handle;
            return (
              <button
                key={c.id} type="button" className="ibx-row" aria-current={c.id === active}
                data-state={c.needsAttention ? 'attn' : c.unreadCount ? 'unread' : 'calm'}
                onClick={() => open(c.id)}
              >
                <span className="ibx-edge" aria-hidden="true" />
                <span className={`ibx-av ${CH[c.channelKind]?.tone ?? 'neutral'}`} aria-hidden="true">
                  {initial(name)}
                  {c.unreadCount > 0 && <i className="ibx-badge">{c.unreadCount}</i>}
                </span>
                <span className="ibx-main">
                  <span className="ibx-name" dir="auto">{name}</span>
                  <span className="ibx-prev" dir="auto">{c.lastMessagePreview ?? '—'}</span>
                </span>
                <span className="ibx-meta">
                  <span className="ibx-time">{fmt.when(c.lastMessageAt)}</span>
                  {c.needsAttention && <span className="ibx-attn">يحتاج تدخّلاً</span>}
                </span>
              </button>
            );
          })}

          {list.data?.nextCursor && (
            <div className="ibx-pad">
              <Button onClick={() => void loadMoreConvs()}>حمّل محادثاتٍ أقدم</Button>
            </div>
          )}
        </div>
      </section>

      {/* ══════ لوح الحوار ══════ */}
      <section className="ibx-thread" aria-label="الحوار">
        {!conv ? (
          <div className="ibx-pad">
            <Empty title="اختر محادثة" hint="اختر من القائمة لترى الحوار كما رآه الزبون." />
          </div>
        ) : (
          <>
            <header className="ibx-thead">
              <button type="button" className="ibx-back" onClick={() => open(null)} aria-label="رجوع للقائمة">
                ⟩
              </button>
              <span className="ibx-tname" dir="auto">
                {conv.contactName ?? conv.displayHandle ?? conv.handle}
              </span>
              <span className="mono ibx-thandle">{conv.handle}</span>
              <Pill tone={CH[conv.channelKind]?.tone ?? 'neutral'} mark={false}
                label={CH[conv.channelKind]?.label ?? conv.channelKind} />
              <span className="ibx-grow" />
              <Pill tone={win?.open ? 'ok' : 'warn'}
                label={win?.open ? `تبقّى ${remaining ?? '—'}` : 'النافذة مغلقة'} />
            </header>

            {channelDown && (
              <div className="ibx-pad">
                <Note tone="crit">
                  <b>قناة {CH[conv.channelKind]?.label} معطّلة الآن.</b>{' '}
                  {caps?.lastError ?? 'راجع صفحة القنوات.'} وأيّ ردٍّ ترسله قد لا يصل.
                </Note>
              </div>
            )}

            <div className="ibx-body" ref={bodyRef} onScroll={onBodyScroll}>
              {thread.loading && <div className="ibx-pad"><Skeleton rows={4} height={40} /></div>}
              {thread.error && (
                <div className="ibx-pad"><ErrorBox message={thread.error} onRetry={thread.reload} /></div>
              )}

              {!thread.loading && !thread.error && msgs.length >= 50 && (
                <div className="ibx-pad">
                  <Button size="sm" onClick={() => void loadOlderMsgs()}>رسائل أقدم</Button>
                </div>
              )}

              {msgs.map((m, i) => {
                const prev = msgs[i - 1];
                const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                const press = m.direction === 'in' ? m.payload?.buttonPayload : null;
                const media = !m.body && MEDIA[m.type] ? MEDIA[m.type] : null;
                const src = m.direction === 'in' ? null : SOURCE[m.source] ?? SOURCE.bot!;
                const cls = m.direction === 'in' ? 'in' : m.source === 'agent' ? 'agent' : 'bot';

                return (
                  <div key={m.id || `${i}-${m.createdAt}`} className="ibx-msg">
                    {newDay && <div className="ibx-day"><span>{dayLabel(m.createdAt)}</span></div>}

                    {m.source === 'system' ? (
                      <div className="bub sys" dir="auto">{m.body}</div>
                    ) : press ? (
                      <div className="bub press" dir="auto">
                        <span className="press-v">{pressLabel(press).verb}</span>
                        <span className="press-a mono">{pressLabel(press).action}</span>
                        <span className="mt">{fmt.clock(m.createdAt)} · ضغطة زرّ</span>
                      </div>
                    ) : (
                      <div className={`bub ${cls}`} dir="auto">
                        {src && (
                          <span className="src"><span aria-hidden="true">{src.mark}</span> {src.label}</span>
                        )}
                        {media ? <span className="ibx-media">📎 {media}</span> : m.body}
                        {!!m.payload?.options?.length && (
                          <span className="chips">
                            {m.payload.options.map((o) => <span className="c" key={o.id}>{o.title}</span>)}
                            <span className="chips-n">أُرسلت كأزرار — والزبون يضغط ولا يكتب</span>
                          </span>
                        )}
                        <span className="mt">
                          {fmt.clock(m.createdAt)}
                          {m.direction === 'out' && m.status ? ` · ${DELIVERY[m.status] ?? m.status}` : ''}
                        </span>
                        {/* سببُ الفشل كان مجلوباً ولا يُعرض: «فشلت» بلا سبب */}
                        {m.status === 'failed' && m.errorMessage && (
                          <span className="ibx-err">{m.errorMessage}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ══════ الرصيف: كلّ فعلٍ متكرّر هنا ══════ */}
            <div className="ibx-dock">
              <div className="ibx-take">
                <Dot tone={paused ? 'warn' : conv.botEnabled ? 'ok' : 'neutral'} />
                <strong>{paused ? 'تولّيتَ المحادثة' : conv.botEnabled ? 'البوت يردّ' : 'البوت متوقّف'}</strong>
                <span className="muted-p">
                  {paused
                    ? `يعود ${fmt.when(conv.botPausedUntil)}`
                    : conv.botEnabled ? 'ويتوقّف لحظة ما تردّ' : ''}
                </span>
                <span className="ibx-grow" />
                {paused ? (
                  <Button size="sm" disabled={can.readOnly} reason="حسابك للقراءة فقط"
                    onClick={() => void setBot()}>أعِد البوت</Button>
                ) : (
                  <span className="ibx-pause">
                    <Button size="sm" disabled={can.readOnly} reason="حسابك للقراءة فقط"
                      onClick={() => setPauseOpen((v) => !v)}>تولّيتُ المحادثة ▾</Button>
                    {pauseOpen && (
                      <span className="ibx-menu" role="menu">
                        {PAUSES.map((p) => (
                          <button key={p.m} type="button" role="menuitem" onClick={() => void setBot(p.m)}>
                            {p.label}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </div>

              {win?.open === false ? (
                <div className="locked">
                  <strong>
                    لا يمكن الإرسال — نافذة الـ{caps?.capabilities.windowHours ?? 24} ساعة مغلقة.
                  </strong>{' '}
                  تُفتح من جديد حين يُرسل الزبون رسالة. عطّلنا حقل الكتابة <strong>قبل</strong> أن
                  تكتب، فلا تُرفض رسالةٌ بعد كتابتها.
                </div>
              ) : (
                <form className="ibx-comp" onSubmit={send}>
                  <textarea
                    id="ibx-draft" className="ibx-ta" value={draft} dir="auto" rows={2}
                    placeholder="اكتب ردّك… (Enter يُرسل · Shift+Enter سطرٌ جديد)"
                    aria-label="نصّ الردّ" disabled={sending || can.readOnly}
                    onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
                  />
                  <div className="ibx-send">
                    {draft.length > maxLen * 0.8 && (
                      <span className={`num ibx-count${draft.length > maxLen ? ' over' : ''}`}>
                        {draft.length} / {maxLen}
                      </span>
                    )}
                    <Button type="submit" variant="primary" size="sm" busy={sending}
                      disabled={!draft.trim() || can.readOnly} reason="حسابك للقراءة فقط">
                      إرسال
                    </Button>
                  </div>
                </form>
              )}

              {nextWaiting && (
                <button type="button" className="ibx-next" onClick={() => open(nextWaiting.id)}>
                  ⟩ التالي المنتظر: {nextWaiting.contactName ?? nextWaiting.handle}
                  {' · '}{fmt.when(nextWaiting.lastMessageAt)}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <InboxScreen />
    </Suspense>
  );
}
