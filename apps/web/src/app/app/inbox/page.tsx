'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, idempotencyKey, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { useSocket } from '@/lib/socket';
import {
  Row, Stack, Pill, Dot, Note, Button, Skeleton, Empty, ErrorBox, KV, KVRow,
} from '@/components/ui';

/**
 * الإنبوكس — الشاشة التي يقضي فيها العميل وقته.
 *
 * ثلاثة قراراتٍ أُعيد التصميم من أجلها:
 *
 * ★ ① **الهاتف أوّلاً.** صاحب المطعم يردّ من هاتفه وسط الخدمة. ثلاثة أعمدةٍ
 *     مضغوطةٍ على شاشةٍ بعرض 360px ليست إنبوكساً بل ألغاز. فعلى الهاتف لوحٌ
 *     واحدٌ يُبدَّل (قائمة ⟷ محادثة ⟷ بطاقة)، وثلاثة أعمدةٍ على الحاسوب وحده.
 *
 * ★ ② **ضغطة الزبون تظهر كضغطة.** كان الضغط يُعرض نصّاً — «أكّد» — فيقرأ
 *     الموظّف حواراً لا يفهمه. وهذا بالضبط ما أخفى عن الفريق يوماً كاملاً أنّ
 *     نمط زرّ التأكيد نصفُ نمط: الأزرار تُرسَل والضغط يصل ولا ينفّذ شيئاً، ثمّ
 *     يقول البوت «تم تسجيل طلبك» وهو لم يُسجَّل. لو كان الضغط ظاهراً كضغطةٍ
 *     على إجراءٍ باسمه لانكشف العطل من أوّل نظرة.
 *
 * ★ ③ **المصادر الأربعة تُفصَل بالشكل لا باللون وحده.** زبون · بوت · موظّف ·
 *     نظام — ولكلٍّ موضعٌ وعلامةٌ ونصّ. اللون وحده لا يصل إلى ٨٪ من الرجال.
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
  } | null;
  status: string | null;
  createdAt: string;
}

interface Thread {
  items: Msg[];
  window: { expiresAt: string | null; open: boolean; billedAt: string | null };
}

const CH: Record<string, { label: string; tone: 'brand' | 'violet' }> = {
  whatsapp_cloud: { label: 'واتساب', tone: 'brand' },
  instagram: { label: 'إنستجرام', tone: 'violet' },
};

const FILTERS = [
  { id: '', label: 'الكلّ' },
  { id: 'attn', label: 'يحتاج تدخّلاً' },
  { id: 'unread', label: 'غير مقروء' },
  { id: 'whatsapp_cloud', label: 'واتساب' },
  { id: 'instagram', label: 'إنستجرام' },
] as const;

const STATUS: Record<string, string> = {
  queued: 'في الطابور', sent: '✓', delivered: '✓✓', read: '✓✓ قُرئت', failed: 'فشلت',
};

const SOURCE: Record<string, { label: string; mark: string }> = {
  bot: { label: 'بوت', mark: '⬡' },
  agent: { label: 'موظّف', mark: '◆' },
  template: { label: 'قالب', mark: '▤' },
};

/** ما يُعرَض للموظّف عن ضغطةِ زرٍّ — لا «أكّد» عارية. */
function pressLabel(payload: string): { verb: string; action: string } {
  const [kind, ...rest] = payload.split(':');
  const action = rest.join(':') || '—';
  if (kind === 'confirm') return { verb: 'أكّد', action };
  if (kind === 'cancel') return { verb: 'ألغى', action };
  return { verb: 'اختار', action: payload };
}

type Pane = 'list' | 'thread' | 'card';

export default function InboxPage() {
  const can = useCan();
  const { toast, node: toastNode } = useToast();
  const [filter, setFilter] = useState<string>('');
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** اللوح الظاهر على الهاتف. على الحاسوب لا أثر له — الثلاثة معروضة. */
  const [pane, setPane] = useState<Pane>('list');

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
  const paused = Boolean(conv?.botPausedUntil && new Date(conv.botPausedUntil) > new Date());

  function openConv(id: string) {
    setActive(id);
    setPane('thread');
    void post(`/conversations/${id}/read`).catch(() => undefined);
  }

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

      {/* مبدِّل اللوح — يظهر على الهاتف وحده */}
      <div className="pane-switch" role="tablist" aria-label="أقسام الإنبوكس">
        {([['list', 'المحادثات'], ['thread', 'الحوار'], ['card', 'الزبون']] as const).map(([id, label]) => (
          <button
            key={id} type="button" role="tab" className="tab"
            aria-selected={pane === id} onClick={() => setPane(id)}
            disabled={id !== 'list' && !conv}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`inbox p-${pane}`}>
        {/* ── القائمة ── */}
        <div className="ibcol c-list">
          <div className="ibhead">
            <Row gap="xs">
              {FILTERS.map((f) => (
                <button
                  key={f.id} type="button" className="chipf"
                  aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </Row>
          </div>

          <div className="convs">
            {list.loading && <div className="convs-load"><Skeleton rows={4} height={34} /></div>}

            {!list.loading && !list.data?.items.length && (
              <Empty
                title="لا محادثات"
                hint={filter
                  ? 'لا محادثة تطابق هذا المرشّح. بدّله لترى غيرها.'
                  : 'ستظهر هنا أوّل ما يراسلك زبون — خلال ثانيتين من وصول رسالته.'}
              />
            )}

            {list.data?.items.map((c) => (
              <button key={c.id} type="button" className="conv" aria-current={c.id === active}
                onClick={() => openConv(c.id)}>
                <span className="r1">
                  <Pill tone={CH[c.channelKind]?.tone ?? 'neutral'} mark={false}
                    label={CH[c.channelKind]?.label ?? c.channelKind} />
                  <span className="nm" dir="auto">{c.contactName ?? c.displayHandle ?? c.handle}</span>
                  <span className="tm">{fmt.when(c.lastMessageAt)}</span>
                </span>
                <span className="pv" dir="auto">{c.lastMessagePreview ?? '—'}</span>
                <span className="r3">
                  {c.needsAttention && <Pill tone="crit" label="يحتاج تدخّلاً" />}
                  {c.unreadCount > 0 && <Pill tone="brand" label={`${c.unreadCount} جديد`} />}
                  {c.tags.map((t) => <Pill key={t} tone="neutral" label={t} mark={false} />)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── الحوار ── */}
        <div className="ibcol c-thread">
          {!conv ? (
            <Empty title="اختر محادثة" hint="اختر من القائمة لترى الحوار كما رآه الزبون." />
          ) : (
            <>
              <div className="ibhead">
                <Row gap="sm">
                  <strong dir="auto">{conv.contactName ?? conv.displayHandle ?? conv.handle}</strong>
                  <span className="mono handle">{conv.handle}</span>
                  <Pill tone={CH[conv.channelKind]?.tone ?? 'neutral'} mark={false}
                    label={CH[conv.channelKind]?.label ?? conv.channelKind} />
                  <span className="grow" />
                  {/* ★ المؤقّت ظاهرٌ دائماً — لا يُترك الموظّف يكتب ثمّ تُرفض رسالته */}
                  <Pill tone={win?.open ? 'ok' : 'warn'}
                    label={win?.open ? `تبقّى ${remaining ?? '—'}` : 'النافذة مغلقة'} />
                </Row>
              </div>

              <div className="thread" ref={threadRef}>
                {thread.loading && <Skeleton rows={3} height={44} />}

                {thread.data?.items.map((m) => {
                  if (m.source === 'system') return <div className="bub sys" key={m.id} dir="auto">{m.body}</div>;

                  /* ★ ضغطةُ زرٍّ تُعرض كضغطةٍ على إجراءٍ باسمه، لا كنصٍّ عارٍ. */
                  const press = m.direction === 'in' ? m.payload?.buttonPayload : null;
                  if (press) {
                    const { verb, action } = pressLabel(press);
                    return (
                      <div className="bub press" key={m.id} dir="auto">
                        <span className="press-v">{verb}</span>
                        <span className="press-a mono">{action}</span>
                        <span className="mt">{fmt.clock(m.createdAt)} · ضغطة زرّ</span>
                      </div>
                    );
                  }

                  const src = m.direction === 'in' ? null : SOURCE[m.source] ?? SOURCE.bot!;
                  const cls = m.direction === 'in' ? 'in' : m.source === 'agent' ? 'agent' : 'bot';
                  /* ★ `dir="auto"` على كلّ نصٍّ لم نكتبه نحن.
                     كان `{m.body}` خامّاً داخل حاضنٍ مفروضٍ RTL — ورسائل زبائن
                     المطاعم والعيادات مختلطةٌ بطبيعتها: «iPhone 15 بكم؟»، رابط،
                     رمز صنف، «OK تمام». ورسالةٌ تبدأ بلاتينيّ تأخذ اتجاه الحاضن
                     لا اتجاهها، فتقفز نقطتها وأقواسها إلى الحافّة الخطأ.
                     أداةٌ وظيفتها **قراءة رسائل الزبون** كانت تعرضها بترتيبٍ خاطئ. */
                  return (
                    <div className={`bub ${cls}`} key={m.id} dir="auto">
                      {src && (
                        <span className="src">
                          <span aria-hidden="true">{src.mark}</span> {src.label}
                        </span>
                      )}
                      {m.body}
                      {!!m.payload?.options?.length && (
                        <span className="chips">
                          {m.payload.options.map((o) => (
                            <span className="c" key={o.id}>{o.title}</span>
                          ))}
                          <span className="chips-n">أُرسلت كأزرار — والزبون يضغط ولا يكتب</span>
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

              {/* ★ حالتان لا لبس بينهما: الغموض هنا = موظّفٌ وبوتٌ يتحدّثان معاً */}
              <div className="takeover">
                <Dot tone={paused ? 'warn' : conv.botEnabled ? 'ok' : 'neutral'} />
                <strong>{paused ? 'تولّيتَ المحادثة' : conv.botEnabled ? 'البوت يردّ' : 'البوت متوقّف'}</strong>
                <span className="muted-p">
                  {paused
                    ? `يعود ${fmt.when(conv.botPausedUntil)}`
                    : conv.botEnabled ? 'وسيتوقّف تلقائيّاً لحظة ما تردّ' : ''}
                </span>
                <span className="grow" />
                <Button size="sm" disabled={can.readOnly} reason="حسابك للقراءة فقط"
                  onClick={() => void toggleBot(paused ? undefined : 30)}>
                  {paused ? 'أعِد البوت الآن' : 'تولّيتُ المحادثة'}
                </Button>
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
                    id="inbox-draft" value={draft} onChange={(e) => setDraft(e.target.value)}
                    placeholder="اكتب ردّك…" disabled={sending || can.readOnly} aria-label="نصّ الردّ"
                  />
                  <Button type="submit" variant="primary" size="sm" busy={sending}
                    disabled={!draft.trim() || can.readOnly} reason="حسابك للقراءة فقط">
                    إرسال
                  </Button>
                </form>
              )}
            </>
          )}
        </div>

        {/* ── بطاقة الزبون ── */}
        <div className="ibcol c-card">
          <div className="pane">
            {conv ? (
              <Stack gap="md">
                <div>
                  <div className="ph">بطاقة الزبون</div>
                  <strong dir="auto">{conv.contactName ?? '—'}</strong>
                  <div className="mono handle">{conv.handle}</div>
                </div>

                <div>
                  <div className="ph">هويّاته عبر القنوات</div>
                  <Row gap="xs">
                    <Pill tone={CH[conv.channelKind]?.tone ?? 'neutral'} mark={false}
                      label={CH[conv.channelKind]?.label ?? conv.channelKind} />
                    <span className="mono handle">{conv.handle}</span>
                  </Row>
                </div>

                <div>
                  <div className="ph">الوسوم</div>
                  <Row gap="xs">
                    {conv.tags.length
                      ? conv.tags.map((t) => <Pill key={t} tone="neutral" label={t} mark={false} />)
                      : <span className="muted-p">لا وسوم</span>}
                  </Row>
                </div>

                <KV>
                  <KVRow k="النافذة">
                    {win?.open ? `مفتوحة — تبقّى ${remaining ?? '—'}` : 'مغلقة'}
                  </KVRow>
                  <KVRow k="فُوتِرت">
                    {win?.billedAt ? fmt.when(win.billedAt) : 'لا — لم يردّ أحدٌ بعد'}
                  </KVRow>
                </KV>

                {!can.settings && (
                  <Note>
                    <b>مقفلٌ عليك:</b> إعدادات البوت · المعرفة · الفوترة · حذف جهة الاتّصال.
                    اطلبها من مالك الحساب.
                  </Note>
                )}
              </Stack>
            ) : (
              <p className="muted-p">اختر محادثةً لترى بطاقة زبونها.</p>
            )}
          </div>
        </div>
      </div>

      {toastNode}
    </>
  );
}
