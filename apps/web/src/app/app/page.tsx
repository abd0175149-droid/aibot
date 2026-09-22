'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useApi, fmt } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import {
  PageHead, Stack, Row, Pill, Tag, Dot, Note, Meter,
  Skeleton, ErrorBox, type Tone,
} from '@/components/ui';
import { Band, Hero, Section, Rows, MetricRow, Fold, ScreenDock, type Sev } from './_parts';

/**
 * رئيسيّة العميل — «نبض اليوم».
 *
 * ★ القرار الذي أُعيد التصميم من أجله: **رقمٌ بطوليٌّ واحد.** كانت الشاشة ستّة
 *   أرقامٍ متساوية الوزن، فلا تقول أيّها يهمّ — وصاحب المطعم يفتحها ثلاثين
 *   ثانيةً وسط الخدمة. فالرقم البطوليّ يجيب سؤاله الأوّل وحده:
 *     «في شيء يحتاجني؟» إن كان هناك، وإلّا «كم أنهى البوت بنفسه؟»
 *   أي أنّ البطوليّ **يتبدّل بالحالة** لا بالتصنيف.
 *
 * ★ والعطل الذي أُصلح في هذه المرحلة: **البطوليُّ كان يُكرَّر حرفيّاً** في نفس
 *   الشبكة — هو نفسه البطاقة السادسة. فالرقم الذي رُفع ليُقرأ خلاصةً كان
 *   يُقرأ بطاقةً سادسةً تحته، وذاك ينقض سببَ رفعه. والآن البنيةُ تمنعه:
 *   قائمةُ المعايير تُبنى **بعد** اختيار البطوليّ وتُسقط منه ما صار بطوليّاً.
 *
 * ★ والبنية صارت d4: شريطٌ حاكمٌ واحد، ثمّ الرقمُ البطوليُّ وسياقُه، ثمّ
 *   أقسامٌ برؤوسٍ تحمل أعدادَها وصفوفِ معيارٍ لا بطاقاتِ أرقام، ثمّ رصيفٌ
 *   سفليٌّ يحمل فعلَ الشاشة الأوّل في مدى الإبهام.
 *
 * ★ والعتبات ظاهرة: 80% تحذير · 95% خطير · 100% حرج. بلا هذا يُفاجأ
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

/** حالةُ القناة: علامةٌ ونصٌّ — واللونُ ثالثٌ زائد. */
const CH_STATE: Record<string, { label: string; tone: Tone }> = {
  connected: { label: 'تعمل', tone: 'ok' },
  error: { label: 'لا تعمل', tone: 'crit' },
  pending: { label: 'قيد الربط', tone: 'warn' },
  disabled: { label: 'موقوفة', tone: 'neutral' },
};

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
  const perConv = data.conversationsToday
    ? (data.botReplies / data.conversationsToday).toFixed(1)
    : null;

  /* ★ البطوليّ يتبدّل بالحالة — وثلاث قواعدٍ تحكمه:
      ① ما يحتاجك **الآن** يسبق كلّ شيء.
      ② **لا نسبةَ من عيّنةٍ لا تكفي.** «0%» من محادثتين ليست إحصاءً، وهي
         أسوأ انطباعٍ أوّل ممكن — وقد ظهرت فعلاً في أوّل يومٍ حقيقيّ.
         دون العتبة نعرض حجم النشاط لا جودته.
      ③ وعند الهدوء والعيّنة الكافية: النسبة التي تطمئن. */
  const heroKind: 'attn' | 'self' | 'activity' = needs ? 'attn' : enoughSample ? 'self' : 'activity';

  const chans = data.channels;
  const chBad = chans.filter((c) => c.status !== 'connected').length;

  /* ★ شريطٌ حاكمٌ **واحد**: ما يحتاجك الآن يسبق فاتورتك، وفاتورتك تسبق
     الطمأنينة. وما لا يظهر في الشريط لا يُفقد — يظهر ملاحظةً تحته. */
  const band: { sev: Sev; head: ReactNode; sub: ReactNode } = needs
    ? {
      sev: 'bad',
      head: <><span className="num">{fmt.num(data.needsAttention)}</span> محادثةً تنتظر ردَّ إنسان</>,
      sub: 'أوصلها بوتك إلى حدّه وطلب إنساناً. والفعل الأوّل في رصيف الشاشة أسفل.',
    }
    : atCap
      ? {
        sev: 'bad',
        head: 'بلغتَ سقف الباقة لهذا الشهر',
        sub: <>{OVERAGE[data.overagePolicy] ?? OVERAGE.bill}{' '}<Link href="/app/usage">شاهد الاستهلاك</Link></>,
      }
      : pct >= 0.8
        ? {
          sev: pct >= 0.95 ? 'bad' : 'warn',
          head: <>استهلكتَ <span className="num">{fmt.pct(pct)}</span> من نوافذ الشهر</>,
          sub: <>
            {pct >= 0.95 ? 'بقي أقلّ من 5٪. عند بلوغ السقف: ' : 'عند بلوغ السقف: '}
            {OVERAGE[data.overagePolicy] ?? OVERAGE.bill}
          </>,
        }
        : {
          sev: 'good',
          head: 'لا شيء ينتظر ردَّك الآن',
          sub: data.botReplies
            ? <>بوتك يتكفّل — أرسل <span className="num">{fmt.num(data.botReplies)}</span> ردّاً في آخر 24 ساعة.</>
            : 'بوتك يعمل، ولم يصل ما يحتاج ردّاً بعد.',
        };

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

      <Band sev={band.sev} head={band.head} sub={band.sub} />

      {/* ★ العتبات مكتوبةٌ لا مُستنتَجة — فلا يُفاجأ أحدٌ بفاتورة. والملاحظةُ
          تظهر هنا **فقط** حين يكون الشريطُ مشغولاً بما هو أعجل، فلا يُقرأ
          الخبرُ مرّتين ولا يُفقد. */}
      {needs && atCap && (
        <Note tone="crit">
          <b>بلغتَ سقف الباقة لهذا الشهر.</b> {OVERAGE[data.overagePolicy] ?? OVERAGE.bill}{' '}
          <Link href="/app/usage">شاهد الاستهلاك</Link>
        </Note>
      )}
      {needs && !atCap && pct >= 0.8 && (
        <Note tone={pct >= 0.95 ? 'crit' : 'warn'}>
          <b>استهلكتَ {fmt.pct(pct)} من نوافذ الشهر.</b>{' '}
          {pct >= 0.95 ? 'بقي أقلّ من 5٪. عند بلوغ السقف: ' : 'عند بلوغ السقف: '}
          {OVERAGE[data.overagePolicy] ?? OVERAGE.bill}
        </Note>
      )}

      {heroKind === 'attn' && (
        <Hero
          sev="bad"
          href="/app/inbox"
          value={fmt.num(data.needsAttention)}
          label="محادثةً عجز عنها بوتك وتنتظر إنساناً"
          ctx={(
            <>
              من <span className="num">{fmt.num(data.conversationsToday)}</span> محادثةً بدأت في آخر 24 ساعة
              {enoughSample && (
                <> · وأنهى بوتك وحده <span className="num">{fmt.pct(data.selfResolvedRate)}</span> من نوافذ الشهر</>
              )}
            </>
          )}
        />
      )}

      {heroKind === 'self' && (
        <Hero
          value={fmt.pct(data.selfResolvedRate)}
          label="من نوافذ هذا الشهر أنهاها بوتك بلا موظّف"
          ctx={(
            <>
              العيّنة <span className="num">{fmt.num(data.windowsUsed)}</span> نافذةً مُفوترة ·
              ولا محادثةَ تنتظر ردَّك الآن
            </>
          )}
        />
      )}

      {heroKind === 'activity' && (
        <Hero
          href="/app/inbox"
          value={fmt.num(data.conversationsToday)}
          label={data.conversationsToday
            ? 'محادثةً بدأت في آخر 24 ساعة — ولا شيء يحتاجك'
            : 'محادثةً بدأت في آخر 24 ساعة'}
          ctx={(
            <>
              {/* ★ ما كان فقرةً معلَّقةً تحت الشبكة صار سياقَ الرقم نفسه: النسبةُ
                  الغائبة تُشرَح في موضع غيابها لا في سطرٍ يُقرأ بعد أربع بطاقات. */}
              نسبةُ «ما أنهاه بوتك بنفسه» تظهر بعد <span className="num">{SAMPLE_MIN}</span> نوافذَ
              مُفوترةٍ في الشهر — وأنت الآن عند <span className="num">{fmt.num(data.windowsUsed)}</span>.
              {perConv && <> وردَّ بوتك <span className="num">{perConv}</span> مرّةً وسطيّاً في كلّ محادثة.</>}
            </>
          )}
        />
      )}

      <Section title="معايير اليوم" count="كلُّ رقمٍ معه مداه أو نسبته — لا رقمَ عارياً">
        <Rows>
          {heroKind !== 'activity' && (
            <MetricRow
              href="/app/inbox"
              k="محادثاتٌ بدأت اليوم"
              note="آخر 24 ساعة — لا يوم التقويم"
              value={fmt.num(data.conversationsToday)}
              mid={perConv
                ? (
                  <span className="sc-ctx">
                    ردَّ بوتك فيها <span className="num">{fmt.num(data.botReplies)}</span> مرّة ·
                    أي <span className="num">{perConv}</span> لكلّ محادثة
                  </span>
                )
                : <span className="sc-ctx">لم تصل محادثةٌ بعد</span>}
            />
          )}

          {heroKind !== 'self' && (
            <MetricRow
              k="أغلقها بوتك وحده"
              note="نوافذُ هذا الشهر التي لم يكتب فيها موظّف"
              value={enoughSample ? fmt.pct(data.selfResolvedRate) : '—'}
              mid={enoughSample
                ? (
                  <>
                    <span className="sc-mw"><Meter pct={data.selfResolvedRate} tone="ok" /></span>
                    <span className="sc-ctx">
                      العيّنة <span className="num">{fmt.num(data.windowsUsed)}</span> نافذة
                    </span>
                  </>
                )
                : (
                  <span className="sc-ctx">
                    تظهر بعد <span className="num">{SAMPLE_MIN}</span> نوافذَ مُفوترة —
                    وأنت عند <span className="num">{fmt.num(data.windowsUsed)}</span>
                  </span>
                )}
            />
          )}

          {/* ★ التسمية «مُفوتَرة» لا «نوافذ الشهر»: الخادم يعدّ المُفوتَرة حصراً،
              و«نوافذ الشهر» تُقرأ بأنّها كلّ ما فُتح — فيظنّ العميل أنّه يُفوتَر
              على رسائل لم يردّ عليها أحد. نقاشُ فاتورةٍ مبنيٌّ في اسم. */}
          <MetricRow
            href="/app/usage"
            k="نوافذُ مُفوترةٌ هذا الشهر"
            note="النافذةُ تُفوتَر إذا ردَّ فيها بوتك أو موظّفك"
            value={fmt.num(data.windowsUsed)}
            unit={`/ ${fmt.num(data.windowsLimit)}`}
            mid={(
              <>
                <span className="sc-mw"><Meter pct={pct} /></span>
                <span className="sc-ctx"><span className="num">{fmt.pct(pct)}</span> من سقفك</span>
              </>
            )}
          />

          <MetricRow
            k="وسيطُ زمن ردّ بوتك"
            note="من وصول السؤال إلى أوّل حرف"
            value={(data.medianLatencyMs / 1000).toFixed(1)}
            unit="ث"
            mid={<Tag line mark={false} label="وسيطُ سبعة أيّام" />}
          />
        </Rows>
      </Section>

      <Section
        title="قنواتك"
        count={chans.length
          ? (chBad
            ? <><span className="num">{fmt.num(chBad)}</span> من <span className="num">{fmt.num(chans.length)}</span> لا تعمل</>
            : 'كلُّها تستقبل وتردّ')
          : 'لم تربط قناةً بعد'}
      >
        <Rows>
          <MetricRow
            href="/app/bot"
            k="البوت"
            note="هل يردّ تلقائيّاً على ما يصل"
            mid={atCap
              ? <Pill tone="crit" label="متوقّف — السقف" />
              : data.botEnabled ? <Pill tone="ok" label="يعمل" /> : <Pill tone="neutral" label="مطفأ" />}
          />

          {chans.map((c) => {
            const st = CH_STATE[c.status] ?? { label: c.status, tone: 'neutral' as Tone };
            return (
              <MetricRow
                key={c.kind}
                href="/app/channels"
                k={CHANNEL_LABEL[c.kind] ?? c.kind}
                /* ★ اسمُ الحساب يأتي من ميتا وقد يكون عربيّاً (اسمٌ موثَّق) أو
                   رقماً لاتينيّاً — فـ`dir="auto"` لا `.mono`: المونو بلا تغطيةٍ
                   عربيّةٍ إطلاقاً، فيسقط الاسمُ العربيّ فيه لخطٍّ احتياطيٍّ صامت. */
                note={c.displayName ? <span dir="auto">{c.displayName}</span> : undefined}
                mid={<Tag tone={st.tone} label={st.label} />}
              />
            );
          })}

          {!chans.length && (
            <MetricRow
              href="/app/channels"
              k="لم تربط قناةً بعد"
              note="الربط يجري معك على مكالمة — 30 إلى 60 دقيقة أوّل مرّة"
              mid={<Tag line mark={false} label="ابدأ من هنا" />}
            />
          )}
        </Rows>
      </Section>

      <Section
        title="أسئلةٌ عجز عنها بوتك"
        count={gaps.data?.length
          ? <><span className="num">{fmt.num(gaps.data.length)}</span> سؤالاً — أضِفها لمعرفته وترتفع نسبةُ ما يحلّه بنفسه</>
          : 'فرصةُ تحسين — لا عطل'}
        actions={gaps.data?.length
          ? <Link className="btn quiet sm sc-link" href="/app/bot?tab=kb">افتح المعرفة</Link>
          : undefined}
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
          <Rows>
            {gaps.data.slice(0, 3).map((g) => (
              <MetricRow
                key={g.query}
                href="/app/bot?tab=kb"
                k={`«${g.query}»`}
                value={fmt.num(g.times)}
                unit="مرّة"
                /* التمييز هو القيمة: «بحث ولم يجد» ≠ «وجد ولم يُجب» */
                mid={<Tag tone={g.retrieved === 0 ? 'crit' : 'warn'} label={g.diagnosis} />}
              />
            ))}
            {gaps.data.length > 3 && (
              <MetricRow
                href="/app/bot?tab=kb"
                k="وبقيّتها"
                value={fmt.num(gaps.data.length - 3)}
                unit="سؤالاً"
                mid={<span className="sc-ctx">مرتّبةً من الأكثر تكراراً</span>}
              />
            )}
          </Rows>
        )}
      </Section>

      {/* ★ الطيُّ التدريجيّ: هذا شرحٌ يُقرأ مرّةً ويُرجَع إليه، ولا يُتّخذ عليه
          قرارٌ في كلّ فتحة. فيُطوى ولا يُحذف — ونصُّه كما هو. */}
      <Fold summary="لماذا يفرّق بوتك بين «بحث ولم يجد» و«وجد ولم يُجب»">
        <Note>
          <b>تمييزٌ يوفّر عليك أسبوعاً.</b> «بحث ولم يجد» يعني أنّ المعلومة ناقصةٌ من معرفتك —
          أضِفها. و«وجد ولم يُجب» يعني أنّها موجودةٌ والمشكلة في شخصيّة البوت — راسلنا.
          بلا هذا التمييز تضيف محتوًى لمشكلةٍ ليست فيه.
        </Note>
      </Fold>

      {/* ★ الرصيف: فعلُ الشاشة الأوّل في مدى الإبهام — ويتبدّل بالحالة كما
          يتبدّل البطوليّ، فلا زرٌّ أساسٌ يُصرَف على «اطمئنان». */}
      <ScreenDock
        hint={needs
          ? 'يفتح الإنبوكس — والمرشِّح «يحتاج تدخّلاً» أوّلُ حبّةٍ فيه.'
          : 'لا شيء عاجل. والرصيف يحمل فعل الشاشة الأوّل دائماً، حتّى لو كان اطمئناناً.'}
      >
        <Link
          className={needs ? 'btn primary lg wide sc-link' : 'btn quiet lg wide sc-link'}
          href="/app/inbox"
        >
          {needs
            ? <>افتح ما ينتظرك <span className="num">{`(${fmt.num(data.needsAttention)})`}</span></>
            : 'افتح الإنبوكس'}
        </Link>
      </ScreenDock>
    </Stack>
  );
}
