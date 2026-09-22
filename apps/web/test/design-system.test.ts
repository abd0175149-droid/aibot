import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ★ نظام التصميم مُستعمَلٌ لا متجاوَز — والحدّ مفروضٌ لا مرجوّ.
 *
 * العطل الذي وُلد منه هذا الملفّ ليس قبحاً بل بنية: كان في الواجهة
 * **١٠١ `style={{`** داخل JSX مقابل ٣٨ صنفاً في CSS. أي أنّ نحو ٤٠٪ من قرارات
 * التصميم مكرّرةٌ في أماكن متفرّقة، فلا يمكن تغيير مسافةٍ أو حافةٍ في مكانٍ
 * واحد — وذاك ما يجعل «إعادة التصميم» مستحيلةً لا مؤجَّلة.
 *
 * وخطّة المرحلة صفر وعدت بـ«قيد ESLint» مرّتين ولم يُبنَ. وبدل إدخال سلسلة
 * أدواتٍ كاملة لقاعدةٍ واحدة، يُفرَض الحدّ بنفس نمط الحُرّاس القائم في المشروع:
 * ماسحٌ ساكنٌ بلا تبعيّةٍ جديدة، وبنفس الأثر.
 *
 * ثلاث بوّابات:
 *  ① ملفٌّ جديد: **صفر** `style={{}}` — بلا استثناء.
 *  ② قيمةٌ ديناميكيّة لا تُمثَّل بصنف (عرض شريط، ارتفاع هيكل) تُعلَن صراحةً
 *     بـ`// style-ok: السبب` في السطر نفسه أو السابق.
 *  ③ الملفّات القديمة لها سقفٌ مسجَّل **لا يُرفَع**. وكلّ هجرةٍ تُخفضه،
 *     والاختبار يطلب تحديث الرقم — فالتقدّم مقيسٌ لا موعود.
 */

const ROOT = join(__dirname, '..', 'src');

/**
 * ★ أوراق الأنماط تُشتقّ من `layout.tsx` ولا تُكتب يدويّاً.
 *
 *   كانت مكتوبةً يدويّاً `['globals.css', 'components.css']` في موضعين، فلمّا
 *   أُضيف `inbox.css` بقي الحارسان يجهلانه: صار كلّ صنفٍ فيه «غير معرَّف» —
 *   أي أنّ الحارس بدأ يكذب في الاتّجاهين معاً، ينفي المعرَّف ولا يمسك الميّت —
 *   وصار كلّ توكِنٍ فيه بلا فحصٍ أصلاً. والأوراق التي يحمّلها التخطيط فعلاً
 *   هي المصدر الوحيد للحقيقة هنا.
 */
const SHEETS = [...readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8')
  .matchAll(/^import '\.\/([\w.-]+\.css)';/gm)].map((m) => m[1]!);

/** نصُّ كلّ ورقةٍ على حِدة: الحُرّاسُ السطريّة تحتاج الملفَّ والسطر لا نصّاً موصولاً. */
const SHEET_SRC = SHEETS.map((f) => ({
  file: f,
  src: readFileSync(join(ROOT, 'app', f), 'utf8'),
}));

const CSS_ALL = SHEET_SRC.map((x) => x.src).join('\n');

/** ما على القرص فعلاً — لا ما يذكره التخطيط. والفرقُ بينهما هو العطل. */
const SHEETS_ON_DISK = readdirSync(join(ROOT, 'app')).filter((f) => f.endsWith('.css'));
/* تُقبل بصيغتَي التعليق: `// style-ok:` في TS، و`{/* style-ok: *\/}` داخل JSX
   — وهي الصيغة الوحيدة الممكنة بين عناصر JSX. */
const MARKER = /(?:\/\/|\/\*)\s*style-ok:\s*\S/;

/**
 * سقف الملفّات القديمة، مأخوذٌ من الواقع لحظة بناء طبقة المكوّنات.
 * القاعدة: **ينزل ولا يصعد.** وحذف مدخلٍ هنا يعني أنّ الملفّ هُوجر تماماً.
 */
/**
 * ★ فارغٌ الآن — **كلّ شاشةٍ في المنتج مهاجَرة**، من 101 نمطٍ مضمَّن إلى صفر.
 *
 * والجدول يبقى موجوداً لا يُحذف: هو آليّة الترحيل التدريجيّ إن دخلت شاشةٌ
 * قديمةٌ يوماً. وفراغه يعني أنّ البوّابة الأولى (ملفٌّ جديد = صفر) تسري
 * على **كلّ** ملفّ بلا استثناء.
 */
const LEGACY: Record<string, number> = {};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** يعدّ ما ليس معلَّماً بـ`style-ok` — فالمعلَّم قرارٌ لا سهو. */
function unmarkedStyles(src: string): number {
  const lines = src.split(/\r?\n/);
  let n = 0;
  lines.forEach((line, i) => {
    if (!line.includes('style={{')) return;
    /* تعليقٌ لا كود: أوّل تشغيلٍ أبلغ عن ثلاثة «مخالفات» كلّها في شرحٍ يذكر
       النمط الممنوع. ماسحٌ يعدّ التعليقات يُنتج إنذاراً كاذباً، وذاك أسرع
       طريقٍ لإطفاء الاختبار. */
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    if (MARKER.test(line) || MARKER.test(lines[i - 1] ?? '')) return;
    n += 1;
  });
  return n;
}

const files = walk(ROOT).map((abs) => ({
  rel: relative(ROOT, abs).replace(/\\/g, '/'),
  src: readFileSync(abs, 'utf8'),
}));

describe('نظام التصميم — الحدّ مفروضٌ لا مرجوّ', () => {
  it('يوجد ملفّاتٌ تُمسح — وإلّا فالاختبار يمرّ على الفراغ', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('ملفٌّ جديد: صفر style={{} } بلا علامةٍ صريحة', () => {
    const offenders = files
      .filter((f) => !(f.rel in LEGACY))
      .map((f) => ({ rel: f.rel, n: unmarkedStyles(f.src) }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.rel} → ${x.n}`);

    expect(
      offenders,
      'ملفٌّ جديد لا يجوز أن يحمل نمطاً مضمَّناً. '
      + 'أضِف صنفاً في components.css واستعمله، '
      + 'أو أعلن القيمة الديناميكيّة بـ«// style-ok: السبب».',
    ).toEqual([]);
  });

  it('الملفّات القديمة لا يرتفع سقفها — والهجرة تُخفضه', () => {
    const risen: string[] = [];
    const improved: string[] = [];
    for (const [rel, cap] of Object.entries(LEGACY)) {
      const f = files.find((x) => x.rel === rel);
      if (!f) { improved.push(`${rel} → حُذف الملفّ، أزِل مدخله من LEGACY`); continue; }
      const n = unmarkedStyles(f.src);
      if (n > cap) risen.push(`${rel} → ${n} (السقف ${cap})`);
      // التقدّم يُسجَّل: الرقم يُحدَّث فلا يتحوّل السقف إلى سقفٍ للطموح
      if (n < cap) improved.push(`${rel} → ${n} (السقف ${cap} — أنزِله)`);
    }
    expect(risen, 'ارتفع عدد الأنماط المضمَّنة في ملفٍّ قديم — الاتّجاه نزولاً فقط.').toEqual([]);
    expect(improved, 'تحسّن ملفٌّ ولم يُحدَّث سقفه في LEGACY — حدّثه ليُقاس التقدّم.').toEqual([]);
  });

  it('الماسح يمسك الشكل ويحترم العلامة', () => {
    expect(unmarkedStyles('<i style={{ width: w }} />')).toBe(1);
    expect(unmarkedStyles('<i style={{ width: w }} /> // style-ok: عرضٌ محسوب')).toBe(0);
    expect(unmarkedStyles('// style-ok: عرضٌ محسوب\n<i style={{ width: w }} />')).toBe(0);
    expect(unmarkedStyles('<i className="meter" />')).toBe(0);
    // ولا يعدّ ذِكرَ النمط في شرحٍ أو تعليق
    expect(unmarkedStyles(' * القاعدة: صفر style={{ في ملفٍّ جديد')).toBe(0);
    expect(unmarkedStyles('  // بدل style={{ gridColumn }}')).toBe(0);
    // وصيغة JSX — وهي الوحيدة الممكنة بين العناصر
    expect(unmarkedStyles(['{/* style-ok: محسوب */}', '<i style={{ width: w }} />'].join('\n'))).toBe(0);
  });
});

describe('التوكِنات — الثيمات الثلاث كلّها معرَّفة', () => {
  const css = CSS_ALL;

  it('كلّ توكِنٍ مستعمَلٍ معرَّفٌ في :root المجرّد', () => {
    /* ★ توكِنٌ معرَّفٌ داخل media أو [data-theme] وحده = العطل الكلاسيكيّ:
       الزائر على «اتّبع النظام» لا تُختَم جذره بشيء، فيرى نصّ ثيمٍ على
       أرضيّة الآخر. */
    const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf('color-scheme: light;')));
    const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!))];
    const missing = used.filter((t) => !new RegExp(`(^|\\s)${t}\\s*:`, 'm').test(rootBlock));
    expect(missing, 'توكِنٌ مستعمَلٌ غير معرَّفٍ في :root المجرّد').toEqual([]);
  });

  it('الحالات الثلاث موجودة: :root · prefers-color-scheme مضبوطة · [data-theme=dark]', () => {
    expect(css).toContain(":root:not([data-theme='light'])");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root[data-theme='dark']");
  });

  it('الجسم يطلي خلفيّته صراحةً — فالمضيف لا يُقرض أرضيّته', () => {
    expect(/body\s*\{[^}]*background:\s*var\(--bg\)/s.test(css)).toBe(true);
  });

  it('ألوان الحالة الأربعة معرَّفة ومنفصلةٌ عن لون العلامة', () => {
    for (const t of ['--ok', '--warn', '--serious', '--crit']) {
      expect(css).toContain(`${t}:`);
    }
    // لا يجوز أن يكون --brand مساوياً لأيّ لون حالة: القارئ يبني المعنى مرّةً
    const brand = /--brand:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]?.toLowerCase();
    const states = [...css.matchAll(/--(?:ok|warn|serious|crit):\s*(#[0-9a-f]{6})/gi)]
      .map((m) => m[1]!.toLowerCase());
    expect(states).not.toContain(brand);
  });
});

/**
 * ★ حارس الصنف الميّت.
 *
 * بلا Tailwind ولا أنواعٍ على `className`، صنفٌ يُكتب خطأً — أو يبقى بعد حذف
 * نسخةٍ قديمة من CSS — **لا يرمي ولا يُحذّر**: العنصر يُرسم بلا نمطٍ إطلاقاً،
 * فيبدو «مكسوراً» بلا أن يفشل شيء. وهذا بالضبط ما حدث حين تعايشت مفردتان
 * للأصناف (‏`.btn.pri` القديمة مع `.btn.primary` الجديدة).
 */
/** كلّ صنفٍ معرَّفٍ في أيّ قاعدةٍ أو حالة. */
const DEFINED = new Set(
  [...CSS_ALL.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!),
);

/** أصنافٌ تأتي من مكتبةٍ أو من الخارج ولا تُعرَّف عندنا. */
const EXTERNAL = new Set(['sr-only']);

describe('لا صنفَ ميّت — الصنف غير المعرَّف يسقط بلا نمطٍ بلا أن يفشل شيء', () => {
  it('الحارس يقرأ كلّ ورقةٍ يحمّلها التخطيط', () => {
    // بلا هذا الفحص، ورقةٌ تُنسى تجعل الحارس يمرّ على كلّ شيءٍ صامتاً
    expect(SHEETS).toContain('globals.css');
    expect(SHEETS).toContain('components.css');
    expect(SHEETS).toContain('shell.css');
    expect(SHEETS).toContain('inbox.css');
  });

  it('★ ولا ورقةٌ على القرص خارج التخطيط — وإلّا صارت كلُّ أصنافها «ميّتة»', () => {
    /* الاشتقاقُ من `layout.tsx` يحلّ نصفَ المشكلة: يمنع أن يُنسى الحارسُ ورقةً
       **مستوردة**. ولا يحلّ النصفَ الآخر: ورقةٌ تُكتب ولا تُستورد. وأثرُها
       مزدوجٌ وخبيث — أصنافُها لا تُرسم في المتصفّح فتبدو الشاشةُ مكسورةً بلا
       خطأ، **و**كلُّ اسمٍ فيها يُبلَّغ عنه هنا «صنفاً غير معرَّف»، فيغرق الحارسُ
       في مئة نقصٍ بدل أن يقول الحقيقةَ الواحدة: سطرُ استيرادٍ ناقص. ولو
       احتاجت ورقةٌ أن تُستورد من مكوّنٍ لا من التخطيط فمكانُ تسجيلها هنا. */
    const orphan = SHEETS_ON_DISK.filter((f) => !SHEETS.includes(f));
    expect(
      orphan,
      'ورقةُ أنماطٍ في src/app لا يستوردها layout.tsx — أضِف سطرَ الاستيراد.',
    ).toEqual([]);
  });

  it('كلّ صنفٍ مستعمَلٍ في JSX معرَّفٌ في CSS', () => {
    const used = new Map();
    for (const { rel, src } of files) {
      if (rel.startsWith('app/') === false && rel.startsWith('components/') === false) continue;
      // حرفيّات className فقط — لا تعابير القوالب المركَّبة
      for (const m of src.matchAll(/className="([^"{}]+)"/g)) {
        for (const c of m[1]!.split(/\s+/).filter(Boolean)) {
          if (!DEFINED.has(c) && !EXTERNAL.has(c)) used.set(c, rel);
        }
      }
    }
    const missing = [...used].map(([c, f]) => `${c} (${f})`);
    expect(
      missing,
      'صنفٌ مستعمَلٌ غير معرَّفٍ في أيّ ورقةٍ يحمّلها التخطيط — '
      + 'العنصر يُرسم بلا نمطٍ إطلاقاً ولا يفشل شيء.',
    ).toEqual([]);
  });

  it('الماسح يمسك الشكل فعلاً', () => {
    expect(DEFINED.has('stat')).toBe(true);
    expect(DEFINED.has('this-class-does-not-exist')).toBe(false);
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   ★ حارسُ الادّعاء الأساس: **لا سطرَ JS يقرأ عرضاً.**

   التصميمُ المعتمد لا يقوم على «واجهةٍ للهاتف وأخرى للحاسوب» بل على **عنصرٍ
   واحدٍ يتحوّل**: `.side` هو نفسه شريطٌ سفليٌّ ورصيفٌ جانبيّ، والورقةُ الصاعدة
   هي نفسها قائمةٌ منسدلة. وهذا الادّعاء كلُّه في CSS، وقيمتُه أنّه يبقى
   صحيحاً في حالاتٍ لا يراها أحد: تكبيرُ الخطّ إلى 200٪، ونافذةٌ نصفيّة، وطباعةٌ.

   وأوّلُ عجلةٍ تكسره سطرٌ واحدٌ حسنُ النيّة: `if (window.innerWidth < 768)`.
   فتصير الشجرةُ شجرتَين — عقدةٌ تُخفى وعقدةٌ تُظهر — ويعود كلُّ ما حُلّ:
   حالةٌ تُفقد عند الدوران، وقارئُ شاشةٍ يرى قائمتَي تنقّل، وأوّلُ رسمٍ على
   الخادم يجهل العرضَ أصلاً فيومض.

   ولا يُمسك هذا بالمراجعة: السطرُ يعمل، والشاشةُ تبدو صحيحةً على جهاز المراجع.

   ── ما يُستثنى ولماذا ─────────────────────────────────────────────────────
   · **القياسُ بلا تفريعٍ مسموح**: `ResizeObserver` و`getBoundingClientRect`
     يقيسان عنصراً لِيُرسم فيه شيء (طولُ محورٍ في رسم، ارتفاعُ هيكل) ولا
     يسألان «هل نحن على هاتف». وهما يعملان في نافذةٍ نصفيّةٍ وداخل حاوٍ ضيّق،
     أي لا يحملان الخطأَ الذي يحمله سؤالُ النافذة.
   · **`matchMedia` عن ميزةٍ ليست عرضاً مسموحة**، ولهذا قائمةُ سماحٍ صريحةٍ
     لا قائمةُ منع: `prefers-color-scheme` (مبدّلُ الثيم يحتاجه فعلاً) و
     `pointer` و`prefers-reduced-motion`. وإضافةُ ميزةٍ إلى القائمة قرارٌ
     يُراجَع — وهذا هو «المنفذ» الوحيد، فلا علامةَ إعفاءٍ سطريّة هنا: العرضُ
     ليس حالةً استثنائيّةً يُؤذن بها، بل هو الشيءُ الممنوع بعينه.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * يُعمي التعليقاتَ والمحارفَ الهاربة ويحفظ الأسطر.
 *
 * ضرورتُه ليست نظريّة: `Shell.tsx` يشرح في تعليقه أنّه «لا `matchMedia` ولا
 * `innerWidth` في الملفّ» — فماسحٌ لا يُعمي التعليقات يبلّغ عن الشرح نفسه
 * مخالفةً. وإنذارٌ كاذبٌ واحدٌ أسرعُ طريقٍ إلى إطفاء الحارس.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    // حرفيّةُ نصٍّ: ما داخلها ليس تعليقاً ولو بدا كذلك ('https://…')
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i];
        i += 1;
        if (src[i - 1] === c) break;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i += 1) out += src[i] === '\n' ? '\n' : ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** ميزاتٌ ليست عرضاً — والقائمةُ سماحٌ صريحٌ يُراجَع، لا فتحةٌ عامّة. */
const MQ_ALLOWED = /prefers-color-scheme|prefers-reduced-motion|prefers-contrast|forced-colors|pointer|hover|display-mode|scripting/;

/** يعيد وصفَ كلّ تفريعٍ على عرضٍ في نصٍّ واحد (بعد إعماء التعليقات). */
function widthBranches(src: string): string[] {
  const hits: string[] = [];
  stripComments(src).split(/\r?\n/).forEach((line, i) => {
    const at = (what: string) => hits.push(`${i + 1}: ${what}`);
    if (/\b(?:inner|outer)Width\b/.test(line)) at('innerWidth/outerWidth');
    if (/\bis(?:Mobile|Phone|Tablet|Desktop|Narrow|Wide)\b/i.test(line)) at('علمُ جهازٍ في JS (isMobile وما شابه)');
    if (/\bscreen\s*\.\s*(?:width|availWidth)\b/.test(line)) at('screen.width');
    if (/\bdocumentElement\s*\.\s*clientWidth\b/.test(line)) at('documentElement.clientWidth');
    if (/\bmatchMedia\s*\(/.test(line)) {
      const m = /matchMedia\s*\(\s*(['"`])([^'"`]*)\1/.exec(line);
      // استعلامٌ يُبنى في JS لا يُقرأ هنا — ولا يُفترض فيه خيرٌ: هو التفريع بعينه
      if (!m) at('matchMedia باستعلامٍ غير حرفيّ');
      else if (!MQ_ALLOWED.test(m[2]!)) at(`matchMedia('${m[2]}')`);
    }
  });
  return hits;
}

describe('لا تفريعَ على عرض الشاشة في JS — نفس العلامة تتحوّل، لا علامتان تتبادلان', () => {
  it('صفرُ قراءةٍ للعرض في كلّ ملفّات src', () => {
    const offenders = files
      .flatMap((f) => widthBranches(f.src).map((h) => `${f.rel}:${h}`));

    expect(
      offenders,
      'قراءةُ عرضٍ في JS: التحوُّلُ مكانُه CSS — استعلامُ وسطٍ أو استعلامُ حاوٍ. '
      + 'وإن كان القياسُ لازماً لرسمٍ فـ`ResizeObserver` يقيس العنصرَ لا النافذة.',
    ).toEqual([]);
  });

  it('الماسح يمسك التفريع ويترك القياس', () => {
    expect(widthBranches('const w = window.innerWidth;')).toHaveLength(1);
    expect(widthBranches("if (matchMedia('(min-width: 1100px)').matches) {}")).toHaveLength(1);
    expect(widthBranches("matchMedia(`(max-width: ${bp}px)`)")).toHaveLength(1);
    expect(widthBranches('const isMobile = props.narrow;')).toHaveLength(1);
    // المسموح: ميزةٌ ليست عرضاً
    expect(widthBranches("matchMedia('(prefers-color-scheme: dark)')")).toHaveLength(0);
    expect(widthBranches("matchMedia('(pointer: coarse)')")).toHaveLength(0);
    // والقياسُ بلا تفريع
    expect(widthBranches('new ResizeObserver((e) => setW(e[0].contentRect.width));')).toHaveLength(0);
    expect(widthBranches("el.style.width = '100px';")).toHaveLength(0);
    // ★ والتعليقُ الذي يذكر الممنوع ليشرحه لا يُعدّ — وهو موجودٌ فعلاً في Shell.tsx
    expect(widthBranches('// ولا `matchMedia` ولا `innerWidth` في الملفّ.')).toHaveLength(0);
    expect(widthBranches('/* لا innerWidth هنا\n   ولا matchMedia */')).toHaveLength(0);
    // ولا حرفيّةُ نصٍّ فيها ما يشبه التعليق
    expect(widthBranches("const u = 'https://x.dev'; const w = innerWidth;")).toHaveLength(1);
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   ★ حارسُ عقد RTL: الخاصيّةُ منطقيّةٌ لا فيزيائيّة.

   «اليمين» في RTL هو **البداية**. فكلُّ `padding-left` و`border-right` و
   `right: 0` مكتوبةٍ بحسّ مصمّمٍ إنجليزيٍّ تهبط على الجانب المقابل، والنتيجةُ
   لا تُقرأ عطلاً بل «تصميماً غريباً»: خطٌّ في الهواء، وحشوٌ ملتصقٌ بالحرف
   الأوّل، وشريطُ حافّةٍ يستدير نحو الفراغ.

   ووقع هذا **ثلاث مرّاتٍ في يومٍ واحد** في هذا المشروع: حدُّ الرصيف الجانبيّ،
   وزوايا `.note` (مكتوبٌ شرحُها عند الصنف)، وزوايا `.ibx-edge` — والثالثةُ
   بقيت حيّةً حتّى أمسكها هذا الحارس.

   ── والزوايا داخلةٌ في العقد ولا تبدو كذلك ────────────────────────────────
   `border-radius` المختصرةُ فيزيائيّةٌ بالكامل، لكنّ الممنوعَ منها **ليس كلَّ
   استعمال**: `0 0 3px 3px` متماثلةٌ في المحور المضمَّن (أعلى-بداية = أعلى-نهاية)
   فتعمل في الاتّجاهَين. والممنوعُ ما يفرّق بين طرفَي السطر — `0 3px 3px 0` —
   فهو بعينه العطلُ الذي وقع مرّتَين. ولهذا يُفكَّك المختصَرُ ويُقارَن زوجاه
   بدل منعِ الاسم كلِّه.

   ── المحورُ الكتليُّ ليس في العقد ──────────────────────────────────────────
   `margin-top` و`border-bottom` لا تنقلبان في RTL، فلا تُمسك. والعقدُ عن
   اتّجاه السطر لا عن كلّ ما هو فيزيائيّ.
   ══════════════════════════════════════════════════════════════════════════ */

/** يُعمي تعليقاتَ CSS ويحفظ الأسطر — والتعليقُ هنا يذكر الممنوع ليشرحه أيضاً. */
function maskCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const PHYSICAL: Array<{ re: RegExp; use: string }> = [
  { re: /(?:^|[;{\s])(?:padding|margin)-(?:left|right)\s*:/, use: 'padding-inline-* / margin-inline-*' },
  { re: /(?:^|[;{\s])border-(?:left|right)(?:-(?:width|style|color))?\s*:/, use: 'border-inline-start/end' },
  { re: /(?:^|[;{\s])(?:left|right)\s*:/, use: 'inset-inline-start/end' },
  { re: /text-align\s*:\s*(?:left|right)\b/, use: 'text-align: start / end' },
];

/** علامةُ إذنٍ صريحة — على السطر نفسه أو الذي قبله. */
const PHYS_OK = /\/\*\s*physical-ok:\s*\S/;

/** يفكّ `border-radius` المختصرة إلى الزوايا الأربع فيزيائيّاً. */
function radiusCorners(v: string): [string, string, string, string] | null {
  // الشكلُ الإهليلجيّ (a / b) وcalc ذاتُ المسافات لا تُفكّان بثقة، فلا يُدَّعى عليهما
  if (v.includes('/') || v.includes('calc(')) return null;
  const p = v.trim().split(/\s+/);
  if (p.length === 1) return [p[0]!, p[0]!, p[0]!, p[0]!];
  if (p.length === 2) return [p[0]!, p[1]!, p[0]!, p[1]!];
  if (p.length === 3) return [p[0]!, p[1]!, p[2]!, p[1]!];
  if (p.length === 4) return [p[0]!, p[1]!, p[2]!, p[3]!];
  return null;
}

/** يعيد وصفَ كلّ خاصيّةٍ فيزيائيّةٍ في ورقةٍ واحدة. */
function physicalOffenders(css: string): string[] {
  const raw = css.split(/\r?\n/);
  const masked = maskCssComments(css).split(/\r?\n/);
  const hits: string[] = [];
  masked.forEach((line, i) => {
    const allowed = PHYS_OK.test(raw[i] ?? '') || PHYS_OK.test(raw[i - 1] ?? '');
    if (allowed) return;
    for (const p of PHYSICAL) {
      if (p.re.test(line)) hits.push(`${i + 1}: ${line.trim().slice(0, 72)} → ${p.use}`);
    }
    for (const m of line.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
      const c = radiusCorners(m[1]!);
      if (!c) continue;
      const [ss, se, ee, es] = c;
      if (ss !== se || es !== ee) {
        hits.push(`${i + 1}: border-radius: ${m[1]!.trim()} → border-{start,end}-{start,end}-radius`);
      }
    }
  });
  return hits;
}

describe('عقدُ RTL — الخاصيّةُ منطقيّةٌ لا فيزيائيّة', () => {
  it('صفرُ خاصيّةٍ فيزيائيّةٍ في المحور المضمَّن، في كلّ ورقة', () => {
    const offenders = SHEET_SRC
      .flatMap(({ file, src }) => physicalOffenders(src).map((h) => `${file}:${h}`));

    expect(
      offenders,
      'خاصيّةٌ فيزيائيّةٌ حيث يجب أن تكون منطقيّة. «اليمين» في RTL هو البداية. '
      + 'وإن كان الطرفُ مقصوداً بعينه (مدًى لاتينيٌّ صريح) فأعلِنه '
      + 'بـ«/* physical-ok: السبب */».',
    ).toEqual([]);
  });

  it('الماسح يمسك الشكل ويحترم التعليق والعلامة', () => {
    expect(physicalOffenders('a { padding-left: 4px; }')).toHaveLength(1);
    expect(physicalOffenders('a { border-right: 1px solid red; }')).toHaveLength(1);
    expect(physicalOffenders('a { right: 0; }')).toHaveLength(1);
    expect(physicalOffenders('a { text-align: right; }')).toHaveLength(1);
    // المنطقيُّ لا يُمسك — ولا يُمسك المحورُ الكتليّ
    expect(physicalOffenders('a { padding-inline-start: 4px; }')).toHaveLength(0);
    expect(physicalOffenders('a { border-inline-end: 1px solid red; }')).toHaveLength(0);
    expect(physicalOffenders('a { inset-inline-start: 50%; }')).toHaveLength(0);
    expect(physicalOffenders('a { text-align: start; }')).toHaveLength(0);
    expect(physicalOffenders('a { margin-top: 0; border-bottom: 1px solid red; }')).toHaveLength(0);
    // ★ التعليقُ يذكر الممنوع ليشرحه — وهذا السطرُ موجودٌ فعلاً في shell.css
    expect(physicalOffenders('/* `inset-inline-start: 50%` تُحلّ إلى `right: 50%` في RTL */')).toHaveLength(0);
    // والعلامةُ إذنٌ صريح
    expect(physicalOffenders('a { right: 0; /* physical-ok: مدًى لاتينيٌّ صريح */ }')).toHaveLength(0);
    // الزوايا: يُمسك الفرقُ في المحور المضمَّن وحده
    expect(physicalOffenders('a { border-radius: 0 3px 3px 0; }')).toHaveLength(1);
    expect(physicalOffenders('a { border-radius: 0 0 3px 3px; }')).toHaveLength(0);
    expect(physicalOffenders('a { border-radius: 8px; }')).toHaveLength(0);
    expect(physicalOffenders('a { border-radius: var(--radius-pill); }')).toHaveLength(0);
    expect(physicalOffenders('a { border-start-end-radius: 3px; }')).toHaveLength(0);
  });
});
