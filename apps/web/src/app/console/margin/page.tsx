'use client';

import { useMemo, useState } from 'react';
import { useApi, fmt, AR_LOCALE } from '@/lib/useApi';
import {
  PageHead, Stack, Row as UiRow, Pill, Tag, Note, DataView, Button, Table, Sheet, Dock,
  Meter, type Column, type Tone,
} from '@/components/ui';
import { Hero, MetricRow, Delta, Section, Bar } from '../parts';

/**
 * لوحة الهامش — إيرادٌ مقابل كلفة، لكلّ عميلٍ ولكلّ شهر.
 *
 * ★ القرار الأوّل: **محورٌ واحد.** الإيراد والكلفة بنفس الوحدة (د.أ)، فكلّ
 *   الأشرطة على مقياسٍ واحدٍ مشترك = أعلى قيمةٍ في الشاشة. محورٌ ثانٍ بمقياسٍ
 *   أوسع للكلفة يُنتج شريطاً قصيراً لسببٍ هندسيٍّ لا اقتصاديّ — أي عميلٌ
 *   خاسرٌ يبدو رابحاً. وكان المقياس القديم يُحسب من الإيراد وحده، فكلفةٌ
 *   تتجاوز أعلى إيرادٍ تُرسم شريطاً خارج الإطار.
 *
 * ★ والقرار الثاني: **الصفر المشبوه يُعلَن لا يُخفى.** كلفةُ صفرٍ مع استهلاكٍ
 *   حقيقيّ ليست ربحاً كاملاً — بل نموذجٌ بلا صفّ سعرٍ مسجَّل، فالكلفة تُجمَع
 *   صفراً والهامش يظهر أعلى من حقيقته. والقديم كان يعرض لهذا الصفّ «100%»
 *   بحرفٍ أخضر، وهي أخطر كذبةٍ ممكنة في تقريرٍ ماليّ. صار يُعرض «—» مع سبب.
 *
 * ── ثلاثةُ أعطالٍ أُصلحت في هذه المرحلة ────────────────────────────────────
 * ★ **الشاشة كانت تدّعي ترتيباً لا تفعله.** يُكتب «الترتيب من أسوأ فرقٍ إلى
 *   أفضله» وما كان هناك فرزٌ إطلاقاً: الصفوف تُرسم بترتيب الخادم. وفرزُ الخادم
 *   نفسه يخلط ديناراً بدولار (`price_monthly - sum(ai_cost_usd)`)، والشاشة
 *   تحوّل الكلفة **قبل** الرسم — فالترتيب كان محسوباً على كمّيّةٍ غير التي
 *   تُرسم. صار الفرز يجري هنا على **نفس** الكمّيّة المرسومة وبالوحدة الواحدة.
 * ★ **و`#tbl` في البطاقة البطوليّة لم يكن له عنصر.** أهمّ نقرةٍ في الشاشة
 *   («عميلاً يحتاج مراجعةً ماليّة ←») لا تفعل شيئاً. صار للجدول معرّفٌ حقيقيّ
 *   وهامشُ تمريرٍ فلا يغطّيه الرأسُ اللاصق.
 * ★ **والصفوف لم تكن جدولاً فلا تنقلب بطاقات.** صارت `Table` نفسَها: جدولٌ
 *   فوق 1100 وبطاقاتٌ دونها — نفسُ المكوّن، لا علامةٌ ثانية.
 *
 * ★ وزيادةٌ يملكها الخادمُ ولم تكن تُستعمل: `/console/usage?period=` — فالشهر
 *   صار مرشّحاً حقيقيّاً في الرصيف يُفتح ورقةً صاعدة، لا سلسلةً معروضةً للقراءة.
 */

/** صفٌّ من `GET /console/usage` — `revenue` من `plans.price_monthly` فيغيب بلا اشتراكٍ فعّال. */
interface Row {
  id: string;
  name: string;
  plan: string | null;
  revenue: number | null;
  aiCost: number;
  windows: number;
  avgTokensPerReply: number;
}

/**
 * سعرُ تحويلٍ ثابت: الإيراد بالدينار (`price_monthly`) والكلفة بالدولار
 * (`ai_cost_usd`). والوحدة الواحدة شرطُ المحور الواحد.
 */
const JOD_PER_USD = 0.709;

/** هدف الهامش. دونه يعني: التسعير خاطئ، أو معرفة العميل أكبر من باقته. */
const TARGET = 0.5;

/** كم شهراً يُعرض في ورقة الشهر — ستّةٌ تكفي لقراءة اتّجاهٍ بلا قائمةٍ لا تنتهي. */
const MONTHS = 6;

type Verdict = {
  tone: Tone;
  label: string;
  /** هل الهامش رقمٌ يُعتمد عليه؟ الكلفة غير المقيسة تُنتج نسبةً كاذبة. */
  measured: boolean;
  risk: boolean;
  why?: string;
};

function judge(rev: number, cost: number, activity: number): Verdict {
  /* ★ الترتيب مقصود: جودة البيانات تُفحص **قبل** الحكم الماليّ. فحكمٌ مبنيٌّ
     على كلفةٍ غير مقيسة هو حكمٌ على فراغ. */
  if (cost === 0 && activity > 0) {
    return {
      tone: 'serious', label: 'كلفةٌ غير مقيسة', measured: false, risk: false,
      why: 'استهلاكٌ حقيقيّ وكلفةٌ صفريّة: لا صفّ سعرٍ مسجَّلٌ للنموذج الذي يردّ به. '
        + 'الكلفة تُجمَع صفراً، فهامش هذا العميل — والهامش الإجماليّ معه — أعلى من حقيقته. '
        + 'أضِف سعر النموذج ليعود الرقم صادقاً.',
    };
  }
  if (rev <= 0) {
    return cost > 0
      ? {
        tone: 'crit', label: 'يستهلك بلا إيراد', measured: false, risk: true,
        why: 'لا اشتراكَ فعّالاً لهذا العميل، وكلفة نماذجه تجري عليك. '
          + 'إمّا تجربةٌ متعمَّدة لها موعد انتهاء، أو اشتراكٌ سقط ولم يُلاحَظ.',
      }
      : { tone: 'neutral', label: 'بلا اشتراكٍ ولا استهلاك', measured: false, risk: false };
  }
  const margin = (rev - cost) / rev;
  if (margin < TARGET) {
    return {
      tone: 'warn', label: `هامشٌ دون ${fmt.pct(TARGET)}`, measured: true, risk: true,
      why: 'راجع التسعير، أو حجم معرفته: الثاني يُعالَج بتحويله إلى وضع الاسترجاع '
        + '— فتصير كلفة ردّه مستقلّةً عن حجم معرفته.',
    };
  }
  return { tone: 'ok', label: 'هامشٌ صحّي', measured: true, risk: false };
}

export default function MarginPage() {
  /** `''` تعني الشهر الجاري — والخادم يقرّره، فلا يُحسب في مكانين. */
  const [period, setPeriod] = useState('');
  const [picker, setPicker] = useState(false);

  const state = useApi<{ period: string; items: Row[] }>(
    period ? `/console/usage?period=${period}` : '/console/usage',
    [period],
  );

  /* ستّةُ أشهرٍ إلى الوراء. الحساب بتوقيت UTC لأنّ الخادم يشتقّ شهره الافتراضيّ
     منه (`toISOString().slice(0,7)`) — فلا يفترق ما تطلبه عمّا يفهمه. */
  const months = useMemo(() => {
    const now = new Date();
    const out: Array<{ value: string; label: string }> = [];
    for (let k = 0; k < MONTHS; k += 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      out.push({
        value,
        label: new Intl.DateTimeFormat(AR_LOCALE, {
          month: 'long', year: 'numeric', timeZone: 'UTC',
        }).format(d),
      });
    }
    return out;
  }, []);

  const periodLabel = months.find((m) => m.value === (period || state.data?.period))?.label
    ?? state.data?.period ?? '…';

  return (
    <Stack gap="lg">
      <PageHead
        title="الهامش"
        sub="الإيراد مقابل كلفة النماذج، لكلّ عميلٍ ولكلّ شهر. الهدف: أن ترى عميلاً يستهلك أكثر ممّا يدفع في شهره الأوّل لا في السادس."
        /* الشهر سلسلةُ آلةٍ («2025-09»): بلا عزلٍ اتجاهيٍّ تُقرأ «09-2025» */
        actions={state.data ? <span className="mg-period num">{state.data.period}</span> : undefined}
      />

      <DataView
        state={state}
        skeletonRows={6}
        empty={{
          when: (d) => !d.items?.length,
          title: 'لا بيانات هامشٍ لهذا الشهر',
          hint: 'تظهر هنا صفوفُ العملاء النشطين بعد أوّل اشتراكٍ فعّال — إيرادُ الباقة مقابل كلفة نماذجه في نفس الشهر. وإن كان الشهر قديماً فقد لا يكون فيه استهلاكٌ أصلاً.',
          action: <a className="btn" href="/console">افتح العملاء ‹</a>,
        }}
      >
        {(d) => {
          const items = d.items ?? [];
          const rows = items.map((r) => {
            const rev = Number(r.revenue ?? 0);
            const cost = Number(r.aiCost ?? 0) * JOD_PER_USD;
            const activity = Number(r.windows ?? 0) + Number(r.avgTokensPerReply ?? 0);
            return { r, rev, cost, v: judge(rev, cost, activity) };
          })
            /* ★ الفرزُ هنا لا في الخادم: استعلامُ `/console/usage` يرتّب بـ
               `price_monthly - sum(ai_cost_usd)` — ديناراً ناقصَ دولار، وهي
               كمّيّةٌ لا تُرسم في أيّ مكان. والشاشة تحوّل قبل الرسم، فكان
               الترتيبُ محسوباً على غير المعروض. فالفرزُ الآن على **نفس** الفرق
               المرسوم وبالوحدة الواحدة: أسوأُ فرقٍ أوّلاً. */
            .sort((a, b) => (a.rev - a.cost) - (b.rev - b.cost));

          /* ★ مقياسٌ واحدٌ من **السلسلتَين** معاً. القديم كان يقيس الإيراد وحده،
             فكلفةٌ تتجاوز أعلى إيرادٍ تُرسم شريطاً أطول من إطاره. */
          const scale = Math.max(1, ...rows.map((x) => Math.max(x.rev, x.cost)));

          const totalRev = rows.reduce((a, x) => a + x.rev, 0);
          const totalCost = rows.reduce((a, x) => a + x.cost, 0);
          const risky = rows.filter((x) => x.v.risk).length;
          const unmeasured = rows.filter((x) => !x.v.measured && x.v.tone === 'serious').length;
          const noRevenue = rows.filter((x) => x.rev <= 0 && x.cost > 0);
          const paid = rows.filter((x) => x.rev > 0 && x.v.measured);
          const worstPaid = paid.length
            ? paid.reduce((w, x) => (
              (x.rev - x.cost) / x.rev < (w.rev - w.cost) / w.rev ? x : w
            ))
            : null;
          const worstPaidMargin = worstPaid ? (worstPaid.rev - worstPaid.cost) / worstPaid.rev : null;
          const gross = totalRev > 0 ? (totalRev - totalCost) / totalRev : null;
          const worstRisky = rows.find((x) => x.v.risk) ?? null;

          const columns: Array<Column<typeof rows[number]>> = [
            {
              key: 'who',
              head: 'العميل',
              cell: ({ r }) => (
                <span className="tn-name">
                  {/* اسمٌ كتبه الزبون: اتّجاهه من محتواه، ولا مونو عليه */}
                  <strong className="mg-name" dir="auto">{r.name}</strong>
                  <span className="tn-sub">
                    <span dir="auto">{r.plan ?? 'بلا باقة'}</span>
                  </span>
                </span>
              ),
            },
            {
              key: 'margin',
              head: 'الهامش',
              num: true,
              cell: ({ rev, cost, v }) => {
                const m = rev > 0 ? (rev - cost) / rev : 0;
                return (
                  <span className="tn-margin">
                    <span className="num">{v.measured ? fmt.pct(m) : '—'}</span>
                    {/* اللونُ مِلكُ الحالة وحدها: الصحّيُّ لا يُنفق عليه وسمٌ
                        ملوَّن — الرقمُ وحده يقول إنّه صحّيّ. */}
                    {(v.risk || !v.measured) && <Pill tone={v.tone} label={v.label} />}
                  </span>
                );
              },
            },
            {
              key: 'bars',
              head: 'إيرادٌ وكلفةٌ على مقياسٍ واحد',
              cell: ({ rev, cost }) => (
                <span className="cn-bars-cell">
                  <span className="mg-bars">
                    <span className="mg-lbl">إيراد</span>
                    <Bar value={rev} scale={scale} kind="rev" />
                    <span className="mg-val">
                      <span className="num">{fmt.num(Math.round(rev))}</span> د.أ
                    </span>

                    <span className="mg-lbl">كلفة</span>
                    <Bar
                      value={cost}
                      scale={scale}
                      kind="cst"
                      goal={rev > 0 ? rev * (1 - TARGET) : undefined}
                    />
                    <span className="mg-val">
                      <span className="num">{cost.toFixed(2)}</span> د.أ
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: 'win',
              head: 'نوافذه',
              num: true,
              cell: ({ r }) => (
                <span className="tn-cap">
                  <span className="num">{fmt.num(r.windows)}</span>
                  <span className="tn-dim">
                    وسيط <span className="num">{fmt.num(r.avgTokensPerReply)}</span> توكن لكلّ ردّ
                  </span>
                </span>
              ),
            },
            {
              key: 'why',
              head: 'ما يعنيه',
              /* خليّةٌ فارغةٌ تُطوى في وضع البطاقات (`.tbl td:empty`)، فالصفُّ
                 الصحّيُّ لا يحمل سطراً ميّتاً بمفتاحٍ بلا قيمة. */
              cell: ({ v }) => (v.why ? <span className="mg-why">{v.why}</span> : null),
            },
          ];

          return (
            <Stack gap="lg">
              {/* ★ البطوليّ يتبدّل بالحالة: ما يحتاج قراراً اليوم يسبق الرقم
                  الذي يطمئن. وستّة أرقامٍ متساوية لا تقول أيّها يهمّ. */}
              {risky > 0 ? (
                <Hero
                  tone="crit"
                  href="#tbl"
                  value={fmt.num(risky)}
                  label={`عملاءُ يحتاجون مراجعةً ماليّة — دون هدف ${fmt.pct(TARGET)} أو بلا اشتراك ←`}
                  ctx={(
                    <>
                      من <span className="num">{fmt.num(rows.length)}</span> عميلاً نشطاً في{' '}
                      {periodLabel}
                      {worstRisky ? <> · أوّلُهم «<span dir="auto">{worstRisky.r.name}</span>»</> : null}
                      {' · '}
                      {gross == null
                        ? 'ولا إيرادَ في هذا الشهر يُقاس عليه'
                        : <>والهامشُ الإجماليّ <span className="num">{fmt.pct(gross)}</span></>}
                      {' · '}والوسمُ يضمّ «دون الهدف» و«يستهلك بلا إيراد»: الثاني ليس هامشاً
                      منخفضاً بل اشتراكاً ساقطاً.
                    </>
                  )}
                />
              ) : (
                <Hero
                  goal
                  value={gross == null ? '—' : fmt.pct(gross)}
                  label="الهامشُ الإجماليّ — ولا عميلَ دون الهدف"
                  meter={gross == null ? undefined : { pct: Math.max(0, gross), tone: 'ok' }}
                  ctx={(
                    <>
                      إيرادُ <span className="num">{fmt.num(Math.round(totalRev))}</span> د.أ ناقصَ
                      كلفةِ نماذجَ <span className="num">{totalCost.toFixed(2)}</span> د.أ في{' '}
                      {periodLabel} · والعلامةُ على المقياس هي هدفُ الهامش{' '}
                      <span className="num">{fmt.pct(TARGET)}</span> — فتقرأ أين أنت من الحدّ
                      لا كم أنت فقط.
                    </>
                  )}
                />
              )}

              {/* ★ رقمٌ إجماليٌّ مبنيٌّ على كلفةٍ ناقصة يُقال إنّه ناقص — وإلّا
                  اتُّخذ قرار تسعيرٍ على رقمٍ متحيّزٍ نحو التطمين. */}
              {unmeasured > 0 && (
                <Note tone="warn">
                  <b>الهامش الإجماليّ أعلى من حقيقته.</b>{' '}
                  <span className="num">{fmt.num(unmeasured)}</span>{' '}
                  {unmeasured === 1 ? 'عميلٌ كلفته' : 'عملاءَ كلفتهم'} غير مقيسة: النموذج الذي يردّ به
                  لا صفّ سعرٍ مسجَّلاً له، فتُجمَع كلفته صفراً. أضِف الأسعار ثمّ أعِد قراءة هذا الرقم.
                </Note>
              )}

              {/* ★ صفوفُ معايير: أصلُ الرقم مكتوبٌ لا مُستنتَج، وكلُّ صفٍّ
                  يحمل سياقه في عموده الثالث. */}
              <Section title="من أين يأتي الرقم" sub={`عن ${periodLabel}`}>
                <div className="rows cn-rows">
                  <MetricRow
                    k="إيرادُ الاشتراكات الفعّالة"
                    note="من `price_monthly` للباقة المشترَك بها فعلاً — لا من فاتورةٍ صادرة"
                    value={fmt.num(Math.round(totalRev))}
                    unit="د.أ"
                    mid={<Tag tone="neutral" line label={`${fmt.num(paid.length)} مدفوعاً`} mark={false} />}
                  />

                  <MetricRow
                    k="كلفةُ نماذج العملاء"
                    note={`ما دُفع للنموذج في هذا الشهر، محوَّلاً بسعر ${JOD_PER_USD} — والوحدة الواحدة شرطُ المقياس الواحد`}
                    value={totalCost.toFixed(2)}
                    unit="د.أ"
                    mid={totalRev > 0 ? (
                      <Delta dir="flat">
                        <span className="num">{fmt.pct(totalCost / totalRev)}</span> من الإيراد
                      </Delta>
                    ) : null}
                  />

                  <MetricRow
                    k="أضعفُ هامشٍ بين المدفوعين"
                    note={worstPaid
                      ? worstPaid.r.name
                      : 'لا عميلَ مدفوعاً بكلفةٍ مقيسةٍ في هذا الشهر'}
                    value={worstPaidMargin == null ? '—' : fmt.pct(worstPaidMargin)}
                    href="#tbl"
                    mid={worstPaidMargin == null ? null : (
                      <>
                        <Meter
                          pct={Math.max(0, worstPaidMargin)}
                          tone={worstPaidMargin < TARGET ? 'crit' : 'ok'}
                        />
                        <Delta dir={worstPaidMargin >= TARGET ? 'up' : 'dn'}>
                          {worstPaidMargin >= TARGET ? 'فوق الهدف بـ' : 'دون الهدف بـ'}{' '}
                          <span className="num">
                            {fmt.num(Math.round(Math.abs(worstPaidMargin - TARGET) * 100))}
                          </span>{' '}
                          نقطة
                        </Delta>
                      </>
                    )}
                  />

                  <MetricRow
                    k="عملاءُ يستهلكون بلا إيراد"
                    note="تجربةٌ متعمَّدة لها موعدُ انتهاء، أو اشتراكٌ سقط ولم يُلاحَظ — والفرقُ قرارٌ لا معلومة"
                    value={fmt.num(noRevenue.length)}
                    mid={noRevenue.length > 0
                      ? (
                        <Pill
                          tone="crit"
                          label={`كلفتُهم عليك ${noRevenue
                            .reduce((a, x) => a + x.cost, 0).toFixed(2)} د.أ`}
                        />
                      )
                      : <Tag tone="ok" label="كلُّ عميلٍ فعّالٍ له إيراد" />}
                  />
                </div>
              </Section>

              {/* ★ الجدولُ صار `Table`: ينقلب بطاقاتٍ دون 1100 — نفسُ المكوّن،
                  لا علامةٌ ثانية. ومعرّفُه حقيقيٌّ فالقفزةُ من البطوليّ تصل. */}
              <Section
                id="tbl"
                anchor
                title="سطراً سطراً"
                sub={(
                  <>
                    <span className="num">{fmt.num(rows.length)}</span> عميلاً — أسوأُ فرقٍ
                    (إيراد − كلفة) أوّلاً
                  </>
                )}
              >
                {/* ★ المحور مكتوبٌ لا مُستنتَج: مقياسٌ واحدٌ مشتركٌ للسلسلتَين،
                    ومداه معلَنٌ فيصير طول الشريط قابلاً للقراءة بلا تخمين. */}
                <p className="mg-axis">
                  السلسلتان على <b>مقياسٍ واحد</b> — من صفر إلى{' '}
                  <span className="num">{fmt.num(Math.round(scale))}</span> د.أ، فطولُ الشريطَين
                  يُقارَن مباشرةً. والعلامةُ على شريط الكلفة هي الكلفةُ التي يصير عندها الهامشُ
                  هدفَه — أي <span className="num">{fmt.pct(TARGET)}</span> من إيراده: ما تجاوزها
                  فهامشُه دون الهدف. والترتيبُ يجري في هذه الشاشة بالوحدة المرسومة نفسها — لا في الخادم حيث
                  يُخلط الدينارُ بالدولار.
                </p>

                <p className="cn-legend">
                  <span><i className="cn-sw rev" aria-hidden="true" />إيرادُ اشتراكه</span>
                  <span><i className="cn-sw cst" aria-hidden="true" />كلفةُ نماذجه</span>
                  <span>
                    <i className="cn-sw-goal" aria-hidden="true" />
                    هدفُ الهامش <span className="num">{fmt.pct(TARGET)}</span>
                  </span>
                </p>

                <Table columns={columns} rows={rows} keyOf={({ r }) => r.id} />
              </Section>

              <Note tone="warn">
                <b>راجع هذه الشاشة أسبوعيّاً.</b> عميلٌ هامشه دون <span className="num">{fmt.pct(TARGET)}</span>{' '}
                يعني أحد أمرين: التسعير خاطئ، أو معرفته أكبر من باقته. والثاني يُعالَج بتحويله
                إلى وضع الاسترجاع — فتصير كلفة ردّه مستقلّةً عن حجم معرفته.
              </Note>

            </Stack>
          );
        }}
      </DataView>

      {/* ★ الرصيف: مرشّحُ الشاشة الوحيد — الشهرُ — في مدى الإبهام. */}
      <div className="cn-dock">
        <Dock hint="الأرقامُ كلُّها عن الشهر المختار: إيرادُ اشتراكاته وكلفةُ نماذجه ونوافذُه المفوترة فيه.">
          <UiRow gap="sm">
            <Button size="lg" onClick={() => setPicker(true)}>
              الشهر: {periodLabel} ▾
            </Button>
            {period ? (
              <Button size="lg" onClick={() => setPeriod('')}>عُد إلى الشهر الجاري</Button>
            ) : null}
          </UiRow>
        </Dock>
      </div>

      <Sheet
        open={picker}
        kind="menu"
        title="الشهر"
        onClose={() => setPicker(false)}
        hint="الشهر المحسوب في الخادم هو ما تراه في رأس الشاشة — وهذه القائمة تطلب شهراً بعينه."
      >
        <div className="opts">
          {months.map((m, i) => (
            <button
              key={m.value}
              type="button"
              className="opt"
              aria-pressed={(period || state.data?.period) === m.value}
              onClick={() => { setPeriod(i === 0 ? '' : m.value); setPicker(false); }}
            >
              <span className="opt-t">
                {m.label}
                <span className="opt-n">
                  <span className="num">{m.value}</span>
                  {i === 0 ? ' · الشهر الجاري حتّى الآن' : ''}
                </span>
              </span>
              <span className="opt-e">
                {(period || state.data?.period) === m.value
                  ? <span className="opt-ck" aria-hidden="true">✓</span>
                  : null}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </Stack>
  );
}
