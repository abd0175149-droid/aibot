'use client';

import { useState } from 'react';
import { useApi, fmt } from '@/lib/useApi';
import { Onboarding } from '@/components/Onboarding';
import {
  PageHead, Stack, Row, Grid, Stat, Meter, Pill, Dot, Note,
  Button, Table, DataView, ErrorBox, type Column, type Tone,
} from '@/components/ui';

/**
 * لوحة المالك — جدول العملاء.
 *
 * ★ المبدأ الذي يحكم الشاشة: **الترتيب هو الشاشة.** لا تُقرأ هذه اللوحة
 *   بالبحث عن اسم، بل من الأعلى نزولاً: الأسوأ صحّةً أوّلاً، ثمّ الأقرب إلى
 *   سقفه. فالفرز بالاسم يجعل العميل المنكسر في آخر الصفحة بمحض هجائه.
 *
 * ★ والفرز يجري **هنا أيضاً** لا في الخادم وحده: استعلام `/console/tenants`
 *   يرتّب بالحوادث الحرجة ثمّ بنسبة السقف، ولا يرى صحّة القناة إطلاقاً —
 *   فعميلٌ توكنه مكسور (بوتٌ صامت، لا عطلٌ ظاهر) كان يهبط تحت من استهلك
 *   ٩٠٪ من سقفه. وصحّةُ القناة تسبق السقف: السقف يُرقّى، والقناة المعطوبة
 *   تعني أنّ الزبائن لا يُجابون الآن.
 *
 * ★ وثلاثة نداءات لا واحد: الجدول لا يحمل الإيراد ولا آخر حادثة، وعمودا
 *   «الهامش» و«آخر حادثة» هما ما يحوّل اللوحة من جردٍ إلى تشخيص. وفشل أيّ
 *   نداءٍ ثانويٍّ **يُعلَن** ولا يُعرض خليّةً فارغة — والخليّة الفارغة تُقرأ
 *   «لا حوادث» وهي أخطر كذبةٍ في الشاشة.
 */

/** صفّ الجدول — من `GET /console/tenants`. */
interface TenantRow {
  id: string;
  name: string;
  status: string;
  plan: string | null;
  windowLimit: number | null;
  windowsUsed: number;
  aiCost: number;
  openCritical: number;
  channelHealth: string;
  knowledgeMode: string;
}

/** صفّ الهامش — من `GET /console/usage`؛ يشمل المستأجرين الفعّالين وحدهم. */
interface MarginRow {
  id: string;
  name: string;
  plan: string | null;
  revenue: number | null;
  aiCost: number;
  windows: number;
  avgTokensPerReply: number;
}

/** حادثة — من `GET /console/incidents`؛ غير المحلولة وحدها، الأحدث أوّلاً. */
interface Incident {
  id: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  status: 'open' | 'ack' | 'resolved';
  count: number;
  lastSeenAt: string;
  tenantName: string | null;
}

/**
 * سقف المنصّة الحاليّ. ليس حدّاً في الخادم بل حدٌّ تشغيليّ: ثلاثة عملاء هو ما
 * يمكن أن يُدار يدويّاً بالجودة الموعودة. ويُعرض رقماً لا يُكتشف بعد الإنشاء.
 */
const TENANT_CAP = 3;

/** سعر التحويل — نفس القيمة المستعملة في شاشة «الهامش» فلا رقمان لعميلٍ واحد. */
const JOD_PER_USD = 0.709;

/** هامشٌ دونه يُراجَع التسعير — نفس حدّ شاشة «الهامش». */
const MARGIN_FLOOR = 0.5;

const HEALTH: Record<string, { tone: Tone; label: string; rank: number }> = {
  error: { tone: 'crit', label: 'عطل', rank: 0 },
  pending: { tone: 'warn', label: 'قيد الربط', rank: 1 },
  none: { tone: 'neutral', label: 'بلا قناة', rank: 2 },
  connected: { tone: 'ok', label: 'سليم', rank: 3 },
};

const KB_MODE: Record<string, string> = {
  full: 'حقنٌ كامل', hybrid: 'أساسيات + استرجاع', rag: 'استرجاعٌ كامل',
};

/* حالةُ المستأجر شارةً — و«تجريبيّ» ليس تحذيراً: ألوان الحالة محجوزةٌ للمعنى
   (سليم/تحذير/حرج) فلا تُنفَق على تصنيفٍ إداريّ. والموقوف حرجٌ فعلاً. */
const STATUS_PILL: Record<string, { tone: Tone; label: string }> = {
  trial: { tone: 'neutral', label: 'تجريبيّ' },
  past_due: { tone: 'warn', label: 'متأخّر السداد' },
  suspended: { tone: 'crit', label: 'موقوف' },
};

function capPct(r: TenantRow): number {
  const limit = Number(r.windowLimit ?? 0);
  return limit > 0 ? Number(r.windowsUsed ?? 0) / limit : 0;
}

/** الأسوأ أوّلاً: حادثةٌ حرجة ← قناةٌ معطوبة ← الأقرب إلى سقفه ← الأغلى كلفة. */
function byRisk(a: TenantRow, b: TenantRow): number {
  const crit = (Number(b.openCritical) > 0 ? 1 : 0) - (Number(a.openCritical) > 0 ? 1 : 0);
  if (crit) return crit;
  const health = (HEALTH[a.channelHealth]?.rank ?? 2) - (HEALTH[b.channelHealth]?.rank ?? 2);
  if (health) return health;
  const cap = capPct(b) - capPct(a);
  if (cap) return cap;
  return Number(b.aiCost ?? 0) - Number(a.aiCost ?? 0);
}

export default function TenantsPage() {
  const tenants = useApi<{ items: TenantRow[] }>('/console/tenants');
  const margin = useApi<{ period: string; items: MarginRow[] }>('/console/usage');
  const incidents = useApi<Incident[]>('/console/incidents');
  const [wizard, setWizard] = useState(false);

  /* الحادثة الأحدث لكلّ عميل. سيل الحوادث يحمل **اسم** المستأجر لا معرّفه،
     فالوصل بالاسم هو ما يتيحه العقد اليوم — والأحدث أوّلاً فأوّل مطابقةٍ هي
     الأحدث. وعميلٌ بلا مطابقةٍ يُرسم صراحةً «لا حوادث مفتوحة» لا فراغاً. */
  const lastIncident = new Map<string, Incident>();
  for (const inc of incidents.data ?? []) {
    if (inc.tenantName && !lastIncident.has(inc.tenantName)) lastIncident.set(inc.tenantName, inc);
  }

  const revenueOf = new Map<string, number | null>(
    (margin.data?.items ?? []).map((m) => [m.id, m.revenue == null ? null : Number(m.revenue)]),
  );

  const newTenantButton = (
    <Button
      variant="primary"
      onClick={() => setWizard(true)}
      disabled={(tenants.data?.items.length ?? 0) >= TENANT_CAP}
      reason={`بلغتَ سقف المنصّة الحاليّ: ${TENANT_CAP} عملاء. السقف تشغيليٌّ لا تقنيّ — ارفعه حين يصير كلّ عميلٍ من الثلاثة مخدوماً بلا تدخّل يدويّ.`}
    >
      + عميل جديد
    </Button>
  );

  return (
    <Stack gap="lg">
      {wizard && (
        <Onboarding
          onClose={() => setWizard(false)}
          onDone={() => {
            setWizard(false);
            void tenants.reload();
            void margin.reload();
          }}
        />
      )}

      <PageHead
        title="العملاء"
        sub="مرتَّبٌ بالمخاطرة لا بالاسم: الأسوأ صحّةً أوّلاً، ثمّ الأقرب إلى سقفه. هذا الترتيب هو الشاشة كلّها."
        actions={(
          <>
            {/* الشهر سلسلةُ آلةٍ لا نصّ: «2025-09» بلا عزلٍ اتجاهيٍّ تُقرأ «09-2025» */}
            {margin.data?.period && <span className="tn-period num">{margin.data.period}</span>}
            {newTenantButton}
          </>
        )}
      />

      <DataView
        state={tenants}
        skeletonRows={5}
        empty={{
          when: (d) => !d.items.length,
          title: 'لا عملاء بعد',
          hint: 'أنشئ أوّل مستأجر — وابدأ ببوتك أنت: بياناتك، ومخاطرتك، وأصدق اختبارٍ ممكن.',
          action: newTenantButton,
        }}
      >
        {(d) => {
          const items = [...d.items].sort(byRisk);
          const critical = items.filter((r) => Number(r.openCritical) > 0).length;
          const broken = items.filter((r) => r.channelHealth === 'error').length;
          const nearCap = items.filter((r) => capPct(r) >= 0.8).length;
          const totalCost = items.reduce((a, r) => a + Number(r.aiCost ?? 0), 0);

          /* الهامش الإجماليّ: إيرادٌ بالدينار وكلفةٌ بالدولار، فالتحويل قبل الطرح.
             ولا يُحسب قبل وصول بيانات الهامش — ورقمٌ مبنيٌّ على نصف بياناته
             يُقرأ انهياراً وهو نقصُ تحميل. */
          const revenueSum = (margin.data?.items ?? [])
            .reduce((a, m) => a + Number(m.revenue ?? 0), 0);
          const grossMargin = margin.data && revenueSum > 0
            ? (revenueSum - totalCost * JOD_PER_USD) / revenueSum
            : null;

          const columns: Array<Column<TenantRow>> = [
            {
              key: 'who',
              head: 'العميل',
              /* اسمٌ يكتبه المالك عن نشاط زبونه — مختلطٌ عربيٍّ ولاتينيٍّ بطبعه،
                 فاتّجاهه من محتواه. ولا مونو عليه: بلا تغطيةٍ عربيّة. */
              cell: (r) => (
                <span className="tn-name">
                  <strong dir="auto">{r.name}</strong>
                  <span className="tn-sub">
                    <span dir="auto">{r.plan ?? 'بلا باقة'}</span>
                    {STATUS_PILL[r.status] && (
                      <Pill tone={STATUS_PILL[r.status]!.tone} label={STATUS_PILL[r.status]!.label} />
                    )}
                  </span>
                </span>
              ),
            },
            {
              key: 'health',
              head: 'الصحّة',
              cell: (r) => {
                const h = HEALTH[r.channelHealth] ?? HEALTH.none!;
                return (
                  <Row gap="xs" wrap={false}>
                    <Dot tone={h.tone} />
                    <span>{h.label}</span>
                  </Row>
                );
              },
            },
            {
              key: 'cap',
              head: 'النوافذ / السقف',
              num: true,
              cell: (r) => {
                const limit = Number(r.windowLimit ?? 0);
                return (
                  <span className="tn-cap">
                    <span className="num">{fmt.num(r.windowsUsed)} / {fmt.num(r.windowLimit)}</span>
                    {limit > 0
                      ? <Meter pct={capPct(r)} />
                      : <span className="tn-dim">بلا باقةٍ فعّالة — لا سقف يُقاس</span>}
                  </span>
                );
              },
            },
            {
              key: 'cost',
              head: 'كلفة الشهر',
              num: true,
              cell: (r) => <span className="num">{fmt.money(r.aiCost)}</span>,
            },
            {
              key: 'margin',
              head: 'الهامش',
              num: true,
              cell: (r) => {
                if (margin.loading) return <span className="tn-dim">جارٍ الحساب…</span>;
                if (margin.error) return <Pill tone="warn" label="لم يُحمَّل" />;
                const rev = revenueOf.get(r.id);
                if (rev == null || rev <= 0) return <span className="tn-dim">لا اشتراك فعّال</span>;

                /* ★ كلفةٌ صفرٌ مع استهلاكٍ فعليّ ليست كلفةً صفراً بل **سعرٌ
                   ناقص**: نموذجٌ بلا صفٍّ في `prices` يُفوتَر صفراً بصمت،
                   فيُعرض الهامش 100٪ بالأخضر. وهذه أخطر ما يُكتب في تقريرٍ
                   يُبنى عليه تسعير — فنقولها بدل أن نُجمّلها. */
                const cost = Number(r.aiCost ?? 0);
                if (cost === 0 && Number(r.windowsUsed ?? 0) > 0) {
                  return <Pill tone="warn" label="الكلفة غير معروفة — لا سعرَ للنموذج" />;
                }

                const m = (rev - cost * JOD_PER_USD) / rev;
                const low = m < MARGIN_FLOOR;
                return (
                  <span className="tn-margin">
                    {/* لا معنى باللون وحده: النصّ يقول ما تقوله النقطة */}
                    <span className="num">{fmt.pct(m)}</span>
                    {low && (
                      <Pill
                        tone={m < 0 ? 'crit' : 'warn'}
                        label={m < 0 ? 'يستهلك أكثر ممّا يدفع' : 'دون هدف الهامش'}
                      />
                    )}
                  </span>
                );
              },
            },
            {
              key: 'kb',
              head: 'المعرفة',
              cell: (r) => (
                <Pill
                  tone={r.knowledgeMode === 'full' ? 'violet' : 'neutral'}
                  label={KB_MODE[r.knowledgeMode] ?? r.knowledgeMode}
                />
              ),
            },
            {
              key: 'inc',
              head: 'آخر حادثة',
              cell: (r) => {
                const open = Number(r.openCritical ?? 0);
                const last = lastIncident.get(r.name);
                if (incidents.loading && !open) return <span className="tn-dim">جارٍ الجلب…</span>;
                if (incidents.error && !open) return <Pill tone="warn" label="لم تُحمَّل" />;
                if (!open && !last) return <span className="tn-dim">لا حوادث مفتوحة</span>;
                return (
                  <span className="tn-inc">
                    {open > 0 && <Pill tone="crit" label={`${fmt.num(open)} حرجة مفتوحة`} />}
                    {last && (
                      <>
                        <span className="tn-inc-t" dir="auto">{last.title}</span>
                        <span className="tn-dim">{fmt.when(last.lastSeenAt)}</span>
                      </>
                    )}
                  </span>
                );
              },
            },
          ];

          return (
            <Stack gap="lg">
              {/* ★ رقمٌ بطوليٌّ واحد **يتبدّل بالحالة**: ما يحتاجك الآن يسبق كلّ
                  شيء، وعند الهدوء يقول الرقم إنّ الهدوء حقيقيّ لا غائب. */}
              <Grid min={180}>
                {critical > 0 ? (
                  <Stat
                    hero href="/console/incidents" tone="crit"
                    value={fmt.num(critical)} label="عملاء بحوادث حرجة ←"
                  />
                ) : broken > 0 ? (
                  <Stat
                    hero href="/console/incidents" tone="crit"
                    value={fmt.num(broken)} label="عملاء بقناةٍ معطوبة — بوتٌ صامت ←"
                  />
                ) : nearCap > 0 ? (
                  <Stat
                    hero tone="warn"
                    value={fmt.num(nearCap)} label="عملاء بلغوا 80٪ من سقفهم"
                  />
                ) : (
                  <Stat
                    hero
                    value={fmt.num(items.length)}
                    label="عملاء نشطون — ولا شيء يحتاجك الآن"
                  />
                )}

                <Stat
                  value={fmt.num(items.length)}
                  unit={`/ ${fmt.num(TENANT_CAP)}`}
                  label="عملاء نشطون · من سقف المنصّة"
                  meter={{ pct: items.length / TENANT_CAP }}
                />

                {/* لا تكرارَ للبطوليّ: ما أخذه البطوليّ لا يُعاد، وما لم يأخذه
                    ولا يزال قائماً يظهر هنا — فالإشارتان تبقيان مرئيّتين. */}
                {critical > 0 && broken > 0 && (
                  <Stat
                    href="/console/incidents" tone="crit"
                    value={fmt.num(broken)} label="عملاء بقناةٍ معطوبة ←"
                  />
                )}

                {nearCap > 0 && (critical > 0 || broken > 0) && (
                  <Stat tone="warn" value={fmt.num(nearCap)} label="عملاء بلغوا 80٪ من سقفهم" />
                )}

                <Stat
                  href="/console/margin"
                  value={fmt.money(totalCost)}
                  label="كلفة النماذج هذا الشهر ←"
                />

                <Stat
                  href="/console/margin"
                  value={grossMargin == null ? '…' : fmt.pct(grossMargin)}
                  label={grossMargin == null ? 'الهامش الإجماليّ — لم يُحسب بعد' : 'الهامش الإجماليّ ←'}
                  tone={grossMargin != null && grossMargin < MARGIN_FLOOR ? 'crit' : undefined}
                />
              </Grid>

              {/* ★ فشل نداءٍ ثانويٍّ يُعلَن ومعه طريقٌ للأمام. وبلا هذا تُقرأ
                  الخليّة الفارغة «لا حوادث» — طمأنينةٌ كاذبة أسوأ من خطأٍ ظاهر. */}
              {margin.error && (
                <ErrorBox
                  message={`عمودا «الهامش» و«الهامش الإجماليّ» غير محسوبَين: ${margin.error}`}
                  onRetry={margin.reload}
                />
              )}
              {incidents.error && (
                <ErrorBox
                  message={`عمود «آخر حادثة» غير محمَّل — عدّاد الحوادث الحرجة في الجدول من مصدرٍ آخر ويبقى صحيحاً: ${incidents.error}`}
                  onRetry={incidents.reload}
                />
              )}

              <Table columns={columns} rows={items} keyOf={(r) => r.id} />
            </Stack>
          );
        }}
      </DataView>

      <Note>
        <b>عمود «المعرفة» ليس زينة.</b> عميلٌ على «حقنٌ كامل» (<code>full</code>) بمعرفةٍ تكبر هو
        الإنذار المبكّر لانفجار الكلفة — تراه هنا قبل أن تراه في الفاتورة.
      </Note>

      <Note>
        <b>والكلفة بالدولار والإيراد بالدينار.</b> الهامش محسوبٌ بعد تحويل الكلفة بسعر{' '}
        <span className="num">{JOD_PER_USD}</span> — نفس حساب شاشة «الهامش»، فلا رقمان مختلفان
        لعميلٍ واحد. وعميلٌ بلا اشتراكٍ فعّال لا هامش له: كلفته قائمة وإيراده صفر، وذاك ما
        تقوله الخليّة لا ما تُخفيه.
      </Note>
    </Stack>
  );
}
