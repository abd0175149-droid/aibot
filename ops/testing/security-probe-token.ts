/**
 * إصدارُ توكن وصولٍ قصيرِ العمر لفحصٍ أمنيّ (مراجعة ٠٥.٩ البنود ⑤ و⑥).
 *
 * ★ لماذا لا يُنشأ حسابُ مالكِ منصّةٍ بكلمةٍ معلومة: حسابٌ مميّزٌ بكلمةٍ يعرفها
 *   سكربتٌ هو خطرٌ يبقى بعد التمرين. والتوكنُ يموت وحده خلال دقائق، ولا يلمس
 *   كلمةَ سرٍّ ولا يُنشئ صفّاً. وسؤالُ الفحص ليس «هل يصحّ الدخول؟» بل «هل
 *   يفرض الخادمُ الصلاحيّةَ على توكنٍ صحيحٍ تماماً؟» — وهذا ما يقيسه هذا.
 *
 * الاستعمال (على الخادم):
 *   docker compose run --rm --no-deps -v "$HOME/aibot/ops:/app/ops:ro" \
 *     -e ROLE=platform_owner [-e TTL_SEC=600] \
 *     api node --import tsx ops/testing/security-probe-token.ts
 */
import { createHmac } from 'node:crypto';
import {
  getDb, closeDb, withPlatform, users, eq,
} from '../../packages/db/src/index';

/** نفس ترميز `apps/api/src/auth.ts` حرفيّاً — ولو اختلف لما قُبل التوكن. */
function signAccess(claims: Record<string, unknown>, secret: string): string {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function main(): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET غير مضبوط');
  const email = (process.env.PROBE_EMAIL ?? '').trim().toLowerCase();
  if (!/^probe-(owner|agent)\+drill[a-z-]*@aibot\.local$/.test(email)) {
    throw new Error('PROBE_EMAIL يجب أن يكون حساب تمرينٍ probe-*@aibot.local');
  }
  const ttl = Number(process.env.TTL_SEC ?? '600');

  const db = getDb();
  const u = await withPlatform(db, 'تمرين أمنيّ: قراءة حساب التمرين لإصدار توكنٍ قصير', async (tx) =>
    (await tx.select({ id: users.id, tenantId: users.tenantId, role: users.role })
      .from(users).where(eq(users.email, email)).limit(1))[0]);
  if (!u) throw new Error(`لا مستخدم بالبريد ${email}`);

  const claims = {
    sub: u.id, tid: u.tenantId, role: u.role, sid: 'probe-no-session',
    exp: Math.floor(Date.now() / 1000) + ttl,
    ...(process.env.IMP_TENANT ? { imp: process.env.IMP_TENANT } : {}),
  };

  console.log(JSON.stringify({ role: u.role, ttlSec: ttl, access: signAccess(claims, secret) }));
  await closeDb();
}

main().catch((e) => { console.error('فشل:', e); process.exit(1); });
