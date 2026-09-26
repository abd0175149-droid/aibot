import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_PRICES, computeCost, inputShare } from '../src/pricing';
import { BOT_SCREEN, BOT_SCREEN_ABS, readBotScreen } from '../../../test-support/bot-screen';

/**
 * ★ العطل الذي وُلد منه هذا الملفّ: نسخةُ بوتٍ نُشرت على نموذجٍ لا صفَّ سعرٍ
 *   له، فكتب العامل `cost_usd = 0` في كلّ شوطٍ **بلا خطأ**. والصفر أخطر من
 *   الخطأ: التقارير تُظهر هامشاً كاملاً عن نموذجٍ يُكلّفك فعلاً، ومع كلّ ردٍّ
 *   تُرفَع حادثةٌ فتغرق شاشة الحوادث. تسعةُ أشواطٍ على الخادم بهذا الشكل.
 *
 * وحارسان هنا: الصيغةُ نفسها (فتصحيح سعرٍ يجب أن يُغيّر رقماً)، و**التغطية**:
 * كلُّ نموذجٍ تعرضه الواجهة للعميل يجب أن يكون في `SEED_PRICES`. فزرٌّ يعرض
 * نموذجاً غير مسعَّر هو ذاك العطل بعينه، معروضاً بيدٍ واحدةٍ على العميل.
 */

const M = 1_000_000;
const zero = { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0 };

describe('تسعير النماذج — صيغةُ الكلفة', () => {
  it('مليون إدخالٍ ومليون إخراج = سعرُ الصفّ حرفيّاً', () => {
    const price = { input: 0.30, output: 2.50, cachedInput: 0.03 };
    const cost = computeCost({ ...zero, promptTokens: M, outputTokens: M, totalTokens: 2 * M }, price);
    expect(cost).toBe(2.80);
  });

  it('التوكنز المخزَّنة تُحسب بسعرها المخفَّض وتُطرح من الإدخال', () => {
    const price = { input: 0.30, output: 2.50, cachedInput: 0.03 };
    // نصفُ الإدخال من الكاش: 0.5×0.30 + 0.5×0.03 = 0.165
    const cost = computeCost({ ...zero, promptTokens: M, cachedTokens: M / 2, totalTokens: M }, price);
    expect(cost).toBe(0.165);
  });

  it('توكنز التفكير تُفوتَر بسعر الإخراج — فلا تُنسى من الحساب', () => {
    const price = { input: 0.30, output: 2.50, cachedInput: 0.03 };
    const withThoughts = computeCost({ ...zero, thoughtsTokens: M, totalTokens: M }, price);
    expect(withThoughts).toBe(2.50);
  });

  it('كاشٌ بلا سعرٍ مخفَّض يُحسب بسعر الإدخال لا بصفر', () => {
    const price = { input: 0.30, output: 0, cachedInput: null };
    const cost = computeCost({ ...zero, promptTokens: M, cachedTokens: M, totalTokens: M }, price);
    expect(cost).toBe(0.30);
  });

  it('كاشٌ أكبرُ من الإدخال لا يُنتج كلفةً سالبة', () => {
    const price = { input: 0.30, output: 2.50, cachedInput: 0.03 };
    const cost = computeCost({ ...zero, promptTokens: 1000, cachedTokens: 9_000_000, totalTokens: 1000 }, price);
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it('نسبةُ الإدخال صفرٌ حين لا كلفة — لا قسمةٌ على صفر', () => {
    expect(inputShare(zero, { input: 0.30, output: 2.50, cachedInput: 0.03 })).toBe(0);
  });
});

describe('تسعير النماذج — التغطية', () => {
  it('لا صفَّ سعرٍ مكرَّر لنفس (مزوّد، نموذج)', () => {
    const keys = SEED_PRICES.map((p) => `${p.provider}:${p.model}`);
    expect(keys).toHaveLength(new Set(keys).size);
  });

  it('كلُّ سعرٍ رقمٌ موجب (والإخراج قد يكون صفراً للتضمين وحده)', () => {
    for (const p of SEED_PRICES) {
      expect(p.input, p.model).toBeGreaterThan(0);
      expect(p.output, p.model).toBeGreaterThanOrEqual(0);
      if (p.cachedInput !== null) expect(p.cachedInput, p.model).toBeGreaterThan(0);
    }
  });

  it('gemini-3.5-flash-lite مسعَّرٌ — وهو النموذج الذي كان بلا سعرٍ على الخادم', () => {
    const row = SEED_PRICES.find((p) => p.model === 'gemini-3.5-flash-lite');
    // الأرقام مُراجَعةٌ في 2026-09-23 من ai.google.dev ومصدرَين مستقلَّين،
    // ومكتوبةٌ في packages/db/migrations/0005_price_gemini_3_5_flash_lite.sql
    expect(row).toEqual({
      provider: 'google', model: 'gemini-3.5-flash-lite',
      input: 0.30, output: 2.50, cachedInput: 0.03,
    });
  });

  /**
   * ★ الحارس الذي يمنع تكرار العطل: النماذج المعروضة في شاشة البوت تُقرأ من
   *   المصدر ساكناً — لا استيرادَ من `apps/web` (فهي لا تعتمد هذه الحزمة
   *   عمداً كي لا تُسحب `crypto` و`dns` إلى حزمة المتصفّح).
   */
  it('كلُّ نموذجٍ تعرضه شاشة البوت للعميل له صفُّ سعر', () => {
    const src = readBotScreen();
    const block = /const MODEL: Record<string, string> = \{([\s\S]*?)\};/.exec(src);
    expect(block, 'تغيّر شكل خريطة MODEL في apps/web/src/app/app/bot/page.tsx — حدِّث هذا الحارس').toBeTruthy();

    const offered = [...block![1]!.matchAll(/'([^']+)':/g)].map((m) => m[1]!);
    // لو صار الاستخراج لا يجد شيئاً لصار الاختبار طمأنينةً كاذبة
    expect(offered.length).toBeGreaterThan(0);

    const priced = new Set(SEED_PRICES.map((p) => p.model));
    expect(
      offered.filter((m) => !priced.has(m)),
      'نموذجٌ معروضٌ على العميل بلا صفّ سعر: كلفةُ كلّ ردٍّ ستُحسب صفراً بصمت. '
      + 'أضِفه إلى SEED_PRICES وإلى ترحيلٍ في packages/db/migrations بسعرٍ مُراجَعٍ من المزوّد.',
    ).toEqual([]);
  });
});
