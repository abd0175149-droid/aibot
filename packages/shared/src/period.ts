/**
 * ★★ **دورةُ الفوترة تُحسم في موضعٍ واحدٍ — وكانت تُحسم في أربعة.**
 *
 *   `outbound.ts` و`reports.ts` كلٌّ بدالّته الخاصّة وافتراضِها «عمّان»،
 *   و`/console/usage` بشهر UTC، وجدولُ العملاء وحده يقرأ `tenants.timezone`.
 *   فعدّادُ النوافذ وعدّادُ التوكنز في لوحة الهامش كانا يختلفان ثلاثَ ساعاتٍ
 *   عند رأس الشهر، وعميلٌ منطقتُه غيرُ عمّان يُفوتَر على دورةٍ لا تخصّه.
 *
 * ⚠️ **لا افتراضَ للمنطقة هنا عمداً.** من لا يملك منطقةَ المستأجر لا يملك
 *    دورتَه — فيُجبَر المستدعي على قراءتها من `tenants.timezone`، ولا يعود
 *    «عمّان» يتسلّل بصمتٍ من مُعامِلٍ اختياريّ. و`DEFAULT_TZ` لِما لا مستأجرَ له
 *    (عنوانُ ملفٍّ، تمرين) لا للحساب.
 */
export const DEFAULT_TZ = 'Asia/Amman';

/** الشهرُ `YYYY-MM` بتوقيت المستأجر — نافذةٌ تُفتح آخرَ الشهر تُفوتَر على شهر فتحها عنده. */
export function billingPeriod(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}
