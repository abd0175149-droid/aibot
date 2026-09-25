import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../src/extract';

/**
 * ★★★ **ملفُّ عميلٍ يُحلَّل في نفس العمليّة التي تردّ على الزبائن.**
 *
 *   `xlsx@0.18.5` كانت آخرَ نسخةٍ على npm وعليها إنذاران معلَنان بلا إصلاحٍ
 *   هناك (`Patched versions: <0.0.0`): تلويثُ النموذج الأوّليّ (مُصلَح في
 *   0.19.3) وReDoS (مُصلَح في 0.20.2). و`^0.18.5` نطاقٌ **لا يصل الإصلاح
 *   أبداً**. والمُحلِّل يعمل في حاوية العامل نفسِها التي تحمل `bot-reply`
 *   و`ch-outbound`، بلا `mem_limit` وبلا أيّ سقفٍ على المدخَل.
 *
 *   والعلاجُ توزيعةُ المورّد الرسميّة 0.20.3 — **مُضمَّنةً في المستودع** لا
 *   مسحوبةً من CDN وقتَ البناء: `Dockerfile` يُثبّت داخل `node:22-alpine`
 *   بلا مرآةٍ ولا `.npmrc`، فرابطٌ خارجيٌّ في `package.json` يجعل انقطاعَ
 *   موقعِ طرفٍ ثالثٍ **يمنع كلَّ نشرة**. وبناءٌ يعتمد على شبكةٍ لا نملكها
 *   مقايضةٌ خاسرة في مستودعٍ بُنيت فيه بوّابتا نشرٍ وتراجعٌ مُثبَت.
 *
 * ⚠️ وهذا الملفّ **يُشغّل الشيفرة** لا يمسح نصَّها: السقوفُ سلوكٌ وقتَ التنفيذ،
 *    وحارسٌ ساكنٌ عليها يُثبت وجودَ سطرٍ لا أنّه يعمل. وعطلا اليوم (تاريخٌ خامٌّ
 *    في قالب `sql`) مرّا من ١٠٤٨ اختباراً ساكناً ثمّ سقطا عند أوّل تنفيذ.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');

describe('النسخةُ المستعمَلة هي المُصلَحة، ومن مصدرٍ نملكه', () => {
  const pkg = JSON.parse(read('apps/worker/package.json')) as {
    dependencies: Record<string, string>;
  };
  const spec = pkg.dependencies.xlsx ?? '';

  it('★ لا نطاقَ `^0.18` — وهو الذي لا يصل الإصلاح أبداً', () => {
    expect(spec).not.toMatch(/\^0\.18/);
  });

  it('★★ والمصدرُ ملفٌّ في المستودع لا رابطٌ يُسحب وقتَ البناء', () => {
    /* 🔴 رابطٌ خارجيّ يجعل انقطاعَ موقعِ طرفٍ ثالثٍ يمنع كلَّ نشرةٍ وكلَّ
       بناءِ صورة. والمستودعُ بلا `.npmrc` ولا مرآة. */
    expect(spec, 'مصدرُ xlsx ليس ملفّاً مُضمَّناً').toMatch(/^file:/);
    expect(spec).toContain('0.20.');
  });

  it('★ والملفُّ موجودٌ فعلاً — لا مرجعٌ إلى ما ليس هناك', () => {
    const rel = spec.replace(/^file:\.?\/?/, '');
    expect(existsSync(join(REPO, 'apps/worker', rel)),
      `المرجع ${spec} لا يشير إلى ملفٍّ قائم`).toBe(true);
  });

  it('★ ونسخةُ ما ثُبِّت فعلاً ‎>=0.20.2 — فالإنذاران مغطّيان', () => {
    /* 0.19.3 يُصلح تلويثَ النموذج الأوّليّ، و0.20.2 يُصلح الـReDoS. */
    const inst = JSON.parse(
      readFileSync(join(REPO, 'apps/worker/node_modules/xlsx/package.json'), 'utf8'),
    ) as { version: string };
    const [maj, min, pat] = inst.version.split('.').map(Number) as [number, number, number];
    expect(maj).toBe(0);
    expect(min * 1000 + pat, `المثبَّت ${inst.version} دون 0.20.2`).toBeGreaterThanOrEqual(20_002);
  });
});

/** يبني مصنَّفاً حقيقيّاً بالمدى المطلوب — بلا ملفّاتٍ ثابتةٍ في المستودع. */
async function workbook(rows: number, cols: number): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const aoa: unknown[][] = [];
  aoa.push(Array.from({ length: cols }, (_, c) => `ع${c}`));
  for (let r = 0; r < rows; r += 1) {
    aoa.push(Array.from({ length: cols }, (_, c) => `ق${r}_${c}`));
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'ورقة');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('★★ السقفُ يعمل فعلاً — تنفيذٌ لا مسحُ نصّ', () => {
  it('مصنَّفٌ عاديٌّ يُستخرج كما كان — لا انحدارَ في السلوك', async () => {
    const buf = await workbook(3, 3);
    const out = await extract(buf, XLSX_MIME);
    expect(out.text).toContain('# ورقة');
    /* الشكلُ «عمود: قيمة» لا CSV — صفٌّ مفصولٌ بفواصل يفقد معناه في التقطيع. */
    expect(out.text).toContain('ع0: ق0_0');
    expect(out.text).toContain(' · ');
  });

  it('★★★ ومصنَّفٌ فوق سقف الخلايا يُرفض **قبل** أن يُبنى صفٌّ واحد', async () => {
    /* 🔴 بلا هذا: جدولٌ بمليون خليّة يُجمّد الردَّ لكلّ زبونٍ حتّى يفرغ منه،
       أو يُنهي العمليّةَ بنفاد ذاكرةٍ فتسقط الطوابيرُ الثلاثة معاً. */
    const buf = await workbook(41_000, 5); // ‎>200_000 خليّة
    await expect(extract(buf, XLSX_MIME)).rejects.toThrow(/خليّة/);
  });

  it('★ والرسالةُ عربيّةٌ تقول ما يُفعل — لا رمزَ خطأٍ خامّ', async () => {
    /* تُعرَض للعميل حرفيّاً في شاشة الملفّات (`status: failed, error`). */
    const buf = await workbook(41_000, 5);
    await expect(extract(buf, XLSX_MIME)).rejects.toThrow(/قسّمه|احذف/);
  });

  it('★ ونوعُ الـMIME القديم (.xls) يمرّ من نفس السقف', () => {
    /* `extract` توجّه `application/vnd.ms-excel` إلى نفس الدالّة. */
    const src = read('apps/worker/src/extract.ts');
    expect(src).toContain("mime === 'application/vnd.ms-excel'");
    const at = src.indexOf('async function extractXlsx');
    expect(src.slice(at)).toContain('MAX_CELLS');
  });

  it('★★ والعدُّ من `!ref` قبل `sheet_to_json` — لا بعده', () => {
    /* فحصٌ بعد البناء فحصٌ بعد فوات الأوان: المصفوفةُ الناتجة هي نفسُها ما
       نخشى حجمَه. */
    const src = read('apps/worker/src/extract.ts');
    const at = src.indexOf('async function extractXlsx');
    const body = src.slice(at);
    expect(body.indexOf("'!ref'")).toBeGreaterThan(0);
    expect(body.indexOf("'!ref'"), 'العدُّ بعد التحويل')
      .toBeLessThan(body.indexOf('sheet_to_json'));
  });

  it('★ ولا مهلةَ زمنيّةٌ كاذبةٌ حول تحليلٍ متزامن', () => {
    /* `XLSX.read` متزامنة، فحلقةٌ ساخنة داخلها لا تُفسح للمؤقّت — و
       `Promise.race` حولها راحةٌ كاذبةٌ تُقاس بعد أن يتجمّد الحدثُ فعلاً. */
    const src = read('apps/worker/src/extract.ts');
    /* ⚠️ التعليقاتُ تُعمّى: الملفُّ يشرح **لماذا** لا مهلةَ هناك بذكر اسمها،
       فبلا تعمية يمسك الحارسُ شرحَه ويُبلّغ عن نفسه. */
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(bare).not.toMatch(/Promise\.race/);
    expect(src, 'السببُ غيرُ مكتوب فيُضاف غداً').toContain('راحةٌ كاذبة');
  });
});
