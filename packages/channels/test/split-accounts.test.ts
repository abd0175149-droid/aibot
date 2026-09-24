import { describe, it, expect } from 'vitest';
import { getAdapter } from '../src/index.js';

/**
 * ★ العطل الذي وُلد منه هذا الملفّ: ويبهوكُ تطبيق المنصّة على إنستجرام واحدٌ
 *   لكلّ الحسابات، و`resolveKey` يقرأ `entry[0]` وحده بينما `parseWebhook`
 *   يجمع رسائل **كلّ** الحسابات في حمولةٍ واحدة تُدفع تحت المستأجر الأوّل.
 *   فدفعةٌ تحمل حسابَين لمستأجرَين تكتب رسائل زبائن أحدهما في إنبوكس الآخر.
 *
 *   ولا يظهر هذا إلّا يوم يُربط الحساب الثاني — أي يوم يصير للمنصّة عميلان
 *   على إنستجرام. فالاختبار هو الطريق الوحيد لرؤيته قبل ذلك اليوم.
 */
describe('حمولةُ إنستجرام تُجزَّأ بحسابها قبل حلّ المستأجر', () => {
  const ig = getAdapter('instagram');
  const payload = {
    object: 'instagram',
    entry: [
      { id: 'ACC_A', time: 1, messaging: [{ sender: { id: 'u1' }, recipient: { id: 'ACC_A' }, timestamp: 1, message: { mid: 'm1', text: 'مرحبا' } }] },
      { id: 'ACC_B', time: 2, messaging: [{ sender: { id: 'u2' }, recipient: { id: 'ACC_B' }, timestamp: 2, message: { mid: 'm2', text: 'أهلاً' } }] },
    ],
  };

  it('حسابان ⟶ جزآن، ولكلٍّ مفتاحُ حسابه', () => {
    const parts = ig.splitByAccount!(payload);
    expect(parts).toHaveLength(2);
    const keys = parts.map((p) => ig.resolveKey({ headers: {}, rawBody: Buffer.alloc(0), body: p }));
    expect(keys.map((k) => (k as { externalId: string }).externalId)).toEqual(['ACC_A', 'ACC_B']);
  });

  it('★ ولا تختلط الرسائل: كلُّ جزءٍ يحمل رسائل حسابه وحده', () => {
    const parts = ig.splitByAccount!(payload);
    const a = ig.parseWebhook(parts[0]);
    const b = ig.parseWebhook(parts[1]);
    expect(a.messages.map((m) => m.externalId)).toEqual(['m1']);
    expect(b.messages.map((m) => m.externalId)).toEqual(['m2']);
  });

  it('وقبل التجزئة كانتا تُجمَعان في حمولةٍ واحدة — وهو العطل بعينه', () => {
    const both = ig.parseWebhook(payload);
    expect(both.messages).toHaveLength(2);
  });

  it('حسابٌ واحدٌ لا يُجزَّأ — ولا تكلفةَ على الحالة الغالبة', () => {
    const one = { object: 'instagram', entry: [payload.entry[0]] };
    expect(ig.splitByAccount!(one)).toEqual([one]);
    expect(ig.splitByAccount!({})).toEqual([{}]);
  });

  it('واتساب لا يحتاج تجزئة — المستأجر من المسار لا من الحمولة', () => {
    expect(getAdapter('whatsapp_cloud').splitByAccount).toBeUndefined();
  });
});
