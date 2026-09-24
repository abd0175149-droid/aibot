import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAdapter, isChannelSupported, type ChannelKind, type RawWebhook } from '@aibot/channels';
import { getDb, withPlatform, tenantChannels, tenants, eq, and, sql } from '@aibot/db';
import { open as decrypt, safeEqual } from '@aibot/crypto';

/**
 * حلّ المستأجر — المسارَان اللذان يجب أن يوجدا من اليوم الأوّل.
 *
 * واتساب (BYO):    تطبيق العميل يرسل إلى رابطٍ خاصّ به، فالمستأجر من المسار.
 * إنستجرام:        تطبيق المنصّة له ويبهوكٌ **واحد للجميع**، فالمستأجر يُعرَف
 *                  من معرّف الحساب داخل الحمولة.
 *
 * كتابة هذه الدالّة لتقرأ المسار وحده تعني إعادة كتابة طبقة الويبهوك كاملةً
 * يوم تُضاف القناة الثانية — ولذلك هي هكذا قبل أن توجد تلك القناة.
 */
async function resolveTenantChannel(kind: ChannelKind, req: RawWebhook) {
  const adapter = getAdapter(kind);
  const key = adapter.resolveKey(req);
  if (!key) return null;

  /* عابرٌ للمستأجرين **بطبيعته**: لا سياق بعد — المستأجر هو ما نبحث عنه.
     ولذلك يمرّ بالدور المتجاوز صراحةً. كشفه أوّل تشغيلٍ بدورٍ عاديّ:
     قبله كان التطبيق سوبريوزر فنجح الاستعلام وأخفى العيب. */
  return withPlatform(getDb(), 'ويبهوك: حلّ المستأجر من مفتاح القناة', async (db) => {
  if (key.by === 'path') {
    const rows = await db
      .select({ ch: tenantChannels, tenantId: tenants.id, status: tenants.status })
      .from(tenantChannels)
      .innerJoin(tenants, eq(tenants.id, tenantChannels.tenantId))
      .where(and(eq(tenants.publicId, key.publicId), eq(tenantChannels.kind, kind)))
      .limit(1);
    return rows[0] ?? null;
  }

  const rows = await db
    .select({ ch: tenantChannels, tenantId: tenants.id, status: tenants.status })
    .from(tenantChannels)
    .innerJoin(tenants, eq(tenants.id, tenantChannels.tenantId))
    .where(and(eq(tenantChannels.kind, kind), eq(tenantChannels.externalAccountId, key.externalId)))
    .limit(1);
  return rows[0] ?? null;
  });
}

function rawOf(req: FastifyRequest, pathPublicId?: string): RawWebhook {
  return {
    pathPublicId,
    headers: req.headers as Record<string, string | undefined>,
    rawBody: (req as unknown as { rawBody: Buffer }).rawBody ?? Buffer.alloc(0),
    body: req.body,
  };
}

export async function registerWebhooks(app: FastifyInstance) {
  /**
   * تحدّي ميتا. المقارنة ثابتة الزمن — التوكن ليس سرّاً ثقيلاً لكنّ العادة
   * تُبنى هنا لا في مكانٍ آخر.
   */
  app.get<{ Params: { channel: string; publicId?: string }; Querystring: Record<string, string> }>(
    '/webhooks/:channel/:publicId',
    async (req, reply) => {
      const { channel, publicId } = req.params;
      if (!isChannelSupported(channel === 'wa' ? 'whatsapp_cloud' : channel)) {
        return reply.code(404).send();
      }
      const kind: ChannelKind = channel === 'wa' ? 'whatsapp_cloud' : (channel as ChannelKind);
      const found = await resolveTenantChannel(kind, rawOf(req, publicId));
      const q = req.query;
      if (
        found?.ch.verifyToken &&
        q['hub.mode'] === 'subscribe' &&
        safeEqual(q['hub.verify_token'] ?? '', found.ch.verifyToken)
      ) {
        return reply.code(200).type('text/plain').send(q['hub.challenge'] ?? '');
      }
      req.log.warn({ kind, publicId }, 'فشل تحدّي الويبهوك — توكن التحقّق غير مطابق');
      return reply.code(403).send();
    },
  );

  /**
   * استقبال الأحداث.
   *
   * ثلاث قواعد لا تُمَسّ:
   *  ① التوقيع إلزاميّ. غياب App Secret = القناة معطَّلة، لا «تعمل بلا تحقّق».
   *  ② ردّ 200 دائماً وسريعاً — الأخطاء تُبتلع وتُسجَّل، وإلّا عطّلت ميتا الويبهوك.
   *  ③ المعالجة خارج دورة الطلب: تُكتب في الطابور ثمّ يُردّ.
   *     رسالةٌ تُعالَج داخل الطلب تضيع مع أوّل إعادة تشغيل.
   */
  /**
   * ★ حمولةٌ واحدةٌ قد تحمل حسابات عدّة — فتُجزَّأ قبل حلّ المستأجر.
   *   والتوقيع يُتحقَّق منه على **البايتات كما وصلت** مرّةً واحدةً قبل التجزئة:
   *   الأجزاء مُصنَّعةٌ عندنا فلا توقيعَ لها، وتوقيعُ الأصل يغطّيها كلَّها.
   */
  const handleOne = async (req: FastifyRequest, kind: ChannelKind, body: unknown, publicId?: string) => {
    const raw = { ...rawOf(req, publicId), body };
    const found = await resolveTenantChannel(kind, raw);
    if (!found) {
      // التمييز مقصود: مستأجرٌ موجود بلا قناةٍ موصولة ≠ معرّفٌ مجهول.
      // الأوّل خطأ تهيئة، والثاني محاولة تخمين — وتشخيصهما مختلف.
      req.log.warn({ kind, publicId }, 'لا قناة موصولة لهذا المعرّف — راجع تهيئة العميل');
      return; // 200 على كلّ حال — لا نكشف أيّ معرّفٍ صالح
    }
    if (found.status === 'suspended' || found.status === 'archived') return;

    const adapter = getAdapter(kind);
    const secret = found.ch.appSecretEnc
      ? decrypt(found.ch.appSecretEnc, found.ch.keyVersion)
      : '';
    if (!adapter.verifySignature(raw.rawBody, req.headers['x-hub-signature-256'] as string, secret)) {
      req.log.error({ tenantId: found.tenantId, kind }, 'توقيع ويبهوك غير صالح — رُفضت الحمولة');
      return;
    }

    const parsed = adapter.parseWebhook(body);
    const { enqueueInbound } = await import('./queues.js');
    await enqueueInbound({
      tenantId: found.tenantId,
      channelId: found.ch.id,
      kind,
      parsed,
    });
  };

  const handle = async (req: FastifyRequest, kind: ChannelKind, publicId?: string) => {
    const adapter = getAdapter(kind);
    const parts = adapter.splitByAccount?.(req.body) ?? [req.body];
    if (parts.length > 1) {
      req.log.info({ kind, accounts: parts.length }, 'حمولةٌ تحمل حساباتٍ عدّة — تُجزَّأ لكلّ مستأجر');
    }
    for (const part of parts) {
      /* جزءٌ يفشل لا يُسقط البقيّة: كلٌّ منها رسائلُ مستأجرٍ مختلف. */
      await handleOne(req, kind, part, publicId).catch((e) => {
        req.log.error({ err: e, kind }, 'فشل جزءٌ من حمولة الويبهوك');
      });
    }
  };

  app.post<{ Params: { channel: string; publicId: string } }>(
    '/webhooks/:channel/:publicId',
    async (req, reply) => {
      reply.code(200).send('ok'); // ② أوّلاً — ثمّ المعالجة
      const kind: ChannelKind =
        req.params.channel === 'wa' ? 'whatsapp_cloud' : (req.params.channel as ChannelKind);
      if (!isChannelSupported(kind)) return;
      try {
        await handle(req, kind, req.params.publicId);
      } catch (e) {
        req.log.error({ err: e }, 'فشل معالجة الويبهوك — ابتُلع عمداً');
      }
    },
  );

  /** ويبهوك تطبيق المنصّة: مسارٌ واحد للجميع، والمستأجر من الحمولة. */
  app.post<{ Params: { channel: string } }>('/webhooks/:channel', async (req, reply) => {
    reply.code(200).send('ok');
    const kind = req.params.channel as ChannelKind;
    if (!isChannelSupported(kind)) return;
    try {
      await handle(req, kind);
    } catch (e) {
      req.log.error({ err: e }, 'فشل معالجة ويبهوك المنصّة — ابتُلع عمداً');
    }
  });
}
