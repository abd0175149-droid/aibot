import type { Sev } from '@/components/screen';

/**
 * ★ قراءةُ فحص التكرار — **قرارٌ لا عرض**، فمكانُه هنا ولا يُكرَّر في JSX.
 *
 * العطل الذي وُلدت منه هذه الدالّة وقع فعلاً في أوّل تجميعٍ للشاشة: القائمة
 * تصل من نقطةٍ وفحصُ التكرار من أخرى، والفحصُ أبطأ. فكان الشريطُ الحاكم
 * يقرأ «صفر مرشَّحين» **قبل أن يُفحَص شيء** فيضيء أخضرَ ويقول «لا بطاقةَ
 * مرشَّحةً للدمج» — خبرٌ سارٌّ كاذبٌ يُقرأ في نصف ثانيةٍ ويُغلق عليه الصاحبُ
 * الشاشة. وهذا أسوأُ ما تفعله شاشةُ تنبيه: لا تصمت، بل **تطمئن بالخطأ**.
 *
 * ولذلك «يُفحَص» حالةٌ مستقلّةٌ عن «نظيف»، و«تعذّر الفحص» ثالثةٌ عنهما:
 * ثلاثُ حالاتٍ لا اثنتان، ولا رقمَ بطوليّاً قبل أن يُعرف.
 *
 * ★ وواحدةٌ لكلّ رسم: الشريطُ والبطوليُّ ورقاقةُ الترشيح كانت تُشتقّ كلٌّ
 *   منها شرطَها بنفسها — وثلاثُ نسخٍ من شرطٍ واحد هي الصيغةُ التي يُصلَح
 *   فيها موضعٌ ويُنسى الآخران، فيقول الشريطُ شيئاً والبطوليُّ غيرَه في نفس
 *   الرسم.
 */

export interface DupFacts {
  loading: boolean;
  error: boolean;
  /** `null` ما لم يصل الفحص بعد — والفراغُ ليس صفراً. */
  scan: { records: number; pairs: number } | null;
  /** كلُّ الجهات — مقامُ النسبة، ويصل قبل الفحص. */
  total: number;
}

export interface DupRead {
  state: 'scanning' | 'failed' | 'clean' | 'dirty';
  sev: Sev;
  /** عددُ البطاقات الزائدة، أو `null` فيُرسَم «—» بدل رقمٍ لا يُعرف. */
  records: number | null;
  pairs: number;
  /** نسبةُ الزائد من كلّ الجهات — كسرٌ لا مئويّة. */
  pct: number;
}

/**
 * عتبةُ «خطير»: عُشرُ القاعدة.
 *
 * ★ ورقمُها مكتوبٌ **هنا وحده**: كان مكرّراً في الشريط وفي البطوليّ، فتغييرُه
 *   في أحدهما يُنتج شريطاً أحمرَ فوق رقمٍ كهرمانيّ. والعتبةُ شاملةٌ لحدّها
 *   (`>=`): عُشرُ قاعدتك تكرارٌ خبرٌ خطيرٌ عند العُشر لا بعده.
 */
export const DUP_CRIT = 0.1;

export function readDuplicates(f: DupFacts): DupRead {
  if (!f.scan) {
    /* الخطأُ يسبق «يُفحَص»: فحصٌ سقط لا يعود، وشريطُ «ننتظر» عليه كذبٌ ثانٍ. */
    if (f.error) return { state: 'failed', sev: 'warn', records: null, pairs: 0, pct: 0 };
    if (f.loading) return { state: 'scanning', sev: 'plain', records: null, pairs: 0, pct: 0 };
    /* لا تحميلٌ ولا خطأٌ ولا بيان: لا يُدَّعى نظافةٌ على ما لم يُفحص. */
    return { state: 'scanning', sev: 'plain', records: null, pairs: 0, pct: 0 };
  }
  const { records, pairs } = f.scan;
  const pct = f.total > 0 ? records / f.total : 0;
  if (records <= 0) return { state: 'clean', sev: 'good', records: 0, pairs, pct: 0 };
  return { state: 'dirty', sev: pct >= DUP_CRIT ? 'bad' : 'warn', records, pairs, pct };
}

/**
 * أيُّ بطاقةٍ تبقى — **نفسُ ترتيب الخادم** (`pickKeep`)، وهي مذكورةٌ هنا
 * لأنّ الواجهة تقرأ الطرفين من الزوج وترتّبهما للعرض. والخادم هو الحكم:
 * `suggestKeep` يأتي منه، وهذه تقرؤه ولا تعيد حسابه.
 */
export function sidesOf<T extends { id: string }>(
  a: T, b: T, suggestKeep: string,
): { keep: T; absorb: T } {
  return suggestKeep === a.id ? { keep: a, absorb: b } : { keep: b, absorb: a };
}
