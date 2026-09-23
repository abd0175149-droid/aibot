/**
 * تهيئةُ مستأجرَي تمرينٍ لفحص العزل الحيّ (مراجعة ٠٥.٩ البند ①).
 *
 * ★ لماذا سكربتٌ لا استعلامٌ يدويّ: فحصُ «هل يقرأ مستأجرٌ بيانات آخر؟» يحتاج
 *   **دخولاً حقيقيّاً** بمستأجرَين و**معرّفاتٍ معلومةً** لصفوفٍ يملكها كلٌّ
 *   منهما. وبلا صفٍّ مميَّزٍ في الطرفين لا يُفرَّق بين «مُنع» و«لا شيء هناك
 *   أصلاً» — وهذا بالضبط شكلُ النجاح الكاذب.
 *
 * يعمل على مستأجري `drill` وحدهم، ويرفض غيرَهم بحاجزٍ صلب.
 *
 * الاستعمال (على الخادم):
 *   docker compose run --rm --no-deps -v "$HOME/aibot/ops:/app/ops:ro" \
 *     -e SLUG_A=drill -e SLUG_B=drill-price -e PROBE_PASSWORD=... \
 *     api node --import tsx ops/testing/security-probe-setup.ts
 */
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import {
  getDb, closeDb, withPlatform, tenants, users, tenantChannels, contacts,
  channelIdentities, conversations, messages, botVersions, botTools,
  knowledgeSources, botConfigs, eq, and,
} from '../../packages/db/src/index';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

/** نفس صيغة `apps/api/src/auth.ts` حرفيّاً — ولو اختلفت لما صحّ الدخول. */
async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** حاجزٌ صلب: لا يُلمس مستأجرٌ حقيقيّ من سكربت تمرين. */
const ALLOWED = new Set(['drill', 'drill-price', 'drill-debounce', 'drill-window-cap']);

async function provision(slug: string, password: string) {
  if (!ALLOWED.has(slug)) throw new Error(`slug غير مسموح للتمرين: ${slug}`);
  const db = getDb();
  return withPlatform(db, `تمرين أمنيّ: تهيئة مستأجر ${slug} لفحص العزل`, async (tx) => {
    const t = (await tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
    if (!t) throw new Error(`لا مستأجر بـslug=${slug}`);

    const email = `probe-owner+${slug}@aibot.local`;
    const hash = await hashPassword(password);
    let u = (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!u) {
      [u] = await tx.insert(users).values({
        tenantId: t.id, email, name: `مالك تمرين ${slug}`,
        passwordHash: hash, role: 'tenant_owner',
        mustChangePassword: false, isActive: true,
      }).returning();
    } else {
      await tx.update(users)
        .set({ passwordHash: hash, isActive: true, mustChangePassword: false, role: 'tenant_owner' })
        .where(eq(users.id, u.id));
    }

    const agentEmail = `probe-agent+${slug}@aibot.local`;
    let agent = (await tx.select().from(users).where(eq(users.email, agentEmail)).limit(1))[0];
    if (!agent) {
      [agent] = await tx.insert(users).values({
        tenantId: t.id, email: agentEmail, name: `موظّف تمرين ${slug}`,
        passwordHash: hash, role: 'tenant_agent', mustChangePassword: false, isActive: true,
      }).returning();
    } else {
      await tx.update(users).set({ passwordHash: hash, isActive: true, role: 'tenant_agent' })
        .where(eq(users.id, agent.id));
    }

    let ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, t.id), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) {
      [ch] = await tx.insert(tenantChannels).values({
        tenantId: t.id, kind: 'whatsapp_cloud',
        externalAccountId: `PROBE_${slug}`,
        displayName: 'قناة تمرين أمنيّ (لا ترسل)',
        status: 'connected', connectedAt: new Date(),
      }).returning();
    }

    const marker = `PROBE-${slug.toUpperCase()}`;
    let c = (await tx.select().from(contacts)
      .where(and(eq(contacts.tenantId, t.id), eq(contacts.displayName, marker))).limit(1))[0];
    if (!c) {
      [c] = await tx.insert(contacts).values({
        tenantId: t.id, displayName: marker, phone: `9627000${slug.length}000`,
        attributes: { probe: true },
      }).returning();
    }

    let idn = (await tx.select().from(channelIdentities)
      .where(and(eq(channelIdentities.tenantId, t.id), eq(channelIdentities.contactId, c!.id)))
      .limit(1))[0];
    if (!idn) {
      [idn] = await tx.insert(channelIdentities).values({
        tenantId: t.id, channelId: ch!.id, contactId: c!.id,
        externalId: `probe-${slug}`, displayHandle: marker,
      }).returning();
    }

    let conv = (await tx.select().from(conversations)
      .where(and(eq(conversations.tenantId, t.id), eq(conversations.contactId, c!.id)))
      .limit(1))[0];
    if (!conv) {
      [conv] = await tx.insert(conversations).values({
        tenantId: t.id, channelId: ch!.id, contactId: c!.id, identityId: idn!.id,
        status: 'open', botEnabled: false,
        lastMessageAt: new Date(), lastMessagePreview: `${marker}-SECRET`,
      }).returning();
    }

    const msgs = await tx.select({ id: messages.id }).from(messages)
      .where(eq(messages.conversationId, conv!.id)).limit(1);
    if (!msgs.length) {
      await tx.insert(messages).values({
        tenantId: t.id, conversationId: conv!.id, channelId: ch!.id,
        externalId: `probe-${slug}-1`, direction: 'in', source: 'customer',
        type: 'text', body: `${marker}-SECRET-BODY`,
      });
    }

    let ver = (await tx.select().from(botVersions)
      .where(eq(botVersions.tenantId, t.id)).limit(1))[0];
    if (!ver) {
      [ver] = await tx.insert(botVersions).values({
        tenantId: t.id, version: 1, persona: `${marker}-PERSONA`,
        knowledgeBase: `${marker}-KB`,
      }).returning();
    }
    const cfg = (await tx.select().from(botConfigs).where(eq(botConfigs.tenantId, t.id)).limit(1))[0];
    if (!cfg) await tx.insert(botConfigs).values({ tenantId: t.id, enabled: false });

    let tool = (await tx.select().from(botTools)
      .where(and(eq(botTools.tenantId, t.id), eq(botTools.key, 'probe_tool'))).limit(1))[0];
    if (!tool) {
      [tool] = await tx.insert(botTools).values({
        tenantId: t.id, key: 'probe_tool', titleAr: `${marker}-TOOL`,
        description: 'أداةُ تمرينٍ لفحص العزل', kind: 'http', enabled: false,
        http: { method: 'GET', url: 'https://example.com/probe' },
      }).returning();
    }

    let src = (await tx.select().from(knowledgeSources)
      .where(and(eq(knowledgeSources.tenantId, t.id), eq(knowledgeSources.title, `${marker}-SRC`)))
      .limit(1))[0];
    if (!src) {
      [src] = await tx.insert(knowledgeSources).values({
        tenantId: t.id, kind: 'text', title: `${marker}-SRC`,
        extractedText: `${marker}-SRC-TEXT`, charCount: 20, status: 'ready',
      }).returning();
    }

    return {
      slug, marker,
      tenantId: t.id, tenantPublicId: t.publicId,
      ownerEmail: email, ownerId: u!.id,
      agentEmail, agentId: agent!.id,
      channelId: ch!.id, contactId: c!.id, identityId: idn!.id,
      conversationId: conv!.id, versionId: ver!.id, toolId: tool!.id, sourceId: src!.id,
    };
  });
}

async function main(): Promise<void> {
  const a = process.env.SLUG_A ?? 'drill';
  const b = process.env.SLUG_B ?? 'drill-price';
  const pw = process.env.PROBE_PASSWORD;
  if (!pw || pw.length < 10) throw new Error('PROBE_PASSWORD مطلوبة (١٠ محارف على الأقلّ)');
  const A = await provision(a, pw);
  const B = await provision(b, pw);
  console.log(JSON.stringify({ A, B }, null, 2));
  await closeDb();
}

main().catch((e) => { console.error('فشل:', e); process.exit(1); });
