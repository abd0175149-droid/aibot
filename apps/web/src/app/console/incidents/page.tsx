'use client';

import { useMemo, useState } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, ApiError } from '@/lib/api';
import {
  PageHead, Stack, Row, Field, Select, Button, Pill, Dot, Note, Empty,
  DataView, KV, KVRow, CodeBlock, type Tone,
} from '@/components/ui';

/**
 * سيل الحوادث.
 *
 * ★ المبدأ الذي يحكم الشاشة: **تُقرأ الثالثة فجراً.** وحينها لا تُقرأ الوثائق
 *   ولا تُفتح صفحةُ ويكي — فخطوات المعالجة مكتوبةٌ في البطاقة نفسها، تحت
 *   العنوان الذي أيقظك. حادثةٌ بلا خطوةٍ تالية ليست تنبيهاً، هي قلق.
 *
 * ★ وثلاثة أسئلةٍ تُجاب قبل أيّ فعل، ولذلك هي في رأس كلّ بطاقة:
 *     ① كم هي خطيرة؟ (الشدّة — حدٌّ ملوّن على حافّة البطاقة ونصٌّ معه)
 *     ② على مَن؟ (العميل — أو «عطل منصّة» إن لم يكن لها عميل)
 *     ③ **هل تُغلق نفسها؟** وهذا أهمّها وكان غائباً: خمسةُ أنواعٍ تُحلّ آليّاً
 *        بعد فحصين سليمين متتاليين، والباقي لا. من لا يعرف ذلك يستيقظ لعطلٍ
 *        كان سيزول وحده، أو ينام على عطلٍ لن يزول.
 *
 * ★ والترشيح بالشدّة والعميل يعمل على ما جُلب — لأنّ السيل مرتَّبٌ بآخر ظهور،
 *   والقفز إلى «الحرج عند هذا العميل» هو أوّل ما تفعله.
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
 *   `reply.ts` و`embed.ts` هي وحدها ما يرفع حادثة. وكانت أربعةُ أنواعٍ منها
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
    'افتح «التفصيل التقنيّ» أدناه: نصّ العطل يقول أيّ طرفٍ سقط',
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
    'افتح «التفصيل التقنيّ»: النسبة والقناة فيه',
    'الأشيع: 131047 نافذة مغلقة (صحيحٌ ومقصود) · 190 توكن منتهٍ ⟵ جدّد الربط',
    'وإن كان الفشل على كلّ القنوات وعند أكثر من عميل فالعطل عندنا: افحص عامل الإرسال والطوابير',
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
 * وعرضُه في البطاقة يجيب السؤال الذي يقرّر: أقوم من السرير أم لا؟
 */
const AUTO_RESOLVES = new Set(['channel_down', 'token_invalid', 'webhook_silent', 'send_failed', 'ai_error']);

const SEV: Record<Incident['severity'], { tone: Tone; label: string; edge: string }> = {
  critical: { tone: 'crit', label: 'حرج', edge: 'crit' },
  warn: { tone: 'warn', label: 'تحذير', edge: 'warn' },
  info: { tone: 'neutral', label: 'معلومة', edge: 'info' },
};

const SEV_ORDER: Array<Incident['severity']> = ['critical', 'warn', 'info'];

/** قيمةٌ لا تصلح اسم عميل — فلا تتعارض مع اسمٍ حقيقيّ في المرشّح. */
const PLATFORM = '\u0000platform';

type Scope = 'live' | 'resolved';

export default function IncidentsPage() {
  const [scope, setScope] = useState<Scope>('live');
  const [sev, setSev] = useState<'all' | Incident['severity']>('all');
  const [tenant, setTenant] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  /* الحالة من الخادم: بلا `status` يعيد المفتوحة والموسومة «رأيتها» معاً،
     و«المحلولة» تُطلب صراحةً — فالمراجعة بعد الإصلاح جزءٌ من العمل. */
  const state = useApi<Incident[]>(
    scope === 'resolved' ? '/console/incidents?status=resolved' : '/console/incidents',
  );
  const { toast, node: toastNode } = useToast();

  const all = state.data ?? [];

  const tenants = useMemo(() => {
    const names = new Set<string>();
    let hasPlatform = false;
    for (const i of all) {
      if (i.tenantName) names.add(i.tenantName);
      else hasPlatform = true;
    }
    return [
      { value: 'all', label: 'كلّ العملاء' },
      ...(hasPlatform ? [{ value: PLATFORM, label: 'عطل منصّة — بلا عميل' }] : []),
      /* أسماء العملاء نصٌّ لم نكتبه — و`<option>` لا يقبل `dir`، فنعزل
         الاسم بمحارف التوجيه ليُرسم بترتيبه لا بترتيب القائمة. */
      ...[...names].sort((a, b) => a.localeCompare(b, 'ar'))
        .map((n) => ({ value: n, label: `⁨${n}⁩` })),
    ];
  }, [all]);

  /* الترشيح بالعميل أوّلاً: عدّادات الشدّة تعدّ ما سيظهر فعلاً لو ضغطتها،
     لا ما في السيل كلّه — عدّادٌ يخالف نتيجته يُفقد الثقة في الشاشة. */
  const byTenant = all.filter((i) => (
    tenant === 'all' ? true
      : tenant === PLATFORM ? !i.tenantName
        : i.tenantName === tenant
  ));
  const shown = byTenant.filter((i) => sev === 'all' || i.severity === sev);
  const openCritical = all.filter((i) => i.severity === 'critical' && i.status !== 'resolved').length;
  const filtering = sev !== 'all' || tenant !== 'all';

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

  return (
    <Stack gap="lg">
      {toastNode}

      <PageHead
        title="الحوادث"
        sub="حادثةٌ واحدة لكلّ بصمة. تكرار العطل يرفع العدّاد ولا يُنشئ إشعاراً جديداً — وهذا ما يمنع مئتَي إشعارٍ من عطلٍ واحد."
        /* ★ الرأس كان خارج حالة البيانات، فيقول «لا حادثة حرجة مفتوحة»
           بنقطةٍ خضراء **حين يفشل النداء** — وهي أخطر طمأنينةٍ كاذبة في
           المنتج: شاشةُ الحوادث تحديداً. ويقولها أيضاً في نطاق «المحلولة»
           حيث الخادم يُرجع المحلولة وحدها فالعدّ صفرٌ بحكم الاستعلام. */
        actions={state.loading ? null : state.error ? (
          <Row gap="sm">
            <Dot tone="warn" />
            <span className="muted-p">تعذّر جلب الحوادث — العدّاد غير معروف</span>
          </Row>
        ) : scope === 'resolved' ? null : (
          <Row gap="sm">
            <Dot tone={openCritical ? 'crit' : 'ok'} />
            <span className="muted-p">
              {openCritical
                ? `${fmt.num(openCritical)} حادثة حرجة مفتوحة`
                : 'لا حادثة حرجة مفتوحة'}
            </span>
          </Row>
        )}
      />

      <div className="inc-filters">
        <Stack gap="sm">
          <div role="group" aria-label="الحالة">
            <Row gap="xs">
              <span className="inc-fl">الحالة</span>
              {([['live', 'المفتوحة'], ['resolved', 'المحلولة']] as const).map(([id, label]) => (
                <button
                  key={id} type="button" className="chipf"
                  aria-pressed={scope === id}
                  onClick={() => setScope(id)}
                >
                  {label}
                </button>
              ))}
            </Row>
          </div>

          <div role="group" aria-label="الشدّة">
            <Row gap="xs">
              <span className="inc-fl">الشدّة</span>
              <button
                type="button" className="chipf"
                aria-pressed={sev === 'all'} onClick={() => setSev('all')}
              >
                الكلّ <span className="num">{fmt.num(byTenant.length)}</span>
              </button>
              {SEV_ORDER.map((s) => (
                <button
                  key={s} type="button" className="chipf"
                  aria-pressed={sev === s} onClick={() => setSev(s)}
                >
                  {SEV[s].label}{' '}
                  <span className="num">{fmt.num(byTenant.filter((i) => i.severity === s).length)}</span>
                </button>
              ))}
            </Row>
          </div>

          <div className="inc-ften">
            <Field label="العميل" id="inc-tenant" hint="الحوادث بلا عميلٍ هي أعطال المنصّة نفسها.">
              <Select id="inc-tenant" value={tenant} onChange={setTenant} options={tenants} />
            </Field>
          </div>
        </Stack>
      </div>

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
        {() => (shown.length === 0 ? (
          <Empty
            title="لا حادثة تطابق مرشّحك"
            hint="المرشّح يعمل على ما جُلب من هذه الحالة — لا على السيل كلّه. أزِله لترى الباقي، أو بدّل الحالة."
            action={<Button onClick={() => { setSev('all'); setTenant('all'); }}>أزِل المرشّحات</Button>}
          />
        ) : (
          <Stack gap="md">
            {filtering && (
              <p className="muted-p">
                <span className="num">{fmt.num(shown.length)}</span> من{' '}
                <span className="num">{fmt.num(all.length)}</span> حادثة — الباقي مخفيٌّ بالمرشّح لا محلول.
              </p>
            )}

            {shown.map((i) => {
              const s = SEV[i.severity];
              const steps = RUNBOOK[i.kind];
              const auto = AUTO_RESOLVES.has(i.kind);
              const done = i.status === 'resolved';
              const hasDetail = Boolean(i.detail && Object.keys(i.detail).length > 0);

              return (
                <article key={i.id} className={`inc ${s.edge}${done ? ' done' : ''}`}>
                  <Row gap="xs">
                    <Pill tone={s.tone} label={s.label} />
                    {i.status === 'ack' && <Pill tone="warn" label="رأيتها" />}
                    {done && <Pill tone="ok" label="حُلّت" />}
                    {/* اسم العميل يكتبه هو، فيلزمه `dir="auto"` — و`Pill` لا
                        تمرّر اتّجاهاً، فنستعمل صنفها نفسه بلا صنفٍ جديد. */}
                    {i.tenantName
                      ? <span className="pill neutral" dir="auto">{i.tenantName}</span>
                      : <Pill tone="violet" label="عطل منصّة — بلا عميل" mark={false} />}
                    {!done && (
                      <Pill
                        tone={auto ? 'neutral' : 'warn'}
                        mark={false}
                        label={auto ? 'تُغلق آليّاً بفحصين سليمين' : 'إغلاقها بيدك'}
                      />
                    )}
                  </Row>

                  {/* العنوان يكتبه العامل وقد يحمل اسم نموذجٍ أو حساباً لاتينيّاً */}
                  <h2 className="inc-t" dir="auto">{i.title}</h2>

                  <KV>
                    <KVRow k="آخر ظهور">{fmt.when(i.lastSeenAt)}</KVRow>
                    <KVRow k="أوّل ظهور">{fmt.when(i.firstSeenAt)}</KVRow>
                    <KVRow k="تكرّرت">
                      <span className="num">{fmt.num(i.count)}</span> مرّة
                    </KVRow>
                    <KVRow k="النوع"><span className="mono">{i.kind}</span></KVRow>
                  </KV>

                  {steps ? (
                    <div className="inc-run">
                      <b>خطوات المعالجة:</b>
                      <ol>{steps.map((t) => <li key={t}>{t}</li>)}</ol>
                    </div>
                  ) : (
                    <Note tone="warn">
                      <b>لا خطوات مكتوبةٌ لهذا النوع بعد.</b> ابدأ من «التفصيل التقنيّ» أدناه،
                      ثمّ أضِف ما فعلتَه خطوةً هنا — فمن يفتح الشاشة بعدك لن يبدأ من الصفر.
                    </Note>
                  )}

                  {hasDetail && (
                    <details className="inc-d">
                      <summary>التفصيل التقنيّ</summary>
                      {/* سلسلة آلةٍ خالصة: مونو و`ltr` ونسخٌ بضغطة — لتُلصق في رسالة */}
                      <CodeBlock label="detail" text={JSON.stringify(i.detail, null, 2)} />
                    </details>
                  )}

                  <Row gap="sm">
                    {i.status === 'open' && (
                      <Button
                        onClick={() => void act(i.id, 'ack')}
                        busy={busy === `${i.id}:ack`}
                      >
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
                </article>
              );
            })}
          </Stack>
        ))}
      </DataView>

      <Note>
        <b>«رأيتها» ليست «حُلّت».</b> الأولى تُسكت الإشعار عن هذه البصمة وتقول إنّ لها صاحباً،
        والثانية تُغلق الحادثة. وما كان سببه عابراً يُغلق نفسه بعد فحصين سليمين متتاليين —
        وما كان قراراً بشريّاً (مخالفةُ حسابٍ عند ميتا، سقفُ باقة) يبقى بيدك عمداً.
      </Note>
    </Stack>
  );
}
