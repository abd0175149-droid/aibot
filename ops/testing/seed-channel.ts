/**
 * تهيئة قناةٍ تجريبيّة للاختبار الحيّ على الخادم.
 *
 * يُنشئ صفّ قناةٍ بسرٍّ معروف حتّى **يُختبر حارس التوقيع فعليّاً** —
 * لا أن يتوقّف حلّ المستأجر قبله فيبدو الرفضُ نجاحاً.
 *
 * ملاحظة: `ops/` خارج أيّ حزمة، فلا `type: module` — ولذلك دالّةٌ غير متزامنة
 * لا `await` في المستوى الأعلى.
 */
import { getDb, closeDb, tenants, tenantChannels, eq } from '../../packages/db/src/index';
import { seal, fingerprint } from '../../packages/crypto/src/index';

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG;
  const appSecret = process.env.TEST_APP_SECRET;
  if (!slug || !appSecret) throw new Error('TENANT_SLUG و TEST_APP_SECRET مطلوبان');

  const token = process.env.TEST_WA_TOKEN ?? 'EAAG_TEST_TOKEN_NOT_REAL_0000';
  const phoneId = process.env.TEST_PHONE_ID ?? 'TEST_PHONE_ID_1';

  const db = getDb();
  const t = (await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
  if (!t) throw new Error(`لا مستأجر بـslug=${slug}`);

  const sealedToken = seal(token);
  const sealedSecret = seal(appSecret);

  const [ch] = await db.insert(tenantChannels).values({
    tenantId: t.id,
    kind: 'whatsapp_cloud',
    externalAccountId: phoneId,
    displayName: '+962 6 000 0000 (اختبار)',
    config: { wabaId: 'TEST_WABA' },
    tokenEnc: sealedToken.enc,
    tokenFingerprint: fingerprint(token),
    appSecretEnc: sealedSecret.enc,
    verifyToken: process.env.TEST_VERIFY_TOKEN ?? 'verify-me',
    keyVersion: sealedToken.keyVersion,
    status: 'connected',
    connectedAt: new Date(),
  }).onConflictDoNothing().returning();

  console.log(JSON.stringify({
    ok: true,
    publicId: t.publicId,
    channelId: ch?.id ?? '(موجودة مسبقاً)',
    tokenFingerprint: fingerprint(token),
  }));
  await closeDb();
}

main().catch(async (e) => {
  console.error('فشل:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
