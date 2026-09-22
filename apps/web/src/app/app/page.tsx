'use client';

import Link from 'next/link';
import { useApi, fmt } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import {
  PageHead, Grid, Stack, Row, Card, Stat, Meter, Pill, Dot, Note,
  Button, Skeleton, ErrorBox, KV, KVRow,
} from '@/components/ui';

/**
 * رئيسيّة العميل — «نبض اليوم».
 *
 * ★ القرار الذي أُعيد التصميم من أجله: **رقمٌ بطوليٌّ واحد.** كانت الشاشة ستّة
 *   أرقامٍ متساوية الوزن، فلا تقول أيّها يهمّ — وصاحب المطعم يفتحها ثلاثين
 *   ثانيةً وسط الخدمة. فالرقم البطوليّ يجيب سؤاله الأوّل وحده:
 *     «في شيء يحتاجني؟» إن كان هناك، وإلّا «كم أنهى البوت بنفسه؟»
 *   أي أنّ البطوليّ **يتبدّل بالحالة** لا بالتصنيف.
 *
 * ★ والعتبات صارت ظاهرة: 80% تحذير · 95% خطير · 100% حرج. بلا هذا يُفاجأ
 *   العميل بسقفه، وهي أشيع شكوى في هذا النوع من المنتجات.
 */

interface Overview {
  conversationsToday: number;
  botReplies: number;
  windowsUsed: number;
  windowsLimit: number;
  selfResolvedRate: number;
  medianLatencyMs: number;
  needsAttention: number;
  botEnabled: boolean;
  channels: Array<{ kind: string; status: string; displayName: string | null }>;
  overagePolicy: string;
}

interface Gap {
  query: string;
  times: number;
  retrieved: number;
  diagnosis: string;
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp_cloud: 'واتساب', instagram: 'إنستجرام' };

/**
 * أقلّ عدد نوافذ قبل أن نعرض نسبةً **بطوليّة**.
 * الرقم ليس إحصائيّاً دقيقاً بل حدٌّ عمليّ: دونه تقيس النسبة الصدفة، وعرضها
 * ضخمةً يُعطي انطباعاً كاذباً في الاتّجاهين — «0%» يُحبط بلا سبب، و«100%»
 * يُطمئن بلا سبب.
 */
const SAMPLE_MIN = 10;

const OVERAGE: Record<string, string> = {
  handoff_only:
    'البوت توقّف، والرسائل ما زالت تصل وتُوسَم «يحتاج تدخّلاً». فريقك يردّ يدويّاً بلا حدّ — '
    + 'لا زبونٌ يُترك بلا ردّ، ولا فاتورةٌ مفاجئة.',
  block: 'البوت يرسل رسالةً واحدة مهذّبة ثمّ يصمت.',
  bill: 'البوت يستمرّ، والتجاوز يُسجَّل ويُفوتَر.',
};

export default function HomePage() {
  const { me } = useSession();
  const hasTenant = Boolean(me?.tenant);
  const { data, error, loading, reload } = useApi<Overview>(hasTenant ? '/reports/overview' : null);
  const gaps = useApi<Gap[]>(hasTenant ? '/bot/knowledge/gaps' : null);

  // مالك المنصّة يُحوَّل إلى /console من Shell — هذا فقط لتفادي وميضٍ
  if (!hasTenant || loading) return <Skeleton rows={5} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const pct = data.windowsLimit ? data.windowsUsed / data.windowsLimit : 0;
  const atCap = pct >= 1;
  const needs = data.needsAttention > 0;
  /* عتبةُ عيّنةٍ قبل عرض أيّ نسبةٍ بطوليّة. */
  const enoughSample = data.windowsUsed >= SAMPLE_MIN;

  return (
    <Stack gap="lg">
      <PageHead
        title="الرئيسيّة"
        sub="نبض اليوم — والرقم الكبير هو ما يستحقّ انتباهك الآن."
        actions={(
          <Row gap="sm">
            <Dot tone={atCap ? 'crit' : data.botEnabled ? 'ok' : 'neutral'} />
            <span className="muted-p">
              {atCap ? 'البوت متوقّف — السقف' : data.botEnabled ? 'البوت يعمل' : 'البوت مطفأ'}
            </span>
          </Row>
        )}
      />

      {atCap && (
        <Note tone="crit">
          <b>بلغتَ سقف الباقة لهذا الشهر.</b> {OVERAGE[data.overagePolicy] ?? OVERAGE.bill}{' '}
          <Link href="/app/usage">شاهد الاستهلاك</Link>
        </Note>
      )}

      {/* ★ البطوليّ يتبدّل بالحالة — وثلاث قواعدٍ تحكمه:
          ① ما يحتاجك **الآن** يسبق كلّ شيء.
          ② **لا نسبةَ من عيّنةٍ لا تكفي.** «0%» من محادثتين ليست إحصاءً، وهي
             أسوأ انطباعٍ أوّل ممكن — وقد ظهرت فعلاً في أوّل يومٍ حقيقيّ.
             دون العتبة نعرض حجم النشاط لا جودته.
          ③ وعند الهدوء والعيّنة الكافية: النسبة التي تطمئن. */}
      <Grid min={180}>
        {needs ? (
          <Stat hero href="/app/inbox?f=attn" value={fmt.num(data.needsAttention)}
            label="محادثة تحتاج تدخّلك الآن ←" tone="crit" />
        ) : enoughSample ? (
          <Stat hero value={fmt.pct(data.selfResolvedRate)} label="أنهاها البوت بلا موظّف" />
        ) : (
          <Stat
            hero
            value={fmt.num(data.conversationsToday)}
            label={data.conversationsToday ? 'محادثة اليوم — ولا شيء يحتاجك' : 'محادثة اليوم'}
          />
        )}

        <Stat href="/app/inbox" value={fmt.num(data.conversationsToday)} label="محادثة اليوم ←" />

        <Stat value={fmt.num(data.botReplies)} label="ردّ بوت" />
        {/* ★ التسمية «مُفوتَرة» لا «نوافذ الشهر»: الخادم يعدّ المُفوتَرة حصراً،
            و«نوافذ الشهر» تُقرأ بأنّها كلّ ما فُتح — فيظنّ العميل أنّه يُفوتَر
            على رسائل لم يردّ عليها أحد. نقاشُ فاتورةٍ مبنيٌّ في اسم. */}
        <Stat
          href="/app/usage"
          value={fmt.num(data.windowsUsed)}
          unit={`/ ${fmt.num(data.windowsLimit)}`}
          label={`نافذة مُفوتَرة · ${fmt.pct(pct)} ←`}
          meter={{ pct }}
        />
        <Stat value={(data.medianLatencyMs / 1000).toFixed(1)} unit="ث" label="وسيط زمن الردّ" />
        {(needs || enoughSample) && (
          <Stat
            value={fmt.pct(data.selfResolvedRate)}
            label="أنهاها البوت بلا موظّف"
            tone={needs ? 'ok' : undefined}
          />
        )}
      </Grid>

      {!enoughSample && !needs && (
        <p className="muted-p">
          نسبة «ما أنهاه البوت بنفسه» تظهر بعد <b>{SAMPLE_MIN}</b> محادثاتٍ هذا الشهر —
          قبلها تقيس الصدفة لا الأداء.
        </p>
      )}

      {/* العتبات مكتوبةٌ لا مُستنتَجة — فلا يُفاجأ أحدٌ بفاتورة */}
      {!atCap && pct >= 0.8 && (
        <Note tone={pct >= 0.95 ? 'crit' : 'warn'}>
          <b>استهلكتَ {fmt.pct(pct)} من نوافذ الشهر.</b>{' '}
          {pct >= 0.95
            ? 'بقي أقلّ من 5٪. عند بلوغ السقف: '
            : 'عند بلوغ السقف: '}
          {OVERAGE[data.overagePolicy] ?? OVERAGE.bill}
        </Note>
      )}

      <Grid min={320}>
        <Card title="حالة قنواتك">
          <KV>
            <KVRow k="البوت">
              {atCap ? <Pill tone="crit" label="متوقّف — السقف" />
                : data.botEnabled ? <Pill tone="ok" label="يعمل" />
                  : <Pill tone="neutral" label="مطفأ" />}
            </KVRow>
            {data.channels.map((c) => (
              <KVRow key={c.kind} k={CHANNEL_LABEL[c.kind] ?? c.kind}>
                <Row gap="xs">
                  <Dot tone={c.status === 'connected' ? 'ok' : c.status === 'error' ? 'crit' : 'neutral'} />
                  <span>{c.displayName ?? (c.status === 'connected' ? 'موصول' : 'غير موصول')}</span>
                </Row>
              </KVRow>
            ))}
            {!data.channels.length && (
              <KVRow k="القنوات">
                <Link href="/app/channels">لم تربط قناةً بعد — ابدأ من هنا</Link>
              </KVRow>
            )}
          </KV>
        </Card>

        <Card
          title="فرصة تحسين — لا عطل"
          actions={gaps.data?.length ? <Button size="sm" onClick={() => { location.href = '/app/bot?tab=kb'; }}>افتح المعرفة</Button> : undefined}
        >
          {gaps.loading && <Skeleton rows={2} height={18} />}

          {/* ★ فشل النداء كان يُعرض **خبراً سارّاً**: الشرط `!loading && !data?.length`
              يصدق عند الخطأ أيضاً، فتظهر «لا أسئلة عجز عنها بوتك 🌿» بينما
              النداء فشل. طمأنينةٌ كاذبة أسوأ من خطأٍ ظاهر. */}
          {!gaps.loading && gaps.error && <ErrorBox message={gaps.error} onRetry={gaps.reload} />}

          {!gaps.loading && !gaps.error && !gaps.data?.length && (
            <p className="muted-p">لا أسئلة عجز عنها بوتك هذا الشهر. 🌿</p>
          )}

          {!!gaps.data?.length && (
            <Stack gap="sm">
              <p className="muted-p">
                <b>{gaps.data.length}</b> سؤالاً عجز عنها بوتك. أضِفها لمعرفته وسترتفع نسبة ما يحلّه بنفسه.
              </p>
              {gaps.data.slice(0, 3).map((g) => (
                <div key={g.query} className="gap-row">
                  <span>«{g.query}» — سُئل <span className="num">{g.times}</span> مرّات</span>
                  {/* التمييز هو القيمة: «بحث ولم يجد» ≠ «وجد ولم يُجب» */}
                  <Pill tone={g.retrieved === 0 ? 'crit' : 'warn'} label={g.diagnosis} />
                </div>
              ))}
            </Stack>
          )}
        </Card>
      </Grid>

      <Note>
        <b>تمييزٌ يوفّر عليك أسبوعاً.</b> «بحث ولم يجد» يعني أنّ المعلومة ناقصةٌ من معرفتك —
        أضِفها. و«وجد ولم يُجب» يعني أنّها موجودةٌ والمشكلة في شخصيّة البوت — راسلنا.
        بلا هذا التمييز تضيف محتوًى لمشكلةٍ ليست فيه.
      </Note>
    </Stack>
  );
}
