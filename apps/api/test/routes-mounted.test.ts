import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ **كلّ مُسجِّلِ مساراتٍ مُركَّبٌ فعلاً** — حارسٌ ساكنٌ على نفس نمط
 *   `db-context.test.ts`.
 *
 * العطل الذي وُلد منه هذا الملفّ عطلُ دمجٍ لا عطلُ كتابة: بعد عملٍ متوازٍ
 * رباعيٍّ على `main.ts` وصل `registerPlayground` مستورَداً في أعلى الملفّ
 * و**غائباً عن كتلة `app.register`**. والنتيجة أنّ شاشةَ الساحة كاملةً —
 * وطابورَ `bot-dry` وراءها — تردّ 404 على كلّ نقطة: `GET /playground` و
 * `POST /playground/run` و`POST /playground/knowledge`.
 *
 * ولم يمسكه شيء، وهذا هو بيت القصيد:
 *  · `tsc` لا يشكو: الاستيراد **مستعمَل** في نظر المدقّق (اسمٌ مُقيَّد)،
 *    و`noUnusedLocals` لا يُنقذ لأنّ السطر ليس غير مستعمَلٍ نحويّاً —
 *    بل غيرُ **مُنادى**.
 *  · اختبارات المسارات ساكنةٌ كلُّها: تقرأ `routes/playground.ts` وتتحقّق
 *    من شكله، وهو سليمٌ تماماً — الناقصُ سطرٌ في ملفٍّ آخر.
 *  · و`next build` يبني الواجهة خضراءَ لأنّ الشاشةَ تُصرَّف بلا خادم.
 *
 * أي أنّ كلّ بوّابةٍ في المشروع كانت خضراءَ على ميزةٍ لا تعمل إطلاقاً — وهو
 * بالضبط شكلُ العطل الذي بُنيت له حرّاسُ هذا المستودع.
 *
 * والفحصُ اتّجاهان لا اتّجاهٌ واحد: مُسجِّلٌ يُكتب ولا يُركَّب (ميزةٌ ميّتة)،
 * ومُسجِّلٌ يُركَّب مرّتين (فـFastify يرمي عند أوّل مسارٍ مكرَّر، فيسقط
 * الخادمُ كلُّه عند الإقلاع لا مسارٌ واحد).
 */
const MAIN = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
const ROUTES_DIR = join(__dirname, '..', 'src', 'routes');

/** أسماءُ `registerX` المصدَّرة من كلّ ملفٍّ في `routes/`. */
const exported = readdirSync(ROUTES_DIR)
  .filter((f) => f.endsWith('.ts'))
  .flatMap((f) => {
    const src = readFileSync(join(ROUTES_DIR, f), 'utf8');
    return [...src.matchAll(/export\s+(?:async\s+)?function\s+(register\w+)/g)]
      .map((m) => ({ name: m[1]!, file: `routes/${f}` }));
  });

/** نداءاتُ `registerX(` في `main.ts` — لا الاستيرادات. */
function callsIn(src: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*import\b/.test(line)) continue;
    for (const m of line.matchAll(/\b(register\w+)\s*\(/g)) {
      out.set(m[1]!, (out.get(m[1]!) ?? 0) + 1);
    }
  }
  return out;
}

describe('تركيبُ المسارات — مُسجِّلٌ مستورَدٌ ليس مُسجِّلاً مُركَّباً', () => {
  it('يوجد مُسجِّلاتٌ تُفحص — وإلّا فالاختبار يمرّ على الفراغ', () => {
    expect(exported.length).toBeGreaterThan(3);
  });

  it('كلّ مُسجِّلٍ مصدَّرٍ من routes/ مُنادىً في main.ts', () => {
    const calls = callsIn(MAIN);
    const orphan = exported
      .filter(({ name }) => !calls.has(name))
      .map(({ name, file }) => `${name} (${file})`);

    expect(
      orphan,
      'مُسجِّلُ مساراتٍ مكتوبٌ ولا يُركَّب: كلُّ نقطةٍ فيه تردّ 404 بينما '
      + 'tsc واختباراتُه الساكنة خضراء. أضِف «await <اسمه>(api);» في كتلة '
      + 'app.register داخل main.ts.',
    ).toEqual([]);
  });

  it('ولا مُسجِّلٌ مُركَّبٌ مرّتين — فالمسارُ المكرَّر يُسقط الإقلاع كلَّه', () => {
    const twice = [...callsIn(MAIN)].filter(([, n]) => n > 1).map(([name]) => name);
    expect(
      twice,
      'Fastify يرمي عند تسجيل مسارٍ مكرَّر، فيموت الخادمُ عند الإقلاع.',
    ).toEqual([]);
  });

  it('الماسح يمسك الشكل فعلاً — وإلّا فهو طمأنينةٌ كاذبة', () => {
    // الاستيرادُ وحده لا يُحتسب نداءً: هذا هو العطل بعينه
    expect(callsIn("import { registerX } from './routes/x.js';").has('registerX')).toBe(false);
    expect(callsIn('  await registerX(api);').get('registerX')).toBe(1);
    expect(callsIn('  await registerX(api);\n  await registerX(api);').get('registerX')).toBe(2);
    // ويرى المُسجِّلات الحقيقيّة في المستودع
    expect(exported.map((e) => e.name)).toContain('registerPlayground');
    expect(exported.map((e) => e.name)).toContain('registerTeam');
  });
});
