import { prices, aiKeys, eq, and, desc, sql, type Tx, lte} from '@aibot/db';
import { open as decrypt } from '@aibot/crypto';
import { AiError } from '@aibot/ai';

/**
 * ★ حلُّ المفتاح والسعر — **موضعٌ واحدٌ للحيّ وللساحة معاً**.
 *
 *   كانت الكتلتان منسوختَين حرفيّاً في `reply.ts` و`playground.ts`، وفيهما
 *   عطلٌ واحدٌ في النسختين: اختيارُ السعر يأخذ أحدثَ `effective_from` **مطلقاً**
 *   بلا شرطٍ على الحاضر. فصفُّ سعرٍ أُدخل بتاريخ سريانٍ لاحق — وهو ما صُمّم له
 *   الفهرس الفريد — يُطبَّق **فوراً**: كلفةُ اليوم تُحسب بسعر الغد، والهامشُ في
 *   التقارير خاطئٌ بلا أن يلاحظ أحد.
 *
 *   ونسختان لقرارٍ واحد تعنيان أنّ تصحيح إحداهما لا يصل الأخرى: تُصحَّح كلفةُ
 *   الحيّ وتبقى الساحةُ تشهد على كلفةٍ غير التي تُحاسَب — وهي الشاشة التي
 *   بُنيت ليثق بها المالك.
 */

/** مفتاحُ الذكاء: مفتاح العميل أوّلاً، ثمّ مفتاح المنصّة. */
export async function resolveAiKey(
  tx: Tx,
  tenantId: string,
  provider: string,
): Promise<{ apiKey: string; owner: 'tenant' | 'platform' } | null> {
  const row = (await tx.select().from(aiKeys).where(and(
    eq(aiKeys.tenantId, tenantId),
    eq(aiKeys.provider, provider),
    eq(aiKeys.isActive, true),
  )).limit(1))[0];

  if (row) return { apiKey: decrypt(row.keyEnc, row.keyVersion), owner: 'tenant' };

  /* ولا `!` هنا: غيابُ مفتاح المنصّة حالةٌ تُقال لا تُفترض. كان الحيّ يكتب
     `process.env.PLATFORM_AI_KEY!` فيمرّر `undefined` إلى المزوّد ويُردّ 401
     أربع مرّات — والسببُ إعدادٌ غائبٌ كان يُعرف عند الإقلاع. */
  const platform = process.env.PLATFORM_AI_KEY;
  return platform ? { apiKey: platform, owner: 'platform' } : null;
}

export interface PriceRow { input: number; output: number; cachedInput: number | null }

/**
 * سعرُ النموذج **السارِي في لحظةٍ بعينها**.
 * `at` وسيطٌ لا `now()` مباشرةً: إعادةُ تسعيرٍ بأثرٍ رجعيّ تسأل عن سعرِ
 * لحظةِ الشوط لا عن سعر اليوم.
 */
export async function priceAt(
  tx: Tx,
  provider: string,
  model: string,
  at: Date = new Date(),
): Promise<PriceRow | null> {
  const row = (await tx.select().from(prices).where(and(
    eq(prices.provider, provider),
    eq(prices.model, model),
    /* 🔴 **`lte()` لا `sql` خامّة** — وهذا هو العطلُ نفسُه الذي أسقط الردّ.
       قالبُ `sql` يُمرّر كائن `Date` معاملاً خامّاً إلى postgres.js، وهو يطلب
       نصّاً أو Buffer فيرمي «Received an instance of Date». والنداءُ يقع
       **بعد** نداء النموذج في مسار الردّ: فالكلفةُ تُدفع للمزوّد ثمّ تتراجع
       المعاملة، فلا صفَّ `ai_runs` ولا ردَّ للزبون — إنفاقٌ بلا أثرٍ ولا نتيجة. */
    lte(prices.effectiveFrom, at),
  )).orderBy(desc(prices.effectiveFrom)).limit(1))[0];

  return row
    ? {
      input: Number(row.input),
      output: Number(row.output),
      cachedInput: row.cachedInput === null ? null : Number(row.cachedInput),
    }
    : null;
}

/**
 * ★★ **مفتاحُ المنصّة للتضمين — والغيابُ يُقال لا يُمرَّر.**
 *
 *   التضمينُ دائماً على حساب المنصّة لا العميل (نموذجٌ واحدٌ لكلّ المستأجرين،
 *   وأبعادٌ ثابتةٌ في المخطّط)، فلا يمرّ من `resolveAiKey`. وكان يُقرأ في
 *   موضعَين بـ`process.env.PLATFORM_AI_KEY!`: علامةُ التعجّب تُخرس المدقّق
 *   وتُمرّر `undefined` إلى المزوّد، فيعود 401 بلا اسمِ سبب — والتشخيصُ يبدأ
 *   من «لماذا رفض جوجل مفتاحَنا؟» بدل «لا مفتاحَ مضبوط».
 *
 * ⚠️ و`retryable: false`: مفتاحٌ غائبٌ لا يُصلحه تكرارٌ، وإعادةُ المحاولة
 *    أربعَ مرّاتٍ على نقصِ إعدادٍ كلفةٌ بلا أمل. ومسارُ الردّ يقرأ هذا العلم.
 */
export function platformAiKey(): string {
  const k = process.env.PLATFORM_AI_KEY;
  if (!k) {
    throw new AiError(
      'NO_KEY',
      'مفتاحُ المنصّة للتضمين (PLATFORM_AI_KEY) غير مضبوط — لا استرجاعَ ولا تضمين',
      false,
    );
  }
  return k;
}
