import { describe, it, expect, beforeEach } from 'vitest';
import { seal, open, fingerprint, safeEqual, publicId, REDACT_PATHS, __resetKeyCache } from '../src/index.js';

const K1 = Buffer.alloc(32, 1).toString('base64');
const K2 = Buffer.alloc(32, 2).toString('base64');

beforeEach(() => {
  process.env.MASTER_KEY = K1;
  process.env.MASTER_KEY_VERSION = '1';
  delete process.env.MASTER_KEY_V1;
  __resetKeyCache();
});

describe('تشفير الأسرار', () => {
  it('يفكّ ما شفّره', () => {
    const s = seal('EAAGm0PX4ZCpsBO...9f2c');
    expect(s.keyVersion).toBe(1);
    expect(open(s.enc, s.keyVersion)).toBe('EAAGm0PX4ZCpsBO...9f2c');
  });

  it('لا يُنتج نفس النصّ المشفَّر مرّتين (iv عشوائيّ)', () => {
    expect(seal('x').enc).not.toBe(seal('x').enc);
  });

  it('يرفض نصّاً مشفَّراً مُعدَّلاً — وهذا ما يمنع التلاعب بالقاعدة', () => {
    const s = seal('secret-token');
    const buf = Buffer.from(s.enc, 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => open(buf.toString('base64'), s.keyVersion)).toThrow();
  });

  it('التدوير: مفتاحٌ جديد يشفّر، والقديم ما زال يفكّ ما شفّره', () => {
    const oldSealed = seal('old-secret');
    process.env.MASTER_KEY_V1 = K1;
    process.env.MASTER_KEY = K2;
    process.env.MASTER_KEY_VERSION = '2';
    __resetKeyCache();
    expect(open(oldSealed.enc, 1)).toBe('old-secret');
    const fresh = seal('new-secret');
    expect(fresh.keyVersion).toBe(2);
    expect(open(fresh.enc, 2)).toBe('new-secret');
  });

  it('يرفض الإقلاع بمفتاحٍ ليس 32 بايت', () => {
    process.env.MASTER_KEY = Buffer.alloc(16).toString('base64');
    __resetKeyCache();
    expect(() => seal('x')).toThrow(/32 بايت/);
  });

  it('البصمة تكشف الأطراف ولا تكفي لإعادة البناء', () => {
    expect(fingerprint('EAAGm0PX4ZCpsBO9f2c')).toBe('EAAG…9f2c');
  });

  it('المقارنة ثابتة الزمن تعمل على أطوالٍ مختلفة بلا رمي', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('المعرّف العامّ 26 حرفاً ولا يتكرّر', () => {
    const ids = new Set(Array.from({ length: 500 }, () => publicId()));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

/**
 * ★ **قائمةُ التنقية سدٌّ لما سيُسجَّل، لا وصفٌ لما يُسجَّل.**
 *
 *   لا اسمٌ من هذه الأسماء يُسجَّل في المنصّة اليوم — وهذا بالضبط سببُ وجود
 *   القائمة: `log.info({ user })` أو `log.error({ body })` في تشخيصٍ عاجلٍ
 *   بعد ستّة أشهرٍ يكتبها كلَّها نصّاً صريحاً. والسرُّ الذي يدخل السجلّ لا
 *   يخرج منه: السجلّاتُ تُنسخ وتُقرأ وتُرسَل في تذاكر.
 *
 *   والثلاثةُ التي كانت ناقصةً ليست فرضيّة: `tempPassword` **تعود فعلاً** في
 *   جسم `POST /team` و`POST /team/:id/reset-password` كلمةَ مرورٍ صالحةً نصّاً،
 *   و`set-cookie` تحمل توكنَ تحديثٍ عمرُه ثلاثون يوماً لا خمسَ عشرةَ دقيقة.
 *
 * ⚠️ و`'*.x'` يطابق **مستوًى واحداً** فقط في pino: `body.access` تُنقَّى و
 *    `a.b.access` لا. فالاعتمادُ على العمق الواحد مقصودٌ ومحدود.
 */
describe('مُنقِّي السجلّات', () => {
  it('ترويستا المصادقة والكوكي — طلباً واستجابة', () => {
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('req.headers.cookie');
    // ★ كان ناقصاً: كوكي التحديث يخرج في ترويسة الاستجابة لا في الطلب
    expect(REDACT_PATHS).toContain('res.headers["set-cookie"]');
  });

  it('★ كلّ اسمٍ يحمل سرّاً في هذه المنصّة مُغطّى', () => {
    for (const name of [
      'token', 'apiKey', 'secret', 'password', 'appSecret',
      'token_enc', 'app_secret_enc', 'key_enc',
      'tempPassword', 'access', 'refresh', 'passwordHash', 'refreshHash', 'prevRefreshHash', 'verifyToken',
    ]) expect(REDACT_PATHS, name).toContain(`*.${name}`);
  });

  it('لا مسارَ مكرَّرٌ — pino يرمي على التكرار فيسقط الإقلاع كلُّه', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});
