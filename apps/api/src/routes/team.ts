import type { FastifyInstance } from 'fastify';
import {
  getDb, withTenant, users, sessions, auditLog, subscriptions, plans,
  eq, and, isNull, desc, sql,
} from '@aibot/db';
import type { Tx } from '@aibot/db';
import { AppError, ErrorCode } from '@aibot/shared';
import { publicId } from '@aibot/crypto';
import { requireAuth, tenantOf, hashPassword } from '../auth.js';

/**
 * الفريق والدعوات.
 *
 * ★ **لماذا وُجد هذا الملفّ.** الدوران `tenant_owner` و`tenant_agent` في
 *   المخطّط منذ أوّل يوم، و**لا طريقةَ لإنشاء موظّفٍ من الواجهة إطلاقاً**:
 *   الحساب الوحيد يُولد في `POST /console/tenants` بيد مالك المنصّة. فصاحبُ
 *   النشاط الذي يحتاج موظّفاً يردّ على الإنبوكس يفعل الشيء الوحيد المتاح له:
 *   **يشارك كلمة مروره**. وهذا ليس احتمالاً بل ما يحدث فعلاً حين لا يُعطى
 *   بديل. وعاقبتُه مزدوجة: لا سجلَّ لمن فعل ماذا (`audit_log` يقول «المالك»
 *   عن كلّ فعلٍ في الحساب)، ولا خروجَ لموظّفٍ ترك العمل إلّا بتغيير كلمة
 *   المالك نفسِه — أي بتعطيل الحساب كلِّه.
 *
 * ★ **والعزلُ من نفس البوّابة.** كلّ استعلامٍ هنا داخل `withTenant`: و`users`
 *   جدولٌ **مستأجَر** تحت RLS (هو أوّل اسمٍ في `TENANT_SCOPED`)، فالمستأجر
 *   يُشتقّ من التوكن بـ`tenantOf(req)` وسياسةُ الصفوف تقصّ الباقي. ولا
 *   `withPlatform` في هذا الملفّ أصلاً: إدارةُ فريقٍ ليست فعلاً عابراً
 *   للمستأجرين، فلا عذرَ لدورٍ متجاوز.
 *
 * ★ **والصلاحيّة يفرضها الخادم لا التنقّل.** `needs: 'settings'` في
 *   `app/layout.tsx` يُخفي البند عن الموظّف، و**إخفاء بندٍ ليس أماناً**: المسار
 *   يُكتب بالأصابع. فكلّ نقطةٍ هنا تمرّ بـ`requireAuth({ settings: true })`،
 *   وهو يرفض `tenant_agent` بـ403 قبل أن يُلمَس صفّ.
 *
 * ★ **والانتحال قراءةٌ فقط** بحكم `requireAuth` نفسِه: مطالبةُ `imp` في التوكن
 *   تُسقط كلّ فعلٍ كاتب. فمالك المنصّة يرى فريق العميل لدعمه ولا يدعو باسمه.
 */

type TeamRole = 'tenant_owner' | 'tenant_agent';
const ROLES: readonly TeamRole[] = ['tenant_owner', 'tenant_agent'];

/**
 * حسابٌ نشطٌ لم يُستعمل منذ هذه المدّة = **بابٌ مفتوحٌ لا أحد يدخله**.
 * والعددُ يُرسَل إلى الواجهة ولا تُعيد اختراعه: العتبةُ واحدةٌ في الطرفين.
 */
const STALE_DAYS = 30;

/** طولُ الكلمة المؤقّتة — نفسُ `POST /console/tenants` حرفيّاً. */
const TEMP_LEN = 12;

/** بريدٌ صالحٌ شكلاً — لا تحقّقَ من وجوده، فالكلمةُ المؤقّتة تُملى لا تُرسَل. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * ★ معرّفٌ يُفحص **قبل** أن يبلغ القاعدة.
 *
 *   `users.id` من نوع `uuid`، ومعرّفٌ مشوّهٌ في المسار يجعل Postgres يرمي
 *   `invalid input syntax for type uuid` — فيخرج للعميل **500 «خطأٌ داخليّ»**
 *   على طلبٍ خاطئٍ منه هو. والفرقُ ليس تجميلاً: 500 تعني «عطبٌ عندنا» فتُفتح
 *   تذكرةُ دعمٍ وتُقرأ السجلّات، و404 تعني «لا شيء بهذا الاسم» فتُغلق نفسَها.
 *   (ونفسُ الحدّ مكتوبٌ في `withTenant` على معرّف المستأجر منذ اليوم الأوّل.)
 */
const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * ★ الحقل الذي يُقاس عليه سقفُ المقاعد.
 *
 * `plans.limits.seats` موجودٌ في المخطّط ومبذورٌ في كلّ باقة (2 · 5 · 15)
 * و**لا يُقرأ في أيّ موضعٍ في المنصّة** — أي أنّنا نبيع عدداً من المقاعد ولا
 * نعدّها. وأوّلُ شاشةٍ تُنشئ حساباتٍ هي أوّلُ موضعٍ يصير فيه للرقم معنى،
 * فيُفرض هنا. و`null` تعني «بلا سقفٍ في باقتك» لا «صفر مقاعد»: باقةٌ بلا
 * `seats` أو عميلٌ بلا اشتراكٍ فاعل لا يُمنع من إنشاء موظّف.
 */
async function seatsOf(tx: Tx, tenantId: string): Promise<number | null> {
  const rows = await tx.select({ limits: plans.limits, override: subscriptions.limitsOverride })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.periodEnd))
    .limit(1);
  const lim = {
    ...((rows[0]?.limits ?? {}) as Record<string, unknown>),
    ...((rows[0]?.override ?? {}) as Record<string, unknown>),
  };
  const n = Number(lim.seats);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * ★ **يَعُدُّ المالكين النشطين ويقفل صفوفهم في نفس النفس.**
 *
 *   القيدُ المطلوب: «لا يعزل المالك نفسه». وتنفيذُه بـ`COUNT` قبل المعاملة
 *   **يُفلت الحالة مع تزامن**: مالكان يضغطان «نزِّل دوري» في نفس الثانية،
 *   فيقرأ كلٌّ منهما «اثنان» ويمرّ — ويبقى الحساب بلا مالكٍ أبداً، ولا سبيل
 *   لإصلاحه من الواجهة لأنّ الواجهة نفسها محجوبةٌ عمّن بقي.
 *
 *   و`COUNT` **داخل** المعاملة لا يكفي وحده تحت READ COMMITTED: كلٌّ منهما
 *   يرى لقطةً قبل إيداع الآخر. فالفحصُ `SELECT … FOR UPDATE`: يعُدُّ ويقفل
 *   معاً، فتنتظر الثانيةُ إيداعَ الأولى ثمّ **تُعيد تقييم** الشرط على الصفّ
 *   الجديد (سلوكُ READ COMMITTED مع القفل) فترى «واحداً» فتُرفض.
 *
 *   والقفلُ يشمل الصفَّ المستهدَف نفسَه — فلا حاجة لقفلٍ ثانٍ عليه.
 */
async function lockActiveOwners(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM users
     WHERE tenant_id = ${tenantId} AND role = 'tenant_owner' AND is_active
     FOR UPDATE
  `) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** الحقولُ التي يُتّخذ عليها القرار — لا الصفَّ كلَّه ولا تجزئةَ كلمته. */
type Target = { id: string; email: string; name: string; role: TeamRole; isActive: boolean };

/**
 * ★ **يقفل صفَّ المستهدَف قبل قراءة دوره.**
 *
 *   قراءةٌ بلا قفلٍ تُعطي لقطةً قد تكون قد بطلت قبل أن يُتّخذ القرار عليها:
 *   موظّفٌ يُرقّى مالكاً في معاملةٍ أخرى **بين** قراءتنا لدوره وكتابتنا عليه،
 *   فنُعطّله ظانّينه موظّفاً ونكون قد عطّلنا مالكاً بلا فحصِ «آخر مالك».
 *
 * ★ **وترتيبُ القفل واحدٌ في كلّ المسارات**: المالكون أوّلاً ثمّ المستهدَف.
 *   قفلان بترتيبَين متعاكسَين في مسارَين يتعانقان (deadlock) فتُلغي القاعدةُ
 *   إحدى المعاملتَين — وهي حالةٌ لا يراها أحدٌ في الاختبار وتقع تحت الحمل.
 *   ولذلك `lockActiveOwners` تُنادى **دائماً** في المسارَين الكاتبَين للدور
 *   والحالة، لا عند الحاجة وحدها: ترتيبٌ ثابتٌ أرخصُ من ترتيبٍ ذكيّ.
 */
async function lockMember(tx: Tx, tenantId: string, id: string): Promise<Target | null> {
  const rows = await tx.execute<Target>(sql`
    SELECT id, email, name, role, is_active AS "isActive"
      FROM users
     WHERE tenant_id = ${tenantId} AND id = ${id}
     FOR UPDATE
  `) as unknown as Target[];
  return rows[0] ?? null;
}

/**
 * ★ **تعطيلٌ لا يطرد ليس تعطيلاً** — ونفسُ المبدأ مطبَّقٌ في `ops/set-password.ts`.
 *
 *   `requireAuth` لا يسأل القاعدة عن الحساب في كلّ طلب (الكلفة لا تستحقّها،
 *   والنافذة 15 دقيقةً على الأكثر)، و`is_active` لا يُفحص إلّا في الدخول
 *   والتجديد. فحسابٌ عُطِّل وجلستُه قائمةٌ يبقى يقرأ الإنبوكس ويردّ على
 *   الزبائن حتّى تنتهي مدّةُ توكنه. وإبطالُ الجلسات هو ما يجعل الزرَّ فعلاً.
 *
 *   ويقع **داخل نفس معاملة** التعطيل: تعطيلٌ يُودَع وإبطالٌ يفشل هو أسوأ من
 *   الاثنين معاً — يقول الجدولُ «معطَّل» والموظّفُ ما زال يكتب.
 */
async function revokeAllSessions(tx: Tx, userId: string): Promise<number> {
  // rls-exempt: sessions جدولٌ عامّ خارج RLS — مفتاحه user_id لا tenant_id
  const killed = await tx.update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return killed.length;
}

/**
 * صفُّ العضو كما يُقرأ من القاعدة.
 *
 * ★ `type` لا `interface` عمداً: `tx.execute<T>` يقيّد `T` بـ
 *   `Record<string, unknown>`، و**الواجهة لا تكتسب فهرساً ضمنيّاً** فترفضها
 *   الأنواع، بينما مُعرَّفُ النوع يكتسبه. وهو فرقٌ يقع على من يقرأ الشكلَ
 *   نفسَه ولا يرى سببَ الرفض.
 */
type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  liveSessions: number;
};

/** صفُّ عضوٍ واحدٍ بعد فعلٍ عليه — نفسُ شكل صفوف القائمة فلا شكلان للشيء الواحد. */
async function memberById(tx: Tx, tenantId: string, id: string): Promise<MemberRow | null> {
  const rows = await tx.execute<MemberRow>(sql`
    SELECT u.id, u.name, u.email, u.role,
           u.is_active              AS "isActive",
           u.must_change_password   AS "mustChangePassword",
           u.last_login_at          AS "lastLoginAt",
           u.created_at             AS "createdAt",
           coalesce(s.live, 0)::int AS "liveSessions"
      FROM users u
      LEFT JOIN LATERAL (
        SELECT count(*) AS live FROM sessions
         WHERE user_id = u.id AND revoked_at IS NULL AND expires_at > now()) s ON true
     WHERE u.tenant_id = ${tenantId} AND u.id = ${id}
  `) as unknown as MemberRow[];
  return rows[0] ?? null;
}

/**
 * `23505` = خرقُ قيدٍ فريد. و`users.email` فريدٌ **على المنصّة** لا على المستأجر.
 *
 * ★ ومُصدَّرةٌ للاختبار وحده، لأنّ الخطأ فيها **صامتٌ في الاتّجاه السيّئ**:
 *   لو قُورن الرمزُ برقمٍ (`=== 23505`) بدل نصٍّ لصار كلُّ بريدٍ مكرَّرٍ عند
 *   مستأجرٍ آخر «خطأً داخليّاً» — وهي أكثرُ حالةٍ يقع فيها المالك، ورسالةٌ
 *   عامّةٌ على فعلٍ سببُه مفهومٌ تُنتج مكالمةَ دعم.
 *   و`postgres.js` يمرّر الرمزَ نصّاً كما يعطيه الخادم.
 */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505';
}

/** يُسقط المعرّفَ المشوّه بـ404 قبل أن يبلغ القاعدةَ فتردَّ 500 على خطأ الطالب. */
function memberIdOf(raw: string): string {
  if (!UUID_RE.test(raw)) throw new AppError(ErrorCode.VALIDATION, 'لا عضوَ بهذا المعرّف في فريقك.', 404);
  return raw;
}

export async function registerTeam(app: FastifyInstance) {
  /** بوّابةُ الشاشة كلِّها: `settings` = المالك وحده. والموظّف يُرفض بـ403. */
  const owner = requireAuth({ settings: true });

  /**
   * قائمةُ الفريق.
   *
   * ★ الترتيبُ **بالمخاطرة لا بالاسم** — نفسُ قاعدة جدول العملاء في لوحة
   *   المالك: النشطُ قبل المعطَّل (المعطَّل لا يفعل شيئاً)، ثمّ **من لم يدخل
   *   قطّ** (كلمتُه المؤقّتة ما زالت صالحةً في مكانٍ ما)، ثمّ الأقدمُ دخولاً
   *   (الأقربُ إلى «ترك العمل ولم يُعطَّل حسابه»). فأوّلُ صفٍّ يقرأه صاحبُ
   *   النشاط هو الصفُّ الذي يحتاج قراراً.
   */
  app.get('/team', { preHandler: owner }, async (req) => {
    const tenantId = tenantOf(req);
    return withTenant(getDb(), tenantId, async (tx) => {
      const items = await tx.execute<MemberRow>(sql`
        SELECT u.id, u.name, u.email, u.role,
               u.is_active              AS "isActive",
               u.must_change_password   AS "mustChangePassword",
               u.last_login_at          AS "lastLoginAt",
               u.created_at             AS "createdAt",
               coalesce(s.live, 0)::int AS "liveSessions"
          FROM users u
          LEFT JOIN LATERAL (
            SELECT count(*) AS live FROM sessions
             WHERE user_id = u.id AND revoked_at IS NULL AND expires_at > now()) s ON true
         WHERE u.tenant_id = ${tenantId}
         ORDER BY u.is_active DESC,
                  (u.last_login_at IS NULL) DESC,
                  u.last_login_at ASC NULLS FIRST,
                  u.created_at ASC
      `) as unknown as MemberRow[];

      return { staleDays: STALE_DAYS, seats: await seatsOf(tx, tenantId), items };
    });
  });

  /**
   * دعوةٌ بالبريد — تُنشئ حساباً بدورٍ محدَّد وكلمةٍ مؤقّتة.
   *
   * ★ **نفسُ نمط `POST /console/tenants` حرفيّاً**: `publicId().slice(0, 12)`
   *   كلمةً مؤقّتة، و`hashPassword` عليها، و`mustChangePassword: true`،
   *   وتُعاد **مرّةً واحدةً** في جسم الاستجابة ولا تُخزَّن نصّاً في أيّ موضع.
   *   ولا نمطَ ثانٍ يُخترع: لا بريدَ يُرسَل (لا مُرسِلَ في المنصّة أصلاً، وزرٌّ
   *   يدّعي إرسالاً لا يُرسِل أسوأ من غيابه)، ولا رابطَ تفعيلٍ بتوكنٍ ثالثٍ
   *   يحتاج جدولاً ودورةَ حياةٍ وانتهاءً. والكلمةُ تُملى للموظّف ويُجبَر على
   *   تغييرها عند أوّل دخول — و`/auth/password` يفرض ذلك فعلاً.
   *
   * ★ **القيد ①: لا يُنشئ `tenant_owner` إلّا `tenant_owner`.** والشرطُ صريحٌ
   *   هنا ولا يُترك لـ`settings`: مالكُ المنصّة يملك `settings` أيضاً، ولو
   *   سقط حدُّ «الانتحال قراءةٌ فقط» يوماً لصار بابَ ترقيةٍ صامت. ودورُ
   *   الفاعل يُقرأ من التوكن لا من الجسم.
   */
  app.post<{ Body: { name?: string; email?: string; role?: string } }>(
    '/team/invite',
    { preHandler: owner },
    async (req) => {
      const tenantId = tenantOf(req);
      const name = String(req.body?.name ?? '').trim();
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const role = String(req.body?.role ?? '') as TeamRole;

      if (!name) throw new AppError(ErrorCode.VALIDATION, 'اسمُ الموظّف مطلوب — وهو ما يظهر في سجلّ الأفعال.', 400);
      if (!EMAIL_RE.test(email)) throw new AppError(ErrorCode.VALIDATION, 'البريد غير صالحٍ شكلاً.', 400);
      if (!ROLES.includes(role)) throw new AppError(ErrorCode.VALIDATION, 'الدورُ إمّا مالكٌ أو موظّف.', 400);
      if (role === 'tenant_owner' && req.auth!.role !== 'tenant_owner') {
        throw new AppError(ErrorCode.FORBIDDEN, 'لا يُنشئ مالكاً إلّا مالكُ الحساب نفسُه.', 403);
      }

      const temp = publicId().slice(0, TEMP_LEN);
      const hash = await hashPassword(temp);

      let out: { member: MemberRow; seats: number | null };
      try {
        out = await withTenant(getDb(), tenantId, async (tx) => {
          /* سقفُ المقاعد يُفحص **داخل** المعاملة: فحصٌ قبلها يسمح لدعوتين
             متزامنتين بتجاوزه معاً. والعدُّ على النشطين وحدهم — حسابٌ معطَّل
             لا يشغل مقعداً، وإلّا صار «عطِّل واحداً لتدعو آخر» مستحيلاً. */
          const seats = await seatsOf(tx, tenantId);
          if (seats !== null) {
            /* ★ **قفلٌ استشاريٌّ على المستأجر — و`FOR UPDATE` لا يكفي هنا.**
               قفلُ الصفوف يُسلسل تعديلَ صفوفٍ قائمة، و**لا يمنع إدراجَ صفٍّ
               جديد**: دعوتان متزامنتان تقفلان نفس الصفوف الأربعة، وتقرأ كلٌّ
               منهما «أربعة» وتُدرج — فيصير الفريق ستّة على باقةٍ بخمسة مقاعد.
               (وهذا يفترق عن حدّ «آخر مالك» أعلاه: ذاك تعديلٌ على صفوفٍ
               **قائمة**، فيُسلسله قفلُ الصفّ فعلاً.)
               والقفلُ معنونٌ باسم الميزة فلا يتصادم مع قفلٍ آخر على نفس
               المستأجر، ويسقط بنهاية المعاملة بلا إفراجٍ يدويٍّ يُنسى. */
            await tx.execute(sql`
              SELECT pg_advisory_xact_lock(hashtext('team_seats'), hashtext(${tenantId}))
            `);
            const used = await tx.execute<{ n: number }>(sql`
              SELECT count(*)::int AS n FROM users
               WHERE tenant_id = ${tenantId} AND is_active
            `) as unknown as Array<{ n: number }>;
            if ((used[0]?.n ?? 0) >= seats) {
              throw new AppError(
                ErrorCode.QUOTA_EXCEEDED,
                `باقتك تسمح بـ${seats} مقعداً نشطاً، وكلُّها مشغولة. عطِّل حساباً لم يعد يُستعمل، أو ارفع باقتك.`,
                409,
              );
            }
          }

          const dup = await tx.select({ id: users.id, name: users.name, isActive: users.isActive })
            .from(users).where(eq(users.email, email)).limit(1);
          if (dup[0]) {
            throw new AppError(
              ErrorCode.VALIDATION,
              dup[0].isActive
                ? `هذا البريد لـ${dup[0].name} في فريقك بالفعل.`
                : `هذا البريد لـ${dup[0].name} — حسابُه معطَّلٌ في فريقك، فأعِد تفعيله بدل إنشاء ثانٍ.`,
              409,
            );
          }

          const [row] = await tx.insert(users).values({
            tenantId, email, passwordHash: hash, name, role, mustChangePassword: true,
          }).returning({ id: users.id });

          await tx.insert(auditLog).values({
            tenantId, actorUserId: req.auth!.sub,
            action: 'team.invite', entity: 'user', entityId: row!.id, ip: req.ip,
            diff: { email, name, role },
          });

          return { member: (await memberById(tx, tenantId, row!.id))!, seats };
        });
      } catch (e) {
        /* بريدٌ مستعمَلٌ **عند مستأجرٍ آخر**: القيدُ الفريد على المنصّة كلِّها،
           و`dup` أعلاه لا يراه لأنّ RLS تقصّ صفوف غيرنا. فالرسالةُ تقول إنّ
           البريد غير متاحٍ ولا تكشف أنّ له حساباً عند عميلٍ آخر — ولا تترك
           العميل أمام «خطأٌ داخليّ» على فعلٍ سببُه مفهوم. */
        if (isUniqueViolation(e)) {
          throw new AppError(
            ErrorCode.VALIDATION,
            'هذا البريد غير متاح. إن كان لموظّفك حسابٌ على المنصّة فاستعمل بريداً آخر له.',
            409,
          );
        }
        throw e;
      }

      return {
        member: out.member,
        seats: out.seats,
        /* تُعرض **مرّةً واحدة** ولا تُخزَّن نصّاً في أيّ مكان — نفسُ عقد
           `POST /console/tenants`. ومن ضاعت منه: «أعِد تعيين كلمة مؤقّتة». */
        tempPassword: temp,
      };
    },
  );

  /**
   * تغييرُ دور.
   *
   * ★ **القيد ②**: تنزيلُ آخرِ مالكٍ نشطٍ مرفوض — والفحصُ `FOR UPDATE` داخل
   *   المعاملة لا `COUNT` قبلها (انظر `lockActiveOwners`).
   *
   * ★ **وتنزيلُ الدور يُبطل جلسات صاحبه.** الدورُ محمولٌ في توكن الوصول،
   *   وعمرُه خمسَ عشرةَ دقيقة: فمالكٌ نُزِّل يبقى مالكاً في كلّ طلبٍ حتّى
   *   ينتهي توكنُه — يضبط البوت ويرى الفوترة ويدعو موظّفين. وتنزيلٌ يعمل بعد
   *   ربع ساعةٍ ليس تنزيلاً. والجلسةُ تُبطَل فيُجدَّد التوكن من الصفّ الجديد.
   */
  app.patch<{ Params: { id: string }; Body: { role?: string } }>(
    '/team/:id/role',
    { preHandler: owner },
    async (req) => {
      const tenantId = tenantOf(req);
      const id = memberIdOf(req.params.id);
      const role = String(req.body?.role ?? '') as TeamRole;
      if (!ROLES.includes(role)) throw new AppError(ErrorCode.VALIDATION, 'الدورُ إمّا مالكٌ أو موظّف.', 400);
      if (role === 'tenant_owner' && req.auth!.role !== 'tenant_owner') {
        throw new AppError(ErrorCode.FORBIDDEN, 'لا يُرقّي إلى مالكٍ إلّا مالكُ الحساب نفسُه.', 403);
      }

      return withTenant(getDb(), tenantId, async (tx) => {
        // الترتيب: المالكون ثمّ المستهدَف — نفسُه في مسار الحالة، فلا تعانق
        const owners = await lockActiveOwners(tx, tenantId);
        const target = await lockMember(tx, tenantId, id);
        if (!target) throw new AppError(ErrorCode.VALIDATION, 'لا عضوَ بهذا المعرّف في فريقك.', 404);
        if (target.role === role) {
          return { member: (await memberById(tx, tenantId, target.id))!, sessionsRevoked: 0 };
        }

        const demoting = target.role === 'tenant_owner' && role !== 'tenant_owner';
        if (demoting && target.isActive && owners.length <= 1) {
          throw new AppError(
            ErrorCode.VALIDATION,
            target.id === req.auth!.sub
              ? 'أنت المالكُ النشطُ الوحيد — رقِّ غيرَك مالكاً أوّلاً، وإلّا بقي الحساب بلا من يُديره.'
              : 'هذا هو المالكُ النشطُ الوحيد — لا يُنزَّل دورُه، وإلّا بقي الحساب بلا من يُديره.',
            409,
          );
        }

        await tx.update(users).set({ role }).where(eq(users.id, target.id));
        const sessionsRevoked = demoting ? await revokeAllSessions(tx, target.id) : 0;

        await tx.insert(auditLog).values({
          tenantId, actorUserId: req.auth!.sub,
          action: 'team.role_change', entity: 'user', entityId: target.id, ip: req.ip,
          diff: { email: target.email, from: target.role, to: role, sessionsRevoked },
        });

        return { member: (await memberById(tx, tenantId, target.id))!, sessionsRevoked };
      });
    },
  );

  /**
   * تعطيلٌ وإعادةُ تفعيل.
   *
   * ★ **القيد ④**: التعطيل يُبطل كلّ جلسات العضو في نفس المعاملة.
   * ★ **والقيد ②** بشقَّيه: لا تعطيلَ لآخرِ مالكٍ نشط، **ولا تعطيلَ للنفس**.
   *   والثاني ليس زينة: من عطّل نفسه سقطت جلساتُه فوراً وحُجبت عنه هذه
   *   الشاشة، فلا يستطيع إعادةَ تفعيل نفسه — ولا مخرجَ إلّا سكربتُ مشغّل.
   */
  app.post<{ Params: { id: string }; Body: { isActive?: boolean } }>(
    '/team/:id/active',
    { preHandler: owner },
    async (req) => {
      const tenantId = tenantOf(req);
      const id = memberIdOf(req.params.id);
      const isActive = Boolean(req.body?.isActive);

      return withTenant(getDb(), tenantId, async (tx) => {
        // نفسُ ترتيب مسار الدور: المالكون ثمّ المستهدَف
        const owners = await lockActiveOwners(tx, tenantId);
        const target = await lockMember(tx, tenantId, id);
        if (!target) throw new AppError(ErrorCode.VALIDATION, 'لا عضوَ بهذا المعرّف في فريقك.', 404);

        if (!isActive) {
          if (target.id === req.auth!.sub) {
            throw new AppError(
              ErrorCode.VALIDATION,
              'لا تُعطّل حسابك بنفسك — ستُطرد فوراً ولن تستطيع إعادةَ تفعيله.',
              409,
            );
          }
          /* عضويّةُ المستهدَف في **مجموعةٍ مقفولة** لا في لقطةٍ قد بطلت:
             لو رُقّي بين القراءة والقرار لظهر هنا، ولو نُزِّل لسقط منها. */
          if (owners.includes(target.id) && owners.length <= 1) {
            throw new AppError(
              ErrorCode.VALIDATION,
              'هذا هو المالكُ النشطُ الوحيد — لا يُعطَّل حسابه، وإلّا بقي الحساب بلا من يُديره.',
              409,
            );
          }
        }

        await tx.update(users).set({ isActive }).where(eq(users.id, target.id));
        const sessionsRevoked = isActive ? 0 : await revokeAllSessions(tx, target.id);

        await tx.insert(auditLog).values({
          tenantId, actorUserId: req.auth!.sub,
          action: isActive ? 'team.enable' : 'team.disable',
          entity: 'user', entityId: target.id, ip: req.ip,
          diff: { email: target.email, role: target.role, sessionsRevoked },
        });

        return { member: (await memberById(tx, tenantId, target.id))!, sessionsRevoked };
      });
    },
  );

  /**
   * إعادةُ تعيين كلمةٍ مؤقّتة.
   *
   * ★ نفسُ حدود `ops/set-password.ts` الثلاثة مطبَّقةً هنا: كلمةٌ مولَّدةٌ
   *   **يعرفها من عيّنها** ⇒ `mustChangePassword` مرفوعٌ دائماً، وكلُّ الجلسات
   *   تسقط، والأثرُ يُسجَّل باسم الفاعل. ولا `FORCE_CHANGE` هنا: لا موضعَ
   *   يُملي فيه العضوُ كلمته بنفسه في هذا المسار، فالعلّةُ قائمةٌ دائماً.
   *
   * ★ **ولا يُعاد تعيينُ كلمةِ الفاعل من هنا**: إبطالُ الجلسات يطرده في نفس
   *   الطلب فلا يرى الكلمةَ التي عُرضت له مرّةً واحدة. و`/auth/password`
   *   هو البابُ الصحيح — يطلب القديمة ويُبقي جلسته الحاليّة.
   */
  app.post<{ Params: { id: string } }>('/team/:id/reset-password', { preHandler: owner }, async (req) => {
    const tenantId = tenantOf(req);
    const id = memberIdOf(req.params.id);
    if (req.params.id === req.auth!.sub) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'كلمتُك تُغيَّر من شاشة «كلمة السرّ» — فهي تطلب القديمة وتُبقي جلستك.',
        409,
      );
    }

    const temp = publicId().slice(0, TEMP_LEN);
    const hash = await hashPassword(temp);

    const out = await withTenant(getDb(), tenantId, async (tx) => {
      const target = await lockMember(tx, tenantId, id);
      if (!target) throw new AppError(ErrorCode.VALIDATION, 'لا عضوَ بهذا المعرّف في فريقك.', 404);

      await tx.update(users)
        .set({ passwordHash: hash, mustChangePassword: true })
        .where(eq(users.id, target.id));
      const sessionsRevoked = await revokeAllSessions(tx, target.id);

      await tx.insert(auditLog).values({
        tenantId, actorUserId: req.auth!.sub,
        action: 'team.password_reset', entity: 'user', entityId: target.id, ip: req.ip,
        diff: { email: target.email, generated: true, sessionsRevoked },
      });

      return { member: (await memberById(tx, tenantId, target.id))!, sessionsRevoked };
    });

    return { ...out, tempPassword: temp };
  });
}
