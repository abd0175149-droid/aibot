import { describe, it, expect } from 'vitest';
import { hoursSnapshot, withinBusinessHours } from '../src/hours.js';

/**
 * ★ **أداةٌ تعِد باثنتين ولا تُعطي واحدة.**
 *
 * إعلانُ `check_business_hours` يقول: «تحقّق إن كان النشاط مفتوحاً الآن، ومتى
 * يفتح إن كان مغلقاً». والمنفّذُ كان يُعيد `{ open: true }` **ثابتةً** في
 * العامل وفي الساحة معاً، بينما `bot_configs.business_hours` قائمٌ في المخطّط
 * لا يقرؤه أحد. وملاحظتُها «استعمل هذه النتيجة ولا تخترع ساعاتٍ أخرى» تمنع
 * النموذجَ من الرجوع إلى ساعاتٍ **صحيحةٍ** قد تكون في نصّ المعرفة — فالخطأُ
 * مؤكَّدٌ لا محتمَل.
 *
 * وكلُّ ما هنا سلوكٌ يُجرَّب بأوقاتٍ حقيقيّة، لا ماسحٌ نصّيّ: الحسابُ على
 * منطقةٍ زمنيّةٍ ونطاقاتٍ تعبر منتصف الليل لا يُحرَس بقراءة الشيفرة.
 */

const AMMAN = 'Asia/Amman';

/** وقتٌ بتوقيت عمّان — الشتاءُ ‎+03:00‎ بلا توقيت صيفيّ منذ ٢٠٢٢. */
const at = (iso: string) => new Date(iso);

describe('بلا ساعاتٍ مضبوطة', () => {
  it('مفتوحٌ دائماً — ولا يُدّعى علمٌ بما لم يُضبط', () => {
    const s = hoursSnapshot(null);
    expect(s.open).toBe(true);
    expect(s.configured).toBe(false);
    expect(s.opensNext).toBeNull();
    expect(s.say, 'الجملةُ تقول إنّها غيرُ مضبوطة لا «مفتوحون»').toContain('لم يضبط');
  });

  it('وشبكةٌ كلُّ أيّامها فارغة تُعامَل كغير مضبوطة لا كـ«مغلقٌ أبداً»', () => {
    /* الشاشةُ تُنشئ المفاتيح السبعة عند أوّل إشعال، فقد تُحفظ فارغةً كلُّها.
       وقراءتُها «مغلقٌ دائماً» تُسكت البوت إلى الأبد بلا أن يقصد المالك. */
    const s = hoursSnapshot({ tz: AMMAN, days: { sat: [], sun: [], mon: [] } });
    expect(s.configured).toBe(false);
    expect(s.open).toBe(true);
  });

  it('و`withinBusinessHours` توافقها', () => {
    expect(withinBusinessHours(null)).toBe(true);
    expect(withinBusinessHours({})).toBe(true);
  });
});

describe('داخلَ الدوام', () => {
  const bh = { tz: AMMAN, days: { sun: [['09:00', '17:00'] as [string, string]] } };

  it('★ يقول «مفتوحون» ويذكر دوامَ اليوم', () => {
    // الأحد ٢٠ أيلول ٢٠٢٦، ١٤:٠٠ بعمّان
    const s = hoursSnapshot(bh, at('2026-09-20T11:00:00Z'));
    expect(s.open).toBe(true);
    expect(s.today).toEqual(['09:00–17:00']);
    expect(s.opensNext, 'لا «متى يفتح» وهو مفتوح').toBeNull();
    expect(s.say).toContain('مفتوحون الآن');
    expect(s.say).toContain('09:00');
  });
});

describe('خارجَ الدوام — والنصفُ الثاني من الوعد', () => {
  it('★ يقول متى يفتح اليوم إن بقيت فترةٌ لم تبدأ', () => {
    const bh = { tz: AMMAN, days: { sun: [['09:00', '17:00'] as [string, string]] } };
    // الأحد ٠٧:٠٠ بعمّان — قبل الفتح
    const s = hoursSnapshot(bh, at('2026-09-20T04:00:00Z'));
    expect(s.open).toBe(false);
    expect(s.opensNext).toEqual({ day: 'الأحد', at: '09:00' });
    expect(s.say).toContain('اليوم 09:00');
  });

  it('★★ ونشاطٌ يفتح يوماً واحداً في الأسبوع يجد فتحَه الأسبوعَ القادم', () => {
    /* العطلُ الذي يُحرَس هنا: دَوَرانٌ يبدأ من الغد لا يعود إلى اليوم نفسه
       أبداً، فيُعطى `opensNext: null` إلى الأبد — ويبقى نصفُ الإعلان بلا
       جواب على أكثر الحالات التي وُجد لها. */
    const bh = { tz: AMMAN, days: { sun: [['09:00', '17:00'] as [string, string]] } };
    // الأحد ٢٠:٠٠ بعمّان — بعد الإغلاق، ولا فترةَ أخرى هذا الأسبوع
    const s = hoursSnapshot(bh, at('2026-09-20T17:00:00Z'));
    expect(s.open).toBe(false);
    expect(s.opensNext, 'لا يجد الأحدَ القادم').toEqual({ day: 'الأحد', at: '09:00' });
    expect(s.say).toContain('الأحد 09:00');
  });

  it('واليومُ المغلق يقفز إلى أوّل يومٍ مفتوحٍ بعده', () => {
    const bh = {
      tz: AMMAN,
      days: {
        sun: [['09:00', '17:00'] as [string, string]],
        tue: [['10:00', '14:00'] as [string, string]],
      },
    };
    // الإثنين ١٢:٠٠ بعمّان — يومٌ مغلق
    const s = hoursSnapshot(bh, at('2026-09-21T09:00:00Z'));
    expect(s.open).toBe(false);
    expect(s.today).toEqual([]);
    expect(s.opensNext).toEqual({ day: 'الثلاثاء', at: '10:00' });
  });

  it('★ وأبكرُ فترةٍ لا أوّلُ فترةٍ في المصفوفة — الترتيبُ لا يُفترَض', () => {
    const bh = {
      tz: AMMAN,
      days: { sun: [['17:00', '22:00'], ['09:00', '14:00']] as Array<[string, string]> },
    };
    const s = hoursSnapshot(bh, at('2026-09-20T04:00:00Z')); // الأحد ٠٧:٠٠
    expect(s.opensNext?.at, 'أخذ ١٧:٠٠ لأنّها أوّلُ عنصرٍ في المصفوفة').toBe('09:00');
  });
});

describe('نطاقٌ يعبر منتصف الليل', () => {
  const bh = { tz: AMMAN, days: { sat: [['20:00', '02:00'] as [string, string]] } };

  it('مفتوحٌ بعد العشرين', () => {
    // السبت ٢٢:٠٠ بعمّان
    expect(hoursSnapshot(bh, at('2026-09-19T19:00:00Z')).open).toBe(true);
  });

  it('★ ومفتوحٌ قبل الثانية فجراً — من فترةِ اليوم السابق', () => {
    /* `to <= from` تعني «حتّى الغد»، وهي القاعدةُ التي تجعل خطأً مطبعيّاً
       («17:00–09:00») يفتح الدوامَ ستَّ عشرةَ ساعة. ولذلك يرفض المسارُ
       نطاقاً طرفاه متساويان. */
    expect(withinBusinessHours(bh, at('2026-09-19T22:30:00Z')), 'السبت ٠١:٣٠').toBe(true);
  });

  it('ومغلقٌ في الظهيرة', () => {
    expect(hoursSnapshot(bh, at('2026-09-19T09:00:00Z')).open).toBe(false);
  });
});

describe('المنطقةُ الزمنيّة تُحترَم', () => {
  it('★ نفسُ اللحظة مفتوحةٌ في عمّان ومغلقةٌ في لندن', () => {
    /* بلا هذا يُحسب الدوامُ بساعة الخادم — وهي UTC في الحاوية. فمطعمٌ في
       عمّان يُقال عنه مغلقٌ ثلاثَ ساعاتٍ وهو يعمل. */
    const days = { sun: [['09:00', '11:00'] as [string, string]] };
    const moment = at('2026-09-20T07:00:00Z'); // ١٠:٠٠ بعمّان · ٠٨:٠٠ بلندن
    expect(hoursSnapshot({ tz: AMMAN, days }, moment).open).toBe(true);
    expect(hoursSnapshot({ tz: 'Europe/London', days }, moment).open).toBe(false);
  });
});

describe('الجملةُ الجاهزة تُقال كما هي', () => {
  it('★ ولا تحمل رقماً بصيغةٍ تخالف ما يراه النموذج في السياق', () => {
    /* «الآن» يصل النموذجَ بصيغة `Intl` العربيّة («١١:٣٠ م»)، والنطاقاتُ
       مخزَّنةٌ بأربعٍ وعشرين ورقمٍ لاتينيّ. فمطالبةُ النموذج بالمقارنة بينهما
       طريقٌ جديدةٌ إلى نفس الجواب الخاطئ. ولذلك يُحسم الأمرُ هنا وتُسلَّم
       جملةٌ. */
    const bh = { tz: AMMAN, days: { sun: [['09:00', '17:00'] as [string, string]] } };
    const s = hoursSnapshot(bh, at('2026-09-20T11:00:00Z'));
    expect(s.say).not.toMatch(/[٠-٩]/);
    expect(s.say.length).toBeGreaterThan(10);
  });
});
