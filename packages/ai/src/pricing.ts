import type { ModelUsage } from './types.js';

/**
 * التسعير **لحظة العرض** من جدول `prices` — فتصحيح سعرٍ يصحّح التاريخ كلّه.
 * هذه القيم بذرةٌ أوّليّة تُكتب في الجدول، ولا تُستعمل في الحساب مباشرةً.
 *
 * ⚠️ أسعار المزوّدين تتغيّر أسرع من أيّ شيءٍ آخر في هذه المنصّة.
 *    راجعها في وثائق جوجل قبل تثبيت أيّ سعرٍ لعميل.
 *    القياس الحقيقيّ من الإنتاج: ‎$0.10 لكلّ مليون توكن إدخال (بعد خصم الكاش).
 */
export const SEED_PRICES: Array<{
  provider: string; model: string; input: number; output: number; cachedInput: number | null;
}> = [
  { provider: 'google', model: 'gemini-2.5-flash',      input: 0.30, output: 2.50, cachedInput: 0.075 },
  { provider: 'google', model: 'gemini-2.5-flash-lite', input: 0.10, output: 0.40, cachedInput: 0.025 },
  { provider: 'google', model: 'gemini-2.5-pro',        input: 1.25, output: 10.00, cachedInput: 0.3125 },
  { provider: 'google', model: 'gemini-embedding-001',  input: 0.15, output: 0.00, cachedInput: null },
];

export interface PriceRow {
  input: number;      // $ لكلّ مليون توكن
  output: number;
  cachedInput: number | null;
}

/**
 * الكلفة بالدولار.
 * التوكنز المخزَّنة في الكاش تُحسب بسعرها المخفَّض وتُطرح من توكنز الإدخال —
 * وهذا ما يجعل ترتيب الطبقات في `assembleContext` مرئيّاً في الفاتورة.
 */
export function computeCost(usage: ModelUsage, price: PriceRow): number {
  const M = 1_000_000;
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const fresh = Math.max(0, usage.promptTokens - cached);
  const inCost = (fresh / M) * price.input + (cached / M) * (price.cachedInput ?? price.input);
  const outCost = ((usage.outputTokens + usage.thoughtsTokens) / M) * price.output;
  return round6(inCost + outCost);
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** نسبة كلفة الإدخال — المؤشّر الذي تدور حوله كلّ قرارات المعرفة. */
export function inputShare(usage: ModelUsage, price: PriceRow): number {
  const total = computeCost(usage, price);
  if (total === 0) return 0;
  const M = 1_000_000;
  const outCost = ((usage.outputTokens + usage.thoughtsTokens) / M) * price.output;
  return round6((total - outCost) / total);
}
