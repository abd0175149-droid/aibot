import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * ★★★ **عاملٌ ثانٍ لحساب مالك المنصّة — RFC 6238، بلا نداءِ شبكةٍ واحد.**
 *
 *   حسابٌ واحدٌ بكلمة سرٍّ وحدها كان يفتح: لوحةَ كلّ العملاء، وتوكنَ انتحالٍ
 *   داخل أيّ مستأجر، ومقبضاً يسمع غرفةَ كلّ مستأجر (`t:*`) — أي نصَّ كلّ
 *   رسالةِ زبونٍ في المنصّة كلِّها، حيّاً.
 *
 * ⚠️ ولماذا TOTP لا رسالةً ولا دفعاً: هذا الحسابُ يُحسب **في مسار الطلب**،
 *    ومسارُ الطلب يفتح معاملةَ قاعدةٍ من بِركةٍ فيها عشرةُ اتّصالات. وأيُّ
 *    عاملٍ ثانٍ يحتاج نداءً خارجيّاً يُدخل الشبكةَ إلى ذلك المسار — وهي
 *    القاعدةُ التي يمنعها هذا المستودع صراحةً. وهذه حسابٌ محلّيٌّ صرف.
 */

/** أبجديّةُ base32 كما في RFC 4648 — وهي ما تقرؤه تطبيقاتُ المصادقة. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  /* الفراغاتُ والحشوُ يُزالان: تطبيقاتُ المصادقة تعرض السرَّ مجزّأً بفراغات،
     والمالكُ ينسخه كما يراه. ورفضُه لفراغٍ واحدٍ عطلٌ نصنعه نحن. */
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** عشرون بايتاً — طولُ مفتاح HMAC-SHA1 الموصى به في المعيار. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
/** نافذةٌ قبلُ ونافذةٌ بعدُ — انحرافُ ساعةِ الهاتف عن الخادم أمرٌ عاديّ. */
export const TOTP_SKEW = 1;

function codeAt(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  /* العدّادُ ثمانيةُ بايتاتٍ big-endian. و`writeUInt32BE` مرّتين لأنّ
     `writeBigUInt64BE` يحتاج BigInt، والقيمةُ هنا دون 2^53 بكثير. */
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', secret).update(buf).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[off]! & 0x7f) << 24)
    | ((mac[off + 1]! & 0xff) << 16)
    | ((mac[off + 2]! & 0xff) << 8)
    | (mac[off + 3]! & 0xff);
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** رموزُ النوافذ المقبولة عند لحظةٍ ما — الحاضرةُ وما قبلَها وما بعدَها. */
export function totpCodes(secret: string, atMs: number = Date.now()): string[] {
  const key = base32Decode(secret);
  const now = Math.floor(atMs / 1000 / TOTP_STEP_SEC);
  const out: string[] = [];
  for (let d = -TOTP_SKEW; d <= TOTP_SKEW; d += 1) {
    /* ⚠️ وعدّادٌ سالبٌ يرمي في `writeUInt32BE`: لا يقع بساعةٍ حقيقيّةٍ، لكنّه
       يقع في اختبارٍ يمرّر صفراً — ودالّةٌ ترمي على مدخلٍ حدّيٍّ تُسقط مسارَ
       الدخول كلَّه بـ٥٠٠ بدل «الرمز غير صحيح». */
    if (now + d < 0) continue;
    out.push(codeAt(key, now + d));
  }
  return out;
}

/**
 * ⚠️ والمقارنةُ `timingSafeEqual` لا `===`: مقارنةُ النصّ تخرج عند أوّل محرفٍ
 *    مختلف، فزمنُ الردّ يكشف كم رقماً صحّ — وستُّ خاناتٍ تُخمَّن رقماً رقماً
 *    بدل أن تُخمَّن كاملةً.
 */
export function verifyTotp(secret: string, code: string, atMs: number = Date.now()): boolean {
  const given = code.trim();
  if (!/^[0-9]{6}$/.test(given)) return false;
  const a = Buffer.from(given, 'utf8');
  let ok = false;
  for (const c of totpCodes(secret, atMs)) {
    const b = Buffer.from(c, 'utf8');
    /* ولا خروجَ مبكّرٌ من الحلقة: الخروجُ عند أوّل مطابقةٍ يُعيد تسريبَ الزمن
       الذي أُغلق بالمقارنة نفسِها — أيُّ نافذةٍ طابقت تُقرأ من عدد الدورات. */
    if (a.length === b.length && timingSafeEqual(a, b)) ok = true;
  }
  return ok;
}

/**
 * رابطُ `otpauth://` الذي تقرؤه تطبيقاتُ المصادقة من رمز QR أو باللصق.
 *
 * ⚠️ والبريدُ يُشفَّر للعنوان: بريدٌ فيه `+` أو فراغٌ كان يكسر الرابطَ فيُقرأ
 *    حسابٌ باسمٍ مبتور — أو لا يُقرأ إطلاقاً.
 */
export function otpauthUri(secret: string, email: string, issuer = 'AiBot'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
