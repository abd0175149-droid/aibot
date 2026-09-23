/**
 * تهيئةُ سرِّ تطبيقٍ معلومٍ على قناةِ مستأجرِ تمرين — لفحص حارس توقيع الويبهوك
 * (مراجعة ٠٥.٩ البند ⑦) بنداءٍ حقيقيّ لا بقراءةِ كود.
 *
 * ★ لماذا لا `ops/set-channel-token.ts`: ذاك يتحقّق من توكن واتساب على Graph
 *   API قبل أن يحفظ — وهو الصواب لقناةٍ حقيقيّة، ويجعله عديمَ الفائدة لتمرينٍ
 *   بتوكنٍ وهميّ. وهذا يكتب **سرَّ التطبيق وتوكنَ التحقّق وحدهما**، ولا يمسّ
 *   توكن الإرسال إطلاقاً، فالقناة تبقى عاجزةً عن إرسال أيّ شيءٍ إلى ميتا.
 *
 * الاستعمال (على الخادم):
 *   docker compose run --rm --no-deps -v "$HOME/aibot/ops:/app/ops:ro" \
 *     -e TENANT_SLUG=drill-debounce -e PROBE_APP_SECRET=... \
 *     api node --import tsx ops/testing/security-probe-webhook.ts
 */
import {
  getDb, closeDb, withPlatform, tenants, tenantChannels, eq, and,
} from '../../packages/db/src/index';
import { seal } from '../../packages/crypto/src/index';

/** حاجزٌ صلب: لا يُلمس مستأجرٌ حقيقيّ من سكربت تمرين. */
const ALLOWED = new Set(['drill', 'drill-price', 'drill-debounce', 'drill-window-cap']);

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG ?? 'drill-debounce';
  if (!ALLOWED.has(slug)) throw new Error(`slug غير مسموح للتمرين: ${slug}`);
  const appSecret = process.env.PROBE_APP_SECRET;
  if (!appSecret) throw new Error('PROBE_APP_SECRET مطلوب');
  const verifyToken = process.env.PROBE_VERIFY_TOKEN ?? 'probe-verify-2026';

  const db = getDb();
  const out = await withPlatform(db, 'تمرين أمنيّ: سرُّ تطبيقٍ معلومٌ لفحص حارس التوقيع', async (tx) => {
    const t = (await tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
    if (!t) throw new Error(`لا مستأجر بـslug=${slug}`);
    const ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, t.id), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) throw new Error(`لا قناة واتساب لـ${slug}`);

    const sealed = seal(appSecret);
    await tx.update(tenantChannels)
      .set({ appSecretEnc: sealed.enc, keyVersion: sealed.keyVersion, verifyToken })
      .where(eq(tenantChannels.id, ch.id));

    return { tenantId: t.id, publicId: t.publicId, channelId: ch.id, status: ch.status };
  });

  console.log(JSON.stringify(out, null, 2));
  await closeDb();
}

main().catch((e) => { console.error('فشل:', e); process.exit(1); });
