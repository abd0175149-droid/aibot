'use client';

import { useApi, fmt } from '@/lib/useApi';
import {
  PageHead, Stack, Row, Card, Grid, Stat, Pill, Note, DataView, Button,
  type Tone,
} from '@/components/ui';

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
      tone: 'serious', label: 'الكلفة غير مقيسة', measured: false, risk: false,
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

/**
 * شريطٌ واحدٌ على المقياس المشترك.
 *
 * ★ النسبة في **سمة** SVG لا في `style` — والسمة تقبل `%` فتقرأها من عرض
 *   العنصر نفسه، بلا `viewBox` فلا يتشوّه شيء. والتعبئة بصنفٍ لأنّ `var()`
 *   لا تعمل داخل سمات SVG.
 * ★ و«من اليمين»: `x = 100 - w` يُنمي الشريط من حدّ القراءة لا نحوه.
 * ★ وأرضيّةٌ مرئيّة: كلفةٌ ضئيلةٌ موجبة تُرسم أثراً — والصفر وحده يبقى فارغاً،
 *   فالفرق بين «لا كلفة» و«كلفةٌ بالكاد» معلومةٌ لا زينة.
 */
function Bar({ value, scale, kind }: { value: number; scale: number; kind: 'rev' | 'cst' }) {
  const raw = (value / scale) * 100;
  const w = value <= 0 ? 0 : Math.min(100, Math.max(raw, 1.5));
  return (
    <svg className="mg-bar" height="9" aria-hidden="true" focusable="false">
      <rect className="trk" x="0" y="0" width="100%" height="9" rx="2" />
      <rect className={kind} x={`${100 - w}%`} y="0" width={`${w}%`} height="9" rx="2" />
    </svg>
  );
}

export default function MarginPage() {
  const state = useApi<{ period: string; items: Row[] }>('/console/usage');

  return (
    <Stack gap="lg">
      <PageHead
        title="الهامش"
        sub="الإيراد مقابل كلفة النماذج، لكلّ عميلٍ ولكلّ شهر. الهدف: أن ترى عميلاً يستهلك أكثر ممّا يدفع في شهره الأوّل لا في السادس."
        actions={state.data ? <span className="mg-period num">{state.data.period}</span> : undefined}
      />

      <DataView
        state={state}
        skeletonRows={6}
        empty={{
          when: (d) => !d.items?.length,
          title: 'لا بيانات هامشٍ لهذا الشهر',
          hint: 'تظهر هنا صفوفُ العملاء النشطين بعد أوّل اشتراكٍ فعّال — إيرادُ الباقة مقابل كلفة نماذجه في نفس الشهر.',
          action: <Button onClick={() => { location.href = '/console'; }}>افتح العملاء</Button>,
        }}
      >
        {(d) => {
          const items = d.items ?? [];
          const rows = items.map((r) => {
            const rev = Number(r.revenue ?? 0);
            const cost = Number(r.aiCost ?? 0) * JOD_PER_USD;
            const activity = Number(r.windows ?? 0) + Number(r.avgTokensPerReply ?? 0);
            return { r, rev, cost, v: judge(rev, cost, activity) };
          });

          /* ★ مقياسٌ واحدٌ من **السلسلتَين** معاً. القديم كان يقيس الإيراد وحده،
             فكلفةٌ تتجاوز أعلى إيرادٍ تُرسم شريطاً أطول من إطاره. */
          const scale = Math.max(1, ...rows.map((x) => Math.max(x.rev, x.cost)));

          const totalRev = rows.reduce((a, x) => a + x.rev, 0);
          const totalCost = rows.reduce((a, x) => a + x.cost, 0);
          const risky = rows.filter((x) => x.v.risk).length;
          const unmeasured = rows.filter((x) => !x.v.measured && x.v.tone === 'serious').length;

          return (
            <Stack gap="lg">
              {/* ★ البطوليّ يتبدّل بالحالة: ما يحتاج قراراً اليوم يسبق الرقم
                  الذي يطمئن. وستّة أرقامٍ متساوية لا تقول أيّها يهمّ. */}
              <Grid min={220}>
                {/* ★ الوسم يصف ما يُحسب بالضبط: `risk` يضمّ «دون الهدف»
                    **و**«يستهلك بلا إيراد»، والثاني ليس هامشاً منخفضاً بل
                    اشتراكاً ساقطاً. فالوسم العامّ يصدق على الاثنين. */}
                {risky ? (
                  <Stat
                    hero tone="crit"
                    href="#tbl"
                    value={fmt.num(risky)}
                    label={`عميلاً يحتاج مراجعةً ماليّة — دون هدف ${fmt.pct(TARGET)} أو بلا اشتراك ←`}
                  />
                ) : (
                  <Stat
                    hero
                    value={totalRev ? fmt.pct((totalRev - totalCost) / totalRev) : '—'}
                    label="الهامش الإجماليّ — ولا عميلَ دون الهدف"
                  />
                )}

                <Stat value={fmt.num(Math.round(totalRev))} unit="د.أ" label="إيراد الاشتراكات هذا الشهر" />
                {/* الكلفة تُفصَّل لكلّ عميلٍ في شاشة العملاء، ومعها ما يفسّرها:
                    وضع المعرفة وحجم النوافذ. فالرقم يُوصِل لا يُشخّص فقط. */}
                <Stat
                  href="/console"
                  value={totalCost.toFixed(2)} unit="د.أ"
                  label="كلفة النماذج — افتح تفصيلها لكلّ عميل ←"
                />
                {risky ? (
                  <Stat
                    value={totalRev ? fmt.pct((totalRev - totalCost) / totalRev) : '—'}
                    label="الهامش الإجماليّ"
                  />
                ) : (
                  <Stat href="/console" value={fmt.num(rows.length)} label="عميلاً نشطاً في هذا الشهر ←" />
                )}
              </Grid>

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

              <Card title="كلّ عميلٍ على حدة">
                {/* ★ المحور مكتوبٌ لا مُستنتَج: مقياسٌ واحدٌ مشتركٌ للسلسلتَين،
                    ومداه معلَنٌ فيصير طول الشريط قابلاً للقراءة بلا تخمين. */}
                <p className="mg-axis">
                  السلسلتان على <b>مقياسٍ واحد</b> — من صفر إلى{' '}
                  <span className="num">{fmt.num(Math.round(scale))}</span> د.أ.
                  فطولُ الشريطَين يُقارَن مباشرةً. والترتيب من أسوأ فرقٍ (إيراد − كلفة) إلى أفضله.
                </p>

                <div>
                  {rows.map(({ r, rev, cost, v }) => {
                    const margin = rev > 0 ? (rev - cost) / rev : 0;
                    return (
                      <div key={r.id} className="mg-row">
                        <Row gap="sm" end>
                          {/* اسمٌ كتبه الزبون: اتّجاهه من محتواه، ولا مونو عليه */}
                          <span className="mg-name" dir="auto">{r.name}</span>
                          {r.plan
                            ? <Pill tone="neutral" label={`⁨${r.plan}⁩`} mark={false} />
                            : <Pill tone="neutral" label="بلا باقة" mark={false} />}
                          <span className="num mg-val">
                            {v.measured ? fmt.pct(margin) : '—'}
                          </span>
                        </Row>

                        <div className="mg-bars">
                          <span className="mg-lbl">إيراد</span>
                          <Bar value={rev} scale={scale} kind="rev" />
                          <span className="num mg-val">{fmt.num(Math.round(rev))}</span>

                          <span className="mg-lbl">كلفة</span>
                          <Bar value={cost} scale={scale} kind="cst" />
                          <span className="num mg-val">{cost.toFixed(2)}</span>
                        </div>

                        <div className="mg-flags">
                          <Pill tone={v.tone} label={v.label} />
                          <span className="mg-lbl">
                            <span className="num">{fmt.num(r.windows)}</span> نافذة مُفوتَرة
                            {' · '}وسيط <span className="num">{fmt.num(r.avgTokensPerReply)}</span> توكن لكلّ ردّ
                          </span>
                        </div>

                        {v.why && <p className="mg-why">{v.why}</p>}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Note tone="warn">
                <b>راجع هذه الشاشة أسبوعيّاً.</b> عميلٌ هامشه دون <span className="num">{fmt.pct(TARGET)}</span>{' '}
                يعني أحد أمرين: التسعير خاطئ، أو معرفته أكبر من باقته. والثاني يُعالَج بتحويله
                إلى وضع الاسترجاع — فتصير كلفة ردّه مستقلّةً عن حجم معرفته.
              </Note>
            </Stack>
          );
        }}
      </DataView>
    </Stack>
  );
}
