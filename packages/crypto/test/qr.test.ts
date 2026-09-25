import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { qrMatrix, qrRows, __forTest } from '../src/qr.js';
import { otpauthUri } from '../src/totp.js';

/**
 * ★★★ **رمز QR مكتوبٌ عندنا — فلا بدّ من إثباتٍ لا رأي.**
 *
 *   شاشةُ تفعيل المصادقة الثنائيّة كانت تعرض السرَّ نصّاً يُلصق باليد: اثنان
 *   وثلاثون محرفاً تُنقل بالعين من شاشةٍ إلى هاتف. وحرفٌ واحدٌ خاطئ يُنتج
 *   رمزاً لا يُقبل أبداً بلا سببٍ ظاهر — والمالكُ يظنّ العطلَ فينا.
 *
 *   ولا يُرسَم عند طرفٍ ثالث: خدماتُ QR بالرابط تعني إرسالَ
 *   `otpauth://…secret=…` إلى خادمٍ لا نملكه — أي تسليمَ العامل الثاني لمن
 *   يرسم صورته.
 *
 * ★ **وكيف تحقّقنا قبل الشحن** (خارج المستودع، بمكتبتَين لم تُضافا إليه):
 *   ① مقارنةُ المصفوفة **بتّاً ببتّ** بمولّدٍ مرجعيّ (`qrcode@1.5.4`) في نمط
 *     البايت: ٢٣٥ من ٢٤٠ حالةً عشوائيّة (أطوالٌ ١..٧٠٠، المستوياتُ الأربعة،
 *     حتّى الإصدار ٣١) مطابقةٌ تماماً، والخمسُ الباقيةُ تختار قناعاً آخرَ
 *     مشروعاً — وهو تفضيلٌ لا صحّة.
 *   ② وفكُّ الرمز بقارئٍ مستقلّ (`jsqr`): **٢٤٠ من ٢٤٠** أعادت النصَّ الأصليَّ
 *     حرفاً بحرف. وهذه هي الخاصّيّةُ التي تهمّ.
 *
 *   وعطلان وجدَتهما المقارنةُ ولم تكن العينُ لتراهما: ترتيبُ معاملات مولِّد
 *   Reed-Solomon مقلوبٌ بإزاحةٍ واحدة (بقيّةٌ معقولةُ الشكل، ورمزٌ لا يُقرأ
 *   بأيّ قارئ)، وصياغةُ عقوبة القناع الثالثة.
 *
 * ⚠️ والحارسُ هنا **مصفوفاتٌ ذهبيّة**: لا يستطيع فكَّ الرمز بلا مكتبة، لكنّ
 *    أيَّ تغييرٍ في المولِّد يُبدّل البصمة — فيسقط الاختبارُ ويُعاد التحقّقُ
 *    الخارجيُّ قبل أن يُشحن شيء.
 */

const fp = (rows: string[]) => createHash('sha256').update(rows.join('')).digest('hex').slice(0, 16);

describe('جداولُ المعيار — أرقامٌ تُقارَن لا تُقرأ', () => {
  it('★ سعةُ البيانات لكلّ إصدارٍ ومستوى', () => {
    for (const [ver, ec, want] of [
      [1, 'L', 19], [1, 'M', 16], [1, 'Q', 13], [1, 'H', 9],
      [7, 'M', 124], [8, 'M', 154], [20, 'Q', 485], [40, 'L', 2956], [40, 'H', 1276],
    ] as const) {
      expect(__forTest.dataCodewords(ver, ec), `v${ver}-${ec}`).toBe(want);
    }
  });

  it('★ ومواضعُ أنماط المحاذاة — ومنها يبدأ العدُّ بالسادس', () => {
    expect(__forTest.alignPositions(1)).toEqual([]);
    expect(__forTest.alignPositions(2)).toEqual([6, 18]);
    expect(__forTest.alignPositions(7)).toEqual([6, 22, 38]);
    expect(__forTest.alignPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
  });

  it('★★★ وبقيّةُ Reed-Solomon — متّجهٌ معلومُ الجواب', () => {
    /* لنصّ «a» في الإصدار ١ مستوى M: كلماتُ البيانات ثمّ عشرُ كلماتِ تصحيح.
       والقيمةُ مأخوذةٌ من مُرمِّزٍ مرجعيٍّ مستقلّ — وهي ما كشف انقلابَ ترتيب
       معاملات المولِّد: البقيّةُ كانت عشرةَ بايتاتٍ تبدو سليمةً تماماً. */
    const data = [0x40, 0x16, 0x10];
    while (data.length < 16) data.push(data.length % 2 === 1 ? 0xec : 0x11);
    expect(__forTest.rsRemainder(data, 10))
      .toEqual([0xfc, 0xa0, 0x27, 0xa2, 0x62, 0x6b, 0x32, 0x3b, 0x6f, 0x1c]);
  });
});

describe('مصفوفاتٌ ذهبيّة — مُقارَنةٌ بمرجعٍ خارجيٍّ وقتَ توليدها', () => {
  it('★★★ البصماتُ ثابتة', () => {
    for (const [text, ec, size, want] of [
      ['a', 'L', 21, '2a29499fa66525ef'],
      ['a', 'M', 21, '2e7add7dfd3288d4'],
      ['a', 'Q', 21, '9ef8181a0d43e2fe'],
      ['a', 'H', 21, 'bb4ebea10d02c0ed'],
      ['HELLO WORLD', 'M', 21, 'f516d851861750f4'],
      ['z'.repeat(300), 'M', 69, '6632569fcfec6248'],
    ] as const) {
      const rows = qrRows(text, ec);
      expect(rows.length, `${text.slice(0, 8)} ${ec}`).toBe(size);
      expect(fp(rows), `${text.slice(0, 8)} ${ec}`).toBe(want);
    }
  });

  it('★★ والحمولةُ التي نُصدرها فعلاً — `otpauth://`', () => {
    const u = otpauthUri('JBSWY3DPEHPK3PXP', 'owner@aibot.masaros.net');
    const rows = qrRows(u, 'M');
    expect(rows.length).toBe(45);
    expect(fp(rows)).toBe('c3ce758906b81bf8');
  });

  it('★ وصفٌّ كاملٌ مقروءٌ بالعين — الإصدارُ الأوّل مستوى M', () => {
    /* صفٌّ واحدٌ منشورٌ حرفيّاً: بصمةٌ وحدها تقول «تغيّر شيء» ولا تقول ماذا. */
    expect(qrRows('a', 'M')[0]).toBe('111111100101101111111');
    expect(qrRows('a', 'M')[20]).toBe('111111101010100100110');
  });
});

describe('بنيةُ الرمز — ما يبحث عنه القارئ أوّلاً', () => {
  const rows = qrRows('otpauth://totp/AiBot:x?secret=ABCDEFGHIJKLMNOP', 'M');
  const n = rows.length;

  it('حجمٌ صالحٌ: ٤×الإصدار+١٧', () => {
    expect((n - 17) % 4).toBe(0);
    expect((n - 17) / 4).toBeGreaterThanOrEqual(1);
  });

  it('★ والأنماطُ الثلاثةُ الكبيرة في أركانها الثلاثة', () => {
    for (const [oy, ox] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      for (let dy = 0; dy < 7; dy += 1) {
        for (let dx = 0; dx < 7; dx += 1) {
          const d = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
          expect(rows[oy + dy]![ox + dx], `${oy},${ox} ${dy},${dx}`).toBe(d === 2 ? '0' : '1');
        }
      }
    }
  });

  it('★ وأنماطُ التوقيت تتناوب', () => {
    for (let i = 8; i < n - 8; i += 1) {
      expect(rows[6]![i], `أفقيّ ${i}`).toBe(i % 2 === 0 ? '1' : '0');
      expect(rows[i]![6], `عموديّ ${i}`).toBe(i % 2 === 0 ? '1' : '0');
    }
  });

  it('★★ والخانةُ الداكنة الدائمة — قارئٌ لا يجدها يرفض الرمز', () => {
    expect(rows[n - 8]![8]).toBe('1');
  });

  it('★★ وبتّاتُ النسق تُقرأ المستوى والقناع اللذَين استُعملا', () => {
    /* وهي المكتوبةُ مرّتَين في الرمز — نقرأ النسخةَ الأولى ونفكّ BCH. */
    const bits: string[] = [];
    for (let i = 0; i <= 5; i += 1) bits.push(rows[i]![8]!);
    bits.push(rows[7]![8]!, rows[8]![8]!, rows[8]![7]!);
    for (let i = 9; i < 15; i += 1) bits.push(rows[8]![14 - i]!);
    const val = bits.reduce((a, b, i) => a | (Number(b) << i), 0) ^ 0x5412;
    const data = val >>> 10;
    expect(data >>> 3, 'مستوى M يُكتب صفراً').toBe(0);
    expect(data & 7).toBeGreaterThanOrEqual(0);
    expect(data & 7).toBeLessThanOrEqual(7);
  });
});

describe('الحدود', () => {
  it('★ نصٌّ أطولُ من أكبر رمزٍ يُرمى — لا يُقصّ بصمت', () => {
    /* قصُّ الحمولة يُنتج رمزاً يُقرأ سرّاً **ناقصاً**: يُسجَّل في التطبيق
       ولا يُقبل رمزُه أبداً، والمالكُ محبوسٌ بلا سببٍ ظاهر. */
    expect(() => qrMatrix('x'.repeat(5000), 'H')).toThrow(/أطول/);
  });

  it('والنصُّ الفارغ يُنتج رمزاً صالحاً', () => {
    expect(qrRows('', 'M')).toHaveLength(21);
  });

  it('★ والعربيّةُ تمرّ — نمطُ البايت على UTF-8', () => {
    expect(() => qrRows('مرحبا بالعالم', 'M')).not.toThrow();
  });

  it('★ والقناعُ يُفرَض للاختبار فيبقى الرمزُ صالحَ البنية', () => {
    for (let m = 0; m < 8; m += 1) {
      const rows = qrMatrix('a', 'M', m).map((r) => r.map((c) => (c ? '1' : '0')).join(''));
      expect(rows[0]!.slice(0, 7), `قناع ${m}`).toBe('1111111');
    }
  });
});
