'use client';

import type { ReactNode } from 'react';
import { fmt } from '@/lib/useApi';
import { Stat, isMachineString, type Tone } from '@/components/ui';

/**
 * بنى لوحة المالك المشتركة بين شاشاتها الثلاث.
 *
 * ★ لماذا هنا لا في `ui/index.tsx`: هذه ثلاثُ شاشاتٍ لمالكٍ واحد تتقاسم
 *   بنيةً واحدة (بطوليٌّ بسياقه · صفوفُ معايير · قسمٌ بعنوانٍ يحمل عدده ·
 *   شريطٌ على مقياسٍ مشترك). وطبقةُ المكوّنات ملفٌّ يعمل عليه غيري الآن،
 *   فالقاعدة فيه **أضِف ولا تُعدّل** — وما يخصّ مجموعةَ شاشاتٍ بعينها يسكن
 *   عندها. وكلّ صنفٍ تكتبه هذه المكوّنات معرَّفٌ في `console.css` أو
 *   `components.css`، وإلّا أمسكه حارسُ الصنف الميّت في نفس اللحظة.
 */

/**
 * الرقم البطوليّ **بسياقٍ ملاصق**.
 *
 * ★ رقمٌ بلا خطّ أساسٍ لا يُقرَّر عليه: «2» تعني شيئاً إذا عرفتَ من كم، ومنذ
 *   متى، وإلى أين يتّجه. و`Stat hero` يحمل الرقمَ ووسمَه ولا يحمل سياقاً —
 *   فالسياقُ سطرٌ ملاصقٌ تحته **داخل** الحاوي، والخطُّ الفاصلُ أسفلَ
 *   الاثنين معاً (`console.css`) كي لا يُقرأ السياقُ أوّلَ القسم التالي.
 */
export function Hero({ value, unit, label, ctx, tone, href, meter, goal }: {
  value: string;
  label: string;
  /** خطُّ الأساس: من كم · نسبةٌ من كلّ · مقارنةٌ · إسقاط */
  ctx: ReactNode;
  unit?: string;
  tone?: Tone;
  href?: string;
  meter?: { pct: number; tone?: Tone };
  /** علامةُ هدفٍ على المقياس عند 50٪ — ومعناها مكتوبٌ في `ctx` لا في اللون */
  goal?: boolean;
}) {
  return (
    <div className={goal ? 'cn-hero cn-goal' : 'cn-hero'}>
      <Stat hero value={value} unit={unit} label={label} tone={tone} href={href} meter={meter} />
      <p className="cn-ctx">{ctx}</p>
    </div>
  );
}

/**
 * صفُّ المعيار — بديلُ بطاقات KPI المتساوية.
 *
 * ستُّ بطاقاتٍ متساوية لا تقول أيُّها يهمّ وتدفع كلَّ ما بعدها تحت الطيّة.
 * والصفُّ يعطي نفسَ الأرقام في ثلث الارتفاع، ويكسب عموداً ثالثاً للسياق
 * (فرقٌ · مقياسٌ · شارة) لم يكن للبطاقة مكانٌ له. والتخطيطُ يستجيب لعرض
 * **السلّ** لا النافذة (`@container sect` في `components.css`).
 */
export function MetricRow({ k, note, value, unit, mid, href }: {
  k: string;
  value: string;
  note?: ReactNode;
  unit?: string;
  mid?: ReactNode;
  href?: string;
}) {
  /* نفس عقد العزل الذي تحرسه طبقة المكوّنات: القيمةُ ووحدتُها عازلٌ واحدٌ
     حين تكون الوحدةُ سلسلةَ آلةٍ أيضاً، والوحدةُ العربيّة («د.أ») تبقى
     **خارج** العازل أبداً — وإلّا فُكّ ترتيبُها مع رقمها. */
  const joined = unit !== undefined && isMachineString(value) && isMachineString(unit);
  const body = (
    <>
      <span className="rm-k">
        {k}
        {note ? <span className="rm-note">{note}</span> : null}
      </span>
      <span className="rm-v">
        {joined
          ? <span className="num">{value}<small>{unit}</small></span>
          : (
            <>
              {isMachineString(value) ? <span className="num">{value}</span> : value}
              {unit ? <small>{unit}</small> : null}
            </>
          )}
      </span>
      <span className="rm-c">{mid}</span>
      {/* في RTL يتقدّم السطرُ يساراً، فمؤشّرُ الوِجهة يشير إلى يسار */}
      <span className="rm-go" aria-hidden="true">{href ? '‹' : null}</span>
    </>
  );
  return href
    ? <a className="row-m" href={href}>{body}</a>
    : <div className="row-m">{body}</div>;
}

/** فرقٌ عن خطّ أساس: علامةٌ **ونصٌّ** معاً — فلا اتّجاهَ يحمله اللون وحده. */
export function Delta({ dir, children }: { dir: 'up' | 'dn' | 'flat'; children: ReactNode }) {
  return (
    <span className={`delta ${dir}`}>
      <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'dn' ? '▼' : '—'}</span>
      {children}
    </span>
  );
}

/** قسمٌ بعنوانٍ يحمل عدده: خطٌّ حِبريٌّ تحت العنوان لا لوحٌ حوله. */
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
        {sub ? <span className="sect-c">{sub}</span> : null}
        {actions ? <div className="sect-a">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * مجموعةُ إلحاحٍ برأسٍ لاصقٍ يحمل عددها.
 *
 * ★ **التجميعُ بالإلحاح قبل الزمن.** سيلٌ مرتَّبٌ بآخر ظهورٍ يخلط الحرجَ
 *   بالمعلومة، فتُقرأ مئةُ بطاقةٍ متساوية الوزن. والرأسُ اللاصقُ يمنع العطلَ
 *   المقابل: قائمةٌ طويلةٌ تفقد رأسَها بعد ثلاثة صفوفٍ فيُقرأ «هادئ» على أنّه
 *   «يحتاجك» — والعدُّ قبل التمرير يقول إن كان النزولُ يستحقّ.
 */
export function Group({ title, count, attn, children }: {
  title: string; count: number; attn?: boolean; children: ReactNode;
}) {
  return (
    <div className="ugrp">
      <div className={attn ? 'grp attn' : 'grp'}>
        <span>{title}</span>
        {/* العدّادُ حاويةٌ بلا عازل، والعازلُ مدًى داخلَها — وإلّا دفع
            `margin-inline-start: auto` مع `direction: ltr` الرقمَ إلى
            الطرف الخطأ في RTL. */}
        <span className="grp-c"><span className="num">{fmt.num(count)}</span></span>
      </div>
      <div className="cn-list">{children}</div>
    </div>
  );
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
 * ★ و`goal` علامةُ الحدّ بنفس المقياس: الكلفةُ التي يصير عندها الهامشُ هدفَه.
 *   فما تجاوزها فهامشُه دون الهدف — يُقرأ من الشريط بلا حسابٍ في الرأس.
 */
export function Bar({ value, scale, kind, goal }: {
  value: number; scale: number; kind: 'rev' | 'cst'; goal?: number;
}) {
  const raw = (value / scale) * 100;
  const w = value <= 0 ? 0 : Math.min(100, Math.max(raw, 1.5));
  const g = goal != null && goal > 0 && goal <= scale ? (goal / scale) * 100 : null;
  return (
    <svg className="mg-bar" height="9" aria-hidden="true" focusable="false">
      <rect className="trk" x="0" y="0" width="100%" height="9" rx="2" />
      <rect className={kind} x={`${100 - w}%`} y="0" width={`${w}%`} height="9" rx="2" />
      {g != null && <rect className="mg-goal" x={`${100 - g}%`} y="0" width="2" height="9" />}
    </svg>
  );
}
