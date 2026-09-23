import { describe, it, expect } from 'vitest';
import { readTeam, daysSince, type TeamFacts, type TeamFocus } from '../src/lib/team';

/**
 * ★ سلّمُ انتباه شاشة الفريق — مُختبَرٌ لأنّه **قرارٌ لا عرض**.
 *
 * العطل الذي يحرسه هذا الملفّ ليس نظريّاً: كانت الشاشة تشتقّ نفسَ التصنيف
 * ثلاث مرّات — مرّةً لنصّ الشريط الحاكم، ومرّةً لاختيار الرقم البطوليّ، ومرّةً
 * لبناء رقاقات الترشيح. وثلاثُ نسخٍ من شرطٍ واحدٍ (`>= staleDays`) هي الصيغةُ
 * التي يُصلَح فيها موضعٌ ويُنسى الآخران، فيقول الشريطُ «كلُّ حسابٍ مستعمَل»
 * والبطوليُّ يعرض حسابَين راكدَين **في نفس الرسم**. ولا تُمسك بالمراجعة لأنّ
 * كلَّ فرعٍ وحده صحيح.
 *
 * وثلاثُ دعاوى تُمتحن هنا بالضبط:
 *  ① **العتبةُ على حدّها**: «منذ 30 يوماً» تصير صحيحةً عند اكتمال الثلاثين
 *    لا قبلها ولا بعدها بيوم. وهذا حدُّ off-by-one يُنتج إنذاراً كاذباً أو
 *    صمتاً كاذباً، وكلاهما يُفقد الثقة بالشريط.
 *  ② **المعطَّلُ ليس بابَ خطر**: هو **مقفولٌ** أصلاً، فلا يُعدّ راكداً ولا
 *    «لم يدخل» ولا يشغل مقعداً. وإنذارٌ على ما عُولج فعلاً أسرعُ طريقٍ إلى
 *    تجاهل الشريط كلِّه.
 *  ③ **ما وقع يسبق ما يُتوقَّع**: بابٌ مفتوحٌ اليوم يسبق خطرَ قفلٍ قد لا يقع.
 */

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function mk(p: Partial<TeamFacts> = {}): TeamFacts {
  return { isActive: true, role: 'tenant_agent', lastLoginAt: ago(1), liveSessions: 0, ...p };
}
const owner = (p: Partial<TeamFacts> = {}) => mk({ role: 'tenant_owner', ...p });

const read = (items: TeamFacts[], seats: number | null = null, staleDays = 30) =>
  readTeam(items, staleDays, seats, NOW);

describe('عدُّ الأيّام — أرضيّةٌ لا تقريب', () => {
  it('يعدّ اليومَ المكتمل وحده', () => {
    expect(daysSince(ago(0), NOW)).toBe(0);
    expect(daysSince(ago(30), NOW)).toBe(30);
    // ساعةٌ قبل اكتمال الثلاثين ما زالت تسعاً وعشرين — والفرقُ يقلب الإنذار
    expect(daysSince(new Date(NOW - 30 * DAY + 3600_000).toISOString(), NOW)).toBe(29);
  });

  it('لا ينهار على وقتٍ في المستقبل — ساعةُ جهازٍ متقدّمةٌ تقع فعلاً', () => {
    expect(daysSince(new Date(NOW + DAY).toISOString(), NOW)).toBeLessThan(0);
  });
});

describe('عتبةُ الرُّكود — على حدّها بالضبط', () => {
  it('اليومُ الثلاثون راكدٌ والتاسعُ والعشرون ليس', () => {
    expect(read([owner(), mk({ lastLoginAt: ago(30) })]).rusty).toHaveLength(1);
    expect(read([owner(), mk({ lastLoginAt: ago(29) })]).rusty).toHaveLength(0);
  });

  it('العتبةُ من الخادم لا رقمٌ مثبَّت', () => {
    const items = [owner(), mk({ lastLoginAt: ago(10) })];
    expect(read(items, null, 7).rusty).toHaveLength(1);
    expect(read(items, null, 14).rusty).toHaveLength(0);
  });

  it('من لم يدخل قطّ ليس راكداً بل «دعوةٌ لم تُستعمل» — حالتان لا واحدة', () => {
    const t = read([owner(), mk({ lastLoginAt: null })]);
    expect(t.never).toHaveLength(1);
    expect(t.rusty).toHaveLength(0);
  });
});

describe('المعطَّلُ بابٌ مقفولٌ لا خطرٌ يُنبَّه عليه', () => {
  const stale = mk({ isActive: false, lastLoginAt: ago(400) });
  const unused = mk({ isActive: false, lastLoginAt: null });

  it('لا يُعدّ راكداً ولا «لم يدخل»', () => {
    const t = read([owner(), stale, unused]);
    expect(t.rusty).toHaveLength(0);
    expect(t.never).toHaveLength(0);
    expect(t.off).toHaveLength(2);
  });

  it('ولا يشغل مقعداً — وإلّا صار «عطِّل واحداً لتدعو آخر» مستحيلاً', () => {
    // مقعدان، ونشطٌ واحدٌ ومعطَّلان: الباب مفتوحٌ لدعوةٍ ثانية
    expect(read([owner(), stale, unused], 2).seatsFull).toBe(false);
    expect(read([owner(), mk()], 2).seatsFull).toBe(true);
  });

  it('ولا يُحسَب في المالكين النشطين — وهو ما يمنع إفراغ الحساب من مالكه', () => {
    const t = read([owner(), owner({ isActive: false })]);
    expect(t.owners).toHaveLength(1);
  });
});

describe('الجلساتُ الحيّة — على النشط وحده', () => {
  it('المجموعُ وعددُ الحسابات معلومتان مختلفتان', () => {
    const t = read([owner({ liveSessions: 3 }), mk({ liveSessions: 1 }), mk({ liveSessions: 0 })]);
    expect(t.live).toBe(4);
    expect(t.liveOn).toBe(2);
  });

  it('جلسةُ حسابٍ معطَّلٍ لا تُعدّ — التعطيلُ أبطلها فعلاً', () => {
    const t = read([owner(), mk({ isActive: false, liveSessions: 9 })]);
    expect(t.live).toBe(0);
    expect(t.liveOn).toBe(0);
  });
});

describe('★ ترتيبُ السلّم — ما وقع يسبق ما يُتوقَّع', () => {
  it('الراكدُ يسبق الدعوةَ غير المستعملة', () => {
    const t = read([owner({ lastLoginAt: ago(90) }), mk({ lastLoginAt: null })]);
    expect(t.rusty).toHaveLength(1);
    expect(t.never).toHaveLength(1);
    expect(t.focus).toBe('rusty');
  });

  it('والدعوةُ غير المستعملة تسبق «مالكٌ واحدٌ نشط»', () => {
    const t = read([owner(), mk({ lastLoginAt: null })]);
    expect(t.owners).toHaveLength(1);
    expect(t.focus).toBe('never');
  });

  it('و«مالكٌ واحدٌ نشط» يسبق «المقاعدُ ممتلئة» — خطرٌ يسبق فعلاً محجوباً', () => {
    const t = read([owner(), mk()], 2);
    expect(t.seatsFull).toBe(true);
    expect(t.focus).toBe('onlyOwner');
  });

  it('والمقاعدُ الممتلئة تسبق «صافٍ»', () => {
    expect(read([owner(), owner()], 2).focus).toBe('seatsFull');
    expect(read([owner(), owner()], 5).focus).toBe('clear');
  });
});

describe('«وحدك» ليست «مالكٌ واحدٌ نشط»', () => {
  it('عضوٌ واحدٌ = وحدك — فلا يُنذَر بخطرٍ لا فريقَ فيه', () => {
    expect(read([owner()]).focus).toBe('solo');
  });

  it('ومالكٌ نشطٌ واحدٌ ومعه موظّفٌ = إنذارُ قفل', () => {
    expect(read([owner(), mk()]).focus).toBe('onlyOwner');
  });

  it('ومالكان نشطان = لا إنذار', () => {
    expect(read([owner(), owner(), mk()]).focus).toBe('clear');
  });

  it('★ ومالكٌ واحدٌ ومعه **معطَّلٌ** يبقى إنذاراً: المعطَّل يُعاد بزرّ', () => {
    /* الصفُّ موجودٌ ويُعاد تفعيلُه بضغطة، فالحسابُ ليس «وحدك» فعلاً —
       لكنّ المالكَ النشطَ واحد، وفقدانُ وصوله يقفل الحساب على ما فيه. */
    expect(read([owner(), mk({ isActive: false })]).focus).toBe('onlyOwner');
  });
});

describe('السلّم تامٌّ — لا رتبةٌ ميّتةٌ ولا رتبةٌ لا تُبلَغ', () => {
  it('كلُّ رتبةٍ في النوع يبلغها سيناريو', () => {
    const reached = new Set<TeamFocus>([
      read([owner({ lastLoginAt: ago(60) })]).focus,
      read([owner(), mk({ lastLoginAt: null })]).focus,
      read([owner(), mk()]).focus,
      read([owner(), owner()], 2).focus,
      read([owner()]).focus,
      read([owner(), owner()], 9).focus,
    ]);
    const all: TeamFocus[] = ['rusty', 'never', 'onlyOwner', 'seatsFull', 'solo', 'clear'];
    expect([...reached].sort()).toEqual([...all].sort());
  });

  it('الفريقُ الفارغ لا يرمي — الشاشةُ تُرسَم قبل وصول الصفوف أيضاً', () => {
    const t = read([]);
    expect(t.focus).toBe('solo');
    expect(t.active).toEqual([]);
    expect(t.live).toBe(0);
    expect(t.seatsFull).toBe(false);
  });

  it('بلا سقفِ مقاعدَ لا امتلاءَ مهما كثر الفريق', () => {
    expect(read([owner(), mk(), mk(), mk()], null).seatsFull).toBe(false);
  });
});
