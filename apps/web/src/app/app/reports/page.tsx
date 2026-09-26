'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useApi, useToast, fmt, AR_LOCALE } from '@/lib/useApi';
import { validateRange } from '@/lib/range';
import { download, ApiError } from '@/lib/api';
import {
  PageHead, Stack, Row, Pill, Tag, Note, Meter, Button, Sheet, Table, Empty,
  Skeleton, ErrorBox, Field, Input, type Column,
} from '@/components/ui';
import {
  Band, Hero, Section, Rows, MetricRow, Delta, Fold, ScreenDock, ChipRow, type Sev,
} from '@/components/screen';
import {
  PLOT_W, PLOT_H, maxOf, pointsOf, pathOf, splitOpen, slotOf, barOf, yOf,
  deltaOf, ratioOf,
} from './chart';

/**
 * التقارير — السؤال الثالث.
 *
 * ★ **لماذا توجد هذه الشاشة أصلاً.** الرئيسيّة تقول «اليوم» والاستهلاك يقول
 *   «الفاتورة»، وكلتاهما **لقطة**. وصاحبُ المطعم لا يقرّر شيئاً من لقطة: هو
 *   يسأل سؤالاً واحداً — **هل بوتي يتحسّن؟** — وجوابُه اتّجاهٌ عبر الزمن
 *   مقارنٌ بمدًى سابقٍ بطوله. ولذلك **لا رقمَ هنا بلا خطِّ أساس**: الرقمُ
 *   المجرَّد في شاشة تقريرٍ ليس معلومةً ناقصةً بل معلومةٌ كاذبة، لأنّه يُقرأ
 *   حكماً وهو خبر.
 *
 * ★ **والصدقُ شرطٌ بنيويٌّ لا نبرة.** ثلاثُ محادثاتٍ لا تصنع اتّجاهاً، وخطٌّ
 *   مرسومٌ عليها يوحي بمعنى لا يملكه — وهذا أسوأ من فراغ: الفراغُ يدفع
 *   لتوسيع المدى، والخطُّ الكاذب يدفع لقرار. فكفايةُ البيانات **يحكم بها
 *   الخادم** (`enough`) لا الشاشة، فلا تختلف عتبةُ الرسم عن عتبة الملفّ.
 *
 * ★ **والزمن يجري من اليمين إلى اليسار.** عربيّاً يبدأ القارئ من اليمين،
 *   فأقدمُ يومٍ يمينٌ وآخرُ يومٍ يسار. وهذا في `chart.ts` قرارٌ واحدٌ يسري
 *   على كلّ رسمٍ هنا: خطوطاً وأعمدةً ومحاورَ وتسميات.
 *
 * ★ **ولا نصَّ داخل SVG.** الرسمُ يُمَطّ أفقيّاً ليأخذ عرضَ حاويه، ونصٌّ
 *   داخله يُمَطّ معه. فالتسمياتُ HTML بتوكِنات الثيم وبأرضيّة المقاس،
 *   والمقياسُ الواحد (`chart.ts`) يضع العلامةَ في SVG والتسميةَ قبالتها.
 */

interface TrendDay {
  day: string;
  cust: number; bot: number; agent: number; msgs: number;
  opened: number; billed: number; solo: number; cost: number;
}

interface Gap {
  topic: string;
  asks: number;
  handoffs: number;
  /** سؤالٌ حقيقيٌّ من زبونٍ انتهى بموظّف — ولذلك تُقرأ القائمةُ قائمةَ عمل */
  sample: string | null;
}

interface Trend {
  range: {
    from: string; to: string; days: number;
    preset: number | null; openEnd: boolean; tz: string; presets: number[];
  };
  prev: { from: string; to: string; days: number };
  days: TrendDay[];
  prevDays: TrendDay[];
  total: Omit<TrendDay, 'day'>;
  prevTotal: Omit<TrendDay, 'day'>;
  volume: {
    byDow: Array<{ dow: number; n: number }>;
    byHour: Array<{ hour: number; n: number }>;
    peak: { dow: number; hour: number; n: number } | null;
  };
  selfServe: {
    rate: number | null; prevRate: number | null;
    solo: number; billed: number; prevSolo: number; prevBilled: number;
  };
  cost: {
    total: number; prevTotal: number;
    perConv: number | null; prevPerConv: number | null;
  };
  gaps: {
    items: Gap[];
    runs: number; prevRuns: number;
    handoff: number; prevHandoff: number;
    unknown: number; fail: number; medianLatencyMs: number;
  };
  enough: {
    minBilled: number;
    rate: boolean; delta: boolean; line: boolean;
    volume: boolean; busy: boolean; gaps: boolean;
    liveDays: number; billedDays: number;
  };
}

/** `isodow`: الأحد 7 — والأسبوعُ عربيّاً يبدأ به. */
const DOW: Record<number, string> = {
  7: 'الأحد', 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة', 6: 'السبت',
};

/** اختصارٌ لعمود — والاسمُ الكامل في نصّ الذروة تحت الرسم، فلا يُفقد معنى. */
const DOW_SHORT: Record<number, string> = {
  7: 'أحد', 1: 'اثن', 2: 'ثلا', 3: 'أرب', 4: 'خمي', 5: 'جمع', 6: 'سبت',
};

/**
 * عددٌ عربيٌّ سليمُ الصيغة.
 *
 * ★ «3 نقطة» و«1 نقاط» يقرؤهما صاحبُ المطعم خللاً في المنتج لا في اللغة —
 *   وهو محقّ: نصٌّ مولَّدٌ بلا تثنيةٍ ولا جمعٍ يقول إنّ أحداً لم يقرأ الشاشة.
 */
function plural(n: number, one: string, two: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a === 2) return two;
  if (a >= 3 && a <= 10) return few;
  return many;
}

/** يومٌ على المحور — بتوقيت UTC كي تطابق التسميةُ نصَّ التاريخ حرفاً بحرف. */
function dayLabel(day: string): string {
  return new Intl.DateTimeFormat(AR_LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
}

/** ساعةٌ بخانتَين — `09` لا `9`، فأعمدةُ المحور لا ترقص. */
function hh(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/* ══════════════════ مفتاحُ القراءة — يطابق الرسم لا يشبهه ══════════════════ */

/**
 * ★ العيّنةُ في المفتاح **نفسُ العنصر** بنفس الصنف، لا مستطيلٌ ملوَّنٌ يشبهه.
 *   فلو تغيّر التقطيعُ في الورقة تغيّر المفتاحُ معه — ومفتاحٌ يكذب أسوأ من
 *   غيابه. والأصنافُ مكتوبةٌ حرفيّاً في كلّ فرعٍ لا مركَّبةً بقالب: حارسُ
 *   الصنف الميّت يقرأ الحرفيّات وحدها، وصنفٌ مركَّبٌ يفلت منه.
 */
function Leg({ kind, children }: {
  kind: 'line' | 'prev' | 'open' | 'base' | 'bar' | 'peak';
  children: ReactNode;
}) {
  let sample: ReactNode = null;
  if (kind === 'line') {
    sample = <line className="rp-line" x1="0" y1="4" x2="24" y2="4" vectorEffect="non-scaling-stroke" />;
  } else if (kind === 'prev') {
    sample = <line className="rp-prev" x1="0" y1="4" x2="24" y2="4" vectorEffect="non-scaling-stroke" />;
  } else if (kind === 'open') {
    sample = <line className="rp-open" x1="0" y1="4" x2="24" y2="4" vectorEffect="non-scaling-stroke" />;
  } else if (kind === 'base') {
    sample = <line className="rp-base" x1="0" y1="4" x2="24" y2="4" vectorEffect="non-scaling-stroke" />;
  } else if (kind === 'peak') {
    sample = <rect className="rp-bar rp-peak" x="1" y="1" width="22" height="6" />;
  } else {
    sample = <rect className="rp-bar" x="1" y="1" width="22" height="6" />;
  }
  return (
    <span className="rp-leg-i">
      <svg className="rp-leg-m" width="24" height="8" aria-hidden="true" focusable="false">{sample}</svg>
      {children}
    </span>
  );
}

/* ══════════════════ إطارُ الرسم — المقياسُ يضع العلامة والتسمية ══════════════════ */

/**
 * ★ التسميتان **قيمتان يبلغهما الرسم**: القمّةُ أعلى قيمةٍ مقيسةٍ فعلاً،
 *   والقاعدةُ صفرٌ — لأنّ المحور يبدأ من الصفر أبداً. ومحورٌ مقصوصٌ من أدنى
 *   قيمةٍ يضاعف الميلَ بصريّاً فيُقرأ انهياراً ما هو نزولُ نقطتَين، وهذه
 *   شاشةٌ يُسأل فيها «هل تحسّن؟» — فالقصُّ فيها كذبةٌ لا اختصار.
 *
 * ★ وارتفاعُ عمود التسميات يطابق ارتفاعَ اللوح في الورقة (112px في كليهما):
 *   `space-between` هي ما يضع القمّةَ عند الخطّ الأعلى والقاعدةَ عند الأسفل.
 */
function Fig({ head, sub, top, bottom, children, axis, legend, note }: {
  head: string;
  sub?: ReactNode;
  /** تسميةُ القمّة — سلسلةُ آلةٍ خالصةٌ، فالوحدةُ العربيّة تسكن `sub` */
  top: string;
  bottom: string;
  children: ReactNode;
  axis: ReactNode;
  legend: ReactNode;
  note?: ReactNode;
}) {
  return (
    <figure className="rp-fig">
      <figcaption className="rp-fig-h">
        <b>{head}</b>
        {sub !== undefined && <span className="rp-fig-s">{sub}</span>}
      </figcaption>
      {/* ★ محورُ الزمن **داخل** شبكة اللوح لا أخاً لها: قِيس بالعين ثمّ
          بالأرقام على 390 — عمودُ التسميات الرأسيّة يزيح اللوحَ عن حافّة
          الإطار (‏22px في «محادثاتٌ فُتحت» و**62px** في «كلفةُ الذكاء» حيث
          التسميةُ «$0.13230»)، وكان المحورُ يمتدّ على عرض الإطار كلِّه. فكانت
          «25 آب» تقف خارج اللوح كلَّه، و«أحد» تبعد 27px عن عمودها، و«18:00»
          تسمّي عموداً غيرَ عمودها ببكسلَين وعشرين. وهو نقضُ ما تدّعيه هذه
          الشاشة نفسُها: المقياسُ يضع العلامةَ في SVG والتسميةَ **قبالتها**. */}
      <div className="rp-body">
        <div className="rp-ys" aria-hidden="true">
          <span className="rp-y num">{top}</span>
          <span className="rp-y num">{bottom}</span>
        </div>
        {children}
        <div className="rp-ax">{axis}</div>
      </div>
      <div className="rp-leg">{legend}</div>
      {note !== undefined && <p className="rp-note">{note}</p>}
    </figure>
  );
}

/**
 * لوحُ خطٍّ واحد.
 *
 * ★ `preserveAspectRatio="none"` يجعل اللوحَ يأخذ عرضَ حاويه بلا حسابِ عرضٍ
 *   في JS — وهذا هو موضعُ «لا تفريعَ على عرض الشاشة»: العنصرُ يتحوّل، ولا
 *   أحدَ يسأل النافذةَ عن مقاسها. وثمنُه أنّ السَّمكَ يُمَطّ أفقيّاً، فيُلغى
 *   بـ`non-scaling-stroke` على كلّ خطّ.
 *
 * ★ و`role="img"` مع `aria-label`: لا نصَّ داخل اللوح، فبلا الوسم يُقرأ
 *   الرسمُ صمتاً. والوسمُ يحمل **الخلاصة** لا وصفَ الشكل.
 */
function Line({ label, values, prev, max, openEnd, base }: {
  label: string;
  values: number[];
  prev?: number[];
  max: number;
  openEnd: boolean;
  /** خطُّ أساسٍ أفقيٌّ — متوسّطُ المدى السابق، مقطَّعٌ ومسمّىً في المفتاح */
  base?: number;
}) {
  const pts = pointsOf(values, max);
  const { solid, open } = splitOpen(pts, openEnd);
  const prevPath = prev ? pathOf(pointsOf(prev, max)) : '';
  const baseY = base != null ? yOf(base, max) : null;
  /* علاماتُ العيّنة تُرسم حيث تُقرأ: ثلاثون نقطةً تصير سِنّاً لا علامة. */
  const marks = values.length <= 14 ? pts : [];
  return (
    <svg
      className="rp-plot"
      viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line className="rp-rule" x1="0" y1="0" x2={PLOT_W} y2="0" vectorEffect="non-scaling-stroke" />
      <line className="rp-rule" x1="0" y1={PLOT_H} x2={PLOT_W} y2={PLOT_H} vectorEffect="non-scaling-stroke" />
      {baseY != null && (
        <line className="rp-base" x1="0" y1={baseY} x2={PLOT_W} y2={baseY} vectorEffect="non-scaling-stroke" />
      )}
      {prevPath && <path className="rp-prev" d={prevPath} vectorEffect="non-scaling-stroke" />}
      <path className="rp-line" d={pathOf(solid)} vectorEffect="non-scaling-stroke" />
      {open.length > 1 && (
        <path className="rp-open" d={pathOf(open)} vectorEffect="non-scaling-stroke" />
      )}
      {marks.map((p) => (
        <line
          key={p.x}
          className="rp-tick"
          x1={p.x}
          y1={p.y - 2.5}
          x2={p.x}
          y2={p.y + 2.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** لوحُ أعمدة — والأوّلُ يمين، كالزمن. والذروةُ محدَّدةٌ بحدٍّ **ومسمّاةٌ بالنصّ**. */
function Bars({ label, values, max, peak }: {
  label: string; values: number[]; max: number; peak: number;
}) {
  return (
    <svg
      className="rp-plot"
      viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line className="rp-rule" x1="0" y1={PLOT_H} x2={PLOT_W} y2={PLOT_H} vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => {
        const s = slotOf(i, values.length);
        const b = barOf(v, max);
        return i === peak
          ? <rect key={i} className="rp-bar rp-peak" x={s.x} y={b.y} width={s.width} height={b.height} />
          : <rect key={i} className="rp-bar" x={s.x} y={b.y} width={s.width} height={b.height} />;
      })}
    </svg>
  );
}

/**
 * ★ **البيانُ الصادق** حيث لا يكفي المقيس.
 *   «٣ محادثات لا تكفي لاتّجاه» جملةٌ تُقال، ولا يُرسم تحتها خطّ. ومعها
 *   **طريقٌ للأمام** — مدًى أوسع — وإلّا صارت اعتذاراً.
 */
function Thin({ what, have, need, onWiden }: {
  what: string; have: ReactNode; need: string; onWiden?: () => void;
}) {
  return (
    <Note tone="brand">
      <b>{what}</b>
      <span className="rp-thin">{have} — {need}</span>
      {onWiden && (
        <span className="rp-thin-a">
          <Button size="sm" onClick={onWiden}>وسِّع المدى إلى 90 يوماً</Button>
        </span>
      )}
    </Note>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

const PRESETS = [7, 30, 90];

export default function ReportsPage() {
  /* المدى حالةُ شاشةٍ لا حالةُ عنوان: التقريرُ يُقرأ ولا يُشارَك برابط،
     ومزامنةُ المدى مع العنوان تُضيف حالةً ثانيةً بلا مستفيد. */
  const [preset, setPreset] = useState<number | null>(30);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const { toast, node: toastNode } = useToast();

  const qs = preset != null
    ? `days=${preset}`
    : `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const ready = preset != null || (Boolean(from) && Boolean(to));
  const { data, loading, error, reload } = useApi<Trend>(ready ? `/reports/trend?${qs}` : null);

  function applyCustom() {
    /* ★ التحقّقُ قبل الإرسال: نهايةٌ قبل بدايةٍ أو في المستقبل أو مدًى فوق سنةٍ
       كانت تُرسَل كما هي وتعود تقريراً فارغاً يُقرأ «لا نشاط». */
    const v = validateRange(draftFrom, draftTo);
    if (!v.ok) {
      toast(v.message);
      return;
    }
    setFrom(draftFrom);
    setTo(draftTo);
    setPreset(null);
    setPickOpen(false);
  }

  function widen() {
    setPreset(90);
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await download(`/reports/trend.csv?${qs}`, `aibot-trend-${data?.range.from ?? 'range'}.csv`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر التصدير');
    } finally {
      setExporting(false);
    }
  }

  const rangeLabel = data
    ? `${data.range.from} → ${data.range.to}`
    : preset != null ? `${preset} يوماً` : `${from} → ${to}`;

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="التقارير"
        sub="سؤالٌ واحد: هل بوتك يتحسّن؟ — اتّجاهٌ عبر الزمن، وكلُّ رقمٍ مقارنٌ بالمدى السابق نفسِه."
        actions={<Pill tone="neutral" label={rangeLabel} mark={false} />}
      />

      {loading && <Skeleton rows={7} />}
      {!loading && error && <ErrorBox message={error} onRetry={reload} />}
      {!loading && !error && data && <Body data={data} onWiden={widen} />}

      {/* ★ الرصيف **خارج** تفريع الحالات: مدًى فارغٌ أو مرفوضٌ يجب أن يبقى
          معه مخرجٌ — وإلّا انحصر العميل في صندوق خطأٍ لا يملك منه بديلاً. */}
      <ScreenDock hint="الملفُّ يحمل يوماً في كلّ سطرٍ على المدى نفسِه — لا الأرقامَ المجمَّعة وحدها.">
        <ChipRow label="المدى الزمنيّ">
          {PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              className="chipf"
              aria-pressed={preset === d}
              onClick={() => setPreset(d)}
            >
              <span className="num">{d}</span> {plural(d, 'يوم', 'يومان', 'أيّام', 'يوماً')}
            </button>
          ))}
          <button
            type="button"
            className="chipf"
            aria-pressed={preset === null}
            onClick={() => {
              setDraftFrom(from || data?.range.from || '');
              setDraftTo(to || data?.range.to || '');
              setPickOpen(true);
            }}
          >
            مدًى مخصَّص
          </button>
        </ChipRow>
        <Button variant="primary" size="lg" wide busy={exporting} onClick={() => void exportCsv()}>
          نزِّل الاتّجاه (CSV)
        </Button>
      </ScreenDock>

      <Sheet
        open={pickOpen}
        title="مدًى مخصَّص"
        onClose={() => setPickOpen(false)}
        hint="المدى مشمولُ الطرفين، والمقارنةُ تكون بمدًى سابقٍ بطوله تماماً. ونهايةٌ في المستقبل تُقَصّ إلى اليوم."
        footer={(
          <Row gap="xs">
            <Button variant="primary" onClick={applyCustom}>طبِّق المدى</Button>
            <Button variant="quiet" onClick={() => setPickOpen(false)}>أغلِق</Button>
          </Row>
        )}
      >
        <Field label="من" id="rp-from" hint="أوّل يومٍ في التقرير — مشمول">
          <Input id="rp-from" type="date" value={draftFrom} onChange={setDraftFrom} dir="ltr" />
        </Field>
        <Field label="إلى" id="rp-to" hint="آخرُ يومٍ في التقرير — مشمول">
          <Input id="rp-to" type="date" value={draftTo} onChange={setDraftTo} dir="ltr" />
        </Field>
      </Sheet>
    </Stack>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   جسمُ التقرير — فُصل عن الشاشة كي يبقى الرصيفُ خارج تفريع الحالات.
   ══════════════════════════════════════════════════════════════════════════ */

function Body({ data, onWiden }: { data: Trend; onWiden: () => void }) {
  const { range, prev, days, prevDays, total, prevTotal, selfServe, cost, gaps, enough } = data;

  const openEnd = range.openEnd;
  const rate = selfServe.rate;
  const prevRate = selfServe.prevRate;

  /* عتبةُ «ثابت» نقطتان مئويّتان: نسبةٌ تتحرّك دونهما ضجيجُ عدٍّ لا اتّجاه،
     وسهمٌ عليها يعلّم القارئ أن يتجاهل السهم. */
  const rateDelta = enough.delta ? deltaOf(rate, prevRate, 0.02) : null;
  /* ★ **والفرقُ نفسُه محجوبٌ خلف `enough.delta`، لا الرسمُ وحده.**
     كان يُحسب من `rate` و`prevRate` مباشرةً، فمدًى فيه خمسون محادثةً يقابله
     مدًى سابقٌ فيه محادثتان كان يُنتج «نزل من 50٪ إلى 82٪» — وهو كلامٌ عن
     خطِّ أساسٍ قوامُه محادثتان. والشريطُ يقوله بلهجة الحكم، ويُقرَّر عليه.
     فالمقارنةُ إمّا أن تكون لها أرضيّةٌ في المدَيَين معاً أو لا تُعرض. */
  const ratePts = enough.delta && rate != null && prevRate != null
    ? Math.round((rate - prevRate) * 100)
    : null;

  const convDelta = deltaOf(total.opened, prevTotal.opened, 0);
  const custDelta = deltaOf(total.cust, prevTotal.cust, 0);
  const perConv = cost.perConv;
  const costDelta = enough.delta ? deltaOf(perConv, cost.prevPerConv, 0) : null;
  const costRatio = enough.delta ? ratioOf(perConv, cost.prevPerConv) : null;

  const noData = total.msgs === 0 && total.opened === 0;

  /* ── الشريط الحاكم: «في شيء يحتاجني؟» قبل أيّ رقم ─────────────────────────
     والترتيبُ **ما وقع قبل ما يُتوقَّع**: نقصُ البيانات أوّلاً (فهو يُبطل كلَّ
     ما تحته)، ثمّ نزولُ الاكتفاء (خبرٌ واقع)، ثمّ ارتفاعُ الكلفة، ثمّ التحسُّن. */
  const dropped = ratePts != null && ratePts <= -3;
  const costUp = costRatio != null && costRatio >= 1.25;
  const improved = ratePts != null && ratePts >= 3;

  let band: { sev: Sev; head: ReactNode; sub: ReactNode };
  if (noData) {
    band = {
      sev: 'plain',
      head: 'لا حركةَ في هذا المدى — ولا شيءَ يُقاس',
      sub: <>جرّب مدًى أوسع من الرصيف أسفل، أو راجع القنوات إن كنت تتوقّع رسائل.</>,
    };
  } else if (!enough.rate) {
    band = {
      sev: 'plain',
      head: <>
        <span className="num">{fmt.num(selfServe.billed)}</span>
        {' '}{plural(selfServe.billed, 'محادثةٌ', 'محادثتان', 'محادثات', 'محادثةً')} لا تكفي لاتّجاه
      </>,
      sub: <>
        نقرأ الاكتفاء الذاتيّ اتّجاهاً من <span className="num">{fmt.num(enough.minBilled)}</span>
        {' '}محادثةٍ مُفوترةٍ فأكثر. وما دونها نعرض العدَّ ولا نرسم خطّاً يوحي بمعنى.
      </>,
    };
  } else if (dropped) {
    band = {
      sev: ratePts != null && ratePts <= -8 ? 'bad' : 'warn',
      head: <>
        اكتفاءُ بوتك الذاتيّ نزل من <span className="num">{fmt.pct(prevRate ?? 0)}</span> إلى
        {' '}<span className="num">{fmt.pct(rate ?? 0)}</span>
      </>,
      sub: <>
        كلُّ محادثةٍ تنزل عن البوت تصير دقائقَ موظّف. وأكثرُ ما يعجز عنه في قسم
        «أين يعجز» أسفل — يُقرأ قائمةَ عملٍ لمعرفتك لا تقريرَ عطل.
      </>,
    };
  } else if (costUp) {
    band = {
      sev: 'warn',
      head: <>
        كلفةُ المحادثة الواحدة صارت <span className="num">{fmt.money(perConv)}</span> بعد
        {' '}<span className="num">{fmt.money(cost.prevPerConv)}</span>
      </>,
      sub: <>
        أي <span className="num">{(costRatio ?? 1).toFixed(1)}</span> ضعفَ المدى السابق، والاكتفاءُ
        الذاتيُّ لم ينزل — فالزيادةُ في طول المحادثات أو في المعرفة المحقونة لا في التحويل.
      </>,
    };
  } else if (improved) {
    band = {
      sev: 'good',
      head: <>
        اكتفاءُ بوتك الذاتيّ ارتفع إلى <span className="num">{fmt.pct(rate ?? 0)}</span>
        {' '}بعد <span className="num">{fmt.pct(prevRate ?? 0)}</span>
      </>,
      sub: <>
        هذا مقياسُ نجاح المنتج: ما أنهاه البوت وحده لم يكلّفك موظّفاً. وأبقِ عينك على
        الكلفة لكلّ محادثةٍ أسفل — ارتفاعُها يأكل ما كسبتَه.
      </>,
    };
  } else {
    band = {
      sev: 'good',
      head: <>
        لا شيءَ يحتاجك — الاكتفاء الذاتيّ ثابتٌ عند <span className="num">{fmt.pct(rate ?? 0)}</span>
      </>,
      sub: <>
        على <span className="num">{fmt.num(selfServe.billed)}</span> محادثةٍ مُفوترةٍ في
        {' '}<span className="num">{fmt.num(range.days)}</span> {plural(range.days, 'يوم', 'يومَين', 'أيّام', 'يوماً')}،
        {' '}مقابل <span className="num">{fmt.pct(prevRate ?? 0)}</span> في المدى السابق.
      </>,
    };
  }

  /* ── مقاييسُ الرسوم: مقياسٌ واحدٌ للمدى والسابق، وإلّا قارن القارئُ شكلَين
     على سلَّمَين مختلفَين فقرأ ارتفاعاً هو فرقُ مقياس. */
  const convMax = maxOf(days.map((d) => d.opened), prevDays.map((d) => d.opened));
  const custMax = maxOf(days.map((d) => d.cust), prevDays.map((d) => d.cust));
  const dowVals = data.volume.byDow.map((b) => b.n);
  const hourVals = data.volume.byHour.map((b) => b.n);
  const dowMax = maxOf(dowVals);
  const hourMax = maxOf(hourVals);
  const dowPeak = dowVals.indexOf(dowMax);
  const hourPeak = hourVals.indexOf(hourMax);

  /* نسبةٌ يوميّة: يومٌ بلا محادثةٍ مُفوترةٍ ليس «صفراً بالمئة» — فيُرسم صفراً
     في الخطّ ويُقال في الملاحظة أنّ اليومَ الخالي يهبط إلى الأرضيّة. */
  const rateSeries = days.map((d) => (d.billed ? d.solo / d.billed : 0));
  const prevRateSeries = prevDays.map((d) => (d.billed ? d.solo / d.billed : 0));
  const rateMax = maxOf(rateSeries, prevRateSeries);

  const costSeries = days.map((d) => d.cost);
  const prevCostSeries = prevDays.map((d) => d.cost);
  const costMax = maxOf(costSeries, prevCostSeries);
  const prevDailyCost = prev.days ? prevTotal.cost / prev.days : 0;

  const first = days[0];
  const last = days[days.length - 1];

  /** محورُ الزمن: الأقدمُ أوّلاً — وفي RTL الأوّلُ يمينٌ، فالزمن يجري إلى اليسار. */
  const timeAxis = (
    <>
      <span className="rp-x">{first ? dayLabel(first.day) : ''}</span>
      <span className="rp-x">{last ? dayLabel(last.day) : ''}</span>
    </>
  );

  const timeLegend = (extra?: ReactNode) => (
    <>
      <Leg kind="line">
        هذا المدى (<span className="num">{fmt.num(range.days)}</span>{' '}
        {plural(range.days, 'يوم', 'يومَين', 'أيّام', 'يوماً')})
      </Leg>
      <Leg kind="prev">
        المدى السابق — <span className="num">{prev.from}</span> إلى <span className="num">{prev.to}</span>
      </Leg>
      {openEnd && <Leg kind="open">اليومُ لم ينتهِ — نقطةٌ ناقصةٌ لا مقيسة</Leg>}
      {extra}
    </>
  );

  const gapColumns: Array<Column<Gap>> = [
    {
      key: 'topic',
      head: 'الموضوع',
      cell: (g) => (
        <span className="rp-topic" dir="auto">
          {g.topic}
          {g.sample && <span className="rp-q" dir="auto">«{g.sample}»</span>}
        </span>
      ),
    },
    { key: 'asks', head: 'سُئل عنه', num: true, cell: (g) => fmt.num(g.asks) },
    { key: 'hand', head: 'انتهى بموظّف', num: true, cell: (g) => fmt.num(g.handoffs) },
    {
      key: 'rate',
      head: 'نسبةُ التحويل',
      cell: (g) => (
        <span className="rp-mrow">
          {/* وهنا العكس: نسبةُ تحويلٍ عاليةٌ خبرٌ سيّئ، فالعتباتُ التلقائيّة
              (80 · 95 · 100) هي الصحيحة ولا تُطفَأ بنبرةٍ مفروضة. */}
          <span className="sc-mw"><Meter pct={g.asks ? g.handoffs / g.asks : 0} /></span>
          <span className="sc-ctx"><span className="num">{fmt.pct(g.asks ? g.handoffs / g.asks : 0)}</span></span>
        </span>
      ),
    },
  ];

  return (
    <>
      <Band sev={band.sev} head={band.head} sub={band.sub} />

      {/* ══ البطوليّ: الرقم الذي يجيب «هل تحسّن؟» — ويتبدّل بالحالة لا بالتفضيل.
          ما دامت البياناتُ تكفي فهو نسبةُ الاكتفاء الذاتيّ بدلتاها؛ وحين لا
          تكفي فالخبرُ هو **العدّ** نفسُه، لأنّ النسبةَ عندها رقمٌ بلا معنى. ══ */}
      {enough.rate ? (
        <Hero
          sev={dropped ? (ratePts != null && ratePts <= -8 ? 'bad' : 'warn') : improved ? 'good' : 'plain'}
          value={fmt.pct(rate ?? 0)}
          label="مِن محادثاتك أنهاها بوتك وحده — بلا تدخّلِ موظّف"
          /* ★ `tone: 'brand'` **إلزاميّةٌ هنا**: عتباتُ `Meter` التلقائيّة مكتوبةٌ
             لمنسوبٍ يُخشى ارتفاعُه (استهلاكٌ من سقف)، فتصبغ 84٪ كهرمانيّاً —
             و84٪ اكتفاءٍ ذاتيٍّ أفضلُ رقمٍ في الشاشة. والمقياسُ هنا منسوبٌ
             يُراد ارتفاعُه، فحبرٌ صلبٌ لا إنذار. */
          meter={{ pct: rate ?? 0, tone: 'brand' }}
          ctx={(
            <>
              <span className="num">{fmt.num(selfServe.solo)}</span> من
              {' '}<span className="num">{fmt.num(selfServe.billed)}</span> محادثةٍ مُفوترة ·
              {' '}
              {rateDelta && ratePts != null
                ? (
                  <>
                    والمدى السابق <span className="num">{fmt.pct(prevRate ?? 0)}</span>
                    {' '}
                    <Delta dir={rateDelta.dir}>
                      {ratePts === 0
                        ? 'بلا تغيير'
                        : <><span className="num">{`${Math.abs(ratePts)}`}</span>{' '}
                          {plural(Math.abs(ratePts), 'نقطة', 'نقطتان', 'نقاط', 'نقطة')}</>}
                    </Delta>
                  </>
                )
                : (
                  <>
                    ولا مقارنةَ بعد: المدى السابق فيه
                    {' '}<span className="num">{fmt.num(selfServe.prevBilled)}</span> محادثةٍ مُفوترةٍ فقط
                  </>
                )}
            </>
          )}
        />
      ) : (
        <Hero
          sev="plain"
          value={fmt.num(selfServe.billed)}
          unit={`/ ${fmt.num(enough.minBilled)}`}
          label="محادثةً مُفوترةً في هذا المدى — والاتّجاه يبدأ من العشر"
          ctx={(
            <>
              فتحتَ <span className="num">{fmt.num(total.opened)}</span> محادثةً، ومنها
              {' '}<span className="num">{fmt.num(selfServe.billed)}</span> رُدَّ فيها فصارت مُفوترة.
              {' '}ولا نرسم اتّجاهاً على هذا العدد — الخطُّ عليه يوحي بمعنى لا يملكه.
            </>
          )}
        />
      )}

      {noData ? (
        <Empty
          title="لا رسائلَ ولا محادثاتٍ في هذا المدى"
          hint="التقرير يقرأ ما جرى فعلاً. إن كنت تتوقّع حركةً فراجع صفحة القنوات — قناةٌ غير موصولةٍ تبدو صامتةً لا معطوبة. وإن كان المدى قصيراً فوسِّعه من الرصيف أسفل."
        />
      ) : (
        <>
          {/* ══════════════ ① الحجم ══════════════ */}
          <Section
            title="الحجم — ومتى تحتاج موظّفاً"
            sub={(
              <>
                <span className="num">{range.from}</span> إلى <span className="num">{range.to}</span>
                {' '}بتوقيت <span className="num">{range.tz}</span>
              </>
            )}
          >
            {enough.volume ? (
              <div className="rp-2">
                <Fig
                  head="محادثاتٌ فُتحت"
                  sub="نافذةُ 24 ساعةً تُفتح بأوّل رسالةٍ من الزبون"
                  top={fmt.num(convMax)}
                  bottom="0"
                  axis={timeAxis}
                  legend={timeLegend()}
                  note={(
                    <>
                      المجموع <b className="num">{fmt.num(total.opened)}</b> مقابل
                      {' '}<span className="num">{fmt.num(prevTotal.opened)}</span> في المدى السابق.
                    </>
                  )}
                >
                  <Line
                    label={`محادثاتٌ فُتحت يوماً بيوم — المجموع ${total.opened}، وأعلى يومٍ ${convMax}`}
                    values={days.map((d) => d.opened)}
                    prev={prevDays.map((d) => d.opened)}
                    max={convMax}
                    openEnd={openEnd}
                  />
                </Fig>

                <Fig
                  head="رسائلُ الزبائن"
                  sub="الواردُ وحده — وردُّ البوت يتبعه فلا يقول شيئاً جديداً عن الضغط"
                  top={fmt.num(custMax)}
                  bottom="0"
                  axis={timeAxis}
                  legend={timeLegend()}
                  note={(
                    <>
                      المجموع <b className="num">{fmt.num(total.cust)}</b>، وردَّ بوتك
                      {' '}<span className="num">{fmt.num(total.bot)}</span> وموظّفوك
                      {' '}<span className="num">{fmt.num(total.agent)}</span>.
                    </>
                  )}
                >
                  <Line
                    label={`رسائلُ الزبائن يوماً بيوم — المجموع ${total.cust}، وأعلى يومٍ ${custMax}`}
                    values={days.map((d) => d.cust)}
                    prev={prevDays.map((d) => d.cust)}
                    max={custMax}
                    openEnd={openEnd}
                  />
                </Fig>
              </div>
            ) : (
              <Thin
                what="المدى أقصرُ من أن يُرسم عليه خطّ"
                have={(
                  <>
                    فيه <span className="num">{fmt.num(enough.liveDays)}</span>
                    {' '}{plural(enough.liveDays, 'يومٌ', 'يومان', 'أيّام', 'يوماً')} فيها رسائل
                  </>
                )}
                need="ونحتاج ثلاثةً على الأقلّ. والعدُّ أدناه مقيسٌ وصحيح — الخطُّ وحده هو ما لا نرسمه."
                onWiden={range.days < 90 ? onWiden : undefined}
              />
            )}

            {enough.busy ? (
              <div className="rp-2">
                <Fig
                  head="أيّ أيّام الأسبوع أكثر انشغالاً"
                  sub="مجموعُ رسائل الزبائن في المدى كلِّه"
                  top={fmt.num(dowMax)}
                  bottom="0"
                  axis={(
                    <span className="rp-dx">
                      {data.volume.byDow.map((b) => (
                        <span key={b.dow} className="rp-x">{DOW_SHORT[b.dow] ?? ''}</span>
                      ))}
                    </span>
                  )}
                  legend={(
                    <>
                      <Leg kind="bar">يومٌ من الأسبوع</Leg>
                      <Leg kind="peak">الأكثرُ انشغالاً</Leg>
                    </>
                  )}
                  note={(
                    <>
                      الأكثرُ انشغالاً <b>{DOW[data.volume.byDow[dowPeak]?.dow ?? 7] ?? ''}</b> بـ
                      {' '}<b className="num">{fmt.num(dowMax)}</b> رسالة — وهذا يومُ الموظّف
                      إن قرّرتَ أن تُدخل واحداً.
                    </>
                  )}
                >
                  <Bars
                    label={`رسائلُ الزبائن على أيّام الأسبوع — أكثرها ${DOW[data.volume.byDow[dowPeak]?.dow ?? 7] ?? ''} بـ${dowMax}`}
                    values={dowVals}
                    max={dowMax}
                    peak={dowPeak}
                  />
                </Fig>

                <Fig
                  head="وأيُّ ساعات اليوم"
                  sub={<>الساعةُ بتوقيت <span className="num">{range.tz}</span>، والزمنُ من اليمين إلى اليسار</>}
                  top={fmt.num(hourMax)}
                  bottom="0"
                  axis={(
                    <span className="rp-hx">
                      <span className="rp-x">{hh(0)}</span>
                      <span className="rp-x">{hh(6)}</span>
                      <span className="rp-x">{hh(12)}</span>
                      <span className="rp-x">{hh(18)}</span>
                    </span>
                  )}
                  legend={(
                    <>
                      <Leg kind="bar">ساعةٌ من اليوم</Leg>
                      <Leg kind="peak">الأكثرُ انشغالاً</Leg>
                    </>
                  )}
                  note={data.volume.peak
                    ? (
                      <>
                        أعلى خليّةٍ في المدى: <b>{DOW[data.volume.peak.dow] ?? ''}</b> عند
                        {' '}<b className="num">{hh(data.volume.peak.hour)}</b> بـ
                        {' '}<b className="num">{fmt.num(data.volume.peak.n)}</b> رسالة.
                      </>
                    )
                    : undefined}
                >
                  <Bars
                    label={`رسائلُ الزبائن على ساعات اليوم — أكثرها ${hh(hourPeak)} بـ${hourMax}`}
                    values={hourVals}
                    max={hourMax}
                    peak={hourPeak}
                  />
                </Fig>
              </div>
            ) : (
              <Thin
                what="وأوقاتُ الانشغال تحتاج رسائلَ أكثر"
                have={(
                  <>
                    عندك <span className="num">{fmt.num(total.cust)}</span>
                    {' '}{plural(total.cust, 'رسالةٌ', 'رسالتان', 'رسائل', 'رسالةً')} من الزبائن
                  </>
                )}
                need="ونحتاج عشرين على الأقلّ قبل أن نقول «الخميس مساءً» — وإلّا فالذروةُ مصادفةٌ لا نمط."
                onWiden={range.days < 90 ? onWiden : undefined}
              />
            )}

            <Rows>
              <MetricRow
                k="محادثاتٌ فُتحت"
                note="نافذةٌ لكلّ قناةٍ لا لكلّ إنسان"
                value={fmt.num(total.opened)}
                mid={convDelta
                  ? (
                    <span className="sc-ctx">
                      <Delta dir={convDelta.dir}>
                        <span className="num">{fmt.num(Math.abs(convDelta.diff))}</span>
                      </Delta>
                      {' '}عن <span className="num">{fmt.num(prevTotal.opened)}</span> في المدى السابق
                    </span>
                  )
                  : undefined}
              />
              <MetricRow
                k="رسائلُ الزبائن"
                note="الواردُ وحده — لا ردودُ بوتك ولا موظّفيك"
                value={fmt.num(total.cust)}
                mid={custDelta
                  ? (
                    <span className="sc-ctx">
                      <Delta dir={custDelta.dir}>
                        <span className="num">{fmt.num(Math.abs(custDelta.diff))}</span>
                      </Delta>
                      {' '}عن <span className="num">{fmt.num(prevTotal.cust)}</span> في المدى السابق
                    </span>
                  )
                  : undefined}
              />
              <MetricRow
                k="ردودُ بوتك لكلّ رسالةِ زبون"
                note="أعلى من واحدٍ يعني أنّه يشرح أكثر من أن يُجيب"
                value={total.cust ? (total.bot / total.cust).toFixed(2) : '—'}
                mid={(
                  <span className="sc-ctx">
                    <span className="num">{fmt.num(total.bot)}</span> ردّاً على
                    {' '}<span className="num">{fmt.num(total.cust)}</span> رسالة
                  </span>
                )}
              />
            </Rows>
          </Section>

          {/* ══════════════ ② الاكتفاء الذاتيّ ══════════════ */}
          <Section
            title="الاكتفاء الذاتيّ — مقياسُ نجاح المنتج"
            sub="ما أنهاه البوت وحده: ردَّ فيه، ولم يكتب فيه موظّفٌ بعد فتح النافذة"
          >
            {enough.line && enough.rate ? (
              <Fig
                head="نسبةُ ما أنهاه البوت وحده — يوماً بيوم"
                sub="والخطُّ المقطَّعُ الأفقيُّ نسبةُ المدى السابق كاملاً"
                top={fmt.pct(rateMax)}
                bottom="0"
                axis={timeAxis}
                legend={timeLegend(
                  prevRate != null
                    ? <Leg kind="base">نسبةُ المدى السابق: <span className="num">{fmt.pct(prevRate)}</span></Leg>
                    : undefined,
                )}
                note={(
                  <>
                    ويومٌ بلا محادثةٍ مُفوترةٍ يهبط إلى الأرضيّة — لا «صفرَ اكتفاءٍ» بل
                    «لا مقياسَ يومَها». والنسبةُ الجامعةُ أعلى الشاشة هي ما يُقرَّر عليه.
                  </>
                )}
              >
                <Line
                  label={`نسبةُ ما أنهاه البوت وحده يوماً بيوم — ${Math.round((rate ?? 0) * 100)}% على المدى كلِّه`}
                  values={rateSeries}
                  prev={prevRateSeries}
                  max={rateMax}
                  openEnd={openEnd}
                  base={prevRate ?? undefined}
                />
              </Fig>
            ) : (
              <Thin
                what="لا خطَّ اتّجاهٍ على هذا العدد"
                have={(
                  <>
                    <span className="num">{fmt.num(enough.billedDays)}</span>
                    {' '}{plural(enough.billedDays, 'يومٌ', 'يومان', 'أيّام', 'يوماً')} فيها محادثةٌ
                    مُفوترةٌ، ومجموعُها <span className="num">{fmt.num(selfServe.billed)}</span>
                  </>
                )}
                need={`ونحتاج ثلاثةَ أيّامٍ و${enough.minBilled} محادثةً. والعدُّ أدناه مقيسٌ وصحيح.`}
                onWiden={range.days < 90 ? onWiden : undefined}
              />
            )}

            <Rows>
              <MetricRow
                k="أنهاها البوت وحده"
                note="من المحادثات المُفوترة في هذا المدى"
                value={fmt.num(selfServe.solo)}
                unit={`/ ${fmt.num(selfServe.billed)}`}
                mid={(
                  <>
                    <span className="sc-mw"><Meter pct={rate ?? 0} tone="brand" /></span>
                    <span className="sc-ctx">
                      <span className="num">{rate == null ? '—' : fmt.pct(rate)}</span>
                      {prevRate != null && <> · والسابق <span className="num">{fmt.pct(prevRate)}</span></>}
                    </span>
                  </>
                )}
              />
              <MetricRow
                k="احتاجت موظّفاً"
                note="كتب فيها موظّفٌ بعد فتح النافذة — وهي كلفةُ وقتٍ لا كلفةُ ذكاء"
                value={fmt.num(selfServe.billed - selfServe.solo)}
                mid={(
                  <span className="sc-ctx">
                    والمدى السابق
                    {' '}<span className="num">{fmt.num(selfServe.prevBilled - selfServe.prevSolo)}</span> من
                    {' '}<span className="num">{fmt.num(selfServe.prevBilled)}</span>
                  </span>
                )}
              />
              <MetricRow
                k="وسيطُ زمن الردّ"
                note="نصفُ الردود أسرعُ منه ونصفُها أبطأ — والوسيط لا يخفي ذيلاً"
                value={gaps.medianLatencyMs ? (gaps.medianLatencyMs / 1000).toFixed(1) : '—'}
                unit={gaps.medianLatencyMs ? 'ث' : undefined}
                mid={<Tag line mark={false} label="على مجموعات الردّ الحيّة — لا الساحة" />}
              />
            </Rows>
          </Section>

          {/* ══════════════ ③ أين يعجز ══════════════ */}
          <Section
            title="أين يعجز — قائمةُ عملٍ لمعرفتك"
            sub={enough.gaps
              ? 'الموضوعُ عنوانُ المقطع في معرفتك أنت، لا تصنيفاً نخترعه'
              : undefined}
          >
            {enough.gaps ? (
              <>
                <div className="rp-tbl">
                  <Table
                    columns={gapColumns}
                    rows={gaps.items}
                    keyOf={(g) => g.topic}
                  />
                </div>
                <p className="muted-p">
                  كلُّ سطرٍ موضوعٌ سأل عنه زبونٌ وانتهى بموظّفٍ داخل نفس اليوم. والسؤالُ
                  المقتبَسُ تحت الموضوع سؤالُ زبونٍ حقيقيّ — فأضِف جوابَه إلى معرفتك وستراه
                  ينزل من هذه القائمة في المدى القادم. و«سؤالٌ لا يقابله شيءٌ في معرفتك»
                  أقوى سطرٍ هنا: لا مقطعَ عندك يُجيبه أصلاً.
                </p>
              </>
            ) : (
              <Empty
                title="لا موضوعَ انتهى بموظّفٍ في هذا المدى"
                hint="هذا خبرٌ سارّ إن كان لديك محادثاتٌ فعلاً: لم يعجز بوتك عن موضوعٍ متكرّر. وإن كان المدى خالياً فوسِّعه من الرصيف أسفل."
              />
            )}

            <Rows>
              <MetricRow
                k="تحويلاتٌ إلى موظّف"
                note="ردودٌ قرّر البوت فيها أن يسلّم — أداةُ التحويل نفسُها"
                value={fmt.num(gaps.handoff)}
                mid={(
                  <span className="sc-ctx">
                    من <span className="num">{fmt.num(gaps.runs)}</span> ردّاً ·
                    {' '}والمدى السابق <span className="num">{fmt.num(gaps.prevHandoff)}</span> من
                    {' '}<span className="num">{fmt.num(gaps.prevRuns)}</span>
                  </span>
                )}
              />
              <MetricRow
                k="«لا أعرف»"
                note="ردودٌ قال فيها إنّه لا يملك المعلومة — ثقبٌ في معرفتك لا عطلٌ فيه"
                value={fmt.num(gaps.unknown)}
                mid={gaps.runs
                  ? (
                    <span className="sc-ctx">
                      أي <span className="num">{fmt.pct(gaps.unknown / gaps.runs)}</span> من ردوده
                    </span>
                  )
                  : undefined}
              />
              <MetricRow
                k="أعطالُ أدوات"
                note="أداةٌ نادَتْ نظامَك وفشلت — وهذه عندك لا عند البوت"
                value={fmt.num(gaps.fail)}
                mid={gaps.fail
                  ? <Tag tone="warn" label="راجِع أدواتك في صفحة البوت" />
                  : <Tag tone="ok" label="لا عطلَ في هذا المدى" />}
              />
            </Rows>
          </Section>

          {/* ══════════════ ④ الكلفة ══════════════ */}
          <Section
            title="الكلفة — هل يستحقّ ثمنه"
            sub="كلفةُ الذكاء وحدها: ما دفعناه للنموذج بسبب محادثاتك، لا سعرُ باقتك"
          >
            {enough.volume ? (
              <Fig
                head="كلفةُ الذكاء اليوميّة"
                sub="والخطُّ المقطَّعُ الأفقيُّ متوسّطُ اليوم في المدى السابق"
                top={fmt.money(costMax)}
                bottom="0"
                axis={timeAxis}
                legend={timeLegend(
                  <Leg kind="base">
                    متوسّطُ اليوم في المدى السابق: <span className="num">{fmt.money(prevDailyCost)}</span>
                  </Leg>,
                )}
                note={(
                  <>
                    المجموع <b className="num">{fmt.money(cost.total)}</b> مقابل
                    {' '}<span className="num">{fmt.money(cost.prevTotal)}</span> في المدى السابق.
                  </>
                )}
              >
                <Line
                  label={`كلفةُ الذكاء يوماً بيوم — المجموع ${fmt.money(cost.total)}`}
                  values={costSeries}
                  prev={prevCostSeries}
                  max={costMax}
                  openEnd={openEnd}
                  base={prevDailyCost}
                />
              </Fig>
            ) : (
              <Thin
                what="والكلفةُ اليوميّة تحتاج أيّاماً أكثر"
                have={(
                  <>
                    فيه <span className="num">{fmt.num(enough.liveDays)}</span>
                    {' '}{plural(enough.liveDays, 'يومٌ', 'يومان', 'أيّام', 'يوماً')} فيها حركة
                  </>
                )}
                need="ونحتاج ثلاثةً على الأقلّ. والمجموعُ أدناه مقيسٌ وصحيح."
                onWiden={range.days < 90 ? onWiden : undefined}
              />
            )}

            <Rows>
              <MetricRow
                k="كلفةُ المحادثة الواحدة"
                note="وهذا الرقمُ هو ما يُقارَن بسعر باقتك — لا المجموع"
                value={perConv == null ? '—' : fmt.money(perConv)}
                mid={costDelta && cost.prevPerConv != null
                  ? (
                    <span className="sc-ctx">
                      <Delta dir={costDelta.dir === 'up' ? 'dn' : costDelta.dir === 'dn' ? 'up' : 'flat'}>
                        <span className="num">{fmt.money(Math.abs(costDelta.diff))}</span>
                      </Delta>
                      {' '}عن <span className="num">{fmt.money(cost.prevPerConv)}</span> في المدى السابق
                      {costRatio != null && <> · أي <span className="num">{costRatio.toFixed(2)}</span> ضعفَه</>}
                    </span>
                  )
                  : (
                    <span className="sc-ctx">
                      لا مقارنةَ بعد — المدى السابق فيه
                      {' '}<span className="num">{fmt.num(selfServe.prevBilled)}</span> محادثةٍ مُفوترة
                    </span>
                  )}
              />
              <MetricRow
                k="مجموعُ كلفة الذكاء"
                note="على المدى كلِّه — ويكبر بالحجم وحده فلا يُقرَّر عليه"
                value={fmt.money(cost.total)}
                mid={(
                  <span className="sc-ctx">
                    والمدى السابق <span className="num">{fmt.money(cost.prevTotal)}</span> على
                    {' '}<span className="num">{fmt.num(prevTotal.opened)}</span> محادثة
                  </span>
                )}
              />
              <MetricRow
                k="كلفةُ ما أنهاه البوت وحده"
                note="ما دفعتَه مقابل محادثاتٍ لم تكلّفك دقيقةَ موظّف"
                value={perConv == null ? '—' : fmt.money(perConv * selfServe.solo)}
                mid={(
                  <span className="sc-ctx">
                    <span className="num">{fmt.num(selfServe.solo)}</span> محادثةً بكلفة
                    {' '}<span className="num">{perConv == null ? '—' : fmt.money(perConv)}</span> للواحدة
                  </span>
                )}
              />
            </Rows>
          </Section>

          <Fold summary="كيف نحسب هذه الأرقام، ولماذا لا نرسم خطّاً على ثلاث محادثات">
            <Note>
              <b>«أنهاه البوت وحده»</b> تعريفٌ واحدٌ في المنتج كلِّه: نافذةٌ مُفوترةٌ ردَّ
              فيها بوتك ولم يكتب فيها موظّفٌ بعد فتحها. وهو نفسُ التعريف الذي تقرؤه
              الرئيسيّة — فرقمٌ واحدٌ لا رقمان.
            </Note>
            <Note>
              <b>اليومُ يومٌ عندك لا عند الخادم.</b> كلُّ دلوٍ هنا يُقطَع بتوقيت
              {' '}<span className="num">{range.tz}</span>، وإلّا انقسمت رسائلُ ما بعد منتصف
              الليل بين يومَين فقُرئ هبوطٌ لم يحدث.
            </Note>
            <Note>
              <b>والمقارنةُ بمدًى سابقٍ بطوله تماماً</b> وملاصقٍ له:
              {' '}<span className="num">{prev.from}</span> إلى <span className="num">{prev.to}</span>.
              فلا يومَ يُحسَب في المدَيَين — ويومُ تراكبٍ واحدٌ يكفي ليخترع «تحسُّناً».
            </Note>
            <Note tone="warn">
              <b>ولا نرسم ما لا نقيس.</b> دون <span className="num">{fmt.num(enough.minBilled)}</span>
              {' '}محادثةٍ مُفوترةٍ لا نرسم اتّجاه اكتفاءٍ، ودون ثلاثة أيّامٍ فيها حركةٍ لا
              نرسم خطّاً، ودون <span className="num">20</span> رسالةً لا نسمّي ساعةَ ذروة.
              {openEnd && (
                <> واليومُ الجاري نقطةٌ ناقصةٌ: قطعتُه الأخيرةُ مقطَّعةٌ في كلّ رسم،
                  ومجاميعُ هذا المدى أقلُّ من حقيقتها بما لم يمضِ من اليوم — فالمقارنةُ
                  بالمدى السابق في صالحه بساعاتٍ لا أكثر.</>
              )}
            </Note>
          </Fold>
        </>
      )}
    </>
  );
}
