/**
 * حارس التحويل بعد الدخول.
 *
 * ★ ثغرةٌ أمنيّة حقيقيّة كانت هنا: `?next=` كان يُمرَّر إلى `router.replace`
 *   كما جاء. فرابطٌ مثل `/login?next=//evil.example` أو
 *   `?next=https://evil.example` يقذف المستخدم خارج الموقع **بعد** أن نضبط
 *   توكن الوصول — وهي اللحظة التي يكون فيها أكثر استعداداً للثقة بالصفحة
 *   التالية، فيلصق كلمة سرّه في نسخةٍ مزيّفة من شاشتنا. تحويلٌ مفتوحٌ كلاسيكيّ.
 *
 * الحدّ: مسارٌ داخليٌّ واحد. والرفض صامت — لا نعرض خطأً عن رابطٍ صنعه مهاجم،
 * فالرسالة تُعلّمه ما يُصلح بينما المستخدم لم يفعل شيئاً.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // مسارٌ نسبيٌّ فقط
  if (!raw.startsWith('/')) return null;
  // `//host` عنوانٌ مطلقٌ بروتوكولُه ضمنيّ — وهو أشيع تجاوزٍ لفحص «يبدأ بـ/»
  if (raw.startsWith('//')) return null;
  // `/\host` تعامله بعض المتصفّحات معاملة `//host`
  if (raw.startsWith('/\\')) return null;
  // النقطتان تمنعان `javascript:` و`data:` بأيّ التفاف
  if (raw.includes(':')) return null;
  // تقسيم الردّ بمحارف التحكّم
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
