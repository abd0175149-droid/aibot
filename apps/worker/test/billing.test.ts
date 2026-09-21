import { describe, it, expect } from 'vitest';
import { billingPeriod } from '../src/outbound.js';
import { withinBusinessHours } from '../src/reply.js';
import { chunkText } from '../src/embed.js';
import { fingerprintOf } from '../src/incidents.js';

describe('دورة الفوترة — بتوقيت المستأجر لا UTC', () => {
  it('آخر يومٍ في الشهر بتوقيت عمّان يبقى في شهره', () => {
    // 2026-09-30 23:00 بعمّان = 2026-09-30 20:00Z — نفس الشهر
    expect(billingPeriod(new Date('2026-09-30T20:00:00Z'))).toBe('2026-09');
  });

  it('منتصف ليل عمّان يعبر الشهر قبل UTC بثلاث ساعات', () => {
    // 2026-09-30 21:00Z = 2026-10-01 00:00 بعمّان ⟵ الشهر التالي
    expect(billingPeriod(new Date('2026-09-30T21:00:00Z'))).toBe('2026-10');
    // وبـUTC ما زال أيلول — وهذا بالضبط الخطأ الذي يُفوتِر نافذةً على شهرٍ خاطئ
    expect(billingPeriod(new Date('2026-09-30T21:00:00Z'), 'UTC')).toBe('2026-09');
  });

  it('منطقةٌ مختلفة تُنتج دورةً مختلفة — والدورة تتبع المستأجر', () => {
    const t = new Date('2026-10-01T02:00:00Z');
    expect(billingPeriod(t, 'Asia/Amman')).toBe('2026-10');
    expect(billingPeriod(t, 'America/New_York')).toBe('2026-09');
  });
});

describe('ساعات العمل', () => {
  const bh = {
    tz: 'Asia/Amman',
    days: {
      sun: [['12:00', '00:00']] as Array<[string, string]>,
      fri: [['13:30', '00:00']] as Array<[string, string]>,
      mon: [] as Array<[string, string]>,
    },
  };

  it('بلا إعداد: مفتوحٌ دائماً — لا نُسكت بوتاً بسبب حقلٍ فارغ', () => {
    expect(withinBusinessHours(null)).toBe(true);
    expect(withinBusinessHours({})).toBe(true);
  });

  it('داخل الدوام', () => {
    // الأحد 2026-09-20 18:00 بعمّان = 15:00Z
    expect(withinBusinessHours(bh, new Date('2026-09-20T15:00:00Z'))).toBe(true);
  });

  it('قبل الفتح', () => {
    // الأحد 10:00 بعمّان = 07:00Z
    expect(withinBusinessHours(bh, new Date('2026-09-20T07:00:00Z'))).toBe(false);
  });

  it('نطاقٌ ينتهي بمنتصف الليل يشمل الساعة 23', () => {
    // الأحد 23:30 بعمّان = 20:30Z
    expect(withinBusinessHours(bh, new Date('2026-09-20T20:30:00Z'))).toBe(true);
  });

  it('يومٌ بلا نطاقات = مغلق', () => {
    // الاثنين 2026-09-21 15:00 بعمّان
    expect(withinBusinessHours(bh, new Date('2026-09-21T12:00:00Z'))).toBe(false);
  });
});

describe('تقطيع المعرفة', () => {
  it('يقسم على العناوين ويحتفظ بها مع المقطع', () => {
    const out = chunkText('# التوصيل\nالتوصيل داخل عمّان برسوم ديناران.\n\n# الحجز\nالحجز لستّة فأكثر.');
    expect(out).toHaveLength(2);
    expect(out[0]!.heading).toBe('التوصيل');
    expect(out[1]!.heading).toBe('الحجز');
  });

  it('يفهم العنوان بصيغة «سطرٌ ينتهي بنقطتين»', () => {
    const out = chunkText('ساعات العمل:\nيوميّاً من 12 ظهراً حتّى منتصف الليل.');
    expect(out[0]!.heading).toBe('ساعات العمل');
  });

  it('يقسم القسم الطويل على الفقرات ويُبقي العنوان على كلّ قطعة', () => {
    const para = 'فقرةٌ عربيّةٌ طويلةٌ فيها تفاصيلُ كثيرة عن الخدمة والأسعار. '.repeat(20);
    const out = chunkText(`# الأسعار\n${para}\n\n${para}\n\n${para}`, 300);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.heading === 'الأسعار')).toBe(true);
  });

  it('لا يُنتج مقاطع فارغة', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('\n\n\n')).toEqual([]);
    expect(chunkText('# عنوانٌ بلا محتوى\n\n').every((c) => c.body.trim())).toBe(true);
  });
});

describe('بصمة الحادثة — حادثةٌ واحدة لا مئة إشعار', () => {
  const base = { tenantId: 't1', kind: 'token_invalid', severity: 'critical' as const, title: 'x' };

  it('نفس السبب ⟵ نفس البصمة', () => {
    expect(fingerprintOf({ ...base, causeKey: 'a' })).toBe(fingerprintOf({ ...base, causeKey: 'a' }));
  });

  it('قناتان مختلفتان ⟵ بصمتان — واتساب مقطوعةٌ وإنستجرام تعمل حادثتان', () => {
    expect(fingerprintOf({ ...base, channelId: 'wa' }))
      .not.toBe(fingerprintOf({ ...base, channelId: 'ig' }));
  });

  it('مستأجران مختلفان ⟵ بصمتان', () => {
    expect(fingerprintOf(base)).not.toBe(fingerprintOf({ ...base, tenantId: 't2' }));
  });

  it('العنوان لا يدخل البصمة — فتغيّر نصّه لا يُنتج حادثةً جديدة', () => {
    expect(fingerprintOf({ ...base, title: 'صيغةٌ أخرى' })).toBe(fingerprintOf(base));
  });
});
