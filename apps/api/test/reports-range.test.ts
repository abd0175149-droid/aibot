import { describe, it, expect } from 'vitest';
import {
  REPORT_TZ, PRESET_DAYS, MAX_DAYS,
  dayIn, isDay, shiftDay, daysBetween, parseRange, fillDays,
} from '../src/routes/reports-range.js';

/**
 * ★ حدودُ المدى تُختبَر لأنّها **تكذب بهدوء**.
 *
 * مدًى بحدٍّ خاطئٍ لا يرمي ولا يُفرغ الشاشة: يعرض تسعةً وعشرين يوماً بعنوان
 * «٣٠ يوماً»، أو يعدّ رسالةَ منتصفِ الليل في اليوم الخطأ، أو يقارن مدًى بمدًى
 * سابقٍ يتراكب معه بيومٍ واحد — فيظهر «تحسُّنٌ» مصدرُه الحدّ لا البوت.
 * وكلُّ هذا يُقرأ صحيحاً في المراجعة.
 */

describe('تقويمُ اليوم — حسابٌ على النصّ لا على `Date` محلّيّ', () => {
  it('يزيد وينقص عبر حدود الشهر والسنة والكبيسة', () => {
    expect(shiftDay('2026-09-23', 1)).toBe('2026-09-24');
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    // 2024 كبيسة و2026 ليست — والحسابُ لا يعرف ذلك، بل التقويمُ يعرفه
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('★ لا تمسّه ساعةٌ صيفيّة — والأردن غيّرها مراراً', () => {
    /* لو كان الحساب بـ`new Date(y, m, d)` المحلّيّ لأنتج يومَ الانتقال 23
       ساعةً أو 25، فيقفز `setDate` يوماً أو يبقى في مكانه. والمرساةُ UTC
       تُلغي السؤال بنيويّاً — لا تُعالجه. */
    for (const d of ['2026-03-26', '2026-03-27', '2026-10-29', '2026-10-30']) {
      expect(daysBetween(d, shiftDay(d, 1))).toBe(1);
      expect(shiftDay(shiftDay(d, 1), -1)).toBe(d);
    }
  });

  it('يقيس المسافة بين يومَين بإشارتها', () => {
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(29);
    expect(daysBetween('2026-09-30', '2026-09-01')).toBe(-29);
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(0);
  });

  it('★ يرفض يوماً يطابق الشكل ولا يوجد — «2026-02-30»', () => {
    expect(isDay('2026-09-23')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-9-1')).toBe(false);
    expect(isDay('')).toBe(false);
    expect(isDay('yesterday')).toBe(false);
  });

  it('اليومُ يُقرأ بتوقيت المستأجر لا بتوقيت الخادم', () => {
    // منتصفُ ليل UTC = الثالثةُ صباحاً في عمّان، فاليومُ **التالي** هناك
    const at = new Date('2026-09-23T00:30:00Z');
    expect(dayIn(REPORT_TZ, at)).toBe('2026-09-23');
    expect(dayIn('UTC', at)).toBe('2026-09-23');
    // وقبل منتصف ليل عمّان بنصف ساعة: عمّان في الغد وUTC لم تدخله
    const at2 = new Date('2026-09-23T21:30:00Z');
    expect(dayIn(REPORT_TZ, at2)).toBe('2026-09-24');
    expect(dayIn('UTC', at2)).toBe('2026-09-23');
  });
});

describe('قراءةُ المدى — والمدى السابق مُلاصقٌ بطوله', () => {
  const TODAY = '2026-09-23';

  it('يفترض ثلاثين يوماً حين لا يُذكر شيء', () => {
    const r = parseRange({}, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.range.days).toBe(30);
    expect(r.range.preset).toBe(30);
  });

  it('★ اليومُ الجاري **داخل** المدى — و`hi` أوّلُ يومٍ بعده', () => {
    /* بلا هذا يُفتح التقرير على مدًى ينتهي أمس، فلا تظهر محادثةُ اليوم —
       وهي أوّلُ ما يُبحث عنه بعد تغييرٍ في البوت. */
    const r = parseRange({ days: '7' }, TODAY);
    if (!r.ok) throw new Error(r.message);
    expect(r.range.hi).toBe('2026-09-24');
    expect(r.range.last).toBe(TODAY);
    expect(r.range.lo).toBe('2026-09-17');
    expect(daysBetween(r.range.lo, r.range.hi)).toBe(7);
    expect(r.range.openEnd).toBe(true);
  });

  it('★ السابقُ يُلاصق ولا يتراكب — ويومُ تراكبٍ يخترع تحسُّناً', () => {
    for (const days of PRESET_DAYS) {
      const r = parseRange({ days: String(days) }, TODAY);
      if (!r.ok) throw new Error(r.message);
      // [prevLo, lo) ثمّ [lo, hi): حدٌّ واحدٌ مشترك، ولا يومَ في المدَيين
      expect(daysBetween(r.range.prevLo, r.range.lo)).toBe(days);
      expect(daysBetween(r.range.lo, r.range.hi)).toBe(days);
    }
  });

  it('يرفض مدًى ليس من الجاهزة — ولا يصمت عليه', () => {
    const r = parseRange({ days: '45' }, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('مخصَّص');
    expect(parseRange({ days: 'ثلاثون' }, TODAY).ok).toBe(false);
    expect(parseRange({ days: '0' }, TODAY).ok).toBe(false);
    expect(parseRange({ days: '-7' }, TODAY).ok).toBe(false);
  });

  it('المخصَّصُ مشمولُ الطرفين — «يومٌ واحد» يعني يوماً واحداً', () => {
    const r = parseRange({ from: TODAY, to: TODAY }, TODAY);
    if (!r.ok) throw new Error(r.message);
    expect(r.range.days).toBe(1);
    expect(r.range.lo).toBe(TODAY);
    expect(r.range.hi).toBe('2026-09-24');
    expect(r.range.prevLo).toBe('2026-09-22');
    expect(r.range.preset).toBeNull();
  });

  it('★ «إلى آخر الشهر» تُقَصّ إلى اليوم ولا تُرفَض', () => {
    /* من يختار نهايةً في المستقبل يقصد «إلى الآن». ورفضُه يعلّمه أنّ المنتج
       نكِد؛ والقصُّ يعطيه ما أراد — ويبقى `openEnd` يقول إنّ آخرَ يومٍ ناقص. */
    const r = parseRange({ from: '2026-09-01', to: '2026-09-30' }, TODAY);
    if (!r.ok) throw new Error(r.message);
    expect(r.range.last).toBe(TODAY);
    expect(r.range.days).toBe(23);
    expect(r.range.openEnd).toBe(true);
  });

  it('ومدًى منتهٍ قبل اليوم ليس ناقصاً — فلا تقطيعَ على آخر نقطةٍ منه', () => {
    const r = parseRange({ from: '2026-08-01', to: '2026-08-31' }, TODAY);
    if (!r.ok) throw new Error(r.message);
    expect(r.range.days).toBe(31);
    expect(r.range.openEnd).toBe(false);
    expect(r.range.prevLo).toBe('2026-07-01');
  });

  it('يرفض النصفَ والمقلوبَ والمستقبلَ وما فوق السقف', () => {
    expect(parseRange({ from: '2026-09-01' }, TODAY).ok).toBe(false);
    expect(parseRange({ to: '2026-09-01' }, TODAY).ok).toBe(false);
    expect(parseRange({ from: '2026-09-10', to: '2026-09-01' }, TODAY).ok).toBe(false);
    expect(parseRange({ from: '2026-10-01', to: '2026-10-05' }, TODAY).ok).toBe(false);
    expect(parseRange({ from: '2026-02-30', to: '2026-03-01' }, TODAY).ok).toBe(false);
    const long = parseRange({ from: shiftDay(TODAY, -MAX_DAYS), to: TODAY }, TODAY);
    expect(long.ok).toBe(false);
    // وحدُّ السقف نفسه مقبول
    expect(parseRange({ from: shiftDay(TODAY, -(MAX_DAYS - 1)), to: TODAY }, TODAY).ok).toBe(true);
  });

  it('كلُّ رسالةِ رفضٍ عربيّةٌ صالحةٌ للعرض كما هي — لا كودٌ ولا إنجليزيّة', () => {
    for (const q of [
      { days: '45' }, { from: '2026-09-01' }, { from: 'x', to: 'y' },
      { from: '2026-09-10', to: '2026-09-01' }, { from: '2026-10-01', to: '2026-10-02' },
    ]) {
      const r = parseRange(q, TODAY);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.message.length).toBeGreaterThan(12);
      expect(/[؀-ۿ]/.test(r.message)).toBe(true);
    }
  });
});

describe('ملءُ الأيّام — ويومٌ بلا بياناتٍ يومٌ بصفرٍ لا يومٌ غائب', () => {
  const zero = { n: 0 };

  it('يُخرج يوماً لكلّ يومٍ في المدى، مرتَّباً', () => {
    const out = fillDays('2026-09-20', '2026-09-24', [{ day: '2026-09-22', n: 5 }], zero);
    expect(out.map((d) => d.day)).toEqual([
      '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23',
    ]);
    expect(out.map((d) => d.n)).toEqual([0, 0, 5, 0]);
  });

  it('★ الفراغُ يصير صفراً — فلا يوصل الرسمُ يومَين متباعدَين بخطٍّ كاذب', () => {
    const out = fillDays('2026-09-01', '2026-09-11',
      [{ day: '2026-09-01', n: 40 }, { day: '2026-09-10', n: 40 }], zero);
    expect(out).toHaveLength(10);
    // ثمانيةُ أصفارٍ بينهما — لا قطعةٌ مستقيمةٌ تُقرأ «هبوطاً تدريجيّاً»
    expect(out.slice(1, 9).every((d) => d.n === 0)).toBe(true);
  });

  it('مدًى فارغٌ يُخرج مدًى كاملاً بأصفار — لا مصفوفةً فارغة', () => {
    expect(fillDays('2026-09-01', '2026-09-08', [], zero)).toHaveLength(7);
  });

  it('ويتجاهل يوماً خارج المدى بدل أن يزحزح الترتيب', () => {
    const out = fillDays('2026-09-05', '2026-09-08',
      [{ day: '2026-09-01', n: 9 }, { day: '2026-09-06', n: 3 }], zero);
    expect(out.map((d) => d.n)).toEqual([0, 3, 0]);
  });
});
