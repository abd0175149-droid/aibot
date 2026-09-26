'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { get, post, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { readDuplicates, sidesOf } from '@/lib/contacts';
import {
  PageHead, Stack, Row, Pill, Tag, Note, Button, Sheet, Table, Empty, Input, Field,
  Skeleton, ErrorBox, KV, KVRow, type Column, type Tone,
} from '@/components/ui';
import {
  Band, Hero, Section, Rows, MetricRow, Fold, ScreenDock, ChipRow, type Sev,
} from '@/components/screen';

/**
 * جهات الاتّصال — **الشخص الواحد عبر قنواته**.
 *
 * ★ **السؤال الذي تُفتح الشاشة لأجله**: «كم شخصاً مكرّراً على الأرجح في
 *   قاعدتك؟» — والزبون نفسه يراسلك من واتساب ومن إنستجرام فيصير **شخصَين**:
 *   تُجيبه مرّتين، وتُحسب نوافذه مرّتين، ولا يظهر أنّه عميلٌ متكرّر. فالرقم
 *   البطوليّ هنا **رقمُ فعلٍ لا رقمُ خبر**: كلُّ واحدةٍ فيه بطاقةٌ زائدةٌ
 *   يُضغط عليها فتُراجَع فتُدمج.
 *
 * ── وأربعةُ قيودٍ في الدمج، كلٌّ منها مرئيٌّ في هذه الشاشة ────────────────
 *  ① **مراجعةٌ قبل الدمج**: زرُّ المرشَّح يفتح ورقةً صاعدةً تجلب من الخادم
 *    **ما سيتحرّك بالاسم** — كلّ مقبضٍ وكلّ محادثةٍ وعددُ رسائلها وكلّ حقلٍ
 *    يتغيّر. ولا زرَّ دمجٍ في صفّ القائمة أبداً: الدمج لا يُضغط بضغطةٍ واحدة.
 *  ② **لا رسالةَ تُفقد**: الورقةُ تعدّ الرسائل التي ستنتقل، وتقول صراحةً إنّ
 *    المحادثتين تبقيان **مرئيّتين منفصلتين** تحت البطاقة الموحَّدة.
 *  ③ **يُسجَّل**: سجلُّ الدمج معروضٌ في ملفّ الجهة بفاعله ووقته.
 *  ④ **وتراجعٌ**: الخادم يعيد مفتاح التراجع، فيظهر سطرُ «تراجَع» فوق الشاشة
 *    مباشرةً بعد الدمج، ويبقى في ملفّ الجهة بعد ذلك. ولأنّه ممكنٌ فهو
 *    **مذكورٌ قبل الضغط** لا بعده — ولو لم يكن ممكناً لقيل ذلك في مكانه.
 *
 * ★ **وما لا تفعله الشاشة**: لا تدمج تلقائيّاً. «محمد» و«محمود» يتشابهان
 *   ولا يتّحدان، والاقتراحُ يقول سببَه (رقمٌ مطابق · تشابهُ اسم) فيُقرأ قبل
 *   أن يُقبل. والقرارُ لصاحب الحساب وحده.
 */

/* ══════════════ العقد مع الخادم — ما نقرأه لا ما يُرسَل ══════════════ */

interface Summary {
  id: string;
  displayName: string | null;
  phone: string | null;
  tags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastMessageAt: string | null;
  optedOutAt: string | null;
  blockedAt: string | null;
  conversations: number;
  identities: number;
  kinds: string[];
  windowsBilled: number;
  /** `null` لمن لا يرى الفوترة — والرقمُ لا يُعرض لمن لا يملكه. */
  aiCostUsd: string | null;
}

interface ListResp { items: Summary[]; nextCursor: string | null; total: number }

interface Pair { why: string; score: number; suggestKeep: string; a: Summary; b: Summary }

interface DupResp { items: Pair[]; records: number; total: number }

interface Identity {
  id: string;
  externalId: string;
  displayHandle: string | null;
  channelKind: string;
  channelName: string | null;
  firstSeenAt: string | null;
  conversationId: string | null;
}

interface Conv {
  id: string;
  channelKind: string;
  handle: string;
  status: string;
  needsAttention: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  preview: string | null;
  tags: string[];
  messages: number;
}

interface HistoryRow {
  id: string;
  action: string;
  at: string | null;
  label: string | null;
  actor: string | null;
  undoable: boolean;
}

interface Detail {
  contact: Summary;
  identities: Identity[];
  conversations: Conv[];
  windows: { opened: number; billed: number; aiCostUsd: string | null };
  history: HistoryRow[];
  candidates: Array<{ why: string; score: number; suggestKeep: string; other: Summary }>;
}

interface Preview {
  keep: Summary;
  absorb: Summary;
  moves: {
    identities: Array<{ id: string; externalId: string; displayHandle: string | null; channelKind: string; channelName: string | null }>;
    conversations: Array<{ id: string; channelKind: string; handle: string; messages: number; lastMessageAt: string | null; status: string }>;
    windows: number;
    messages: number;
  };
  fields: Array<{ k: string; label: string; was: string | null; now: string | null; why: string }>;
  optout: boolean;
  reversible: boolean;
}

/* ══════════════ مفرداتٌ واحدةٌ للقناة في كلّ الشاشة ══════════════ */

const CH: Record<string, { label: string; tone: Tone }> = {
  whatsapp_cloud: { label: 'واتساب', tone: 'brand' },
  instagram: { label: 'إنستجرام', tone: 'violet' },
};

const chLabel = (k: string) => CH[k]?.label ?? k;
const chTone = (k: string): Tone => CH[k]?.tone ?? 'neutral';

type Filt = 'all' | 'dup' | 'multi' | 'quiet' | 'whatsapp_cloud' | 'instagram';

const FILTS: Array<{ f: Filt; label: string }> = [
  { f: 'all', label: 'الكلّ' },
  { f: 'dup', label: 'مكرّرٌ محتمل' },
  { f: 'multi', label: 'موحَّدٌ عبر قناتين' },
  { f: 'quiet', label: 'لا يُراسَل' },
  { f: 'whatsapp_cloud', label: 'واتساب' },
  { f: 'instagram', label: 'إنستجرام' },
];

/** اسمٌ يُقرأ: الاسمُ ثمّ الرقمُ ثمّ المقبض — ولا «بلا اسم» صامتة. */
function nameOf(c: Summary): string {
  return c.displayName?.trim() || c.phone?.trim() || 'جهةٌ بلا اسم';
}

/**
 * قيمةُ حقلٍ في ورقة المراجعة — **مقروءةٌ لا خام**.
 *
 * ★ الخادم يُرسل التواريخ ISO («2025-08-14T09:12:00.000Z») لأنّها قيمةُ
 *   العمود، وعرضُها كما هي يضع سلسلةَ آلةٍ أمام صاحب مطعمٍ يقرّر بها دمجاً.
 *   والحقلُ يُعرف بلاحقة اسمه (`…At`) — وهي اصطلاحُ المخطّط كلِّه.
 */
function fieldValue(k: string, v: string | null): string {
  if (v === null || v === '') return '—';
  return /At$/.test(k) ? fmt.when(v) : v;
}

/** سببُ الاقتراح نصّاً — لأنّ «اقتُرح» بلا سببٍ لا يُبنى عليه قرار. */
function whyText(why: string, score: number): string {
  if (why === 'phone') return 'رقمٌ يطابق مقبضاً — تطابقٌ تامّ';
  return `تشابهُ اسم — ${Math.round(score * 100)}%`;
}

/**
 * صفُّ مرشَّح — وهو **زوجٌ لا صفّ**: طرفاه معروضان معاً وسببُ الاقتراح فوقهما.
 *
 * ★ ومكانُه هنا لا داخل الصفحة: مكوّنٌ يُعرَّف في جسم الصفحة يُعاد بناؤه مع
 *   كلّ ضغطةِ مفتاحٍ في البحث، فيُفكّ عقدُه من الشجرة ويُعاد تركيبها — وميضٌ
 *   وفقدُ تركيزٍ على أضعف جهاز، بلا أن يفشل شيء.
 */
function PairSide({ c, role, keep }: { c: Summary; role: string; keep?: boolean }) {
  return (
    <div className={keep ? 'ct-side ct-side-keep' : 'ct-side'}>
      <span className="ct-side-r">{role}</span>
      <span className="ct-side-n" dir="auto">{nameOf(c)}</span>
      <span className="ct-side-m">
        {c.phone && <span className="mono">{c.phone}</span>}
        {c.kinds.map((k) => <Pill key={k} tone={chTone(k)} label={chLabel(k)} />)}
      </span>
      <span className="ct-side-m">
        <span className="num">{fmt.num(c.conversations)}</span> محادثة ·
        {' '}آخر نشاط {fmt.when(c.lastMessageAt ?? c.lastSeenAt)}
      </span>
    </div>
  );
}

function PairRow({ p, block, onReview, onOpen }: {
  p: Pair;
  /** سببُ تعطيل الدمج إن وُجد — يُرسَم على الشاشة لا في `title` */
  block: string | null;
  onReview: (keepId: string, absorbId: string) => void;
  onOpen: (id: string) => void;
}) {
  const { keep, absorb } = sidesOf(p.a, p.b, p.suggestKeep);
  return (
    <div className="ct-pair">
      <div className="ct-pair-h">
        {/* ترميزٌ مزدوج: شكلٌ ونصٌّ — والسببُ مكتوبٌ لا محمولٌ في اللون */}
        <span aria-hidden="true" className="ct-pair-m">{p.why === 'phone' ? '●' : '▲'}</span>
        <span className="ct-pair-w">{whyText(p.why, p.score)}</span>
      </div>
      <div className="ct-sides">
        <PairSide c={keep} role="تبقى" keep />
        <span aria-hidden="true" className="ct-vs">＋</span>
        <PairSide c={absorb} role="تُدمَج فيها" />
      </div>
      <div className="ct-pair-a">
        <Button
          variant="primary"
          size="sm"
          disabled={Boolean(block)}
          reason={block ?? undefined}
          onClick={() => onReview(keep.id, absorb.id)}
        >
          راجِع الدمج
        </Button>
        <Button size="sm" onClick={() => onOpen(keep.id)}>افتح الملفّ</Button>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const can = useCan();
  const { toast, node: toastNode } = useToast();

  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [filt, setFilt] = useState<Filt>('all');

  /* بحثٌ حيٌّ بلا نداءٍ لكلّ حرف: مهلةٌ قصيرةٌ تجعل الكتابة نداءً واحداً. */
  useEffect(() => {
    const t = setTimeout(() => setQLive(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (qLive) p.set('q', qLive);
    if (filt !== 'all') p.set('filter', filt);
    const s = p.toString();
    return s ? `/contacts?${s}` : '/contacts';
  }, [qLive, filt]);

  const list = useApi<ListResp>(path);
  const dups = useApi<DupResp>('/contacts/duplicates');

  /* صفحاتٌ إضافيّةٌ تُلحق ولا تُستبدل — والمؤشّر ينطلق من آخر ما وصل. */
  const [extra, setExtra] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  useEffect(() => { setExtra([]); setCursor(null); }, [path]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);

  /** مفتاحُ التراجع عن آخر دمج — يظهر سطراً فوق الشاشة، ويبقى في الملفّ بعده. */
  const [lastMerge, setLastMerge] = useState<{ auditId: string; label: string } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const rows = useMemo(() => [...(list.data?.items ?? []), ...extra], [list.data, extra]);
  const next = cursor ?? list.data?.nextCursor ?? null;

  const reloadAll = useCallback(() => {
    setExtra([]);
    setCursor(null);
    void list.reload();
    void dups.reload();
  }, [list, dups]);

  async function loadMore() {
    if (!next) return;
    setMoreBusy(true);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const r = await get<ListResp>(`${path}${sep}cursor=${encodeURIComponent(next)}`);
      setExtra((m) => [...m, ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر جلب المزيد');
    } finally {
      setMoreBusy(false);
    }
  }

  const loadDetail = useCallback(async (id: string) => {
    setDetailBusy(true);
    setDetailErr(null);
    try {
      setDetail(await get<Detail>(`/contacts/${id}`));
    } catch (e) {
      setDetailErr(e instanceof ApiError ? e.message : 'تعذّر جلب ملفّ الجهة');
    } finally {
      setDetailBusy(false);
    }
  }, []);

  /* ★ الحجبُ والعدول من البطاقة — كانا موعودَين في صفحة الخصوصيّة بلا زرّ.
     والفعلُ يُعيد تحميلَ الملفّ والقائمةَ معاً: الحالةُ تظهر في الموضعَين. */
  const perms = useCan();
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const setFlag = useCallback(async (id: string, action: 'block' | 'unblock' | 'optout' | 'optin') => {
    setFlagBusy(action);
    try {
      const r = await post<{ message: string }>(`/contacts/${id}/${action}`, {});
      toast(r.message);
      await loadDetail(id);
      reloadAll();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر تنفيذ الطلب.');
    } finally {
      setFlagBusy(null);
    }
  }, [loadDetail, reloadAll, toast]);

  function openDetail(id: string) {
    setOpenId(id);
    setDetail(null);
    void loadDetail(id);
  }

  /** ورقةُ المراجعة: الخطّةُ تُجلب من الخادم — ولا تُبنى في المتصفّح. */
  const openReview = useCallback(async (keepId: string, absorbId: string) => {
    setReviewOpen(true);
    setPlan(null);
    setPlanErr(null);
    setPlanBusy(true);
    try {
      setPlan(await get<Preview>(
        `/contacts/merge-preview?keep=${encodeURIComponent(keepId)}&absorb=${encodeURIComponent(absorbId)}`,
      ));
    } catch (e) {
      setPlanErr(e instanceof ApiError ? e.message : 'تعذّر حساب خطّة الدمج');
    } finally {
      setPlanBusy(false);
    }
  }, []);

  async function doMerge() {
    if (!plan) return;
    setMergeBusy(true);
    try {
      const r = await post<{ auditId: string; moved: { conversations: number; messages: number } }>(
        '/contacts/merge',
        { keepContactId: plan.keep.id, mergeContactId: plan.absorb.id },
      );
      setLastMerge({
        auditId: r.auditId,
        label: `${nameOf(plan.absorb)} ← ${nameOf(plan.keep)}`,
      });
      toast('دُمِجت البطاقتان — والتراجع متاحٌ من السطر أعلى الشاشة.');
      setReviewOpen(false);
      const keepId = plan.keep.id;
      setPlan(null);
      reloadAll();
      if (openId) {
        setOpenId(keepId);
        void loadDetail(keepId);
      }
    } catch (e) {
      /* ★ 409 تعني «تغيّر الحال قبل ضغطتك» لا «مدخلٌ خاطئ»: بطاقةٌ دُمجت من
         نافذةٍ أخرى أو حُذفت. ونصُّ العميل يقول ما يفعل — لا كودَ حالة. */
      toast(e instanceof ApiError && e.status === 409
        ? 'تغيّر الحال قبل الدمج — قد تكون إحدى البطاقتين دُمجت من مكانٍ آخر. حدّث الشاشة وراجِع من جديد.'
        : e instanceof ApiError ? e.message : 'تعذّر الدمج');
    } finally {
      setMergeBusy(false);
    }
  }

  async function doUndo(auditId: string) {
    setUndoBusy(true);
    try {
      await post('/contacts/merge-undo', { auditId });
      toast('رجعَت البطاقتان كما كانتا.');
      setLastMerge(null);
      reloadAll();
      if (openId) void loadDetail(openId);
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409
        ? 'تعذّر التراجع: قد يكون وقع سابقاً، أو تغيّرت البطاقة بعده. حدّث الشاشة لترى الحال.'
        : e instanceof ApiError ? e.message : 'تعذّر التراجع');
    } finally {
      setUndoBusy(false);
    }
  }

  /* سببُ تعطيل الدمج يُكتب لا يُترك للاستنتاج: زرٌّ معطَّلٌ بلا سببٍ يُقرأ عطلاً. */
  const mergeBlock = can.readOnly
    ? 'الانتحال قراءةٌ فقط — لا دمجَ من جلسةٍ منتحَلة'
    : !can.settings
      ? 'الدمج لمالك الحساب — والموظّف يرى الملفّ ولا يدمج'
      : null;

  if (list.loading && !list.data) return <Skeleton rows={6} />;
  if (list.error && !list.data) return <ErrorBox message={list.error} onRetry={list.reload} />;

  const total = dups.data?.total ?? list.data?.total ?? 0;
  const pairs = dups.data?.items ?? [];
  /* ★ حالةُ الفحص تُقرأ **مرّةً** في `lib/contacts`: الشريطُ والبطوليُّ
     يقرآن نفسَ الحكم، فلا يقول أحدهما «نظيف» والآخر «خطير» في نفس الرسم. */
  const read = readDuplicates({
    loading: dups.loading,
    error: Boolean(dups.error),
    scan: dups.data ? { records: dups.data.records, pairs: pairs.length } : null,
    total,
  });

  /* ★ الشريطُ الحاكم يُجيب «في شيء يحتاجني؟» قبل أيّ رقم — ونصُّه **عاقبةٌ**
     لا حالة: «تُجيبه مرّتين» لا «يوجد تكرار».

     ★ وحالةُ «يُفحَص» أوّلاً عمداً: القائمة تصل قبل الفحص، فلو قُرئ غيابُ
     المرشَّحين «لا تكرار» لأضاء الشريطُ أخضرَ على قاعدةٍ لم تُفحَص بعد —
     خبرٌ سارٌّ كاذبٌ يُقرأ في نصف الثانية ويُبنى عليه إغلاقُ الشاشة. */
  const BANDS: Record<typeof read.state, { head: ReactNode; sub: ReactNode }> = {
    scanning: {
      head: 'نفحص قاعدتك بحثاً عن تكرار…',
      sub: 'القائمة أمامك كاملة. والفحصُ يقارن ذيلَ الرقم ومقابضَ القنوات والأسماءَ بعد تسويتها.',
    },
    failed: {
      head: 'تعذّر فحصُ التكرار',
      sub: 'القائمة أمامك كاملة، والفحصُ وحده تعذّر — فلا يُقال إنّها نظيفة. أعِد المحاولة من قسم المرشَّحين.',
    },
    dirty: {
      head: <>على الأرجح <span className="num">{fmt.num(read.records ?? 0)}</span> بطاقةً تكرارٌ لشخصٍ عندك</>,
      sub: 'الزبون الواحد يصير زبونَين: تُجيبه مرّتين، وتُحسب نوافذه مرّتين، ولا يظهر أنّه عميلٌ متكرّر. راجِعها أسفل — والدمج يُراجَع قبل تنفيذه ويمكن التراجع عنه.',
    },
    clean: {
      head: 'لا بطاقةَ مرشَّحةً للدمج',
      sub: 'نقارن الأرقام والمقابض والأسماء بعد تسويتها (الهمزة · التاء المربوطة · الحركات)، ونُنبّه هنا أوّلَ ما يظهر تكرار.',
    },
  };
  const band: { sev: Sev; head: ReactNode; sub: ReactNode } = {
    sev: read.sev,
    ...BANDS[read.state],
  };

  const columns: Array<Column<Summary>> = [
    {
      key: 'who',
      head: 'الجهة',
      /* هويّةُ الصفّ **زرٌّ** لا نصّ: هي مفتاحُ ملفّها، وعنوانُ بطاقتها دون 1100.
         و`dir="auto"` لأنّ الاسم يكتبه الزبون — اتّجاهُه من محتواه. */
      cell: (c) => (
        <button type="button" className="sc-rowbtn" dir="auto" onClick={() => openDetail(c.id)}>
          {nameOf(c)}
        </button>
      ),
    },
    {
      key: 'ch',
      head: 'القنوات',
      cell: (c) => (c.kinds.length
        ? (
          <span className="ct-tags">
            {c.kinds.map((k) => <Pill key={k} tone={chTone(k)} label={chLabel(k)} />)}
            {c.identities > c.kinds.length && (
              <Tag line mark={false} label={`${c.identities} مقابض`} />
            )}
          </span>
        )
        : <Tag line mark={false} label="بلا مقبض" />),
    },
    { key: 'convs', head: 'المحادثات', num: true, cell: (c) => fmt.num(c.conversations) },
    { key: 'seen', head: 'آخر نشاط', cell: (c) => fmt.when(c.lastMessageAt ?? c.lastSeenAt) },
    {
      key: 'flags',
      head: 'حالة',
      cell: (c) => (
        <span className="ct-tags">
          {c.blockedAt && <Tag tone="crit" label="محجوب" />}
          {!c.blockedAt && c.optedOutAt && <Tag tone="warn" label="عدلَ عن المراسلة" />}
          {c.tags.slice(0, 3).map((t) => <Tag key={t} line mark={false} label={t} />)}
          {!c.blockedAt && !c.optedOutAt && !c.tags.length && <span className="ct-dim">—</span>}
        </span>
      ),
    },
  ];

  const topPairs = pairs.slice(0, 5);
  const restPairs = pairs.slice(5);

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="جهات الاتّصال"
        sub="الشخص الواحد عبر قنواته — لا بطاقةً لكلّ قناة."
        actions={<Pill tone="neutral" label={fmt.num(total)} mark={false} />}
      />

      <Band sev={band.sev} head={band.head} sub={band.sub} />

      {/* ★ سطرُ التراجع: يظهر لحظةَ الدمج لا في شاشةٍ أخرى — فالندمُ يقع بعد
          ثانيتين، ومن يبحث عن «تراجَع» في ملفٍّ لا يجده في ثانيتين. */}
      {lastMerge && (
        <Note tone="brand">
          <Row gap="xs">
            <span>دُمِجت <b dir="auto">{lastMerge.label}</b>. والتراجع يُعيد المقابض والمحادثات إلى بطاقتها — والرسائل التي وصلت بعد الدمج تبقى مع محادثتها.</span>
            <Button
              size="sm"
              busy={undoBusy}
              disabled={Boolean(mergeBlock)}
              reason={mergeBlock ?? undefined}
              onClick={() => void doUndo(lastMerge.auditId)}
            >
              تراجَع عن الدمج
            </Button>
          </Row>
        </Note>
      )}

      {/* ★ بطوليٌّ واحدٌ يُختار بالحالة: عددُ البطاقات الزائدة حين توجد، وهو
          رقمٌ يُضغط فيُنزل إلى مرشَّحيه. ولا رقمَ بلا سياقٍ ملاصق. */}
      {/* ★ «—» لا «0» ما لم يُفحَص: الصفرُ دعوى، والشرطةُ غيابُ خبر. */}
      <Hero
        sev={read.sev}
        value={read.records === null ? '—' : fmt.num(read.records)}
        unit={read.records !== null && total ? `/ ${fmt.num(total)}` : undefined}
        label="بطاقةً على الأرجح تكرارٌ لشخصٍ عندك"
        href="#dups"
        ctx={(
          <>
            من أصل <span className="num">{fmt.num(total)}</span> جهة
            {read.pairs > 0 && <> · <span className="num">{fmt.num(read.pairs)}</span> زوجاً مرشَّحاً</>}
            {read.state === 'scanning' && <> · الفحص جارٍ</>}
            {read.state === 'failed' && <> · تعذّر الفحص، والرقم غير معروفٍ الآن</>}
            {' '}· والمقارنة بالرقم والمقبض والاسم بعد تسويته — اقتراحٌ يُراجَع لا دمجٌ آليّ
          </>
        )}
      />

      <Section
        id="dups"
        anchor
        title="مرشَّحو الدمج"
        sub={pairs.length
          ? <><span className="num">{fmt.num(pairs.length)}</span> زوجاً — الأقوى أوّلاً</>
          : 'لا مرشَّح'}
      >
        {dups.loading && !dups.data ? <Skeleton rows={3} /> : null}
        {dups.error && !dups.data ? <ErrorBox message={dups.error} onRetry={dups.reload} /> : null}
        {dups.data && !pairs.length && (
          <Empty
            title="لا بطاقتين تشبهان شخصاً واحداً"
            hint="نقارن ذيلَ الرقم (فـ07 هو نفسه 9627) ومقابضَ القنوات والأسماءَ بعد تسويتها. وحين يظهر تكرارٌ يُقترح هنا، ولا يُدمج شيءٌ بلا مراجعتك."
          />
        )}
        {topPairs.map((p) => (
          <PairRow
            key={`${p.a.id}-${p.b.id}`}
            p={p}
            block={mergeBlock}
            onReview={(k, a) => void openReview(k, a)}
            onOpen={openDetail}
          />
        ))}
        {restPairs.length > 0 && (
          /* الطيُّ التدريجيّ: الأقوى مفتوحٌ، وما دونه يُفتح متى أراد صاحبُه. */
          <Fold summary={`بقيّة المرشَّحين (${restPairs.length})`}>
            {restPairs.map((p) => (
              <PairRow
                key={`${p.a.id}-${p.b.id}`}
                p={p}
                block={mergeBlock}
                onReview={(k, a) => void openReview(k, a)}
                onOpen={openDetail}
              />
            ))}
          </Fold>
        )}
      </Section>

      <Section
        title="كلّ الجهات"
        sub={(
          <>
            <span className="num">{fmt.num(rows.length)}</span> من
            {' '}<span className="num">{fmt.num(total)}</span>
            {qLive ? <> · البحث عن «{qLive}»</> : null}
          </>
        )}
      >
        {!rows.length ? (
          <Empty
            title={qLive || filt !== 'all' ? 'لا جهةَ بهذا المرشِّح' : 'لا جهات بعد'}
            hint={qLive || filt !== 'all'
              ? 'جرّب بحثاً أقصر، أو أعِد المرشِّح إلى «الكلّ» من رصيف الشاشة أسفل. والبحث يشمل الاسم والرقم ومقبض القناة.'
              : 'تُنشأ البطاقة وحدها أوّلَ ما يراسلك زبونٌ على قناةٍ موصولة — فلا إدخالَ يدويّاً هنا.'}
            action={(qLive || filt !== 'all')
              ? <Button size="sm" onClick={() => { setQ(''); setFilt('all'); }}>أعِد إلى الكلّ</Button>
              : undefined}
          />
        ) : (
          <>
            <div className="sc-tbl">
              <Table columns={columns} rows={rows} keyOf={(c) => c.id} onRowClick={(c) => openDetail(c.id)} />
            </div>
            {next && (
              <div className="ct-more">
                <Button busy={moreBusy} onClick={() => void loadMore()}>
                  المزيد
                </Button>
              </div>
            )}
            <p className="muted-p">
              اضغط أيّ صفٍّ ليُفتح ملفُّه: مقابضُه ومحادثاتُه، ومنه إلى المحادثة في الإنبوكس،
              ومنه يُقترح دمجُه إن شابه غيرَه.
            </p>
          </>
        )}
      </Section>

      {/* ★ الرصيف: بحثُ الشاشة ومرشّحاتُها وفعلُها الأوّل في مدى الإبهام. */}
      <ScreenDock hint="البحث يشمل الاسم والرقم والمقبض — و«07…» يجد «+9627…».">
        <div className="ct-search">
          <Field label="ابحث في جهاتك" id="ct-q">
            <Input
              id="ct-q"
              type="search"
              value={q}
              onChange={setQ}
              placeholder="اسمٌ أو رقمٌ أو مقبض"
            />
          </Field>
        </div>
        <ChipRow label="مرشّحات">
          {FILTS.map((c) => (
            <button
              key={c.f}
              type="button"
              className="chipf"
              aria-pressed={filt === c.f}
              onClick={() => setFilt(c.f)}
            >
              {c.label}
            </button>
          ))}
        </ChipRow>
        <Button
          variant="primary"
          size="lg"
          wide
          disabled={!topPairs.length || Boolean(mergeBlock)}
          reason={!topPairs.length ? 'لا مرشَّحَ لمراجعته' : mergeBlock ?? undefined}
          onClick={() => {
            const p = topPairs[0];
            if (!p) return;
            const { keep, absorb } = sidesOf(p.a, p.b, p.suggestKeep);
            void openReview(keep.id, absorb.id);
          }}
        >
          راجِع أقوى مرشَّح
        </Button>
      </ScreenDock>

      {/* ══════════════ ورقةُ ملفّ الجهة ══════════════ */}
      <Sheet
        open={Boolean(openId)}
        title="ملفُّ جهة"
        onClose={() => { setOpenId(null); setDetail(null); }}
        hint="محادثةٌ لكلّ قناة — والنافذة تتبع المحادثة، فالفوترة لكلّ قناة لا لكلّ إنسان."
        footer={<Button variant="quiet" onClick={() => { setOpenId(null); setDetail(null); }}>أغلِق</Button>}
      >
        {detailBusy && <Skeleton rows={4} />}
        {detailErr && <ErrorBox message={detailErr} onRetry={() => { if (openId) void loadDetail(openId); }} />}
        {detail && (
          <Stack gap="md">
            <KV>
              <KVRow k="الاسم"><span dir="auto">{nameOf(detail.contact)}</span></KVRow>
              {/* ★ الحالةُ نصٌّ وشكلٌ لا لونٌ وحده: «محجوب» قرارُ المالك،
                  و«عدل» قرارُ الزبون — وخلطُهما يجعل موظّفاً يرفع حجباً ظنّه
                  عدولاً. والزرُّ يقول الفعلَ المعاكس لما هو قائم. */}
              <KVRow k="المراسلة">
                <Row gap="sm">
                  {detail.contact.blockedAt ? (
                    <Pill tone="crit" label="محجوبٌ من حسابكم" />
                  ) : detail.contact.optedOutAt ? (
                    <Pill tone="warn" label="عدل عن المراسلة" />
                  ) : (
                    <Pill tone="ok" label="يُراسَل" />
                  )}
                  {perms.write && !perms.readOnly && (
                    <>
                      {detail.contact.optedOutAt ? (
                        <Button size="sm" busy={flagBusy === 'optin'} onClick={() => void setFlag(detail.contact.id, 'optin')}>
                          أعِد الاشتراك
                        </Button>
                      ) : !detail.contact.blockedAt && (
                        <Button size="sm" busy={flagBusy === 'optout'} onClick={() => void setFlag(detail.contact.id, 'optout')}>
                          سجّل عدولاً
                        </Button>
                      )}
                      {detail.contact.blockedAt ? (
                        <Button size="sm" busy={flagBusy === 'unblock'} onClick={() => void setFlag(detail.contact.id, 'unblock')}>
                          ارفع الحجب
                        </Button>
                      ) : (
                        <Button size="sm" variant="danger" busy={flagBusy === 'block'} onClick={() => void setFlag(detail.contact.id, 'block')}>
                          احجب الرقم
                        </Button>
                      )}
                    </>
                  )}
                </Row>
              </KVRow>
              {detail.contact.phone && (
                <KVRow k="الرقم"><span className="mono">{detail.contact.phone}</span></KVRow>
              )}
              <KVRow k="أوّل ظهور">{fmt.when(detail.contact.firstSeenAt)}</KVRow>
              <KVRow k="آخر نشاط">{fmt.when(detail.contact.lastMessageAt ?? detail.contact.lastSeenAt)}</KVRow>
              <KVRow k="المحادثات"><span className="num">{fmt.num(detail.conversations.length)}</span></KVRow>
              <KVRow k="نوافذُ فُوتِرت">
                <span className="num">{fmt.num(detail.windows.billed)}</span>
                {' '}من <span className="num">{fmt.num(detail.windows.opened)}</span>
              </KVRow>
              {detail.windows.aiCostUsd !== null && (
                <KVRow k="كلفةُ الذكاء">
                  <span className="num">{fmt.money(detail.windows.aiCostUsd)}</span>
                </KVRow>
              )}
              {detail.contact.tags.length > 0 && (
                <KVRow k="الوسوم">
                  <span className="ct-tags">
                    {detail.contact.tags.map((t) => <Tag key={t} line mark={false} label={t} />)}
                  </span>
                </KVRow>
              )}
              {detail.contact.optedOutAt && (
                <KVRow k="المراسلة"><Tag tone="warn" label="عدلَ عن المراسلة" /></KVRow>
              )}
              {detail.contact.blockedAt && (
                <KVRow k="الحجب"><Tag tone="crit" label="محجوب" /></KVRow>
              )}
            </KV>

            <Section title="مقابضُه" sub={<span className="num">{fmt.num(detail.identities.length)}</span>}>
              <div className="ct-ids">
                {detail.identities.map((i) => (
                  <div className="ct-id" key={i.id}>
                    <span className="ct-id-k">
                      <Pill tone={chTone(i.channelKind)} label={chLabel(i.channelKind)} />
                      {i.channelName && <span className="ct-dim" dir="auto">{i.channelName}</span>}
                    </span>
                    <span className="ct-id-v mono">{i.externalId}</span>
                    {i.displayHandle && <span className="ct-dim" dir="auto">{i.displayHandle}</span>}
                    <span className="ct-dim">وصل أوّلَ مرّة {fmt.when(i.firstSeenAt)}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="محادثاتُه" sub={<span className="num">{fmt.num(detail.conversations.length)}</span>}>
              {!detail.conversations.length ? (
                <Empty
                  title="بطاقةٌ بلا محادثة"
                  hint="مقبضٌ سُجِّل ولم تبدأ عليه محادثةٌ بعد — أو محادثتُه انتقلت إلى بطاقةٍ أخرى بدمج."
                />
              ) : (
                <div className="ct-convs">
                  {detail.conversations.map((v) => (
                    <div className="ct-conv" key={v.id}>
                      <span className="ct-conv-h">
                        <Pill tone={chTone(v.channelKind)} label={chLabel(v.channelKind)} />
                        <span className="mono">{v.handle}</span>
                        {v.needsAttention && <Tag tone="warn" label="تحتاج ردّاً" />}
                        {v.status === 'closed' && <Tag line mark={false} label="مغلقة" />}
                      </span>
                      {v.preview && <span className="ct-conv-p" dir="auto">{v.preview}</span>}
                      <span className="ct-conv-m">
                        <span className="num">{fmt.num(v.messages)}</span> رسالة ·
                        {' '}آخرها {fmt.when(v.lastMessageAt)}
                      </span>
                      <Link className="ct-open" href={`/app/inbox?c=${v.id}`}>
                        افتح المحادثة في الإنبوكس ←
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {detail.candidates.length > 0 && (
              <Section
                title="يشبهه في قاعدتك"
                sub={<span className="num">{fmt.num(detail.candidates.length)}</span>}
              >
                <Rows>
                  {detail.candidates.map((c) => (
                    <MetricRow
                      key={c.other.id}
                      k={<span dir="auto">{nameOf(c.other)}</span>}
                      note={whyText(c.why, c.score)}
                      value={fmt.num(c.other.conversations)}
                      unit="محادثة"
                      mid={(
                        <span className="sc-ctx">
                          {c.other.kinds.map((k) => <Pill key={k} tone={chTone(k)} label={chLabel(k)} />)}
                          {' '}آخر نشاط {fmt.when(c.other.lastMessageAt ?? c.other.lastSeenAt)}
                        </span>
                      )}
                      onClick={() => {
                        const { keep, absorb } = sidesOf(detail.contact, c.other, c.suggestKeep);
                        void openReview(keep.id, absorb.id);
                      }}
                    />
                  ))}
                </Rows>
                <p className="muted-p">
                  الضغط يفتح ورقةَ المراجعة لا الدمج — ترى ما سينتقل ثمّ تقرّر.
                </p>
              </Section>
            )}

            {detail.history.length > 0 && (
              <Section title="ما جرى على هذه البطاقة" sub={<span className="num">{fmt.num(detail.history.length)}</span>}>
                <div className="ct-hist">
                  {detail.history.map((h) => (
                    <div className="ct-hist-i" key={h.id}>
                      <span className="ct-hist-t">
                        {h.action === 'contact.merge' ? 'دمجٌ' : h.action === 'contact.merge_undo' ? 'تراجعٌ عن دمج' : h.action}
                        {h.label && <> · <span dir="auto">{h.label}</span></>}
                      </span>
                      <span className="ct-dim">
                        {fmt.when(h.at)}
                        {h.actor && <> · <span dir="auto">{h.actor}</span></>}
                      </span>
                      {h.undoable && (
                        <Button
                          size="sm"
                          busy={undoBusy}
                          disabled={Boolean(mergeBlock)}
                          reason={mergeBlock ?? undefined}
                          onClick={() => void doUndo(h.id)}
                        >
                          تراجَع عنه
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </Stack>
        )}
      </Sheet>

      {/* ══════════════ ورقةُ مراجعة الدمج — القيد ① ══════════════ */}
      <Sheet
        open={reviewOpen}
        title="مراجعةُ الدمج"
        onClose={() => { setReviewOpen(false); setPlan(null); }}
        hint={plan?.reversible
          ? 'المحادثتان تبقيان مرئيّتين منفصلتين تحت بطاقةٍ واحدة — ولا رسالةَ تُفقد. والدمج يُسجَّل، ويمكن التراجع عنه.'
          : 'راجِع ما سينتقل قبل أن تدمج.'}
        footer={plan
          ? (
            <Row gap="xs">
              <Button
                variant="primary"
                size="lg"
                busy={mergeBusy}
                disabled={Boolean(mergeBlock)}
                reason={mergeBlock ?? undefined}
                onClick={() => void doMerge()}
              >
                ادمِجهما
              </Button>
              <Button
                onClick={() => void openReview(plan.absorb.id, plan.keep.id)}
              >
                اقلِب: أبقِ «{nameOf(plan.absorb)}»
              </Button>
              <Button variant="quiet" onClick={() => { setReviewOpen(false); setPlan(null); }}>ألغِ</Button>
            </Row>
          )
          : undefined}
      >
        {planBusy && <Skeleton rows={4} />}
        {planErr && <ErrorBox message={planErr} />}
        {plan && (
          <Stack gap="md">
            <div className="ct-sides">
              <div className="ct-side ct-side-keep">
                <span className="ct-side-r">تبقى هذه البطاقة</span>
                <span className="ct-side-n" dir="auto">{nameOf(plan.keep)}</span>
                <span className="ct-side-m">
                  {plan.keep.phone && <span className="mono">{plan.keep.phone}</span>}
                  {plan.keep.kinds.map((k) => <Pill key={k} tone={chTone(k)} label={chLabel(k)} />)}
                </span>
                <span className="ct-side-m">
                  <span className="num">{fmt.num(plan.keep.conversations)}</span> محادثة ·
                  {' '}<span className="num">{fmt.num(plan.keep.identities)}</span> مقبضاً
                </span>
              </div>
              <span aria-hidden="true" className="ct-vs">←</span>
              <div className="ct-side">
                <span className="ct-side-r">تُدمَج فيها وتزول بطاقتُها</span>
                <span className="ct-side-n" dir="auto">{nameOf(plan.absorb)}</span>
                <span className="ct-side-m">
                  {plan.absorb.phone && <span className="mono">{plan.absorb.phone}</span>}
                  {plan.absorb.kinds.map((k) => <Pill key={k} tone={chTone(k)} label={chLabel(k)} />)}
                </span>
                <span className="ct-side-m">
                  <span className="num">{fmt.num(plan.absorb.conversations)}</span> محادثة ·
                  {' '}<span className="num">{fmt.num(plan.absorb.identities)}</span> مقبضاً
                </span>
              </div>
            </div>

            <Section
              title="ما ينتقل"
              sub={(
                <>
                  <span className="num">{fmt.num(plan.moves.messages)}</span> رسالةً في
                  {' '}<span className="num">{fmt.num(plan.moves.conversations.length)}</span> محادثة
                </>
              )}
            >
              {!plan.moves.identities.length && !plan.moves.conversations.length ? (
                <Note tone="warn">
                  لا مقبضَ ولا محادثةَ على البطاقة المُدمَجة — الدمجُ هنا يوحّد بطاقةً فارغةً
                  ولا ينقل تاريخاً.
                </Note>
              ) : (
                <div className="ct-mv">
                  {plan.moves.identities.map((i) => (
                    <div className="ct-mv-i" key={i.id}>
                      <Pill tone={chTone(i.channelKind)} label={chLabel(i.channelKind)} />
                      <span className="mono">{i.externalId}</span>
                      <span className="ct-dim">مقبضٌ ينتقل — الرسائل القادمة إليه تصل للبطاقة الموحَّدة</span>
                    </div>
                  ))}
                  {plan.moves.conversations.map((v) => (
                    <div className="ct-mv-i" key={v.id}>
                      <Pill tone={chTone(v.channelKind)} label={chLabel(v.channelKind)} />
                      <span className="mono">{v.handle}</span>
                      <span className="ct-dim">
                        <span className="num">{fmt.num(v.messages)}</span> رسالةً تبقى في محادثتها ·
                        {' '}آخرها {fmt.when(v.lastMessageAt)}
                      </span>
                    </div>
                  ))}
                  {plan.moves.windows > 0 && (
                    <div className="ct-mv-i">
                      <Tag line mark={false} label="فوترة" />
                      <span className="ct-dim">
                        <span className="num">{fmt.num(plan.moves.windows)}</span> نافذةَ فوترةٍ تنتقل
                        معها — السجلُّ الماليّ لا يُمحى بدمج
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Section>

            {plan.fields.length > 0 && (
              <Section title="ما يتغيّر على البطاقة الباقية" sub={<span className="num">{fmt.num(plan.fields.length)}</span>}>
                <div className="ct-flds">
                  {plan.fields.map((f) => (
                    <div className="ct-fld" key={f.k}>
                      <span className="ct-fld-k">{f.label}</span>
                      {/* ★ طرفان **عازلان مستقلّان** لا مدًى واحدٌ بـ`dir="auto"`:
                          المدى الواحد يأخذ اتّجاهَه من أوّل حرفٍ قويٍّ فيه، و
                          «2025-08-14T09:12Z» فيها `T` و`Z` — فينقلب السطرُ كلُّه
                          إلى LTR ويصير «ما سيصير» قبل «ما كان» في صفٍّ واحدٍ
                          بين صفوفٍ عربيّة. والاتّجاهُ يجب أن يكون اتّجاهَ الصفحة
                          دائماً، والمحتوى وحده يُعزَل. */}
                      <span className="ct-fld-v">
                        <span dir="auto">{fieldValue(f.k, f.was)}</span>
                        <span aria-hidden="true" className="ct-fld-ar">←</span>
                        <b dir="auto">{fieldValue(f.k, f.now)}</b>
                      </span>
                      <span className="ct-fld-w">{f.why}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {plan.optout && (
              <Note tone="warn">
                البطاقة المُدمَجة <b>عدلَت عن المراسلة</b>. والعدولُ يسري على الإنسان لا على
                مقبضه، فيبقى سارياً على البطاقة الموحَّدة بعد الدمج.
              </Note>
            )}

            <Note tone="brand">
              الدمج <b>يُسجَّل</b> باسمك ووقته في سجلّ الحساب، و<b>يمكن التراجع عنه</b>: تعود
              المقابضُ والمحادثاتُ ونوافذُ الفوترة إلى بطاقتها. والرسائل التي تصل بعد الدمج
              تبقى مع محادثتها — وهي تعود معها.
            </Note>
          </Stack>
        )}
      </Sheet>
    </Stack>
  );
}
