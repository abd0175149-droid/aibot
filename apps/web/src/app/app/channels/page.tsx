'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useApi, useToast, fmt } from '@/lib/useApi';
import { post, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import {
  PageHead, Grid, Stack, Row, Card, Pill, Tag, Note, Button, Sheet,
  Skeleton, ErrorBox, KV, KVRow, type Tone,
} from '@/components/ui';
import { Band, Hero, Vital, Fold, ScreenDock, MARK, SEV, type Sev } from '@/components/screen';

/**
 * القنوات.
 *
 * ★ القرار الذي تحمله الشاشة: **لا سرٌّ يُعرض أبداً** — ولا حتّى لمالك المنصّة.
 *   بصمةٌ وتاريخٌ وزرّ استبدال. سرٌّ يُعرض مرّةً يُنسخ إلى مكانٍ لا نتحكّم فيه،
 *   ثمّ يبقى هناك بعد أن يُنسى.
 *
 * ★ و«افحص الاتّصال» فحصٌ **حقيقيّ** عند ميتا لا قراءةُ صفٍّ عندنا. وأهمّ سطرٍ
 *   في نتيجته اشتراك الويبهوك: هو السبب الأوّل لـ«البوت لا يردّ» بينما التوكن
 *   صالحٌ والرقم أخضر وكلّ شاشةٍ خضراء. ولذلك صعد من سطرٍ في جدولٍ من ثمانية
 *   إلى **صفٍّ حيويٍّ** بوزنٍ أثقل ونصِّ عاقبةٍ تحته — هو وسمعةُ الرقم: الصفّان
 *   اللذان ينكسر المنتج بسببهما وحدهما.
 *
 * ── ثلاثة أعطالٍ أُصلحت في هذه المرحلة ─────────────────────────────────────
 *  ① **الشاشة كانت تصير هيكلاً عظميّاً بعد كلّ فحصٍ ناجح.** `runTest` كان
 *    ينتهي بـ`reload()`، و`useApi` يرفع `loading` في كلّ جلبٍ — فتُستبدل
 *    الشاشةُ كلُّها (ومعها نتيجةُ الفحص التي لم تُقرأ بعد) بهياكل رماديّة.
 *    والصحيح تحديثٌ **موضعيّ**: الخادم يكتب خمسةَ حقولٍ معروفةً بعد الفحص،
 *    والاستجابةُ تحملها كلَّها، فتُخاط في الصفّ بلا نداءٍ ثانٍ ولا وميض.
 *  ② **خمسةٌ من ستّة أزرارٍ كانت معطَّلةً دائماً** في شاشةٍ عنوانها «اضبطه
 *    بنفسك» — وزرٌّ لا يُضغط أبداً ليس زرّاً بل إعلانُ عطل. فما لا يُفعَل صار
 *    نصّاً يُقرأ، وما يُمكن فعلُه الآن صار فعلاً حقيقيّاً: **ورقةٌ صاعدة**
 *    تعرض الخطوات عند ميتا. صفرُ أزرارٍ معطَّلةٍ بلا شرطٍ حقيقيّ.
 *  ③ **اسمُ الحساب كان في `.mono`** — و`IBM Plex Mono` بلا تغطيةٍ عربيّةٍ
 *    إطلاقاً، والاسمُ يأتي من ميتا وقد يكون عربيّاً («مطعم بيت الشام»).
 *    فكان يسقط صامتاً لخطٍّ احتياطيٍّ يختلف على كلّ منصّة.
 */

interface Channel {
  id: string;
  kind: 'whatsapp_cloud' | 'instagram';
  status: 'pending' | 'connected' | 'error' | 'disabled';
  displayName: string | null;
  tokenFingerprint: string | null;
  qualityRating: string | null;
  messagingTier: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  capabilities: { buttons: number; quickReplies: number; location: boolean; windowHours: number };
}

/**
 * ★ الاستجابة تحمل أكثر مما كانت الواجهة تقرأ: `qualityRating` و
 *   `messagingTier` و`checkedAt` تعود من الخادم في نفس النداء — وهي بالضبط
 *   ما يجعل التحديثَ الموضعيَّ ممكناً بلا `reload()`. وكلُّها اختياريّةٌ في
 *   النوع لأنّ الحقل الغائب يجب أن يُبقي القيمةَ القديمة لا أن يمحوها.
 */
interface TestReport {
  level: 'ok' | 'degraded' | 'blocked' | 'unreachable';
  tokenValid: boolean;
  webhookSubscribed: boolean | null;
  qualityRating?: string | null;
  messagingTier?: string | null;
  issues: string[];
  checkedAt?: string;
}

const KIND: Record<Channel['kind'], { label: string; tone: Tone }> = {
  whatsapp_cloud: { label: 'واتساب', tone: 'brand' },
  instagram: { label: 'إنستجرام', tone: 'violet' },
};

const STATE: Record<Channel['status'], { label: string; tone: Tone; sev: Sev }> = {
  connected: { label: 'موصولة', tone: 'ok', sev: 'good' },
  error: { label: 'لا تعمل', tone: 'crit', sev: 'bad' },
  pending: { label: 'قيد الربط', tone: 'warn', sev: 'warn' },
  disabled: { label: 'موقوفة', tone: 'neutral', sev: 'plain' },
};

/**
 * سمعةُ الرقم عند ميتا — و**نصُّ العاقبة** معها لا نصُّ الحالة: «أخضر» حالة،
 * و«لو صار أصفر أوقف أيّ إرسالٍ جماعيّ في الحال» قرار.
 */
const QUALITY: Record<string, { label: string; sev: Sev; why: string }> = {
  GREEN: {
    label: 'أخضر',
    sev: 'good',
    why: 'لم تُشكَ رسائلك بما يُذكر. ولو صار أصفر: أوقف أيّ إرسالٍ جماعيٍّ في الحال. '
      + 'ولو صار أحمر: تخفض ميتا سقف إرسالك اليوميّ، وهو أثرٌ يُحسّ في المبيعات لا في لوحةٍ.',
  },
  YELLOW: {
    label: 'أصفر',
    sev: 'warn',
    why: 'شكاوى زبائنك ارتفعت. أوقف أيّ إرسالٍ جماعيٍّ الآن — فإن صار أحمر خفضت ميتا '
      + 'سقف إرسالك اليوميّ، والعودة منه أبطأ من الهبوط إليه.',
  },
  RED: {
    label: 'أحمر',
    sev: 'bad',
    why: 'ميتا خفضت سقف إرسالك اليوميّ فعلاً. لا ترسل شيئاً جماعيّاً حتّى يعود أصفر أو أخضر، '
      + 'وراسلنا لنراجع معك ما يُشكى منه.',
  },
};

const LEVEL: Record<TestReport['level'], { label: string; tone: Tone; sev: Sev }> = {
  ok: { label: 'سليمة', tone: 'ok', sev: 'good' },
  degraded: { label: 'تعمل بجودةٍ أقلّ', tone: 'warn', sev: 'warn' },
  blocked: { label: 'محجوبة', tone: 'crit', sev: 'bad' },
  unreachable: { label: 'لا تستجيب', tone: 'crit', sev: 'bad' },
};

/** صفُّ فحصٍ داخل تقرير — علامةٌ وحكمٌ وسطرُ تفسيرٍ تحته. */
function Chk({ sev = 'plain', k, why }: { sev?: Sev; k: string; why: ReactNode }) {
  return (
    <div className={`sc-chk${SEV[sev]}`}>
      <span aria-hidden="true" className="sc-chk-m">{MARK[sev]}</span>
      <span className="sc-chk-k">{k}</span>
      <span className="sc-chk-s">{why}</span>
    </div>
  );
}

export default function ChannelsPage() {
  const can = useCan();
  const { data, loading, error, reload, setData } = useApi<{ items: Channel[] }>('/channel');
  const { toast, node: toastNode } = useToast();
  /** أيُّ فحصٍ يجري الآن: معرّفُ قناةٍ أو `all` — لا `boolean` واحدٌ لثلاثة أزرار. */
  const [busy, setBusy] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, TestReport>>({});
  const [steps, setSteps] = useState<'wa' | 'ig' | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);

  function openSteps(k: 'wa' | 'ig') {
    setSteps(k);
    setStepsOpen(true);
  }

  /**
   * ★ تحديثٌ موضعيٌّ بدل `reload()`.
   *   الخادم يكتب — بعد الفحص — خمسةَ حقولٍ بعينها، والاستجابةُ تحملها كلَّها.
   *   فتُخاط هنا بنفس قاعدة الخادم حرفيّاً (`ok` و`degraded` تبقيان «موصولة»،
   *   وما سواهما «لا تعمل»)، فلا تتباعد الشاشةُ عن القاعدة ولا تُستبدل بهياكل.
   */
  function stitch(id: string, r: TestReport) {
    setData((d) => (d ? {
      items: d.items.map((c) => (c.id === id ? {
        ...c,
        lastCheckedAt: r.checkedAt ?? new Date().toISOString(),
        lastError: r.issues[0] ?? null,
        qualityRating: r.qualityRating ?? c.qualityRating,
        messagingTier: r.messagingTier ?? c.messagingTier,
        status: r.level === 'ok' || r.level === 'degraded' ? 'connected' as const : 'error' as const,
      } : c)),
    } : d));
  }

  async function runTest(channelId: string) {
    setBusy(channelId);
    try {
      const r = await post<TestReport>('/channel/test', { channelId });
      setReports((m) => ({ ...m, [channelId]: r }));
      stitch(channelId, r);
      toast(r.level === 'ok' ? 'القناة سليمة' : 'الفحص انتهى — اقرأ التفاصيل');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر الفحص');
    } finally {
      setBusy(null);
    }
  }

  /** فحصُ كلِّ موصولةٍ — واحدةً بعد أخرى، فلا يُخمَّن أيَّها فحص الخادم. */
  async function runAll(ids: string[]) {
    setBusy('all');
    let bad = 0;
    try {
      for (const id of ids) {
        // متسلسلٌ عمداً: الفحص نداءٌ شبكيٌّ عند ميتا، والتوازي يضاعف حدَّ المعدّل
        // eslint-disable-next-line no-await-in-loop
        const r = await post<TestReport>('/channel/test', { channelId: id });
        setReports((m) => ({ ...m, [id]: r }));
        stitch(id, r);
        if (r.level !== 'ok') bad += 1;
      }
      toast(bad ? 'الفحص انتهى — اقرأ التفاصيل' : 'كلُّ القنوات الموصولة سليمة');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'تعذّر الفحص');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Skeleton rows={4} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  const wa = items.find((c) => c.kind === 'whatsapp_cloud');
  const ig = items.find((c) => c.kind === 'instagram');
  const broken = items.filter((c) => c.status !== 'connected');
  const live = items.filter((c) => c.status === 'connected');
  const lastCheck = items
    .map((c) => c.lastCheckedAt)
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1) ?? null;

  const band: { sev: Sev; head: ReactNode; sub: ReactNode } = !items.length
    ? {
      sev: 'warn',
      head: 'لم تربط قناةً بعد',
      sub: 'زبائنك لا يستطيعون مراسلتك حتّى تُربط قناةٌ واحدةٌ على الأقلّ.',
    }
    : broken.length
      ? {
        sev: 'bad',
        head: `${broken.map((c) => KIND[c.kind].label).join(' و')} لا تصل منها رسائل زبائنك`,
        sub: broken[0]?.lastError
          ?? 'اضغط «افحص القنوات الموصولة» في الرصيف أسفل — الفحص يسأل ميتا مباشرةً لا صفّاً عندنا.',
      }
      : {
        sev: 'good',
        head: 'كلُّ قنواتك تستقبل وتردّ',
        sub: <>آخر فحصٍ عند ميتا: {fmt.when(lastCheck)} — والفحصُ يسأل ميتا مباشرةً لا صفّاً عندنا.</>,
      };

  return (
    <Stack gap="lg">
      {toastNode}
      <PageHead
        title="القنوات"
        sub="من هنا تصل رسائل زبائنك — ومن هنا تنقطع. نفس البوت ونفس المعرفة على كلّ قناة، وما يختلف هو ما تسمح به القناة."
      />

      <Band sev={band.sev} head={band.head} sub={band.sub} />

      {/* ★ البطوليّ يُختار بالحالة: عددُ القنوات التي **لا تعمل** حين توجد
          قنوات، وعددُ المربوطة حين لا توجد — فالصفرُ في الحالتين معنًى مختلف
          تماماً، ولا يجوز أن يُرسم بنفس الوسم. */}
      {items.length ? (
        <Hero
          sev={broken.length ? 'bad' : 'good'}
          value={fmt.num(broken.length)}
          label={broken.length
            ? 'قناةً لا تصل منها رسائل زبائنك كما يجب'
            : 'قناةً معطَّلة — كلُّ ما يكتبه زبائنك يصل'}
          ctx={(
            <>
              من <span className="num">{fmt.num(items.length)}</span> قناةً مربوطة ·
              {' '}<span className="num">{fmt.num(live.length)}</span> موصولةٌ الآن ·
              {' '}آخر فحص {fmt.when(lastCheck)}
            </>
          )}
        />
      ) : (
        <Hero
          sev="warn"
          value="0"
          label="قناةً مربوطة — ولا رسالةَ تصل حتّى تُربط واحدة"
          ctx="الربط يجري معك على مكالمة: واتساب 30 إلى 60 دقيقة أوّل مرّة، وإنستجرام ثلاث نقراتٍ بلا سرٍّ تلصقه."
        />
      )}

      <Grid min={400}>
        {/* ── واتساب ── */}
        <Card
          title={(
            <Row gap="sm">
              <Pill tone="brand" label="واتساب" mark={false} />
              <Tag
                tone={STATE[wa?.status ?? 'pending'].tone}
                label={wa ? STATE[wa.status].label : 'غير مربوطة'}
              />
            </Row>
          )}
          actions={wa?.displayName
            /* ★ `dir="auto"` لا `.mono`: الاسمُ الموثَّق من ميتا قد يكون عربيّاً */
            ? <span dir="auto" className="sc-ctx">{wa.displayName}</span>
            : undefined}
        >
          <Stack gap="sm">
            {wa?.status === 'connected' ? (
              <>
                {/* ★ الصفّان اللذان ينكسر المنتج بسببهما — أوّلاً وبوزنٍ أثقل */}
                <Vital
                  sev={wa.qualityRating ? (QUALITY[wa.qualityRating]?.sev ?? 'plain') : 'plain'}
                  k={wa.qualityRating
                    ? `سمعةُ رقمك عند ميتا: ${QUALITY[wa.qualityRating]?.label ?? wa.qualityRating}`
                    : 'سمعةُ رقمك عند ميتا: لم تُقرأ بعد'}
                  why={wa.qualityRating
                    ? (QUALITY[wa.qualityRating]?.why ?? 'قيمةٌ جديدةٌ من ميتا — راسلنا لنقرأها معك.')
                    : 'تُقرأ من ميتا عند أوّل فحصٍ للاتّصال. وهي التي تقرّر سقف إرسالك اليوميّ.'}
                />
                <WebhookVital report={reports[wa.id]} lastCheckedAt={wa.lastCheckedAt} />
              </>
            ) : (
              <Stack gap="sm">
                <p className="muted-p">
                  رقمك وحسابك عند ميتا — لا عندنا. فاتورة ميتا عليك، وتأخذ رقمك معك إن رحلت.
                </p>
                <p className="muted-p">
                  الربط يحتاج أربع قيمٍ من لوحتك عند ميتا، ونقوم بها معك على مكالمة —
                  <b> 30 إلى 60 دقيقة أوّل مرّة</b>.
                </p>
              </Stack>
            )}

            {wa?.lastError && <Note tone="crit">{wa.lastError}</Note>}

            {wa && reports[wa.id] && <Report r={reports[wa.id]!} />}

            {wa?.status === 'connected' && (
              <Fold summary="تفاصيلُ تقنيّة — لا يُتّخذ عليها قرار">
                <KV>
                  <KVRow k="بصمة المفتاح"><span className="mono">{wa.tokenFingerprint ?? '—'}</span></KVRow>
                  <KVRow k="مستوى الإرسال"><span className="mono">{wa.messagingTier ?? '—'}</span></KVRow>
                  <KVRow k="نافذة الردّ الحرّ">
                    <span className="num">{wa.capabilities.windowHours}</span> ساعةً من آخر رسالةٍ للزبون
                  </KVRow>
                  <KVRow k="الأزرار في الرسالة">
                    <Row gap="xs">
                      <Pill tone="ok" label="مدعومة" />
                      <span><span className="num">{wa.capabilities.buttons}</span> كحدٍّ أقصى</span>
                    </Row>
                  </KVRow>
                  <KVRow k="إرسال الموقع"><Pill tone="ok" label="مدعوم" /></KVRow>
                  <KVRow k="آخر فحص">{fmt.when(wa.lastCheckedAt)}</KVRow>
                </KV>
                <p className="muted-p">
                  استبدالُ المفتاح يجري من لوحة المالك معك، لأنّ الرقم مملوكٌ لحسابك عند ميتا
                  ولا نستطيع لمسه عنك. ولا سرَّ يُعرض هنا أبداً — بصمةٌ وتاريخٌ فقط.
                </p>
              </Fold>
            )}

            <Row gap="xs">
              {wa?.status === 'connected' ? (
                <Button
                  size="md"
                  busy={busy === wa.id}
                  disabled={can.readOnly || busy !== null}
                  reason={can.readOnly ? 'حسابك للقراءة فقط' : busy !== null ? 'فحصٌ يجري الآن' : undefined}
                  onClick={() => void runTest(wa.id)}
                >
                  افحص الاتّصال
                </Button>
              ) : (
                /* ★ كان هنا زرٌّ **معطَّلٌ دائماً** («ابدأ الربط») — وزرٌّ لا يُضغط
                   أبداً يُقرأ «المنتج معطوب». والفعلُ الحقيقيُّ المتاح الآن هو
                   معرفةُ ما يحتاجه الربط قبل المكالمة، فصار هو الزرّ. */
                <Button size="md" onClick={() => openSteps('wa')}>أرِني ما يحتاجه الربط</Button>
              )}
            </Row>
          </Stack>
        </Card>

        {/* ── إنستجرام ── */}
        <Card
          title={(
            <Row gap="sm">
              <Pill tone="violet" label="إنستجرام" mark={false} />
              <Tag
                tone={STATE[ig?.status ?? 'pending'].tone}
                label={ig ? STATE[ig.status].label : 'غير مربوطة'}
              />
            </Row>
          )}
          actions={ig?.displayName
            ? <span dir="auto" className="sc-ctx">{ig.displayName}</span>
            : undefined}
        >
          <Stack gap="sm">
            {ig?.status === 'connected' ? (
              <>
                <Vital
                  sev="good"
                  k="نافذةٌ مستقلّةٌ عن واتساب"
                  why={(
                    <>
                      <span className="num">{ig.capabilities.windowHours}</span> ساعةً من آخر رسالةٍ للزبون،
                      وتُحتسب على حدة: زبونٌ يراسلك على القناتين يستهلك نافذتين — لأنّهما محادثتان
                      منفصلتان عند ميتا.
                    </>
                  )}
                />
                <Vital
                  sev="plain"
                  k="لا شيء تلصقه هنا"
                  why="الربط بموافقةٍ من داخل فيسبوك لا بمفتاحٍ تنسخه — فلا سرَّ يُسرَّب ولا ينتهي."
                />
              </>
            ) : (
              <Stack gap="sm">
                <p className="muted-p">
                  ثلاث ضغطات، ولا سرَّ تلصقه: تختار حسابك التجاريّ وتمنحنا قراءة الرسائل
                  والردّ عليها. لا صلاحيّة نشرٍ ولا إعلانات.
                </p>
                <p className="muted-p">
                  نفس البوت ونفس المعرفة — ونافذةٌ مستقلّة تُحتسب على حدة.
                </p>
              </Stack>
            )}

            {ig?.lastError && <Note tone="crit">{ig.lastError}</Note>}

            {ig && reports[ig.id] && <Report r={reports[ig.id]!} />}

            {ig?.status === 'connected' && (
              <Fold summary="تفاصيلُ تقنيّة — لا يُتّخذ عليها قرار">
                <KV>
                  <KVRow k="ما لصقتَه"><b>لا شيء</b> — الربط بموافقةٍ لا بمفتاح</KVRow>
                  <KVRow k="الأزرار في الرسالة">
                    <Row gap="xs">
                      <Pill tone="warn" label="تصير ردوداً سريعة" />
                      <span><span className="num">{ig.capabilities.quickReplies}</span> كحدٍّ أقصى</span>
                    </Row>
                  </KVRow>
                  <KVRow k="إرسال الموقع"><Pill tone="neutral" label="غير مدعوم — الأداة مخفيّة" /></KVRow>
                  <KVRow k="آخر فحص">{fmt.when(ig.lastCheckedAt)}</KVRow>
                </KV>
                <p className="muted-p">
                  إعادةُ المنح وفصلُ الحساب يجريان معك على مكالمة حتّى نفتح تدفّق الموافقة —
                  وفصلُ حسابٍ يُسكت بوتك عن كلّ زبائنك على هذه القناة، فلا يكون أضعفَ زرٍّ في الشاشة.
                </p>
              </Fold>
            )}

            <Row gap="xs">
              {ig?.status === 'connected' ? (
                <Button
                  size="md"
                  busy={busy === ig.id}
                  disabled={can.readOnly || busy !== null}
                  reason={can.readOnly ? 'حسابك للقراءة فقط' : busy !== null ? 'فحصٌ يجري الآن' : undefined}
                  onClick={() => void runTest(ig.id)}
                >
                  افحص الاتّصال
                </Button>
              ) : (
                <Button size="md" onClick={() => openSteps('ig')}>أرِني خطوات الربط</Button>
              )}
            </Row>
          </Stack>
        </Card>
      </Grid>

      <Fold summary="لماذا الربط مختلفٌ بين القناتين — ولماذا لا نعرض سرّاً أبداً">
        <Note>
          <b>لماذا الربط مختلف بين القناتين.</b> واتساب على حسابك أنت، فالمسؤوليّة والرقم لك —
          والثمن تهيئةٌ أطول. وإنستجرام على تطبيقنا، فالربط بضغطة — والرسائل المباشرة بلا
          قوالب ولا حملات، فسطح المخالفة أضيق بكثير.
        </Note>
        <Note tone="warn">
          <b>لا سرَّ يُعرض هنا أبداً</b> — ولا حتّى لنا. بصمةٌ وتاريخٌ وزرّ استبدال. وسرٌّ يُعرض
          مرّةً يُنسخ إلى مكانٍ لا نتحكّم فيه، ثمّ يبقى هناك بعد أن تنساه.
        </Note>
      </Fold>

      {/* ★ الرصيف: فعلُ الشاشة الأوّل في مدى الإبهام. والفحصُ يمرّ على كلّ
          موصولةٍ **بمعرّفها** — فلا يُخمَّن أيَّها فحص الخادم. */}
      <ScreenDock
        hint={live.length
          ? 'الفحص يسأل ميتا مباشرةً عن كلّ قناةٍ موصولة: صلاحيّةُ المفتاح واشتراكُ الإشعار وسمعةُ الرقم. ولا يُرسل شيئاً إلى زبائنك.'
          : 'لا قناةَ موصولةٌ لتُفحص بعد — ابدأ بالربط من البطاقة أعلى.'}
      >
        <Button
          variant="primary"
          size="lg"
          wide
          busy={busy === 'all'}
          disabled={can.readOnly || !live.length || busy !== null}
          reason={!live.length
            ? 'لا قناةَ موصولة لتُفحص'
            : can.readOnly
              ? 'حسابك للقراءة فقط — الانتحال لا يكتب'
              : busy !== null ? 'فحصٌ يجري الآن' : undefined}
          onClick={() => void runAll(live.map((c) => c.id))}
        >
          افحص القنوات الموصولة <span className="num">{`(${fmt.num(live.length)})`}</span>
        </Button>
      </ScreenDock>

      {/* ★ ورقةٌ صاعدةٌ لا منسدلة، وشرطُ هيئتها الفأرةُ لا العرض (في CSS):
          لوحٌ لمسيٌّ عريضٌ يستحقّ ورقةً تصعد. */}
      <Sheet
        open={stepsOpen}
        onClose={() => setStepsOpen(false)}
        title={steps === 'wa' ? 'ما يحتاجه ربط واتساب' : 'ثلاثُ خطواتٍ عند إنستجرام'}
        hint={steps === 'wa'
          ? 'نقوم بها معك على مكالمة — ولا تلصق شيئاً في هذه الشاشة.'
          : 'ولا رقمَ تكتبه ولا سرَّ تنسخه — الموافقة تجري عند ميتا.'}
        footer={<Button variant="quiet" onClick={() => setStepsOpen(false)}>أغلِق</Button>}
      >
        {steps === 'wa' ? (
          <>
            <p className="muted-p">
              أربع قيمٍ من لوحتك عند ميتا — وكلُّها تبقى عندك، ولا يُعرض منها شيءٌ في هذه الشاشة بعد الربط.
            </p>
            <ol className="sc-steps">
              <li><span>حسابُ أعمالٍ على فيسبوك، وفيه حسابُ واتساب للأعمال ورقمٌ مُثبَت.</span></li>
              <li><span>معرّفُ الرقم ومعرّفُ حساب واتساب للأعمال — من لوحة ميتا.</span></li>
              <li><span>مفتاحُ «مستخدم نظام» بلا انتهاء، لا مفتاحاً مؤقّتاً عمرُه 24 ساعة.</span></li>
              <li><span>نضبط معك اشتراكَ الإشعار عند ميتا — وهو السبب الأوّل لـ«البوت لا يردّ».</span></li>
            </ol>
          </>
        ) : (
          <>
            <p className="muted-p">
              إنستجرام يُربَط بموافقتك من داخل فيسبوك. ولا صلاحيّة نشرٍ ولا إعلانات — قراءةُ
              الرسائل والردُّ عليها فقط.
            </p>
            <ol className="sc-steps">
              <li><span>من تطبيق إنستجرام: الإعدادات ← نوعُ الحساب ← حوِّله إلى «حساب أعمال».</span></li>
              <li><span>اربط الحساب بصفحة فيسبوك تملكها — وهذا أشيعُ ما يفشل في المحاولة الأولى.</span></li>
              <li><span>راسِلنا لنفتح لك نافذة الموافقة — تدفّقُ المنح الذاتيّ قيد البناء.</span></li>
            </ol>
          </>
        )}
      </Sheet>
    </Stack>
  );
}

/**
 * ★ أهمّ سطرٍ في الشاشة: هل تصل رسائل زبائنك إلى بوتك.
 *   وهو السبب الأوّل لـ«البوت لا يردّ» بينما المفتاح صالحٌ وكلّ شاشةٍ خضراء —
 *   فلا يكون سطراً في جدولٍ من ثمانية، ولا يُقال «مشترك» بل يُقال ما يحدث
 *   لو انقطع. وقبل أوّل فحصٍ **لا يُدَّعى شيء**: «لم يُفحص» حالةٌ ثالثة.
 */
function WebhookVital({ report, lastCheckedAt }: {
  report?: TestReport; lastCheckedAt: string | null;
}) {
  if (!report) {
    return (
      <Vital
        sev="plain"
        k="وصولُ رسائل زبائنك إلى بوتك: لم يُفحص في هذه الجلسة"
        why={(
          <>
            آخر فحصٍ كامل: {fmt.when(lastCheckedAt)}. والفحص يسأل ميتا: هل ما زالت تُشعِرنا
            برسائل زبائنك؟ فإن انقطع الإشعار لا يعلم بوتك أنّ أحداً كتب — وهو العطل الذي
            يبدو «صمتاً» بلا سبب.
          </>
        )}
      />
    );
  }
  if (report.webhookSubscribed === true) {
    return (
      <Vital
        sev="good"
        k="وصولُ رسائل زبائنك إلى بوتك: يعمل"
        why="اشتراكُ الإشعار عند ميتا قائمٌ الآن، فما يكتبه زبونك يصل إلى بوتك. ولو انقطع لاحقاً فهذا الفحص هو من يكشفه."
      />
    );
  }
  if (report.webhookSubscribed === false) {
    return (
      <Vital
        sev="bad"
        k="وصولُ رسائل زبائنك إلى بوتك: متوقّف"
        why="ميتا لا تُشعِرنا برسائل زبائنك، فبوتك لا يعلم أنّ أحداً كتب — ولا يردّ ولا يظهر عطلٌ في أيّ شاشة. راسِلنا الآن لنُعيد الاشتراك."
      />
    );
  }
  return (
    <Vital
      sev="warn"
      k="وصولُ رسائل زبائنك إلى بوتك: تعذّر التحقّق"
      why="ميتا لم تُجب عن سؤال الاشتراك في هذا الفحص. أعِد الفحص بعد دقائق، وإن تكرّر فراسِلنا — فهذا السطر لا يُترك مجهولاً."
    />
  );
}

/** تقريرُ الفحص: ما ثبت وما لم يثبت، سطراً سطراً وبوقته. */
function Report({ r }: { r: TestReport }) {
  const lv = LEVEL[r.level];
  return (
    <div className="sc-rep">
      <div className="sc-rep-h">
        <b>نتيجةُ الفحص</b>
        <Tag tone={lv.tone} label={lv.label} />
        <span className="sc-rep-t">{fmt.when(r.checkedAt)}</span>
      </div>
      <Chk
        sev={r.tokenValid ? 'good' : 'bad'}
        k={r.tokenValid ? 'مفتاح الاتّصال صالح' : 'مفتاح الاتّصال منتهٍ أو مسحوب'}
        why={r.tokenValid
          ? 'ميتا قبلت المفتاح في هذه اللحظة — لا في آخر مرّةٍ حُفظ فيها.'
          : 'الأشيع أنّه مفتاحٌ مؤقّتٌ عمرُه 24 ساعة. راسِلنا لنستبدله بمفتاح «مستخدم نظام» بلا انتهاء.'}
      />
      {r.issues.map((x) => (
        <Chk key={x} sev="warn" k="ملاحظةٌ من ميتا" why={x} />
      ))}
    </div>
  );
}
