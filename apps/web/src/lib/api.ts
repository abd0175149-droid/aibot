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

export function setToken(t: string | null): void { accessToken = t; }
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
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return false;
      const j = (await res.json()) as { access: string };
      accessToken = j.access;
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

  // 401 مرّةً واحدة: جدّد ثمّ أعِد. وإن فشل التجديد فالجلسة انتهت فعلاً.
  if (res.status === 401 && init.retry !== false) {
    if (await refresh()) return api<T>(path, { ...init, retry: false });
    accessToken = null;
    if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
    throw new ApiError('UNAUTHORIZED', HUMAN.UNAUTHORIZED!, 401);
  }

  if (!res.ok) {
    let code = 'INTERNAL';
    let message = HUMAN.INTERNAL!;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = HUMAN[code] ?? j.error?.message ?? message;
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
