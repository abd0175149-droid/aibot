import { describe, it, expect } from 'vitest';
import {
  PLOT_W, PLOT_H,
  maxOf, yOf, xOf, pointsOf, pathOf, splitOpen, slotOf, barOf, deltaOf, ratioOf,
} from '../src/app/app/reports/chart.js';

/**
 * ★ هندسةُ الرسم تُختبَر لأنّها **تكذب بلا أن تنكسر**.
 *
 * رسمٌ مقلوبُ المحور يُرسم جميلاً ويُقرأ بالعكس: «هل تحسّن؟» يُجاب «نعم» وهو
 * «لا». ورسمٌ بمقياسَين يجعل الشكلَين قابلَين للمقارنة وهما ليسا كذلك. ولا
 * تمسك المراجعةُ شيئاً من هذا: الكود يبدو صحيحاً، والصورةُ تبدو صحيحة.
 */

describe('المحورُ الأفقيّ — الزمن من اليمين إلى اليسار', () => {
  it('★ أقدمُ يومٍ يمينٌ وآخرُ يومٍ يسار — وهذا اتّجاهُ القراءة العربيّة', () => {
    expect(xOf(0, 30)).toBe(PLOT_W);   // الأقدم: أقصى اليمين
    expect(xOf(29, 30)).toBe(0);       // اليوم: أقصى اليسار
    // ومتناقصٌ فعلاً بين الطرفَين، لا مجرّد طرفَين صحيحَين
    const xs = Array.from({ length: 10 }, (_, i) => xOf(i, 10));
    expect(xs).toEqual([...xs].sort((a, b) => b - a));
  });

  it('يومٌ وحيدٌ يقف في الوسط — لا في طرفٍ ولا بقسمةٍ على صفر', () => {
    expect(xOf(0, 1)).toBe(PLOT_W / 2);
    expect(Number.isFinite(xOf(0, 0))).toBe(true);
  });
});

describe('المحورُ الرأسيّ — والصفرُ في الأسفل أبداً', () => {
  it('★ لا يُقصّ من أدنى قيمةٍ مقيسة — فقصُّه يضاعف الميلَ ويخترع انهياراً', () => {
    // 78 و80 على مقياسٍ يبدأ من الصفر: فرقٌ لا يكاد يُرى، وهو الحقيقة
    const a = yOf(78, 80);
    const b = yOf(80, 80);
    expect(Math.abs(a - b)).toBeLessThan(PLOT_H * 0.05);
    expect(b).toBe(0);
    expect(yOf(0, 80)).toBe(PLOT_H);
    expect(yOf(40, 80)).toBe(PLOT_H / 2);
  });

  it('لا ينهار على مقياسٍ صفريٍّ ولا على قيمةٍ غير عدديّة', () => {
    expect(yOf(5, 0)).toBe(PLOT_H);
    expect(yOf(0, 0)).toBe(PLOT_H);
    expect(yOf(Number.NaN, 10)).toBe(PLOT_H);
    // وقيمةٌ فوق المقياس تُحصر داخل اللوح ولا تخرج منه
    expect(yOf(200, 100)).toBe(0);
  });
});

describe('المقياسُ واحدٌ للمدى والسابق', () => {
  it('★ أعلى قيمةٍ في السلسلتَين معاً — ومقياسان يجعلان الشكلَين كاذبَي المقارنة', () => {
    expect(maxOf([1, 9, 3], [4, 20, 2])).toBe(20);
    expect(maxOf([5])).toBe(5);
  });

  it('سلسلةٌ فارغةٌ أو صفريّةٌ تُعطي صفراً لا `-Infinity`', () => {
    expect(maxOf([])).toBe(0);
    expect(maxOf([], [])).toBe(0);
    expect(maxOf([0, 0])).toBe(0);
    expect(maxOf([Number.NaN, 3])).toBe(3);
  });

  it('والسلسلتان على نفس المقياس تُرسمان على نفس الارتفاع لنفس القيمة', () => {
    const max = maxOf([10, 20], [5, 20]);
    expect(pointsOf([20], max)[0]?.y).toBe(pointsOf([20], max)[0]?.y);
    expect(yOf(10, max)).toBe(PLOT_H / 2);
  });
});

describe('المسار — ومسافةُ اليوم الناقص', () => {
  it('يبني مساراً مفتوحاً يبدأ من اليمين', () => {
    const d = pathOf(pointsOf([0, 50, 100], 100));
    expect(d.startsWith('M300 100')).toBe(true);
    expect(d).toContain('L150 50');
    expect(d.endsWith('L0 0')).toBe(true);
  });

  it('لا مسارَ من نقاطٍ فارغة — ولا «M» وحدها في السمة', () => {
    expect(pathOf([])).toBe('');
  });

  it('★ اليومُ الجاري يُفصَل عن المقيس — وقطعةٌ صلبةٌ عليه ترسم هبوطاً كلّ يوم', () => {
    const pts = pointsOf([5, 6, 7, 2], 10);
    const { solid, open } = splitOpen(pts, true);
    expect(solid).toHaveLength(3);
    expect(open).toHaveLength(2);
    // القطعةُ المقطَّعة تبدأ من آخر نقطةٍ مقيسةٍ فلا تنفصل عن الخطّ
    expect(open[0]).toEqual(solid[solid.length - 1]);
    expect(open[1]).toEqual(pts[3]);
  });

  it('ومدًى منتهٍ لا يُقطَّع منه شيء', () => {
    const pts = pointsOf([5, 6, 7], 10);
    const { solid, open } = splitOpen(pts, false);
    expect(solid).toEqual(pts);
    expect(open).toEqual([]);
  });

  it('ونقطةٌ واحدةٌ لا تُقسَم إلى قطعةٍ بلا طرف', () => {
    const pts = pointsOf([5], 10);
    expect(splitOpen(pts, true)).toEqual({ solid: pts, open: [] });
  });
});

describe('الأعمدة — خاناتٌ منتظمةٌ وأرضيّةٌ مرئيّة', () => {
  it('★ الأوّلُ يمينٌ كالزمن، ولا خانتان تتراكبان ولا واحدةٌ تخرج من اللوح', () => {
    const n = 7;
    const slots = Array.from({ length: n }, (_, i) => slotOf(i, n));
    expect(slots[0]!.x).toBeGreaterThan(slots[n - 1]!.x);
    expect(slots[n - 1]!.x).toBeGreaterThanOrEqual(0);
    expect(slots[0]!.x + slots[0]!.width).toBeLessThanOrEqual(PLOT_W);
    for (let i = 1; i < n; i += 1) {
      expect(slots[i]!.x + slots[i]!.width).toBeLessThanOrEqual(slots[i - 1]!.x + 0.001);
    }
  });

  it('وأربعٌ وعشرون خانةً تبقى بعرضٍ يُرى', () => {
    expect(slotOf(0, 24).width).toBeGreaterThan(0.5);
  });

  it('★ أرضيّةٌ مرئيّة: قيمةٌ ضئيلةٌ تُرسم أثراً، والصفرُ وحده يبقى فارغاً', () => {
    // 1 من 72 = 1.4٪ — بلا أرضيّةٍ يُرسم شريطاً فارغاً يُقرأ «معطوباً» لا «منخفضاً»
    expect(barOf(1, 72).height).toBeGreaterThanOrEqual(1.2);
    expect(barOf(0, 72)).toEqual({ y: PLOT_H, height: 0 });
    expect(barOf(72, 72)).toEqual({ y: 0, height: PLOT_H });
    // والقمّةُ والارتفاعُ يتقابلان دائماً فلا يخرج العمودُ من أسفل اللوح
    const b = barOf(30, 72);
    expect(b.y + b.height).toBeCloseTo(PLOT_H, 6);
  });

  it('ولا عمودَ على مقياسٍ صفريّ', () => {
    expect(barOf(5, 0).height).toBe(0);
  });
});

describe('الفرقُ عن خطّ الأساس — ولا مقارنةَ بلا خطّ أساس', () => {
  it('★ يُرجع `null` حين لا مدًى سابق — لا «صفراً» ولا «ارتفاعاً لا نهائيّاً»', () => {
    expect(deltaOf(0.8, null)).toBeNull();
    expect(deltaOf(null, 0.8)).toBeNull();
    expect(deltaOf(null, null)).toBeNull();
    expect(ratioOf(5, 0)).toBeNull();
    expect(ratioOf(5, null)).toBeNull();
  });

  it('★ وما دون العتبة «ثابت» — وسهمٌ على 0.2 نقطةٍ يعلّم القارئ تجاهلَ السهم', () => {
    expect(deltaOf(0.843, 0.841, 0.02)?.dir).toBe('flat');
    expect(deltaOf(0.87, 0.841, 0.02)?.dir).toBe('up');
    expect(deltaOf(0.80, 0.841, 0.02)?.dir).toBe('dn');
    // وبلا عتبةٍ يبقى التساوي ثابتاً لا صاعداً
    expect(deltaOf(7, 7)?.dir).toBe('flat');
  });

  it('والمقدارُ يُعاد كما هو بإشارته — والشاشةُ تأخذ قيمته المطلقة', () => {
    expect(deltaOf(10, 4)?.diff).toBe(6);
    expect(deltaOf(4, 10)?.diff).toBe(-6);
    expect(ratioOf(0.024, 0.012)).toBeCloseTo(2, 6);
  });
});
