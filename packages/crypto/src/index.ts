import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * تشفير أسرار المستأجرين — AES-256-GCM بمفتاحٍ رئيس من البيئة.
 *
 * ⚠️ `MASTER_KEY` أخطر سرٍّ في المنصّة: به تُفكّ توكنات واتساب لكلّ عملائك.
 *    انسخه احتياطيّاً خارج الخادم. فقدانه = فقدان كلّ التوكنات بلا استرجاع.
 *
 * كلّ صفٍّ مشفَّر يحمل `key_version`، فتدوير المفتاح مهمّةُ خلفيّة تعيد التشفير
 * صفّاً صفّاً بلا توقّف — لا عمليّةٌ لمرّةٍ واحدة تُوقف المنصّة.
 */

const IV_LEN = 12;
const TAG_LEN = 16;

export interface Sealed {
  /** base64: iv || tag || ciphertext */
  enc: string;
  keyVersion: number;
  /** أوّل 4 وآخر 4 من السرّ الأصليّ — للعرض فقط، لا يكفي لإعادة بنائه. */
  fingerprint: string;
}

function loadKeys(): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  const primary = process.env.MASTER_KEY;
  if (!primary) throw new Error('MASTER_KEY غير مضبوط — لا إقلاع بلا مفتاحٍ رئيس');
  keys.set(currentKeyVersion(), decodeKey(primary, 'MASTER_KEY'));
  // مفاتيح سابقة أثناء التدوير: MASTER_KEY_V1=… MASTER_KEY_V2=…
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^MASTER_KEY_V(\d+)$/.exec(k);
    if (m && v) keys.set(Number(m[1]), decodeKey(v, k));
  }
  return keys;
}

function decodeKey(raw: string, name: string): Buffer {
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${name} يجب أن يكون 32 بايت بترميز base64 — الطول الحالي ${buf.length}`);
  }
  return buf;
}

export function currentKeyVersion(): number {
  return Number(process.env.MASTER_KEY_VERSION ?? '1');
}

let cache: Map<number, Buffer> | null = null;
function keys(): Map<number, Buffer> {
  if (!cache) cache = loadKeys();
  return cache;
}
/** للاختبار فقط: يُجبر إعادة قراءة المفاتيح من البيئة. */
export function __resetKeyCache(): void {
  cache = null;
}

export function fingerprint(secret: string): string {
  if (secret.length <= 8) return '…';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function seal(plain: string): Sealed {
  const version = currentKeyVersion();
  const key = keys().get(version);
  if (!key) throw new Error(`لا مفتاح للإصدار ${version}`);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: Buffer.concat([iv, tag, ct]).toString('base64'),
    keyVersion: version,
    fingerprint: fingerprint(plain),
  };
}

export function open(enc: string, keyVersion: number): string {
  const key = keys().get(keyVersion);
  if (!key) {
    throw new Error(`لا مفتاح للإصدار ${keyVersion} — أضِف MASTER_KEY_V${keyVersion} قبل التدوير`);
  }
  const buf = Buffer.from(enc, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('نصٌّ مشفَّر تالف');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** مقارنة ثابتة الزمن — لتوقيعات الويبهوك وتوكنات التحقّق. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** توليد معرّفٍ عامٍّ غير قابل للتخمين — 26 حرفاً base32 (Crockford بلا I L O U). */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function publicId(): string {
  const bytes = randomBytes(26);
  let out = '';
  for (const b of bytes) out += B32[b % 32];
  return out;
}

/** حقولٌ تُنقَّح من كلّ سجلّ — تُمرَّر إلى pino redact. */
export * from './totp.js';
export * from './qr.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  // ★ كوكي التحديث يخرج في ترويسة الاستجابة — وهو توكنُ ثلاثين يوماً لا خمسَ
  //   عشرةَ دقيقة. أيُّ تسجيلٍ لترويسات الاستجابة يكتبه نصّاً صريحاً في السجلّ.
  'res.headers["set-cookie"]',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.password',
  '*.appSecret',
  '*.token_enc',
  '*.app_secret_enc',
  '*.key_enc',
  /* ★ أسماءٌ تحملها أجسامُ الاستجابة فعلاً في هذه المنصّة، وكانت خارج القائمة:
     · `tempPassword` تعود من `POST /team` و`POST /team/:id/reset-password`
       — كلمةُ مرورٍ صالحةٌ نصّاً صريحاً.
     · `access` و`refresh` توكنا الجلسة.
     · `passwordHash` و`refreshHash` تجزئاتٌ تُقرأ من صفوف المستخدمين والجلسات
       في مسار المصادقة كلِّه.
     · `verifyToken` تحدّي ميتا.
     ولا واحدةٌ منها تُسجَّل اليوم — والقائمة ليست وصفاً لما يُسجَّل بل سدّاً
     لما سيُسجَّل يوم يضيف أحدٌ `log.info({ user })` أو `log.error({ body })`
     في تشخيصٍ عاجل. والسرُّ الذي يدخل السجلّ لا يخرج منه. */
  '*.tempPassword',
  '*.access',
  '*.refresh',
  '*.passwordHash',
  '*.refreshHash',
  /* والتجزئةُ السابقة سرٌّ ثانٍ بنفس عمر الثلاثين يوماً — وُلد مع نافذة السماح. */
  '*.prevRefreshHash',
  '*.verifyToken',
  /* ★ والعاملُ الثاني: `totpSecret` و`otpauth` يعودان من مسار التسجيل **مرّةً
     واحدةً** نصّاً صريحاً (وهو كلُّ الغرض: يُقرأ ثمّ يُنسى)، و`code` يصل في
     جسم طلب التحقّق. فسطرُ تشخيصٍ واحدٌ يُضاف يوماً يطبع العاملَ الثاني كلَّه
     في السجلّ — وحسابُ مالك المنصّة يفتح لوحةَ كلّ العملاء. */
  '*.mfaSecretEnc',
  '*.totpSecret',
  '*.otpauth',
  /* والمصفوفةُ هي السرُّ نفسُه مرسوماً — تسجيلُها تسجيلٌ له. */
  '*.qr',
  '*.challenge',
  '*.code',
];
