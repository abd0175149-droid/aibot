import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★ **حرّاسُ لغة الواجهة — حتّى لا يعود النصُّ الطويل والمصطلحُ التقنيّ.**
 *
 *   قِيست الواجهةُ قبل التنظيف (٢٦ أيلول ٢٠٢٦): ٥٨ ألف حرفٍ عربيّ، ٩٪ منها
 *   تشكيل، و«نافذة/نوافذ» ١١٢ مرّة، و«المسوّدة» ٣٤، وعنوانٌ فرعيٌّ من ثلاثة أسطر.
 *   صاحبُ المطعم يقرأ الشاشة ثلاثين ثانيةً وسط الخدمة — فالحرّاسُ تقيس ما يراه هو.
 *
 *   والمقاسُ **الكودُ وحده** بعد نزع التعليقات: الشروحُ في التعليقات للمطوّر وتبقى.
 */
const SRC = join(__dirname, '..', 'src');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
});
const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** شاشاتُ العميل ومكوّناتُها — ولوحةُ المالك خارجها: مصطلحاتُ النظام لها. */
const CLIENT = [...walk(join(SRC, 'app', 'app')), ...walk(join(SRC, 'components'))];
const ALL = walk(SRC);

describe('مصطلحاتُ الزبون في شاشات العميل', () => {
  it('الحارسُ يقرأ ملفّاتٍ فعلاً — وإلّا مرّ على الفراغ', () => {
    expect(CLIENT.length).toBeGreaterThan(40);
  });

  it('★ لا «الساحة» ولا «المسوّدة»', () => {
    const bad = CLIENT.filter((p) => /الساحة|المسوّدة|مسوّدة/.test(code(p))).map((p) => p.slice(SRC.length));
    expect(bad, '«جرّب بوتك» و«التعديلات غير المنشورة»').toEqual([]);
  });

  it('★ و«نافذة» لا تعني وحدةَ الفوترة — بل «محادثة محسوبة»', () => {
    const bad = CLIENT.flatMap((p) => (code(p).match(/[^\n]*(نوافذ|نافذة مفوترة|النافذة الواحدة|للنافذة)[^\n]*/g) ?? [])
      .map((l) => `${p.slice(SRC.length)}: ${l.trim().slice(0, 90)}`));
    expect(bad).toEqual([]);
  });

  it('★ ولا «مفوترة/فوترت/لم تفوتر» ولا «نافذتين» — المفردُ فات الحارسَ الأوّل', () => {
    const bad = CLIENT.flatMap((p) => (code(p).match(/[^\n]*(مفوتر|فوترت|تفوتر|نافذتين)[^\n]*/g) ?? [])
      .map((l) => `${p.slice(SRC.length)}: ${l.trim().slice(0, 90)}`));
    expect(bad, '«محسوبة» و«غير محسوبة»').toEqual([]);
  });
});

describe('نصٌّ أخفّ', () => {
  it('★ لا «اضغط أيّ صفّ» — الصفُّ القابلُ للضغط يُعلن عن نفسه', () => {
    const bad = CLIENT.filter((p) => /اضغط أيّ صفّ/.test(code(p))).map((p) => p.slice(SRC.length));
    expect(bad).toEqual([]);
  });

  it('★★ ولا عددٌ مكتوبٌ قبل مثنّى — «2 يومان» و«2 محادثتان»', () => {
    /* المثنّى يحمل عددَه؛ فكتابةُ الرقم قبله خطأٌ يُرى. `Count` يُسقطه. */
    const bad = CLIENT.flatMap((p) => (code(p).match(/<\/span>\s*(\{' '\})?\s*\{plural\(/g) ?? [])
      .map(() => p.slice(SRC.length)));
    expect(bad).toEqual([]);
  });

  it('★ التشكيلُ أقلّ من ٢٪ من الحروف — كان ٩٪', () => {
    let letters = 0; let marks = 0;
    for (const p of ALL) {
      const s = code(p);
      letters += (s.match(/[ء-ي]/g) ?? []).length;
      marks += (s.match(/[ً-ِْ]/g) ?? []).length;
    }
    expect(letters).toBeGreaterThan(20_000);
    expect(marks / letters).toBeLessThan(0.02);
  });

  it('★ وعنوانُ كلّ شاشةٍ الفرعيُّ سطرٌ واحد (٩٠ حرفاً على الأكثر)', () => {
    const long = CLIENT.flatMap((p) => [...code(p).matchAll(/<PageHead[\s\S]*?sub="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((s) => s.length > 90)
      .map((s) => `${p.slice(SRC.length)}: ${s.length} — ${s.slice(0, 50)}…`));
    expect(long).toEqual([]);
  });
});
