import type { FastifyInstance } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb, withPlatform, withTenant, tenantChannels, auditLog, eq, and, sql } from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { seal, open, publicId } from '@aibot/crypto';
import { requireAuth, tenantOf } from '../auth.js';
import { kvGet, kvSet, kvDel } from '../queues.js';

/**
 * ★★★ ربطُ إنستجرام عبر «تسجيل الدخول بفيسبوك للأعمال» — على تطبيق المنصّة.
 *
 *   الطريقةُ المعتمدة: حسابُ إنستجرام الاحترافيّ مربوطٌ بصفحة فيسبوك، والرسائلُ
 *   تمرّ عبر الصفحة بتوكنها. العميلُ لا ينشئ تطبيقاً ولا يلصق توكناً: يوافق مرّةً
 *   ويختار صفحته. والصلاحيّاتُ الأربع (‏`instagram_basic` · `instagram_manage_messages`
 *   · `pages_manage_metadata` · `pages_show_list`) تحتاج مراجعةً وتوثيقَ نشاط AiBot
 *   **مرّةً للمنصّة كلّها** — وقبلها لا ينجح الربطُ إلّا لحساباتٍ لها دورٌ في التطبيق.
 *
 * ⚠️ بلا مفاتيح التطبيق في البيئة يُعلَن «غيرُ متاح» ولا يُعرض زرٌّ لا يعمل:
 *    زرٌّ يفتح نافذةَ فيسبوك ثمّ يفشل أسوأُ من غيابه.
 *
 * التدفّق:
 *   ① `POST /channels/instagram/start` ← رابطُ نافذة فيسبوك بحالةٍ موقَّعة.
 *   ② فيسبوك يعيد إلى `GET /oauth/meta/callback` ← توكنٌ طويلُ العمر ثمّ صفحاتُ
 *      المستخدم التي لها حسابُ إنستجرام، تُختم في ريدِس عشرَ دقائق.
 *   ③ الشاشةُ تعرض الصفحات (‏`GET /channels/instagram/pending/:nonce`) بلا توكنات.
 *   ④ `POST /channels/instagram/connect` ← اشتراكُ الصفحة في إشعارات الرسائل،
 *      ثمّ حفظُ القناة بتوكن الصفحة مختوماً.
 */

const GRAPH_VER = process.env.META_GRAPH_VERSION ?? 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VER}`;
const SCOPES = ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata', 'pages_show_list'];
const PICK_TTL = 600;
const publicUrl = () => (process.env.PUBLIC_URL ?? 'https://aibot.masaros.net').replace(/\/+$/, '');
const redirectUri = () => `${publicUrl()}/api/oauth/meta/callback`;

/** هل التطبيقُ مهيّأ؟ — والسببُ مكتوبٌ لمن يقرأ الشاشة. */
export function instagramAvailability(): { available: boolean; reason: string | null } {
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return { available: false, reason: 'ربط إنستجرام لم يفعّل على المنصّة بعد — ينتظر اعتماد تطبيق AiBot عند ميتا.' };
  }
  return { available: true, reason: null };
}

/* ───────── الحالةُ الموقَّعة: لا جلسةَ في العودة من فيسبوك ───────── */

interface State { t: string; u: string; n: string; e: number }

function stateKey(): string {
  const k = process.env.JWT_SECRET;
  if (!k) throw new Error('JWT_SECRET غير مضبوط');
  return `ig-oauth:${k}`;
}
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signState(s: State): string {
  const body = b64u(JSON.stringify(s));
  return `${body}.${b64u(createHmac('sha256', stateKey()).update(body).digest())}`;
}

export function verifyState(raw: string | undefined, nowMs = Date.now()): State | null {
  if (!raw || !raw.includes('.')) return null;
  const [body, sig] = raw.split('.', 2) as [string, string];
  const want = createHmac('sha256', stateKey()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as State;
    return s.e > nowMs ? s : null;
  } catch { return null; }
}

/**
 * ★ `signed_request` من ميتا (سحبُ الإذن وحذفُ البيانات): جزءان مفصولان بنقطة،
 *   توقيعُ HMAC-SHA256 بسرّ التطبيق على الجزء الثاني كما وصل.
 */
export function parseSignedRequest(raw: string | undefined, secret: string): { user_id?: string } | null {
  if (!raw || !secret || !raw.includes('.')) return null;
  const [sig, payload] = raw.split('.', 2) as [string, string];
  const want = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return data?.algorithm?.toUpperCase?.() === 'HMAC-SHA256' ? data : null;
  } catch { return null; }
}

/* ───────── Graph ───────── */

async function graph(path: string, init?: RequestInit & { token?: string }): Promise<any> {
  const url = path.startsWith('http') ? path : `${GRAPH}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    throw new AppError(ErrorCode.VALIDATION, `ميتا رفضت الطلب: ${json?.error?.message ?? res.status}`, 502);
  }
  return json;
}

interface PickPage { pageId: string; pageName: string; igId: string; igUsername: string | null; pageToken: string }
interface Pick { tenantId: string; userId: string; fbUserId: string; pages: PickPage[] }

export async function registerInstagram(app: FastifyInstance) {
  const settings = requireAuth({ settings: true });

  app.get('/channels/instagram/status', { preHandler: requireAuth() }, async () => instagramAvailability());

  /** ① رابطُ نافذة الموافقة. */
  app.post('/channels/instagram/start', { preHandler: settings }, async (req) => {
    const av = instagramAvailability();
    if (!av.available) throw new AppError(ErrorCode.VALIDATION, av.reason!, 409);
    const state = signState({ t: tenantOf(req), u: req.auth!.sub, n: randomBytes(12).toString('hex'), e: Date.now() + PICK_TTL * 1000 });
    const q = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      redirect_uri: redirectUri(),
      state,
      response_type: 'code',
    });
    /* ★ «تسجيل الدخول للأعمال» يُضبط بمعرّف إعدادٍ في لوحة ميتا؛ وبدونه
       تُطلب الصلاحيّاتُ بأسمائها — والنتيجةُ نفسُها لحسابٍ واحد. */
    if (process.env.META_LOGIN_CONFIG_ID) q.set('config_id', process.env.META_LOGIN_CONFIG_ID);
    else q.set('scope', SCOPES.join(','));
    return { url: `https://www.facebook.com/${GRAPH_VER}/dialog/oauth?${q.toString()}` };
  });

  /** ② العودة من فيسبوك — بلا توكن جلسة؛ المستأجرُ من الحالة الموقَّعة. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_reason?: string } }>(
    '/oauth/meta/callback',
    async (req, reply) => {
      const back = (q: string) => reply.redirect(`${publicUrl()}/app/channels?${q}`);
      const st = verifyState(req.query.state);
      if (!st) return back('ig_error=state');
      if (req.query.error || !req.query.code) return back('ig_error=denied');
      const av = instagramAvailability();
      if (!av.available) return back('ig_error=unavailable');

      try {
        const id = process.env.META_APP_ID!;
        const secret = process.env.META_APP_SECRET!;
        const short = await graph(`/oauth/access_token?${new URLSearchParams({
          client_id: id, client_secret: secret, redirect_uri: redirectUri(), code: req.query.code,
        })}`);
        /* ★ توكنُ المستخدم طويلُ العمر ⟵ توكناتُ صفحاتٍ لا تنتهي ما لم يُسحب الإذن. */
        const long = await graph(`/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: short.access_token,
        })}`);
        const me = await graph('/me?fields=id', { token: long.access_token });
        const acc = await graph('/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100',
          { token: long.access_token });
        const pages: PickPage[] = (acc?.data ?? [])
          .filter((p: any) => p?.instagram_business_account?.id && p?.access_token)
          .map((p: any) => ({
            pageId: String(p.id), pageName: String(p.name ?? ''),
            igId: String(p.instagram_business_account.id),
            igUsername: p.instagram_business_account.username ?? null,
            pageToken: String(p.access_token),
          }));
        if (!pages.length) return back('ig_error=no_pages');
        const pick: Pick = { tenantId: st.t, userId: st.u, fbUserId: String(me.id), pages };
        const sealed = seal(JSON.stringify(pick));
        await kvSet(`igpick:${st.n}`, JSON.stringify(sealed), PICK_TTL);
        return back(`ig=${st.n}`);
      } catch (e) {
        req.log.warn({ err: (e as Error).message }, 'فشل ربط إنستجرام بعد العودة من فيسبوك');
        return back('ig_error=exchange');
      }
    },
  );

  async function loadPick(nonce: string, tenantId: string): Promise<Pick> {
    if (!/^[0-9a-f]{24}$/.test(nonce)) throw new AppError(ErrorCode.VALIDATION, 'رابط الربط غير صالح', 400);
    const raw = await kvGet(`igpick:${nonce}`);
    if (!raw) throw new AppError(ErrorCode.VALIDATION, 'انتهت مهلة الربط (عشر دقائق) — ابدأ من جديد.', 410);
    const s = JSON.parse(raw) as { enc: string; keyVersion: number };
    const pick = JSON.parse(open(s.enc, s.keyVersion)) as Pick;
    if (pick.tenantId !== tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'هذا الربط لحسابٍ آخر', 403);
    return pick;
  }

  /** ③ الصفحاتُ المتاحة — بلا توكنات. */
  app.get<{ Params: { nonce: string } }>('/channels/instagram/pending/:nonce', { preHandler: settings }, async (req) => {
    const pick = await loadPick(req.params.nonce, tenantOf(req));
    return { pages: pick.pages.map(({ pageToken: _t, ...p }) => p) };
  });

  /** ④ الربط: اشتراكُ الصفحة أوّلاً عند ميتا، ثمّ الحفظ — لا يُحفظ ما لم يثبت. */
  app.post<{ Body: { nonce?: string; pageId?: string } }>('/channels/instagram/connect', { preHandler: settings }, async (req) => {
    const tenantId = tenantOf(req);
    const pick = await loadPick(String(req.body?.nonce ?? ''), tenantId);
    const page = pick.pages.find((p) => p.pageId === req.body?.pageId);
    if (!page) throw new AppError(ErrorCode.VALIDATION, 'اختر صفحةً من القائمة.', 400);

    await graph(`/${page.pageId}/subscribed_apps?${new URLSearchParams({ subscribed_fields: 'messages,messaging_postbacks' })}`,
      { method: 'POST', token: page.pageToken });

    /* الحسابُ لا يخدم مستأجرَين: القيدُ الفريد يمنعه، والرسالةُ تقوله. */
    const taken = await withPlatform(getDb(), 'ربط إنستجرام: هل الحساب مربوطٌ بعميلٍ آخر؟', (tx) =>
      tx.select({ tenantId: tenantChannels.tenantId }).from(tenantChannels)
        .where(and(eq(tenantChannels.kind, 'instagram'), eq(tenantChannels.externalAccountId, page.igId))).limit(1));
    if (taken[0] && taken[0].tenantId !== tenantId) {
      throw new AppError(ErrorCode.VALIDATION, 'حساب إنستجرام هذا مربوطٌ بحسابٍ آخر على المنصّة.', 409);
    }

    const sealed = seal(page.pageToken);
    const row = await withTenant(getDb(), tenantId, async (tx) => {
      const [cur] = await tx.select().from(tenantChannels)
        .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'instagram'))).limit(1);
      const values = {
        tenantId, kind: 'instagram' as const,
        externalAccountId: page.igId,
        displayName: page.igUsername ? `@${page.igUsername}` : page.pageName,
        config: { pageId: page.pageId, pageName: page.pageName, igUsername: page.igUsername, fbUserId: pick.fbUserId },
        tokenEnc: sealed.enc,
        tokenFingerprint: publicId().slice(0, 8),
        appSecretEnc: null,
        keyVersion: sealed.keyVersion,
        status: 'connected' as const,
        lastCheckedAt: new Date(),
        lastError: null,
        connectedAt: cur?.connectedAt ?? new Date(),
      };
      const [r] = cur
        ? await tx.update(tenantChannels).set(values).where(eq(tenantChannels.id, cur.id)).returning()
        : await tx.insert(tenantChannels).values(values).returning();
      await tx.insert(auditLog).values({
        tenantId, actorUserId: req.auth!.sub, action: 'channel.connect',
        entity: 'tenant_channel', entityId: r!.id, ip: req.ip, diff: { kind: 'instagram' },
      });
      return r!;
    });
    await kvDel(`igpick:${req.body!.nonce}`);
    return { id: row.id, displayName: row.displayName, pageName: page.pageName };
  });

  /* ───────── نداءاتُ ميتا: سحبُ الإذن وحذفُ البيانات ───────── */

  /**
   * ★ من سحب الإذن أو طلب حذف بياناته من إعدادات فيسبوك: قنواتُه تُعطَّل
   *   ويُمحى توكنُها — فلا يبقى توكنٌ ميّتٌ يُفشل الإرسالَ بصمت.
   */
  async function revokeFor(fbUserId: string, code: string | null) {
    return withPlatform(getDb(), 'ميتا: سحب الإذن أو حذف البيانات لمستخدم فيسبوك', async (tx) => {
      const rows = await tx.update(tenantChannels).set({
        tokenEnc: null, status: 'disabled', lastError: 'سحب صاحب الحساب إذن AiBot من فيسبوك — أعد الربط.',
      }).where(and(eq(tenantChannels.kind, 'instagram'), sql`${tenantChannels.config}->>'fbUserId' = ${fbUserId}`))
        .returning({ id: tenantChannels.id, tenantId: tenantChannels.tenantId });
      for (const r of rows) {
        await tx.insert(auditLog).values({
          tenantId: r.tenantId, action: 'channel.meta_revoked', entity: 'tenant_channel',
          entityId: code ?? r.id, diff: { channelId: r.id },
        });
      }
      if (!rows.length && code) {
        await tx.insert(auditLog).values({ tenantId: null, action: 'channel.meta_revoked', entity: 'meta_deletion', entityId: code, diff: { channels: 0 } });
      }
      return rows.length;
    });
  }

  app.post<{ Body: { signed_request?: string } }>('/meta/deauthorize', async (req, reply) => {
    const data = parseSignedRequest(req.body?.signed_request, process.env.META_APP_SECRET ?? '');
    if (!data?.user_id) return reply.code(400).send({ error: 'signed_request غير صالح' });
    await revokeFor(String(data.user_id), null);
    return { ok: true };
  });

  app.post<{ Body: { signed_request?: string } }>('/meta/data-deletion', async (req, reply) => {
    const data = parseSignedRequest(req.body?.signed_request, process.env.META_APP_SECRET ?? '');
    if (!data?.user_id) return reply.code(400).send({ error: 'signed_request غير صالح' });
    const code = publicId().slice(0, 16);
    await revokeFor(String(data.user_id), code);
    return { url: `${publicUrl()}/data-deletion?code=${code}`, confirmation_code: code };
  });

  /** حالةُ طلب حذفٍ جاء من فيسبوك — للصفحة العامّة `/data-deletion?code=`. */
  app.get<{ Params: { code: string } }>('/public/meta-deletion/:code', async (req, reply) => {
    const code = String(req.params.code ?? '');
    if (!/^[A-Z0-9]{16}$/.test(code)) return reply.code(404).send({ found: false });
    const [row] = await withPlatform(getDb(), 'صفحة عامّة: حالة طلب حذف من فيسبوك', (tx) =>
      tx.select({ at: auditLog.createdAt }).from(auditLog)
        .where(and(eq(auditLog.action, 'channel.meta_revoked'), eq(auditLog.entityId, code))).limit(1));
    if (!row) return reply.code(404).send({ found: false });
    return { found: true, status: 'done', at: row.at.toISOString() };
  });
}
