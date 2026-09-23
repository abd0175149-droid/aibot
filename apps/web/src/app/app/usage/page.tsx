'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { download, get, ApiError } from '@/lib/api';
import {
  PageHead, Stack, Row, Pill, Tag, Note, Meter, Button, Sheet, Table, Empty,
  Skeleton, ErrorBox, KV, KVRow, type Column, type Tone,
} from '@/components/ui';
import { Band, Hero, Section, Rows, MetricRow, Fold, ScreenDock, ChipRow, type Sev } from '@/components/screen';

/**
 * الاستهلاك.
 *
 * ★ المبدأ الذي يحكم الشاشة: **الرقم وأصله معاً.** هذا هو جدول النوافذ نفسه
 *   الذي تُفوتَر عليه، لا ملخّصاً مشتقّاً منه — فالرقم المجرَّد يُناقَش، والرقم
 *   الذي ترى صفوفه يُقبَل. ولذلك التصدير هنا لا في مكانٍ آخر.
 *
 * ★ وصفّ «لم تُفوتَر» هو أهمّ صفٍّ في الجدول: رسالةٌ لم يردّ عليها أحدٌ لا
 *   تُحسب. إظهاره يحوّل الفوترة من ادّعاءٍ إلى حساب.
 *
 * ── ما أُصلح في هذه المرحلة ────────────────────────────────────────────────
 *  ① **البطوليُّ كان مشروطاً بـ`pct >= 0.8`** — فطوال ثلاثة أرباع الشهر تُفتح
 *    الشاشةُ على أربعة أرقامٍ متساوية الوزن لا تقول أيَّها يهمّ. والآن بطوليٌّ
 *    **دائماً**، ويتبدّل بالحالة: الرقمُ المُفوتَر ما دامت الوتيرة آمنة،
 *    و**إسقاطُ** الوتيرة حين يتجاوز السقفَ — لأنّ الخبر عندها هو الإسقاط.
 *  ② **الجدول كان بلا فرزٍ ولا مجموعٍ ولا مخرجٍ إلى المحادثة.** فصار: رأسٌ
 *    لاصقٌ (من انقلاب `Table`)، وفرزٌ بعقدةٍ واحدةٍ تعمل على كلّ عرض (ورقةٌ
 *    صاعدة لا منسدلة)، ومجموعٌ يُطابَق بالفاتورة، وصفٌّ يفتح محادثته فعلاً.
 *  ③ **«2025-09» كان يُقرأ «09-2025»** في `Pill` — أُصلح في طبقة المكوّنات
 *    (`Iso` يعزل سلسلةَ الآلة ويترك الوسمَ العربيّ)، وتُحقَّق منه هنا: الشريحةُ
 *    تعرض `data.period` كما هو، والعزلُ يجري في المكوّن لا في صنفٍ خاصٍّ بشاشة.
 */

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

/** عتبةٌ أُنذر بها فعلاً — من `quota_alerts`، لا مستنتَجةٌ من النسبة. */
interface QuotaAlert {
  threshold: number;
  firedAt: string;
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
  /** نصُّ العاقبة من الخادم — نفسُ نصّ الإشعار، فلا نسختان تتباعدان. */
  capConsequence: string;
  quotaAlerts: QuotaAlert[];
  items: Window[];
}

const CH: Record<string, { label: string; tone: Tone }> = {
  whatsapp_cloud: { label: 'واتساب', tone: 'brand' },
  instagram: { label: 'إنستجرام', tone: 'violet' },
};

type SortKey = 'open' | 'who' | 'msgs' | 'cost';

const SORTS: Array<{ k: SortKey; label: string }> = [
  { k: 'open', label: 'وقت الفتح' },
  { k: 'who', label: 'الزبون' },
  { k: 'msgs', label: 'عدد الرسائل' },
  { k: 'cost', label: 'كلفة الذكاء' },
];

type Filt = 'all' | 'billed' | 'free' | 'whatsapp_cloud' | 'instagram';

const FILTS: Array<{ f: Filt; label: string }> = [
  { f: 'all', label: 'الكلّ' },
  { f: 'billed', label: 'مُفوترة' },
  { f: 'free', label: 'بلا ردٍّ — لم تُفوتَر' },
];

export default function UsagePage() {
  const router = useRouter();
  const { data, loading, error, reload } = useApi<Usage>('/usage');
  const { toast, node: toastNode } = useToast();
  const [exporting, setExporting] = useState(false);
  const [filt, setFilt] = useState<Filt>('all');
  const [sortK, setSortK] = useState<SortKey>('open');
  const [dir, setDir] = useState<1 | -1>(-1);
  const [sortOpen, setSortOpen] = useState(false);
  const [detail, setDetail] = useState<Window | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [going, setGoing] = useState(false);

  /**
   * ★ الفرزُ والترشيحُ **على الصفوف المعروضة** لا على الفاتورة: الخادم يعيد
   *   آخر 200 نافذة، والمجموعُ المُفوتَر يأتي منه مجموعاً لا من جمعِ الصفوف.
   *   فلا يُقرأ مجموعُ الصفحة مجموعَ الشهر — ورأسُ القسم يقول ذلك صراحةً.
   */
  const view = useMemo(() => {
    const src = data?.items ?? [];
    const kept = src.filter((w) => {
      if (filt === 'billed') return Boolean(w.billedAt);
      if (filt === 'free') return !w.billedAt;
      if (filt === 'whatsapp_cloud' || filt === 'instagram') return w.channelKind === filt;
      return true;
    });
    return [...kept].sort((a, b) => {
      const x = sortK === 'who'
        ? (a.contactName ?? a.handle).localeCompare(b.contactName ?? b.handle, 'ar')
        : sortK === 'msgs'
          ? (a.messagesIn + a.messagesOut) - (b.messagesIn + b.messagesOut)
          : sortK === 'cost'
            ? Number(a.aiCostUsd) - Number(b.aiCostUsd)
            : new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime();
      return x * dir;
    });
  }, [data, filt, sortK, dir]);

  async function exportCsv() {
    setExporting(true);
    try {
      await download('/usage/windows.csv', `aibot-windows-${data?.period ?? 'export'}.csv`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر التصدير');
    } finally {
      setExporting(false);
    }
  }

  /**
   * ★ «لا سطرَ فاتورةٍ بلا دليلٍ تقرؤه بعينك.» وسجلُّ النوافذ لا يحمل معرّفَ
   *   المحادثة، فيُوصَل بما هو موجودٌ فعلاً: بحثُ الإنبوكس نفسِه بمقبض الزبون،
   *   ثمّ عنوانٌ مباشرٌ إلى المحادثة. وإن لم تُوجد (نافذةٌ أقدمُ من المحفوظ)
   *   يُقال ذلك — ولا يُفتح إنبوكسٌ فارغٌ يُقرأ عطلاً.
   */
  async function openConversation(w: Window) {
    setGoing(true);
    try {
      const r = await get<{ items: Array<{ id: string; handle: string; channelKind: string }> }>(
        `/conversations?q=${encodeURIComponent(w.handle)}`,
      );
      const hit = r.items.find((c) => c.handle === w.handle && c.channelKind === w.channelKind)
        ?? r.items.find((c) => c.handle === w.handle);
      if (!hit) {
        toast('لم نجد محادثةً بهذا المقبض — قد تكون أقدم من المحادثات المحفوظة. نزِّل الجدول لتراها كاملة.');
        return;
      }
      setDetailOpen(false);
      router.push(`/app/inbox?c=${hit.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر فتح المحادثة');
    } finally {
      setGoing(false);
    }
  }

  function applySort(k: SortKey) {
    if (k === sortK) setDir((d) => (d === 1 ? -1 : 1));
    else { setSortK(k); setDir(-1); }
    setSortOpen(false);
  }

  function openDetail(w: Window) {
    setDetail(w);
    setDetailOpen(true);
  }

  if (loading) return <Skeleton rows={5} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const pct = data.windowsLimit ? data.windowsBilled / data.windowsLimit : 0;
  const unbilled = data.windowsOpened - data.windowsBilled;
  const tokPct = data.aiTokensLimit ? data.aiTokens / data.aiTokensLimit : 0;

  /**
   * ★ الإسقاط يُحسب ولا يُخترع: يومُ الشهر وطولُه معروفان، والوتيرةُ قسمةٌ.
   *   وشرطُه أن يكون **شهرَ الفاتورة هو الشهر الجاري** — وإلّا فالإسقاط كذبٌ
   *   على شهرٍ انتهى، فيُسقط السياق ولا يُلفَّق.
   */
  const now = new Date();
  const thisPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pace = data.period === thisPeriod && dayOfMonth > 0
    ? Math.round((data.windowsBilled / dayOfMonth) * daysInMonth)
    : null;
  const monthPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const atCap = pct >= 1;
  const paceOver = pace !== null && data.windowsLimit > 0 && pace > data.windowsLimit;

  /**
   * ★ **حالةُ العتبة** — وهي ما كان ناقصاً من هذه الشاشة.
   *
   * كانت العتباتُ 80٪ و95٪ غائبةً هنا تماماً: الشريطُ يعرف «تجاوزتَ السقف»
   * و«وتيرتك تتجاوزه»، فيُفتح على 88٪ من السقف بشريطٍ **أخضر** ما دامت الوتيرة
   * تُنهي الشهر تحته. والعميلُ يقرأ الأخضر طمأنينةً وهو على بعد اثنتي عشرة
   * نافذةً من الصمت.
   *
   * و`hit` تُقرأ من الخادم لا تُستنتج من النسبة: «أنذرناك عند 80٪» تقولها
   * الشاشةُ فقط إن أُرسل الإنذار فعلاً — وإلّا فهي تُغطّي عطلاً في الدفع
   * بادّعاءٍ مطمئن، وهو أسوأ ما يمكن أن تفعله شاشةُ فاتورة.
   */
  const alerts = data.quotaAlerts ?? [];
  const hit = alerts.length ? alerts[alerts.length - 1]! : null; // مرتّبةٌ تصاعديّاً من الخادم
  const near = pct >= 0.8;

  const perWindow = data.windowsBilled ? data.aiCostUsd / data.windowsBilled : null;

  const sum = view.reduce(
    (a, w) => ({
      msgs: a.msgs + w.messagesIn + w.messagesOut,
      cost: a.cost + Number(w.aiCostUsd),
      billed: a.billed + (w.billedAt ? 1 : 0),
    }),
    { msgs: 0, cost: 0, billed: 0 },
  );

  /* مرشّحاتُ القناة لا تُعرض إلّا لقناةٍ لها صفوفٌ فعلاً — مرشّحٌ يُرجع صفراً دائماً عطل */
  const kinds = [...new Set(data.items.map((w) => w.channelKind))];
  const chips: Array<{ f: Filt; label: string }> = [
    ...FILTS,
    ...kinds
      .filter((k): k is 'whatsapp_cloud' | 'instagram' => k === 'whatsapp_cloud' || k === 'instagram')
      .map((k) => ({ f: k as Filt, label: CH[k]?.label ?? k })),
  ];

  /* ★ ترتيبُ الشريط: **ما وقع** يسبق ما يُتوقَّع. السقفُ المبلوغ أوّلاً، ثمّ
     العتبةُ المعبورة (خبرٌ واقعٌ اليوم)، ثمّ الوتيرة (إسقاطٌ قد لا يقع). وكان
     الإسقاطُ يسبق العتبة، فيُقرأ «تُنهي الشهر تحت سقفك» على 88٪. */
  const band: { sev: Sev; head: ReactNode; sub: ReactNode } = atCap
    ? {
      sev: 'bad',
      head: <>بلغتَ سقف باقتك: <span className="num">{fmt.num(data.windowsBilled)}</span> من <span className="num">{fmt.num(data.windowsLimit)}</span></>,
      sub: <>
        {data.capConsequence}
        {hit && <> · وأنذرناك عند <span className="num">{`${hit.threshold}%`}</span> {fmt.when(hit.firedAt)}</>}
      </>,
    }
    : near
      ? {
        sev: pct >= 0.95 ? 'bad' : 'warn',
        head: <>استهلكتَ <span className="num">{fmt.pct(pct)}</span> من نوافذ باقتك</>,
        sub: <>
          {data.capConsequence}
          {hit && <> · وأنذرناك عند <span className="num">{`${hit.threshold}%`}</span> {fmt.when(hit.firedAt)}</>}
        </>,
      }
      : paceOver
      ? {
        sev: 'bad',
        head: 'بهذه الوتيرة تتجاوز سقفك قبل آخر الشهر',
        sub: <>
          السقف <span className="num">{fmt.num(data.windowsLimit)}</span> ·
          {' '}المستهلَك <span className="num">{fmt.num(data.windowsBilled)}</span> ·
          {' '}ومضى <span className="num">{`${monthPct}%`}</span> من الشهر
        </>,
      }
      : {
        sev: 'good',
        head: pace !== null
          ? <>بهذه الوتيرة تُنهي الشهر عند <span className="num">{fmt.num(pace)}</span> نافذة — تحت سقفك</>
          : <>المستهلَك <span className="num">{fmt.num(data.windowsBilled)}</span> من <span className="num">{fmt.num(data.windowsLimit)}</span></>,
        sub: <>
          السقف <span className="num">{fmt.num(data.windowsLimit)}</span> ·
          {' '}ومضى <span className="num">{`${monthPct}%`}</span> من الشهر ·
          {' '}والنافذةُ لا تُفوتَر إلّا إذا ردَّ فيها أحد
        </>,
      };

  const columns: Array<Column<Window>> = [
    {
      key: 'who',
      head: 'الزبون',
      /* اسمٌ يكتبه الزبون — اتّجاهه من محتواه، ولا مونو عليه (بلا تغطيةٍ عربيّة).
         وهو **زرٌّ** لا نصّ: هويّةُ الصفّ هي مفتاحُ تفصيله، ونقرُ `<tr>` وحده
         فعلٌ للفأرة فقط — بلا تركيزٍ بالمفتاح ولا نطقٍ للقارئ الصوتيّ. */
      cell: (w) => (
        <button type="button" className="sc-rowbtn" dir="auto" onClick={() => openDetail(w)}>
          {w.contactName ?? w.handle}
        </button>
      ),
    },
    {
      key: 'ch',
      head: 'القناة',
      cell: (w) => <Pill tone={CH[w.channelKind]?.tone ?? 'neutral'} label={CH[w.channelKind]?.label ?? w.channelKind} />,
    },
    { key: 'open', head: 'فُتحت', cell: (w) => fmt.when(w.openedAt) },
    {
      key: 'billed',
      head: 'فُوتِرت',
      cell: (w) => (w.billedAt
        ? fmt.when(w.billedAt)
        : <Pill tone="neutral" label="لم تُفوتَر — لا ردّ" />),
    },
    { key: 'msgs', head: 'رسائل', num: true, cell: (w) => w.messagesIn + w.messagesOut },
    { key: 'cost', head: 'كلفة الذكاء', num: true, cell: (w) => fmt.money(w.aiCostUsd) },
  ];

  const sortLabel = SORTS.find((s) => s.k === sortK)?.label ?? '';

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="الاستهلاك"
        sub="هذا هو جدول النوافذ نفسه الذي تُفوتَر عليه — لا ملخّصاً مشتقّاً منه."
        actions={<Pill tone="neutral" label={data.period} mark={false} />}
      />

      <Band sev={band.sev} head={band.head} sub={band.sub} />

      {/* ★ بطوليٌّ **واحدٌ دائماً**، يُختار بالحالة لا بعتبةٍ تُظهره وتُخفيه:
          ما دامت الوتيرة آمنةً فالخبرُ هو الرقم المُفوتَر (وعليه تُبنى الفاتورة)،
          وحين تتجاوز الوتيرةُ السقفَ فالخبرُ هو الإسقاط — لا الرقمُ الحاليّ. */}
      {paceOver && !atCap ? (
        <Hero
          sev="warn"
          value={fmt.num(pace)}
          label={<>نافذةً تُنهي بها الشهر بهذه الوتيرة — وسقفك <span className="num">{fmt.num(data.windowsLimit)}</span></>}
          ctx={(
            <>
              المستهلَك الآن <span className="num">{fmt.num(data.windowsBilled)}</span> في
              {' '}<span className="num">{fmt.num(dayOfMonth)}</span> يوماً ·
              {' '}أي <span className="num">{(data.windowsBilled / dayOfMonth).toFixed(1)}</span> نافذةً في اليوم
            </>
          )}
        />
      ) : (
        <Hero
          sev={atCap ? 'bad' : pct >= 0.95 ? 'warn' : 'plain'}
          value={fmt.num(data.windowsBilled)}
          unit={`/ ${fmt.num(data.windowsLimit)}`}
          label="نافذةً مُفوترةً هذا الشهر"
          ctx={(
            <>
              <span className="num">{fmt.pct(pct)}</span> من سقفك ·
              {' '}ومضى <span className="num">{`${monthPct}%`}</span> من الشهر
              {pace !== null && <> · وتيرتك تُنهي الشهر عند <span className="num">{fmt.num(pace)}</span></>}
              {perWindow !== null && <> · وكلفةُ الذكاء <span className="num">{fmt.money(perWindow)}</span> للنافذة</>}
            </>
          )}
        />
      )}

      <Section title="على ماذا تُحاسَب" sub="النافذةُ وحدةُ الفوترة، لا الرسالة">
        <Rows>
          <MetricRow
            k="نوافذُ فُتحت"
            note="الزبون كتب، فبدأت نافذةُ 24 ساعة"
            value={fmt.num(data.windowsOpened)}
            mid={(
              <span className="sc-ctx">
                منها <span className="num">{fmt.num(unbilled)}</span> لم تُفوتَر — لم يردّ فيها أحد
              </span>
            )}
          />

          {/* ★ سجلُّ الإنذار صفٌّ مستقلّ: الشريطُ يقول آخرَ عتبةٍ وحدها ويختفي
              حين يُحلّ ما هو أعجل، والسجلُّ يبقى. و«لم تبلغ عتبةً بعد» خبرٌ
              نافع لا فراغ: يقول إنّ النظام يراقب، فلا يُقرأ الصمتُ عطلاً.
              وترميزٌ مزدوج: وسمٌ بلونٍ **ومعه** نصُّه، لا لونٌ وحده. */}
          <MetricRow
            k="إنذاراتُ السقف — هذه الدورة"
            note="مرّةً واحدةً لكلّ عتبةٍ في الشهر، وتتصفّر مع الدورة الجديدة"
            value={hit ? `${hit.threshold}%` : '—'}
            mid={alerts.length
              ? (
                <span className="sc-ctx">
                  {alerts.map((a) => (
                    <span key={a.threshold}>
                      {' '}
                      <Tag
                        tone={a.threshold >= 100 ? 'crit' : a.threshold >= 95 ? 'serious' : 'warn'}
                        label={`${a.threshold}% · ${fmt.when(a.firedAt)}`}
                      />
                    </span>
                  ))}
                </span>
              )
              : (
                <span className="sc-ctx">
                  لم تبلغ عتبةً بعد — نُنذرك عند <span className="num">80%</span> و
                  <span className="num">95%</span> و<span className="num">100%</span> من سقفك
                </span>
              )}
          />

          <MetricRow
            k="كلفةُ الذكاء — المجموع"
            note="ما دفعناه نحن للنموذج بسبب محادثاتك"
            value={fmt.money(data.aiCostUsd)}
            mid={perWindow !== null
              ? (
                <span className="sc-ctx">
                  وسطيّاً <span className="num">{fmt.money(perWindow)}</span> للنافذة الواحدة
                </span>
              )
              : <span className="sc-ctx">لا نافذةَ مُفوترةً بعد</span>}
          />

          <MetricRow
            k="توكناتُ الذكاء"
            note="حسابٌ ثانٍ مستقلٌّ عن النوافذ، وله سقفُه"
            value={(data.aiTokens / 1e6).toFixed(1)}
            unit="M"
            mid={data.aiTokensLimit
              ? (
                <>
                  <span className="sc-mw"><Meter pct={tokPct} /></span>
                  <span className="sc-ctx">
                    من <span className="num">{`${(data.aiTokensLimit / 1e6).toFixed(0)}M`}</span> ·
                    {' '}<span className="num">{fmt.pct(tokPct)}</span>
                  </span>
                </>
              )
              : <span className="sc-ctx">بلا سقفٍ في باقتك</span>}
          />

          <MetricRow
            k="متوسّطُ الردود في النافذة"
            note="كم رسالةً يرسل بوتك قبل أن تُغلق"
            value={data.avgRepliesPerWindow.toFixed(1)}
            mid={<Tag line mark={false} label="نافذةٌ واحدةٌ مهما كثرت الرسائل فيها" />}
          />
        </Rows>
      </Section>

      <Section
        title="أصل الرقم"
        sub={(
          <>
            <span className="num">{fmt.num(view.length)}</span> من
            {' '}<span className="num">{fmt.num(data.windowsOpened)}</span> نافذة —
            {' '}والباقي في الملفّ الذي تنزّله
          </>
        )}
        actions={data.items.length
          ? (
            /* ★ الفرزُ **بعقدةٍ واحدةٍ تعمل على كلّ عرض**: رأسُ العمود يختفي دون
               1100 حين ينقلب الجدولُ بطاقات، فلو كان الفرزُ فيه وحده لسقطت
               قدرةٌ كاملةٌ على الهاتف — وهو الجهاز المُعلَن أوّلاً. */
            <Button size="sm" onClick={() => setSortOpen(true)}>
              رتِّب: {sortLabel}{dir < 0 ? ' ↓' : ' ↑'}
            </Button>
          )
          : undefined}
      >
        {!data.items.length ? (
          <Empty
            title="لا نوافذ هذا الشهر"
            hint="ستظهر هنا أوّل ما يراسلك زبونٌ ويردّ عليه بوتك. والنافذة لا تُحتسب إلّا عند أوّل ردٍّ منك داخلها."
          />
        ) : !view.length ? (
          <Empty
            title="لا صفوفَ بهذا المرشِّح"
            hint="المرشِّح الحاليّ لا يطابق أيّ نافذةٍ في الصفحة. أعِده إلى «الكلّ» من رصيف الشاشة أسفل."
            action={<Button size="sm" onClick={() => setFilt('all')}>أعِده إلى الكلّ</Button>}
          />
        ) : (
          <>
            <div className="sc-tbl">
              <Table columns={columns} rows={view} keyOf={(w) => w.id} onRowClick={openDetail} />
            </div>
            {/* ★ مجموعٌ يُطابَق بالفاتورة: جدولٌ يُفتح ليُراجَع ولا يحمل مجموعه
                يُجبر العميل على الجمع بيده — وذاك يُنتج نزاعاً لا يحسمه. */}
            <div className="sc-sum">
              <span className="sc-sum-i">صفوفٌ معروضة <b className="num">{fmt.num(view.length)}</b></span>
              <span className="sc-sum-i">منها مُفوترة <b className="num">{fmt.num(sum.billed)}</b></span>
              <span className="sc-sum-i">مجموعُ الرسائل <b className="num">{fmt.num(sum.msgs)}</b></span>
              <span className="sc-sum-i">مجموعُ كلفة الذكاء <b className="num">{fmt.money(sum.cost)}</b></span>
            </div>
          </>
        )}

        {!!data.items.length && (
          <p className="muted-p">
            اضغط أيّ صفٍّ ليُفتح تفصيلُه — ومنه إلى المحادثة التي أنشأته. فلا سطرَ فاتورةٍ
            بلا دليلٍ تقرؤه بعينك.
          </p>
        )}
      </Section>

      <Fold summary="متى تُحتسب النافذة، ولماذا لكلّ قناةٍ نافذةٌ مستقلّة">
        <Note>
          <b>النافذة لكلّ قناة لا لكلّ إنسان.</b> زبونٌ يراسلك على واتساب وإنستجرام يستهلك
          نافذتين — لأنّهما محادثتان منفصلتان عند ميتا، وكلفتهما علينا منفصلة.
        </Note>
        <Note>
          <b>ومتى تُحتسب النافذة؟</b> عند <b>أوّل ردٍّ منك داخلها</b>، لا عند وصول رسالة الزبون.
          فرسالةٌ لم يردّ عليها أحدٌ لا تُحسب عليك — وذاك ما يعنيه صفّ «لم تُفوتَر».
          العدّاد كلّه أمامك لتراجعه، وتصدّره متى شئت.
        </Note>
      </Fold>

      {/* ★ الرصيف: مرشّحاتُ الشاشة وفعلُها الأوّل معاً في مدى الإبهام. */}
      <ScreenDock hint="الملفُّ يحمل نوافذ الشهر كلَّها — لا الصفحةَ المعروضة.">
        <ChipRow label="مرشّحات">
          {chips.map((c) => (
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
        <Button variant="primary" size="lg" wide busy={exporting} onClick={() => void exportCsv()}>
          نزِّل الجدول (CSV)
        </Button>
      </ScreenDock>

      {/* ورقةُ الفرز — منسدلةٌ على الفأرة وورقةٌ صاعدةٌ على الإصبع، بعقدةٍ واحدة */}
      <Sheet
        open={sortOpen}
        kind="menu"
        title="ترتيب الجدول"
        onClose={() => setSortOpen(false)}
        hint="اختيارُ العمود نفسِه يقلب اتّجاهه. والفرزُ على الصفوف المعروضة — والملفُّ يحمل الشهر كلَّه."
        footer={<Button variant="quiet" onClick={() => setSortOpen(false)}>أغلِق</Button>}
      >
        <div className="opts">
          {SORTS.map((s) => (
            <button
              key={s.k}
              type="button"
              className="opt"
              aria-pressed={sortK === s.k}
              onClick={() => applySort(s.k)}
            >
              <span className="opt-t">
                {s.label}
                <span className="opt-n">
                  {sortK === s.k
                    ? (dir < 0 ? 'من الأكبر إلى الأصغر — اضغط لتقلبه' : 'من الأصغر إلى الأكبر — اضغط لتقلبه')
                    : 'رتِّب به'}
                </span>
              </span>
              <span className="opt-ck" aria-hidden="true">{sortK === s.k ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* ورقةُ النافذة الواحدة: الواردُ والصادرُ مفصولان — والجدولُ يجمعهما */}
      <Sheet
        open={detailOpen}
        title="نافذةٌ واحدة"
        onClose={() => setDetailOpen(false)}
        hint="النافذةُ وحدةُ الفوترة: تُفتح بأوّل رسالةٍ من الزبون، وتُفوتَر مرّةً واحدةً إن ردَّ فيها أحدٌ — مهما كثرت الرسائل."
        footer={detail
          ? (
            <Row gap="xs">
              <Button variant="primary" busy={going} onClick={() => { if (detail) void openConversation(detail); }}>
                افتح المحادثة التي أنشأتها
              </Button>
              <Button variant="quiet" onClick={() => setDetailOpen(false)}>أغلِق</Button>
            </Row>
          )
          : undefined}
      >
        {detail && (
          <>
            <KV>
              <KVRow k="الزبون"><span dir="auto">{detail.contactName ?? detail.handle}</span></KVRow>
              <KVRow k="المقبض"><span className="mono">{detail.handle}</span></KVRow>
              <KVRow k="القناة">
                <Pill
                  tone={CH[detail.channelKind]?.tone ?? 'neutral'}
                  label={CH[detail.channelKind]?.label ?? detail.channelKind}
                />
              </KVRow>
              <KVRow k="فُتحت">{fmt.when(detail.openedAt)}</KVRow>
              <KVRow k="فُوتِرت">
                {detail.billedAt
                  ? fmt.when(detail.billedAt)
                  : <Pill tone="neutral" label="لم تُفوتَر — لا ردّ" />}
              </KVRow>
              <KVRow k="رسائلُ الزبون"><span className="num">{fmt.num(detail.messagesIn)}</span></KVRow>
              <KVRow k="رسائلُكم"><span className="num">{fmt.num(detail.messagesOut)}</span></KVRow>
              <KVRow k="كلفةُ الذكاء"><span className="num">{fmt.money(detail.aiCostUsd)}</span></KVRow>
            </KV>
            {!detail.billedAt && (
              <Note>
                هذه النافذة <b>لم تُفوتَر</b>: وصلت رسالةُ الزبون ولم يردّ فيها بوتك ولا موظّفك.
                فلا تُحسب عليك — وهي معروضةٌ لأنّ العدّاد يُراجَع لا يُدَّعى.
              </Note>
            )}
          </>
        )}
      </Sheet>
    </Stack>
  );
}
