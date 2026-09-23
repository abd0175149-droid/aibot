'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Dock, Meter, isMachineString, type Tone } from '@/components/ui';

/**
 * نحوُ الشاشة — بنًى مشتركةٌ بين شاشات المستأجر ولوحة المالك.
 *
 * ★ **لماذا صار هذا ملفّاً واحداً.** كانت هذه البنى معرَّفةً **مرّتين**: في
 *   `app/app/_parts.tsx` وفي `app/console/parts.tsx`، بتوقيعَين مختلفَين لنفس
 *   الأسماء الأربعة (`Hero` · `MetricRow` · `Delta` · `Section`). و`Delta`
 *   كانت تأخذ نصَّها خاصيّةً هنا وأبناءً هناك — أي أنّ من يقرأ استدعاءً لا
 *   يعرف أيَّ مكوّنٍ يقرأ حتّى يفتح سطرَ الاستيراد.
 *
 *   ولم يكن العطلُ قائماً يومَها: ملفّان منفصلان لا يتصادمان. لكنّه **عطلُ
 *   الغد بيقين** — وهو بعينه ما وُلد منه حارسُ الصنف الميّت حين تعايشت
 *   مفردتان للأصناف: إصلاحٌ يُكتب في نسخةٍ ويُنسى في الأخرى، فتتباعد
 *   الشاشتان بلا أن يفشل شيء. ولذلك وُحِّدت هنا، **وحارسٌ** في
 *   `test/design-system.test.ts` يفشل إن صُدِّر اسمُ مكوّنٍ واحدٍ من ملفّين:
 *   فالتكرار لا يُكتشف بالعين مرّتين.
 *
 * ★ **وأصنافُها تبقى حيث هي** (`screens.css` · `components.css`): الصنفُ لا
 *   يهاجر مع المكوّن، والورقتان تُحمّلان معاً من `layout.tsx` — فالنقلُ
 *   تغييرٌ بلا أثرٍ مرئيٍّ وباحتمال تصادمٍ مع من يعمل على `components.css`.
 *
 * وأربع قواعدٍ تحرسها هذه البنى:
 *  ① **لا معنى باللون وحده**: كلّ شدّةٍ علامةٌ هندسيّةٌ ونصٌّ، واللونُ ثالثٌ زائد.
 *  ② **لا رقمَ بلا سياقٍ ملاصق**: `Hero` لا تُترجم بلا `ctx` — النوعُ يفرضه.
 *  ③ **لا كلمةَ عربيّةٍ داخل عازلٍ اتّجاهيّ**: الوحدةُ العربيّة تبقى خارج
 *     `.num`، وسلسلةُ الآلة تُعزَل معها في عازلٍ واحد.
 *  ④ **ولا مفرداتَ ثانيةً لنفس المعنى**: `▲` شدّةٌ في `MARK`، فلا تكون
 *     اتّجاهاً في `Delta` — والاتّجاهُ سهمٌ (`↑ ↓ −`) في الموضعَين.
 */

export type Sev = 'plain' | 'good' | 'warn' | 'bad';

/**
 * العلامةُ شكلٌ لا لون — ونفسُ مفردات `ICON` في طبقة المكوّنات فلا يتعلّم
 * القارئ لغتَين. وهي مصدَّرةٌ لأنّ شاشةً واحدةً (القنوات) تبني صفوفَ فحصٍ
 * خاصّةً بها، ولا يجوز أن تخترع مفرداتٍ ثالثة.
 */
export const MARK: Record<Sev, string> = { plain: '○', good: '●', warn: '▲', bad: '■' };
export const SEV: Record<Sev, string> = { plain: '', good: ' sc-good', warn: ' sc-warn', bad: ' sc-bad' };

/**
 * ★ القرارُ الاتّجاهيُّ **محسوبٌ** لا مكتوبٌ باليد، وهو نفسُ حساب `Stat`:
 *   ما لا حرفَ عربيٍّ فيه وفيه رقمٌ يُعزَل؛ وما سواه يُترك لاتّجاه الصفحة.
 *   والقيمةُ ووحدتُها **عازلٌ واحد** حين تكون الوحدةُ سلسلةَ آلةٍ أيضاً
 *   («/ 1,500»)، فهما طرفا تعبيرٍ واحدٍ وفصلُ العازلَين يعيد القلبَ الذي
 *   أُريد منعُه. والوحدةُ العربيّة («ث» · «مرّة») تبقى خارجه أبداً.
 */
function NumUnit({ value, unit }: { value: string; unit?: string }) {
  if (unit !== undefined && isMachineString(value) && isMachineString(unit)) {
    return <span className="num">{value}<small>{unit}</small></span>;
  }
  return (
    <>
      {isMachineString(value) ? <span className="num">{value}</span> : value}
      {/* الفراغُ بين الرقم ووحدته من النمط (`margin-inline-start`) لا من مسافةٍ
          في النصّ: المسافةُ الأولى تنطوي بقواعد HTML متى تغيّر ما قبلها. */}
      {unit !== undefined && <small>{unit}</small>}
    </>
  );
}

/**
 * رابطٌ حقيقيٌّ في الشجرة — و`Link` لِما يغيّر الصفحة، و`a` للقفزة داخلها.
 *
 * ★ لوحةُ المالك تربط إلى مرساةٍ في نفس الصفحة (`#tbl`) وشاشاتُ المستأجر
 *   تربط إلى مسار. فلمّا وُحِّد المكوّنان صار التفريعُ على **شكل الوِجهة** لا
 *   على من يستدعي: فلا يأخذ موجِّهُ Next قفزةً داخليّةً تنقُّلاً، ولا يخسر
 *   تنقُّلٌ حقيقيٌّ جلبَه المسبق.
 */
function Anchor({ className, href, children }: {
  className: string; href: string; children: ReactNode;
}) {
  if (href.startsWith('#')) return <a className={className} href={href}>{children}</a>;
  return <Link className={className} href={href}>{children}</Link>;
}

/* ══════════════ الشريط الحاكم ══════════════ */

/**
 * شريطٌ واحدٌ لكلّ شاشة يُجيب «في شيء يحتاجني؟» قبل أن تُقرأ كلمة.
 * و`head` حكمٌ لا عنوان، و`sub` عاقبةٌ أو خطُّ أساسٍ لا تكرارٌ للحكم.
 */
export function Band({ sev = 'plain', head, sub }: {
  sev?: Sev; head: ReactNode; sub?: ReactNode;
}) {
  return (
    <div className={`sc-band${SEV[sev]}`}>
      <span aria-hidden="true" className="sc-band-m">{MARK[sev]}</span>
      <div className="sc-band-t">
        <span className="sc-band-h">{head}</span>
        {sub && <span className="sc-band-s">{sub}</span>}
      </div>
    </div>
  );
}

/* ══════════════ الرقم البطوليّ ══════════════ */

/**
 * رقمٌ بطوليٌّ **واحدٌ** لكلّ شاشة — يُختار بالحالة لا بالتفضيل.
 *
 * و`ctx` **إلزاميّة**: رقمٌ بلا خطِّ أساسٍ أو نسبةٍ من كلٍّ أو إسقاطٍ يُقرأ
 * خبراً لا حكماً، فلا يُتّخذ عليه قرار. والنوعُ يفرض ما لا تفرضه المراجعة.
 *
 * ★ **وشدّةٌ واحدةٌ للبطوليّ في المنتج كلِّه.** كانت لوحةُ المالك تمرّر
 *   `tone: Tone` (ثماني قيمٍ، منها ما ليس حالةً أصلاً: `cool` · `violet`)
 *   وشاشاتُ المستأجر تمرّر `sev: Sev` (أربع). فكان «الحرج» يُكتب `crit`
 *   هنا و`bad` هناك، ولا يُعرف من التوقيع أيُّهما يُقبَل. ومقياسُ الشدّة
 *   **مقياسٌ واحدٌ** في هذا النظام (`MARK` · `SEV` · العتبات)، فلا يصحّ أن
 *   يكون للبطوليّ مقياسٌ خامسٌ خاصٌّ به.
 *
 * ★ و`meter` و`goal` صعدا من لوحة المالك: مقياسٌ تحت الوسم، وعلامةُ حدٍّ
 *   عليه عند 50٪ — ومعناها مكتوبٌ في `ctx` بالنصّ لا محمولٌ في العلامة
 *   وحدها، فمن لا يراها يقرأ الحدّ.
 */
export function Hero({ value, unit, label, ctx, sev = 'plain', href, meter, goal }: {
  value: string;
  unit?: string;
  label: ReactNode;
  /** خطُّ الأساس: من كم · نسبةٌ من كلّ · مقارنةٌ · إسقاط */
  ctx: ReactNode;
  sev?: Sev;
  href?: string;
  meter?: { pct: number; tone?: Tone };
  /** علامةُ هدفٍ على المقياس عند 50٪ — ومعناها مكتوبٌ في `ctx` لا في العلامة */
  goal?: boolean;
}) {
  const cls = `sc-hero${SEV[sev]}${goal ? ' sc-goal' : ''}`;
  const body = (
    <>
      <span className="sc-hero-v"><NumUnit value={value} unit={unit} /></span>
      <span className="sc-hero-s">
        <span className="sc-hero-k">{label}</span>
        {meter && <Meter pct={meter.pct} tone={meter.tone} />}
        <span className="sc-hero-c">{ctx}</span>
      </span>
    </>
  );
  return href
    ? <Anchor className={cls} href={href}>{body}</Anchor>
    : <div className={cls}>{body}</div>;
}

/* ══════════════ القسم وصفُّ المعيار ══════════════ */

/**
 * قسمٌ بعنوانٍ يحمل عدَّه — والعددُ قبل القراءة يقول إن كان النزولُ يستحقّ.
 * وهو **حاويةٌ مسمّاة** (`container-name: sect` في طبقة المكوّنات): صفوفُه
 * تفرد أعمدتها حين يتّسع سلُّها لا حين تتّسع النافذة.
 *
 * و`sub` اسمُ السطر الثاني في التوقيع الموحَّد — كان `count` في نسخةٍ و`sub`
 * في الأخرى، وهو السطرُ نفسُه يحمل عدّاً أو تعريفاً: فالاسمُ يصف **الموضعَ**
 * لا أحدَ ما يوضع فيه.
 */
export function Section({ title, sub, actions, children, id, anchor }: {
  title: string;
  children: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  id?: string;
  /** هدفُ قفزةٍ في الصفحة — يحمل هامشَ تمريرٍ فلا يغطّيه الرأسُ اللاصق */
  anchor?: boolean;
}) {
  return (
    <section className={anchor ? 'sect cn-anchor' : 'sect'} id={id}>
      <div className="sect-h">
        <h2>{title}</h2>
        {sub !== undefined && <span className="sect-c">{sub}</span>}
        {actions && <div className="sect-a">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="rows">{children}</div>;
}

/**
 * صفُّ المعيار — بديلُ بطاقات KPI.
 *
 * ★ ستُّ بطاقاتِ رقمٍ متساوية لا تقول أيُّها يهمّ، وتدفع كلَّ ما بعدها تحت
 *   الطيّة. والصفُّ يعطي نفسَ الأرقام في ثلث الارتفاع، ويكسب عموداً ثالثاً
 *   للسياق (مقياسٌ · فرقٌ · وسمٌ) لم يكن للبطاقة مكانٌ له. والتخطيطُ يستجيب
 *   لعرض **السلّ** لا النافذة (`@container sect` في `components.css`).
 *
 * و`href` يجعله رابطاً حقيقيّاً في الشجرة — لا `div` بمعالج: أكثرُ الصفوف
 * تفتح شاشةً أخرى، والمؤشّرُ في عموده الثالث هو ما يفرّق المضغوطَ من المقروء.
 */
export function MetricRow({ k, note, value, unit, mid, href, onClick }: {
  k: ReactNode;
  /** تعريفُ المعيار أو مداه — سطرٌ تحت اسمه يعود إلى جانبه حين يتّسع السلّ */
  note?: ReactNode;
  value?: string;
  unit?: string;
  /** عمودُ السياق: مقياسٌ أو فرقٌ أو وسمُ حالة */
  mid?: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const goes = Boolean(href || onClick);
  const body = (
    <>
      <span className="rm-k">
        {k}
        {note !== undefined && <span className="rm-note">{note}</span>}
      </span>
      {value !== undefined && (
        <span className="rm-v"><NumUnit value={value} unit={unit} /></span>
      )}
      <span className="rm-c">{mid}</span>
      {/* السهم علامةُ وِجهةٍ لا زينة — وفي RTL «إلى الأمام» يسار */}
      <span className="rm-go" aria-hidden="true">{goes ? '←' : ''}</span>
    </>
  );
  if (href) return <Anchor className="row-m" href={href}>{body}</Anchor>;
  if (onClick) return <button type="button" className="row-m" onClick={onClick}>{body}</button>;
  return <div className="row-m">{body}</div>;
}

/* ══════════════ الفرق — علامةٌ ونصٌّ معاً ══════════════ */

/**
 * فرقٌ عن خطِّ أساس. العلامةُ سهمٌ والنصُّ يقول المقدار — واللونُ ثالثٌ زائد.
 *
 * ★ والسهمُ لا المثلّث: `▲` تعني «تحذير» في `MARK`، فلو حملت أيضاً «ارتفاعاً»
 *   صار للشكل الواحد معنيان في الشاشة الواحدة — وذاك يُنفق ترميزاً مزدوجاً
 *   ليشتريَ به ارتباكاً. (والنسخةُ الثانية كانت تستعمل `▲ ▼ —` فعلاً، وهي
 *   إحدى مواضع التباعد التي وُحِّدت هنا.)
 */
export function Delta({ dir, children }: { dir: 'up' | 'dn' | 'flat'; children: ReactNode }) {
  return (
    <span className={`delta ${dir}`}>
      <span aria-hidden="true">{dir === 'up' ? '↑' : dir === 'dn' ? '↓' : '−'}</span>
      {children}
    </span>
  );
}

/* ══════════════ الصفُّ الحيويّ ══════════════ */

/**
 * صفٌّ **يُتّخذ عليه قرار** — بوزنٍ أثقل من صفّ المعيار وبنصِّ عاقبةٍ تحته.
 * و`why` تقول **ماذا يحدث لو انكسر** لا أنّه سليم: «أخضر» حالة، و«لو صار
 * أصفر أوقف أيّ إرسالٍ جماعيّ» قرار.
 */
export function Vital({ sev = 'plain', k, why }: { sev?: Sev; k: string; why: ReactNode }) {
  return (
    <div className={`sc-vital${SEV[sev]}`}>
      <span aria-hidden="true" className="sc-vital-m">{MARK[sev]}</span>
      <span className="sc-vital-k">{k}</span>
      <span className="sc-vital-s">{why}</span>
    </div>
  );
}

/* ══════════════ الطيُّ التدريجيّ ══════════════ */

/** ما لا يُتّخذ عليه قرارٌ يُطوى ولا يُحذف — والمطويُّ يُفتح، والمحذوفُ يُسأل عنه. */
export function Fold({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="sc-fold">
      <summary>
        <span aria-hidden="true" className="sc-fold-m">▾</span>
        {summary}
      </summary>
      <div className="sc-fold-b">{children}</div>
    </details>
  );
}

/* ══════════════ الرصيف اللاصق ══════════════ */

/**
 * رصيفُ الشاشة. `Dock` من طبقة المكوّنات يرسم الشريطَ وذيلَ شرحه، وهذا
 * الغلافُ **يُلصقه** بأسفل المُمرِّر (`position: sticky`) — فيبقى في مدى
 * الإبهام بلا `position: fixed` وبلا حشوٍ سفليٍّ وهميٍّ يُنسى فيغطّي آخرَ صفّ.
 *
 * وشرطُ عمله أنّه **آخرُ ابنٍ** في عمود الشاشة: فهو يلصق ما دام حاويه مرئيّاً،
 * ويستقرّ في مكانه الحقيقيّ عند آخر الصفحة.
 */
export function ScreenDock({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className="sc-dock">
      <Dock hint={hint}>{children}</Dock>
    </div>
  );
}

/* ══════════════ صفُّ المرشّحات — والحافّةُ تقول إنّ خلفها مزيداً ══════════════ */

/**
 * صفُّ رقاقاتِ ترشيحٍ يُمرَّر أفقيّاً في الرصيف.
 *
 * ★ **العطل**: الصفُّ يُمرَّر بـ`scrollbar-width: none` (والالتفافُ ممنوعٌ لأنّه
 *   يغيّر ارتفاعَ الرصيف فيقفز ما فوقه عند كلّ ضغطة) — فلا شريطَ تمريرٍ ولا
 *   تلاشٍ ولا أيُّ دليل. أي أنّ مرشّحاً خلف الحافّة **غيرُ موجودٍ بصريّاً**:
 *   لا يُعرف أنّه هناك فلا يُبحث عنه. والتلاشي المتدرّجُ يقول «خلفي مزيد»
 *   بلا أن يأخذ صفّاً ولا أن يُحرّك الرصيف.
 *
 * ★ **ولماذا JS هنا.** CSS لا تعرف «هل في هذا المُمرِّر ما يُمرَّر» بلا خطِّ
 *   زمنِ تمريرٍ (مدعومٌ في محرّكٍ واحد)، وحيلةُ `background-attachment: local`
 *   الخالصة تُخفي التلاشيَ **تحت** الرقاقات لأنّ لكلٍّ منها سطحاً معتماً.
 *   والقياسُ هنا **قياسُ عنصرٍ لا تفريعٌ على عرض الشاشة**: لا `matchMedia`
 *   ولا قراءةُ نافذةٍ ولا علمُ جهاز — وهو يصحّ في نافذةٍ نصفيّةٍ وداخل حاوٍ
 *   ضيّقٍ وعند تكبير الخطّ إلى 200٪، وهي الحالاتُ التي يكذب فيها سؤالُ النافذة.
 *
 * ★ والمسافةُ **مطلقة**: في RTL يعدّ المتصفّح `scrollLeft` من صفرٍ إلى سالبِ
 *   المدى، وفي LTR من صفرٍ إلى موجبه — فالقيمةُ المطلقة هي «كم بُعدُنا عن
 *   البداية» في الاتّجاهَين بلا سؤالٍ عن الاتّجاه.
 */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState('');

  const read = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const span = el.scrollWidth - el.clientWidth;
    const from = Math.abs(el.scrollLeft);
    /* عتبةُ بكسلٍ واحد: تقريبُ المتصفّح العشريُّ لعرض العنصر يُنتج فرقاً
       كسريّاً دائماً، فبلا عتبةٍ يبقى التلاشي مضاءً على صفٍّ لا يُمرَّر. */
    const at = [from > 1 ? 's' : '', span > 1 && from < span - 1 ? 'e' : ''];
    setEdge(at.filter(Boolean).join(' '));
  }, []);

  /* كلُّ رسمٍ يُعيد القياس: عددُ الرقاقات ونصُّها يتغيّران بالحالة (عدّادٌ داخل
     رقاقة)، وذاك لا يغيّر مقاسَ الحاوي فلا يُنبّه `ResizeObserver`. وإعادةُ
     نفس القيمة لا تُعيد الرسم — React يتوقّف عندها. */
  useEffect(() => { read(); });

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    el.addEventListener('scroll', read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', read); ro.disconnect(); };
  }, [read]);

  return (
    <div className="sc-chips-w" data-edge={edge}>
      <div className="sc-chips" role="group" aria-label={label} ref={box}>
        {children}
      </div>
    </div>
  );
}
