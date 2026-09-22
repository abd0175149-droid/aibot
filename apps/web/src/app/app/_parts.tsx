'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Dock, isMachineString } from '@/components/ui';

/**
 * بنى d4 المشتركة بين الرئيسيّة والقنوات والاستهلاك.
 *
 * ★ لماذا هنا لا في `components/ui`: هذه الثلاث بنًى **وصلت مع هذه الشاشات**،
 *   وطبقةُ المكوّنات ملفٌّ مشتركٌ يعمل فيه وكيلٌ آخر في نفس اللحظة — فإضافةُ
 *   اسمٍ متوقَّعٍ فيه (`Section` · `MetricRow`) احتمالُ تصادمٍ لا احتمالُ فائدة.
 *   وأصنافُها كلُّها معرَّفةٌ سلفاً في `components.css` (`.sect` · `.row-m` ·
 *   `.rows` · `.delta`)، فما هنا **موضعُ استدعاءٍ** لا تصميمٌ جديد. ومتى
 *   استقرّت الشاشاتُ الثمانِ عليها تُرفَع إلى الطبقة المشتركة بلا تغييرٍ في
 *   الشجرة ولا في CSS.
 *
 * وثلاث قواعد تحرسها هذه البنى:
 *  ① **لا معنى باللون وحده**: كلّ شدّةٍ علامةٌ هندسيّةٌ ونصٌّ، واللونُ ثالثٌ زائد.
 *  ② **لا رقمَ بلا سياقٍ ملاصق**: `Hero` لا تُترجم بلا `ctx` — النوعُ يفرضه.
 *  ③ **لا كلمةَ عربيّةٍ داخل عازلٍ اتّجاهيّ**: الوحدةُ العربيّة تبقى خارج
 *     `.num`، وسلسلةُ الآلة تُعزَل معها في عازلٍ واحد.
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
 */
export function Hero({ value, unit, label, ctx, sev = 'plain', href }: {
  value: string; unit?: string; label: ReactNode; ctx: ReactNode; sev?: Sev; href?: string;
}) {
  const cls = `sc-hero${SEV[sev]}`;
  const body = (
    <>
      <span className="sc-hero-v"><NumUnit value={value} unit={unit} /></span>
      <span className="sc-hero-s">
        <span className="sc-hero-k">{label}</span>
        <span className="sc-hero-c">{ctx}</span>
      </span>
    </>
  );
  return href
    ? <Link className={cls} href={href}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/* ══════════════ القسم وصفُّ المعيار ══════════════ */

/**
 * قسمٌ بعنوانٍ يحمل عدَّه — والعددُ قبل القراءة يقول إن كان النزولُ يستحقّ.
 * وهو **حاويةٌ مسمّاة** (`container-name: sect` في طبقة المكوّنات): صفوفُه
 * تفرد أعمدتها حين يتّسع سلُّها لا حين تتّسع النافذة.
 */
export function Section({ title, count, actions, children }: {
  title: string; count?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="sect">
      <div className="sect-h">
        <h2>{title}</h2>
        {count !== undefined && <span className="sect-c">{count}</span>}
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
 *   للسياق (مقياسٌ · فرقٌ · وسمٌ) لم يكن للبطاقة مكانٌ له.
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
  if (href) return <Link className="row-m" href={href}>{body}</Link>;
  if (onClick) return <button type="button" className="row-m" onClick={onClick}>{body}</button>;
  return <div className="row-m">{body}</div>;
}

/* ══════════════ الفرق — علامةٌ ونصٌّ معاً ══════════════ */

/** فرقٌ عن خطِّ أساس. العلامةُ سهمٌ والنصُّ يقول المقدار — واللونُ ثالثٌ زائد. */
export function Delta({ dir, text }: { dir: 'up' | 'dn' | 'flat'; text: string }) {
  return (
    <span className={`delta ${dir}`}>
      <span aria-hidden="true">{dir === 'up' ? '↑' : dir === 'dn' ? '↓' : '−'}</span>
      {text}
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
