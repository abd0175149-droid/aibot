'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, ApiError } from '@/lib/api';
import {
  PageHead, Stack, Row, Field, Input, Button, Pill, Tag, Dot, Note, Empty,
  DataView, KV, KVRow, CodeBlock, Sheet, Dock, type Tone,
} from '@/components/ui';
import { Group } from '../parts';
import { Hero, Section } from '@/components/screen';

/**
 * سيل الحوادث.
 *
 * ★ المبدأ الذي يحكم الشاشة: **تُقرأ الثالثة فجراً.** وحينها لا تُقرأ الوثائق
 *   ولا تُفتح صفحةُ ويكي — فخطوات المعالجة مكتوبةٌ في البطاقة نفسها، تحت
 *   العنوان الذي أيقظك. حادثةٌ بلا خطوةٍ تالية ليست تنبيهاً، هي قلق.
 *
 * ★ وثلاثة أسئلةٍ تُجاب قبل أيّ فعل، ولذلك هي في **سطر** كلّ بطاقةٍ قبل فتحها:
 *     ① كم هي خطيرة؟ (الشدّة — حدٌّ ملوّن على حافّة البطاقة ونصٌّ معه)
 *     ② على مَن؟ (العميل — أو «عطل منصّة» إن لم يكن لها عميل)
 *     ③ **هل تُغلق نفسها؟** وهذا أهمّها وكان غائباً: خمسةُ أنواعٍ تُحلّ آليّاً
 *        بعد فحصين سليمين متتاليين، والباقي لا. من لا يعرف ذلك يستيقظ لعطلٍ
 *        كان سيزول وحده، أو ينام على عطلٍ لن يزول.
 *
 * ── ثلاثةُ أعطالٍ بنيويّة أُصلحت في هذه المرحلة ─────────────────────────────
 * ★ **التسلسل كان مقلوباً.** خطواتُ المعالجة — وهي أكثرُ المحتوى تكرّراً بين
 *   حادثتَين من نوعٍ واحد — كانت مفتوحةً دائماً، والتفصيلُ التقنيُّ الذي
 *   **وحده** يفرّق حادثةً عن أختها كان مطويّاً. فمئةُ بطاقةٍ كانت مئةَ نسخةٍ من
 *   نفس النصّ. صارت البطاقةُ نفسها تُطوى: السطرُ يحمل ما يُقرَّر عليه، وأوّلُ
 *   ما يُكشف هو التفصيل، والخطواتُ طيَّةٌ ثانيةٌ لمن لم يعرفها بعد.
 * ★ **وسيلٌ مسطَّحٌ بلا تجميعٍ ولا بحث.** مئةُ بطاقةٍ متساوية الوزن مرتَّبةٌ
 *   بآخر ظهورٍ تخلط الحرجَ بعطل قياسٍ لا يوقظ أحداً (`price_missing` يُغرقها).
 *   فصار التجميعُ **بالإلحاح قبل الزمن**، برؤوسٍ لاصقةٍ تحمل أعدادها، ومعه
 *   بحثٌ في العنوان والنوع والعميل، وكشفٌ تدريجيٌّ لما بعد اثنتي عشرة.
 * ★ **والسقف ١٠٠ كان يكذب صامتاً.** الخادم يجلب مئةً بحدٍّ مكتوبٍ في
 *   `/console/incidents`، والسطرُ كان يقول «الباقي مخفيٌّ بالمرشّح لا محلول» —
 *   وهو غيرُ صحيحٍ عند التجاوز: الباقي **لم يُجلب** أصلاً. فالسقفُ يُعلَن الآن
 *   حين يُلامَس، والعدُّ يُقال «من المجلوب» لا «من الكلّ».
 */

interface Incident {
  id: string;
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  status: 'open' | 'ack' | 'resolved';
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  detail: Record<string, unknown> | null;
  tenantName: string | null;
}

/**
 * خطوات المعالجة مكتوبةٌ في البطاقة لأنّك ستفتح هذه الشاشة الثالثة فجراً.
 * حادثةٌ بلا خطوةٍ تالية ليست تنبيهاً — هي قلق.
 *
 * ★ والأنواع مأخوذةٌ من مصدرها لا من الذاكرة: `worker/src/health.ts` و
 *   `reply.ts` و`embed.ts` و`quota.ts` هي وحدها ما يرفع حادثة. وكانت أربعةُ أنواعٍ منها
 *   بلا خطوةٍ واحدة — `channel_down` و`send_failure_rate` و`price_missing`
 *   و`ai_error` — أي أنّ أشيعَ عطلٍ في الفحص الدوريّ كان يُعرض عنواناً بلا
 *   طريق. أُكملت هنا.
 */
const RUNBOOK: Record<string, string[]> = {
  token_invalid: [
    'افتح بطاقة العميل ← القنوات',
    'اطلب منه توليد توكن مستخدم نظام بلا تاريخ انتهاء',
    'الصقه واضغط «اختبر الاتّصال»',
    'تُغلق الحادثة آليّاً بعد فحصين سليمين متتاليين',
  ],
  webhook_unsubscribed: [
    'في لوحة ميتا عند العميل: WhatsApp ← Configuration ← Webhook',
    'تأكّد من الاشتراك في: messages · message_template_status_update · phone_number_quality_update · account_update',
    'تأكّد أنّ التطبيق في وضع Live لا Development',
  ],
  webhook_silent: [
    'الأرجح: اشتراك حقل messages سقط عند ميتا',
    'أو أنّ التطبيق رجع إلى وضع التطوير فلا يستقبل إلّا من المختبِرين',
    'افحص الاشتراك، ثمّ أرسل رسالةً تجريبيّة من هاتفك',
    'العتبة لكلّ عميلٍ لا ثابتة: ثلاثةُ أمثال فجوته المعتادة — فصمتُ ساعةٍ عند مطعمٍ ليس صمت ساعةٍ عند صيدليّة',
  ],
  quality_drop: [
    'تحقّق أوّلاً: هل جرى إرسالٌ جماعيّ؟ (يجب أن يكون مقفلاً)',
    'راجع آخر خمسين ردّاً بحثاً عن محتوًى مزعج',
    'الإرسال الجماعيّ مقفلٌ آليّاً حتّى تعود الجودة للأخضر',
    'وهذه لا تُغلق نفسها: عودةُ التصنيف إلى الأخضر قرارٌ عند ميتا، والإغلاق هنا بيدك',
  ],
  channel_down: [
    'التوكن سليم والاشتراك قائم — ومع ذلك يفشل الفحص. فالعطل في الطريق إلى ميتا لا في الربط',
    'افتح «ما يميّز هذه الحادثة» أعلاه: نصّ العطل يقول أيّ طرفٍ سقط',
    'إن كان العطل عند ميتا فلا تلمس شيئاً — تُغلق الحادثة آليّاً بعد فحصين سليمين متتاليين',
    'وإن تجاوز الساعة: أبلغ العميل قبل أن يسألك — الإبلاغ المسبق يوفّر المكالمة',
  ],
  no_reply: [
    'افحص عمق الطوابير في صحّة المنصّة',
    'الأرجح أنّ عامل bot:reply متوقّف أو الطابور مسدود',
    'راجع سجلّ الحاوية: docker compose logs -f worker',
    'وهذا عطل منصّةٍ لا عطل قناة: إن ظهر عند عميلَين معاً فالعامل هو السبب، لا حسابهما',
  ],
  send_failed: [
    'راجع تفصيل الحادثة — كود الخطأ من ميتا يقول السبب',
    '131047 = نافذة مغلقة، وهذا صحيحٌ ومقصود',
    '190 = توكن منتهٍ ⟵ جدّد الربط',
  ],
  send_failure_rate: [
    'خُمسُ الصادر يفشل أو أكثر — هذا عطلٌ جارٍ لا رسالةٌ واحدة تعثّرت',
    'افتح «ما يميّز هذه الحادثة»: النسبة والقناة فيه',
    'الأشيع: 131047 نافذة مغلقة (صحيحٌ ومقصود) · 190 توكن منتهٍ ⟵ جدّد الربط',
    'وإن كان الفشل على كلّ القنوات وعند أكثر من عميل فالعطل عندنا: افحص عامل الإرسال والطوابير',
  ],
  quota_threshold: [
    'العميل عبر 95٪ أو بلغ سقفه — وقد أُشعِر بنفسه ومعه نصُّ ما يحدث بحسب سياسة باقته',
    'التفصيل يحمل العتبة والعدّاد والسقف والسياسة — اقرأه قبل أن تتّصل',
    'handoff_only و block: الردُّ على المحادثات الجديدة يتوقّف عند السقف ⟵ اتّصل قبل أن يتوقّف بوته',
    'allow_bill: بوته يستمرّ والزائد يُفوتَر ⟵ أبلِغه بالمبلغ لا بالنسبة',
    'وهي تُطلق **مرّةً واحدةً لكلّ عتبةٍ في الشهر**، فتكرارُها في نفس الدورة يعني عطلاً لا نموّاً',
    'ولا تُغلق نفسها: رفعُ السقف أو الترقية قرارٌ بشريّ',
  ],
  quota_exceeded: [
    'راجع استهلاك العميل وسياسة باقته',
    'إن كان النموّ حقيقيّاً: اقترح ترقية الباقة',
    'وإن كان انفجاراً مفاجئاً: افحص حلقة رسائل أو هجوماً',
    'ولا تُغلقها قبل أن تقرّر السياسة: إغلاقها لا يرفع السقف',
  ],
  kb_embed_failed: [
    'النسخة السابقة ما زالت تخدم — لا انقطاع على العميل',
    'راجع تفصيل الخطأ، ثمّ اطلب منه إعادة النشر',
  ],
  price_missing: [
    'لا أثرَ على العميل — هذا عطل قياسٍ لا عطل خدمة، فلا تُوقظ أحداً له',
    'سعر النموذج المذكور في العنوان غير مسجَّل، فكلفة الذكاء تُحسب صفراً',
    'أضِف سعره إلى جدول الأسعار، ثمّ راجع لوحة الهامش',
    'والأرقام المحسوبة قبل الإصلاح ناقصةُ الكلفة — الهامش فيها أعلى من حقيقته',
  ],
  ai_error: [
    'فشل نداء النموذج، والأرجح أنّه عابر',
    'راجع التفصيل: مهلةٌ انتهت؟ حدُّ معدّل؟ أم مفتاحٌ مرفوض؟',
    'إن ظهر عند كلّ العملاء في الوقت نفسه فالمزوّد هو السبب — راجع صفحة حالته قبل أن تغيّر شيئاً',
    'تُغلق الحادثة آليّاً بعد فحصين سليمين متتاليين',
  ],
};

/**
 * ما يُحلّ آليّاً — منقولٌ من `AUTO_RESOLVABLE` في `worker/src/incidents.ts`.
 * وعرضُه في سطر البطاقة يجيب السؤال الذي يقرّر: أقوم من السرير أم لا؟
 */
const AUTO_RESOLVES = new Set(['channel_down', 'token_invalid', 'webhook_silent', 'send_failed', 'ai_error']);

const SEV: Record<Incident['severity'], { tone: Tone; label: string; edge: string; head: string }> = {
  critical: { tone: 'crit', label: 'حرج', edge: 'crit', head: 'حرج — يحتاجك الآن' },
  warn: { tone: 'warn', label: 'تحذير', edge: 'warn', head: 'تحذير — يُراجَع اليوم' },
  info: { tone: 'neutral', label: 'معلومة', edge: 'info', head: 'معلومة — للعلم لا للقيام' },
};

const SEV_ORDER: Array<Incident['severity']> = ['critical', 'warn', 'info'];

/** قيمةٌ لا تصلح اسم عميل — فلا تتعارض مع اسمٍ حقيقيّ في المرشّح. */
const PLATFORM = '\u0000platform';

/**
 * سقفُ الجلب في الخادم (`limit(100)` في `/console/incidents`).
 * يُعلَن حين يُلامَس: عدٌّ لا يقول إنّه ناقصٌ هو عدٌّ يكذب.
 */
const FETCH_CAP = 100;

/** كم يُعرض من كلّ مجموعةٍ قبل الكشف التدريجيّ. */
const PAGE = 12;

type Scope = 'live' | 'resolved';

export default function IncidentsPage() {
  const [scope, setScope] = useState<Scope>('live');
  const [sev, setSev] = useState<'all' | Incident['severity']>('all');
  const [tenant, setTenant] = useState('all');
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(false);
  const [shownPer, setShownPer] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  /* الحالة من الخادم: بلا `status` يعيد المفتوحة والموسومة «رأيتها» معاً،
     و«المحلولة» تُطلب صراحةً — فالمراجعة بعد الإصلاح جزءٌ من العمل. */
  const state = useApi<Incident[]>(
    scope === 'resolved' ? '/console/incidents?status=resolved' : '/console/incidents',
  );
  const { toast, node: toastNode } = useToast();

  /* ★ وِجهةٌ من شاشة العملاء: ورقةُ العميل هناك تؤدّي إلى حوادثه هنا، والاسم
     يأتي في `?tenant=`. ويُقرأ **بعد** التركيب لا عند أوّل رسم — فقراءةُ
     `location` في الرسم تُخالف ما رسمه الخادم فيسقط الترطيب. ولا علاقةَ لهذا
     بعرض الشاشة: لا `matchMedia` ولا `innerWidth` في الملفّ. */
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tenant');
    if (t) setTenant(t);
  }, []);

  const all = state.data ?? [];
  const capped = all.length >= FETCH_CAP;

  /* الترشيح بالعميل ثمّ بالنصّ **قبل** عدّادات الشدّة: العدّادُ يعدّ ما سيظهر
     فعلاً لو ضغطتَه، لا ما في السيل كلّه — وعدّادٌ يخالف نتيجته يُفقد الثقة
     في الشاشة كلّها. */
  const byTenant = all.filter((i) => (
    tenant === 'all' ? true
      : tenant === PLATFORM ? !i.tenantName
        : i.tenantName === tenant
  ));

  const needle = q.trim().toLowerCase();
  const byText = needle
    ? byTenant.filter((i) => (
      i.title.toLowerCase().includes(needle)
      || i.kind.toLowerCase().includes(needle)
      || (i.tenantName ?? '').toLowerCase().includes(needle)
    ))
    : byTenant;

  const shown = byText.filter((i) => sev === 'all' || i.severity === sev);
  const filtering = sev !== 'all' || tenant !== 'all' || needle.length > 0;

  const openCrit = all.filter((i) => i.severity === 'critical' && i.status !== 'resolved');
  const openWarn = all.filter((i) => i.severity === 'warn' && i.status !== 'resolved');
  const openAll = all.filter((i) => i.status !== 'resolved');
  const mostRepeated = all.reduce((m, i) => Math.max(m, Number(i.count ?? 0)), 0);
  const oldestCrit = openCrit.reduce<string | null>(
    (m, i) => (m == null || i.firstSeenAt < m ? i.firstSeenAt : m),
    null,
  );
  const newestAny = all.reduce<string | null>(
    (m, i) => (m == null || i.lastSeenAt > m ? i.lastSeenAt : m),
    null,
  );

  /** قائمةُ العملاء في المجلوب — ومعها عدُّ حوادث كلٍّ منهم. */
  const tenantOpts = useMemo(() => {
    const counts = new Map<string, number>();
    let platform = 0;
    for (const i of all) {
      if (i.tenantName) counts.set(i.tenantName, (counts.get(i.tenantName) ?? 0) + 1);
      else platform += 1;
    }
    const opts: Array<{ value: string; label: string; n: number }> = [
      { value: 'all', label: 'كلّ العملاء', n: all.length },
      ...(platform ? [{ value: PLATFORM, label: 'عطل منصّة — بلا عميل', n: platform }] : []),
      ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'ar'))
        .map(([name, n]) => ({ value: name, label: name, n })),
    ];
    /* ★ وِجهةٌ من الخارج قد تسمّي عميلاً لا حادثةَ له في هذه الحالة. فلو غاب
       من القائمة لقُرئ المرشّحُ «كلّ العملاء» وهو ليس كذلك — والمعروضُ صفر. */
    if (tenant !== 'all' && tenant !== PLATFORM && !counts.has(tenant)) {
      opts.push({ value: tenant, label: tenant, n: 0 });
    }
    return opts;
  }, [all, tenant]);

  const tenantLabel = tenantOpts.find((o) => o.value === tenant)?.label ?? 'كلّ العملاء';

  async function act(id: string, action: 'ack' | 'resolve') {
    setBusy(`${id}:${action}`);
    try {
      await post(`/console/incidents/${id}/${action}`);
      toast(action === 'ack'
        ? 'وُسمت «رأيتها» — لا إشعارَ جديد لهذه البصمة'
        : 'حُلّت — والحلّ الآليّ يحتاج فحصين سليمين متتاليين');
      await state.reload();
    } catch (e) {
      /* ★ كان الفعل بلا التماسٍ للخطأ: نداءٌ فاشل يصمت، فيظنّ من ضغط أنّ
         الوسم تمّ — ويمرّ العطل بلا صاحب. */
      toast(e instanceof ApiError ? e.message : 'تعذّر تحديث الحادثة. أعِد المحاولة.');
    } finally {
      setBusy(null);
    }
  }

  function clearFilters() {
    setSev('all');
    setTenant('all');
    setQ('');
  }

  /** بطاقةٌ تُطوى: سطرُ الحكم ظاهرٌ دائماً، والتفصيلُ أوّلُ ما يُكشف. */
  function card(i: Incident, autoOpen: boolean) {
    const s = SEV[i.severity];
    const steps = RUNBOOK[i.kind];
    const auto = AUTO_RESOLVES.has(i.kind);
    const done = i.status === 'resolved';
    const hasDetail = Boolean(i.detail && Object.keys(i.detail).length > 0);

    return (
      <details
        key={i.id}
        className={`inc ${s.edge} cn-ic${done ? ' done' : ''}`}
        open={autoOpen || undefined}
      >
        <summary>
          {/* العنوان يكتبه العامل وقد يحمل اسم نموذجٍ أو حساباً لاتينيّاً */}
          <span className="cn-ic-t" dir="auto">{i.title}</span>
          <span className="cn-ic-x" aria-hidden="true" />
          {/* سطرُ الحكم: كلُّ ما يُقرَّر عليه قبل الفتح */}
          <span className="cn-ic-m">
            <Pill tone={s.tone} label={s.label} />
            {i.status === 'ack' && <Pill tone="warn" label="رأيتها" />}
            {done && <Pill tone="ok" label="حُلّت" />}
            {/* اسم العميل يكتبه هو، فيلزمه `dir="auto"` — و`Pill` لا تمرّر
                اتّجاهاً، فنستعمل صنفها نفسه بلا صنفٍ جديد. */}
            {i.tenantName
              ? <span className="pill neutral" dir="auto">{i.tenantName}</span>
              : <Pill tone="violet" label="عطل منصّة — بلا عميل" mark={false} />}
            {!done && (
              <Tag
                tone={auto ? 'neutral' : 'warn'}
                mark={false}
                line={auto}
                label={auto ? 'تُغلق آليّاً بفحصين سليمين' : 'إغلاقها بيدك'}
              />
            )}
            <span>
              تكرّرت <span className="num">{fmt.num(i.count)}</span> · آخر ظهور{' '}
              {fmt.when(i.lastSeenAt)}
            </span>
          </span>
        </summary>

        <div className="cn-ic-b">
          {/* ★ التفصيلُ أوّلُ ما يُكشف: هو وحده ما يفرّق هذه الحادثة عن أختها،
              والخطواتُ نفسُها في كلّ حادثةٍ من نوعها. */}
          <div className="cn-det">
            <span className="cn-det-h">ما يميّز هذه الحادثة عن أخواتها</span>
            {hasDetail
              /* سلسلة آلةٍ خالصة: مونو و`ltr` ونسخٌ بضغطة — لتُلصق في رسالة */
              ? <CodeBlock label="detail" text={JSON.stringify(i.detail, null, 2)} />
              : (
                <p className="cn-dim">
                  لا تفصيلَ تقنيّاً مرفقاً بهذه الحادثة — فما يميّزها هو عنوانُها ونوعُها
                  وعميلُها وحدها.
                </p>
              )}
          </div>

          <KV>
            <KVRow k="أوّل ظهور">{fmt.when(i.firstSeenAt)}</KVRow>
            <KVRow k="النوع"><span className="mono">{i.kind}</span></KVRow>
          </KV>

          {steps ? (
            <details className="inc-d">
              <summary>خطواتُ المعالجة المكتوبة لهذا النوع</summary>
              <div className="inc-run">
                <b>خطوات المعالجة:</b>
                <ol>{steps.map((t) => <li key={t}>{t}</li>)}</ol>
              </div>
            </details>
          ) : (
            <Note tone="warn">
              <b>لا خطوات مكتوبةٌ لهذا النوع بعد.</b> ابدأ من «ما يميّز هذه الحادثة» أعلاه،
              ثمّ أضِف ما فعلتَه خطوةً هنا — فمن يفتح الشاشة بعدك لن يبدأ من الصفر.
            </Note>
          )}

          <Row gap="sm">
            {i.status === 'open' && (
              <Button onClick={() => void act(i.id, 'ack')} busy={busy === `${i.id}:ack`}>
                رأيتها
              </Button>
            )}
            {done ? (
              <Button
                disabled
                reason="حُلّت مسبقاً. وإن عاد العطل فستُفتح حادثةٌ جديدة بنفس البصمة — فلا شيء يُفقد."
              >
                حُلّت
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void act(i.id, 'resolve')}
                busy={busy === `${i.id}:resolve`}
              >
                حُلّت
              </Button>
            )}
          </Row>
        </div>
      </details>
    );
  }

  return (
    <Stack gap="lg">
      {toastNode}

      <PageHead
        title="الحوادث"
        sub="حادثةٌ واحدة لكلّ بصمة. تكرار العطل يرفع العدّاد ولا يُنشئ إشعاراً جديداً — وهذا ما يمنع مئتَي إشعارٍ من عطلٍ واحد."
        /* ★ الرأس كان خارج حالة البيانات، فيقول «لا حادثة حرجة مفتوحة» بنقطةٍ
           خضراء **حين يفشل النداء** — وهي أخطر طمأنينةٍ كاذبة في المنتج:
           شاشةُ الحوادث تحديداً. والعدُّ نفسه صار في الرقم البطوليّ داخل حالة
           البيانات، فلا يُكرَّر هنا — ويبقى للرأس إعلانُ فشل الجلب وحده. */
        actions={state.error ? (
          <Row gap="sm">
            <Dot tone="warn" />
            <span className="muted-p">تعذّر جلب الحوادث — العدّاد غير معروف</span>
          </Row>
        ) : undefined}
      />

      <DataView
        state={state}
        skeletonRows={4}
        empty={{
          when: (d) => d.length === 0,
          title: scope === 'resolved' ? 'لا حوادث محلولة بعد' : 'لا حوادث مفتوحة',
          hint: scope === 'resolved'
            ? 'لم تُحلّ حادثةٌ بعد. وما يُحلّ يبقى هنا محفوظاً — فالمراجعة بعد الإصلاح جزءٌ من العمل.'
            : 'كلّ البوتات تعمل. 🌿 والمحلولة تبقى محفوظةً للمراجعة — بدّل الحالة إن أردت أن تراجع ما أُصلح.',
          action: (
            <Button onClick={() => setScope(scope === 'resolved' ? 'live' : 'resolved')}>
              {scope === 'resolved' ? 'اعرض المفتوحة' : 'اعرض المحلولة'}
            </Button>
          ),
        }}
      >
        {() => (
          <Stack gap="lg">
            {/* ★ البطوليُّ يتبدّل بالحالة، ومعه سياقٌ ملاصق: عددٌ بلا «من كم»
                و«منذ متى» و«كم تكرّر» لا يُقرَّر عليه في الثالثة فجراً. */}
            {scope === 'resolved' ? (
              <Hero
                value={fmt.num(all.length)}
                label="حادثةٌ محلولةٌ في السجلّ"
                ctx={(
                  <>
                    المحلولةُ تبقى محفوظةً للمراجعة بعد الإصلاح
                    {newestAny ? <> · أحدثُ ظهورٍ فيها {fmt.when(newestAny)}</> : null}
                    {capped ? ' · وهذا سقفُ الجلب: الأقدمُ منها لم يُجلب.' : '.'}
                  </>
                )}
              />
            ) : openCrit.length > 0 ? (
              <Hero
                sev="bad"
                value={fmt.num(openCrit.length)}
                label="حادثةٌ حرجةٌ مفتوحةٌ الآن"
                ctx={(
                  <>
                    من <span className="num">{fmt.num(openAll.length)}</span> مفتوحةً في المجلوب
                    {oldestCrit ? <> · أقدمُها منذ {fmt.when(oldestCrit)}</> : null}
                    {mostRepeated > 1
                      ? <> · وأكثرُها تكراراً <span className="num">{fmt.num(mostRepeated)}</span> مرّة</>
                      : null}
                    {' · '}والحرجُ وحدَه ما يُوقظ: ما تحته يُراجَع في النهار.
                  </>
                )}
              />
            ) : openWarn.length > 0 ? (
              <Hero
                sev="warn"
                value={fmt.num(openWarn.length)}
                label="تحذيرٌ مفتوح — ولا حادثةَ حرجة"
                ctx={(
                  <>
                    من <span className="num">{fmt.num(openAll.length)}</span> مفتوحةً في المجلوب ·
                    لا شيءَ يستحقّ أن يُوقظك: التحذيرُ يُراجَع في النهار
                    {mostRepeated > 1
                      ? <> · وأكثرُها تكراراً <span className="num">{fmt.num(mostRepeated)}</span> مرّة</>
                      : null}
                    .
                  </>
                )}
              />
            ) : (
              <Hero
                value={fmt.num(openAll.length)}
                label="معلومةٌ مفتوحة — ولا تحذيرَ ولا حرج"
                ctx={(
                  <>
                    المعلومةُ للعلم لا للقيام، وأكثرُها أعطالُ قياسٍ لا أعطالَ خدمة —
                    لا أثرَ لها على أيّ زبون.
                  </>
                )}
              />
            )}

            {/* ★ السقفُ يُعلَن حين يُلامَس: «الباقي مخفيٌّ بالمرشّح» كانت كذبةً
                صامتةً عند التجاوز — الباقي لم يُجلب أصلاً. */}
            {capped && (
              <Note tone="warn">
                <b>بلغتَ سقفَ الجلب.</b> الخادم يُرجع{' '}
                <span className="num">{fmt.num(FETCH_CAP)}</span> حادثةً على الأكثر، الأحدثَ ظهوراً
                أوّلاً — فما قبلها **لم يُجلب** ولا يظهر هنا ولو أزلتَ كلّ مرشّح. حُلَّ ما تراه
                ليُكشف ما تحته، والعددُ في هذه الشاشة يُقرأ «من المجلوب» لا «من الكلّ».
              </Note>
            )}

            <Section
              title="السيل"
              sub={(
                <>
                  <span className="num">{fmt.num(shown.length)}</span> من{' '}
                  <span className="num">{fmt.num(all.length)}</span> مجلوبة — مجموعةً بالإلحاح
                  لا بالزمن
                </>
              )}
              actions={(
                <div className="cn-find">
                  <Field
                    label="ابحث"
                    id="inc-q"
                    hint="في العنوان والنوع واسم العميل — داخل المجلوب وحده."
                  >
                    <Input
                      id="inc-q"
                      type="search"
                      value={q}
                      onChange={setQ}
                      placeholder="price_missing · توكن · اسم عميل…"
                    />
                  </Field>
                </div>
              )}
            >
              {shown.length === 0 ? (
                <Empty
                  title="لا حادثة تطابق مرشّحك"
                  hint={capped
                    ? 'المرشّح يعمل على المجلوب وحده — ومئةٌ هي سقفُ الجلب، فما قبلها ليس هنا أصلاً. أزِل المرشّحات، أو بدّل الحالة.'
                    : 'المرشّح يعمل على ما جُلب من هذه الحالة — لا على السيل كلّه. أزِله لترى الباقي، أو بدّل الحالة.'}
                  action={<Button onClick={clearFilters}>أزِل المرشّحات</Button>}
                />
              ) : (
                <Stack gap="md">
                  {filtering && (
                    <p className="muted-p">
                      <span className="num">{fmt.num(shown.length)}</span> من{' '}
                      <span className="num">{fmt.num(byTenant.length)}</span> حادثةٍ عند
                      «<span dir="auto">{tenantLabel}</span>» — والباقي مخفيٌّ بالمرشّح لا محلول.
                    </p>
                  )}

                  {SEV_ORDER.map((s) => {
                    const list = shown.filter((i) => i.severity === s);
                    if (!list.length) return null;
                    const limit = shownPer[s] ?? PAGE;
                    const visible = list.slice(0, limit);
                    const rest = list.length - visible.length;
                    /* الحرجُ القليلُ يُفتح ابتداءً: من يفتح الشاشة على حادثةٍ
                       حرجةٍ واحدةٍ لا يُطلب منه نقرةٌ ليقرأها. وما زاد على
                       ثلاثٍ يبقى مطويّاً — وإلّا صار الجدارُ جداراً من جديد. */
                    const autoOpen = s === 'critical' && scope === 'live' && list.length <= 3;
                    return (
                      <Group
                        key={s}
                        title={SEV[s].head}
                        count={list.length}
                        attn={s === 'critical' && scope === 'live'}
                      >
                        {visible.map((i) => card(i, autoOpen))}
                        {rest > 0 && (
                          <Button
                            onClick={() => setShownPer({ ...shownPer, [s]: limit + PAGE })}
                          >
                            أظهِر {fmt.num(Math.min(rest, PAGE))} أخرى من «{SEV[s].label}»
                          </Button>
                        )}
                      </Group>
                    );
                  })}
                </Stack>
              )}
            </Section>

            <Note>
              <b>«رأيتها» ليست «حُلّت».</b> الأولى تُسكت الإشعار عن هذه البصمة وتقول إنّ لها صاحباً،
              والثانية تُغلق الحادثة. وما كان سببه عابراً يُغلق نفسه بعد فحصين سليمين متتاليين —
              وما كان قراراً بشريّاً (مخالفةُ حسابٍ عند ميتا، سقفُ باقة) يبقى بيدك عمداً.
            </Note>

          </Stack>
        )}
      </DataView>

      {/* ★ الرصيف: مرشّحات الشاشة في مدى الإبهام — هذه الشاشة تُفتح من
          الهاتف قبل الحاسوب، من السرير. */}
      <div className="cn-dock">
        <Dock hint="الشارةُ في التنقّل تعدّ الحرجَ المفتوحَ وحده — لا كلَّ الحوادث. والمرشّحاتُ تعمل على المجلوب لا على السيل كلّه.">
          <Row gap="xs">
            <span className="inc-fl">الحالة</span>
            {([['live', 'المفتوحة'], ['resolved', 'المحلولة']] as const).map(([id, label]) => (
              <button
                key={id} type="button" className="chipf"
                aria-pressed={scope === id}
                onClick={() => { setScope(id); setShownPer({}); }}
              >
                {label}
              </button>
            ))}
          </Row>

          <Row gap="xs">
            <span className="inc-fl">الشدّة</span>
            <button
              type="button" className="chipf"
              aria-pressed={sev === 'all'} onClick={() => setSev('all')}
            >
              الكلّ{' '}
          <span className="num">{state.data ? fmt.num(byText.length) : '—'}</span>
            </button>
            {SEV_ORDER.map((s) => (
              <button
                key={s} type="button" className="chipf"
                aria-pressed={sev === s} onClick={() => setSev(s)}
              >
                {SEV[s].label}{' '}
                <span className="num">
                  {fmt.num(byText.filter((i) => i.severity === s).length)}
                </span>
              </button>
            ))}
          </Row>

          {/* ★ ورقةٌ صاعدة بدل منسدلة، وشرطُها الفأرةُ لا العرض: لوحٌ
              لمسيٌّ عريضٌ يستحقّ ورقةً لا قائمةً تحتاج تصويباً بالإصبع.
              ونفسُ العقدة في الحالتين — لا شجرتان تتبادلان. */}
          <Button onClick={() => setPicker(true)}>
            العميل: {tenantLabel} ▾
          </Button>
        </Dock>
      </div>

      <Sheet
        open={picker}
        kind="menu"
        title="العميل"
        onClose={() => setPicker(false)}
        hint="الحوادث بلا عميلٍ هي أعطال المنصّة نفسها — لا عطلَ عند أحد عملائك."
      >
        <div className="opts">
          {tenantOpts.map((o) => (
            <button
              key={o.value}
              type="button"
              className="opt"
              aria-pressed={tenant === o.value}
              onClick={() => { setTenant(o.value); setPicker(false); }}
            >
              <span className="opt-t">
                <span dir="auto">{o.label}</span>
                <span className="opt-n">
                  <span className="num">{fmt.num(o.n)}</span> في المجلوب
                </span>
              </span>
              <span className="opt-e">
                {tenant === o.value ? <span className="opt-ck" aria-hidden="true">✓</span> : null}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </Stack>
  );
}
