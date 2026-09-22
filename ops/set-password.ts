/**
 * تعيين كلمة مرورٍ لحساب.
 *
 * ★ لماذا وُجد هذا السكربت:
 *   كلمات المرور مخزَّنة بـ`scrypt` — دالّةٌ باتّجاهٍ واحد. لا يوجد في المنصّة
 *   كلّها موضعٌ تُخزَّن فيه كلمةُ مرورٍ نصّاً، ولا نقطةَ «نسيت كلمتي»، و
 *   `/auth/password` تطلب **الكلمة القديمة دائماً**. فمن ضاعت كلمته المؤقّتة
 *   لا سبيل له إلى حسابه إطلاقاً. هذا هو الباب الوحيد، وهو باب المشغّل.
 *
 * ★ وثلاثة حدودٍ مقصودة:
 *   ① يُبطل **كلّ جلسات** الحساب. تعيينُ كلمةٍ جديدة لا يطرد من كان داخلاً
 *      هو تغييرٌ شكليّ — ولو كان الداخل هو من ضاعت منه الكلمة.
 *   ② يرفع `must_change_password` فيُجبَر صاحبه على تغييرها عند أوّل دخول:
 *      كلمةٌ عرفها المشغّل ليست كلمةً خاصّة.
 *   ③ يُسجَّل في `audit_log` باسم فاعلٍ صريح. لا تعيينَ صامتاً لكلمة مرور.
 *
 * الاستعمال (على الخادم):
 *   docker compose run --rm -e TARGET_EMAIL=... -e NEW_PASSWORD=... api \
 *     node --import tsx ops/set-password.ts
 *
 * وإن تُرك `NEW_PASSWORD` فارغاً وُلِّدت كلمةٌ قويّة وطُبعت **مرّةً واحدة**.
 */
import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import {
  getDb, closeDb, withPlatform, users, sessions, auditLog, eq,
} from '../packages/db/src/index';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

/** نفس الصيغة حرفيّاً في `apps/api/src/auth.ts` — ولو اختلفت لما صحّ الدخول. */
async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** بلا محارف تلتبس بصريّاً (0/O، 1/l/I) — الكلمة تُملى صوتاً أحياناً. */
function generate(): string {
  const abc = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(20);
  return 'aib-' + [...bytes].map((b) => abc[b % abc.length]).join('');
}

async function main(): Promise<void> {
  const email = (process.env.TARGET_EMAIL ?? '').trim().toLowerCase();
  if (!email) {
    console.error('فشل: TARGET_EMAIL غير مضبوط — لا تعيينَ لحسابٍ مجهول');
    process.exit(1);
  }

  const supplied = process.env.NEW_PASSWORD ?? '';
  // نفس الحدّ الأدنى في `/auth/password` — فلا يُنتج هذا البابُ كلمةً يرفضها ذاك
  if (supplied && supplied.length < 10) {
    console.error('فشل: كلمة المرور أقصر من ١٠ محارف');
    process.exit(1);
  }
  const plain = supplied || generate();
  const hash = await hashPassword(plain);

  const db = getDb();
  const out = await withPlatform(db, 'تعيين كلمة مرورٍ لحسابٍ بأمر المشغّل', async (tx) => {
    const user = (await tx.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!user) return null;

    await tx.update(users)
      .set({ passwordHash: hash, mustChangePassword: true })
      .where(eq(users.id, user.id));

    // ② كلّ الجلسات تسقط — بما فيها جلسةُ من كان داخلاً بالكلمة القديمة
    const killed = await tx.update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, user.id))
      .returning({ id: sessions.id });

    // ③ الأثر يبقى: لا تعيينَ صامتاً لكلمة مرور
    await tx.insert(auditLog).values({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: 'user.password_set_by_operator',
      entity: 'user',
      entityId: user.id,
      diff: { generated: !supplied, sessionsRevoked: killed.length },
    });

    return { name: user.name, role: user.role, sessions: killed.length };
  });

  if (!out) {
    console.error(`فشل: لا حساب بالبريد ${email}`);
    process.exit(1);
  }

  console.log(`✔ ${out.name} · ${out.role} · ${email}`);
  console.log(`  كلمة المرور: ${plain}`);
  console.log(`  أُبطلت ${out.sessions} جلسة · ويجب تغييرها عند أوّل دخول`);
  console.log('  ⚠️ تُعرض هنا مرّةً واحدة ولا تُخزَّن نصّاً في أيّ مكان.');
}

main().then(async () => { await closeDb(); process.exit(0); }).catch((e) => {
  console.error('فشل:', e);
  process.exit(1);
});
