import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import IORedis from 'ioredis';
import { AppError, ErrorCode } from '@aibot/shared';

/**
 * حدُّ المعدّل — نافذةٌ ثابتةٌ في ريدِس.
 *
 * ★ **لماذا وُجد هذا الملفّ.** كانت نقطةُ الدخول بلا أيّ حدّ: خمسةَ عشرَ نداءً
 *   بكلمةٍ خاطئة تعود كلُّها ٤٠١ ثمّ تصحّ الصحيحة بعدها فوراً (مقيسٌ على
 *   الخادم الحيّ، ٢٣ أيلول ٢٠٢٦). أي أنّ حشوَ بيانات الاعتماد مفتوحٌ بلا سقف،
 *   وكلُّ محاولةٍ تُنفّذ `scrypt` كاملاً — فهي مضخّمُ استنزافٍ للمعالج أيضاً.
 *   وخطّةُ ٠٥.٣ تنصّ على ٥/دقيقة/حساب و١٠/دقيقة/IP منذ اليوم الأوّل.
 *
 * ★ **ويفشل مفتوحاً عن قصد.** ريدِس ساقطٌ ⟶ يُسجَّل تحذيرٌ ويُسمح بالطلب. حدُّ
 *   معدّلٍ يُسقط الدخولَ كلَّه حين يتعثّر ريدِس يحوّل تعثّراً في مكوّنٍ مساعد
 *   إلى انقطاعٍ كاملٍ للمنصّة — والمقايضة هنا محسومة: باب مفتوحٌ دقيقةً أهون
 *   من بابٍ مقفولٍ على الجميع.
 *
 * ★ **واتّصالٌ منفصلٌ عن اتّصال BullMQ.** ذاك مضبوطٌ بـ`maxRetriesPerRequest:
 *   null` — أي «انتظر إلى الأبد»، وهو الصواب لمهمّةٍ في طابور والخطأُ القاتل
 *   لطلبٍ يرى المستخدمُ نتيجتَه. فهذا اتّصالٌ بمهلةٍ قصيرةٍ وبلا طابورٍ
 *   للأوامر: إن لم يُجب ريدِس في ٢٠٠ مِلّي ثانية مضى الطلبُ بلا عدّ.
 */

export interface RateRule {
  /** مفتاحٌ يميّز البُعد المحدود (حساب · IP · مستأجر). */
  key: string;
  limit: number;
  windowSec: number;
}

export interface RateStore {
  /** يعيد العددَ بعد هذه الضربة، أو `null` إن تعذّر العدّ (فيُسمح بالطلب). */
  hit(key: string, windowSec: number): Promise<number | null>;
}

export interface RateVerdict {
  ok: boolean;
  /** القاعدة التي انكسرت — للتسجيل ولـ`Retry-After`. */
  rule?: RateRule;
  count?: number;
}

/**
 * يفحص كلّ القواعد **ويضرب عدّاد كلٍّ منها** ولو انكسرت الأولى.
 *
 * ★ الخروجُ المبكِّر عند أوّل كسرٍ يبدو توفيراً وهو ثقبٌ: مهاجمٌ يُشبع عدّادَ
 *   الحساب فيتوقّف عدّادُ الـIP عن الزيادة، ثمّ ينتقل إلى حسابٍ آخرَ بعدّادِ
 *   IP لم يتحرّك. فالبُعدان يُعدّان دائماً، والحكمُ يُؤخَّر إلى ما بعدهما.
 */
export async function checkRate(store: RateStore, rules: RateRule[]): Promise<RateVerdict> {
  let broken: RateVerdict | null = null;
  for (const rule of rules) {
    const count = await store.hit(rule.key, rule.windowSec);
    if (count !== null && count > rule.limit && !broken) broken = { ok: false, rule, count };
  }
  return broken ?? { ok: true };
}

/** لا بريدَ في ريدِس: المفتاح تجزئةٌ، فسجلُّ ريدِس ليس قائمةَ حسابات. */
export function accountKey(email: string): string {
  return `rl:login:acct:${createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32)}`;
}

/**
 * ★ **عنوانٌ خاصٌّ لا يُحدَّد عليه.**
 *
 *   `req.ip` على هذا الخادم يعود **192.168.240.1** لكلّ طلبٍ من كلّ زائر —
 *   بوّابةُ شبكة دوكر، لأنّ `trustProxy` مضبوطٌ على `127.0.0.1` والنفقُ يصل
 *   الحاويةَ عبر الجسر فلا يُعَدّ موثوقاً فتُهمَل `X-Forwarded-For`. (مقيسٌ
 *   على الخادم: كلّ صفوف `audit_log.ip` و`sessions.ip` بهذه القيمة.)
 *
 *   فحدٌّ لكلّ IP في هذه الحالة ليس حدّاً لكلّ زائر بل **حدٌّ واحدٌ للمنصّة
 *   كلّها**: عشرُ محاولاتٍ في الدقيقة من أيّ أحدٍ تقفل الدخول على الجميع.
 *   وهذا أسوأ من غياب الحدّ. فالقاعدة تُعطّل نفسها ما دام العنوان خاصّاً،
 *   وتعمل من تلقاء نفسها يوم يُضبط `TRUST_PROXY` على الجسر فتصير القيمة
 *   عنوانَ الزائر الحقيقيّ.
 */
export function isUnusableClientIp(ip: string | undefined): boolean {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/, '');

  /* ★ **وما ليس عنواناً شكلاً يُرفض — والرفضُ افتراضيٌّ لا القبول.**
     `X-Forwarded-For` تُزوَّر، ويومَ يُوثَق الجسرُ تصير قيمتُها هي `req.ip`:
     نصٌّ حرٌّ يدخل مفتاحَ ريدِس (`rl:login:ip:<أيّ شيء>`)، فيُولّد مهاجمٌ
     مفاتيحَ بلا حدٍّ ويتخطّى السقفَ بتغيير الترويسة في كلّ طلب.
     و`isIP` لا نمطٌ مكتوبٌ بيد: نمطٌ مثل `[0-9a-f:]+` يقبل `'a'.repeat(50)`
     و`deadbeef` — جُرّبا فمرّا — ولا يحدّ طولَ المفتاح أصلاً. */
  if (isIP(v) === 0) return true;
  if (v === '::1' || v === '127.0.0.1') return true;
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  const m = /^172\.(\d+)\./.exec(v);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^(fc|fd)/i.test(v);
}

export function ipKey(ip: string): string {
  return `rl:login:ip:${ip}`;
}

/** القواعد المكتوبة في ٠٥.٣ — والثانية تسقط وحدها إن كان العنوان غير صالح. */
export function loginRules(email: string, ip: string | undefined): RateRule[] {
  const rules: RateRule[] = [{ key: accountKey(email), limit: 5, windowSec: 60 }];
  if (ip && !isUnusableClientIp(ip)) rules.push({ key: ipKey(ip), limit: 10, windowSec: 60 });
  return rules;
}

/**
 * ★★★ **حدُّ الرمز يفشل مقفلاً — عكسَ بقيّة هذا الملفّ عن قصد.**
 *
 *   كلُّ ما هنا يفشل **مفتوحاً**: ريدِسٌ متعثّرٌ يجب ألّا يُقفل المنصّةَ على
 *   عملائها. لكنّ الرمزَ ستُّ خاناتٍ — مليونُ احتمالٍ فقط — وفشلٌ مفتوحٌ
 *   هناك يعني **تخميناً بلا سقف** للعامل الثاني ما دام ريدِس ساقطاً. أي أنّ
 *   العاملَ الثاني يُلغى بعطلٍ في خدمةٍ أخرى.
 *
 * ⚠️ والانقلابُ آمنٌ لأنّ مداه محصور: هذه القاعدةُ لا تُطبَّق إلّا في
 *    منتصف دخول مالك المنصّة، فأسوأُ أثرِها تعطيلُ دخولِ **شخصٍ واحد** ريثما
 *    يعود ريدِس — لا حجبُ عميل.
 */
export function mfaRules(jti: string): RateRule[] {
  return [{ key: `rl:mfa:${jti}`, limit: 5, windowSec: 300 }];
}

/* ───────────────────────── مخزنُ ريدِس ───────────────────────── */

let conn: IORedis | null = null;

function connection(): IORedis | null {
  if (conn) return conn;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  conn = new IORedis(url, {
    // مهلةٌ قصيرةٌ وبلا طابورِ أوامر: ريدِس المتعثّر لا يُعلّق طلبَ دخول
    commandTimeout: 200,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  // الاتّصال قد يسقط؛ الحدث يُبتلع فلا يُسقط العمليّة كلّها
  conn.on('error', () => undefined);
  return conn;
}

export const redisRateStore: RateStore = {
  async hit(key, windowSec) {
    const r = connection();
    if (!r) return null;
    try {
      const [count] = await r.multi().incr(key).expire(key, windowSec, 'NX').exec() as
        [[Error | null, number], [Error | null, number]];
      return typeof count?.[1] === 'number' ? count[1] : null;
    } catch {
      return null; // فشلٌ مفتوح — انظر ترويسة الملفّ
    }
  },
};

export async function closeRateLimiter(): Promise<void> {
  await conn?.quit().catch(() => undefined);
  conn = null;
}

/**
 * الحارس نفسُه. يُرمى `AppError` بـ٤٢٩ لا يُردّ `reply` — فمعالجُ الأخطاء
 * الواحد في `main.ts` يُخرج نفسَ شكل الجسم الذي تفهمه الواجهة.
 */
export async function enforceRate(
  rules: RateRule[],
  message: string,
  onLimit?: (v: RateVerdict) => void,
  store: RateStore = redisRateStore,
): Promise<void> {
  const v = await checkRate(store, rules);
  if (v.ok) return;
  onLimit?.(v);
  throw new AppError(ErrorCode.RATE_LIMITED, message, 429);
}

/**
 * ★ نسخةٌ تفشل **مقفلة**: مخزنٌ لا يجيب يُقرأ «تجاوزتَ» لا «تفضّل».
 *
 * ⚠️ ودالّةٌ مستقلّةٌ لا علَمٌ في `enforceRate`: حارسٌ قائمٌ يثبّت الفشلَ
 *    المفتوحَ لمسار الدخول، وتبديلُ سلوكِ الدالّة المشتركة يكسره — أو أسوأ،
 *    يُبدّل الموقفَ في كلّ مكانٍ بلا أن ينتبه أحد.
 */
export async function enforceRateStrict(
  rules: RateRule[],
  message: string,
  store: RateStore = redisRateStore,
): Promise<void> {
  for (const r of rules) {
    const hit = await store.hit(r.key, r.windowSec);
    if (hit === null || hit > r.limit) {
      throw new AppError(ErrorCode.RATE_LIMITED, message, 429);
    }
  }
}
