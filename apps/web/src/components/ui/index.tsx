'use client';

import { useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';

/**
 * طبقة المكوّنات.
 *
 * ★ لماذا وُجدت: كان في الواجهة **١٠١ `style={{`** داخل JSX مقابل ٣٨ صنفاً في
 *   CSS — أي أنّ نظام التصميم موجودٌ ويُتجاوَز، فلا يمكن تغيير مسافةٍ أو حافةٍ
 *   في مكانٍ واحد. والمكوّن المشترك الوحيد كان `Shell`، فكلّ بطاقةٍ وجدولٍ
 *   وحالةٍ فارغة تُعاد كتابتها ويتباعد سلوكها شاشةً عن شاشة.
 *
 * والقاعدة التي تحرسها هذه الطبقة: **صفر `style={{` في ملفٍّ جديد.**
 *
 * وثلاث حالاتٍ إلزاميّة لكلّ عنصر بيانات — مفروضةً بالنوع لا بالنيّة:
 * `DataView` لا تُترجم بلا `empty`، فالشاشة الفارغة بلا إرشادٍ مستحيلةٌ بنيويّاً.
 */

/* ══════════════ الأساسات ══════════════ */

export function Card({ title, actions, children, span }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode;
  /** يمتدّ على كلّ الأعمدة في شبكةٍ — بدل style={{gridColumn}} */
  span?: boolean;
}) {
  return (
    <section className={`card${span ? ' span' : ''}`}>
      {(title || actions) && (
        <header className="card-h">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-a">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** شبكةٌ متجاوبة — `min` يقرّر متى تنكسر إلى عمود. */
export function Grid({ min = 280, children }: { min?: 180 | 220 | 280 | 320 | 400; children: ReactNode }) {
  return <div className={`grid g${min}`}>{children}</div>;
}

export function Row({ children, gap = 'sm', wrap = true, end }: {
  children: ReactNode; gap?: 'xs' | 'sm' | 'md'; wrap?: boolean; end?: boolean;
}) {
  return <div className={`row ${gap}${wrap ? ' wrap' : ''}${end ? ' end' : ''}`}>{children}</div>;
}

export function Stack({ children, gap = 'md' }: { children: ReactNode; gap?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return <div className={`stack ${gap}`}>{children}</div>;
}

/* ══════════════ الحالة ══════════════ */

export type Tone = 'ok' | 'warn' | 'serious' | 'crit' | 'cool' | 'brand' | 'violet' | 'neutral';

const ICON: Record<Tone, string> = {
  ok: '●', warn: '▲', serious: '▲', crit: '■', cool: '◆',
  brand: '●', violet: '●', neutral: '○',
};

/* ══════════════ العازل الاتّجاهيّ — قرارٌ محسوبٌ لا صنفٌ يُكتب باليد ══════════════ */

/**
 * ★ **لا كلمةَ عربيّةٍ داخل عازلٍ اتّجاهيّ أبداً** — وهذا ما يجعل القرار
 * حساباً لا اختياراً. فالمشكلتان متقابلتان وكلتاهما تقع فعلاً:
 *
 *  ① **بلا عزلٍ ينقلب الرقم.** «12 / 1,500» في فقرةٍ أساسُها RTL: الشرطة
 *    محيّدةٌ بين رقمَين، والرقم يعمل عملَ R في UAX#9، فترتفع الشرطةُ
 *    إلى R ويُقلب الرقمان إلى «1,500 / 12». وهذا رقمُ الفاتورة.
 *  ② **ومع عزلٍ خاطئٍ تختفي العربيّة.** وضعُ `.num` على مدىً فيه «د.أ»
 *    يرمي محايداتِ الطرف إلى الطرف الآخر، ويفكّك ترتيبَ الوحدة مع رقمها.
 *
 * فالمكوّن يقرّر: ما لا حرفَ عربيٍّ فيه **وفيه رقمٌ أو لاتينيّ** يُعزَل؛
 * وما سواه يُترك لاتّجاه الصفحة. ولأنّ `.num` يحمل `direction: ltr`
 * صراحةً، فالمحايد في أوّله («/» في «/ 1,500») يأخذ اتّجاهَ العازل ويبقى
 * في موضعه — ولا يُرمى كما يُرمى داخل عازلٍ بلا اتّجاهٍ مفروض.
 *
 * والمدَيانِ العربيُّ واللاتينيُّ المتجاوران يبقيان منفصلَين في الشجرة،
 * فلا يلزم أن يختار أحدُهما اتّجاهَ الآخر.
 */
const ARABIC_RE = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
const LATIN_CORE_RE = /[0-9A-Za-z]/;

export function isMachineString(s: string): boolean {
  return !ARABIC_RE.test(s) && LATIN_CORE_RE.test(s);
}

/**
 * يعزل ما يستحقّ العزل وحده — ويترك العربيّة حيث هي.
 *
 * ★ ومُصدَّرةٌ لأنّ القرار نفسَه يلزم خارجَ هذا الملفّ: قيمةٌ تأتي من ميتا
 *   (اسمُ عرضٍ قد يكون رقماً لاتينيّاً أو اسماً عربيّاً) تُعرض في `KVRow`،
 *   وبلا عزلٍ ينقلب «+962 7 9000 0000» إلى «0000 9000 7 962+» في صفحةٍ RTL.
 *   ونسخُ الحساب في موضعٍ ثانٍ هو بعينه التكرارُ الذي يتباعد غداً.
 */
export function Iso({ text }: { text: string }) {
  return isMachineString(text) ? <span className="num">{text}</span> : <>{text}</>;
}

/**
 * ★ **لا معنى باللون وحده أبداً.** كلّ شارةٍ تحمل علامةً ونصّاً معها، لأنّ نحو
 *   ٨٪ من الرجال لا يفرّقون الأحمر من الأخضر — وهم من عملائك. ولذلك `label`
 *   إلزاميّة ولا يوجد شكلٌ بلا نصّ.
 */
export function Pill({ tone = 'neutral', label, mark = true }: {
  tone?: Tone; label: string; mark?: boolean;
}) {
  return (
    <span className={`pill ${tone}`}>
      {mark && <span aria-hidden="true" className="pill-m">{ICON[tone]}</span>}
      {/* ★ «2025-09» كان يُقرأ «09-2025»: شرطةٌ محيّدةٌ بين رقمَين ترتفع
          إلى RTL فيُقلب الطرفان. وقد أُنشئ لهذا صنفان خاصّان في
          شاشتَين (`.mg-period` و`.tn-period`) لأنّ `Pill` لا يوفّر العزل.
          وهو يوفّره الآن محسوباً: الوسمُ العربيّ يُترك، وسلسلةُ
          الآلة تُعزَل — والعلامةُ تبقى خارج العازل فلا تُرمى. */}
      <Iso text={label} />
    </span>
  );
}

/** نقطةٌ لا تقف وحدها — تُرافق نصّاً دائماً، فالشكل وحده ليس معنى. */
export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  return <span className={`dot ${tone}`} aria-hidden="true" />;
}

/* ══════════════ الأرقام ══════════════ */

/**
 * رقمٌ في بطاقة. `hero` واحدٌ في الشاشة على الأكثر — والستّة المتساوية
 * لا تقول أيّها يهمّ.
 */
export function Stat({ value, label, unit, tone, hero, meter, href }: {
  value: string | number; label: string; unit?: string; tone?: Tone; hero?: boolean;
  meter?: { pct: number; tone?: Tone };
  /**
   * ★ وجهة الرقم. كان `Stat` لا يقبل رابطاً ولا معالجاً، فلم تكن **بطاقةٌ
   *   واحدة في المنتج كلّه** تؤدّي إلى تفصيلها: «محادثة تحتاج تدخّلك» نصٌّ
   *   لا رابط، والنوافذ لا تفتح الاستهلاك، والفجوات لا تفتح المعرفة.
   *   كلّ لوحةٍ كانت تُشخّص ولا تُوصِل — ترى المشكلة ولا تصل إليها.
   */
  href?: string;
}) {
  const cls = `stat${hero ? ' hero' : ''}${tone ? ` t-${tone}` : ''}${href ? ' link' : ''}`;
  const v = String(value);
  /* ★ القيمةُ ووحدتُها **عازلٌ واحد** حين تكون الوحدةُ سلسلةَ آلةٍ
     أيضاً («/ 1,500» · «M»): فهما طرفا تعبيرٍ رقميٍّ واحد، وفصلُ العازلين
     يعيد القلبَ الذي أُريد منعُه (12 واحد، و«/ 1,500» آخر، فيتبادلان).
     أمّا الوحدةُ العربيّة («ث» · «د.أ») فتبقى **خارج** العازل ولا تدخله
     أبداً — فهي تُقرأ باتّجاه الصفحة: رقمٌ ثمّ وحدتُه عن يساره. */
  const joined = unit !== undefined && isMachineString(v) && isMachineString(unit);
  const body = (
    <>
      <span className="stat-v">
        {joined
          ? <span className="num">{v}<small>{unit}</small></span>
          : <><Iso text={v} />{unit && <small>{unit}</small>}</>}
      </span>
      <span className="stat-k">{label}</span>
      {meter && <Meter pct={meter.pct} tone={meter.tone} />}
    </>
  );
  // رابطٌ حقيقيّ لا div بمعالج: يُفتح في تبويبٍ جديد، ويُقرأ رابطاً للقارئ الصوتيّ
  return href ? <a className={cls} href={href}>{body}</a> : <div className={cls}>{body}</div>;
}

/** عتباتٌ ظاهرة: ٨٠٪ تحذير و٩٥٪ خطير و١٠٠٪ حرج — فلا يُفاجأ أحدٌ بسقف. */
export function Meter({ pct, tone }: { pct: number; tone?: Tone }) {
  /* ★ لا حصرَ للمدخل عند 1 قبل قراءته: كان `Math.min(1, pct)` يمحو
     التجاوز من الحساب نفسه، فيستوي من بلغ السقفَ بمن تجاوزه ثمانين
     ضعفاً — والفرق بينهما فاتورة. */
  const p = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  const auto: Tone = p >= 1 ? 'crit' : p >= 0.95 ? 'serious' : p >= 0.8 ? 'warn' : 'brand';
  /* ★ `tone` يصبغ السلّم ولا **يُطفئ إنذاراً**. وكان يُلغي العتباتِ
     المدمجة بلا شرط: شاشةُ البوت تمرّر `tone: 'brand'` على نسبةٍ قد
     تتجاوز المائة، فكان التجاوز يُرسم حِبراً هادئاً.
     والحدُّ موضوعٌ عند **تجاوز السقف وحده** لا عند كلّ عتبة، لأنّ
     للمقياس دلالتَين في المنتج: استهلاكٌ يُخشى ارتفاعُه، ومنسوبٌ
     يُراد ارتفاعُه (قوّةُ كلمة السرّ عند 100٪ «قويّة» لا «حرجة»).
     فما دون السقف يبقى للمستدعي، وفوقه لا يبقى لأحد. */
  const over = p > 1;
  const t = over ? 'crit' : (tone ?? auto);
  /* ★ أرضيّةٌ مرئيّة: استهلاكٌ ضئيل (2 من 1500 = 0.13%) يُرسم شريطاً فارغاً
     يُقرأ **معطوباً** لا منخفضاً. فأيّ استهلاكٍ > 0 يُظهر أثراً، والصفر وحده
     يبقى فارغاً — فالفرق بين «لم تبدأ» و«بدأت بالكاد» معلومةٌ لا زينة. */
  const drawn = Math.min(p, 1);
  const width = drawn === 0 ? 0 : Math.max(drawn * 100, 2.5);
  const real = Math.round(p * 100);
  return (
    <span
      className={`meter ${t}${over ? ' over' : ''}`}
      role="meter"
      aria-valuenow={Math.min(real, 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      /* ★ النّسبةُ الحقيقيّة تُنطَق ولو جاوزت المائة: `aria-valuenow`
         محصورٌ بالمدى المعلَن، فلو وقف الأمرُ عليه سمع قارئُ
         الشّاشة «100» عند 8000 وعند 80000 سواءً. */
      aria-valuetext={`${real}%`}
    >
      {/* style-ok: العرض نسبةٌ محسوبة — لا يُمثَّل بصنفٍ ثابت */}
      <i style={{ width: `${width}%` } as CSSProperties} />
    </span>
  );
}

export function KV({ children }: { children: ReactNode }) {
  return <dl className="kv">{children}</dl>;
}
export function KVRow({ k, children }: { k: ReactNode; children: ReactNode }) {
  // `display: contents` يُبقي الصفّ في شبكة الأمّ بلا حاوٍ يكسرها
  return <div className="kv-r"><dt>{k}</dt><dd>{children}</dd></div>;
}

/* ══════════════ الحالات الثلاث ══════════════ */

export function Skeleton({ rows = 3, height }: { rows?: number; height?: number }) {
  return (
    <div className="stack sm" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skel" style={height ? ({ height } as CSSProperties) : undefined} />
      ))}
    </div>
  );
}

/** لا شاشة فارغة بلا إرشاد: `title` و`hint` إلزاميّان، و`action` مرجَّح. */
export function Empty({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      <p>{hint}</p>
      {action && <div className="empty-a">{action}</div>}
    </div>
  );
}

/** الأخطاء بلغةٍ بشريّة — ومعها دائماً طريقٌ للأمام، لا اعتذارٌ فقط. */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="errbox" role="alert">
      <b>تعذّر تحميل هذا الجزء.</b>
      <p>{message}</p>
      {onRetry && <Button onClick={onRetry} size="sm">أعِد المحاولة</Button>}
    </div>
  );
}

/**
 * ★ الحالات الثلاث مفروضةً بالنوع: لا يمكن ترجمة هذا المكوّن بلا `empty`.
 *   فالشاشة الفارغة بلا إرشادٍ صارت مستحيلةً بنيويّاً لا مرجوّةً بالانتباه.
 */
export function DataView<T>({ state, empty, children, skeletonRows }: {
  state: { data: T | null; loading: boolean; error: string | null; reload?: () => void };
  empty: { when: (d: T) => boolean; title: string; hint: string; action?: ReactNode };
  children: (data: T) => ReactNode;
  skeletonRows?: number;
}) {
  if (state.loading) return <Skeleton rows={skeletonRows ?? 3} />;
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data) return null;
  if (empty.when(state.data)) {
    return <Empty title={empty.title} hint={empty.hint} action={empty.action} />;
  }
  return <>{children(state.data)}</>;
}

/* ══════════════ الأفعال ══════════════ */

/**
 * `reason` ليس تجميلاً: زرٌّ معطَّلٌ بلا سببٍ مكتوب يجعل المستخدم يستنتج أنّ
 * النظام معطوب لا أنّ الفعل غير متاح له الآن. وكان في الواجهة سبعة أزرارٍ
 * بلا معالجٍ إطلاقاً — تبدو صالحةً ولا تفعل شيئاً، وذاك أسوأ من غيابها.
 */
let reasonSeq = 0;

export function Button({ children, onClick, variant = 'quiet', size = 'md', disabled, reason, type = 'button', busy, wide }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'quiet' | 'danger';
  /** `lg` للفعل الواحد في رصيفٍ — إضافةٌ لا تمسّ موضعَ استدعاءٍ قائماً. */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** سببُ التعطيل — يُرسَم على الشاشة، لا في `title`. */
  reason?: string;
  type?: 'button' | 'submit';
  busy?: boolean;
  /**
   * يمتدّ على عرض حاويه — للفعل الأساس في رصيفٍ سفليّ، فلا يبحث
   * الإبهامُ عن هدفٍ في وسط الشاشة. ويرتدّ إلى عرضِ محتواه على
   * الحاسوب حيث يدور الرّصيفُ شريطاً أفقيّاً.
   */
  wide?: boolean;
}) {
  const showReason = Boolean(disabled && reason && !busy);
  /* معرّفٌ مستقرّ عبر إعادة الرسم — التسلسل يزيد مرّةً لكلّ نسخةٍ لا لكلّ رسم */
  const [rid] = useState(() => `btn-r-${(reasonSeq += 1)}`);

  const btn = (
    <button
      type={type}
      className={`btn ${variant} ${size}${wide ? ' wide' : ''}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-describedby={showReason ? rid : undefined}
      aria-busy={busy || undefined}
    >
      {busy ? '…' : children}
    </button>
  );

  if (!showReason) return btn;

  /* ★ كان السبب يذهب إلى `title` وحده — و**لا مرورَ على الهاتف**، وهو الجهاز
     المُعلَن أوّلاً في هذا المنتج. فستّة أزرارٍ معطَّلةٍ صامتة في شاشة القنوات
     (وهي بالضبط شاشة «اضبطه بنفسك») تُقرأ «المنتج معطوب»، فيتّصل العميل.
     أيّ نصٍّ إرشاديٍّ محبوسٍ في `title` هو إرشادٌ لم يُكتب. */
  return (
    <span className="btn-wrap">
      {btn}
      <span className="btn-reason" id={rid}>{reason}</span>
    </span>
  );
}

/** فعلٌ خطر: تأكيدٌ **بالكتابة** لا بنقرة — والنقرة تُضغَط بالخطأ. */
export function DangerButton({ children, confirmWord, onConfirm, disabled }: {
  children: ReactNode; confirmWord: string; onConfirm: () => void; disabled?: boolean;
}) {
  return (
    <Button
      variant="danger"
      disabled={disabled}
      onClick={() => {
        // eslint-disable-next-line no-alert
        const typed = window.prompt(`اكتب «${confirmWord}» للتأكيد. هذا الفعل لا يُسحب.`);
        if (typed?.trim() === confirmWord) onConfirm();
      }}
    >
      {children}
    </Button>
  );
}

/* ══════════════ الحقول ══════════════ */

export function Field({ label, hint, error, children, id, labelless }: {
  label: string; hint?: string; error?: string; children: ReactNode; id: string;
  /**
   * ★ المحتوى ليس عنصراً قابلاً للوسم (عرضٌ للقراءة، مجموعةٌ من الأزرار…).
   *
   * `<label for>` لا يرتبط إلّا بـinput/textarea/select/button/meter/progress.
   * فوسمٌ يشير إلى `div` **معطَّلٌ تماماً**: لا نقرةً تنقل التركيز، ولا القارئ
   * الصوتيّ يربط الاسم بالمحتوى — يقرأ نصّاً عارياً بلا عنوان. وهنا نستعمل
   * عنواناً حقيقيّاً ونربطه بالمجموعة بـ`aria-labelledby`.
   */
  labelless?: boolean;
}) {
  const head = (
    <>
      {label}
      {hint && <span className="hint">{hint}</span>}
    </>
  );
  return (
    <div className="field">
      {labelless
        ? <span className="field-h" id={`${id}-lbl`}>{head}</span>
        /* label مرتبطٌ بـid — لا placeholder بديلاً عن الوسم */
        : <label htmlFor={id}>{head}</label>}
      {labelless
        ? <div role="group" aria-labelledby={`${id}-lbl`}>{children}</div>
        : children}
      {error && <span className="field-e" role="alert">{error}</span>}
    </div>
  );
}

export function Input({ id, value, onChange, type = 'text', placeholder, dir, disabled, required }: {
  id: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; dir?: 'ltr' | 'rtl'; disabled?: boolean; required?: boolean;
}) {
  return (
    <input
      id={id} className="input" type={type} value={value} dir={dir}
      placeholder={placeholder} disabled={disabled} required={required}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextArea({ id, value, onChange, rows, placeholder, count, dir }: {
  id: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string;
  /** عدّادٌ حيّ — يلوّن عند الاقتراب من الحدّ لا بعد تجاوزه */
  count?: { used: number; limit: number; unit: string };
  /**
   * ★ `dir="auto"` على حقلٍ يكتب فيه المستخدم.
   *   و`dir` سِمةٌ لا يعوّضها CSS، ولا يُغني وضعها على الحاوي: نصّ `textarea`
   *   يُقاس من **قيمته** لا من أبيه. وبلا هذا يُرسم النصّ نفسه بترتيبَين:
   *   ترتيبٍ في العرض للقراءة (الذي يحمل `dir="auto"`) وترتيبٍ آخر في الحقل.
   */
  dir?: 'auto' | 'ltr' | 'rtl';
}) {
  const pct = count ? count.used / count.limit : 0;
  return (
    <>
      <textarea
        id={id} className="ta" value={value} rows={rows} placeholder={placeholder} dir={dir}
        onChange={(e) => onChange(e.target.value)}
      />
      {count && (
        <div className={`cnt${pct >= 1 ? ' crit' : pct >= 0.8 ? ' warn' : ''}`}>
          {/* ★ الوحدةُ **خارج العازل** — وهي عربيّةٌ في كلّ موضع استدعاءٍ في
              المنتج («توكن» · «محرف»). وكانت داخله، فيسري عليها `direction: ltr`
              ويُقلب ترتيبُها مع رقمها: «1,240 / 2,000 توكن» تُرسم والوحدةُ
              **قبل** عددها في القراءة. وهذه هي القاعدة المكتوبة في هذا الملفّ
              نفسه: لا كلمةَ عربيّةٍ داخل عازلٍ اتّجاهيّ أبداً.
              والمَدَيان في مدًى واحدٍ فلا يفترقان عنصرَين في شبكةٍ مرنة. */}
          <span>
            <span className="num">
              {count.used.toLocaleString('en-US')} / {count.limit.toLocaleString('en-US')}
            </span>
            {' '}{count.unit}
          </span>
          {pct >= 0.8 && <span>{pct >= 1 ? 'تجاوزتَ الحدّ' : 'قاربتَ الحدّ'}</span>}
        </div>
      )}
    </>
  );
}

export function Select({ id, value, onChange, options, disabled }: {
  id: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; disabled?: boolean;
}) {
  return (
    <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ id, checked, onChange, label, disabled }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <label className="toggle" htmlFor={id}>
      <input
        id={id} type="checkbox" role="switch" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-t" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/* ══════════════ التنقّل ══════════════ */

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: ReadonlyArray<{ id: T; label: string; badge?: number }>;
  active: T; onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id} type="button" role="tab" className="tab"
          aria-selected={active === t.id} onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge ? <span className="tab-b num">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Note({ tone = 'brand', children }: { tone?: 'brand' | 'warn' | 'crit'; children: ReactNode }) {
  return <div className={`note ${tone}`}>{children}</div>;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="vh">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="sp">{actions}</div>}
    </div>
  );
}

/* ══════════════ الجداول ══════════════ */

export interface Column<T> {
  key: string;
  head: string;
  /** أرقامٌ جدوليّة ولا تنكسر — بدونها ترقص الأعمدة فتُقرأ خطأً */
  num?: boolean;
  cell: (row: T) => ReactNode;
}

/**
 * ★ **الجدول ينقلب بطاقاتٍ حيث يضيق — نفسُ المكوّن بأعمدةٍ أكثر لا علامةٌ ثانية.**
 *
 *   كان يُرسَم `.tw > table` بـ`min-width: 560px` وتمريرٍ أفقيّ، فستّةُ أعمدةٍ
 *   على هاتفٍ بعرض 390 تعني **عمودَين مخفيَّين خلف تمريرٍ لا يقول إنّه موجود**:
 *   «رسائل» و«كلفة الذكاء» — أي الرقمان اللذان تُفتح الشاشةُ من أجلهما.
 *
 *   و`components.css` يحمل الانقلاب جاهزاً منذ المرحلة ③ (`.tblw` · `.tbl`
 *   واستعلامُ حاوٍ عند 1100)، ولم يكن له موضعُ استدعاء. وشرطاه يقعان هنا:
 *   `data-k` على كلّ خليّة — وهو اسمُ العمود يصير مفتاحاً في البطاقة —
 *   و`.tblw` حاويةً مسمّاةً يُقاس عليها. والقياسُ على **الحاوي** لا النافذة:
 *   جدولٌ في عمودٍ ضيّقٍ من شاشةٍ عريضةٍ يبقى بطاقاتٍ، وهو الصحيح.
 *
 *   والعمودُ الأوّل هو هويّةُ الصفّ في كلّ استعمالٍ في المنتج (الزبون · العميل)،
 *   فيُوسَم `hd` ليُقرأ عنواناً للبطاقة لا سطراً فيها.
 */
export function Table<T>({ columns, rows, keyOf, onRowClick }: {
  columns: Array<Column<T>>; rows: T[]; keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="tblw">
      <table className="tbl">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'n' : undefined}>{c.head}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={keyOf(r)}
              className={onRowClick ? 'clk' : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  /* المفتاحُ يُطبع من `content: attr(data-k)` في وضع البطاقات */
                  data-k={c.head}
                  className={[i === 0 ? 'hd' : '', c.num ? 'n' : ''].filter(Boolean).join(' ') || undefined}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════ الحوار ══════════════ */

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      {/* الإيقاف هنا فقط: النقر على الخلفيّة يُغلق، وداخل البطاقة لا */}
      <div className={`modal${wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        <div className="modal-b">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** كتلةٌ مونوسبيس قابلةٌ للنسخ — ليلصقها العميل في رسالة دعم. */
export function CodeBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div className="codeb">
      {label && <span className="codeb-l">{label}</span>}
      <pre dir="ltr">{text}</pre>
      <button
        type="button" className="btn quiet sm"
        onClick={() => { void navigator.clipboard?.writeText(text); }}
      >
        انسخ
      </button>
    </div>
  );
}

/**
 * فرقٌ سطراً سطراً. العميل ينشر شخصيّةً لا يذكر ما غيّره فيها — فالنشر بلا
 * معاينةِ فرقٍ قرارٌ على العمياء.
 */
export function DiffView({ before, after }: { before: string; after: string }) {
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  const lines: Array<{ t: 'same' | 'add' | 'del'; text: string }> = [];
  for (let i = 0; i < max; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === y) { if (x !== undefined) lines.push({ t: 'same', text: x }); continue; }
    if (x !== undefined) lines.push({ t: 'del', text: x });
    if (y !== undefined) lines.push({ t: 'add', text: y });
  }
  const changed = lines.some((l) => l.t !== 'same');
  if (!changed) return <p className="muted-p">لا فرق — النصّان متطابقان.</p>;
  return (
    <div className="diff">
      {lines.map((l, i) => (
        <div key={`${i}-${l.t}`} className={`dl ${l.t}`}>
          <span aria-hidden="true" className="dl-m">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ' '}</span>
          <span>{l.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════ بنى d4 الجديدة — مكوّناتٌ تنتظر تبنّيها ══════════════ */
/*
 * لا موضعَ استدعاءٍ لها بعد، وهذا مقصود: قانونُ المرحلة **إضافةٌ بلا حذف**،
 * فتُبنى الأداةُ أوّلاً ثمّ تُهاجَر الشاشاتُ إليها واحدةً واحدة. وكلُّ صنفٍ
 * تكتبه هذه المكوّناتُ معرَّفٌ في `components.css` — وإلّا أمسكها حارسُ
 * الصنف الميّت في نفس اللحظة.
 */

/**
 * وسمٌ عامّ. يفترق عن `Pill` بالمعنى لا بالمظهر: `Pill` شارةُ **حالةٍ** مفرداتُها
 * مغلقة (سليم · تحذير · خطير · حرج)، و`Tag` وسمٌ لِما ليس حالةً — سلسلةُ رسمٍ،
 * أو تصنيفٌ لا شدّةَ له — ومعه صيغةُ الخطّ التي لا تحمل سطحاً فلا تُقرأ حالة.
 *
 * و`label` إلزاميّةٌ كما في `Pill`: لا معنى باللون ولا بالشكل وحدهما.
 */
export function Tag({ tone = 'neutral', label, mark = true, line }: {
  tone?: Tone; label: string; mark?: boolean;
  /** بلا سطح — لِما ليس حالةً */
  line?: boolean;
}) {
  return (
    <span className={`tag ${tone}${line ? ' line' : ''}`}>
      {mark && <span aria-hidden="true" className="tag-m">{ICON[tone]}</span>}
      <Iso text={label} />
    </span>
  );
}

/**
 * الورقةُ الصاعدة — سطحُ الكشف الوحيد.
 *
 * ★ **عقدةٌ واحدةٌ لا عقدتان.** لا منسدلةٌ للحاسوب وورقةٌ للهاتف يُخفى إحداهما:
 *   نفسُ الشجرة، وCSS يقرّر هيئتها. وقرارُ الهيئة معلَّقٌ على **الفأرة** لا على
 *   العرض (`pointer: fine` مع 1100) — فلوحٌ لمسيٌّ عريضٌ يستحقّ ورقةً تصعد
 *   لا قائمةً تحتاج تصويباً بالإصبع على 340 بكسلاً.
 *
 * ويبقى المكوّنُ مرسوماً وهو مغلق: الإخفاءُ بـ`visibility` في CSS كي يعمل
 * الانزلاق — ولو أُزيل من الشجرة لظهر وانزلق في نفس الإطار فلم يُرَ انزلاقُه.
 */
export function Sheet({ open, title, onClose, children, footer, hint, kind = 'sheet' }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** الفعلُ الأساس — يسكن ذيلاً ثابتاً لا يمرّ مع المحتوى */
  footer?: ReactNode;
  /** سطرٌ يقول أثرَ الفعل قبل الضغط — لا بعده */
  hint?: string;
  /** `menu` تُثبَّت تحت الترويسة على الفأرة فتُقرأ منسدلة */
  kind?: 'sheet' | 'menu';
}) {
  return (
    <div className={`sheetwrap${open ? ' on' : ''}`} data-kind={kind}>
      {/* ★ زرٌّ حقيقيٌّ لا `div` بمعالج: «أغلِق بالنقر خارجها» فعلٌ يجب أن
          يُنطَق ويُبلَغ بالمفتاح، وإلّا صارت الورقةُ مصيدةً لمن لا فأرةَ له. */}
      <button type="button" className="sheet-scrim" aria-label="إغلاق بالنقر خارج الورقة" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <span className="grab" aria-hidden="true" />
        <header>
          <h2>{title}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        <div className="sheet-b">{children}</div>
        {(footer || hint) && (
          <div className="sheet-f">
            {footer}
            {hint && <p className="sheet-hint">{hint}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * الرصيف — ما تحت الإبهام.
 *
 * ★ **صفٌّ في تخطيط أبيه لا `position: fixed`.** والفرقُ ليس ذوقاً: المثبَّتُ
 *   يحتاج حشواً سفليّاً وهميّاً في المُمرِّر (يُنسى فيغطّي آخرَ صفٍّ في القائمة)،
 *   ويقفز مع لوحة مفاتيح الهاتف، ويغطّي ما تحته عند التكبير. فمن يستعمله يضعه
 *   آخرَ صفٍّ في عمودٍ مرنٍ أو شبكةٍ، والجسمُ فوقه يحمل `min-height: 0`.
 */
export function Dock({ children, hint }: {
  children: ReactNode;
  /** يشرح أثرَ الفعل قبل الضغط — ويدور إلى نهاية الشريط على الحاسوب */
  hint?: string;
}) {
  return (
    <div className="dock">
      {children}
      {hint && <p className="dock-h">{hint}</p>}
    </div>
  );
}

/* ══════════════ نموذجٌ يراه مديرُ كلمات السرّ ══════════════ */

/**
 * حقلُ نموذجٍ يحمل السِّمات التي **لا يعوّضها صنفٌ ولا CSS**.
 *
 * ★ لماذا مكوّنٌ ثانٍ ولا تُوسَّع `Input`: `Input` مُستدعاةٌ في كلّ شاشةٍ في
 *   المنتج، والتعديلُ فيها فعلٌ في ملفٍّ مشترك. وقانونُ المرحلة إضافةٌ بلا
 *   حذفٍ ولا تعديلٍ لما لا يخصّ صاحبَ الشاشة — فيُضاف اسمٌ ثانٍ ويبقى
 *   الأوّلُ كما هو. ولا صنفَ جديداً معه: هو `.input` بعينه.
 *
 * ★ ولماذا هي بنيةٌ لا رفاهية: `name` و`autoComplete` هما ما يجعل مديرَ
 *   كلمات السرّ **يرى الحقل أصلاً**. فبلاهما لا يُعرض حسابٌ محفوظ ولا تُقترح
 *   كلمةٌ جديدةٌ عند التغيير، فتُكتب باليد — وذاك بابُ الكلمة القصيرة
 *   وإعادةِ استعمالها في كلّ مكان. وشاشةُ دخولٍ بلا `autoComplete` هي أضعفُ
 *   نموذجٍ ممكن، لا نموذجٌ «بسيط».
 *
 * و`autoFocus` مقصورٌ على شاشةٍ لا غرضَ لها إلّا هذا النموذج (الدخول ·
 * البوّابة): نقلُ التركيز في شاشةٍ فيها محتوًى آخر يسرق موضعَ القارئ.
 */
export function FormInput({
  id, name, value, onChange, type = 'text', autoComplete, autoFocus,
  dir, placeholder, disabled, required, invalid, inputMode, enterKeyHint, describedBy,
}: {
  id: string;
  /** اسمُ الحقل في النموذج — بلاه لا يربط مديرُ كلمات السرّ الحقلَ بحساب */
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'email' | 'password' | 'tel' | 'url';
  /** `username` · `current-password` · `new-password` — وهي عقدُ المتصفّح لا تلميحٌ له */
  autoComplete?: string;
  autoFocus?: boolean;
  dir?: 'ltr' | 'rtl';
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** يُنطَق «غير صالح» للقارئ الصوتيّ — واللونُ وحده لا يقول ذلك */
  invalid?: boolean;
  inputMode?: 'text' | 'email' | 'numeric' | 'tel' | 'url';
  /** مفتاحُ الإدخال على لوحة الهاتف: «التالي» في وسط النموذج و«اذهب» في آخره */
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'send';
  /** معرّفُ نصٍّ يشرح الحقل — يُنطَق بعد وسمه */
  describedBy?: string;
}) {
  return (
    <input
      id={id} name={name} className="input" type={type} value={value} dir={dir}
      autoComplete={autoComplete} autoFocus={autoFocus} inputMode={inputMode}
      enterKeyHint={enterKeyHint} placeholder={placeholder}
      disabled={disabled} required={required}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * ملاحظةٌ **تُنطَق**: هي `Note` بعينها مظهراً، ودورُها الحيُّ هو المعنى.
 *
 * ★ كان فشلُ الدخول يُرسَم في `Note` بلا `role`، فمن يستعمل قارئَ شاشةٍ يضغط
 *   «دخول» ولا يسمع شيئاً — الصفحةُ لم تتغيّر عنده، والزرُّ لا يُخبر. و
 *   `ErrorBox` تحمل الدورَ لكنّها تحمل معه عنواناً ثابتاً («تعذّر تحميل هذا
 *   الجزء») لا يصلح لفشل **فعلٍ طلبه المستخدم**. فهذه ثالثةٌ بلا صنفٍ جديد.
 */
export function Alert({ tone = 'crit', children }: {
  tone?: 'brand' | 'warn' | 'crit'; children: ReactNode;
}) {
  return <div className={`note ${tone}`} role="alert">{children}</div>;
}
