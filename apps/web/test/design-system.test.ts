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
/* تُقبل بصيغتَي التعليق: `// style-ok:` في TS، و`{/* style-ok: *\/}` داخل JSX
   — وهي الصيغة الوحيدة الممكنة بين عناصر JSX. */
const MARKER = /(?:\/\/|\/\*)\s*style-ok:\s*\S/;

/**
 * سقف الملفّات القديمة، مأخوذٌ من الواقع لحظة بناء طبقة المكوّنات.
 * القاعدة: **ينزل ولا يصعد.** وحذف مدخلٍ هنا يعني أنّ الملفّ هُوجر تماماً.
 */
const LEGACY: Record<string, number> = {
  'app/(legal)/privacy/page.tsx': 2,
  'app/(legal)/terms/page.tsx': 2,
  'app/app/bot/page.tsx': 13,
  'app/app/layout.tsx': 1,
  'app/console/incidents/page.tsx': 11,
  'app/console/margin/page.tsx': 13,
  'app/console/page.tsx': 3,
  'app/login/page.tsx': 3,
  'components/Shell.tsx': 8,
};

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
  const css = ['globals.css', 'components.css']
    .map((f) => readFileSync(join(ROOT, 'app', f), 'utf8'))
    .join('\n');

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
