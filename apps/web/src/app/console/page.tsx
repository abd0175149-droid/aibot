'use client';

import { useEffect, useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
/* ★ نفسُ الاسم الذي يراه العميل. ومكالمةُ دعمٍ يقول فيها العميل «يقرأ
   نصّي كاملاً» والموظّفُ أمامه «حقنٌ كامل» تُنتج تشخيصاً لحالةٍ أخرى. */
import { KB_MODE, kbModeLabel } from '@/lib/terms';
import { get, post, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { Onboarding } from '@/components/Onboarding';
import { ChannelConnectForm } from '@/components/ChannelConnectForm';
import { BotSeedForm } from '@/components/BotSeedForm';
import {
  PageHead, Stack, Row, Meter, Pill, Tag, Dot, Note, Button, Table, DataView,
  ErrorBox, Sheet, Dock, KV, KVRow, Field, Input, CodeBlock, type Column, type Tone,
} from '@/components/ui';
import { Bar } from './parts';
import { Hero, MetricRow, Delta, Section, Fold } from '@/components/screen';

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
 *
 * ★ وما أصلحته هذه المرحلة، وهو أكبر عطلٍ فيها: **الجدول كان بلا وِجهةٍ ولا
 *   فعل.** ترى «عطل» أمام اسم عميلٍ ولا تملك طريقاً إليه — لا صفٌّ يُضغط، ولا
 *   ورقةٌ تُفتح، ولا فعلٌ واحد. فصار لكلّ صفٍّ **ورقةٌ صاعدة** تحمل تفصيله
 *   (إيرادُه وكلفتُه على مقياسٍ واحدٍ مشترك · نوافذُه · آخرُ حادثته)، ومنها
 *   طريقٌ إلى حوادثه، ومفتاحُ إيقافِ بوته خلف **بوّابة كتابة** — لأنّ فعلاً
 *   يُصمت بوت كلّ زبائن العميل لا يكون نقرةً واحدةً في آخر الصفّ.
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
  /** هل للعميل نسخةُ بوتٍ منشورة — و`knowledgeMode` تُقنَّع بـ'full' عند غيابها فلا تُقرأ دليلاً. */
  botSeeded: boolean;
  ownerEmail: string | null;
  /** مالكٌ بكلمةٍ مؤقّتةٍ لم يدخل قطّ — أثرُ معالجٍ أُغلق قبل أن تُنسخ الكلمة. */
  ownerPending: boolean;
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

/**
 * صحّةُ القناة: شارةٌ ورتبةٌ في الترتيب **وسببٌ مكتوب**.
 * والسببُ ليس زينةً: «عطل» كلمةٌ لا تقول ماذا أفعل، وورقةُ العميل تقولها.
 */
const HEALTH: Record<string, { tone: Tone; label: string; rank: number; why: string }> = {
  error: {
    tone: 'crit', label: 'عطل', rank: 0,
    why: 'الفحصُ الدوريُّ يفشل: بوتُ هذا العميل لا يُجيب زبائنه الآن. افتح حوادثه — نوعُ العطل مكتوبٌ فيها مع خطواته.',
  },
  pending: {
    tone: 'warn', label: 'قيد الربط', rank: 1,
    why: 'الربطُ بدأ ولم يكتمل، فلا رسالةَ تصل ولا زبونَ يُجاب. والخطوةُ الناقصة عند العميل في لوحة ميتا لا عندك.',
  },
  none: {
    tone: 'neutral', label: 'بلا قناة', rank: 2,
    why: 'لا قناةَ موصولةً بعد: البوتُ جاهزٌ ولا مدخلَ للرسائل إليه.',
  },
  connected: {
    tone: 'ok', label: 'سليم', rank: 3,
    why: 'آخرُ فحصٍ دوريٍّ سليم: التوكن يعمل والاشتراكُ في الحقول قائم.',
  },
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
  const can = useCan();
  const { toast, node: toastNode } = useToast();

  const [wizard, setWizard] = useState(false);
  /** العميلُ المفتوحةُ ورقتُه — معرّفٌ لا كائن، فلا تتعلّق الورقةُ بنسخةٍ قديمة. */
  const [openId, setOpenId] = useState<string | null>(null);
  /* ربطُ/تجديدُ قناةٍ لعميلٍ قائم — الفعل الذي كان يمرّ بـssh وسكربت. */
  const [connectFor, setConnectFor] = useState<string | null>(null);
  /* بذرُ بوتٍ لعميلٍ بقي بلا نسخةٍ منشورة — الفعل الثاني الذي كان بلا بابٍ في اللوحة. */
  const [seedFor, setSeedFor] = useState<string | null>(null);
  /** كلمةٌ مؤقّتةٌ مولَّدةٌ للتوّ — تُعرض مرّةً واحدةً ثمّ تُنسى كما في المعالج. */
  const [ownerTemp, setOwnerTemp] = useState<{ email: string; pass: string } | null>(null);
  /** بيانا الويبهوك بعد قراءتهما أو بعد ربطٍ — و`verifyToken` سرٌّ في هذا المستودع. */
  const [webhook, setWebhook] = useState<{ url: string; token: string | null } | null>(null);
  /* علَمٌ مستقلٌّ للتوليد: `busy` يقود زرَّ إيقاف البوت، وأخطرُ زرٍّ في الشاشة
     لا يُظهر «…» في أثناء فعلٍ لا علاقةَ له به. */
  const [resetting, setResetting] = useState(false);
  const [killWord, setKillWord] = useState('');
  const [busy, setBusy] = useState(false);

  /* ★ مفتاحُ الهروب وإدارةُ التركيز صارا داخل `Sheet` — لا نسخةَ هنا. */

  /**
   * ★ وكلُّ ما قد يحمل سرَّ عميلٍ يُصفَّر هنا: كلمةٌ مؤقّتةٌ أو توكنُ تحقّقٍ يبقى
   *   بعد إغلاق الورقة يظهر في **ورقة عميلٍ آخر** — وذاك أسوأ من غيابه.
   */
  function closeSheet() {
    setOpenId(null);
    setKillWord('');
    setOwnerTemp(null);
    setWebhook(null);
  }

  /**
   * إيقافُ بوت عميل — الفعلُ الذي تحتاجه الثالثة فجراً، وأخطرُ ما في الشاشة.
   * كلُّ رسالةٍ تصل بعده تنتظر موظّفاً من عند العميل، ولا يرجع إلّا بتشغيلٍ
   * يدويّ. ولذلك هو خلف طيّةٍ وبوّابةِ كتابةٍ تُطابق الاسم حرفاً حرفاً.
   */
  async function killBot(r: TenantRow) {
    setBusy(true);
    try {
      await post(`/console/tenants/${r.id}/kill-bot`);
      toast(`أُوقف بوت ${r.name} — يصمت عن كلّ زبائنه الآن، ولا يعود إلّا بتشغيلٍ يدويّ.`);
      closeSheet();
      await tenants.reload();
    } catch (e) {
      /* نداءٌ فاشلٌ يصمت يجعل من ضغط يظنّ أنّ البوت أُوقف — وهو أخطر ظنٍّ
         ممكنٍ في هذا الفعل بعينه. */
      toast(e instanceof ApiError ? e.message : 'تعذّر إيقاف البوت. أعِد المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * ★ توليدُ كلمةٍ مؤقّتةٍ لمالك عميل — البابُ الذي كان `ops/set-password.ts` وحده.
   *   والكلمةُ تُعرض مرّةً واحدةً ولا تُخزَّن نصّاً، وكلُّ جلسات المالك تسقط.
   */
  async function resetOwner(r: TenantRow) {
    setResetting(true);
    try {
      const out = await post<{ email: string; tempPassword: string; sessionsRevoked: number }>(
        `/console/tenants/${r.id}/owner/reset-password`,
      );
      setOwnerTemp({ email: out.email, pass: out.tempPassword });
      toast(`أُسقطت ${out.sessionsRevoked} جلسةً — انسخ الكلمة الآن، فلا تُعاد إلى أيّ شاشة.`);
      await tenants.reload();
    } catch (e) {
      /* نداءٌ فاشلٌ يصمت يجعل من ضغط يظنّ أنّ كلمةً وُلدت — فيقول للعميل سرّاً لا وجودَ له. */
      toast(e instanceof ApiError ? e.message : 'تعذّر توليد كلمةٍ مؤقّتة. أعِد المحاولة.');
    } finally { setResetting(false); }
  }

  /**
   * ★ قراءةُ الـCallback URL وتوكن التحقّق لعميلٍ موصولٍ سلفاً.
   *   `verifyToken` مُسقَطٌ عمداً من `GET /channels` ومحجوبٌ في السجلّ، فمعالجٌ
   *   أُغلق قبل خطوته الأخيرة كان يُفقده بلا رجعةٍ إلّا بـ`ssh`.
   */
  async function readWebhook(r: TenantRow) {
    try {
      const out = await get<{
        publicId: string;
        channels: Array<{ kind: string; status: string; verifyToken: string | null }>;
      }>(`/console/tenants/${r.id}/channel`);
      const wa = out.channels.find((c) => c.kind === 'whatsapp_cloud') ?? out.channels[0];
      setWebhook({
        url: `${window.location.origin}/api/webhooks/whatsapp/${out.publicId}`,
        token: wa?.verifyToken ?? null,
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّرت قراءة بيانات الويبهوك.');
    }
  }

  /* الحادثة الأحدث لكلّ عميل. سيل الحوادث يحمل **اسم** المستأجر لا معرّفه،
     فالوصل بالاسم هو ما يتيحه العقد اليوم — والأحدث أوّلاً فأوّل مطابقةٍ هي
     الأحدث. وعميلٌ بلا مطابقةٍ يُرسم صراحةً «لا حوادث مفتوحة» لا فراغاً. */
  const lastIncident = new Map<string, Incident>();
  for (const inc of incidents.data ?? []) {
    if (inc.tenantName && !lastIncident.has(inc.tenantName)) lastIncident.set(inc.tenantName, inc);
  }

  const marginOf = new Map<string, MarginRow>(
    (margin.data?.items ?? []).map((m) => [m.id, m]),
  );

  const createButton = (wide: boolean) => (
    <Button
      variant="primary"
      size={wide ? 'lg' : 'md'}
      wide={wide}
      onClick={() => setWizard(true)}
      disabled={(tenants.data?.items.length ?? 0) >= TENANT_CAP || can.readOnly}
      reason={can.readOnly
        ? 'انتحالٌ نشط — قراءةٌ فقط. أنهِ الانتحال من اللافتة أعلى الشاشة لتعود إلى حسابك.'
        : `بلغتَ سقف المنصّة الحاليّ: ${TENANT_CAP} عملاء. السقف تشغيليٌّ لا تقنيّ — ارفعه حين يصير كلّ عميلٍ من الثلاثة مخدوماً بلا تدخّل يدويّ.`}
    >
      + عميل جديد
    </Button>
  );

  return (
    <Stack gap="lg">
      {toastNode}

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
        actions={
          /* الشهر سلسلةُ آلةٍ لا نصّ: «2025-09» بلا عزلٍ اتجاهيٍّ تُقرأ «09-2025» */
          margin.data?.period
            ? <span className="tn-period num">{margin.data.period}</span>
            : undefined
        }
      />

      <DataView
        state={tenants}
        skeletonRows={5}
        empty={{
          when: (d) => !d.items.length,
          title: 'لا عملاء بعد',
          hint: 'أنشئ أوّل مستأجر — وابدأ ببوتك أنت: بياناتك، ومخاطرتك، وأصدق اختبارٍ ممكن.',
          action: createButton(false),
        }}
      >
        {(d) => {
          const items = [...d.items].sort(byRisk);
          const critical = items.filter((r) => Number(r.openCritical) > 0).length;
          const broken = items.filter((r) => r.channelHealth === 'error').length;
          const pending = items.filter((r) => r.channelHealth === 'pending').length;
          const nearCap = items.filter((r) => capPct(r) >= 0.8).length;
          const totalCost = items.reduce((a, r) => a + Number(r.aiCost ?? 0), 0);
          const sumCritical = items.reduce((a, r) => a + Number(r.openCritical ?? 0), 0);
          const worstCap = items.reduce((m, r) => Math.max(m, capPct(r)), 0);
          const worstCrit = items.find((r) => Number(r.openCritical) > 0) ?? null;
          const worstBroken = items.find((r) => r.channelHealth === 'error') ?? null;

          /* الهامش الإجماليّ: إيرادٌ بالدينار وكلفةٌ بالدولار، فالتحويل قبل الطرح.
             ولا يُحسب قبل وصول بيانات الهامش — ورقمٌ مبنيٌّ على نصف بياناته
             يُقرأ انهياراً وهو نقصُ تحميل. */
          const revenueSum = (margin.data?.items ?? [])
            .reduce((a, m) => a + Number(m.revenue ?? 0), 0);
          const costJod = totalCost * JOD_PER_USD;
          const grossMargin = margin.data && revenueSum > 0
            ? (revenueSum - costJod) / revenueSum
            : null;

          /** إيرادُ العميل بالدينار — أو `null` إن لا اشتراكَ فعّالاً له. */
          const revOf = (r: TenantRow): number | null => {
            const m = marginOf.get(r.id);
            return m?.revenue == null ? null : Number(m.revenue);
          };
          /** وكلفتُه بالدينار: الوحدةُ الواحدة شرطُ المقياس الواحد. */
          const costOf = (r: TenantRow): number => Number(r.aiCost ?? 0) * JOD_PER_USD;

          /* مقياسٌ واحدٌ مشتركٌ لكلّ الأوراق: أعلى قيمةٍ في الشاشة كلّها، فطولُ
             شريطٍ في ورقة عميلٍ يُقارَن بطولِ شريطٍ في ورقة غيره. */
          const scale = Math.max(1, ...items.map((r) => Math.max(revOf(r) ?? 0, costOf(r))));

          const sel = openId ? items.find((r) => r.id === openId) ?? null : null;
          const selRev = sel ? revOf(sel) : null;
          const selCost = sel ? costOf(sel) : 0;
          const selMargin = sel && selRev != null && selRev > 0 ? (selRev - selCost) / selRev : null;
          const selUsage = sel ? marginOf.get(sel.id) : undefined;
          const selHealth = sel ? HEALTH[sel.channelHealth] ?? HEALTH.none! : null;
          const selLast = sel ? lastIncident.get(sel.name) : undefined;
          const selLimit = sel ? Number(sel.windowLimit ?? 0) : 0;
          const selUnmeasured = Boolean(
            sel && Number(sel.aiCost ?? 0) === 0 && Number(sel.windowsUsed ?? 0) > 0,
          );
          const armed = Boolean(sel && killWord.trim() === sel.name);

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
                    {/* ★ وضعُ المعرفة صار وسمَ حالةٍ لا عموداً كاملاً: «حقنٌ
                        كامل» بمعرفةٍ تكبر هو الإنذارُ المبكّر لانفجار الكلفة،
                        وبقيّةُ الأوضاع لا يُقرَّر عليها شيء — فلا تُنفق عموداً
                        على ثلاث كلماتٍ لا تُغيّر فعلاً. */}
                    {/* ★ الوسمُ كان يُرسم لعميلٍ بلا نسخةٍ منشورةٍ إطلاقاً، لأنّ
                        الاستعلام يُقنّع الغياب بـ'full' — فيُقرأ «بوتُه يعمل» على
                        تهيئةٍ لم تبدأ. والحالةُ نفسُها تستحقّ شارةً لا إخفاءً. */}
                    {!r.botSeeded
                      ? <Pill tone="warn" label="بلا بوتٍ منشور" />
                      : r.knowledgeMode === 'full' && <Tag tone="violet" label={KB_MODE.full.label} mark={false} />}
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
                const rev = revOf(r);
                if (rev == null || rev <= 0) return <span className="tn-dim">لا اشتراك فعّال</span>;

                /* ★ كلفةٌ صفرٌ مع استهلاكٍ فعليّ ليست كلفةً صفراً بل **سعرٌ
                   ناقص**: نموذجٌ بلا صفٍّ في `prices` يُفوتَر صفراً بصمت،
                   فيُعرض الهامش 100٪ بالأخضر. وهذه أخطر ما يُكتب في تقريرٍ
                   يُبنى عليه تسعير — فنقولها بدل أن نُجمّلها.
                   ★ وكانت الشارةُ جملةً كاملةً («الكلفة غير معروفة — لا سعرَ
                     للنموذج») بعرض نحو 200 بكسلاً داخل عمودٍ رقميٍّ لا يلتفّ،
                     فتدفع الجدولَ كلَّه أمامها. الوسمُ هنا كلمتان، والجملةُ
                     كاملةً في ورقة العميل حيث لها سطرٌ كامل. */
                const cost = Number(r.aiCost ?? 0);
                if (cost === 0 && Number(r.windowsUsed ?? 0) > 0) {
                  return <Pill tone="warn" label="غير مقيسة" />;
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
                        label={m < 0 ? 'يستهلك أكثر' : 'دون الهدف'}
                      />
                    )}
                  </span>
                );
              },
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
            {
              key: 'go',
              head: 'ورقته',
              /* ★ الوِجهةُ تُنطَق ولا تُخمَّن: الصفُّ كلُّه يُضغط بالفأرة، وهذا
                 الزرُّ هو نفسُ الوِجهة لمن يتنقّل بالمفتاح — أو لمن لا يعرف
                 أنّ الصفَّ قابلٌ للضغط أصلاً. */
              cell: (r) => (
                <Button size="sm" onClick={() => setOpenId(r.id)}>تفصيله ‹</Button>
              ),
            },
          ];

          return (
            <Stack gap="lg">
              {/* ★ رقمٌ بطوليٌّ واحد **يتبدّل بالحالة**: ما يحتاجك الآن يسبق كلّ
                  شيء، وعند الهدوء يقول الرقمُ إنّ الهدوء حقيقيٌّ لا غائب. ومعه
                  سياقٌ ملاصقٌ دائماً — «2» بلا «من كم» لا يُقرَّر عليه. */}
              {critical > 0 ? (
                <Hero
                  sev="bad"
                  href="/console/incidents"
                  value={fmt.num(critical)}
                  label="عملاءُ عندهم حادثةٌ حرجةٌ مفتوحة ←"
                  ctx={(
                    <>
                      من <span className="num">{fmt.num(items.length)}</span>{' '}
                      عملاءَ نشطين · مجموعُ الحرجة المفتوحة{' '}
                      <span className="num">{fmt.num(sumCritical)}</span>
                      {worstCrit ? <> · وأثقلُها عند «<span dir="auto">{worstCrit.name}</span>»</> : null}
                      {' · '}والحرجُ يسبق القناةَ والسقفَ في هذا الترتيب.
                    </>
                  )}
                />
              ) : broken > 0 ? (
                <Hero
                  sev="bad"
                  href="/console/incidents"
                  value={fmt.num(broken)}
                  label="عملاءُ قناتُهم معطوبة — بوتٌ صامتٌ الآن ←"
                  ctx={(
                    <>
                      من <span className="num">{fmt.num(items.length)}</span> عملاءَ نشطين
                      {worstBroken ? <> · أوّلُهم «<span dir="auto">{worstBroken.name}</span>»</> : null}
                      {' · '}ولا حادثةَ حرجةً مفتوحة: هذا العطلُ صامتٌ لا يُشتكى منه —
                      زبائنُهم يكتبون ولا يُجابون.
                    </>
                  )}
                />
              ) : nearCap > 0 ? (
                <Hero
                  sev="warn"
                  value={fmt.num(nearCap)}
                  label="عملاءُ بلغوا 80٪ من سقفهم"
                  ctx={(
                    <>
                      من <span className="num">{fmt.num(items.length)}</span>{' '}
                      عملاءَ نشطين · أعلاهم عند{' '}
                      <span className="num">{fmt.pct(worstCap)}</span> من سقفه · والباقةُ تُرقّى
                      قبل أن يُبلَغ السقفُ لا بعده.
                    </>
                  )}
                />
              ) : (
                <Hero
                  value={fmt.num(items.length)}
                  unit={`/ ${fmt.num(TENANT_CAP)}`}
                  label="عملاءُ نشطون — ولا شيء يحتاجك الآن"
                  meter={{ pct: items.length / TENANT_CAP }}
                  ctx={(
                    <>
                      لا حادثةَ حرجةً مفتوحة، ولا قناةً معطوبة، ولا مَن قارب سقفه ·{' '}
                      {grossMargin == null
                        ? 'والهامشُ الإجماليُّ لم يُحسب بعد'
                        : <>والهامشُ الإجماليّ <span className="num">{fmt.pct(grossMargin)}</span></>}
                      {' · '}وكلفةُ النماذج <span className="num">{fmt.money(totalCost)}</span> هذا الشهر.
                    </>
                  )}
                />
              )}

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

              {/* ★ صفوفُ معايير بدل ستّ بطاقاتٍ متساوية: نفسُ الأرقام في ثلث
                  الارتفاع، ومعها عمودٌ ثالثٌ للسياق (مقياسٌ · فرقٌ عن هدف) لم
                  يكن للبطاقة مكانٌ له. */}
              <Section
                title="من أين تأتي هذه الأرقام"
                sub="والصفُّ الذي له وِجهةٌ يفتحها حيث يُتَّخذ القرار"
              >
                <div className="rows cn-rows">
                  <MetricRow
                    k="مقاعدُ المنصّة المشغولة"
                    note={`سقفٌ تشغيليٌّ لا تقنيّ: ${TENANT_CAP} عملاءَ هو ما يُدار يدويّاً بالجودة الموعودة`}
                    value={`${fmt.num(items.length)} / ${fmt.num(TENANT_CAP)}`}
                    mid={<Meter pct={items.length / TENANT_CAP} />}
                  />

                  <MetricRow
                    k="كلفةُ النماذج هذا الشهر"
                    note="بالدولار كما تُفوتَر — والتحويلُ إلى الدينار يجري قبل الطرح لا بعده"
                    value={fmt.money(totalCost)}
                    href="/console/margin"
                    mid={margin.data && revenueSum > 0 ? (
                      <Delta dir="flat">
                        <span className="num">{fmt.pct(costJod / revenueSum)}</span> من الإيراد
                      </Delta>
                    ) : null}
                  />

                  <MetricRow
                    k="الهامشُ الإجماليّ"
                    note={grossMargin == null
                      ? 'لا يُحسب قبل وصول بيانات الاشتراكات — ورقمٌ على نصف بياناته يُقرأ انهياراً وهو نقصُ تحميل'
                      : 'إيرادُ الاشتراكات الفعّالة ناقصَ كلفةِ النماذج، بالدينار'}
                    value={grossMargin == null ? '—' : fmt.pct(grossMargin)}
                    href="/console/margin"
                    mid={grossMargin == null ? null : (
                      <>
                        <Meter
                          pct={Math.max(0, grossMargin)}
                          tone={grossMargin < MARGIN_FLOOR ? 'crit' : 'ok'}
                        />
                        <Delta dir={grossMargin >= MARGIN_FLOOR ? 'up' : 'dn'}>
                          {grossMargin >= MARGIN_FLOOR ? 'فوق الهدف بـ' : 'دون الهدف بـ'}{' '}
                          <span className="num">
                            {fmt.num(Math.round(Math.abs(grossMargin - MARGIN_FLOOR) * 100))}
                          </span>{' '}
                          نقطة
                        </Delta>
                      </>
                    )}
                  />

                  <MetricRow
                    k="قنواتٌ لا تُجيب الآن"
                    note="القناةُ المعطوبة تسبق السقفَ في الترتيب: السقفُ يُرقّى، والبوتُ الصامتُ لا يُجيب أحداً"
                    value={fmt.num(broken + pending)}
                    mid={broken > 0
                      ? <Pill tone="crit" label={`${fmt.num(broken)} عطل · ${fmt.num(pending)} قيد الربط`} />
                      : pending > 0
                        ? <Pill tone="warn" label={`${fmt.num(pending)} قيد الربط`} />
                        : <Tag tone="ok" label="كلُّ القنوات سليمة" />}
                  />
                </div>
              </Section>

              <Section
                title="عملاؤك"
                sub={(
                  <>
                    <span className="num">{fmt.num(items.length)}</span> — الأسوأُ صحّةً أوّلاً،
                    واضغط صفّاً لتفتح ورقته
                  </>
                )}
              >
                <Table
                  columns={columns}
                  rows={items}
                  keyOf={(r) => r.id}
                  onRowClick={(r) => setOpenId(r.id)}
                />
              </Section>

              <Note>
                <b>وسمُ «{KB_MODE.full.label}» بجانب الاسم ليس زينة.</b> عميلٌ على هذا الوضع
                (<code>full</code>) بمعرفةٍ تكبر هو الإنذارُ المبكّر لانفجار الكلفة — تراه هنا
                قبل أن تراه في الفاتورة. وبقيّةُ الأوضاع لا يُقرَّر عليها شيءٌ فلا تُنفق وسماً.
              </Note>

              <Note>
                <b>والكلفة بالدولار والإيراد بالدينار.</b> الهامش محسوبٌ بعد تحويل الكلفة بسعر{' '}
                <span className="num">{JOD_PER_USD}</span> — نفس حساب شاشة «الهامش»، فلا رقمان مختلفان
                لعميلٍ واحد. وعميلٌ بلا اشتراكٍ فعّال لا هامش له: كلفته قائمة وإيراده صفر، وذاك ما
                تقوله الخليّة لا ما تُخفيه.
              </Note>

              {/* ورقةُ ربط القناة لعميلٍ يُسمّى صراحةً — لا بالانتحال. */}
              <Sheet
                open={Boolean(connectFor)}
                title="اربط/جدّد قناة العميل"
                onClose={() => { setConnectFor(null); setWebhook(null); }}
                hint="يُفحص التوكن عند ميتا قبل أن يُحفظ، والفعل يُسجَّل باسمك في سجلّ العميل."
              >
                {connectFor && (
                  <ChannelConnectForm
                    endpoint={`/console/tenants/${connectFor}/channel/connect`}
                    submitLabel="افحص واحفظ"
                    onDone={() => {
                      setConnectFor(null);
                      toast('فُحص التوكن عند ميتا وحُفظ — والقناة موصولة.');
                      void tenants.reload();
                    }}
                  />
                )}
              </Sheet>

              {/* ورقةُ بذر البوت — نفسُ نموذج المعالج بنفس الحدود. */}
              <Sheet
                open={Boolean(seedFor)}
                title="ابذر أوّل نسخةِ بوتٍ لهذا العميل"
                onClose={() => setSeedFor(null)}
                hint="الخادم يرفض إن كان للعميل نسخةٌ منشورةٌ أصلاً — فلا يمحو فتحٌ بالخطأ شخصيّةَ عميلٍ يعمل."
              >
                {seedFor && (
                  <BotSeedForm
                    endpoint={`/console/tenants/${seedFor}/bot/seed`}
                    onDone={() => {
                      setSeedFor(null);
                      toast('نُشرت أوّلُ نسخةِ بوتٍ لهذا العميل وشُغِّل.');
                      void tenants.reload();
                    }}
                  />
                )}
              </Sheet>

              {/* ══════ ورقةُ العميل: الوِجهةُ التي لم تكن ══════ */}
              <Sheet
                open={Boolean(sel)}
                title={sel ? sel.name : 'ورقةُ العميل'}
                onClose={closeSheet}
                hint={sel
                  ? 'الشريطان على مقياسٍ واحدٍ مشتركٍ بين كلّ الأوراق، فطولُ شريطٍ هنا يُقارَن بطولِ شريطٍ في ورقة غيره.'
                  : undefined}
                footer={sel ? (
                  <Row gap="sm">
                    {Number(sel.openCritical ?? 0) > 0 || selLast ? (
                      <a
                        className="btn primary lg"
                        href={`/console/incidents?tenant=${encodeURIComponent(sel.name)}`}
                      >
                        حوادثُ هذا العميل ‹
                      </a>
                    ) : null}
                    {/* ★ «اربط/جدّد القناة» — المسار الصريح `/console/tenants/:id/channel/connect`
                        كان مبنيّاً ولا يناديه إلّا معالجُ عميلٍ جديد، فانتهاءُ توكنٍ عند
                        عميلٍ قائم لم يكن له مخرجٌ من اللوحة إطلاقاً. والانتحالُ قراءةٌ فقط
                        عن قصد، فلا يصلح بديلاً. */}
                    <Button size="lg" onClick={() => setConnectFor(sel.id)}>اربط/جدّد القناة…</Button>
                    {/* ★ بذرُ بوتٍ لعميلٍ لم يكتمل معالجُه — `…/bot/seed` كان مبنيّاً
                        ولا يناديه إلّا المعالجُ نفسُه. والشرطُ لا زينة: الخادم يردّ ٤٠٩
                        على عميلٍ له نسخةٌ منشورة، وزرٌّ يفشل دائماً يكسر الثقة. */}
                    {!sel.botSeeded && (
                      <Button size="lg" onClick={() => setSeedFor(sel.id)} disabled={can.readOnly}
                        reason="انتحالٌ نشط — قراءةٌ فقط.">ابذر بوته…</Button>
                    )}
                    <a className="btn lg" href="/console/margin">لوحةُ الهامش ‹</a>
                    <Button size="lg" onClick={closeSheet}>أغلِق</Button>
                  </Row>
                ) : undefined}
              >
                {sel && (
                  <Stack gap="md">
                    <Row gap="xs">
                      {selHealth && <Pill tone={selHealth.tone} label={selHealth.label} />}
                      {STATUS_PILL[sel.status] && (
                        <Pill tone={STATUS_PILL[sel.status]!.tone} label={STATUS_PILL[sel.status]!.label} />
                      )}
                      {sel.botSeeded
                        ? <Tag tone="violet" label={kbModeLabel(sel.knowledgeMode)} mark={false} />
                        : <Pill tone="warn" label="بلا بوتٍ منشور" />}
                      {Number(sel.openCritical ?? 0) > 0 && (
                        <Pill tone="crit" label={`${fmt.num(sel.openCritical)} حرجة مفتوحة`} />
                      )}
                    </Row>

                    {selHealth && <p className="cn-dim">{selHealth.why}</p>}

                    {/* ★★ تهيئةٌ ناقصةٌ تُرى. زرٌّ صحيحٌ في ورقةٍ لا تقول إنّ التهيئة
                        ناقصةٌ لا يُضغَط — والمعالجُ كان يُغلق بلا إنذارٍ ولا أثر. */}
                    {(!sel.botSeeded || sel.ownerPending) && (
                      <Note tone="warn">
                        <b>تهيئةٌ لم تكتمل.</b>{' '}
                        {!sel.botSeeded && 'لا نسخةَ بوتٍ منشورةً لهذا العميل — بوتُه لا يردّ ولو كانت قناتُه سليمة. '}
                        {sel.ownerPending && 'ومالكُه لم يدخل قطّ وكلمتُه ما زالت مؤقّتة — وهي تُعرض مرّةً واحدةً في المعالج، فلو أُغلق قبل نسخها فُقدت. '}
                        وما بقي يُكمَل من هذه الورقة: طيّةُ «أعِد كلمةَ مرور مالكه» تحت هذا السطر،
                        {!sel.botSeeded && <> وزرُّ «ابذر بوته…» في أسفلها،</>} وزرُّ «اربط/جدّد القناة…».
                      </Note>
                    )}

                    {/* ★ إعادةُ كلمةِ مالكه — البابُ الذي كان `ops/set-password.ts` وحده.
                        وكلُّ جلساته تسقط، فهو فعلٌ يُنطق أثرُه قبل الضغط لا بعده. */}
                    <details className="cn-gate">
                      <summary>أعِد كلمةَ مرور مالكه — وتسقط كلُّ جلساته</summary>
                      <p className="cn-dim">
                        تُولَّد كلمةٌ مؤقّتةٌ تُعرض <b>مرّةً واحدة</b> ولا تُخزَّن نصّاً، ويُطرَد المالكُ
                        من كلّ أجهزته في الحال، ويُسجَّل الفعلُ باسمك في سجلّه فيراه.
                        {sel.ownerEmail && <> والبريد <span className="mono">{sel.ownerEmail}</span>.</>}
                      </p>
                      {ownerTemp
                        ? <CodeBlock label={`كلمةٌ مؤقّتةٌ لـ${ownerTemp.email}`} text={ownerTemp.pass} />
                        : (
                          <Button variant="danger" busy={resetting} disabled={can.readOnly}
                            reason="انتحالٌ نشط — قراءةٌ فقط، وكلُّ فعلٍ كاتبٍ مرفوضٌ في الخادم أصلاً."
                            onClick={() => void resetOwner(sel)}>ولّد كلمةً مؤقّتة</Button>
                        )}
                    </details>

                    {/* ★ وبيانا ميتا: الـCallback URL وتوكنُ التحقّق. الثاني مُسقَطٌ من
                        `GET /channels` عمداً ومحجوبٌ في السجلّ، فمعالجٌ أُغلق قبل خطوته
                        الأخيرة كان يُفقده بلا رجعةٍ إلّا بـ`ssh`. */}
                    {/* ⚠️ و`Fold` لا `cn-gate`: الثانيةُ محاطةٌ بأحمر لأنّها بوّابةُ فعلٍ
                        لا رجعةَ فيه (إيقافُ بوتٍ، إسقاطُ جلسات). وقراءةُ عنوانٍ ليست
                        خطراً — وإطارٌ أحمرُ على فعلٍ آمنٍ يُبلّد الأحمرَ حيث يَلزم. */}
                    <Fold summary="بيانا ميتا — الـCallback URL وتوكن التحقّق">
                      {webhook
                        ? (
                          <Stack gap="sm">
                            <CodeBlock label="Callback URL" text={webhook.url} />
                            {webhook.token
                              ? <CodeBlock label="Verify token" text={webhook.token} />
                              : <p className="cn-dim">لا قناةَ محفوظةٌ لهذا العميل بعد.</p>}
                            <p className="cn-dim">
                              يُلصقان في WhatsApp ← Configuration، ثمّ يُفعّل الحقل{' '}
                              <span className="mono">messages</span> — وبلاه لا تصل رسالةٌ واحدة
                              وكلُّ شيءٍ آخر يبدو سليماً.
                            </p>
                          </Stack>
                        )
                        : (
                          <Button onClick={() => void readWebhook(sel)}>اعرِضهما</Button>
                        )}
                    </Fold>

                    <div className="mg-bars">
                      <span className="mg-lbl">إيرادٌ شهريّ</span>
                      <Bar value={selRev ?? 0} scale={scale} kind="rev" />
                      <span className="mg-val">
                        {selRev == null
                          ? '—'
                          : <><span className="num">{fmt.num(Math.round(selRev))}</span> د.أ</>}
                      </span>

                      <span className="mg-lbl">كلفةُ نماذجه</span>
                      <Bar
                        value={selCost}
                        scale={scale}
                        kind="cst"
                        goal={selRev != null && selRev > 0 ? selRev * (1 - MARGIN_FLOOR) : undefined}
                      />
                      <span className="mg-val">
                        <span className="num">{selCost.toFixed(2)}</span> د.أ
                      </span>
                    </div>

                    <p className="cn-legend">
                      <span><i className="cn-sw rev" aria-hidden="true" />إيرادُ اشتراكه</span>
                      <span><i className="cn-sw cst" aria-hidden="true" />كلفةُ نماذجه</span>
                      <span>
                        <i className="cn-sw-goal" aria-hidden="true" />
                        علامةُ هدف الهامش عند{' '}
                        <span className="num">{fmt.pct(MARGIN_FLOOR)}</span> — ما تجاوزها
                        فهامشُه دون الهدف
                      </span>
                      <span>
                        والمقياسُ من صفرٍ إلى{' '}
                        <span className="num">{fmt.num(Math.round(scale))}</span> د.أ
                      </span>
                    </p>

                    <KV>
                      <KVRow k="الهامش">
                        {selUnmeasured
                          ? 'غيرُ مقيس: استهلاكٌ حقيقيٌّ وكلفةٌ صفريّة — لا صفَّ سعرٍ مسجَّلاً للنموذج الذي يردّ به، فهامشُه أعلى من حقيقته. أضِف سعر النموذج ليعود الرقمُ صادقاً.'
                          : selMargin == null
                            ? 'لا اشتراكَ فعّالاً — كلفتُه قائمةٌ وإيرادُه صفر.'
                            : <><span className="num">{fmt.pct(selMargin)}</span> من إيراده</>}
                      </KVRow>
                      <KVRow k="النوافذ / السقف">
                        <span className="tn-cap">
                          <span className="num">
                            {fmt.num(sel.windowsUsed)} / {fmt.num(sel.windowLimit)}
                          </span>
                          {selLimit > 0
                            ? <Meter pct={capPct(sel)} />
                            : <span className="tn-dim">بلا باقةٍ فعّالة — لا سقف يُقاس</span>}
                        </span>
                      </KVRow>
                      <KVRow k="الباقة"><span dir="auto">{sel.plan ?? 'بلا باقة'}</span></KVRow>
                      <KVRow k="وسيطُ التوكنات لكلّ ردّ">
                        {selUsage
                          ? <span className="num">{fmt.num(selUsage.avgTokensPerReply)}</span>
                          : <span className="tn-dim">غيرُ محمَّل — لوحةُ الهامش هي مصدرُه</span>}
                      </KVRow>
                      <KVRow k="آخر حادثة">
                        {selLast
                          ? <><span dir="auto">{selLast.title}</span>{' — '}{fmt.when(selLast.lastSeenAt)}</>
                          : incidents.error
                            ? 'غيرُ محمَّلة — أعِد المحاولة من رسالة الخطأ في الشاشة'
                            : 'لا حادثةَ مفتوحةً لهذا العميل'}
                      </KVRow>
                    </KV>

                    {/* ★ أخطرُ فعلٍ في الشاشة لا يكون أضعفَ زرٍّ فيها: طيّةٌ
                        تُفتح، ثمّ بوّابةُ كتابةٍ تُطابق الاسم حرفاً حرفاً. */}
                    <details className="cn-gate">
                      <summary>أوقف بوته — يصمت عن كلّ زبائنه</summary>
                      <p className="cn-dim">
                        كلُّ رسالةٍ تصل بعد الإيقاف تنتظر موظّفاً من عند العميل، والأثرُ يُرى عند
                        زبائنه في الحال. ولا يعود إلّا بتشغيلٍ يدويّ — فاكتب اسم العميل كما هو
                        مكتوبٌ في رأس هذه الورقة لتفعيل الزرّ.
                      </p>
                      <Field
                        label="اسمُ العميل كما هو مكتوبٌ أعلاه"
                        id="kill-name"
                        hint="مطابقةٌ حرفاً حرفاً — وهذا هو التأكيد، فلا نقرةَ ثانيةٌ تُغني عنه."
                      >
                        <Input id="kill-name" value={killWord} onChange={setKillWord} />
                      </Field>
                      <Button
                        variant="danger"
                        busy={busy}
                        disabled={!armed || can.readOnly}
                        reason={can.readOnly
                          ? 'انتحالٌ نشط — قراءةٌ فقط، وكلُّ فعلٍ كاتبٍ مرفوضٌ في الخادم أصلاً.'
                          : 'اكتب اسم العميل مطابقاً لتفعيل الزرّ.'}
                        onClick={() => void killBot(sel)}
                      >
                        أوقف بوته الآن
                      </Button>
                    </details>
                  </Stack>
                )}
              </Sheet>

              {/* ★ الرصيف: فعلُ الشاشة الأوّل في مدى الإبهام، ومعه أثرُه مكتوباً
                  قبل الضغط لا بعده. */}
              <div className="cn-dock">
                <Dock hint="إنشاءُ عميلٍ يفتح المُنشئ خطوةً خطوة: الاسمُ والباقة وحسابُ المالك، وكلمةُ مرورٍ مؤقّتةٍ تُعرض مرّةً واحدةً ولا تُخزَّن نصّاً.">
                  {createButton(true)}
                </Dock>
              </div>
            </Stack>
          );
        }}
      </DataView>
    </Stack>
  );
}
