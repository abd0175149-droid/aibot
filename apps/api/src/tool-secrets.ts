import { MASKED } from '@aibot/core';

/**
 * ★ **بيانات اعتماد أدوات العميل كانت تسكن عموداً غير مشفَّر.**
 *
 *   `bot_tools.secrets_enc` مشفَّرٌ بـ`MASTER_KEY`، و`bot_tools.http` **ليس**.
 *   والباني يعرض حقلَ «ترويسة المصادقة» نصّاً حرّاً باقتراحٍ لطيف
 *   (`Bearer {{secret.API_TOKEN}}`) — ومن يكتب أداته بسرعة يلصق التوكنَ
 *   نفسَه هناك. فينتهي توكنُ نظام العميل **نصّاً صريحاً** في `jsonb`:
 *
 *   · يظهر في `GET /bot/tools` لكلّ من يملك توكن دخولٍ صالحاً للمستأجر،
 *   · ويخرج في كلّ نسخةٍ احتياطيّةٍ غيرِ مشفَّرة،
 *   · ويُطبَع في «العنوان الذي نودي فعلاً» بعد الاستبدال.
 *
 * ★ والعلاجُ **ترحيلٌ لا رفض**: من كتب توكناً حرفيّاً يُنقل توكنُه إلى الخزنة
 *   المشفَّرة وتُستبدل الترويسةُ بمرجعٍ إليه — بلا أن يُمنع من الحفظ. الرفضُ
 *   كان يحبس المالك: أداةٌ معطوبةٌ لا تُصحَّح إلّا بحفظ، والحفظُ مرفوض.
 */

/** ما يُعرض بدل السرّ في القوائم. */
export { MASKED };

/**
 * أسماءُ ترويساتٍ تحمل بيانات اعتماد — مطابقةٌ على **مقاطع** الاسم لا على
 * أيّ ظهور: `Idempotency-Key` ليس سرّاً و`X-Api-Key` سرّ.
 */
const CRED_HEADER =
  /(^|[^a-z0-9])(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|apikey|auth[-_]?token|access[-_]?token|private[-_]?token|functions[-_]?key|token|secret|password|passwd|pwd|signature|hmac|credential)([^a-z0-9]|$)/i;

/** ومُعامِلاتُ العنوان — أوسعُ قليلاً لأنّ أسماءها أقصر. */
const CRED_PARAM =
  /(^|[^a-z0-9])(api[-_]?key|apikey|key|auth|authorization|token|secret|password|passwd|pwd|sig|signature|hmac|credential|access[-_]?token)([^a-z0-9]|$)/i;

export function isCredentialHeader(name: string): boolean {
  return CRED_HEADER.test(name);
}

/**
 * ★ **القيمةُ التي تحمل قالباً لا تُلمس إطلاقاً** — وهذا هو الفخّ.
 *
 *   `Authorization: Bearer {{token}}` حيث `token` **مُعامِلٌ** لا سرّ: لو
 *   نُقلت القيمةُ كلُّها إلى الخزنة صارت الترويسةُ `{{secret.h_authorization}}`،
 *   ويستبدلها `renderTemplate` مرّةً واحدةً فيبقى `{{token}}` نصّاً حرفيّاً
 *   داخل الترويسة — أداةٌ كانت تعمل تُرسل الآن قالباً غيرَ مُستبدَل.
 */
export function hasTemplate(v: string): boolean {
  return v.includes('{{');
}

/**
 * هل تبدو القيمةُ سرّاً فعلاً؟ يُستعمل لبناء مجموعة الحجب في التشخيص وحدَه.
 *
 * ⚠️ بلا هذا الفحص كان حجبُ «كلّ قيمةِ مُعامِلٍ اسمُه يحمل `key`» يشطب كلماتٍ
 *    عاديّة: `?sort_key=name` يجعل كلَّ ظهورٍ للنصّ «name» في الاستجابة
 *    `•••` — فيصير التشخيصُ بلا معنى، وهو الغرضُ منه.
 */
export function looksSecret(v: string): boolean {
  const s = v.trim();
  if (s.length < 8) return false;
  if (/^(bearer|basic|token)\s+\S{6,}$/i.test(s)) return true;
  if (/\s/.test(s)) return false;
  if (s.length >= 20) return true;
  return /[A-Za-z]/.test(s) && /[0-9]/.test(s) && s.length >= 12;
}

/** يجزّئ `Bearer sk-123` إلى القيمة كاملةً وإلى التوكن وحده. */
function forms(v: string): string[] {
  const out = [v.trim()];
  const m = /^(?:bearer|basic|token)\s+(\S+)$/i.exec(v.trim());
  if (m) out.push(m[1]!);
  return out;
}

type Http = { url?: string; headers?: Record<string, string> } & Record<string, unknown>;

/** يُعدّد مُعامِلات العنوان من **النصّ الخام** — لا `new URL`. */
const QUERY_PAIR = /([?&])([^=&#\s]+)=([^&#\s]*)/g;

/**
 * ⚠️ ولا `new URL` هنا ولا `searchParams`: العنوانُ قالبٌ لا رابط.
 *    `new URL('https://x/v1/{{id}}')` يُعيد `.../%7B%7Bid%7D%7D`، و
 *    `searchParams.set` يُعيد تشفير كلّ قالبٍ في الاستعلام — فأداةٌ فيها
 *    `{{id}}` في المسار تنكسر بمجرّد أن يمرّ عنوانُها على URL ويُكتب من جديد.
 */
function eachQueryValue(url: string, fn: (name: string, value: string) => void): void {
  for (const m of url.matchAll(QUERY_PAIR)) fn(decodeURIComponent(m[2]!), m[3]!);
}

/**
 * القيمُ الحرفيّةُ التي تبدو بيانات اعتماد في هذا الصفّ — تُضاف إلى مجموعة
 * حجب التشخيص، فيُحجب المفتاحُ المكتوب حرفيّاً كما يُحجب المُهرَّب من الخزنة.
 */
export function credentialValues(http: unknown): string[] {
  const h = (http ?? {}) as Http;
  const out: string[] = [];
  for (const [k, v] of Object.entries(h.headers ?? {})) {
    if (typeof v !== 'string' || hasTemplate(v)) continue;
    if (isCredentialHeader(k) && looksSecret(v)) out.push(...forms(v));
  }
  if (typeof h.url === 'string') {
    eachQueryValue(h.url, (name, value) => {
      if (!value || hasTemplate(value)) return;
      const raw = decodeURIComponent(value);
      if (CRED_PARAM.test(name) && looksSecret(raw)) out.push(...forms(raw), value);
    });
  }
  return [...new Set(out)];
}

/**
 * نسخةٌ من `http` صالحةٌ للعرض: كلُّ قيمةٍ حرفيّةٍ تبدو اعتماداً تصير `•••`.
 *
 * ⚠️ تُستعمل في **مخرَج القراءة وحده**. عاملُ الردّ (`apps/worker/src/tools.ts`)
 *    و`playground.ts` يقرآن العمودَ الخام مباشرةً من القاعدة، ولو حُجب قبل
 *    `execHttpTool` لأرسلت الأداةُ `•••` ترويسةَ مصادقة — فتفشل كلُّ أداةٍ
 *    عند كلّ زبون.
 */
export function maskHttp(http: unknown): unknown {
  if (!http || typeof http !== 'object') return http;
  const h = http as Http;
  const out: Http = { ...h };

  if (h.headers) {
    const hd: Record<string, string> = {};
    for (const [k, v] of Object.entries(h.headers)) {
      hd[k] = typeof v === 'string' && v.trim() && !hasTemplate(v) && isCredentialHeader(k)
        ? MASKED
        : v;
    }
    out.headers = hd;
  }

  if (typeof h.url === 'string') {
    out.url = h.url.replace(QUERY_PAIR, (whole, sep: string, name: string, value: string) => {
      if (!value || hasTemplate(value)) return whole;
      const raw = decodeURIComponent(value);
      if (!CRED_PARAM.test(decodeURIComponent(name)) || !looksSecret(raw)) return whole;
      return `${sep}${name}=${MASKED}`;
    });
  }
  return out;
}

/**
 * ★ ترحيلُ الاعتماد الحرفيّ إلى الخزنة المشفَّرة **عند الكتابة**.
 *
 *   يُعيد `null` إن لم يكن هناك ما يُرحَّل — فلا يُعاد حفظُ عمودٍ بلا داعٍ ولا
 *   يُفتح مسارُ إعادة تشفيرٍ في كلّ تعديلٍ صغير.
 *
 *   والاسمُ مشتقٌّ من الترويسة (`h_authorization`) ليبقى مقروءاً للمالك في
 *   الباني، ومطابقاً لما يقبله `renderTemplate` (`[\w.]+`).
 */
export function migrateLiteralSecrets(
  http: unknown,
): { http: unknown; secrets: Record<string, string> } | null {
  if (!http || typeof http !== 'object') return null;
  const h = http as Http;
  if (!h.headers) return null;

  const secrets: Record<string, string> = {};
  const headers: Record<string, string> = {};
  let moved = false;

  for (const [k, v] of Object.entries(h.headers)) {
    if (typeof v === 'string' && v.trim() && !hasTemplate(v) && isCredentialHeader(k)) {
      const name = `h_${k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
      secrets[name] = v;
      headers[k] = `{{secret.${name}}}`;
      moved = true;
    } else {
      headers[k] = v;
    }
  }
  return moved ? { http: { ...h, headers }, secrets } : null;
}
