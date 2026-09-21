import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCode, type Role } from '@aibot/shared';
import { getDb, withPlatform, users, sessions, tenants, eq, and, isNull, gt, sql } from '@aibot/db';
import { sha256 } from '@aibot/crypto';

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

/* ───────────────────────── التوكنات ───────────────────────── */

export interface AccessClaims {
  sub: string;       // userId
  tid: string | null; // tenantId — فارغٌ لمالك المنصّة
  role: Role;
  sid: string;       // sessionId
  /** انتحالٌ نشط: قراءةٌ فقط، ومسجَّل، ويراه العميل في سجلّه. */
  imp?: string;
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
 * تدوير الـrefresh عند كلّ استعمال.
 * إبطال الجلسة يُفحص **هنا فقط** لا في كلّ طلب — الكلفة لا تستحقّها،
 * ونافذة الخطر 15 دقيقةً على الأكثر (عمر توكن الوصول).
 */
export async function rotateSession(
  refresh: string,
): Promise<{ userId: string; sessionId: string; refresh: string } | null> {
  const db = getDb();
  const hash = sha256(refresh);
  // rls-exempt: sessions جدولٌ عامّ خارج RLS — مفتاحه user_id لا tenant_id
  const rows = await db.select().from(sessions).where(and(
    eq(sessions.refreshHash, hash),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, new Date()),
  )).limit(1);
  const row = rows[0];
  if (!row) return null;

  const next = randomBytes(32).toString('base64url');
  // rls-exempt: sessions جدولٌ عامّ خارج RLS — مفتاحه user_id لا tenant_id
  await db.update(sessions)
    .set({ refreshHash: sha256(next), expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000) })
    .where(eq(sessions.id, row.id));
  return { userId: row.userId, sessionId: row.id, refresh: next };
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

    /* المصادقة **عابرةٌ للمستأجرين بطبيعتها**: لا سياق بعد، وصفُّ مالك
       المنصّة بلا `tenant_id` أصلاً. فالبحث عن المستخدم يمرّ بالدور المتجاوز
       صراحةً — وهذا أوضح من سياسةٍ تفتح الجدول للجميع.
       (كشفه أوّل تشغيلٍ بدورٍ عاديّ: قبله كان التطبيق سوبريوزر فلم يظهر.) */
    const rows = await withPlatform(getDb(), 'مصادقة: البحث عن المستخدم بالبريد',
      (tx) => tx.select().from(users).where(eq(users.email, email)).limit(1));
    const user = rows[0];
    // رسالةٌ واحدة للحالتين — لا نكشف أيّ بريدٍ مسجَّل
    const bad = () => new AppError(ErrorCode.UNAUTHORIZED, 'البريد أو كلمة السرّ غير صحيحة', 401);
    if (!user || !user.isActive) throw bad();
    if (!(await verifyPassword(password, user.passwordHash))) throw bad();

    const { refresh, sessionId } = await createSession(user.id, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });
    await withPlatform(getDb(), 'مصادقة: ختم آخر دخول',
      (tx) => tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)));

    const access = signAccess({ sub: user.id, tid: user.tenantId, role: user.role, sid: sessionId });
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
    const rows = await withPlatform(getDb(), 'مصادقة: تجديد الجلسة',
      (tx) => tx.select().from(users).where(eq(users.id, rotated.userId)).limit(1));
    const user = rows[0];
    if (!user?.isActive) throw new AppError(ErrorCode.UNAUTHORIZED, 'الحساب معطَّل', 401);

    const access = signAccess({ sub: user.id, tid: user.tenantId, role: user.role, sid: rotated.sessionId });
    return reply.header('set-cookie', refreshCookie(rotated.refresh)).send({ access });
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
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenant: tenant && { id: tenant.id, name: tenant.name, status: tenant.status, capabilities: tenant.capabilities },
      permissions: PERMISSIONS[user.role],
      impersonating: req.auth!.imp ?? null,
    };
  });
}
