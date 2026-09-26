'use client';

import {
  Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi, useToast, fmt, AR_LOCALE } from '@/lib/useApi';
import { api, post, idempotencyKey, ApiError } from '@/lib/api';
import { MESSAGE_TYPE_AR, QUOTA_BLOCKED_MSG, type MessageDTO } from '@aibot/shared';
import { useCan, useSession } from '@/lib/session';
import { useSocket, useLink, useFallbackPoll } from '@/lib/socket';
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
  /** من يتولّاها الآن — فارغٌ يعني لا أحد. */
  assignedUserId: string | null;
  assignedName: string | null;
}

/**
 * ★ الشكلُ من `@aibot/shared` لا مكتوبٌ هنا: العاملُ يبثّه وهذه الشاشةُ
 *   ترسمه، ونسختان تتباعدان فتُرسَم رسالةٌ ناقصةٌ بلا أن يشكو شيء.
 */
type Msg = MessageDTO;

interface Thread {
  /** معرّفُ المحادثة التي تخصّها هذه الحمولة — حارسُ «كلامٌ تحت اسمٍ آخر». */
  conversationId: string;
  items: Msg[];
  window: { expiresAt: string | null; open: boolean; billedAt: string | null };
}

interface ConvList {
  items: Conv[];
  /** عدُّ «يحتاجك الآن» من القاعدة — لا من الصفحة المحمَّلة. */
  attention: { count: number; oldestAt: string | null };
  nextCursor: string | null;
}

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

/**
 * ★ علامةُ التسليم لها **نصٌّ مسموع**.
 *   «✓» و«✓✓» تُقرآن «علامة صح» و«علامة صح علامة صح» عند قارئ الشاشة — أي
 *   لا شيء. والفرقُ بين «وصلت للخادم» و«وصلت للزبون» هو الفرقُ الذي يقرّر
 *   إن كان على الموظّف أن يتصرّف.
 */
const DELIVERY: Record<string, { mark: string; say: string }> = {
  queued: { mark: 'قيد الإرسال…', say: 'قيد الإرسال' },
  sent: { mark: '✓', say: 'أُرسلت' },
  delivered: { mark: '✓✓', say: 'وصلت جهازَه' },
  read: { mark: '✓✓ قُرئت', say: 'قرأها' },
  failed: { mark: 'لم تصل', say: 'لم تصل' },
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
/* ★ الأسماءُ من `@aibot/shared` — نصٌّ واحدٌ يقرؤه العاملُ (معاينةُ القائمة)
   والشاشةُ (الفقاعة) وسياقُ النموذج. وكانت ثلاثَ نسخٍ تتباعد: «[image]» في
   القائمة و«صورة» في الحوار ولا شيءَ عند النموذج. */
const MEDIA = MESSAGE_TYPE_AR;

/** الأنواعُ التي يُفتح مرفَقُها في المتصفّح — ولكلٍّ هيئةُ عرضه. */
const OPENABLE = new Set(['image', 'audio', 'video', 'document', 'sticker']);

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
  const { me } = useSession();
  const myId = me?.user.id ?? null;
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
  /** «رسائل أقدم»: انشغالٌ ونهاية — والزرُّ بلا حالتَيه يُضغط مرّتين ولا ينتهي. */
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderDone, setOlderDone] = useState(false);

  /**
   * ★ **مسوّدةٌ لكلّ محادثة — وكانت واحدةً للشاشة تُمسح مع كلّ تنقّل.**
   *
   *   الموظّف يكتب ردّاً طويلاً، ثمّ يحتاج إلى مراجعة محادثةٍ أخرى، أو يلمس
   *   صفّاً بالخطأ، أو يضغط زرّ الرجوع بالعادة — فتختفي كلماتُه كلُّها بلا
   *   تحذيرٍ ولا استرجاع. و«التالي المنتظر» — وهو زرٌّ وُضع ليُسرّع العمل —
   *   يمحوها هو أيضاً.
   *   والأثرُ لا يُشتكى منه لأنّه لا يُرى: الموظّف يتعلّم **ألّا يكتب
   *   طويلاً**، فتقصر الردودُ عمّا ينبغي ولا يعرف أحدٌ لماذا.
   *
   *   والخريطةُ في `useRef` لا في الحالة: كتابةُ حرفٍ لا تُعيد رسمَ الشاشة
   *   مرّتين. و`sessionStorage` نسخةُ راحةٍ لا مصدرَ حقيقة — تُقرأ في
   *   `try/catch` وتعمل الشاشةُ بلا وجودها.
   */
  const drafts = useRef<Record<string, string>>({});
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
  /** سجلُّ الفريق — أسماءٌ ومعرّفات، يقرؤه كلُّ موظّف ليحوّل باسمٍ لا بوسم. */
  const roster = useApi<{ items: Array<{ id: string; name: string; role: string }> }>('/team/roster');

  useEffect(() => { setExtra([]); }, [qs]);
  /** المحادثةُ السابقة — لتُحفظ مسوّدتُها قبل أن يُبدَّل `active`. */
  const prevActive = useRef<string | null>(null);

  useEffect(() => {
    const before = prevActive.current;
    if (before && before !== active) drafts.current[before] = draftRef.current;
    prevActive.current = active;

    setOlder([]); setOlderDone(false); setOlderBusy(false);
    setDraft(active ? (drafts.current[active] ?? '') : '');
    setAtBottom(true); setTakeOpen(false); setXferOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /* مرجعٌ للنصّ الحاليّ: الـeffect أعلاه يعمل عند تبدّل `active` وحده، فلو
     قرأ `draft` من الإغلاق لقرأ نصّاً بائتاً. */
  const draftRef = useRef('');
  draftRef.current = draft;

  /* ★ استرجاعٌ بعد إعادة تحميل الصفحة. و`sessionStorage` لا `localStorage`:
     المسوّدةُ تخصّ الوردية لا الجهاز، وبقاؤها أسابيع بعد إرسالها يُربك. */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('aibot:drafts');
      if (raw) drafts.current = JSON.parse(raw) as Record<string, string>;
    } catch { /* وضعُ التصفّح الخاصّ يرمي — والشاشةُ تعمل بلا مسوّدةٍ محفوظة */ }
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      drafts.current[active] = draft;
      try {
        /* الفارغةُ تُحذف لا تُحفظ: خريطةٌ تنمو بمفاتيحَ فارغةٍ إلى الأبد. */
        const keep = Object.fromEntries(Object.entries(drafts.current).filter(([, v]) => v.trim()));
        drafts.current = keep;
        sessionStorage.setItem('aibot:drafts', JSON.stringify(keep));
      } catch { /* كما أعلاه */ }
    }, 400);
    return () => clearTimeout(t);
  }, [draft, active]);

  const items = useMemo(() => [...(list.data?.items ?? []), ...extra], [list.data, extra]);
  const conv = items.find((c) => c.id === active) ?? null;
  /* ★ **لا حرفَ من حوارٍ إلّا تحت اسم صاحبه.**
     الحمولةُ تحمل معرّفَ محادثتها، فلا تُرسم إلّا إن طابقت المفتوحة. وهو
     حارسٌ ثانٍ بعد مسحِ `useApi` للبيانات عند تبدّل المسار: حتّى لو عاد
     طلبٌ متأخّرٌ لمحادثةٍ سابقة، لا يصل الشاشة. والثمنُ ثوانٍ من هيكلٍ
     عظميّ؛ والبديلُ أن يقرأ الموظّفُ «بدّي ألغي الحجز» تحت اسم من لم
     يطلب شيئاً — فيردّ عليه. */
  const fresh = thread.data && thread.data.conversationId === active ? thread.data : null;
  const msgs = useMemo(() => [...older, ...(fresh?.items ?? [])], [older, fresh]);

  /** الحوارُ المفتوح وصل فعلاً — وعليه يُفتح المُنشئ. */
  const threadReady = Boolean(fresh);

  const capsOf = useCallback(
    (kind: string) => chans.data?.items.find((c) => c.kind === kind),
    [chans.data],
  );
  const caps = conv ? capsOf(conv.channelKind) : undefined;
  const maxLen = caps?.capabilities.maxTextLen ?? 4096;
  const winHours = caps?.capabilities.windowHours ?? 24;
  const win = fresh?.window;
  const remaining = win?.expiresAt ? fmt.remaining(win.expiresAt) : null;
  const paused = Boolean(conv?.botPausedUntil && new Date(conv.botPausedUntil).getTime() > now);
  const tagged = Boolean(conv?.tags?.includes(HANDOFF_TAG));

  /** المحادثةُ لي: لا أحدَ يتولّاها، أو أنا. */
  const mine = !conv?.assignedUserId || conv.assignedUserId === myId;

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

  /* ★ **الرقمُ من القاعدة، والصفوفُ من الصفحة.**
     كان الاثنان من الصفحة المحمَّلة (٤٠ صفّاً بأحدث الطوابع)، فالمحادثةُ
     المنتظرةُ منذ أمس — وهي أوّلُ من يستحقّ الردّ — أوّلُ من يسقط خارجها
     لأنّها الأقدم زمنيّاً. فيقرأ الموظّف «٥ بانتظار ردّك»، يردّ على الخمسة
     ويغلق هاتفه، والسادس ينتظر يوماً كاملاً. والرقمُ الذي بُنيت الشاشة
     حوله يكذب تحديداً في الحالة التي وُجد لأجلها.
     وحين يختلف الرقمُ عن المعروض، يُقال ذلك صراحةً ويُفتح مرشّحُهم. */
  const attnTotal = list.data?.attention.count ?? attnRows.length;
  const attnOldestAt = list.data?.attention.oldestAt ?? attnRows[0]?.lastMessageAt ?? null;
  const oldestWait = attnTotal ? minsSince(attnOldestAt, now) : 0;
  const attnHidden = Math.max(0, attnTotal - attnRows.length);

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
    /* ★ جهةٌ حُذفت نهائيّاً: القائمةُ تُعاد قراءتُها فيسقط صفُّها — بدل صفٍّ باقٍ
       يردّ ٤٠٤ عند فتحه ويُقرأ عطلاً. */
    'conversation:removed': () => { void list.reload(); },
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

  /**
   * ★ **مرساةُ التمرير عند الإلحاق في الأعلى.**
   *
   *   إلحاقُ خمسين رسالةً فوق ما يقرأ الموظّف يزيح كلَّ ما تحتها، فيقفز
   *   التمريرُ إلى أعلى الدفعة الجديدة ويفقد موضعَه في منتصف بحثه عن حجزٍ
   *   قديم. و`overflow-anchor` يُصلحها في كروم وحده — وسفاري هو المتصفّح
   *   الذي يعمل عليه نصفُ الموظّفين.
   *   والحلُّ حسابيّ: يُحفظ **البعدُ عن قاع** الحوار قبل الإلحاق ويُستعاد
   *   بعده. و`useLayoutEffect` لا `useEffect`: التصحيحُ قبل الرسم فلا يُرى
   *   وميضُ القفزة.
   */
  const pendingAnchor = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (pendingAnchor.current !== null) {
      el.scrollTop = el.scrollHeight - pendingAnchor.current;
      pendingAnchor.current = null;
      return;
    }
    /* التمرير للأحدث — ولا يُقفز إن كان الموظّف يقرأ أعلى الحوار. */
    if (atBottom) el.scrollTop = el.scrollHeight;
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

  /**
   * ★ **«رسائل أقدم» — ثلاثةُ أعطالٍ في زرٍّ واحد.**
   *
   *   ① بلا حالة انشغال: على شبكةٍ بطيئة يضغطه الموظّف ثانيةً، فيصل الطلبان
   *     بنفس `before` وتُلحَق الصفحةُ نفسُها **مرّتين** — خمسون رسالةً مكرّرةً
   *     بمفاتيحَ مكرّرة.
   *   ② وبلا نهاية: حين تنفد الرسائل يبقى الزرّ ويعيد صفحةً فارغةً بلا خبر.
   *   ③ والتمريرُ يقفز: الإلحاقُ في الأعلى يزيح ما تحته، فيفقد الموظّف موضعَه
   *     في منتصف بحثه عن حجزٍ قديم. (و`overflow-anchor` غيرُ مدعومٍ في سفاري
   *     فلا يُعوَّل عليه.)
   */
  async function loadOlderMsgs() {
    const first = msgs[0];
    if (!first || !active || olderBusy || olderDone) return;
    const el = bodyRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    setOlderBusy(true);
    try {
      const more = await api<Thread>(
        `/conversations/${active}/messages?before=${encodeURIComponent(first.createdAt)}`,
      );
      /* صفحةٌ أقصرُ من السقف تعني أنّنا بلغنا أوّلَ الحوار. */
      if (more.items.length < 50) setOlderDone(true);
      setOlder((o) => {
        /* دمجٌ بالمعرّف: يُسقط ما وصل مرّتين — من ضغطتين، أو من بثٍّ سبق
           الجلب، أو من تداخل صفحتين عند نفس الطابع. */
        const by = new Map<string, Msg>();
        for (const m of [...more.items, ...o]) by.set(m.id, m);
        return [...by.values()].sort((a, b) => stamp(a.createdAt) - stamp(b.createdAt));
      });
      pendingAnchor.current = before;
    } catch { toast('تعذّر جلب الأقدم'); }
    finally { setOlderBusy(false); }
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
      /* المسوّدةُ تُمسح عند **النجاح** وحده — وفشلُ الإرسال يُبقي الكلمات. */
      setDraft('');
      delete drafts.current[active];
      try {
        sessionStorage.setItem('aibot:drafts', JSON.stringify(drafts.current));
      } catch { /* وضعُ التصفّح الخاصّ */ }
      setAtBottom(true);
      /* ★ «وصل» كانت تُقال على 202 — أي على **قبولٍ في الطابور** لا على
         وصول. والرسالة الآن تظهر في الحوار بحالتها الحقيقيّة، فالتوستة
         تقول ما جرى فعلاً وتُحيل إلى الفقاعة. */
      toast('أُرسل ردّك — تتبّع حالته في الحوار. وتوقّف البوت عن هذه المحادثة وحدها.');
      /* ★ ولا إعادةَ جلبٍ هنا: الـAPI يحجز الصفّ **ويبثّه** قبل أن يردّ،
         فالفقاعةُ تصل من `message:new` خلال أجزاءٍ من الثانية. وإعادةُ الجلب
         كانت تُلبس الحوارَ هيكلاً عظميّاً بعد كلّ إرسال ويختفي «رسائل أقدم»
         من تحت إبهام الموظّف. */
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

  /** تعيينُ المحادثة لزميلٍ — أو رفعُ التعيين. */
  async function assignTo(userId: string | null, name: string | null) {
    if (!active) return;
    setXferOpen(false);
    try {
      await post(`/conversations/${active}/assign`, { userId });
      patchConv(active, { assignedUserId: userId, assignedName: name });
      toast(userId ? `صارت باسم ${name}` : 'رُفع التعيين — بلا صاحبٍ معلَن');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر التعيين');
    }
  }

  /** أخذُ المحادثة باسمي — بلا لمس البوت ولا الوسوم. */
  async function claim() {
    if (!active || !myId) return;
    try {
      await post(`/conversations/${active}/assign`, { userId: myId });
      patchConv(active, { assignedUserId: myId, assignedName: me?.user.name ?? null });
      toast('صارت باسمك — ويراها زميلُك قد انتقلت');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'تعذّر أخذُ المحادثة');
    }
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
      patchConv(active, {
        ...(pauseMinutes != null
          ? {
            botPausedUntil: new Date(Date.now() + pauseMinutes * 60_000).toISOString(),
            needsAttention: false,
          }
          : { botEnabled: false }),
        /* والتولّي يُسجَّل باسمي محلّيّاً كما سجّله الخادم — فلا وميضَ
           يقول «تولّاها زميل» بين الردّ وإعادة الجلب. */
        assignedUserId: myId,
        assignedName: me?.user.name ?? null,
      });
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
      patchConv(active, { botEnabled: true, botPausedUntil: null, assignedUserId: null, assignedName: null });
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

  /**
   * ★ **الوصلةُ تُرى، والانقطاعُ لا يمرّ صامتاً.**
   *
   *   كان الإنبوكس يموت بلا علامة بعد كلّ نشرٍ أو نومِ جهاز: الشاشةُ ساكنةٌ
   *   ويظنّ الموظّف أنّ لا أحد يراسل، ورسائلُ الزبائن تنتظر في القاعدة.
   *   فصارت ثلاثاً: شريطٌ يقول إنّ الوصلة منقطعة · إعادةُ جلبٍ عند عودتها
   *   (فما فات أثناء الانقطاع يظهر فوراً) · واستطلاعٌ كلّ دقيقة **ما دامت
   *   منقطعة** فلا تجلس الوردية أمام شاشةٍ ميّتة مهما طال العطل.
   */
  const linkUp = useLink(useCallback(() => {
    void list.reload();
    if (active) void thread.reload();
  }, [list.reload, thread.reload, active])) === 'up';

  useFallbackPoll(!linkUp, 60_000, useCallback(() => {
    void list.reload();
    if (active) void thread.reload();
  }, [list.reload, thread.reload, active]));

  const winLeftMs = win?.expiresAt ? new Date(win.expiresAt).getTime() - now : 0;
  const winPct = Math.min(1, Math.max(0, winLeftMs / (winHours * 3600_000)));

  return (
    <div className="ibx" data-pane={active ? 'thread' : 'list'}>
      {toastNode}

      {/* ══════ لوح القائمة ══════ */}
      <section className="ibx-list" aria-label="المحادثات">
        <header className="ibx-lhead">
          <input
            className="ibx-search" type="search" value={search}
            /* ★ `dir="auto"` على حقلٍ **فارغ** يُحاذي نائبَه من اليسار: لا
               محرفَ قويّاً في القيمة فيرتدّ إلى الافتراضيّ. والنائبُ عربيٌّ
               فيظهر مقلوبَ المحاذاة في شاشةٍ عربيّة. و`auto` تبقى بعد أوّل
               حرفٍ فيُكتب الرقمُ من اليسار والاسمُ من اليمين. */
            dir={search ? 'auto' : 'rtl'}
            placeholder="ابحث باسمٍ أو رقمٍ أو نصّ رسالة…"
            aria-label="بحث في المحادثات"
            onChange={(e) => setSearch(e.target.value)}
          />
        </header>

        {!linkUp && (
          <div className="ibx-pad">
            <Note tone="warn">
              <b>الاتّصال اللحظيّ منقطع.</b>{' '}
              القائمةُ تُحدَّث كلّ دقيقة حتّى يعود — وما فات يظهر لحظةَ عودته.
            </Note>
          </div>
        )}

        {/* ★ إشارةُ إعادة الجلب لا تُزيح شيئاً: خيطٌ فوق القائمة بدل ثلاث
            مئة بكسلٍ من الهيكل تقفز تحت الإبهام كلّ بضع ثوانٍ. */}
        {list.refreshing && <div className="ibx-refresh" aria-hidden="true" />}

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
                          {/* ★ «تولّيتَها» بصيغة المخاطَب كانت تُقرأ عند **كلّ**
                              موظّف: الثاني يظنّ أنّه هو، أو يردّ بالتوازي مع
                              زميله. والاسمُ يحسم ذلك بكلمةٍ واحدة. */}
                          {rowPaused && (
                            <span className="ibx-tg">
                              {!c.assignedUserId || c.assignedUserId === myId
                                ? 'تولّيتَها'
                                : `تولّاها ${c.assignedName ?? 'زميل'}`}
                            </span>
                          )}
                          {!c.botEnabled && !rowPaused && <span className="ibx-tg">البوت مطفأ</span>}
                          {/* ★ وسمُ المسوّدة: بلا هذا لا يعرف الموظّف أنّه
                              ترك كلاماً غيرَ مُرسَلٍ في محادثةٍ أخرى. */}
                          {(drafts.current[c.id] ?? '').trim() && (
                            <span className="ibx-tg">مسوّدة</span>
                          )}
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
          <div className="ibx-hero" data-state={attnTotal ? 'attn' : 'calm'}>
            <span className="ibx-hm" aria-hidden="true">{attnTotal ? '■' : '●'}</span>
            <span className="ibx-hv"><span className="num">{attnTotal}</span></span>
            <span className="ibx-hk">
              بانتظار ردِّك الآن
              <span className="ibx-hn">
                {attnTotal
                  ? (
                    <>
                      أطولُ انتظارٍ <span className="num">{oldestWait}</span> د
                      {attnHidden > 0 && (
                        <>
                          {' · '}
                          <button type="button" className="ibx-hlink" onClick={() => setFilter('attn')}>
                            <span className="num">{attnHidden}</span> منها خارج المعروض — اعرِضهم
                          </button>
                        </>
                      )}
                    </>
                  )
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
                  <Tag
                    tone="serious"
                    label={`${mine ? 'تولّيتَها' : `تولّاها ${conv.assignedName ?? 'زميل'}`}`
                      + ` · يعود البوت بعد ${fmt.remaining(conv.botPausedUntil) ?? 'لحظات'}`}
                  />
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

            {/* ★ **تحذيرُ التصادم — وهو أهمّ ما في شاشة الفريق.**
                بلا هذا يفتح موظّفان المحادثةَ نفسها ويردّان في الدقيقة
                نفسها بردَّين متناقضَين، ولا شيء في الشاشة يقول إنّ أحداً
                يعمل عليها الآن. والزرُّ لا يُخفي التعارض بل يحسمه: من
                يتابع يصير صاحبَها، ويراها الأوّل قد انتقلت. */}
            {!mine && conv.assignedName && (
              <div className="ibx-pad">
                <Note tone="warn">
                  <b>يتولّاها {conv.assignedName} الآن.</b>{' '}
                  ردُّك يصل الزبونَ بجانب ردّه. إن كنتَ ستتابعها فخُذها باسمك
                  ليعرف زميلُك.{' '}
                  <Button size="sm" disabled={can.readOnly}
                    reason={can.readOnly ? 'حسابك للقراءة فقط' : undefined}
                    onClick={() => void claim()}>أتابعها أنا</Button>
                </Note>
              </div>
            )}

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

              {/* ★ الظهورُ مشروطٌ بأنّ **الصفحة الأولى** كانت ممتلئة لا بطول
                  `msgs`: خمسون رسالةً جاءت نصفُها من البثّ لا تعني أنّ هناك
                  أقدمَ منها، والزرُّ حينها يعد بما لا يوجد. */}
              {threadReady && !thread.error && (fresh?.items.length ?? 0) >= 50 && !olderDone && (
                <div className="ibx-pad">
                  <Button size="sm" busy={olderBusy} onClick={() => void loadOlderMsgs()}>
                    رسائل أقدم
                  </Button>
                </div>
              )}
              {olderDone && (
                <div className="ibx-pad">
                  <div className="ibx-start">بدايةُ المحادثة</div>
                </div>
              )}

              {msgs.map((m, i) => {
                const prev = msgs[i - 1];
                const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                const press = m.direction === 'in' ? m.payload?.buttonPayload : null;
                const media = !m.body && MEDIA[m.type] ? MEDIA[m.type] : null;
                const loc = m.payload?.location ?? null;
                /* ★ المرفَقُ يُفتح — والوسيلةُ كانت موجودةً بلا طريقٍ إليها.
                   كان الموظّف يقرأ «📎 صورة» ويسأل الزبون «شو بعتت؟». */
                const mediaHref = m.payload?.mediaId && OPENABLE.has(m.type) && active
                  ? `/api/conversations/${active}/messages/${m.id}/media`
                  : null;
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
                          <div className={`bub ${voice}${mediaHref || loc ? ' has-media' : ''}`} dir="auto">
                            {media && !mediaHref && <span className="ibx-media">📎 {media}</span>}
                            {!media && m.body}

                            {/* ★ **الموقعُ يُفتح في الخريطة.**
                                موقعُ الزبون هو محتوى الطلب في مطعمٍ يوصّل،
                                وكان يصل «📎 موقع» بلا إحداثيّةٍ ولا عنوان —
                                فيُسأل الزبون عن عنوانه بعد أن أرسله. */}
                            {loc && (
                              <a
                                className="ibx-loc"
                                href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
                                target="_blank" rel="noopener noreferrer"
                              >
                                <span aria-hidden="true">📍</span>
                                <span className="ibx-loc-t">
                                  {loc.name || loc.address || 'موقعٌ مُرسَل'}
                                  <span className="ibx-loc-c num">
                                    {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                                  </span>
                                </span>
                                <span className="ibx-loc-go">افتح في الخريطة</span>
                              </a>
                            )}

                            {mediaHref && m.type === 'image' && (
                              <a className="ibx-shot" href={mediaHref} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={mediaHref} alt={m.body || 'صورةٌ أرسلها الزبون'} loading="lazy" />
                              </a>
                            )}
                            {mediaHref && m.type === 'sticker' && (
                              <a className="ibx-shot sticker" href={mediaHref} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={mediaHref} alt="ملصق" loading="lazy" />
                              </a>
                            )}
                            {mediaHref && m.type === 'audio' && (
                              <audio className="ibx-aud" controls preload="none" src={mediaHref}>
                                متصفّحك لا يشغّل الصوت — <a href={mediaHref}>نزّل التسجيل</a>
                              </audio>
                            )}
                            {mediaHref && m.type === 'video' && (
                              <video className="ibx-vid" controls preload="none" src={mediaHref} />
                            )}
                            {mediaHref && m.type === 'document' && (
                              <a className="ibx-file" href={mediaHref} target="_blank" rel="noopener noreferrer">
                                <span aria-hidden="true">📄</span> {m.body || 'افتح الملفّ'}
                              </a>
                            )}
                            {mediaHref && m.body && m.type !== 'document' && (
                              <span className="ibx-cap">{m.body}</span>
                            )}

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
                              <span aria-hidden="true">{DELIVERY[m.status]?.mark ?? m.status}</span>
                              <span className="sr">{DELIVERY[m.status]?.say ?? m.status}</span>
                            </span>
                          )}
                          {/* سببُ الفشل كان مجلوباً ولا يُعرض: «فشلت» بلا سبب */}
                          {m.status === 'failed' && m.errorMessage && (
                            <span className="ibx-err">{m.errorMessage}</span>
                          )}
                          {/* ★ «لم تصل» بلا مخرجٍ يدفع الموظّف إلى كتابتها من
                              جديد بمفتاحٍ جديد — فتصل نسختان إن كان العطل
                              عابراً. الإعادة على الصفّ نفسه تُنهي الاثنين. */}
                          {/* ★★ **وعند السقف «أعِد المحاولة» حلقةٌ بلا مخرج.**
                              الإرسالُ مرفوضٌ في طبقة الحصّة قبل أن يلمس ميتا، فكلُّ
                              إعادةٍ تفشل بنفس السبب — والموظّف يعيد ويعيد ويظنّ
                              العطلَ في الشبكة. والسقفُ يرفعه صاحبُ الفوترة لا هو،
                              فيُقال له ذلك بدل زرٍّ يَعِد بما لا يقع. */}
                          {m.direction === 'out' && m.status === 'failed'
                            && m.errorMessage?.includes(QUOTA_BLOCKED_MSG) && (
                            <span className="ibx-err">
                              {can.billing
                                ? 'أعِد المحاولة بعد رفع السقف — الإرسال مرفوضٌ قبل أن يصل ميتا.'
                                : 'السقف يرفعه صاحبُ الفوترة في حسابك — أبلِغه، فالإعادة لا تنجح قبل ذلك.'}
                            </span>
                          )}
                          {m.direction === 'out' && m.status === 'failed' && !can.readOnly
                            && !m.errorMessage?.includes(QUOTA_BLOCKED_MSG) && (
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
                    placeholder={threadReady
                      ? 'اكتب ردّك… (Enter يُرسل · Shift+Enter سطرٌ جديد)'
                      : 'يُفتح حين يصل الحوار…'}
                    aria-label="نصّ الردّ" disabled={sending || can.readOnly || !threadReady}
                    onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
                  />
                  <div className="ibx-send">
                    {draft.length > maxLen * 0.8 && (
                      <span className={`num ibx-count${draft.length > maxLen ? ' over' : ''}`}>
                        {draft.length} / {maxLen}
                      </span>
                    )}
                    <Button type="submit" variant="primary" size="sm" busy={sending}
                      disabled={!draft.trim() || can.readOnly || !threadReady}
                      /* ★ السببُ مشروطٌ لا ثابت: كان يُكتب دائماً، فزرُّ الإرسال
                         المعطَّل **لأنّك لم تكتب بعد** يُعلن «حسابك للقراءة فقط» —
                         خبرٌ كاذبٌ يقرأه كلُّ موظّفٍ في كلّ محادثةٍ يفتحها.
                         ★ ولا إرسالَ قبل أن يصل الحوار: الردُّ على حوارٍ لم
                         يُقرأ ردٌّ على الغيب — وإن فشل الجلبُ فعلى الغيب مرّتين. */
                      reason={can.readOnly ? 'حسابك للقراءة فقط'
                        : !threadReady ? 'لم يصل الحوار بعد — لا تردّ على ما لم تقرأ'
                          : undefined}>
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
              hint="الاسمُ يظهر في صفّها وفي رأس الحوار عند زميلك، ويمنع أن يردّ اثنان معاً. ولا إخطارَ يُرسَل بعد — يراه حين يفتح الإنبوكس."
            >
              <div className="opts">
                {/* ★ **التحويلُ باسمٍ — وكان وسماً نصّيّاً لا يقول لأيّ زميل.**
                    والوسمُ لا يصل أحداً: لا يظهر في قائمة زميلك، ولا يمنع
                    اثنَين من الردّ معاً. فكان اعترافاً مكتوباً بأنّ شيئاً لم
                    يحدث. والتعيينُ يُحدثه: صفٌّ يقول من صاحبُها الآن. */}
                {(roster.data?.items ?? [])
                  .filter((u) => u.id !== conv.assignedUserId)
                  .map((u) => (
                    <button key={u.id} type="button" className="opt"
                      onClick={() => void assignTo(u.id, u.name)}>
                      <span className="opt-t">
                        {u.id === myId ? `${u.name} (أنت)` : u.name}
                        <span className="opt-n">
                          {u.id === myId
                            ? 'تصير باسمك — ويراها زملاؤك كذلك'
                            : 'يصير صاحبَها ويراها باسمه في إنبوكسه'}
                        </span>
                      </span>
                    </button>
                  ))}

                {conv.assignedUserId && (
                  <button type="button" className="opt" onClick={() => void assignTo(null, null)}>
                    <span className="opt-t">
                      ارفع التعيين
                      <span className="opt-n">تعود بلا صاحبٍ معلَن — ويردّ عليها من يصلها أوّلاً</span>
                    </span>
                  </button>
                )}

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
