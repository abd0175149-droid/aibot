/**
 * هندسةُ الرسم — حسابٌ خالصٌ بلا JSX ولا DOM، ولذلك يُختبَر.
 *
 * ★ **لا مكتبةَ رسم.** والسبب ليس الحجم: مكتبةُ الرسوم تأتي بمفرداتها
 *   (سلاسلُ ألوانٍ، وتلميحاتٌ، ومحاورُ «جميلة») وتنقض قواعدَ هذا النظام
 *   واحدةً واحدة — اللونُ مِلكُ الحالة، والزمنُ من اليمين إلى اليسار،
 *   والتسميةُ تُسمّي قيمةً يبلغها الرسم. فما يبقى من المكتبة بعد ترويضها
 *   أقلُّ من هذا الملفّ.
 *
 * ★ **والزمنُ يجري من اليمين إلى اليسار.** فالفهرسُ صفرٌ = أقدمُ يومٍ =
 *   **يمينُ** الرسم، وآخرُ فهرسٍ = اليوم = يساره. وهذا قرارُ قراءةٍ عربيّةٍ
 *   لا تفصيلُ تنفيذ: القارئُ يبدأ من حيث يبدأ السطر.
 *
 * ★ **ولا نصَّ داخل SVG.** الرسمُ يُمَطّ أفقيّاً (`preserveAspectRatio="none"`)
 *   ليأخذ عرضَ حاويه بلا تشويهٍ رأسيّ — ونصٌّ داخله يُمَطّ معه فيصير حروفاً
 *   عريضةً على شاشةٍ واسعة. فالتسمياتُ عناصرُ HTML تحمل توكِنات الثيم
 *   وأرضيّةَ المقاس، والمقياسُ هو من يضع الاثنين: العلامةَ في SVG والتسميةَ
 *   في الشبكة المقابلة لها.
 */

/** عرضُ مساحة الرسم وارتفاعُها بوحدات `viewBox` — والارتفاعُ يقابل ارتفاعَ CSS. */
export const PLOT_W = 300;
export const PLOT_H = 100;

/** أعلى قيمةٍ في كلّ السلاسل — مقياسٌ واحدٌ يقارن بين المدى والسابق. */
export function maxOf(...series: Array<ReadonlyArray<number>>): number {
  let max = 0;
  for (const s of series) {
    for (const v of s) if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/**
 * موضعُ قيمةٍ رأسيّاً.
 *
 * ★ **والصفرُ في الأسفل أبداً**: محورٌ يبدأ من أدنى قيمةٍ مقيسةٍ يضاعف مَيلَ
 *   الخطّ بصرياً، فيُقرأ «انهيارٌ» ما هو نزولُ نقطتَين. وهذه شاشةٌ يُسأل فيها
 *   «هل تحسّن؟» — فقصُّ المحور فيها كذبةٌ لا اختصار.
 */
export function yOf(v: number, max: number, h: number = PLOT_H): number {
  if (!(max > 0) || !Number.isFinite(v)) return h;
  const t = Math.min(Math.max(v / max, 0), 1);
  return h - t * h;
}

/** موضعُ اليومِ رقم `i` أفقيّاً — والأقدمُ يمين. ويومٌ وحيدٌ يقف في الوسط. */
export function xOf(i: number, n: number, w: number = PLOT_W): number {
  if (n <= 1) return w / 2;
  return w - (i / (n - 1)) * w;
}

export interface ChartPoint { x: number; y: number }

export function pointsOf(
  values: ReadonlyArray<number>,
  max: number,
  w: number = PLOT_W,
  h: number = PLOT_H,
): ChartPoint[] {
  return values.map((v, i) => ({ x: xOf(i, values.length, w), y: yOf(v, max, h) }));
}

/** مسارٌ مفتوح. والتقريبُ إلى منزلتَين يقصّ نصفَ حجم السمة بلا فرقٍ يُرى. */
export function pathOf(pts: ReadonlyArray<ChartPoint>): string {
  if (!pts.length) return '';
  const r = (n: number) => Math.round(n * 100) / 100;
  return pts.map((p, i) => `${i ? 'L' : 'M'}${r(p.x)} ${r(p.y)}`).join(' ');
}

/**
 * ★ **القياسُ يُفصَل عن الناقص.** آخرُ يومٍ في مدًى ينتهي اليوم **لم ينتهِ**،
 *   فنقطتُه أدنى من حقيقتها بحكم الساعة لا بحكم البوت. ووصلُها بخطٍّ صلبٍ
 *   يرسم هبوطاً كلَّ يوم. فيُقسَم المسار: المقيسُ صلبٌ، والقطعةُ الأخيرة
 *   مقطَّعةٌ ومسمّاةٌ في مفتاح القراءة.
 */
export function splitOpen(pts: ReadonlyArray<ChartPoint>, openEnd: boolean): {
  solid: ChartPoint[]; open: ChartPoint[];
} {
  if (!openEnd || pts.length < 2) return { solid: [...pts], open: [] };
  return { solid: pts.slice(0, -1), open: pts.slice(-2) };
}

/** خانةُ عمودٍ في شبكةٍ منتظمة — والأوّلُ يمين، كالزمن. */
export function slotOf(i: number, n: number, w: number = PLOT_W, gap = 0.28): {
  x: number; width: number;
} {
  const step = w / Math.max(n, 1);
  const width = Math.max(step * (1 - gap), 0.5);
  return { x: w - (i + 1) * step + (step - width) / 2, width };
}

/** ارتفاعُ عمودٍ — وأرضيّةٌ مرئيّةٌ لأيّ قيمةٍ موجبة، فالصفرُ وحده يبقى فارغاً. */
export function barOf(v: number, max: number, h: number = PLOT_H): {
  y: number; height: number;
} {
  if (!(max > 0) || v <= 0) return { y: h, height: 0 };
  const height = Math.max((Math.min(v, max) / max) * h, 1.2);
  return { y: h - height, height };
}

export type Dir = 'up' | 'dn' | 'flat';

/**
 * الفرقُ عن خطّ الأساس.
 *
 * ★ و`eps` ليست تجميلاً: نسبةٌ تتحرّك من 84.1٪ إلى 84.3٪ **ليست اتّجاهاً** —
 *   وسهمٌ صاعدٌ عليها يعلّم القارئ أن يتجاهل السهم. فما دون العتبة «ثابت»
 *   بالنصّ والعلامة معاً.
 *
 * ★ ويُرجع `null` حين لا خطَّ أساسٍ أصلاً: مدًى سابقٌ بلا بياناتٍ لا يُنتج
 *   «صفراً» ولا «ارتفاعاً لا نهائيّاً» — يُنتج «لا مقارنة»، وهي تُقال.
 */
export function deltaOf(cur: number | null, prev: number | null, eps = 0): {
  dir: Dir; diff: number;
} | null {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const diff = cur - prev;
  if (Math.abs(diff) <= eps) return { dir: 'flat', diff };
  return { dir: diff > 0 ? 'up' : 'dn', diff };
}

/**
 * النسبةُ من خطّ الأساس — للكلفة والحجم حيث «الضِّعف» أقرأُ من «+٠.٠٣ دولار».
 * وتُرجع `null` على خطِّ أساسٍ صفريّ: القسمةُ على صفرٍ ليست «زيادةً لا نهائيّة».
 */
export function ratioOf(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || !(prev > 0)) return null;
  return cur / prev;
}
