'use client';

import {
  Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi, useToast, fmt, AR_LOCALE } from '@/lib/useApi';
import { api, post, idempotencyKey, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { useSocket } from '@/lib/socket';
import {
  Button, Dock, Empty, ErrorBox, Meter, Note, Sheet, Skeleton, Tag,
} from '@/components/ui';
import { ChipRow } from '@/components/screen';

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
 *
 * ══════ ما تبنّته هذه المرحلة من بنى d4 ══════
 *
 * ① **التجميع بالإلحاح قبل الزمن.** القائمة كانت صفّاً زمنيّاً واحداً، فمحادثةٌ
 *    تنتظر ردّاً منذ ساعتين تنزل تحت دردشةٍ ردَّ عليها البوت قبل دقيقة — أي
 *    أنّ **الترتيب كان يعاكس الإلحاح**. صارت ثلاث مجموعاتٍ ثابتةِ الترتيب
 *    برؤوسٍ لاصقةٍ تحمل أعدادها، و**داخل «يحتاجك الآن» الأقدمُ أوّلاً**: أطولُ
 *    انتظارٍ أعلى الشاشة لا أسفلها.
 *
 * ② **مقياس انتظار** في صفّ الإلحاح: الرقم وحده لا يقول «كم بقي من صبر
 *    الزبون»، والشريط يقيسه على ثلاث ساعات — وما جاوزها يُرسم مشطوباً حرجاً.
 *
 * ③ **رصيفٌ واحدٌ يجمع أفعال الحوار** (التولّي · التالي المنتظر · التحويل)
 *    مع المُنشئ — في مدى الإبهام. وحالةُ البوت انتقلت إلى **رأس** الحوار:
 *    الرأس يقول، والرصيف يفعل.
 *
 * ④ **ورقةٌ صاعدة لمدّة التولّي** بدل قائمةٍ منسدلةٍ بأهدافٍ صغيرة. وشرطُ
 *    هيئتها في CSS هو `pointer: coarse` لا العرض — فلوحٌ لمسيٌّ عريضٌ يستحقّ
 *    ورقةً تصعد.
 *
 * ⑤ **ثلاثيّ الصوت بلا لونِ علامة**: جهةٌ (بداية/نهاية) + سطحٌ (خطٌّ منقّطٌ
 *    للبوت · حبرٌ صلبٌ للموظّف · لوحٌ للزبون) + وسمٌ نصّيّ تحت الفقاعة. فلا
 *    فيروزيَّ ولا بنفسجيَّ يحمل معنىً وحده.
 *
 * ★ وثلاثة أعطالٍ وظيفيّةٍ أُصلحت وهي ليست تجميلاً:
 *   · **«أعِد البوت» لم يكن يُعيده**: الخادم على `{enabled: true}` لا يمسّ
 *     `botPausedUntil`، فيبقى التوقّفُ ساريَ المفعول والزرُّ يُطمئن كذباً.
 *   · **«يعود الآن»**: `fmt.when` يحسب ما **مضى**، وتاريخُ العودة في
 *     المستقبل، فكان كلّ توقّفٍ يُعلن عودةً فوريّة. والصحيح `fmt.remaining`.
 *   · **الصفوف المجلوبة بالتصفيح كانت لا تتحدّث**: `list.reload()` يجلب
 *     الصفحة الأولى وحدها، فمحادثةٌ من صفحةٍ ثانية تبقى بحالةٍ قديمة بعد
 *     كلّ فعل. صار التعديل يُطبَّق على المصفوفتين معاً.
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

/**
 * ★ القناة **نصٌّ لا لون**. كان الشِّعار الحرفيّ يحمل القناة بحلقةٍ فيروزيّةٍ
 *   أو بنفسجيّة — معنىً باللون وحده، لا يقرأه من لا يفرّق الأحمر من الأخضر
 *   (وهم ٨٪ من الرجال). واللونُ في هذا التصميم مِلكُ **الحالة** وحدها.
 */
const CH: Record<string, string> = {
  whatsapp_cloud: 'واتساب',
  instagram: 'إنستجرام',
};
const chLabel = (kind: string) => CH[kind] ?? kind;

const FILTERS = [
  { id: '', label: 'الكلّ' },
  { id: 'attn', label: 'يحتاج تدخّلاً' },
  { id: 'whatsapp_cloud', label: 'واتساب' },
  { id: 'instagram', label: 'إنستجرام' },
] as const;

const DELIVERY: Record<string, string> = {
  queued: 'قيد الإرسال…', sent: '✓', delivered: '✓✓', read: '✓✓ قُرئت', failed: 'لم تصل',
};

const SOURCE: Record<string, { label: string; mark: string }> = {
  bot: { label: 'بوت', mark: '⬡' },
  agent: { label: 'موظّف', mark: '◆' },
  template: { label: 'قالب', mark: '▤' },
};

/**
 * مدد الإسكات — الخادم يقبل أيّ عدد دقائق، والشاشة كانت تُثبّت ٣٠.
 * و`note` **عاقبةٌ لا حالة**: ما يحدث بعد الضغط، مكتوباً قبله.
 */
const PAUSES = [
  { m: 30, label: 'نصف ساعة', note: 'يكفي لسؤالٍ وجوابه — وهي نفس مدّة ردِّك المباشر' },
  { m: 180, label: 'ثلاث ساعات', note: 'لحالةٍ تحتاج مراجعةً مع زميلٍ أو مورّد' },
  { m: 1440, label: 'حتّى الغد', note: 'يبقى صامتاً يوماً كاملاً على هذه المحادثة وحدها' },
] as const;

/**
 * ★ مجموعات الإلحاح — **ثابتةُ الترتيب**. ولا لونَ عارياً: لكلّ مجموعةٍ
 *   علامةٌ شكليّةٌ مع نصّها، فالمعنى مقروءٌ بلا لون.
 */
const GROUPS = [
  { k: 'attn', title: 'يحتاجك الآن', mark: '■' },
  { k: 'wait', title: 'بانتظار ردّ الزبون', mark: '◇' },
  { k: 'calm', title: 'هادئة', mark: '○' },
] as const;
type Grp = typeof GROUPS[number]['k'];

/** سقفُ مقياس الانتظار: ثلاث ساعاتٍ — وما جاوزها يُرسم فوق السقف لا عنده. */
const WAIT_CAP_MIN = 180;

/** وسمُ التحويل — نصٌّ يراه كلّ من يفتح الإنبوكس، لا إخطارٌ يُرسَل. */
const HANDOFF_TAG = 'للزميل';

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

const stamp = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
const minsSince = (iso: string | null, now: number) =>
  Math.max(0, Math.round((now - stamp(iso)) / 60000));

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
  const [takeOpen, setTakeOpen] = useState(false);
  const [xferOpen, setXferOpen] = useState(false);

  /**
   * ★ عقربٌ واحدٌ للشاشة كلّها. المقاييسُ الزمنيّة (انتظارُ الصفّ · ما تبقّى
   *   من النافذة) كانت تُحسب لحظةَ الرسم ثمّ **تتجمّد**: موظّفٌ يفتح الإنبوكس
   *   ويبقى فيه ساعةً يقرأ «تبقّى ٥ س» بعد أن صارت أربعاً. والدقيقة كافية —
   *   وهي دورةُ رسمٍ واحدةٌ لا استعلامُ شبكة.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

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
  useEffect(() => {
    setOlder([]); setDraft(''); setAtBottom(true); setTakeOpen(false); setXferOpen(false);
  }, [active]);

  const items = useMemo(() => [...(list.data?.items ?? []), ...extra], [list.data, extra]);
  const conv = items.find((c) => c.id === active) ?? null;
  const msgs = useMemo(() => [...older, ...(thread.data?.items ?? [])], [older, thread.data]);

  const capsOf = useCallback(
    (kind: string) => chans.data?.items.find((c) => c.kind === kind),
    [chans.data],
  );
  const caps = conv ? capsOf(conv.channelKind) : undefined;
  const maxLen = caps?.capabilities.maxTextLen ?? 4096;
  const winHours = caps?.capabilities.windowHours ?? 24;
  const win = thread.data?.window;
  const remaining = win?.expiresAt ? fmt.remaining(win.expiresAt) : null;
  const paused = Boolean(conv?.botPausedUntil && new Date(conv.botPausedUntil).getTime() > now);
  const tagged = Boolean(conv?.tags?.includes(HANDOFF_TAG));

  /**
   * ★ التعديلُ يُطبَّق على **المصفوفتين**: صفحةُ الجلب الأولى (`list.data`)
   *   وما جاء بالتصفيح (`extra`). و`list.reload()` لا يلمس الثانية، فكانت
   *   محادثةٌ من صفحةٍ ثانية تُظهر حالةَ بوتٍ قديمةً بعد كلّ فعلٍ عليها.
   */
  const { setData: setList } = list;
  const patchConv = useCallback((id: string, patch: Partial<Conv>) => {
    setList((d) => (d ? { ...d, items: d.items.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d));
    setExtra((x) => x.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, [setList]);

  /**
   * ★ **الإلحاحُ قبل الزمن.** والمجموعاتُ ثابتةُ الترتيب فلا يتعلّم الموظّف
   *   موضعاً جديداً كلّ مرّة:
   *    · «يحتاجك الآن» = ما رفعه الخادم (`needsAttention`) — تحويلُ بوتٍ أو
   *      شكوى أو أداةٌ عجزت. و**الأقدمُ أوّلاً** داخلها: أطولُ انتظارٍ أعلاها.
   *    · «بانتظار ردّ الزبون» = لا تدخّلَ مطلوباً ونافذةُ الردّ الحرّ ما زالت
   *      مفتوحة (بساعات القناة نفسها لا برقمٍ مخمَّن) — الكرةُ في ملعبه.
   *    · «هادئة» = مضى على آخر رسالةٍ أكثرُ من مدّة النافذة، فلا فعلَ ممكناً
   *      إلّا بقالبٍ معتمد.
   */
  const grouped = useMemo(() => {
    const by: Record<Grp, Conv[]> = { attn: [], wait: [], calm: [] };
    for (const c of items) {
      const hrs = capsOf(c.channelKind)?.capabilities.windowHours ?? 24;
      const live = now - stamp(c.lastMessageAt) < hrs * 3600_000;
      by[c.needsAttention ? 'attn' : live ? 'wait' : 'calm'].push(c);
    }
    by.attn.sort((a, b) => stamp(a.lastMessageAt) - stamp(b.lastMessageAt));
    by.wait.sort((a, b) => stamp(b.lastMessageAt) - stamp(a.lastMessageAt));
    by.calm.sort((a, b) => stamp(b.lastMessageAt) - stamp(a.lastMessageAt));
    return by;
  }, [items, now, capsOf]);

  /**
   * ★ **الرقم البطوليّ للشاشة: عددُ ما ينتظر ردَّك.** يُختار بالحالة لا
   *   بالتفضيل — فهو الرقم الوحيد الذي يقرّر ما تفعله في الدقيقة القادمة.
   *   ولا رقمَ بلا سياقٍ ملاصق: نسبتُه من القائمة، وأطولُ انتظارٍ فيه.
   */
  const attnRows = grouped.attn;
  const oldestWait = attnRows.length ? minsSince(attnRows[0]!.lastMessageAt, now) : 0;

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

  /** إعادةُ إرسال رسالةٍ فشلت — على صفّها لا بنسخةٍ جديدة. */
  async function retrySend(messageId: string) {
    if (!active) return;
    try {
      await post(`/conversations/${active}/messages/${messageId}/retry`);
      thread.setData((t) => (t ? {
        ...t,
        items: t.items.map((m) => (m.id === messageId
          ? { ...m, status: 'queued', errorMessage: null }
          : m)),
      } : t));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّرت إعادة المحاولة');
    }
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
      /* ★ «وصل» كانت تُقال على 202 — أي على **قبولٍ في الطابور** لا على
         وصول. والرسالة الآن تظهر في الحوار بحالتها الحقيقيّة، فالتوستة
         تقول ما جرى فعلاً وتُحيل إلى الفقاعة. */
      toast('أُرسل ردّك — تتبّع حالته في الحوار. وتوقّف البوت عن هذه المحادثة وحدها.');
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

  /** تولّي المحادثة: مدّةٌ محدّدة، أو إطفاءٌ لا يعود إلّا بيد الموظّف. */
  async function takeOver(pauseMinutes: number | null, said: string) {
    if (!active) return;
    setTakeOpen(false);
    try {
      await post(
        `/conversations/${active}/bot`,
        pauseMinutes != null ? { pauseMinutes } : { enabled: false },
      );
      patchConv(active, pauseMinutes != null
        ? {
          botPausedUntil: new Date(Date.now() + pauseMinutes * 60_000).toISOString(),
          needsAttention: false,
        }
        : { botEnabled: false });
      await list.reload();
      toast(`تولّيتَ المحادثة — ${said}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر إيقاف البوت');
    }
  }

  async function resumeBot() {
    if (!active) return;
    /**
     * ★ `{enabled: true}` **وحدها لا تُعيد البوت**: الخادم لا يمسّ
     *   `botPausedUntil` إلّا مع `pauseMinutes`، فيبقى التوقّفُ ساريَ المفعول
     *   والشاشةُ تُطمئن كذباً. ودقيقةٌ إلى الوراء تُنهي التوقّف يقيناً ولو
     *   تباعدت ساعةُ الخادم عن ساعة الجهاز بثوانٍ.
     */
    try {
      await post(`/conversations/${active}/bot`, { enabled: true, pauseMinutes: -1 });
      patchConv(active, { botEnabled: true, botPausedUntil: null });
      await list.reload();
      toast('عاد بوتك يردّ على هذه المحادثة');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر إعادة البوت');
    }
  }

  /**
   * ★ التحويل بما يملكه النظام فعلاً: **وسمٌ يُقرأ**، لا تعيينٌ لا وجود له.
   *   حقلُ `tags` كان مجلوباً في الواجهة ولا يُعرض ولا يُكتب — ومسارُه في
   *   الخادم بلا مستدعٍ. فصار الوسمُ أثرَ التحويل، والورقةُ تقول بصراحةٍ ما
   *   لا يحدث: لا إخطارَ يُرسَل لأحد.
   */
  async function handoff(on: boolean) {
    if (!active || !conv) return;
    setXferOpen(false);
    const next = on
      ? [...conv.tags.filter((t) => t !== HANDOFF_TAG), HANDOFF_TAG]
      : conv.tags.filter((t) => t !== HANDOFF_TAG);
    try {
      await post(`/conversations/${active}/tags`, on ? { add: [HANDOFF_TAG] } : { remove: [HANDOFF_TAG] });
      patchConv(active, { tags: next });
      toast(on
        ? `وُسمت «${HANDOFF_TAG}» — يراها كلّ من يفتح الإنبوكس، ولا إخطارَ يُرسَل`
        : `أُزيل وسم «${HANDOFF_TAG}»`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر تعديل الوسوم');
    }
  }

  /** المحادثات المحتاجة تدخّلاً غير المفتوحة — انتقالٌ بلا عودةٍ إلى القائمة. */
  const waitingNext = attnRows.filter((c) => c.id !== active);
  const nextWaiting = waitingNext[0] ?? null;
  const channelDown = Boolean(caps && caps.status === 'error');

  const winLeftMs = win?.expiresAt ? new Date(win.expiresAt).getTime() - now : 0;
  const winPct = Math.min(1, Math.max(0, winLeftMs / (winHours * 3600_000)));

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

          {/* ★ رأسٌ لاصقٌ لكلّ مجموعة يحمل عددَه: قائمةٌ طويلةٌ تفقد رأسَها بعد
              ثلاثة صفوفٍ فيُقرأ «هادئ» على أنّه «يحتاجك». والعددُ قبل النزول
              يقول إن كان النزولُ يستحقّ. */}
          {GROUPS.map((g) => {
            const rows = grouped[g.k];
            if (!rows.length) return null;
            return (
              <div className="ugrp" key={g.k}>
                <div className={`grp${g.k === 'attn' ? ' attn' : ''}`}>
                  <span aria-hidden="true" className="ibx-gm">{g.mark}</span>
                  <span>{g.title}</span>
                  <span className="grp-c"><span className="num">{rows.length}</span></span>
                </div>

                {rows.map((c) => {
                  const name = c.contactName ?? c.displayHandle ?? c.handle;
                  const waited = minsSince(c.lastMessageAt, now);
                  const rowPaused = Boolean(
                    c.botPausedUntil && new Date(c.botPausedUntil).getTime() > now,
                  );
                  const tagList = c.tags ?? [];
                  const sub = g.k === 'attn' || rowPaused || !c.botEnabled || tagList.length > 0;
                  return (
                    <button
                      key={c.id} type="button" className="ibx-row" aria-current={c.id === active}
                      data-state={g.k}
                      onClick={() => open(c.id)}
                    >
                      <span className="ibx-mark" aria-hidden="true">{g.mark}</span>

                      <span className="ibx-nm">
                        <span className="ibx-name" dir="auto">{name}</span>
                        <span className="ibx-ch">{chLabel(c.channelKind)}</span>
                      </span>

                      <span className="ibx-meta">
                        {c.unreadCount > 0 && (
                          <i className="ibx-badge">
                            <span className="num">{c.unreadCount}</span>
                          </i>
                        )}
                        <span className="ibx-time">{fmt.when(c.lastMessageAt)}</span>
                      </span>

                      <span className="ibx-prev" dir="auto">{c.lastMessagePreview ?? '—'}</span>

                      {sub && (
                        <span className="ibx-sub">
                          {/* ★ مقياسُ الانتظار: الرقمُ وحده لا يقول «كم بقي من صبره».
                              والمقياسُ محجوبٌ عن القارئ الصوتيّ لأنّ نسبتَه من ثلاث
                              ساعاتٍ لا معنى لها منطوقةً — والنصُّ بجانبه يقول الحقيقة. */}
                          {g.k === 'attn' && (
                            <span className="ibx-wait">
                              <span className="ibx-wbar" aria-hidden="true">
                                <Meter pct={waited / WAIT_CAP_MIN} />
                              </span>
                              <span className="ibx-wtxt">
                                انتظارٌ <span className="num">{waited}</span> د
                              </span>
                            </span>
                          )}
                          {rowPaused && <span className="ibx-tg">تولّيتَها</span>}
                          {!c.botEnabled && !rowPaused && <span className="ibx-tg">البوت مطفأ</span>}
                          {tagList.map((t) => (
                            <span className="ibx-tg" key={t}>{t}</span>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {list.data?.nextCursor && (
            <div className="ibx-pad">
              <Button onClick={() => void loadMoreConvs()}>حمّل محادثاتٍ أقدم</Button>
            </div>
          )}
        </div>

        {/* ══════ رصيف القائمة: الرقمُ البطوليّ ثمّ المرشّحات — في مدى الإبهام ══════ */}
        <Dock hint="المجموعات ثابتةُ الترتيب بالإلحاح لا بالوقت، و«يحتاجك الآن» أقدمُها أوّلاً.">
          <div className="ibx-hero" data-state={attnRows.length ? 'attn' : 'calm'}>
            <span className="ibx-hm" aria-hidden="true">{attnRows.length ? '■' : '●'}</span>
            <span className="ibx-hv"><span className="num">{attnRows.length}</span></span>
            <span className="ibx-hk">
              بانتظار ردِّك الآن
              <span className="ibx-hn">
                {attnRows.length
                  ? <>من أصلِ <span className="num">{items.length}</span> في القائمة · أطولُ انتظارٍ <span className="num">{oldestWait}</span> د</>
                  : items.length
                    ? <>وكلُّ ما في القائمة بوتُك يتولّاه — وأوّلُ ما يتعقّد يصعد إلى أعلى القائمة</>
                    : <>لا محادثةَ في القائمة بعد — وأوّلُ رسالةٍ تصل تفتح صفَّها هنا</>}
              </span>
            </span>
          </div>

          {/* المرشّحات صفٌّ واحدٌ يُمرَّر — والالتفاف يغيّر ارتفاع الرصيف فتقفز القائمة */}
          <ChipRow label="مرشّحات">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="chipf"
                aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </ChipRow>
        </Dock>
      </section>

      {/* ══════ لوح الحوار ══════ */}
      <section className="ibx-thread" aria-label="الحوار">
        {!conv ? (
          <div className="ibx-pad">
            <Empty title="اختر محادثة" hint="اختر من القائمة لترى الحوار كما رآه الزبون." />
          </div>
        ) : (
          <>
            {/* ★ الرأسُ يقول والرصيفُ يفعل: حالةُ البوت والنافذةِ وسومٌ هنا،
                وكلُّ فعلٍ في الرصيف أسفل الشاشة. */}
            <header className="ibx-thead">
              <button type="button" className="ibx-back" onClick={() => open(null)} aria-label="رجوع للقائمة">
                ⟩
              </button>
              <div className="ibx-tr1">
                <span className="ibx-tname" dir="auto">
                  {conv.contactName ?? conv.displayHandle ?? conv.handle}
                </span>
                <span className="mono ibx-thandle">{conv.handle}</span>
              </div>
              <div className="ibx-tr2">
                <Tag line mark={false} label={chLabel(conv.channelKind)} />
                {paused ? (
                  <Tag tone="serious" label={`تولّيتَها · يعود البوت بعد ${fmt.remaining(conv.botPausedUntil) ?? 'لحظات'}`} />
                ) : conv.botEnabled ? (
                  <Tag tone="ok" label="البوت يردّ — ويتوقّف لحظةَ ما تردّ" />
                ) : (
                  <Tag tone="neutral" label="البوت مطفأ — لا يردّ حتّى تُعيده" />
                )}
                {conv.tags?.map((t) => <Tag key={t} line mark={false} label={t} />)}
                {win?.open ? (
                  <span className="ibx-win">
                    <span className="ibx-wbar" aria-hidden="true">
                      <Meter pct={winPct} tone={winPct < 0.25 ? 'serious' : 'neutral'} />
                    </span>
                    تبقّى {remaining ?? 'أقلّ من دقيقة'} من نافذة الردّ الحرّ
                  </span>
                ) : (
                  <Tag tone="crit" label="النافذة مغلقة" />
                )}
              </div>
            </header>

            {channelDown && (
              <div className="ibx-pad">
                <Note tone="crit">
                  <b>قناة {chLabel(conv.channelKind)} معطّلة الآن.</b>{' '}
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
                const voice = m.source === 'system' ? 'sys'
                  : m.direction === 'in' ? 'in'
                    : m.source === 'agent' ? 'agent' : 'bot';

                return (
                  <Fragment key={m.id || `${i}-${m.createdAt}`}>
                    {newDay && <div className="ibx-day"><span>{dayLabel(m.createdAt)}</span></div>}

                    {/* ★ ثلاثةُ أصواتٍ بثلاث إشاراتٍ لا بلونٍ واحد: الجهةُ
                        (بدايةُ السطر للزبون · نهايتُه لك)، والسطحُ (لوحٌ ·
                        خطٌّ منقّطٌ للبوت · حبرٌ صلبٌ للموظّف)، والوسمُ النصّيُّ
                        تحت الفقاعة. والوسمُ **خارج** الفقاعة عمداً: حبرُ
                        الموظّف صلبٌ، وسببُ فشلٍ أحمرُ داخله لا يُقرأ. */}
                    {voice === 'sys' ? (
                      <div className="ibx-msg sys">
                        <div className="bub sys" dir="auto">{m.body}</div>
                        <div className="mt">{fmt.clock(m.createdAt)} · من النظام</div>
                      </div>
                    ) : (
                      <div className={`ibx-msg ${voice}`}>
                        {press ? (
                          <div className="bub press" dir="auto">
                            <span className="press-v">{pressLabel(press).verb}</span>
                            <span className="press-a mono">{pressLabel(press).action}</span>
                          </div>
                        ) : (
                          <div className={`bub ${voice}`} dir="auto">
                            {media ? <span className="ibx-media">📎 {media}</span> : m.body}
                            {!!m.payload?.options?.length && (
                              <span className="chips">
                                {m.payload.options.map((o) => <span className="c" key={o.id}>{o.title}</span>)}
                                <span className="chips-n">أُرسلت كأزرار — والزبون يضغط ولا يكتب</span>
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt">
                          {src && (
                            <span className="src"><span aria-hidden="true">{src.mark}</span> {src.label}</span>
                          )}
                          {press && <span className="src">ضغطة زرّ</span>}
                          <span>{fmt.clock(m.createdAt)}</span>
                          {m.direction === 'out' && m.status && (
                            <span className={m.status === 'failed' ? 'ibx-bad' : undefined}>
                              {DELIVERY[m.status] ?? m.status}
                            </span>
                          )}
                          {/* سببُ الفشل كان مجلوباً ولا يُعرض: «فشلت» بلا سبب */}
                          {m.status === 'failed' && m.errorMessage && (
                            <span className="ibx-err">{m.errorMessage}</span>
                          )}
                          {/* ★ «لم تصل» بلا مخرجٍ يدفع الموظّف إلى كتابتها من
                              جديد بمفتاحٍ جديد — فتصل نسختان إن كان العطل
                              عابراً. الإعادة على الصفّ نفسه تُنهي الاثنين. */}
                          {m.direction === 'out' && m.status === 'failed' && !can.readOnly && (
                            <button
                              type="button" className="ibx-retry"
                              onClick={() => void retrySend(m.id)}
                            >
                              أعِد المحاولة
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>

            {/* ══════ رصيف الحوار: التولّي · التالي المنتظر · التحويل · المُنشئ ══════ */}
            <Dock hint={win?.open === false
              ? undefined
              : 'ردُّك يُسكت البوت عن هذه المحادثة وحدها — وسائرُ زبائنك يبقون على خدمته.'}>
              <div className="ibx-acts">
                {paused || !conv.botEnabled ? (
                  <Button size="sm" disabled={can.readOnly} reason={can.readOnly ? 'حسابك للقراءة فقط' : undefined}
                    onClick={() => void resumeBot()}>أعِد البوت الآن</Button>
                ) : (
                  <Button size="sm" disabled={can.readOnly} reason={can.readOnly ? 'حسابك للقراءة فقط' : undefined}
                    onClick={() => setTakeOpen(true)}>تولَّ المحادثة…</Button>
                )}
                {nextWaiting && (
                  <Button size="sm" onClick={() => open(nextWaiting.id)}>
                    التالي المنتظر · <span className="num">{waitingNext.length}</span>
                  </Button>
                )}
                <Button size="sm" disabled={can.readOnly} reason={can.readOnly ? 'حسابك للقراءة فقط' : undefined}
                  onClick={() => setXferOpen(true)}>
                  {tagged ? 'وسمُ التحويل قائم…' : 'حوِّلها لزميل…'}
                </Button>
              </div>

              {win?.open === false ? (
                <div className="locked">
                  <strong>
                    لا يمكن الإرسال — نافذة الـ{winHours} ساعة مغلقة.
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
                      disabled={!draft.trim() || can.readOnly}
                      /* ★ السببُ مشروطٌ لا ثابت: كان يُكتب دائماً، فزرُّ الإرسال
                         المعطَّل **لأنّك لم تكتب بعد** يُعلن «حسابك للقراءة فقط» —
                         خبرٌ كاذبٌ يقرأه كلُّ موظّفٍ في كلّ محادثةٍ يفتحها. */
                      reason={can.readOnly ? 'حسابك للقراءة فقط' : undefined}>
                      إرسال
                    </Button>
                  </div>
                </form>
              )}
            </Dock>

            {/* ★ ورقةٌ صاعدة لا قائمةٌ منسدلة. وهيئتُها قرارُ CSS وحده:
                `pointer: coarse` يُبقيها ورقةً، والفأرةُ مع العرض تثبّتها
                حواراً — فاللوحُ اللمسيُّ العريضُ يأخذ ورقةً لا أهدافاً بعرض
                إصبعٍ في قائمةٍ صغيرة. */}
            <Sheet
              open={takeOpen} title="تولَّ المحادثة" onClose={() => setTakeOpen(false)}
              hint="يسكت بوتك عن هذه المحادثة وحدها — وسائرُ زبائنك يبقون على خدمته."
            >
              <div className="opts">
                {PAUSES.map((p) => (
                  <button key={p.m} type="button" className="opt"
                    onClick={() => void takeOver(p.m, `يعود البوت بعد ${p.label}`)}>
                    <span className="opt-t">
                      {p.label}
                      <span className="opt-n">{p.note}</span>
                    </span>
                  </button>
                ))}
                <button type="button" className="opt"
                  onClick={() => void takeOver(null, 'لن يعود حتّى تُعيده بيدك')}>
                  <span className="opt-t">
                    حتّى أُعيده بيدي
                    <span className="opt-n">لا يعود وحده — ويظهر ذلك في صفّها وفي رأس الحوار</span>
                  </span>
                </button>
              </div>
            </Sheet>

            <Sheet
              open={xferOpen} title="حوِّلها لزميل" onClose={() => setXferOpen(false)}
              hint="التعيينُ باسم موظّفٍ بعينه غيرُ مفعَّلٍ بعد، ولا إخطارَ يُرسَل — فالوسمُ هو ما يراه زميلُك حين يفتح الإنبوكس."
            >
              <div className="opts">
                {!tagged && (
                  <button type="button" className="opt" onClick={() => void handoff(true)}>
                    <span className="opt-t">
                      علِّمها «{HANDOFF_TAG}»
                      <span className="opt-n">وسمٌ يظهر في صفّها وفي رأس الحوار، ويبقى حتّى يُزال</span>
                    </span>
                  </button>
                )}
                {tagged && (
                  <button type="button" className="opt" onClick={() => void handoff(false)}>
                    <span className="opt-t">
                      أزِل وسم «{HANDOFF_TAG}»
                      <span className="opt-n">تُكملها بنفسك، ولا يبقى ما يستدعي زميلاً</span>
                    </span>
                  </button>
                )}
                {!paused && conv.botEnabled && (
                  <button type="button" className="opt"
                    onClick={() => { setXferOpen(false); setTakeOpen(true); }}>
                    <span className="opt-t">
                      أسكِت البوت أوّلاً
                      <span className="opt-n">حتّى لا يردّ البوت على زبونٍ ينتظر زميلَك</span>
                    </span>
                  </button>
                )}
              </div>
            </Sheet>
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
