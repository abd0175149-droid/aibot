import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AppError, ErrorCode, tenantBlocked, TENANT_BLOCKED_AR, MfaVerifyBody, MfaActivateBody,
  type Role,
} from '@aibot/shared';
import { getDb, withPlatform, users, sessions, tenants, auditLog, eq, and, ne, isNull, gt, sql } from '@aibot/db';
import {
  sha256, seal, open, generateTotpSecret, verifyTotp, otpauthUri, qrRows,
} from '@aibot/crypto';
import { enforceRate, enforceRateStrict, loginRules, mfaRules } from './ratelimit.js';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

const ACCESS_TTL_SEC = 15 * 60;            // قصيرٌ عمداً
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

/* ───────────────────────── كلمات السرّ ───────────────────────── */

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = await scrypt(plain, Buffer.from(saltB64, 'base64'), 64);
  const expected = Buffer.from(keyB64, 'base64');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * ★★★ **تجزئةٌ شَرَك — لتساوي زمنِ الردّ.**
 *
 *   بريدٌ غير مسجَّلٍ كان يعود ٤٠١ بعد قراءةٍ واحدةٍ من القاعدة (نحو خمسة
 *   مِلّي)، والمسجَّلُ بعد `scrypt` كامل (نحو مئة). فطلبٌ واحدٌ لكلّ بريدٍ يفرز
 *   المسجَّلَ من غيره **بالساعة وحدها**، وحدُّ ٥/دقيقة/حساب لا يمسّ ذلك لأنّ
 *   كلَّ بريدٍ عدّادُه الخاصّ — والإحصاءُ يستعمل بريداً مختلفاً في كلّ طلب.
 *
 *   فتُنفَّذ التجزئة في كلّ الأحوال: مفتاحٌ عشوائيٌّ أربعةٌ وستّون بايتاً لا
 *   تساويه كلمةُ سرٍّ أبداً، وبنفس المُعامِلات فالكلفةُ هي الكلفةُ نفسُها.
 *   ويُولَّد مرّةً عند الإقلاع فلا سرَّ مكتوباً في المستودع.
 *
 * ⚠️ وبنيتُه تطابق `hashPassword` بالضبط (ملحٌ ١٦، مفتاحٌ ٦٤): قيمةٌ قصيرةٌ
 *    أو مشوّهةٌ يرفضها `verifyPassword` على فحص `alg`/الطول **بلا أن تُشغّل
 *    `scrypt`** — فيعود المقياسُ الزمنيُّ من حيث أُغلق، صامتاً.
 */
const DECOY_HASH = `scrypt$${randomBytes(16).toString('base64')}$${randomBytes(64).toString('base64')}`;

/**
 * يُستدعى **خارج** أيّ معاملة: `scrypt` يحتجز خانةً من بِركة libuv نحو مئة
 * مِلّي، وداخل معاملةٍ يحتجز معها اتّصالاً من بِركة العشرة.
 */
export function passwordHashOrDecoy(stored: string | undefined): string {
  return stored ?? DECOY_HASH;
}

/* ───────────────────────── التوكنات ───────────────────────── */

export interface AccessClaims {
  sub: string;       // userId
  tid: string | null; // tenantId — فارغٌ لمالك المنصّة
  role: Role;
  sid: string;       // sessionId
  /** انتحالٌ نشط: قراءةٌ فقط، ومسجَّل، ويراه العميل في سجلّه. */
  imp?: string;
  /**
   * ★★★ عاملٌ ثانٍ قُدّم فعلاً في هذه الجلسة.
   *
   * ⚠️ وغيابُه **يُقرأ رفضاً** لا سهواً. كلُّ توكنٍ صدر قبل هذه النشرة بلا
   *    `mfa`، فلو كان الغيابُ يعني «مسموح» لبقيت اللوحةُ مفتوحةً دورةَ تجديدٍ
   *    كاملةً بعد النشر — أي أنّ البوّابةَ تُركَّب مقفلةً على الورق مفتوحةً
   *    في الواقع ربعَ ساعة.
   */
  mfa?: 'ok';
  exp: number;
}

function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url');
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET غير مضبوط');
  return s;
}

export function signAccess(claims: Omit<AccessClaims, 'exp'>, ttlSec = ACCESS_TTL_SEC): string {
  const payload: AccessClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyAccess(token: string): AccessClaims | null {
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as AccessClaims;
    /* ★ وتوكنُ التحدّي لا يُقرأ توكنَ وصولٍ أبداً: هو موقَّعٌ بنفس السرّ،
       فبلا فحص النوع يصير اجتيازُ كلمة السرّ وحدها بطاقةَ دخول. */
    if ((claims as { typ?: string }).typ === 'mfa') return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * ★★★ **توكنُ التحدّي — نوعٌ مستقلٌّ لا توكنُ وصولٍ قصير.**
 *
 *   بين خطوتَي الدخول يجب أن يبقى بيدِ المُنادي شيءٌ يُثبت أنّه اجتاز كلمةَ
 *   السرّ — وهذا الشيء **يجب ألّا يفتح شيئاً**. فلو وُقّع بنفس شكل توكن
 *   الوصول لصار حاملُه داخلاً بكلمة سرٍّ وحدها، وهو بعينه ما نُغلقه.
 *
 *   ولذلك `typ: 'mfa'` يُفحص في الدخول: `verifyAccess` يرفض التحدّي،
 *   و`verifyChallenge` يرفض توكنَ الوصول. ولا جلسةَ تُنشأ ولا كوكي يُرسَل
 *   قبل أن يصل الرمز — فمهاجمٌ بكلمة السرّ وحدها لا يملك كوكيَ ثلاثين يوماً.
 */
const CHALLENGE_TTL_SEC = 5 * 60;

interface ChallengeClaims {
  sub: string;
  typ: 'mfa';
  /** معرّفٌ فريدٌ للتحدّي — وهو مفتاحُ حدِّ المحاولات، فلا يُعدّ على البريد. */
  jti: string;
  exp: number;
}

export function signChallenge(userId: string): string {
  const payload: ChallengeClaims = {
    sub: userId,
    typ: 'mfa',
    jti: randomBytes(16).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC,
  };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyChallenge(token: string): ChallengeClaims | null {
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as ChallengeClaims;
    if (claims.typ !== 'mfa') return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/* ───────────────────────── الجلسات ───────────────────────── */

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ refresh: string; sessionId: string }> {
  const refresh = randomBytes(32).toString('base64url');
  // rls-exempt: sessions جدولٌ عامّ خارج RLS — مفتاحه user_id لا tenant_id
  const [row] = await getDb().insert(sessions).values({
    userId,
    refreshHash: sha256(refresh),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
  }).returning({ id: sessions.id });
  return { refresh, sessionId: row!.id };
}

/**
 * ★ **نافذةُ سماحٍ للتوكن السابق — وتبويبان كانا يُسقطان المستخدم من الحساب.**
 *
 *   الموظّف يفتح الإنبوكس وجهةَ اتّصالٍ في تبويبَين، وكلاهما يُجدّد حين ينتهي
 *   توكنُ الوصول (ربعُ ساعة). فيصل الثاني بتوكنٍ صار سابقاً، ويُردّ ٤٠١
 *   **ومعه مسحُ الكوكي** — والكوكي مشتركٌ بين التبويبات كلِّها، فيسقط التبويبُ
 *   الأوّل الذي كان يعمل بنجاحٍ قبل ثانية. والمستخدم لم يفعل شيئاً إلّا أنّه
 *   فتح شاشتين.
 *
 *   فنصفُ دقيقةٍ يبقى فيها السابقُ مقبولاً: الخاسرُ يأخذ توكنَ وصولٍ جديداً
 *   ولا يلمس الكوكي (‏`refresh: null`). وثلاثون ثانيةً سقفٌ مقصود: هي مدى
 *   تسابقٍ بين تبويبين، لا عمرُ توكنٍ مسروق.
 */
export const REFRESH_GRACE_MS = 30_000;

export async function rotateSession(
  refresh: string,
): Promise<{ userId: string; sessionId: string; refresh: string | null } | null> {
  const db = getDb();
  const hash = sha256(refresh);
  const next = randomBytes(32).toString('base64url');
  const now = new Date();

  /* ★ **عبارةٌ واحدةٌ لا قراءةٌ ثمّ كتابة.**
     القراءةُ المنفصلة تسمح لمتسابقَين أن يمرّا معاً فيُصدر كلٌّ منهما توكناً
     ويُخزَّن آخرُهما وحده — فيحمل كوكي أحدِهما توكناً لا يطابق شيئاً، ويسقط
     في التجديد التالي. والعبارةُ الواحدة تُقفل الصفَّ فيفوز واحدٌ بيقين. */
  // rls-exempt: sessions جدولٌ عامّ خارج RLS — مفتاحه user_id لا tenant_id
  const won = await db.update(sessions)
    .set({
      refreshHash: sha256(next),
      prevRefreshHash: hash,
      rotatedAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_SEC * 1000),
    })
    .where(and(
      eq(sessions.refreshHash, hash),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, now),
    ))
    .returning({ id: sessions.id, userId: sessions.userId });

  if (won[0]) return { userId: won[0].userId, sessionId: won[0].id, refresh: next };

  /* ★ ولم يفز: فلعلّه المتسابقُ الخاسر. يُقبل توكنُه السابق نصفَ دقيقة،
     ويُعطى وصولاً جديداً **بلا كوكي** — كوكي الفائز هو الصحيح، وترويسةٌ من
     الخاسر تُصيبه بتوكنٍ ميّتٍ إن وصلت أخيراً. */
  // rls-exempt: sessions جدولٌ عامّ خارج RLS — مفتاحه user_id لا tenant_id
  const grace = await db.select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(
      eq(sessions.prevRefreshHash, hash),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, now),
      gt(sessions.rotatedAt, new Date(now.getTime() - REFRESH_GRACE_MS)),
    ))
    .limit(1);

  if (grace[0]) return { userId: grace[0].userId, sessionId: grace[0].id, refresh: null };
  return null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  // rls-exempt: sessions جدولٌ عامّ خارج RLS — مفتاحه user_id لا tenant_id
  await getDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

/* ───────────────────────── الصلاحيّات ───────────────────────── */

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessClaims;
  }
}

const COOKIE = 'aibot_rt';
export const refreshCookie = (value: string, maxAgeSec = REFRESH_TTL_SEC) =>
  `${COOKIE}=${value}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
export const clearRefreshCookie = () =>
  `${COOKIE}=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function readRefreshCookie(header: string | undefined): string | null {
  if (!header) return null;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(header);
  return m ? m[1]! : null;
}

/**
 * مصفوفة الصلاحيّات تُفحص في hook واحد لا في كلّ مسار.
 * `readonly` تعني: كلّ فعلٍ كاتب مرفوض — وهو ما يجعل انتحال المالك آمناً.
 */
export const PERMISSIONS: Record<Role, { write: boolean; settings: boolean; billing: boolean; console: boolean }> = {
  platform_owner: { write: true, settings: true, billing: true, console: true },
  tenant_owner:   { write: true, settings: true, billing: true, console: false },
  tenant_agent:   { write: true, settings: false, billing: false, console: false },
};

export function requireAuth(opts: { role?: Role[]; settings?: boolean; billing?: boolean; console?: boolean } = {}) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const claims = token ? verifyAccess(token) : null;
    if (!claims) throw new AppError(ErrorCode.UNAUTHORIZED, 'يلزم تسجيل الدخول', 401);

    if (opts.role && !opts.role.includes(claims.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'لا صلاحيّة لهذا الإجراء', 403);
    }
    const p = PERMISSIONS[claims.role];
    if (opts.settings && !p.settings) throw new AppError(ErrorCode.FORBIDDEN, 'الإعدادات لمالك الحساب', 403);
    if (opts.billing && !p.billing) throw new AppError(ErrorCode.FORBIDDEN, 'الفوترة لمالك الحساب', 403);
    if (opts.console && !p.console) throw new AppError(ErrorCode.FORBIDDEN, 'لوحة المالك محجوبة', 403);
    /* ★★★ واللوحةُ مفتاحُ القراءة إلى كلّ عميل: قائمتُهم، وتوكنُ انتحالٍ
       داخل أيّ منهم، وغرفةُ كلّ مستأجرٍ في الويبسوكِت. فكلمةُ سرٍّ وحدها لا
       تفتحها. والفحصُ على `opts.console` لا على الدور، فيغطّي كذلك المسارَين
       الكاتبَين العابرَين للمستأجرين (`bot/seed` و`channel/connect`) وهما
       بـ`console: true` بلا قائمة أدوار. */
    if (opts.console && claims.mfa !== 'ok') {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'لوحة المالك تحتاج رمز المصادقة الثنائيّة — فعّلها ثمّ سجّل الدخول من جديد.',
        403,
      );
    }

    // الانتحال قراءةٌ فقط — وكلّ فعلٍ كاتبٍ يُرفض ولو كان الدور يسمح به
    if (claims.imp && req.method !== 'GET' && req.method !== 'HEAD') {
      throw new AppError(ErrorCode.FORBIDDEN, 'الانتحال قراءةٌ فقط', 403);
    }
    req.auth = claims;
  };
}

/** المستأجر يُشتقّ من التوكن لا من الطلب — لا يُرسَل معرّفه في جسمٍ ولا مسار. */
export function tenantOf(req: FastifyRequest): string {
  const t = req.auth?.tid;
  if (!t) throw new AppError(ErrorCode.FORBIDDEN, 'هذا المسار لمستخدمي المستأجرين', 403);
  return t;
}

/* ───────────────────────── المسارات ───────────────────────── */

export async function registerAuth(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (req, reply) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    const password = String(req.body?.password ?? '');
    if (!email || !password) throw new AppError(ErrorCode.VALIDATION, 'البريد وكلمة السرّ مطلوبان', 400);

    /* ★ الحدُّ **قبل** `scrypt` لا بعده: التجزئة هي الكلفة، فحدٌّ يُفحص بعدها
       يمنع الاختراق ولا يمنع استنزاف المعالج. وقبل قراءة المستخدم أيضاً —
       فلا يكشف الحدُّ أيَّ بريدٍ مسجَّل. */
    await enforceRate(
      loginRules(email, req.ip),
      'محاولاتُ دخولٍ كثيرةٌ في وقتٍ قصير. انتظر دقيقةً ثمّ أعِد المحاولة.',
      (v) => req.log.warn({ limit: v.rule?.limit, count: v.count }, 'حدُّ معدّلِ الدخول أُطلق'),
    );

    /* المصادقة **عابرةٌ للمستأجرين بطبيعتها**: لا سياق بعد، وصفُّ مالك
       المنصّة بلا `tenant_id` أصلاً. فالبحث عن المستخدم يمرّ بالدور المتجاوز
       صراحةً — وهذا أوضح من سياسةٍ تفتح الجدول للجميع.
       (كشفه أوّل تشغيلٍ بدورٍ عاديّ: قبله كان التطبيق سوبريوزر فلم يظهر.) */
    const rows = await withPlatform(getDb(), 'مصادقة: البحث عن المستخدم بالبريد وحالةِ مستأجره',
      (tx) => tx.select({ u: users, tenantStatus: tenants.status })
        .from(users)
        .leftJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.email, email)).limit(1));
    const user = rows[0]?.u;
    // رسالةٌ واحدة للحالتين — لا نكشف أيّ بريدٍ مسجَّل
    const bad = () => new AppError(ErrorCode.UNAUTHORIZED, 'البريد أو كلمة السرّ غير صحيحة', 401);
    /* ★ **التجزئةُ تُنفَّذ قبل أيّ قرار — لا خروجَ مبكِّراً على بريدٍ مجهول.**
       الخروجُ المبكِّر هو التسريبُ نفسُه: انظر `DECOY_HASH` أعلاه. وأسبابُ
       الرفض الثلاثة (لا بريدَ كهذا · حسابٌ معطَّل · كلمةٌ خاطئة) تكلّف الآن
       تجزئةً واحدةً وتعود بنفس الجسم. */
    const ok = await verifyPassword(password, passwordHashOrDecoy(user?.passwordHash));
    if (!user || !user.isActive || !ok) throw bad();

    /* ★ **حالةُ المستأجر تُفحص بعد كلمة السرّ لا قبلها.**
       قبلَها تصير مقياساً يُميّز بريداً مسجَّلاً من غيره بلا معرفة الكلمة.
       وبعدَها: من يعرف كلمتَه يستحقّ أن يُقال له **لماذا** لا يدخل — و«البريد
       أو كلمة السرّ غير صحيحة» على حسابٍ موقوفٍ تُرسل صاحبَه إلى استعادة
       كلمةٍ لا تُصلح شيئاً. */
    if (tenantBlocked(rows[0]?.tenantStatus)) {
      throw new AppError(ErrorCode.TENANT_SUSPENDED, TENANT_BLOCKED_AR, 403);
    }

    /* ★★★ **مالكُ المنصّة المُسجَّل لا يُعطى جلسةً بكلمة السرّ وحدها.**
       لا صفَّ جلسةٍ ولا كوكيَ تحديثٍ ولا توكنَ وصول — تحدٍّ عمرُه خمسُ دقائق
       وحده. فمن سرق كلمةَ السرّ لا يملك شيئاً يعيش ثلاثين يوماً. */
    if (user.role === 'platform_owner' && user.mfaSecretEnc) {
      return reply.send({ mfaRequired: true, challenge: signChallenge(user.id) });
    }

    const { refresh, sessionId } = await createSession(user.id, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });
    await withPlatform(getDb(), 'مصادقة: ختم آخر دخول',
      (tx) => tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)));

    /* ★ ومالكُ منصّةٍ **لم يُسجّل بعد** يدخل ويبقى بلا `mfa` — فتُرفض عليه
       اللوحةُ ويبقى بابُ التسجيل مفتوحاً. وبلا هذه السماحة يُقفَل المالكُ
       القائم خارج المنصّة كلِّها بلا بابٍ ذاتيٍّ يعود منه. ومستخدمو
       المستأجرين بعاملٍ واحدٍ بالتصميم في هذه الدفعة، فيحملونها دائماً. */
    const access = signAccess({
      sub: user.id, tid: user.tenantId, role: user.role, sid: sessionId,
      ...(user.role === 'platform_owner' ? {} : { mfa: 'ok' as const }),
    });
    return reply.header('set-cookie', refreshCookie(refresh)).send({
      access,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
    });
  });

  app.post('/auth/refresh', async (req, reply) => {
    const rt = readRefreshCookie(req.headers.cookie);
    if (!rt) throw new AppError(ErrorCode.UNAUTHORIZED, 'لا جلسة', 401);
    const rotated = await rotateSession(rt);
    if (!rotated) {
      return reply.header('set-cookie', clearRefreshCookie()).code(401)
        .send({ error: { code: ErrorCode.UNAUTHORIZED, message: 'انتهت الجلسة' } });
    }
    const rows = await withPlatform(getDb(), 'مصادقة: تجديد الجلسة وحالةُ مستأجرها',
      (tx) => tx.select({ u: users, tenantStatus: tenants.status })
        .from(users)
        .leftJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.id, rotated.userId)).limit(1));
    const user = rows[0]?.u;
    if (!user?.isActive) throw new AppError(ErrorCode.UNAUTHORIZED, 'الحساب معطَّل', 401);

    /* ★ والتجديدُ هو نقطةُ الفحص التي يوثّقها هذا الملفّ: التوكن يعيش ربعَ
       ساعة، والكوكي ثلاثين يوماً. فبلا فحصٍ هنا يبقى حسابٌ أُوقف اليومَ
       يُجدّد جلستَه شهراً كاملاً. */
    if (tenantBlocked(rows[0]?.tenantStatus)) {
      return reply.header('set-cookie', clearRefreshCookie()).code(403)
        .send({ error: { code: ErrorCode.TENANT_SUSPENDED, message: TENANT_BLOCKED_AR } });
    }

    /* ★★ والعاملُ الثاني يُثبَت **للجلسة** لا للتوكن: صفُّ الجلسة لم يُنشأ
       إلّا بعد الرمز. فبلا حملِ المطالبة هنا تموت اللوحةُ بعد ربع ساعةٍ من
       الدخول بـ٤٠٣ لا تفسيرَ لها. */
    const access = signAccess({
      sub: user.id, tid: user.tenantId, role: user.role, sid: rotated.sessionId,
      ...(user.role === 'platform_owner' && !user.mfaSecretEnc ? {} : { mfa: 'ok' as const }),
    });
    /* ★ الخاسرُ لا يُرسل كوكي — انظر `rotateSession`. */
    if (rotated.refresh === null) return reply.send({ access });
    return reply.header('set-cookie', refreshCookie(rotated.refresh)).send({ access });
  });

  /**
   * تغيير كلمة السرّ.
   *
   * ★ وُجد لأنّ `mustChangePassword` كان يُكتب عند إنشاء الحساب ويُرسَل عند
   *   الدخول و**لا تُقرأ في أيّ مكان** — فمن أُنشئ له حسابٌ بكلمةٍ مؤقّتة
   *   يدخل بها ويبقى عليها إلى الأبد. وهي كلمةٌ يعرفها من أنشأ الحساب،
   *   ومرّت في نصٍّ صريح على شاشةٍ وربّما في رسالة.
   *
   * وأربعة حدود:
   *  ① الكلمة القديمة مطلوبةٌ دائماً — حتّى للمؤقّتة. توكنٌ مسروقٌ لا يكفي
   *    لخطف الحساب نهائيّاً؛ السارق يحتاج الكلمة أيضاً.
   *  ② طولٌ أدنى 10 محارف. والتعقيد المفروض يُنتج كلماتٍ أسوأ تُكتب على ورقة.
   *  ③ الجديدة لا تساوي القديمة — وإلّا «غيّرها» بلا تغيير وسقط العلم.
   *  ④ **كلّ الجلسات الأخرى تُبطَل** بعد التغيير. تغييرُ كلمةِ سرٍّ لا يُخرج
   *    المتسلّل هو تغييرٌ شكليّ. وجلستك الحاليّة تبقى فلا تُطرَد من فعلك أنت.
   */
  app.post<{ Body: { current?: string; next?: string } }>(
    '/auth/password',
    { preHandler: requireAuth() },
    async (req) => {
      const current = String(req.body?.current ?? '');
      const next = String(req.body?.next ?? '');

      if (next.length < 10) {
        throw new AppError(ErrorCode.VALIDATION, 'كلمة السرّ الجديدة عشرة محارف على الأقلّ.', 400);
      }
      if (next === current) {
        throw new AppError(ErrorCode.VALIDATION, 'الكلمة الجديدة نفس القديمة.', 400);
      }

      const db = getDb();
      const me = (await withPlatform(db, 'مصادقة: قراءة المستخدم لتغيير كلمته',
        (tx) => tx.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)))[0];
      if (!me) throw new AppError(ErrorCode.UNAUTHORIZED, 'لا مستخدم', 401);

      if (!(await verifyPassword(current, me.passwordHash))) {
        throw new AppError(ErrorCode.VALIDATION, 'كلمة السرّ الحاليّة غير صحيحة.', 400);
      }

      const hash = await hashPassword(next);
      await withPlatform(db, 'مصادقة: حفظ كلمة سرٍّ جديدة وإبطال الجلسات الأخرى', async (tx) => {
        await tx.update(users)
          .set({ passwordHash: hash, mustChangePassword: false })
          .where(eq(users.id, me.id));

        // كلّ جلسةٍ عدا الحاليّة تُبطَل — فتغيير الكلمة يُخرج المتسلّل فعلاً
        await tx.update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(
            eq(sessions.userId, me.id),
            ne(sessions.id, req.auth!.sid),
            isNull(sessions.revokedAt),
          ));

        await tx.insert(auditLog).values({
          tenantId: me.tenantId, actorUserId: me.id,
          action: 'user.password_change', entity: 'user', entityId: me.id, ip: req.ip,
        });
      });

      return { ok: true };
    },
  );

  /* ═════════════════ العامل الثاني لمالك المنصّة ═════════════════ */

  /**
   * ★★★ الخطوةُ الثانية من الدخول — بلا توكنِ وصولٍ أصلاً.
   *
   *   المُنادي هنا لا يملك جلسةً: الدخولُ لم يُنشئ له واحدةً عمداً. فالتحدّي
   *   وحده هو ما يُثبت أنّه اجتاز كلمةَ السرّ، و`typ` فيه يمنع تقديمَه
   *   بطاقةَ دخولٍ إلى `requireAuth`.
   */
  app.post<{ Body: { challenge?: string; code?: string } }>('/auth/mfa/verify', async (req, reply) => {
    const parsed = MfaVerifyBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, 'رمزٌ من ستّ خاناتٍ وتحدٍّ صالح', 400);
    }
    const ch = verifyChallenge(parsed.data.challenge);
    if (!ch) throw new AppError(ErrorCode.UNAUTHORIZED, 'انتهت مهلةُ الرمز — سجّل الدخول من جديد.', 401);

    /* ⚠️ والحدُّ على `jti` لا على البريد: تحدٍّ واحدٌ يحتمل خمسَ محاولات، ثمّ
       يُعاد الدخولُ من أوّله. وعدٌّ على البريد كان يسمح بتوليد تحدٍّ جديدٍ
       لكلّ خمسِ محاولاتٍ بلا سقف. */
    await enforceRateStrict(
      mfaRules(ch.jti),
      'محاولاتٌ كثيرة على هذا الرمز. سجّل الدخول من جديد.',
    );

    const db = getDb();
    const rows = await withPlatform(db, 'مصادقة: قراءة سرّ العامل الثاني',
      (tx) => tx.select({ u: users }).from(users).where(eq(users.id, ch.sub)).limit(1));
    const user = rows[0]?.u;
    if (!user?.isActive || !user.mfaSecretEnc) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'تعذّر إكمالُ الدخول.', 401);
    }

    /* ★ الفكُّ والتحقّقُ **خارج** أيّ معاملة: حسابٌ محلّيٌّ لا يحتجز اتّصالاً
       من بِركة العشرة، وهي نفسُ قاعدة `scrypt` في الخطوة الأولى. */
    const okCode = verifyTotp(open(user.mfaSecretEnc, user.mfaKeyVersion ?? 1), parsed.data.code);
    if (!okCode) throw new AppError(ErrorCode.UNAUTHORIZED, 'الرمز غير صحيح.', 401);

    const { refresh, sessionId } = await createSession(user.id, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });
    await withPlatform(db, 'مصادقة: ختم آخر دخول بعد العامل الثاني', async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await tx.insert(auditLog).values({
        tenantId: null, actorUserId: user.id,
        action: 'auth.mfa_verify', entity: 'user', entityId: user.id, ip: req.ip,
      });
    });

    const access = signAccess({
      sub: user.id, tid: user.tenantId, role: user.role, sid: sessionId, mfa: 'ok',
    });
    return reply.header('set-cookie', refreshCookie(refresh)).send({
      access,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    });
  });

  /**
   * ★ بدءُ التسجيل — بـ`requireAuth()` وحدها لا بصلاحيّة اللوحة.
   *
   *   وهذا هو بابُ الخروج من القفل: مالكٌ بلا سرٍّ يدخل عاديّاً (بلا `mfa`)
   *   ويبلغ هذا المسار، فيُسجّل بنفسه من المتصفّح بلا صدفةٍ على الخادم.
   */
  app.post('/auth/mfa/enroll', { preHandler: requireAuth() }, async (req) => {
    const db = getDb();
    const me = (await withPlatform(db, 'مصادقة: قراءة المستخدم لبدء تسجيل العامل الثاني',
      (tx) => tx.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)))[0];
    if (!me) throw new AppError(ErrorCode.UNAUTHORIZED, 'لا مستخدم', 401);

    /* ⚠️ ولا استبدالَ صامتٌ لسرٍّ قائم: من سرق جلسةً نشطةً كان سيُسجّل هاتفَه
       هو ويُخرج صاحبَ الحساب من عاملِه الثاني بضغطة. والاستبدالُ يمرّ
       بـ`ops/clear-mfa.ts` وحدَه. */
    if (me.mfaEnrolledAt) {
      throw new AppError(ErrorCode.VALIDATION, 'لهذا الحساب عاملٌ ثانٍ مُفعَّلٌ أصلاً.', 409);
    }

    const totpSecret = generateTotpSecret();
    const sealed = seal(totpSecret);
    await withPlatform(db, 'مصادقة: حفظ سرّ العامل الثاني مختوماً', (tx) => tx.update(users)
      .set({ mfaSecretEnc: sealed.enc, mfaKeyVersion: sealed.keyVersion })
      .where(eq(users.id, me.id)));

    /* يُعاد نصّاً صريحاً **مرّةً واحدة** — وهذا كلُّ الغرض. ولا يُقرأ بعدها من
       أيّ مسار: `mfa_secret_enc` مختومٌ ولا يُعاد. */
    const otpauth = otpauthUri(totpSecret, me.email);

    /* ★★ ورمزٌ يُمسح بالكاميرا: نقلُ اثنين وثلاثين محرفاً بالعين هو الخطوةُ
       التي يُخطئ فيها الناس ويتركونها، وحرفٌ واحدٌ خاطئ يُنتج رمزاً لا يُقبل
       أبداً بلا سببٍ ظاهر — فيُقرأ العطلُ فينا.

       ⚠️ ويُرسَم عندنا لا عند طرفٍ ثالث: خدماتُ QR بالرابط تعني إرسالَ
          `otpauth://…secret=…` إلى خادمٍ لا نملكه — أي تسليمَ العامل الثاني
          لمن يرسم صورته.
       ⚠️ ومصفوفةُ أصفارٍ وآحادٍ لا نصَّ SVG: النصُّ يحتاج حقناً في DOM عند
          الرسم، والمصفوفةُ أرقامٌ لا ترسم إلّا مربّعات. */
    return { totpSecret, otpauth, qr: qrRows(otpauth, 'M') };
  });

  /**
   * ★★ التفعيل — رمزٌ من التطبيق يُثبت أنّ السرَّ وصله فعلاً.
   *
   *   وبلا هذه الخطوة يُقفَل المالكُ بسرٍّ لم يُخزَّن في هاتفه: يُحفظ السرُّ
   *   ثمّ يُرفض الرمزُ في الدخول التالي إلى الأبد.
   */
  app.post<{ Body: { code?: string } }>('/auth/mfa/activate', { preHandler: requireAuth() }, async (req) => {
    const parsed = MfaActivateBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION, 'رمزٌ من ستّ خانات', 400);

    const db = getDb();
    const me = (await withPlatform(db, 'مصادقة: قراءة المستخدم لتفعيل العامل الثاني',
      (tx) => tx.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1)))[0];
    if (!me?.mfaSecretEnc) throw new AppError(ErrorCode.VALIDATION, 'ابدأ التسجيل أوّلاً.', 400);
    if (me.mfaEnrolledAt) throw new AppError(ErrorCode.VALIDATION, 'مُفعَّلٌ أصلاً.', 409);

    if (!verifyTotp(open(me.mfaSecretEnc, me.mfaKeyVersion ?? 1), parsed.data.code)) {
      throw new AppError(ErrorCode.VALIDATION, 'الرمز غير صحيح — تحقّق من ساعة هاتفك.', 400);
    }

    await withPlatform(db, 'مصادقة: تفعيل العامل الثاني وإبطال الجلسات الأخرى', async (tx) => {
      await tx.update(users).set({ mfaEnrolledAt: new Date() }).where(eq(users.id, me.id));
      /* ★★ وكلُّ جلسةٍ أخرى تُبطَل: تفعيلُ قفلٍ مع إبقاء بابٍ قديمٍ مفتوحاً
         ليس تفعيلاً. وجلسةُ هذا التبويب تبقى — لا نطرد من فعَل الشيءَ للتوّ. */
      await tx.update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(sessions.userId, me.id),
          ne(sessions.id, req.auth!.sid),
          isNull(sessions.revokedAt),
        ));
      await tx.insert(auditLog).values({
        tenantId: null, actorUserId: me.id,
        action: 'auth.mfa_enroll', entity: 'user', entityId: me.id, ip: req.ip,
      });
    });

    /* والمطالبةُ لا تُضاف إلى توكنٍ صادرٍ سلفاً — فالدخولُ من جديد هو ما
       يفتح اللوحة، وتقولها الرسالةُ صراحةً بدل أن تُترك للتخمين. */
    return { ok: true, relogin: true };
  });

  app.post('/auth/logout', { preHandler: requireAuth() }, async (req, reply) => {
    await revokeSession(req.auth!.sid);
    return reply.header('set-cookie', clearRefreshCookie()).send({ ok: true });
  });

  app.get('/me', { preHandler: requireAuth() }, async (req) => {
    const db = getDb();
    const { user, tenant } = await withPlatform(db, 'قراءة بطاقة المستخدم الحاليّ', async (tx) => {
      const u = (await tx.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1))[0]!;
      const t = u.tenantId
        ? (await tx.select().from(tenants).where(eq(tenants.id, u.tenantId)).limit(1))[0]
        : null;
      return { user: u, tenant: t };
    });
    return {
      /* ★ **بلا هذا الحقل كان الإلزامُ يعيش في ردّ الدخول وحده.**
         استئنافُ الجلسة من كوكي التحديث يُعيد بطاقةً بلا علَم، فلا تملك
         القشرةُ ما تحرس به. والبوّابةُ كانت مُعامِلاً في العنوان (`?first=1`)
         يضعه تحويلُ الدخول وحده — فمن حذفه أو كتب `/app/inbox` بأصابعه مرّ،
         وبقيت كلمةٌ **يعرفها من أنشأ الحساب** صالحةً إلى الأبد. */
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      tenant: tenant && { id: tenant.id, name: tenant.name, status: tenant.status, capabilities: tenant.capabilities },
      permissions: PERMISSIONS[user.role],
      impersonating: req.auth!.imp ?? null,
      /* ★ ثلاثُ حالاتٍ لا علَمٌ ثنائيّ: `pending` لم يُسجّل بعد فيُرسَل إلى
         التسجيل، و`stale` سجَّل وهذا التوكنُ لم يخطُ الخطوةَ الثانية فيُرسَل
         إلى الدخول. وجمعُهما في `false` يقول لمن سجَّل «سجِّل» — وهذه أسرعُ
         طريقٍ إلى إطفاء الميزة. */
      mfa: req.auth!.mfa === 'ok' ? 'ok' : (user.mfaSecretEnc ? 'stale' : 'pending'),
    };
  });
}
