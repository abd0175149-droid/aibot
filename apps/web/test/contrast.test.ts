import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حارس التباين — يقرأ التوكِنات من CSS ويحسب، ولا يثق بجدولٍ مكتوب.
 *
 * وُلد من برهانٍ مباشر: اتّجاهُ التصميم الذي فاز في التحكيم كتب **43 نسبة
 * تباينٍ بيده** في وثيقته، وسقطت منها أخطرُ واحدةٍ بالضبط. والعقد الذي لا
 * يحرسه اختبارٌ يعود ميّتاً — وقد عاد ميّتاً هنا مرّتين:
 *
 *  ① `.btn.primary` كان يثبّت `color: #fff`، فصار «انشر» و«شغّل البوت» —
 *    أهمّ زرٍّ في المنصّة — على `--brand` الداكن عند **2.94:1**، أي تحت حدّ
 *    النصّ الكبير (3:1) فضلاً عن النصّ العاديّ (4.5:1). وهو أقلّ عنصرٍ
 *    قابليّةً للقراءة في نصف الحالات.
 *  ② شارة العدّاد أبيض على `--crit` الداكن = 3.90:1.
 *
 * وكلاهما أُصلح بـ`--signal-on`/`--status-on`: حبرٌ **يُقلَب مع الثيم** لا
 * قيمةٌ مثبَّتة. وهذا الملفّ يمنع عودتهما.
 *
 * ⚠️ الأزواج غير النصّيّة مشمولةٌ إلزاماً: WCAG 1.4.11 يطلب 3:1 لحدود
 *    العناصر التفاعليّة، وهي أكثر ما يُنسى لأنّ أدوات الفحص تقيس النصّ.
 */

const CSS = ['globals.css', 'components.css']
  .map((f) => readFileSync(join(__dirname, '..', 'src', 'app', f), 'utf8'))
  .join('\n');

/** الكتلة الأولى: `:root` المجرّد = الثيم الفاتح. */
function lightBlock(): string {
  const i = CSS.indexOf(':root {');
  return CSS.slice(i, CSS.indexOf('}', CSS.indexOf('color-scheme: light;')));
}

/** كتلة `:root[data-theme='dark']` = الثيم الداكن الصريح. */
function darkBlock(): string {
  const i = CSS.indexOf(":root[data-theme='dark']");
  return CSS.slice(i, CSS.indexOf('color-scheme: dark;', i));
}

function token(block: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  return m ? m[1]!.toLowerCase() : null;
}

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * بيانُ الأزواج. `min` هو الحدّ المطلوب:
 *  4.5 نصٌّ عاديّ · 3.0 نصٌّ كبير **وحدودُ العناصر التفاعليّة** (1.4.11).
 */
const PAIRS: Array<{ fg: string; bg: string; min: number; what: string }> = [
  // ── النصّ على الأسطح ──
  { fg: '--ink', bg: '--bg', min: 4.5, what: 'النصّ الأساس على أرضيّة الصفحة' },
  { fg: '--ink', bg: '--surface', min: 4.5, what: 'النصّ الأساس على اللوح' },
  { fg: '--ink-2', bg: '--surface', min: 4.5, what: 'النصّ الثانويّ على اللوح' },
  { fg: '--muted', bg: '--surface', min: 4.5, what: 'الوسم الخافت — حاملُ معنى كلّ رقم' },
  { fg: '--muted', bg: '--bg', min: 4.5, what: 'الوسم الخافت على أرضيّة الصفحة' },
  { fg: '--muted', bg: '--surface-2', min: 4.5, what: 'الوسم الخافت على السطح الثاني' },

  // ── ★ الحبر المنقلب على التعبئة الملوّنة ──
  { fg: '--signal-on', bg: '--brand', min: 4.5, what: 'نصّ الزرّ الأساس — «انشر» و«شغّل البوت»' },
  { fg: '--status-on', bg: '--crit', min: 4.5, what: 'نصّ شارة العدّاد الحرجة' },

  // ── الحالات على مسحاتها ──
  { fg: '--ok', bg: '--ok-wash', min: 4.5, what: 'شارة «سليم»' },
  { fg: '--warn', bg: '--warn-wash', min: 4.5, what: 'شارة «تحذير»' },
  { fg: '--serious', bg: '--serious-wash', min: 4.5, what: 'شارة «خطير»' },
  { fg: '--crit', bg: '--crit-wash', min: 4.5, what: 'شارة «حرج»' },
  { fg: '--brand-ink', bg: '--brand-wash', min: 4.5, what: 'نصّ الأساس على مسحته' },

  // ── ★ غير النصّ: 1.4.11 — وهو أكثر ما يُنسى ──
  { fg: '--rule-strong', bg: '--bg', min: 3.0, what: 'حدّ عنصرٍ تفاعليٍّ على أرضيّة الصفحة' },
  { fg: '--rule-strong', bg: '--surface', min: 3.0, what: 'حدّ عنصرٍ تفاعليٍّ على اللوح' },
  { fg: '--brand', bg: '--surface', min: 3.0, what: 'حلقة التركيز على اللوح' },
  { fg: '--brand', bg: '--bg', min: 3.0, what: 'حلقة التركيز على أرضيّة الصفحة' },
  { fg: '--crit', bg: '--surface', min: 3.0, what: 'نقطة الحالة الحرجة على اللوح' },
  { fg: '--ok', bg: '--surface', min: 3.0, what: 'نقطة الحالة السليمة على اللوح' },
];

const THEMES: Array<{ name: string; block: () => string }> = [
  { name: 'فاتح', block: lightBlock },
  { name: 'داكن', block: darkBlock },
];

describe('التباين — محسوبٌ من التوكِنات لا مكتوبٌ في وثيقة', () => {
  it('الكتلتان موجودتان وفيهما توكِنات', () => {
    for (const t of THEMES) {
      expect(t.block().length, `كتلة ${t.name} فارغة`).toBeGreaterThan(100);
      expect(token(t.block(), '--brand'), `--brand مفقودٌ في ${t.name}`).toBeTruthy();
    }
  });

  it.each(THEMES.map((t) => t.name))('كلّ الأزواج تحقّق حدّها في الثيم %s', (name) => {
    const block = THEMES.find((t) => t.name === name)!.block();
    const failures: string[] = [];

    for (const p of PAIRS) {
      const fg = token(block, p.fg);
      const bg = token(block, p.bg);
      if (!fg || !bg) {
        failures.push(`${p.what}: توكِنٌ مفقود (${!fg ? p.fg : p.bg})`);
        continue;
      }
      const r = ratio(fg, bg);
      if (r < p.min) {
        failures.push(
          `${p.what} — ${p.fg} على ${p.bg} = ${r.toFixed(2)}:1 (المطلوب ${p.min})`,
        );
      }
    }

    expect(
      failures,
      'نِسَبٌ محسوبةٌ من التوكِنات نفسها. عدّل القيمة في globals.css — '
      + 'ولا تُخفّض الحدّ هنا: الحدّ مطلبُ WCAG لا تفضيل.',
    ).toEqual([]);
  });

  it('★ لا لونٌ مثبَّتٌ للنصّ فوق تعبئةٍ ملوّنة — الحبر توكِنٌ ينقلب', () => {
    /* `color: #fff` على زرٍّ ملوّن هو بالضبط العطل الذي وُلد منه هذا الملفّ:
       يُقرأ سليماً في الفاتح ويسقط إلى 2.94:1 في الداكن. */
    const hard = [...CSS.matchAll(/^\s*\.(btn|pill|bdg|tab-b)[^{]*\{[^}]*color:\s*(#[0-9a-f]{3,6}|white)/gim)]
      .map((m) => m[0].trim().slice(0, 90));
    expect(hard, 'استعمل --signal-on أو --status-on بدل لونٍ مثبَّت').toEqual([]);
  });

  it('★ كتلتا الداكن متطابقتان — والتباعد بينهما يقع فعلاً', () => {
    /* وقع هذا للتوّ: حُدِّثت كتلة `@media` ولم تُحدَّث `[data-theme='dark']`
       لاختلاف المسافة البادئة وحده. والأثر خبيث: من يترك إعداده على «اتبع
       النظام» يرى الثيم الجديد، ومن يضغط «داكن» صراحةً يرى القديم — وهما
       نفس الشاشة. */
    const norm = (b: string) => [...b.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
      .map((m) => `${m[1]}:${m[2]!.trim()}`).sort().join(' | ');

    const media = CSS.slice(
      CSS.indexOf("@media (prefers-color-scheme: dark)"),
      CSS.indexOf('color-scheme: dark;', CSS.indexOf('@media (prefers-color-scheme: dark)')),
    );
    expect(
      norm(darkBlock()),
      'كتلتا الداكن تباعدتا: «اتبع النظام» و«داكن» يعرضان ثيمَين مختلفَين.',
    ).toBe(norm(media));
  });

  it('الحاسبة صحيحة — وإلّا فالاختبار يقيس نفسه لا التصميم', () => {
    // قيمٌ مرجعيّة معروفة
    expect(ratio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // ★ الرقم الذي كشف العطل: أبيض على --brand الداكن
    expect(ratio('#ffffff', '#38a3bd')).toBeCloseTo(2.94, 2);
  });
});
