import { z } from 'zod';

/**
 * ★★ **ملفُّ النشاط — منه تُبنى صفحاتُ العميل العامّة وحزمةُ ميتا.**
 *
 *   تطبيقُ ميتا لواتساب ملكُ العميل (BYO)، فسياسةُ الخصوصيّة والشروطُ
 *   وتعليماتُ حذف البيانات التي يطلبها تطبيقُه **باسمه هو** لا باسم AiBot.
 *   وكان المعالجُ يجمع ثلاثة حقولٍ فقط (الاسم والمعرّف وبريد المالك)، فكان
 *   كلُّ عميلٍ يحتاج أن يكتب صفحاتِه بنفسه في مكانٍ ما قبل أن يُفعَّل تطبيقُه.
 *
 *   والحقولُ تطابق ما يُسأل عنه عند توثيق النشاط لاحقاً — الاسمُ القانونيُّ
 *   حرفاً بحرف، والعنوانُ ورقمُ الهاتف — فيُكتب مرّةً ويُستعمل في الموضعين.
 *
 * ⚠️ والإنجليزيّةُ ليست ترفاً: مراجعُ ميتا يقرأ الصفحةَ غالباً بالإنجليزيّة،
 *    وصفحةٌ عربيّةٌ وحدها كانت سبباً مشهوراً لطلب «وضّح».
 */

/** شعارٌ مضمَّنٌ — صورةٌ صغيرةٌ مرمَّزة، لا ملفٌّ على قرصٍ لا نسخةَ له. */
export const LOGO_MAX_BYTES = 200_000;
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

const trimmed = (min: number, max: number, msg: string) =>
  z.string().trim().min(min, msg).max(max, `أطول من ${max} حرفاً.`);

/** ما يُحفظ. الحقولُ الاختياريّةُ فارغةٌ لا غائبة — فالنموذجُ يعيد ما أُرسل كما هو. */
export const BusinessProfileSchema = z.object({
  tradeAr: trimmed(2, 80, 'الاسم التجاريّ بالعربيّة مطلوب.'),
  tradeEn: z.string().trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 &.,'()-]{1,79}$/, 'الاسم التجاريّ بالإنجليزيّة مطلوب، بأحرفٍ إنجليزيّة — ميتا تعرضه اسماً للتطبيق.'),
  legalAr: trimmed(3, 160, 'الاسم القانونيّ مطلوب، كما في السجلّ التجاريّ.'),
  legalEn: z.string().trim().max(160).regex(/^[\x20-\x7E]*$/, 'الاسم القانونيّ بالإنجليزيّة بأحرفٍ إنجليزيّة.').default(''),
  cr: z.string().trim().max(40).default(''),
  country: trimmed(2, 60, 'الدولة مطلوبة.'),
  city: trimmed(2, 60, 'المدينة مطلوبة.'),
  address: trimmed(5, 200, 'العنوان مطلوب — تذكره صفحة الخصوصيّة.'),
  addressEn: z.string().trim().min(5, 'العنوان بالإنجليزيّة مطلوب للنسخة التي يقرؤها مراجع ميتا.')
    .max(200).regex(/^[\x20-\x7E]+$/, 'العنوان بالإنجليزيّة بأحرفٍ إنجليزيّة.'),
  phone: z.string().trim().regex(/^\+?[0-9 ]{8,18}$/, 'هاتفٌ بصيغةٍ دوليّة، مثل ‎+962 79 000 0000.'),
  email: z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'بريد التواصل غير صالح — ميتا ترفض التفعيل بدونه.'),
  site: z.string().trim().max(200)
    .refine((v) => v === '' || /^https:\/\/[^\s/.]+\.[^\s]+$/.test(v), 'رابطٌ يبدأ بـ https://')
    .default(''),
  category: z.string().trim().max(60).default(''),
  description: z.string().trim().max(400).default(''),
  logo: z.string().default('')
    .refine((v) => v === '' || (LOGO_RE.test(v) && v.length <= Math.ceil(LOGO_MAX_BYTES * 4 / 3) + 40),
      'الشعار صورة PNG أو JPEG أو WebP أصغر من 200 كيلوبايت.'),
});

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

/** ملفٌّ فارغٌ — لعميلٍ قديمٍ أُنشئ قبل الملفّ، أو قبل أن يُملأ. */
export function isProfileComplete(p: unknown): p is BusinessProfile {
  return BusinessProfileSchema.safeParse(p).success;
}

/** رسائلُ النقص بالحقل — للنموذج في الواجهة ولردّ ٤٠٠ في الخادم. */
export function profileIssues(p: unknown): Record<string, string> {
  const r = BusinessProfileSchema.safeParse(p);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? '_');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

/**
 * ★ روابطُ العميل العامّة — **مصدرٌ واحد** للمعالج وحزمة ميتا والفحص.
 *   صفحاتٌ على مسار الدومين نفسِه (‏`/b/<slug>`) لا نطاقاتٌ فرعيّة: المستوى
 *   الثاني تحت `aibot.masaros.net` لا تغطّيه شهادةُ Cloudflare المجّانيّة،
 *   وميتا تقبل أيّ رابط HTTPS عامّ يعيد 200.
 * ⚠️ والمعرّفُ لا يتغيّر بعد الإنشاء: هو جزءٌ من كلّ رابطٍ لُصق عند ميتا.
 */
export function businessUrls(publicUrl: string, slug: string) {
  const base = `${publicUrl.replace(/\/+$/, '')}/b/${slug}`;
  return {
    profile: base,
    privacy: `${base}/privacy`,
    terms: `${base}/terms`,
    deletion: `${base}/data-deletion`,
  };
}
export type BusinessUrls = ReturnType<typeof businessUrls>;

/** ما تُعيده نقطةُ الصفحات العامّة — لا حقلَ فيه ليس منشوراً على الصفحة أصلاً. */
export interface PublicBusinessDTO {
  slug: string;
  profile: BusinessProfile;
  retentionDays: number;
  channels: { whatsapp: boolean; instagram: boolean };
  updatedAt: string | null;
}

/** حزمةُ ميتا: كلُّ ما يُلصق في تطبيق العميل عند ميتا، من مصدرٍ واحد. */
export interface MetaKitDTO {
  urls: BusinessUrls;
  profileComplete: boolean;
  missing: Record<string, string>;
  appSettings: {
    displayName: string;
    contactEmail: string;
    privacyUrl: string;
    termsUrl: string;
    dataDeletionUrl: string;
    appDomain: string;
    category: string;
    purpose: string;
  };
  whatsapp: { callbackUrl: string; verifyToken: string | null; webhookField: 'messages' };
}

export interface LinkCheckDTO {
  checkedAt: string;
  ok: boolean;
  items: Array<{ key: keyof BusinessUrls; url: string; status: number | null; hasName: boolean; hasEmail: boolean; error: string | null }>;
}
