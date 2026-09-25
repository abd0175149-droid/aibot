/**
 * مسحُ العامل الثاني عن حساب.
 *
 * ★ لماذا وُجد هذا السكربت — وهو شرطُ إطلاق العامل الثاني لا لاحقةٌ له:
 *   `POST /auth/mfa/enroll` يرفض بـ٤٠٩ متى كان للحساب عاملٌ مُفعَّل، عن قصد:
 *   من سرق جلسةً نشطةً كان سيُسجّل هاتفَه هو ويُخرج صاحبَ الحساب. والنتيجةُ
 *   أنّ **هاتفاً ضائعاً يُقفل لوحةَ المنصّة إلى الأبد** — لا بابَ ذاتيّاً
 *   للاستعادة، لأنّ كلَّ بابٍ ذاتيٍّ هو بعينه ما يُبطل العامل الثاني.
 *
 *   فهذا هو البابُ الوحيد، وهو بابُ المشغّل — كما `set-password.ts` تماماً.
 *
 * ★ وثلاثة حدودٍ مقصودة، نفسُها هناك:
 *   ① تسقط **كلّ جلسات** الحساب. مسحُ عاملٍ ثانٍ مع إبقاء جلسةٍ مفتوحةٍ
 *      يُبقي البابَ الذي فُتح به مفتوحاً — ولو كان الفاتحُ هو المهاجم.
 *   ② ولا يُولَّد سرٌّ جديدٌ هنا: سرٌّ يطبعه سكربتٌ يراه المشغّل سرٌّ مشترك،
 *      والتسجيلُ يجري من المتصفّح بعد الدخول التالي.
 *   ③ ويُسجَّل في `audit_log` باسم فاعلٍ صريح. لا مسحَ صامتاً لعاملٍ ثانٍ.
 *
 * الاستعمال (على الخادم):
 *   docker compose run --rm -e TARGET_EMAIL=... api \
 *     node --import tsx ops/clear-mfa.ts
 */
import {
  getDb, closeDb, withPlatform, users, sessions, auditLog, eq,
} from '../packages/db/src/index';

async function main(): Promise<void> {
  const email = (process.env.TARGET_EMAIL ?? '').trim().toLowerCase();
  if (!email) {
    console.error('فشل: TARGET_EMAIL غير مضبوط — لا مسحَ لحسابٍ مجهول');
    process.exit(1);
  }
  const actor = (process.env.ACTOR ?? 'ops').trim();

  const db = getDb();
  const out = await withPlatform(db, 'مسحُ العامل الثاني عن حسابٍ بأمر المشغّل', async (tx) => {
    const user = (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!user) return null;
    const had = Boolean(user.mfaSecretEnc || user.mfaEnrolledAt);

    await tx.update(users)
      .set({ mfaSecretEnc: null, mfaKeyVersion: null, mfaEnrolledAt: null })
      .where(eq(users.id, user.id));

    // ① كلّ الجلسات تسقط — بما فيها جلسةُ من كان داخلاً بالعامل القديم
    const killed = await tx.update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, user.id))
      .returning({ id: sessions.id });

    // ③ الأثر — ومعه هل كان هناك عاملٌ أصلاً، فلا يُقرأ مسحٌ فارغٌ استعادةً
    await tx.insert(auditLog).values({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: 'auth.mfa_cleared',
      entity: 'user',
      entityId: user.id,
      diff: { by: actor, hadFactor: had, sessionsRevoked: killed.length },
    });

    return { had, killed: killed.length, role: user.role };
  });

  if (!out) {
    console.error(`فشل: لا حساب بالبريد ${email}`);
    process.exit(1);
  }

  console.log(`✔ مُسح العامل الثاني عن ${email} (${out.role})`);
  console.log(`  كان له عاملٌ مُفعَّل: ${out.had ? 'نعم' : 'لا'}`);
  console.log(`  جلساتٌ أُبطلت: ${out.killed}`);
  console.log('  وعليه أن يُسجّل عاملاً جديداً من المتصفّح — واللوحة مغلقةٌ حتّى يفعل.');
  await closeDb();
}

void main();
