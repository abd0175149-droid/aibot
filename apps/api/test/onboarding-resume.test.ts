import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★ **المعالجُ يُغلق بصمتٍ ويترك عميلاً لا يُستأنف.**
 *
 *   `tempPassword` تُعرض **مرّةً واحدةً** في خطوته الثانية ولا تُخزَّن نصّاً.
 *   ونقرةٌ على خلفيّة النافذة (والخلفيّةُ تُغلق) كانت تُنهيه بلا كلمةٍ: يبقى في
 *   القاعدة مستأجرٌ ومالكٌ لا يملك كلمته، وبوتٌ لم يُبذر.
 *
 *   وثلاثةُ أبوابٍ كانت مغلقةً في اللوحة، ومخرجُها الوحيد `ssh`:
 *    ① `POST …/bot/seed` له مُنادٍ واحدٌ في الواجهة كلِّها: المعالجُ نفسُه.
 *    ② ولا مسارَ إطلاقاً لإعادة كلمةِ مالك: الانتحالُ قراءةٌ فقط عن قصد،
 *      و`/team/:id/reset-password` مُقيَّدٌ بمستأجر التوكن — فبقي
 *      `ops/set-password.ts` على الخادم.
 *    ③ و`verifyToken` مُسقَطٌ عمداً من `GET /channels` ومحجوبٌ في السجلّ،
 *      فمن أغلق معالجَه قبل الخطوة الأخيرة فقد الـCallback URL وتوكنَ التحقّق.
 *
 * ★ ورابعٌ يُخفي الثلاثة: `coalesce(bv.mode,'full')` كان يجعل عميلاً بلا نسخةٍ
 *   منشورةٍ إطلاقاً يُوسَم «حقنٌ كامل» — فتُقرأ تهيئةٌ لم تبدأ «بوتٌ يعمل».
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

const API = code('apps/api/src/routes/console.ts');
const PAGE = code('apps/web/src/app/console/page.tsx');
const WIZ = code('apps/web/src/components/Onboarding.tsx');

describe('الماسحُ يُزيل التعليقات', () => {
  it('★ والملفُّ مليءٌ بشروحٍ تذكر `ssh` و«كلمةٌ مؤقّتة»', () => {
    expect(read('apps/api/src/routes/console.ts')).toContain('ops/set-password.ts');
    expect(API, 'التعليقاتُ ما زالت تُقرأ').not.toContain('ops/set-password.ts');
  });
});

describe('النقصُ يُرى قبل أن يُصلَح', () => {
  it('★★ الاستعلامُ يُعلن غيابَ النسخة بدل أن يُقنّعه', () => {
    expect(API).toContain('(bv.mode IS NOT NULL)          AS "botSeeded"');
    expect(API, 'وحالةُ المالك: كلمةٌ مؤقّتةٌ ولم يدخل قطّ').toMatch(/must_change_password AND u\.last_login_at IS NULL/);
    expect(API).toContain('AS "ownerEmail"');
  });

  it('★★★ ولا وسمَ بنفسجيٍّ على عميلٍ بلا بوت — في الموضعَين', () => {
    /* الجدولُ والورقةُ كلاهما يرسم الوسم. وإصلاحُ أحدهما يترك الآخر يقول
       «حقنٌ كامل» ثلاثةَ أسطرٍ فوق بنرٍ يقول «لا نسخةَ بوتٍ منشورة». */
    const tags = [...PAGE.matchAll(/tone="violet"/g)];
    expect(tags.length).toBe(2);
    for (const m of tags) {
      const before = PAGE.slice(Math.max(0, m.index! - 260), m.index!);
      expect(before, 'وسمٌ بنفسجيٌّ بلا شرطِ `botSeeded`').toMatch(/botSeeded/);
    }
  });

  it('★ والبنرُ يقول ما نقص ومن أين يُكمَل', () => {
    expect(PAGE).toContain('تهيئةٌ لم تكتمل');
    expect(PAGE).toContain('!sel.botSeeded || sel.ownerPending');
  });
});

describe('البابُ الأوّل: بذرُ البوت من اللوحة', () => {
  it('★★ النموذجُ واحدٌ لموضعَين — لا نسختان تتباعدان', () => {
    const form = 'apps/web/src/components/BotSeedForm.tsx';
    expect(read(form)).toContain('export function BotSeedForm');
    expect(WIZ, 'المعالجُ يستورده').toContain("from '@/components/BotSeedForm'");
    expect(PAGE, 'واللوحةُ كذلك').toContain("from '@/components/BotSeedForm'");
    /* ولا حقولٌ منسوخة: كان المعالجُ يحمل `PERSONA_TEMPLATES` وحقلَيه. */
    expect(WIZ, 'حقولُ الشخصيّة ما زالت منسوخةً في المعالج').not.toContain('PERSONA_TEMPLATES');
  });

  it('★ والزرُّ مشروطٌ بغياب النسخة — الخادم يردّ ٤٠٩ على غيرها', () => {
    expect(PAGE).toMatch(/\{!sel\.botSeeded && \([\s\S]{0,400}setSeedFor\(sel\.id\)/);
  });
});

describe('البابُ الثاني: كلمةُ مالكٍ مؤقّتة', () => {
  const at = API.indexOf("'/console/tenants/:id/owner/reset-password'");
  const block = API.slice(at, at + 3200);

  it('المسارُ موجود', () => {
    expect(at).toBeGreaterThan(0);
  });

  it('★★★ وكلُّ جلساته تسقط في نفس المعاملة — تعطيلٌ لا يطرد ليس تعطيلاً', () => {
    expect(block).toMatch(/update\(sessions\)[\s\S]{0,200}revokedAt: new Date\(\)/);
    expect(block).toMatch(/isNull\(sessions\.revokedAt\)/);
  });

  it('★★ و`mustChangePassword` مرفوعٌ دائماً — كلمةٌ يعرفها من عيّنها', () => {
    expect(block).toMatch(/passwordHash: hash, mustChangePassword: true/);
  });

  it('★ والأثرُ مسجَّلٌ باسم الفاعل — فعلٌ عابرٌ للمستأجرين لا يكون صامتاً', () => {
    expect(block).toContain("action: 'tenant.owner_password_reset'");
    expect(block).toMatch(/actorUserId: req\.auth!\.sub/);
  });

  it('★★★ وargon2 **خارج** المعاملة — في المسارَين', () => {
    /* نحو مئة مِلّي ثانية داخل `withPlatform` تحتجز واحداً من عشرة اتّصالات
       بلا عملِ قاعدةٍ أصلاً — ونفسُ القاعدة تمنع نداءَ الشبكة داخل معاملة.
       والمسارُ القائم `POST /console/tenants` كان يفعلها منذ كُتب. */
    for (const m of API.matchAll(/withPlatform\(/g)) {
      let depth = 0;
      let k = m.index! + 'withPlatform'.length;
      for (; k < API.length; k += 1) {
        if (API[k] === '(') depth += 1;
        else if (API[k] === ')') { depth -= 1; if (depth === 0) break; }
      }
      expect(API.slice(m.index!, k), 'تجزئةُ كلمةٍ داخل معاملة')
        .not.toContain('await hashPassword(');
    }
    expect(API, 'والتجزئةُ تُحسب قبل فتح المعاملة')
      .toMatch(/const ownerHash = await hashPassword\(temp\);/);
  });

  it('★★ ومعرّفٌ مشوّهٌ يردّ ٤٠٤ لا ٥٠٠', () => {
    /* `${id}` في `sql`/drizzle يُحوَّل إلى uuid في القاعدة، فخطأٌ مطبعيٌّ كان
       يرفع 22P02 ويقرأ مالكُ المنصّة «عطبٌ عندنا» عن خطئه هو. */
    expect(API).toMatch(/const UUID_RE = \//);
    expect(block).toMatch(/if \(!UUID_RE\.test\(req\.params\.id\)\)/);
    const uuidAt = block.indexOf('UUID_RE.test');
    const hashAt = block.indexOf('await hashPassword');
    expect(uuidAt, 'الفحصُ بعد argon2 يُهدر مئةَ مِلّي على خطأٍ مطبعيّ')
      .toBeLessThan(hashAt);
  });
});


describe('البابُ الثالث: بيانا ميتا لعميلٍ موصولٍ سلفاً', () => {
  it('★★ مسارٌ مستقلٌّ يُطلب عند الحاجة — لا حقلٌ في قائمة العملاء', () => {
    /* سرٌّ يُشحن مع كلّ صفٍّ في كلّ فتحةٍ للوحة سرٌّ مُذاعٌ لا مُتاح. */
    expect(API).toContain("'/console/tenants/:id/channel'");
    const list = API.slice(API.indexOf("'/console/tenants'"), API.indexOf("'/console/tenants'") + 2500);
    expect(list, 'توكنُ التحقّق في قائمة العملاء').not.toContain('verify_token');
  });

  it('★ والقراءةُ مسجَّلة — قراءةُ سرٍّ فعلٌ يُسجَّل', () => {
    const at = API.indexOf("'/console/tenants/:id/channel'");
    expect(API.slice(at, at + 2200)).toContain("action: 'tenant.channel_secrets_read'");
  });
});

describe('الإغلاقُ يُنبّه، والسرُّ لا يعبر إلى ورقةٍ أخرى', () => {
  it('★★ المعالجُ لا يُغلق بلا كلمة', () => {
    expect(WIZ).toContain('onClose={requestClose}');
    expect(WIZ, 'وقبل الإنشاء الإغلاقُ مجّانيّ — لا شيءَ كُتب').toMatch(/if \(!created\) \{ onClose\(\); return; \}/);
    expect(WIZ, 'واللوحُ يُعيد الكلمةَ آخرَ مرّة').toMatch(/\{leaving && created && \(/);
  });

  it('★★★ وكلُّ ما يحمل سرَّ عميلٍ يُصفَّر مع الورقة', () => {
    /* كلمةٌ مؤقّتةٌ أو توكنُ تحقّقٍ يبقى بعد الإغلاق يظهر في ورقة عميلٍ آخر. */
    const at = PAGE.indexOf('function closeSheet()');
    const body = PAGE.slice(at, PAGE.indexOf('}', at));
    for (const setter of ['setOwnerTemp(null)', 'setWebhook(null)']) {
      expect(body, setter).toContain(setter);
    }
    expect(PAGE, 'وورقةُ الربط تُصفّره عند إغلاقها هي أيضاً')
      .toMatch(/setConnectFor\(null\); setWebhook\(null\);/);
  });

  it('★ وعلَمُ التوليد مستقلٌّ عن `busy`', () => {
    /* `busy` يقود زرَّ إيقاف البوت، وأخطرُ زرٍّ في الشاشة لا يُظهر «…» في
       أثناء فعلٍ لا علاقةَ له به. */
    expect(PAGE).toContain('const [resetting, setResetting]');
    expect(PAGE).toContain('busy={resetting}');
  });
});
