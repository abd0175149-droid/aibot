import { describe, it, expect, afterEach } from 'vitest';
import { faultStatus, GoogleProvider, AiError } from '../src/index';

/**
 * حقن فشل المزوّد — مفتاح تمارين الفشل.
 *
 * ★ ولماذا يُختبر عبر `generate` لا عبر `faultStatus` وحدها: قيمةُ التمرين
 *   كلّها في أنّ الحقنة تدخل من **نفس باب** الردّ الحقيقيّ، فيُختبر تحويلُ
 *   الحالة إلى `AiError` وقرارُ «قابلٌ لإعادة المحاولة». حقنةٌ ترمي مباشرةً
 *   تختبر فرعاً موازياً لا وجود له في الإنتاج — وهذا الاختبار هو ما يمنع
 *   انحراف الحقنة إلى ذلك الشكل.
 *
 * ولا شبكةَ في أيٍّ من هذه الحالات: الحقنة تسبق `fetch` فلا نداءَ يخرج.
 */

const input = {
  system: 'نظام',
  contents: [{ role: 'user' as const, parts: [{ text: 'مرحبا' }] }],
  tools: [],
  model: 'gemini-3.5-flash-lite',
};

afterEach(() => { delete process.env.AI_FAULT_STATUS; });

describe('قراءة مفتاح الحقنة', () => {
  it('غيابُه يعني لا حقنة', () => {
    expect(faultStatus({})).toBeNull();
    expect(faultStatus({ AI_FAULT_STATUS: '' })).toBeNull();
  });

  it('أكوادُ الخطأ وحدها تُقبل — 400 إلى 599', () => {
    expect(faultStatus({ AI_FAULT_STATUS: '500' })).toBe(500);
    expect(faultStatus({ AI_FAULT_STATUS: '429' })).toBe(429);
    expect(faultStatus({ AI_FAULT_STATUS: '400' })).toBe(400);
    expect(faultStatus({ AI_FAULT_STATUS: '599' })).toBe(599);
  });

  it('★ قيمةٌ خاطئة تُهمَل ولا تُعطّل المزوّد — خطأٌ مطبعيٌّ في متغيّر بيئة ليس عطلاً', () => {
    for (const v of ['0', '200', '600', 'abc', '500.5', '-500', ' ']) {
      expect(faultStatus({ AI_FAULT_STATUS: v }), v).toBeNull();
    }
  });
});

describe('الحقنة تمرّ من نفس باب الردّ الحقيقيّ', () => {
  it('٥٠٠ ⟵ AiError **قابلٌ لإعادة المحاولة** بحالة 500', async () => {
    process.env.AI_FAULT_STATUS = '500';
    const err = await new GoogleProvider().generate(input, 'مفتاح-وهميّ')
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    const ai = err as AiError;
    expect(ai.status).toBe(500);
    expect(ai.retryable).toBe(true);
  });

  it('٤٢٩ قابلٌ لإعادة المحاولة أيضاً — حدُّ معدّلٍ لا عطلٌ دائم', async () => {
    process.env.AI_FAULT_STATUS = '429';
    const err = await new GoogleProvider().generate(input, 'مفتاح-وهميّ')
      .then(() => null, (e: unknown) => e) as AiError;
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(429);
  });

  it('★ ٤٠٠ **غيرُ** قابلٍ لإعادة المحاولة — إعادةُ طلبٍ مرفوضٍ كلفةٌ بلا أمل', async () => {
    process.env.AI_FAULT_STATUS = '400';
    const err = await new GoogleProvider().generate(input, 'مفتاح-وهميّ')
      .then(() => null, (e: unknown) => e) as AiError;
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(400);
  });

  it('والتضمين يمرّ من الباب نفسه — فتمرينٌ واحد يغطّي الطريقين', async () => {
    process.env.AI_FAULT_STATUS = '503';
    const err = await new GoogleProvider()
      .embed({ texts: ['نصّ'], model: 'gemini-embedding-001', taskType: 'RETRIEVAL_DOCUMENT' }, 'مفتاح-وهميّ')
      .then(() => null, (e: unknown) => e) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.retryable).toBe(true);
  });

  it('بلا حقنةٍ لا يُصنع ردٌّ — التضمين الفارغ يعود فارغاً بلا نداء', async () => {
    const out = await new GoogleProvider()
      .embed({ texts: [], model: 'gemini-embedding-001', taskType: 'RETRIEVAL_QUERY' }, 'مفتاح-وهميّ');
    expect(out).toEqual([]);
  });
});
