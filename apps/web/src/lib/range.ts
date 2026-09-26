/**
 * ★ مدًى مخصَّصٌ بلا تحقّقٍ كان يُرسَل كما هو: نهايةٌ قبل بدايةٍ تُنتج تقريراً
 *   فارغاً يُقرأ «لا نشاط»، ونهايةٌ في المستقبل تُقرأ هبوطاً، وسنتان في طلبٍ
 *   واحدٍ تُثقلان الخادمَ بلا شاشةٍ تستطيع رسمَهما. والقواعدُ خالصةٌ هنا فتُختبر
 *   بالتنفيذ — والرسالةُ تقول ما يُفعل لا ما أُخطئ.
 */
export const MAX_RANGE_DAYS = 366;

export type RangeCheck = { ok: true; days: number } | { ok: false; message: string };

const DAY_MS = 86_400_000;

export function validateRange(from: string, to: string, today: Date = new Date()): RangeCheck {
  if (!from || !to) return { ok: false, message: 'اختر تاريخَ بدايةٍ وتاريخَ نهاية.' };
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(f) || Number.isNaN(t)) return { ok: false, message: 'تاريخٌ غيرُ صالح — الصيغةُ سنة-شهر-يوم.' };
  if (t < f) return { ok: false, message: 'النهايةُ قبل البداية — اقلبهما.' };
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (t > todayUtc) return { ok: false, message: 'النهايةُ في المستقبل — لا تقريرَ لما لم يقع بعد.' };
  const days = Math.round((t - f) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) {
    return { ok: false, message: `المدى ${days} يوماً والأقصى ${MAX_RANGE_DAYS} — قسّمه على تقريرين.` };
  }
  return { ok: true, days };
}
