import { describe, it, expect } from 'vitest';
import {
  generateTotpSecret, totpCodes, verifyTotp, otpauthUri,
  base32Encode, base32Decode, seal, open, REDACT_PATHS,
  TOTP_STEP_SEC, TOTP_SKEW,
} from '../src/index.js';

/**
 * ★★★ **العامل الثاني لمالك المنصّة — وحسابُه كان يفتح المنصّة كلَّها بكلمة سرّ.**
 *
 *   قائمةُ كلّ العملاء، وتوكنُ انتحالٍ داخل أيٍّ منهم، ومقبضٌ يسمع غرفةَ **كلّ**
 *   مستأجر — أي نصَّ كلّ رسالةِ زبونٍ في المنصّة، حيّاً.
 */

const KEY = process.env.MASTER_KEY;
if (!KEY) process.env.MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

describe('base32 — ما تقرؤه تطبيقاتُ المصادقة', () => {
  it('يدور ذهاباً وإياباً', () => {
    for (const n of [1, 5, 10, 20, 32]) {
      const b = Buffer.alloc(n, n);
      expect(base32Decode(base32Encode(b)).equals(b), String(n)).toBe(true);
    }
  });

  it('★ والفراغاتُ تُتجاهَل — التطبيقاتُ تعرض السرَّ مجزّأً والمالكُ ينسخه كما يراه', () => {
    const s = generateTotpSecret();
    const spaced = s.replace(/(.{4})/g, '$1 ').trim();
    expect(base32Decode(spaced).equals(base32Decode(s))).toBe(true);
  });

  it('والسرُّ عشرون بايتاً — طولُ مفتاح HMAC-SHA1 الموصى به', () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });
});

describe('TOTP — RFC 6238', () => {
  const secret = 'JBSWY3DPEHPK3PXP'; // مثالٌ معروفٌ في المراجع

  it('ستُّ خاناتٍ لاتينيّة', () => {
    for (const c of totpCodes(secret, 1_700_000_000_000)) expect(c).toMatch(/^[0-9]{6}$/);
  });

  it('★ ولا رميَ على مدخلٍ حدّيّ — عدّادٌ سالبٌ يُسقط الدخولَ بـ٥٠٠', () => {
    /* `writeUInt32BE` يرمي على السالب. ولا يقع بساعةٍ حقيقيّة، لكنّ دالّةً
       ترمي على حدٍّ تُحوّل «الرمز غير صحيح» إلى «خطأ داخليّ». */
    expect(() => totpCodes(secret, 0)).not.toThrow();
    expect(totpCodes(secret, 0).length).toBeGreaterThan(0);
    expect(verifyTotp(secret, '000000', 0)).toBe(false);
  });

  it('★★ ونافذةٌ قبلُ وأخرى بعدُ تُقبلان — ساعةُ الهاتف تنحرف', () => {
    /* وبلا السماح ينقلب رمزٌ صحيحٌ كلمةَ سرٍّ خاطئة، فيُقرأ العطلُ في المنصّة
       لا في ساعة الجهاز — ويُطفأ العاملُ الثاني بعد ثالث شكوى. */
    const t = 1_700_000_000_000;
    const step = TOTP_STEP_SEC * 1000;
    for (let d = -TOTP_SKEW; d <= TOTP_SKEW; d += 1) {
      const code = totpCodes(secret, t + d * step)[TOTP_SKEW]!;
      expect(verifyTotp(secret, code, t), `انحراف ${d}`).toBe(true);
    }
  });

  it('★★ وخارجَ النافذة يُرفض — وإلّا صار الرمزُ دائماً', () => {
    const t = 1_700_000_000_000;
    const step = TOTP_STEP_SEC * 1000;
    for (const d of [-2, 2, 10, -10]) {
      const far = totpCodes(secret, t + d * step)[TOTP_SKEW]!;
      expect(verifyTotp(secret, far, t), `انحراف ${d}`).toBe(false);
    }
  });

  it('★ ورمزُ سرٍّ آخرَ يُرفض', () => {
    const t = 1_700_000_000_000;
    const other = generateTotpSecret();
    expect(verifyTotp(secret, totpCodes(other, t)[TOTP_SKEW]!, t)).toBe(false);
  });

  it('★ وما ليس ستَّ خاناتٍ لاتينيّةٍ يُرفض قبل أيّ حساب', () => {
    const t = 1_700_000_000_000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '١٢٣٤٥٦', '12 3456']) {
      expect(verifyTotp(secret, bad, t), JSON.stringify(bad)).toBe(false);
    }
  });

  it('ويُتجاهَل الفراغُ الطرفيّ — يُلصَق مع الرمز من الإشعار', () => {
    const t = 1_700_000_000_000;
    expect(verifyTotp(secret, ` ${totpCodes(secret, t)[TOTP_SKEW]!} `, t)).toBe(true);
  });
});

describe('السرُّ يُختم ولا يُخزَّن نصّاً', () => {
  it('★★★ الختمُ يدور — والنصُّ الصريح كان سيضع العاملَين في نسخةٍ واحدة', () => {
    /* سرُّ TOTP كلمةُ سرٍّ ثانيةٌ بكلّ معنى: من يقرؤه يولّد الرمزَ إلى الأبد.
       فنسخةٌ احتياطيّةٌ غيرُ مشفَّرةٍ كانت ستحمل كلمةَ السرّ والعاملَ الثاني معاً. */
    const s = generateTotpSecret();
    const sealed = seal(s);
    expect(sealed.enc).not.toContain(s);
    expect(open(sealed.enc, sealed.keyVersion)).toBe(s);
  });
});

describe('رابطُ otpauth', () => {
  it('★ والبريدُ يُشفَّر — بريدٌ فيه `+` كان يكسر الرابط', () => {
    const s = generateTotpSecret();
    const u = otpauthUri(s, 'owner+ops@aibot.masaros.net');
    expect(u.startsWith('otpauth://totp/AiBot:')).toBe(true);
    expect(u).toContain('owner%2Bops%40aibot.masaros.net');
    const q = new URL(u.replace('otpauth://', 'https://')).searchParams;
    expect(q.get('secret')).toBe(s);
    expect(q.get('digits')).toBe('6');
    expect(q.get('period')).toBe(String(TOTP_STEP_SEC));
  });
});

describe('العاملُ الثاني في قائمة الحجب', () => {
  it('★★ كلُّ اسمٍ يحمله مسارُ التسجيل أو التحقّق', () => {
    /* `totpSecret` و`otpauth` يعودان **مرّةً واحدةً** نصّاً صريحاً، و`code`
       يصل في جسم الطلب. فسطرُ تشخيصٍ واحدٌ يُضاف يوماً يطبع العاملَ الثاني
       في السجلّ — والسرُّ الذي يدخل السجلّ لا يخرج منه. */
    for (const k of ['*.mfaSecretEnc', '*.totpSecret', '*.otpauth', '*.challenge', '*.code']) {
      expect(REDACT_PATHS, k).toContain(k);
    }
  });

  it('ولا تكرارَ في القائمة', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});
