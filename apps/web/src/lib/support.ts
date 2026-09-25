/**
 * ★ **قناةُ التواصل — موضعٌ واحد، وبلا JSX.**
 *
 *   العطل الذي تمنعه: العميل يبلغ سقف باقته، فيصله إشعارٌ يفتح `/app/usage`،
 *   والفعلُ الأوّل (والوحيد) في رصيفها «نزِّل الجدول (CSV)». و«راسلنا» في ثلاث
 *   شاشاتٍ نصٌّ بلا رابط. فالشاشةُ التي يفتحها إشعارُ «توقّف بوتك» تعطيه ملفّاً
 *   ولا تعطيه مخرجاً — **ورفعُ السقف قرارٌ بشريٌّ عندنا**: لا بوّابةَ دفعٍ ولا
 *   ترقيةً ذاتيّة. أي أنّ التواصل هو الفعل نفسُه لا زينةٌ تحته.
 *
 * ⚠️ والملفُّ بلا JSX عمداً: `apps/web` بلا `vitest.config`، و`tsconfig` فيه
 *    `jsx: "preserve"`، فاستيرادُ `.tsx` في اختبارٍ يترك JSX غيرَ محوَّل.
 *    فالنصوصُ والعناوين هنا لتُفحَص، و`SupportLink` في `components/support.tsx`.
 *
 * ⚠️ و`email` صندوقٌ **يجب أن يكون موجوداً فعلاً**: طريقٌ مسدودٌ أهون من بريدٍ
 *    يُرسَل إلى العدم. والنمطُ قائمٌ في النطاق — `privacy@` منشورٌ في سياسة
 *    الخصوصيّة. فإن تغيّر الصندوق فهذا سطرٌ واحدٌ يُبدَّل.
 */
export const SUPPORT = {
  email: 'support@aibot.masaros.net',
  /** يبقى `null` حتّى يوجد رقمٌ حقيقيّ — لا نُولّد رابطاً لرقمٍ مفترَض. */
  whatsapp: null as string | null,
};

export function supportMailto(subject: string, body?: string): string {
  const q = [`subject=${encodeURIComponent(subject)}`];
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${SUPPORT.email}?${q.join('&')}`;
}

/**
 * ★ نصُّ الفعل يتبدّل بسياسة التجاوز: `allow_bill` لا يوقف البوت بل يُفوتِر
 *   الزائد، فقولُ «لرفع سقفك» لمن لا يقف بوتُه يَعِد بفعلٍ ليس ما يحتاجه.
 */
export function planTalkLabel(policy: string | undefined): string {
  return policy === 'allow_bill'
    ? 'راسلنا لمراجعة باقتك — الزائد يُفوتَر'
    : 'راسلنا لرفع سقف باقتك';
}

export function planTalkSubject(period?: string): string {
  return period ? `رفعُ سقف الباقة — ${period}` : 'رفعُ سقف الباقة';
}

/** جسمُ الرسالة يحمل الأرقام، فلا يُسأل العميلُ عمّا تعرفه الشاشة. */
export function planTalkBody(used: number, limit: number, period?: string): string {
  const where = period ? `في دورة ${period}` : 'هذا الشهر';
  return `المستهلَك ${used} من ${limit} نافذة ${where}.`;
}
