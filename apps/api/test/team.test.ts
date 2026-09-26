import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUniqueViolation, pgError } from '../src/routes/team.js';

/**
 * ★ حرّاسُ شاشة الفريق — **ساكنةٌ عمداً**، وعلى نفس نمط `db-context.test.ts`.
 *
 * ولماذا ماسحٌ ساكنٌ لا اختبارُ تكامل: القيودُ الأربعة التي تحمي هذه المسارات
 * **شكلٌ في الكود** لا حالةٌ تُجرَّب. واختبارُ التكامل يمسك الحالةَ التي جرّبها
 * وحدها؛ وهذا يمسك الشكلَ كلَّه — بما فيه المسارُ الخامس الذي يُضاف بعد
 * ستّة أشهر وينسى صاحبُه سطرَ التدقيق أو بوّابةَ الصلاحيّة.
 *
 * وما يُحرَس هنا ليس ذوقاً: كلُّ سطرٍ منه بابُ حسابِ عميل.
 *  ① **بوّابةُ الصلاحيّة على كلّ مسار**: `needs: 'settings'` في التنقّل يُخفي
 *    البند عن الموظّف — و**إخفاءُ بندٍ ليس أماناً**، فالمسارُ يُكتب بالأصابع.
 *  ② **لا `withPlatform` في الملفّ**: إدارةُ فريقٍ ليست فعلاً عابراً
 *    للمستأجرين، فدورٌ متجاوزٌ لـRLS هنا خطرٌ بلا مقابل.
 *  ③ **لا يُنشئ مالكاً إلّا مالك**: الشرطُ صريحٌ في الدعوة والترقية معاً.
 *  ④ **القفلُ قبل العدّ**: آخرُ مالكٍ نشطٍ لا يُنزَّل ولا يُعطَّل، والفحصُ
 *    `FOR UPDATE` داخل المعاملة لا `COUNT` قبلها.
 *  ⑤ **وتعطيلٌ لا يطرد ليس تعطيلاً**: إبطالُ الجلسات في نفس المعاملة.
 */

const SRC = readFileSync(join(__dirname, '..', 'src', 'routes', 'team.ts'), 'utf8');

/**
 * ★ يُعمي التعليقاتَ ويحفظ الأسطر — و**ضرورتُه ليست نظريّة**: أوّلُ تشغيلٍ
 *   لهذا الملفّ أسقط دعوى «لا `withPlatform` في الملفّ» على **شرحٍ يقول ذلك
 *   بعينه**. وهو نفسُ العطل الموصوف في `design-system.test.ts` و
 *   `db-context.test.ts`: ماسحٌ يعدّ التعليقاتِ يُنتج إنذاراً كاذباً، وإنذارٌ
 *   كاذبٌ واحدٌ أسرعُ طريقٍ إلى إطفاء الحارس.
 *
 *   ولذلك الدعاوى **السالبة** تُقاس على النصّ المُعمى، والموجبةُ على النصّ كما
 *   هو: «يوجد كذا» لا يكذب بتعليق، و«لا يوجد كذا» يكذب به دائماً.
 */
export function maskComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

/** النصُّ بلا شرحٍ — كلُّ دعوى «لا يوجد» تُقاس عليه. */
const CODE = maskComments(SRC);

/**
 * يقطع الملفَّ إلى مساراتٍ: من تسجيلٍ إلى التسجيل الذي يليه.
 * والتوليدُ من النصّ لا من قائمةٍ مكتوبةٍ بيد — فمسارٌ جديدٌ يدخل الحرسَ
 * تلقائيّاً بدل أن يُنسى في جدولٍ يُحدَّث باليد.
 */
export function teamRoutes(src: string): Array<{ method: string; path: string; body: string }> {
  const re = /\bapp\.(get|post|patch|put|delete)\s*(?:<[^<>]*>)?\s*\(\s*'([^']+)'/g;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({
    method: m[1]!,
    path: m[2]!,
    body: src.slice(m.index!, hits[i + 1]?.index ?? src.length),
  }));
}

const ROUTES = teamRoutes(SRC);
const writes = ROUTES.filter((r) => r.method !== 'get');
const route = (path: string) => ROUTES.find((r) => r.path === path)!;

describe('ماسحُ المسارات يعمل — وإلّا فالحرسُ يمرّ على الفراغ', () => {
  it('يجد المسارات الستّة كلَّها بأسمائها', () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'get /team',
      'get /team/roster',
      'patch /team/:id/role',
      'post /team/:id/active',
      'post /team/:id/reset-password',
      'post /team/invite',
    ]);
  });

  it('ويقتطع جسمَ المسار لا الملفَّ كلَّه', () => {
    // جسمُ الدعوة يحمل شرطَ المقاعد، وجسمُ القائمة لا يحمله
    expect(route('/team/invite').body).toContain('seatsOf');
    expect(route('/team').body).not.toContain('reset-password');
  });

  it('والماسحُ يمسك الشكلَ في نصٍّ مصنوع', () => {
    const made = "app.get('/a', h);\napp.post<{ Body: { x?: 1 } }>(\n  '/b',\n  h,\n);";
    expect(teamRoutes(made).map((r) => `${r.method} ${r.path}`)).toEqual(['get /a', 'post /b']);
    expect(teamRoutes('app.ready();')).toEqual([]);
  });
});

/**
 * ★ **استثناءٌ واحدٌ معلَن — ولا يُوسَّع إلّا بنيّة.**
 *
 *   `/team/roster` سجلٌّ للتحويل: معرّفٌ واسمٌ ودورٌ لأعضاء الفريق النشطين،
 *   يقرؤه **كلُّ** موظّف. ولولاه لبقيت ورقة «حوّلها لزميل» وسماً نصّيّاً لا
 *   يقول لأيّ زميل، لأنّ `/team` خلف صلاحيّة الإعدادات.
 *
 *   والاستثناءُ محروسٌ من جهتَين لا جهةٍ واحدة: أنّه **وحده** المعفى من
 *   بوّابة الإعدادات، وأنّ ما يُعيده أسماءٌ فقط. فلو أُضيف إليه بريدٌ أو
 *   حالةُ كلمةِ مرورٍ أو جلساتٌ حيّة، سقط الحارسُ الثاني — وهو بالضبط ما
 *   يحدث حين يُوسَّع مسارٌ صغيرٌ بعد ستّة أشهر لأنّ البيانات «موجودةٌ أصلاً».
 */
const ROSTER = '/team/roster';

describe('① بوّابةُ الصلاحيّة — الخادم يفرضها لا التنقّل', () => {
  it('كلّ مسارٍ يمرّ بالبوّابة نفسِها — إلّا سجلَّ الأسماء', () => {
    const naked = ROUTES
      .filter((r) => r.path !== ROSTER)
      .filter((r) => !r.body.includes('preHandler: owner'));
    expect(naked.map((r) => r.path), 'مسارٌ بلا بوّابة صلاحيّة — الموظّف يبلغه بكتابة عنوانه.').toEqual([]);
  });

  it('والبوّابةُ هي `settings` — وهي التي ترفض الموظّف', () => {
    expect(SRC).toContain('requireAuth({ settings: true })');
    /* و`requireAuth()` العارية مسموحةٌ **مرّةً واحدة**: في سجلّ الأسماء.
       والعدُّ هو الحارس — فنسخةٌ ثانيةٌ منها في مسارٍ آخر تُسقطه. */
    const bare = [...CODE.matchAll(/requireAuth\(\s*\)/g)].length;
    expect(bare, 'بوّابةٌ عاريةٌ في أكثر من موضع — `requireAuth()` تقبل أيَّ داخلٍ مهما كان دوره').toBe(1);
    expect(route(ROSTER).body, 'وهي في سجلّ الأسماء لا في غيره').toMatch(/requireAuth\(\s*\)/);
  });

  it('★ وسجلُّ الأسماء أسماءٌ فقط — لا بريدٌ ولا كلمةُ مرورٍ ولا جلسات', () => {
    const body = maskComments(route(ROSTER).body);
    expect(body, 'المعرّفُ والاسمُ والدور — وهذا كلُّ ما يحتاجه من يحوّل محادثة')
      .toMatch(/select\(\{\s*id:\s*users\.id,\s*name:\s*users\.name,\s*role:\s*users\.role\s*\}\)/);
    for (const leak of ['users.email', 'passwordHash', 'mustChangePassword', 'lastLoginAt', 'sessions']) {
      expect(body, `${leak} في سجلٍّ يقرؤه كلُّ موظّف`).not.toContain(leak);
    }
    expect(body, 'والنشطون وحدهم — حسابٌ معطَّلٌ ليس زميلاً يُحوَّل إليه')
      .toContain('eq(users.isActive, true)');
  });

  it('والمستأجرُ يُشتقّ من التوكن في كلّ مسار — لا من جسمٍ ولا من مسار', () => {
    const loose = ROUTES.filter((r) => !r.body.includes('tenantOf(req)'));
    expect(loose.map((r) => r.path)).toEqual([]);
    expect(/tenantId\s*[:=]\s*(?:req\.body|req\.params)/.test(CODE)).toBe(false);
  });
});

describe('② العزلُ من بوّابةِ المستأجر وحدها', () => {
  it('لا withPlatform في الملفّ — لا دورَ متجاوزاً لـRLS في إدارة فريق', () => {
    expect(CODE).not.toContain('withPlatform');
  });

  it('وكلُّ مسارٍ يفتح `withTenant`', () => {
    const loose = ROUTES.filter((r) => !r.body.includes('withTenant(getDb()'));
    expect(loose.map((r) => r.path)).toEqual([]);
  });
});

describe('③ لا يُنشئ `tenant_owner` إلّا `tenant_owner`', () => {
  it('الشرطُ صريحٌ في الدعوة والترقية معاً', () => {
    for (const p of ['/team/invite', '/team/:id/role']) {
      expect(
        route(p).body,
        `${p} لا يفحص دورَ الفاعل — ومالكُ المنصّة يملك settings أيضاً.`,
      ).toContain("req.auth!.role !== 'tenant_owner'");
    }
  });

  it('والدورُ يُقرأ من التوكن لا من الجسم', () => {
    expect(/role\s*:\s*req\.body/.test(CODE)).toBe(false);
  });
});

describe('④ آخرُ مالكٍ نشطٍ لا يُعزَل — والقفلُ قبل العدّ', () => {
  it('العدُّ يقفل صفوفَه: `FOR UPDATE` لا `COUNT` مجرّد', () => {
    expect(SRC).toMatch(/lockActiveOwners[\s\S]*?FOR UPDATE/);
  });

  it('ويُستدعى في تنزيل الدور وفي التعطيل معاً', () => {
    expect(route('/team/:id/role').body).toContain('lockActiveOwners');
    expect(route('/team/:id/active').body).toContain('lockActiveOwners');
  });

  it('والمالكُ لا يعطّل نفسه، ولا يُعيد تعيين كلمته من هذه الشاشة', () => {
    expect(route('/team/:id/active').body).toContain("target.id === req.auth!.sub");
    expect(route('/team/:id/reset-password').body).toContain('req.params.id === req.auth!.sub');
  });

  it('★ والمستهدَفُ يُقرأ مقفولاً — لا لقطةً قد بطلت قبل القرار', () => {
    /* قراءةٌ بلا قفلٍ تُعطي دوراً قديماً: موظّفٌ يُرقّى مالكاً بين القراءة
       والكتابة فيُعطَّل بلا فحصِ «آخر مالك». */
    for (const p of ['/team/:id/role', '/team/:id/active', '/team/:id/reset-password']) {
      expect(route(p).body, `${p} يقرأ المستهدَف بلا قفل`).toContain('lockMember(tx, tenantId, id)');
    }
    expect(CODE).toMatch(/async function lockMember[\s\S]*?FOR UPDATE/);
  });

  it('★ وترتيبُ القفل واحدٌ في المسارَين الكاتبَين — وإلّا تعانقا', () => {
    for (const p of ['/team/:id/role', '/team/:id/active']) {
      const b = route(p).body;
      expect(b.indexOf('lockActiveOwners'), `${p} يقفل المستهدَف قبل المالكين`)
        .toBeLessThan(b.indexOf('lockMember(tx'));
    }
  });

  it('★ وسقفُ المقاعد بقفلٍ استشاريّ — قفلُ الصفوف لا يمنع إدراجاً', () => {
    /* `FOR UPDATE` يُسلسل تعديلَ صفوفٍ قائمة ولا يمنع صفّاً جديداً: دعوتان
       متزامنتان تقرآن نفس العدد وتُدرجان، فيتجاوز الفريقُ مقاعدَ الباقة. */
    expect(route('/team/invite').body).toContain('pg_advisory_xact_lock');
    expect(route('/team/invite').body).toMatch(/pg_advisory_xact_lock[\s\S]{0,80}\$\{tenantId\}/);
  });
});

describe('المعرّفُ يُفحص قبل القاعدة — 404 لا 500 على خطأ الطالب', () => {
  it('كلُّ مسارٍ بمعرّفٍ يمرّ بالفاحص', () => {
    const loose = ROUTES.filter((r) => r.path.includes(':id') && !r.body.includes('memberIdOf('));
    expect(
      loose.map((r) => r.path),
      'معرّفٌ مشوّهٌ يبلغ عمودَ uuid فترمي القاعدةُ — فيقرأ العميلُ «خطأٌ داخليّ» على خطئه هو.',
    ).toEqual([]);
  });

  it('والفاحصُ يرفع 404 لا 400 — «لا شيء بهذا الاسم» لا «عطبٌ عندنا»', () => {
    expect(CODE).toMatch(/function memberIdOf[\s\S]*?UUID_RE[\s\S]*?404/);
  });
});

describe('⑤ تعطيلٌ لا يطرد ليس تعطيلاً', () => {
  it('الجلساتُ تُبطَل في التعطيل وفي تنزيل الدور وفي إعادة التعيين', () => {
    for (const p of ['/team/:id/active', '/team/:id/role', '/team/:id/reset-password']) {
      expect(route(p).body, `${p} لا يُبطل الجلسات — التوكنُ يبقى صالحاً ربعَ ساعة.`)
        .toContain('revokeAllSessions');
    }
  });

  it('والإبطالُ داخل نفس المعاملة — لا بعد إيداعها', () => {
    /* لو وقع الإبطالُ بعد `withTenant` لأمكن أن يُودَع التعطيلُ ويفشل هو،
       فيقول الجدولُ «معطَّل» والموظّفُ ما زال يكتب. فالدالّةُ تأخذ `tx`. */
    expect(SRC).toMatch(/async function revokeAllSessions\(tx: Tx/);
    expect(SRC).toMatch(/await revokeAllSessions\(tx,/);
  });

  it('وجدولُ الجلسات معلَنٌ خارج RLS صراحةً — حارسُ السياق يطلب ذلك', () => {
    expect(SRC).toMatch(/\/\/ rls-exempt:\s*\S/);
  });
});

describe('⑥ الكلمةُ المؤقّتة — نفسُ نمط لوحة المالك حرفيّاً', () => {
  it('تُولَّد بـ`publicId` وتُجزَّأ ولا تُخزَّن نصّاً', () => {
    expect(SRC).toContain('publicId().slice(0, TEMP_LEN)');
    // مرّتان: الدعوة وإعادةُ التعيين — وكلتاهما تجزّئ قبل الكتابة
    expect([...CODE.matchAll(/hashPassword\(temp\)/g)]).toHaveLength(2);
    expect(/passwordHash:\s*temp\b/.test(CODE)).toBe(false);
  });

  it('وتُجبر صاحبَها على تغييرها في الحالتين', () => {
    expect(route('/team/invite').body).toContain('mustChangePassword: true');
    expect(route('/team/:id/reset-password').body).toContain('mustChangePassword: true');
  });

  it('ولا تدخل سجلّاً — ولا تُكتب في `diff` ولا في سطر لوغ', () => {
    expect(/console\./.test(CODE)).toBe(false);
    expect(/log[^\n]*\btemp\b/.test(CODE)).toBe(false);
    // `diff` سجلُّ تدقيقٍ يُقرأ لاحقاً: كلمةٌ فيه كلمةٌ مسرَّبة
    expect(/diff:\s*\{[^}]*\btemp\b/.test(CODE)).toBe(false);
  });
});

describe('⑦ كلُّ فعلٍ في `audit_log` باسم فاعله', () => {
  it('كلُّ مسارٍ كاتبٍ يُدرج سطراً بفاعلٍ وفعل', () => {
    const silent = writes.filter((r) => !(
      r.body.includes('auditLog')
      && r.body.includes('actorUserId: req.auth!.sub')
      && /action:\s*(?:'team\.|isActive \?)/.test(r.body)
    ));
    expect(
      silent.map((r) => r.path),
      'فعلٌ كاتبٌ بلا سطرِ تدقيقٍ باسم فاعله — وهذا سببُ وجود الشاشة أصلاً.',
    ).toEqual([]);
  });

  it('والمسارُ القارئ لا يكتب سجلّاً — قراءةُ قائمةٍ ليست فعلاً', () => {
    expect(route('/team').body).not.toContain('auditLog');
  });
});

describe('رمزُ القيد الفريد — فرقُ 409 مفهومةٍ عن 500 غامضة', () => {
  it('يُطابق نصَّ `23505` كما يمرّره postgres.js', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('★★ و**تحت غلاف drizzle** — الشكلُ الوحيدُ الذي يصل فعلاً منذ 0.45', () => {
    /* كان هذا الحارسُ يمرّر `{ code }` عارياً فمرّ، والخادمُ يردّ ٥٠٠ على كلّ
       تكرار: drizzle يلفّ الخطأ في `DrizzleQueryError` والرمزُ في `.cause`. */
    class DrizzleQueryError extends Error {
      constructor(override readonly cause: unknown) { super('Failed query: insert into "users" …'); }
    }
    const wrapped = new DrizzleQueryError({ code: '23505', constraint_name: 'users_email_unique' });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(pgError(wrapped)?.constraint_name).toBe('users_email_unique');
    expect(isUniqueViolation(new DrizzleQueryError({ code: '23503' }))).toBe(false);
    expect(isUniqueViolation(new DrizzleQueryError(undefined))).toBe(false);
  });

  it('ولا يُطابق رقماً ولا رمزاً آخر — وهذا هو الخطأ الصامت', () => {
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });

  it('ولا ينهار على ما ليس كائناً', () => {
    for (const v of [null, undefined, 'x', 0, new Error('boom')]) {
      expect(isUniqueViolation(v)).toBe(false);
    }
  });
});
