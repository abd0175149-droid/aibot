import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAdapter, isChannelSupported, type ChannelKind, type RawWebhook } from '@aibot/channels';
import { getDb, tenantChannels, tenants, eq, and, sql } from '@aibot/db';
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

  const db = getDb();
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
  const handle = async (req: FastifyRequest, kind: ChannelKind, publicId?: string) => {
    const raw = rawOf(req, publicId);
    const found = await resolveTenantChannel(kind, raw);
    if (!found) {
      req.log.warn({ kind, publicId }, 'ويبهوك لمستأجرٍ غير معروف');
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

    const parsed = adapter.parseWebhook(req.body);
    const { enqueueInbound } = await import('./queues.js');
    await enqueueInbound({
      tenantId: found.tenantId,
      channelId: found.ch.id,
      kind,
      parsed,
    });
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
