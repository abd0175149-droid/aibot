import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ حرّاسُ السعر — **موضعٌ واحدٌ، وشرطُ سريانٍ لا يُنسى**.
 *
 * العطل الأصليّ اثنان في واحد: كتلتا حلِّ المفتاح والسعر منسوختان حرفيّاً بين
 * الحيّ (`reply.ts`) والساحة (`playground.ts`)، وفي كلتيهما يُختار السعرُ
 * بأحدث `effective_from` **مطلقاً** بلا شرطٍ على الحاضر. فصفُّ سعرٍ يُدخل
 * بتاريخ سريانٍ لاحق — وهو ما صُمّم له الفهرس الفريد — يُطبَّق فوراً: كلفةُ
 * اليوم بسعر الغد، والهامشُ خاطئٌ في التقارير بلا أن يلاحظ أحد.
 *
 * والحرّاس ساكنون عمداً: كلُّ ما يُحرَس هنا **شكلٌ** — استعلامٌ في موضعٍ لا
 * ينبغي أن يكون فيه، أو شرطٌ غائبٌ من الاستعلام الوحيد.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const CONSUMERS = [
  'apps/worker/src/reply.ts',
  'apps/worker/src/playground.ts',
];

/**
 * ★ ملفّاتٌ تقرأ مفتاحَ **المنصّة** للتضمين — لا مفتاحَ المستأجر.
 *
 *   لا تمرّ من `resolveAiKey` (التضمينُ دائماً على حساب المنصّة)، فبقيت
 *   خارج `CONSUMERS` أعلاه — ولهذا نجا فيها `process.env.PLATFORM_AI_KEY!`
 *   بينما الحارسُ أخضرُ منذ دفعات. و`retrieval.ts` على **مسار الردّ الساخن**:
 *   `embedQuery` تُنادى لكلّ ردٍّ فيه استرجاع.
 */
const PLATFORM_KEY_USERS = [
  'apps/worker/src/embed.ts',
  'apps/worker/src/retrieval.ts',
];

describe('السعرُ يُقرأ من موضعٍ واحد', () => {
  it('لا استعلامَ أسعارٍ خارج pricing.ts', () => {
    for (const rel of CONSUMERS) {
      expect(
        read(rel),
        `${rel} يستعلم جدولَ الأسعار بنفسه. ونسختان لقرارٍ واحدٍ تعنيان أنّ `
        + 'تصحيح كلفةِ الحيّ لا يصل الساحة — فتشهد الساحةُ على كلفةٍ غيرِ التي تُحاسَب.',
      ).not.toMatch(/from\(prices\)/);
    }
  });

  it('لا قراءةَ مفتاحِ ذكاءٍ خارج pricing.ts', () => {
    for (const rel of CONSUMERS) {
      expect(read(rel), `${rel} يقرأ جدولَ المفاتيح بنفسه`).not.toMatch(/from\(aiKeys\)/);
    }
  });

  it('★ ولا `PLATFORM_AI_KEY!` في أيٍّ منهما — الغيابُ يُقال لا يُمرَّر', () => {
    for (const rel of CONSUMERS) {
      expect(read(rel), `${rel} يمرّر مفتاحاً قد يكون undefined إلى المزوّد`)
        .not.toMatch(/PLATFORM_AI_KEY/);
    }
  });

  it('★★ ولا في قارئي مفتاحِ المنصّة — وهما اللذان أفلتا', () => {
    /* 🔴 علامةُ التعجّب تُخرس المدقّق وتُمرّر `undefined` إلى المزوّد، فيعود
       401 بلا اسمِ سبب. وفي `retrieval.ts` هذا على مسار الردّ الساخن. */
    for (const rel of PLATFORM_KEY_USERS) {
      expect(read(rel), `${rel} يمرّر مفتاحاً قد يكون undefined إلى المزوّد`)
        .not.toMatch(/process\.env\.PLATFORM_AI_KEY!/);
      expect(read(rel), `${rel} لا يمرّ من الموضع الواحد`).toContain('platformAiKey()');
    }
  });

  it('والاثنان ينادِيان الدالّتين المشتركتَين فعلاً', () => {
    for (const rel of CONSUMERS) {
      const src = read(rel);
      expect(src, `${rel} لا ينادي resolveAiKey`).toMatch(/resolveAiKey\(/);
      expect(src, `${rel} لا ينادي priceAt`).toMatch(/priceAt\(/);
      expect(src).toMatch(/from '\.\/pricing\.js'/);
    }
  });
});

describe('السعرُ المختار ساريٌ الآن', () => {
  const src = read('apps/worker/src/pricing.ts');

  it('الاستعلامُ يشترط effectiveFrom <= at', () => {
    /* ★ الشكلُ تبدّل من قالب `sql` خامٍّ إلى مُعامِلٍ مطبوع، والشرطُ هو هو.
       والقالبُ الخامّ كان عطلاً: يُمرّر كائن `Date` إلى السائق فيرمي
       «Received an instance of Date» — **بعد** نداء النموذج، فتُدفع الكلفةُ
       ثمّ تتراجع المعاملةُ بلا صفِّ شوطٍ ولا ردّ. راجع `db-context.test.ts`. */
    expect(
      src,
      'بلا هذا الشرط يُطبَّق سعرٌ مستقبليٌّ فوراً — كلفةُ اليوم بسعر الغد',
    ).toMatch(/lte\(prices\.effectiveFrom,\s*at\)/);
  });

  it('ويأخذ الأحدثَ من السارية لا الأقدم', () => {
    expect(src).toMatch(/orderBy\(desc\(prices\.effectiveFrom\)\)/);
  });

  it('★ و`at` وسيطٌ لا now() مغروسةٌ — إعادةُ التسعير تسأل عن لحظة الشوط', () => {
    expect(src).toMatch(/at:\s*Date\s*=\s*new Date\(\)/);
  });
});
