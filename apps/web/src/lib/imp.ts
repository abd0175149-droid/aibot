/**
 * ★ حسابُ مدّة الانتحال — خالصٌ بلا React، فيُختبر بالتنفيذ لا بمسح القشرة.
 *
 *   توكنُ الانتحال ينقضي بعد ثلاثين دقيقة، وكان انقضاؤه **صامتاً**: أوّلُ
 *   ٤٠١ يُجدَّد من جلستك أنت بلا `imp`، فتصير كلُّ نداءات مسارات العميل ٤٠٣
 *   تحت لافتةٍ ما زالت تقول «انتحال نشط». والقشرةُ الآن تعرف الأجلَ من
 *   `/me` وتعدّ تنازليّاً وتخرج قبله بقليل.
 */

/** الأجلُ المتبقّي بالمِلّي ثانية — `null` حين لا انتحال، وسالبٌ حين انقضى. */
export function impRemainingMs(expiresAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  return t - now;
}

/**
 * نصُّ المتبقّي بالدقائق صعوداً: «٣ دقائق» أصدق لقارئ لافتةٍ من «٢:٤٠» تتغيّر
 * كلَّ ثانية. والصفرُ يُقال «انتهت» لا «٠ دقيقة».
 */
export function impRemainingLabel(ms: number | null): string {
  if (ms == null) return '';
  if (ms <= 0) return 'انتهت المدّة';
  const m = Math.ceil(ms / 60_000);
  if (m <= 1) return 'أقلّ من دقيقة';
  if (m === 2) return 'دقيقتان';
  if (m <= 10) return `${m} دقائق`;
  return `${m} دقيقة`;
}

/**
 * ⚠️ الخروجُ قبل الأجل بخمس ثوانٍ لا عنده: ساعةُ المتصفّح والخادم لا تتطابقان
 *    تماماً، وطلبٌ يخرج قبل الأجل بثانيةٍ يصل بعده فيُردّ عليه ٤٠١ ثمّ ٤٠٣.
 */
export const IMP_LEAVE_EARLY_MS = 5_000;

/** معاملُ العودة بعد انقضاءٍ آليّ — تقرؤه شاشةُ العملاء فتقول ما حدث. */
export const IMP_EXPIRED_QUERY = 'imp=expired';
