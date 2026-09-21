/**
 * تحديث بيانات اعتماد قناةٍ لمستأجر، والتحقّق منها **فعليّاً** عند ميتا.
 *
 * يُشغَّل على الخادم:
 *   TENANT_SLUG=nuskjo WA_TOKEN='EAA…' [WA_APP_SECRET='…'] [WA_PHONE_ID='…'] \
 *     node --import tsx ops/set-channel-token.ts
 *
 * ★ لا يحفظ توكناً قبل أن يُثبت أنّه يعمل. توكنٌ مكسور في القاعدة يُنتج
 *   بوتاً صامتاً لا عطلاً ظاهراً — وذاك أسوأ ما يحدث لعميل.
 */
import {
  getDb, closeDb, withPlatform, tenants, tenantChannels, eq, and,
} from '../packages/db/src/index';
import { seal, fingerprint } from '../packages/crypto/src/index';

const GRAPH = 'https://graph.facebook.com/v21.0';

interface Check {
  ok: boolean;
  detail: Record<string, unknown>;
  issues: string[];
}

/** يفحص التوكن والرقم واشتراك الحقول — وهو نفس ما يفعله زرّ «اختبر الاتّصال». */
async function verify(token: string, phoneId: string, wabaId?: string): Promise<Check> {
  const issues: string[] = [];
  const detail: Record<string, unknown> = {};

  const phone = await fetch(
    `${GRAPH}/${phoneId}?fields=display_phone_number,verified_name,quality_rating,` +
    `code_verification_status,platform_type,throughput`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  ).then((r) => r.json() as Promise<Record<string, unknown>>);

  if (phone.error) {
    const e = phone.error as { message?: string; code?: number };
    // 190 = منتهٍ أو مسحوب. وهو أشيع سببٍ لـ«البوت توقّف فجأةً».
    issues.push(
      e.code === 190
        ? `التوكن منتهٍ أو مسحوب: ${e.message}`
        : `تعذّرت قراءة الرقم: ${e.message}`,
    );
    return { ok: false, detail: { error: e }, issues };
  }

  detail.phone = phone;
  if (phone.quality_rating === 'YELLOW') issues.push('تقييم الرقم أصفر — أوقف أيّ إرسالٍ جماعيّ');
  if (phone.quality_rating === 'RED') issues.push('تقييم الرقم أحمر');

  /* أشيع سببٍ لـ«كلّ شيءٍ يبدو سليماً ولا تصل رسالة»:
     التطبيق غير مشترك في حقول الويبهوك عند WABA. */
  if (wabaId) {
    const subs = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json() as Promise<Record<string, unknown>>).catch(() => ({}));
    const list = (subs as { data?: unknown[] }).data;
    detail.subscribedApps = list ?? null;
    if (!Array.isArray(list) || !list.length) {
      issues.push('التطبيق غير مشترك في حقول الويبهوك — لن تصل رسالةٌ واحدة');
    }
  }

  return { ok: true, detail, issues };
}

async function main(): Promise<void> {
  const slug = process.env.TENANT_SLUG;
  const token = process.env.WA_TOKEN;
  if (!slug || !token) throw new Error('TENANT_SLUG و WA_TOKEN مطلوبان');

  const db = getDb();

  const existing = await withPlatform(db, 'قراءة قناة المستأجر لتحديث التوكن', async (tx) => {
    const t = (await tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
    if (!t) throw new Error(`لا مستأجر بـslug=${slug}`);
    const ch = (await tx.select().from(tenantChannels)
      .where(and(eq(tenantChannels.tenantId, t.id), eq(tenantChannels.kind, 'whatsapp_cloud')))
      .limit(1))[0];
    if (!ch) throw new Error('لا قناة واتساب لهذا المستأجر');
    return { tenantId: t.id, ch };
  });

  const phoneId = process.env.WA_PHONE_ID || existing.ch.externalAccountId || '';
  const wabaId = process.env.WA_WABA_ID
    || ((existing.ch.config ?? {}) as { wabaId?: string }).wabaId
    || undefined;

  console.log(`▶ فحص التوكن على الرقم ${phoneId}${wabaId ? ` (WABA ${wabaId})` : ''}…`);
  const check = await verify(token, phoneId, wabaId);

  if (!check.ok) {
    console.error('✘ لم يُحفظ شيء — التوكن لا يعمل:');
    for (const i of check.issues) console.error('   ·', i);
    await closeDb();
    process.exit(1);
  }

  const p = check.detail.phone as Record<string, string>;
  console.log(`✔ التوكن يعمل — ${p.display_phone_number} · ${p.verified_name} · جودة ${p.quality_rating ?? '—'}`);
  for (const i of check.issues) console.log('   ⚠', i);

  await withPlatform(db, 'تحديث توكن قناة المستأجر بعد التحقّق', async (tx) => {
    const sealedToken = seal(token);
    const set: Record<string, unknown> = {
      tokenEnc: sealedToken.enc,
      tokenFingerprint: fingerprint(token),
      keyVersion: sealedToken.keyVersion,
      externalAccountId: phoneId,
      displayName: `${p.verified_name ?? ''} ${p.display_phone_number ?? ''}`.trim() || null,
      qualityRating: p.quality_rating ?? null,
      status: 'connected',
      lastCheckedAt: new Date(),
      lastError: check.issues[0] ?? null,
      connectedAt: new Date(),
    };
    if (wabaId) set.config = { ...(existing.ch.config as object), wabaId };
    if (process.env.WA_APP_SECRET) {
      const s = seal(process.env.WA_APP_SECRET);
      set.appSecretEnc = s.enc;
      set.keyVersion = s.keyVersion;
    }
    if (process.env.WA_VERIFY_TOKEN) set.verifyToken = process.env.WA_VERIFY_TOKEN;

    await tx.update(tenantChannels).set(set).where(eq(tenantChannels.id, existing.ch.id));
  });

  console.log(`✔ حُفظ مشفَّراً — بصمة ${fingerprint(token)}`);
  console.log('  (لا يُعاد التوكن لأيّ واجهة بعد الآن — بصمةٌ وتاريخٌ فقط)');
  await closeDb();
}

main().catch(async (e) => {
  console.error('فشل:', (e as Error).message);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
