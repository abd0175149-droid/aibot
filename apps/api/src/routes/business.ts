import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getDb, withPlatform, withTenant, tenants, plans, tenantChannels, auditLog, deletionRequests, contacts,
  eq, and, desc, sql,
} from '@aibot/db';
import {
  AppError, ErrorCode, BusinessProfileSchema, businessUrls, isProfileComplete, profileIssues,
  type BusinessProfile, type LinkCheckDTO, type MetaKitDTO, type PublicBusinessDTO,
} from '@aibot/shared';
import { requireAuth, tenantOf } from '../auth.js';

/**
 * ★★ ملفُّ النشاط وصفحاتُ العميل العامّة وحزمةُ ميتا.
 *
 *   تطبيقُ ميتا لواتساب ملكُ العميل، وتفعيلُه يطلب روابطَ خصوصيّةٍ وشروطٍ
 *   وتعليماتِ حذف بيانات **باسمه**. فالملفُّ يُكتب مرّةً في المعالج، والصفحاتُ
 *   تُبنى منه على مسار الدومين نفسِه (‏`/b/<slug>`)، والحزمةُ تجمع كلَّ ما يُلصق
 *   عند ميتا في موضعٍ واحدٍ بزرّ نسخٍ لكلّ حقل.
 *
 * ⚠️ `tenants` جدولٌ عامٌّ يقرؤه دورُ التطبيق ولا يكتبه، فالكتابةُ هنا بالدور
 *    المتجاوز وبسببٍ مكتوب — ومقيّدةٌ بالمستأجر الذي في التوكن أو في العنوان
 *    الصريح للوحة المالك، وكلُّها مسجَّلةٌ في سجلّ الأفعال.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
const publicUrl = () => (process.env.PUBLIC_URL ?? 'https://aibot.masaros.net').replace(/\/+$/, '');

type Tx = Parameters<Parameters<typeof withPlatform>[2]>[0];

async function loadTenant(tx: Tx, tenantId: string) {
  const [t] = await tx.select({
    id: tenants.id, slug: tenants.slug, name: tenants.name, publicId: tenants.publicId,
    status: tenants.status, profile: tenants.profile, profileUpdatedAt: tenants.profileUpdatedAt,
  }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) throw new AppError(ErrorCode.VALIDATION, 'لا عميلَ بهذا المعرّف', 404);
  return t;
}

/** الحزمةُ من صفّ المستأجر وقناةِ واتساب — مصدرٌ واحدٌ للوحة المالك وللعميل. */
async function metaKit(tx: Tx, tenantId: string): Promise<MetaKitDTO> {
  const t = await loadTenant(tx, tenantId);
  const [wa] = await tx.select({ verifyToken: tenantChannels.verifyToken }).from(tenantChannels)
    .where(and(eq(tenantChannels.tenantId, tenantId), eq(tenantChannels.kind, 'whatsapp_cloud'))).limit(1);
  const p = (t.profile ?? {}) as Partial<BusinessProfile>;
  const urls = businessUrls(publicUrl(), t.slug);
  return {
    urls,
    profileComplete: isProfileComplete(p),
    missing: profileIssues(p),
    appSettings: {
      displayName: p.tradeEn || p.tradeAr || t.name,
      contactEmail: p.email ?? '',
      privacyUrl: urls.privacy,
      termsUrl: urls.terms,
      dataDeletionUrl: urls.deletion,
      appDomain: new URL(publicUrl()).host,
      category: 'Business and pages',
      purpose: 'Yourself or your own business',
    },
    whatsapp: {
      callbackUrl: `${publicUrl()}/api/webhooks/wa/${t.publicId}`,
      verifyToken: wa?.verifyToken ?? null,
      webhookField: 'messages',
    },
  };
}

/** يحفظ الملفَّ بعد التحقّق، ويكتب أثرَه في سجلّ العميل. */
async function saveProfile(req: FastifyRequest, tenantId: string, body: unknown, reason: string) {
  const parsed = BusinessProfileSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(ErrorCode.VALIDATION, 'ملفّ النشاط ناقص أو فيه قيمة غير صالحة.', 400, { fields: profileIssues(body) });
  }
  return withPlatform(getDb(), reason, async (tx) => {
    const t = await loadTenant(tx, tenantId);
    await tx.update(tenants).set({ profile: parsed.data, profileUpdatedAt: new Date() }).where(eq(tenants.id, t.id));
    await tx.insert(auditLog).values({
      tenantId, actorUserId: req.auth!.sub, action: 'tenant.profile', entity: 'tenant', entityId: tenantId, ip: req.ip,
      /* ما تغيّر لا القيم: الملفُّ منشورٌ أصلاً، والسجلُّ يقول «من عدّل ومتى». */
      diff: { fields: Object.keys(parsed.data).filter((k) => JSON.stringify((t.profile as Record<string, unknown>)?.[k] ?? '') !== JSON.stringify((parsed.data as Record<string, unknown>)[k])) },
    });
    return { profile: parsed.data, kit: await metaKit(tx, tenantId) };
  });
}

/**
 * ★ فحصُ الروابط كما تفتحها ميتا — من خارج الخادم، عبر النفق نفسِه.
 *
 *   صفحةٌ تعمل على `127.0.0.1` قد تُحجب عند Cloudflare عن الزائر الآليّ،
 *   فالفحصُ يطلب الرابطَ العامَّ بترويسة زاحف ميتا. والرابطُ مبنيٌّ من
 *   `PUBLIC_URL` ومعرّفٍ مخزَّن — لا من مدخلٍ يكتبه أحد، فلا باب SSRF هنا.
 */
async function checkLinks(slug: string, profile: Partial<BusinessProfile>): Promise<LinkCheckDTO> {
  const urls = businessUrls(publicUrl(), slug);
  const names = [profile.tradeAr, profile.tradeEn].filter((x): x is string => Boolean(x && x.trim()));
  const items = await Promise.all((Object.keys(urls) as Array<keyof typeof urls>).map(async (key) => {
    const url = urls[key];
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
        signal: AbortSignal.timeout(8000),
      });
      const html = res.status === 200 ? await res.text() : '';
      return {
        key, url, status: res.status,
        hasName: names.some((n) => html.includes(n.replace(/&/g, '&amp;')) || html.includes(n)),
        hasEmail: Boolean(profile.email && html.includes(profile.email)),
        error: res.status === 200 ? null : `ردّ ${res.status}`,
      };
    } catch (e) {
      return { key, url, status: null, hasName: false, hasEmail: false, error: (e as Error).message };
    }
  }));
  return {
    checkedAt: new Date().toISOString(),
    ok: items.every((i) => i.status === 200 && i.hasName && i.hasEmail),
    items,
  };
}

export async function registerBusiness(app: FastifyInstance) {
  const owner = requireAuth({ console: true, role: ['platform_owner'] });
  const settings = requireAuth({ settings: true });

  /* ═══════════════ العامّ — بلا دخول ═══════════════ */

  /**
   * ما تحتاجه صفحاتُ `/b/<slug>`. لا حقلَ هنا ليس منشوراً على الصفحة نفسها.
   * ⚠️ ٤٠٤ واحدٌ لكلّ غياب (لا عميل · مؤرشف · ملفٌّ ناقص): لا يُفرَّق بين
   *    «موجودٌ غير جاهز» و«غير موجود» أمام زائرٍ مجهول.
   */
  app.get<{ Params: { slug: string } }>('/public/b/:slug', async (req, reply) => {
    const slug = String(req.params.slug ?? '').toLowerCase();
    if (!SLUG_RE.test(slug)) return reply.code(404).send({ error: 'غير موجود' });
    const out = await withPlatform(getDb(), 'صفحة عميل عامّة: قراءة ملفّ النشاط المنشور', async (tx) => {
      const [t] = await tx.select({
        id: tenants.id, status: tenants.status, profile: tenants.profile, updatedAt: tenants.profileUpdatedAt,
        retention: sql<number>`coalesce((${plans.limits}->>'retentionDays')::int, 365)`,
      }).from(tenants).leftJoin(plans, eq(plans.id, tenants.planId))
        .where(eq(tenants.slug, slug)).limit(1);
      if (!t || t.status === 'archived' || !isProfileComplete(t.profile)) return null;
      const chans = await tx.select({ kind: tenantChannels.kind }).from(tenantChannels)
        .where(eq(tenantChannels.tenantId, t.id));
      const dto: PublicBusinessDTO = {
        slug,
        profile: BusinessProfileSchema.parse(t.profile),
        retentionDays: Number(t.retention) || 365,
        channels: {
          whatsapp: chans.some((c) => c.kind === 'whatsapp_cloud'),
          instagram: chans.some((c) => c.kind === 'instagram'),
        },
        updatedAt: t.updatedAt?.toISOString() ?? null,
      };
      return dto;
    });
    if (!out) return reply.code(404).send({ error: 'غير موجود' });
    return reply.header('cache-control', 'public, max-age=60').send(out);
  });

  /* ═══════════════ لوحة المالك ═══════════════ */

  app.get<{ Params: { id: string } }>('/console/tenants/:id/profile', { preHandler: owner }, async (req) => {
    if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);
    return withPlatform(getDb(), 'لوحة المالك: قراءة ملفّ النشاط وحزمة ميتا', async (tx) => {
      const t = await loadTenant(tx, req.params.id);
      return { slug: t.slug, profile: t.profile, updatedAt: t.profileUpdatedAt, kit: await metaKit(tx, t.id) };
    });
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/console/tenants/:id/profile', { preHandler: owner }, async (req) => {
    if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);
    return saveProfile(req, req.params.id, req.body, 'لوحة المالك: حفظ ملفّ نشاط عميل');
  });

  app.post<{ Params: { id: string } }>('/console/tenants/:id/check-links', { preHandler: owner }, async (req) => {
    if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);
    const t = await withPlatform(getDb(), 'لوحة المالك: قراءة المعرّف لفحص الروابط', (tx) => loadTenant(tx, req.params.id));
    /* النداءُ الشبكيّ خارج أيّ معاملة. */
    return checkLinks(t.slug, (t.profile ?? {}) as Partial<BusinessProfile>);
  });

  /* ═══════════════ العميل نفسُه ═══════════════ */

  app.get('/business', { preHandler: settings }, async (req) => {
    const tenantId = tenantOf(req);
    return withPlatform(getDb(), 'العميل: قراءة ملفّ نشاطه وحزمة ميتا', async (tx) => {
      const t = await loadTenant(tx, tenantId);
      return { slug: t.slug, profile: t.profile, updatedAt: t.profileUpdatedAt, kit: await metaKit(tx, t.id) };
    });
  });

  app.put<{ Body: unknown }>('/business', { preHandler: settings }, async (req) =>
    saveProfile(req, tenantOf(req), req.body, 'العميل: حفظ ملفّ نشاطه'));

  app.post('/business/check-links', { preHandler: settings }, async (req) => {
    const t = await withPlatform(getDb(), 'العميل: قراءة معرّفه لفحص الروابط', (tx) => loadTenant(tx, tenantOf(req)));
    return checkLinks(t.slug, (t.profile ?? {}) as Partial<BusinessProfile>);
  });

  /* ═══════════════ طلباتُ حذف البيانات ═══════════════ */

  app.get('/deletion-requests', { preHandler: settings }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const rows = await tx.select({
        id: deletionRequests.id, contactId: deletionRequests.contactId, source: deletionRequests.source,
        handle: deletionRequests.handle, detail: deletionRequests.detail, status: deletionRequests.status,
        note: deletionRequests.note, createdAt: deletionRequests.createdAt, resolvedAt: deletionRequests.resolvedAt,
        contactName: contacts.displayName,
        contactExists: sql<boolean>`${contacts.id} IS NOT NULL`,
      }).from(deletionRequests)
        .leftJoin(contacts, eq(contacts.id, deletionRequests.contactId))
        .orderBy(sql`${deletionRequests.status} = 'pending' DESC`, desc(deletionRequests.createdAt))
        .limit(100);
      return { items: rows };
    });
  });

  /**
   * إغلاقُ الطلب. «نُفِّذ» لا يُقبل والجهةُ ما زالت موجودة: الحذفُ نفسُه يجري
   * من مساره المسجَّل (‏`DELETE /contacts/:id`) أوّلاً، وهذا يُغلق الطلب بعده —
   * فلا يُعلَن حذفٌ لم يقع.
   */
  app.post<{ Params: { id: string }; Body: { status?: string; note?: string } }>(
    '/deletion-requests/:id/resolve',
    { preHandler: settings },
    async (req) => {
      const tenantId = tenantOf(req);
      if (!UUID_RE.test(req.params.id)) throw new AppError(ErrorCode.VALIDATION, 'معرّفٌ غير صالح', 400);
      const status = req.body?.status;
      if (status !== 'done' && status !== 'refused') {
        throw new AppError(ErrorCode.VALIDATION, 'الحالة «نُفّذ» أو «رُفض».', 400);
      }
      const note = (req.body?.note ?? '').trim().slice(0, 300);
      if (status === 'refused' && !note) {
        throw new AppError(ErrorCode.VALIDATION, 'اكتب سبب الرفض — يحقّ للزبون أن يعرفه.', 400);
      }
      return withTenant(getDb(), tenantId, async (tx) => {
        const [r] = await tx.select().from(deletionRequests).where(eq(deletionRequests.id, req.params.id)).limit(1);
        if (!r) throw new AppError(ErrorCode.VALIDATION, 'لا طلبَ بهذا المعرّف', 404);
        if (status === 'done' && r.contactId) {
          const [still] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, r.contactId)).limit(1);
          if (still) throw new AppError(ErrorCode.VALIDATION, 'الجهة ما زالت موجودة — احذفها أوّلاً ثمّ أغلق الطلب.', 409);
        }
        const [row] = await tx.update(deletionRequests).set({
          status, note: note || null, resolvedAt: new Date(), resolvedBy: req.auth!.sub,
        }).where(eq(deletionRequests.id, r.id)).returning();
        await tx.insert(auditLog).values({
          tenantId, actorUserId: req.auth!.sub, action: `deletion_request.${status}`,
          entity: 'deletion_request', entityId: r.id, ip: req.ip,
        });
        return row;
      });
    },
  );
}
