'use client';

/**
 * عميل الـAPI.
 *
 * توكن الوصول يعيش في الذاكرة فقط — لا في `localStorage`.
 * السبب: أيّ سكربتٍ يُحقن في الصفحة يقرأ `localStorage`، بينما التوكن في
 * متغيّرٍ داخل وحدةٍ يموت مع التبويب. والاستمراريّة تأتي من كوكي التحديث
 * `HttpOnly` الذي لا يراه جافاسكربت أصلاً.
 */

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

/**
 * ★★★ **انتهاءُ الجلسة خبرٌ يُبلَّغ، لا تنقّلٌ يُنفَّذ من هنا.**
 *
 *   كان هذا الملفّ يكتب `location.href` بنفسه عند فشل التجديد — وهي تحميلٌ
 *   كاملٌ للصفحة يمحو شجرةَ React كلَّها. فيضيع نصُّ الشخصيّة الذي كُتب ولم
 *   يُحفظ (شاشة البوت)، وحقولُ الدعوة (الفريق)، و**الكلمةُ المؤقّتة المعروضة
 *   مرّةً واحدة** — والخادم لا يخزّنها نصّاً فلا سبيل إليها بعدها.
 *
 *   والأسوأ أنّه يقع من **استقصاءٍ في الخلفيّة**: إنبوكسٌ مفتوحٌ يسأل كلّ
 *   دقيقة، فتُمحى شاشةُ من لم يلمس شيئاً منذ ساعة وهو يكتب في تبويبٍ آخر.
 *
 *   فصار الملفُّ يُبلّغ، وقشرةُ الجلسة ترسم بوّابةً فوق ما هو مرسومٌ — والنصُّ
 *   المكتوبُ باقٍ خلفها، ويعود بلا تحميلٍ عند نجاح الاستئناف.
 */
const expiredWatchers = new Set<() => void>();
const resumedWatchers = new Set<() => void>();

export function watchExpired(fn: () => void): () => void {
  expiredWatchers.add(fn);
  return () => { expiredWatchers.delete(fn); };
}

export function watchResumed(fn: () => void): () => void {
  resumedWatchers.add(fn);
  return () => { resumedWatchers.delete(fn); };
}

/**
 * ★★ **وعلَمُ الموت قاطعُ دائرة.** التنقّلُ القديم كان — بلا قصد — هو ما يوقف
 *   حلقةَ الطلبات: الصفحةُ تُحمَّل من جديد فينتهي كلُّ مُستقصٍ. وبلاه يبقى
 *   إنبوكسٌ واقفٌ على البوّابة يطلب `/auth/refresh` كلَّ دقيقةٍ إلى الأبد —
 *   كلُّ مرّةٍ استعلامُ قاعدةٍ وكوكي محوٍ جديد. فالتجديدُ يُرفَض بلا شبكةٍ
 *   أصلاً ما دام العلَمُ مرفوعاً، ويسقط عند أوّل استئنافٍ ناجح.
 */
let dead = false;

function notifyExpired(): void {
  dead = true;
  for (const fn of expiredWatchers) fn();
}

function notifyResumed(): void {
  dead = false;
  for (const fn of resumedWatchers) fn();
}

export function setToken(t: string | null): void {
  accessToken = t;
  if (t) notifyResumed();
}
export function getToken(): string | null { return accessToken; }

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

/** رسائل بشريّة لأكواد المجال — لا «WINDOW_CLOSED» في وجه صاحب مطعم. */
const HUMAN: Record<string, string> = {
  WINDOW_CLOSED: 'نافذة الـ24 ساعة مغلقة. تُفتح حين يُرسل الزبون رسالة.',
  QUOTA_EXCEEDED: 'بلغ حسابك سقف الباقة لهذا الشهر.',
  CHANNEL_DISCONNECTED: 'القناة غير موصولة — راجع صفحة القنوات.',
  UNAUTHORIZED: 'انتهت جلستك. سجّل الدخول من جديد.',
  FORBIDDEN: 'لا صلاحيّة لديك لهذا الإجراء.',
  RATE_LIMITED: 'محاولاتٌ كثيرة. انتظر قليلاً.',
  VALIDATION: 'تحقّق من الحقول — بعضها غير صالح.',
  INTERNAL: 'صار خطأ عندنا. حاول ثانيةً، وإن تكرّر فأبلغنا.',
};

async function refresh(): Promise<boolean> {
  // نداءٌ واحد مهما تزامنت الطلبات — وإلّا دوّرنا الـrefresh مرّاتٍ وأبطلناه
  /* قاطعُ الدائرة: جلسةٌ ميّتةٌ لا تُسأل الشبكةُ عنها كلَّ دقيقة. */
  if (dead) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const j = (await res.json()) as { access: string };
      accessToken = j.access;
      /* تبويبٌ آخر استأنف الجلسة (الكوكي مشتركٌ بين التبويبات): البوّابةُ
         المرسومةُ هنا تُزال بلا أن يُعيد أحدٌ كتابةَ كلمته. */
      notifyResumed();
      return true;
    } catch {
      return false;
    } finally {
      queueMicrotask(() => { refreshing = null; });
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { retry?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });

  /**
   * ★ **«انتهت جلستك» كانت تُقال لمن أخطأ كلمةَ سرّه.**
   *
   *   هذا الفرعُ كان يلتقط **كلّ** ٤٠١ — بما فيها ردُّ `/auth/login` على كلمةٍ
   *   خاطئة — ويرمي رسالةً ثابتةً بلا أن يقرأ الجسم أصلاً. فمن أخطأ حرفاً في
   *   كلمته يُقال له إنّ جلستَه انتهت، فيُعيد الدخول بنفس الكلمة الخاطئة
   *   ويدور. ومن أُوقف حسابُه يُقال له الشيءُ نفسُه.
   *
   *   فالتجديدُ يُحاوَل حين يكون لدينا توكنٌ أصلاً — أي حين نظنّ أنّنا داخلون.
   *   و٤٠١ من نداءِ دخولٍ ليست انتهاءَ جلسة: هي جوابُ الخادم، ويُقرأ.
   */
  const hadToken = Boolean(accessToken);
  if (res.status === 401 && init.retry !== false && hadToken) {
    if (await refresh()) return api<T>(path, { ...init, retry: false });
    accessToken = null;
    /* ⚠️ و`/auth/logout` مستثنًى مع `/auth/login`: الخروجُ بتوكنٍ ميّتٍ كان
       يرسم البوّابةَ إطاراً واحداً قبل أن يصل التحويل. */
    if (!/^\/auth\/(login|logout)/.test(path)) notifyExpired();
    throw new ApiError('UNAUTHORIZED', HUMAN.UNAUTHORIZED!, 401);
  }

  if (!res.ok) {
    let code = 'INTERNAL';
    let message = HUMAN.INTERNAL!;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      /* ★ **رسالةُ الخادم تسبق الخريطةَ العامّة.**
         كان `HUMAN[code] ?? j.error?.message` — فالخريطةُ تغلب دائماً، وكلُّ
         ٤٠٠ يصير «تحقّق من الحقول» مهما قال الخادم بالضبط ما هو غير الصالح.
         والخادمُ يكتب رسائلَ عربيّةً دقيقةً (نطاقُ دوامٍ معطوب · مفتاحُ أداةٍ
         محجوز · سعرُ نموذجٍ غائب) — كلُّها كانت تُرمى.
         والخريطةُ تبقى احتياطاً لما لا رسالةَ له. */
      message = j.error?.message ?? HUMAN[code] ?? message;
    } catch { /* استجابةٌ ليست JSON — نبقي الرسالة العامّة */ }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, body?: unknown, headers?: HeadersInit) =>
  api<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers });
export const put = <T>(p: string, body: unknown) =>
  api<T>(p, { method: 'PUT', body: JSON.stringify(body) });
/** تعديلٌ جزئيّ: ما لا يُذكَر لا يُلمَس — فحفظُ تسميةٍ لا يمحو سرّاً. */
export const patch = <T>(p: string, body: unknown) =>
  api<T>(p, { method: 'PATCH', body: JSON.stringify(body) });
/* ★ `DELETE` بجسمٍ اختياريّ: إلغاءُ اشتراك الدفع يحتاج `endpoint` وهو نصٌّ
   طويلٌ لا يصلح في مسارٍ ولا في استعلامٍ يُسجَّل. والوسيط اختياريٌّ فلا
   يمسّ أيّ مُستدعٍ قائم. */
export const del = <T>(p: string, body?: unknown) =>
  api<T>(p, { method: 'DELETE', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/**
 * تنزيل ملفٍّ من نقطةٍ محميّة.
 *
 * ★ كان التصدير وسم ‎<a href download>‎ — والمتصفّح يتنقّل إليه **بلا ترويسة
 *   Authorization**، وتوكن الوصول يعيش في الذاكرة فقط لا في كوكي. فالنقطة
 *   ترفض بـ401 ويرى العميل صفحة خطأٍ بدل ملفّه. زرٌّ يبدو صالحاً ولا يعمل.
 *
 * الحلّ: نجلب بالعميل نفسه (فيه الترويسة وتجديد التوكن عند 401)، ثمّ نُنزّل
 * الناتج blobاً. و`revokeObjectURL` ليس تجميلاً: بلاه يبقى الملفّ في ذاكرة
 * التبويب حتّى إغلاقه.
 */
export async function download(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  let res = await fetch(`/api${path}`, { headers, credentials: 'include' });

  if (res.status === 401 && (await refresh())) {
    const h2 = new Headers();
    if (accessToken) h2.set('authorization', `Bearer ${accessToken}`);
    res = await fetch(`/api${path}`, { headers: h2, credentials: 'include' });
  }
  if (!res.ok) {
    throw new ApiError('DOWNLOAD_FAILED', `تعذّر التنزيل (${res.status})`, res.status);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** مفتاح تكرارٍ لكلّ إرسال: ضغطتان لا ترسلان رسالتين. */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}

export async function bootstrap(): Promise<boolean> {
  return refresh();
}

/**
 * ★ استئنافُ جلسةٍ **في مكانها** — بلا تحميلِ صفحةٍ ولا فقدِ ما كُتب.
 *
 *   يُنادى من بوّابة انتهاء الجلسة وحدها. و`retry: false` مقصود: ٤٠١ من نداء
 *   دخولٍ جوابُ الخادم لا انتهاءُ جلسة، فلا يُعاد التجديدُ عليه ولا تُرفع
 *   بوّابةٌ فوق بوّابة.
 */
export async function resumeSession(email: string, password: string): Promise<void> {
  const r = await api<{ access: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    retry: false,
  });
  setToken(r.access);
}
