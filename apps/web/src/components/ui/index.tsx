'use client';

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

export type Tone = 'ok' | 'warn' | 'serious' | 'crit' | 'brand' | 'violet' | 'neutral';

const ICON: Record<Tone, string> = {
  ok: '●', warn: '▲', serious: '▲', crit: '■', brand: '●', violet: '●', neutral: '○',
};

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
      {label}
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
export function Stat({ value, label, unit, tone, hero, meter }: {
  value: string | number; label: string; unit?: string; tone?: Tone; hero?: boolean;
  meter?: { pct: number; tone?: Tone };
}) {
  return (
    <div className={`stat${hero ? ' hero' : ''}${tone ? ` t-${tone}` : ''}`}>
      <span className="stat-v">
        {value}{unit && <small>{unit}</small>}
      </span>
      <span className="stat-k">{label}</span>
      {meter && <Meter pct={meter.pct} tone={meter.tone} />}
    </div>
  );
}

/** عتباتٌ ظاهرة: ٨٠٪ تحذير و٩٥٪ خطير و١٠٠٪ حرج — فلا يُفاجأ أحدٌ بسقف. */
export function Meter({ pct, tone }: { pct: number; tone?: Tone }) {
  const p = Math.max(0, Math.min(1, pct));
  const auto: Tone = p >= 1 ? 'crit' : p >= 0.95 ? 'serious' : p >= 0.8 ? 'warn' : 'brand';
  const t = tone ?? auto;
  /* ★ أرضيّةٌ مرئيّة: استهلاكٌ ضئيل (2 من 1500 = 0.13%) يُرسم شريطاً فارغاً
     يُقرأ **معطوباً** لا منخفضاً. فأيّ استهلاكٍ > 0 يُظهر أثراً، والصفر وحده
     يبقى فارغاً — فالفرق بين «لم تبدأ» و«بدأت بالكاد» معلومةٌ لا زينة. */
  const width = p === 0 ? 0 : Math.max(p * 100, 2.5);
  return (
    <span
      className={`meter ${t}`}
      role="meter"
      aria-valuenow={Math.round(p * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
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
export function Button({ children, onClick, variant = 'quiet', size = 'md', disabled, reason, type = 'button', busy }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  reason?: string;
  type?: 'button' | 'submit';
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      className={`btn ${variant} ${size}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={disabled && reason ? reason : undefined}
      aria-busy={busy || undefined}
    >
      {busy ? '…' : children}
    </button>
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

export function Field({ label, hint, error, children, id }: {
  label: string; hint?: string; error?: string; children: ReactNode; id: string;
}) {
  return (
    <div className="field">
      {/* label مرتبطٌ بـid — لا placeholder بديلاً عن الوسم */}
      <label htmlFor={id}>
        {label}
        {hint && <span className="hint">{hint}</span>}
      </label>
      {children}
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

export function TextArea({ id, value, onChange, rows, placeholder, count }: {
  id: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string;
  /** عدّادٌ حيّ — يلوّن عند الاقتراب من الحدّ لا بعد تجاوزه */
  count?: { used: number; limit: number; unit: string };
}) {
  const pct = count ? count.used / count.limit : 0;
  return (
    <>
      <textarea
        id={id} className="ta" value={value} rows={rows} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {count && (
        <div className={`cnt${pct >= 1 ? ' crit' : pct >= 0.8 ? ' warn' : ''}`}>
          <span className="num">{count.used.toLocaleString('en-US')} / {count.limit.toLocaleString('en-US')} {count.unit}</span>
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

export function Table<T>({ columns, rows, keyOf, onRowClick }: {
  columns: Array<Column<T>>; rows: T[]; keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="tw">
      <table>
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
              {columns.map((c) => <td key={c.key} className={c.num ? 'n' : undefined}>{c.cell(r)}</td>)}
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
