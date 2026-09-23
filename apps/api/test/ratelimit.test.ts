import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkRate, accountKey, ipKey, loginRules, isUnusableClientIp,
  type RateStore, type RateRule,
} from '../src/ratelimit.js';

/**
 * ★ **حرّاسُ حدِّ معدّلِ الدخول** — وُلدوا من قياسٍ على الخادم الحيّ لا من مراجعةٍ
 *   نظريّة: خمسةَ عشرَ نداءً على `POST /api/auth/login` بكلمةٍ خاطئة عادت
 *   **كلُّها ٤٠١** ثمّ صحّت الكلمة الصحيحة بعدها فوراً — أي لا سقفَ ولا تباطؤ
 *   ولا قفلَ حساب. حشوُ بيانات الاعتماد مفتوحٌ بلا حدّ، وكلُّ محاولةٍ تُنفّذ
 *   `scrypt` كاملاً فهي مضخّمُ استنزافٍ للمعالج أيضاً.
 *
 * وثلاثةُ قراراتٍ في هذا الحدّ ليست ذوقاً، وكلٌّ منها يُفحص هنا:
 *  ① **البُعدان يُعدّان دائماً** — الخروجُ عند أوّل كسرٍ يجعل مهاجماً يُشبع
 *    عدّادَ حسابٍ فيتجمّد عدّادُ الـIP، ثمّ ينتقل إلى حسابٍ آخرَ بعدّادٍ نائم.
 *  ② **يفشل مفتوحاً** — ريدِس ساقطٌ لا يُقفل الدخول على الجميع.
 *  ③ **قاعدةُ الـIP تُعطّل نفسها** ما دام `req.ip` عنواناً خاصّاً. وهذا واقعُ
 *    هذا الخادم اليوم: كلُّ صفوف `audit_log.ip` و`sessions.ip` قيمةٌ واحدة
 *    (‏`192.168.240.1` — بوّابةُ جسر دوكر)، لأنّ `trustProxy` لا يُطابق قرينَ
 *    الاتّصال فتُهمَل `X-Forwarded-For`. فحدٌّ لكلّ IP هناك ليس حدّاً لكلّ
 *    زائر بل **حدٌّ واحدٌ للمنصّة كلّها** — عشرُ محاولاتٍ من أيّ أحدٍ تقفل
 *    الدخول على كلّ عميل. وهو أسوأ من غياب الحدّ.
 */

/** مخزنٌ في الذاكرة — نافذةٌ ثابتةٌ بلا زمنٍ حقيقيّ، فالاختبار حتميّ. */
function memStore(): RateStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async hit(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
  };
}

const deadStore: RateStore = { async hit() { return null; } };

describe('حدُّ المعدّل — الحكم', () => {
  const rules: RateRule[] = [
    { key: 'a', limit: 2, windowSec: 60 },
    { key: 'b', limit: 5, windowSec: 60 },
  ];

  it('يسمح حتّى السقف ويمنع بعده', async () => {
    const s = memStore();
    expect((await checkRate(s, rules)).ok).toBe(true);  // 1
    expect((await checkRate(s, rules)).ok).toBe(true);  // 2 = السقف
    const third = await checkRate(s, rules);
    expect(third.ok).toBe(false);
    expect(third.rule?.key).toBe('a');
    expect(third.count).toBe(3);
  });

  it('★ يضرب كلّ عدّادٍ ولو انكسرت قاعدةٌ قبله — لا بُعدَ ينام', async () => {
    const s = memStore();
    for (let i = 0; i < 4; i += 1) await checkRate(s, rules);
    // القاعدة «أ» انكسرت من الثالثة، ومع ذلك عدّاد «ب» بلغ أربعة لا اثنين
    expect(s.counts.get('a')).toBe(4);
    expect(s.counts.get('b')).toBe(4);
  });

  it('★ يفشل مفتوحاً حين يتعذّر العدّ — ريدِس ساقطٌ لا يُقفل الدخول', async () => {
    for (let i = 0; i < 50; i += 1) {
      expect((await checkRate(deadStore, rules)).ok).toBe(true);
    }
  });

  it('لا قاعدةَ ⟶ لا منع', async () => {
    expect((await checkRate(memStore(), [])).ok).toBe(true);
  });
});

describe('مفاتيحُ الحدّ', () => {
  it('★ لا بريدَ في ريدِس — المفتاح تجزئةٌ لا عنوانٌ صريح', () => {
    const k = accountKey('Victim@Example.COM');
    expect(k).not.toContain('victim');
    expect(k).not.toContain('@');
    expect(k).toMatch(/^rl:login:acct:[0-9a-f]{32}$/);
  });

  it('البريد يُطبَّع — فلا يُتخطّى الحدُّ بحرفٍ كبيرٍ أو مسافة', () => {
    expect(accountKey(' USER@x.com ')).toBe(accountKey('user@x.com'));
  });

  it('بريدان مختلفان مفتاحان مختلفان', () => {
    expect(accountKey('a@x.com')).not.toBe(accountKey('b@x.com'));
  });
});

describe('★ العنوانُ غير الصالح — القاعدة تُعطّل نفسها', () => {
  it('يرفض بوّابةَ جسر دوكر التي يراها هذا الخادم فعلاً', () => {
    expect(isUnusableClientIp('192.168.240.1')).toBe(true);
  });

  it('يرفض كلّ النطاقات الخاصّة والمحلّيّة', () => {
    for (const ip of [
      '127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3',
      '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.10.1',
      'fd00::1', 'fc00::99',
    ]) expect(isUnusableClientIp(ip), ip).toBe(true);
  });

  it('يقبل العناوين العامّة — فالقاعدة تعمل يوم يُضبط TRUST_PROXY', () => {
    for (const ip of ['92.241.36.203', '8.8.8.8', '172.32.0.1', '2a01::1']) {
      expect(isUnusableClientIp(ip), ip).toBe(false);
    }
  });

  it('غيابُ العنوان يُعامَل كغير صالح', () => {
    expect(isUnusableClientIp(undefined)).toBe(true);
    expect(isUnusableClientIp('')).toBe(true);
  });
});

describe('قواعدُ الدخول — نصُّ ٠٥.٣', () => {
  it('٥/دقيقة/حساب دائماً', () => {
    const r = loginRules('u@x.com', undefined);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: accountKey('u@x.com'), limit: 5, windowSec: 60 });
  });

  it('★ لا قاعدةَ IP على عنوانٍ خاصّ — وإلّا صار الحدُّ قفلاً للمنصّة كلّها', () => {
    expect(loginRules('u@x.com', '192.168.240.1')).toHaveLength(1);
  });

  it('١٠/دقيقة/IP على عنوانٍ عامّ', () => {
    const r = loginRules('u@x.com', '92.241.36.203');
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ key: ipKey('92.241.36.203'), limit: 10, windowSec: 60 });
  });
});

/* ───────── حرّاسٌ ساكنون: الشكلُ الذي لا يُثبته اختبارُ دالّة ───────── */

const AUTH = readFileSync(join(__dirname, '..', 'src', 'auth.ts'), 'utf8');
const RL = readFileSync(join(__dirname, '..', 'src', 'ratelimit.ts'), 'utf8');

function maskComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}
const AUTH_CODE = maskComments(AUTH);

describe('★ الحدُّ مُركَّبٌ فعلاً على الدخول', () => {
  it('`/auth/login` ينادي `enforceRate` — لا مجرّد استيراد', () => {
    expect(AUTH_CODE).toContain('enforceRate(');
    expect(AUTH_CODE).toContain('loginRules(email, req.ip)');
  });

  it('★ الحدُّ قبل `verifyPassword` — وإلّا مُنع الاختراقُ وبقي استنزافُ المعالج', () => {
    const iRate = AUTH_CODE.indexOf('enforceRate(');
    const iHash = AUTH_CODE.indexOf('verifyPassword(password');
    expect(iRate).toBeGreaterThan(-1);
    expect(iHash).toBeGreaterThan(iRate);
  });

  it('★ الحدُّ قبل قراءة المستخدم — فلا يكشف أيَّ بريدٍ مسجَّل', () => {
    const iRate = AUTH_CODE.indexOf('enforceRate(');
    const iLookup = AUTH_CODE.indexOf('مصادقة: البحث عن المستخدم بالبريد');
    expect(iLookup).toBeGreaterThan(iRate);
  });

  it('★ يعتمد `req.ip` لا `X-Forwarded-For` — الترويسةُ تُزوَّر', () => {
    expect(maskComments(RL)).not.toMatch(/x-forwarded-for/i);
    expect(AUTH_CODE).not.toMatch(/x-forwarded-for/i);
  });

  it('★ اتّصالُ ريدِس بمهلةٍ وبلا طابورٍ للأوامر — لا يُعلّق طلبَ دخول', () => {
    expect(RL).toContain('commandTimeout');
    expect(RL).toContain('enableOfflineQueue: false');
    // اتّصالُ BullMQ يقول `maxRetriesPerRequest: null` أي «انتظر للأبد» — لا هنا
    expect(RL).not.toContain('maxRetriesPerRequest: null');
  });
});
