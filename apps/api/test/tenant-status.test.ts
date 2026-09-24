import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tenantBlocked, TenantStatus, ErrorCode } from '@aibot/shared';

/**
 * ★ **«الإيقاف» كان يقطع ما يدفعه الزبون ويترك ما تدفعه المنصّة.**
 *
 * حالةُ المستأجر كانت مفروضةً في **موضعٍ واحدٍ** في المستودع كلِّه: الويبهوك.
 * فحسابٌ أوقفه مالكُ المنصّة يتوقّف عن **استقبال** رسائل الزبائن — وهذا كلُّ
 * ما يقع. وصاحبُه يبقى:
 *  · يدخل ويُجدّد جلستَه (كوكي التحديث ثلاثون يوماً)،
 *  · ويُنفق توكنز الساحة — نداءاتٌ حقيقيّةٌ بمفتاح المنصّة حين لا مفتاحَ له،
 *  · **ويرسل إلى واتساب وإنستجرام**: بوتٌ نُشر قبل الإيقاف يردّ على نوافذَ
 *    مفتوحة، وموظّفٌ يكتب من الإنبوكس — باسم عميلٍ أُوقف حسابُه.
 */

const SRC = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');
const code = (rel: string) => SRC(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/[^\n]*/gm, ' ');

describe('القاعدةُ واحدةٌ ومشتركة', () => {
  it('الموقوفُ والمؤرشفُ محجوبان، والتجربةُ والنشِطُ يعملان', () => {
    expect(tenantBlocked('suspended')).toBe(true);
    expect(tenantBlocked('archived')).toBe(true);
    expect(tenantBlocked('trial')).toBe(false);
    expect(tenantBlocked('active')).toBe(false);
  });

  it('★ وغيابُ الحالة لا يحجب — مالكُ المنصّة صفُّه بلا مستأجر', () => {
    /* الوصلُ أيسرُ في كلّ استعلام، فـ`null` تعني «لا مستأجرَ له» لا «موقوف».
       وحجبُها هنا كان يقفل الباب على مالك المنصّة نفسِه. */
    expect(tenantBlocked(null)).toBe(false);
    expect(tenantBlocked(undefined)).toBe(false);
  });

  it('وكلُّ حالةٍ في المخطّط مغطّاة — فلا حالةٌ جديدةٌ تمرّ بلا قرار', () => {
    for (const s of TenantStatus.options) {
      expect(typeof tenantBlocked(s)).toBe('boolean');
    }
    expect(TenantStatus.options).toEqual(['trial', 'active', 'suspended', 'archived']);
  });

  it('★ ورمزٌ خاصٌّ لا `FORBIDDEN`', () => {
    /* «موقوف» حالةُ حسابٍ تُرفع بمكالمة، و«ممنوع» نقصُ صلاحيّة. وخلطُهما
       يُظهر «لا صلاحيّة لديك» لصاحب الحساب نفسِه — فيظنّ العطلَ في دوره. */
    expect(ErrorCode.TENANT_SUSPENDED).toBe('TENANT_SUSPENDED');
  });
});

describe('الدخولُ والتجديد', () => {
  const auth = code('apps/api/src/auth.ts');

  it('★ الدخولُ يقرأ حالةَ المستأجر مع المستخدم — في نفس المعاملة', () => {
    expect(auth, 'كان `select().from(users)` بلا وصلٍ إطلاقاً')
      .toMatch(/leftJoin\(tenants, eq\(tenants\.id, users\.tenantId\)\)/);
    expect(auth).toContain('tenantBlocked(rows[0]?.tenantStatus)');
  });

  it('★★ والفحصُ **بعد** كلمة السرّ لا قبلها', () => {
    /* قبلَها يصير مقياساً يُميّز بريداً مسجَّلاً من غيره بلا معرفة الكلمة —
       وهو تعدادُ حساباتٍ مجّانيّ. */
    const at = auth.indexOf("'/auth/login'");
    const block = auth.slice(at, at + 3000);
    const pwd = block.indexOf('verifyPassword(password');
    const gate = block.indexOf('tenantBlocked(');
    expect(pwd).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(0);
    expect(gate, 'الحجبُ قبل فحص الكلمة — يكشف أيُّ بريدٍ مسجَّل').toBeGreaterThan(pwd);
  });

  it('★ والتجديدُ يفحص أيضاً — وإلّا جدّد الموقوفُ شهراً كاملاً', () => {
    /* التوكن يعيش ربعَ ساعة والكوكي ثلاثين يوماً، وهذا الملفُّ يوثّق أنّ
       التجديد هو نقطةُ فحص صلاحيّة الجلسة الوحيدة. */
    const at = auth.indexOf("'/auth/refresh'");
    const block = auth.slice(at, at + 2200);
    expect(block).toContain('tenantBlocked(');
    expect(block, 'والكوكي يُمحى فلا تبقى جلسةٌ تُحاوِل كلّ دقيقة')
      .toContain('clearRefreshCookie()');
  });
});

describe('الساحةُ لا تُنفق على حسابٍ موقوف', () => {
  const pg = code('apps/api/src/routes/playground.ts');

  it('★ الفحصُ قبل النداء المدفوع', () => {
    expect(pg).toContain('tenantBlocked(');
    const gate = pg.indexOf('tenantBlocked(');
    const run = pg.indexOf('runDryReply(');
    expect(run).toBeGreaterThan(0);
    expect(gate, 'الفحصُ بعد أن دُفع ثمنُ النداء').toBeLessThan(run);
  });
});

describe('الإرسالُ إلى ميتا', () => {
  const out = code('apps/worker/src/outbound.ts');

  it('★ حارسُ الحساب **قبل** حارس النافذة — ولا استثناء لمصدرٍ ولا لدور', () => {
    expect(out).toContain('tenantBlocked(ctx.tenantStatus)');
    const t = out.indexOf('tenantBlocked(ctx.tenantStatus)');
    const w = out.indexOf('throw new WindowClosedError');
    expect(w).toBeGreaterThan(0);
    expect(t).toBeLessThan(w);
  });

  it('والحالةُ تُجلب في نفس قراءة السياق — لا استعلامٌ ثانٍ لكلّ رسالة', () => {
    expect(out).toMatch(/innerJoin\(tenants, eq\(tenants\.id, conversations\.tenantId\)\)/);
    expect(out).toContain('tenantStatus: tenants.status');
  });

  it('★★ والإيقافُ صنفُ خطأٍ خاصّ — و`safeSend` تعرفه', () => {
    /* بلا هذا يقع في الفرع العامّ فتُرفَع **حادثةٌ حرجة** «فشل إرسال رسالة»
       عند كلّ ردٍّ من بوتٍ ما زال يعمل على نوافذَ مفتوحة، ويُعاد المحاولة
       أسّيّاً — ضجيجٌ يُغرق سيلَ الحوادث في اللحظة التي أوقفت فيها المنصّةُ
       الحسابَ **قصداً**. */
    expect(out).toMatch(/export class TenantBlockedError extends Error/);
    const reply = code('apps/worker/src/reply.ts');
    expect(reply).toContain('if (e instanceof TenantBlockedError) return;');
    const t = reply.indexOf('TenantBlockedError) return');
    const generic = reply.indexOf("kind: 'send_failed'");
    expect(generic).toBeGreaterThan(0);
    expect(t, 'الفرعُ العامّ يسبقه فتُرفَع حادثةٌ حرجة').toBeLessThan(generic);
  });

  it('والرسالةُ على الفقاعة بشريّةٌ تقول ما يُفعل', () => {
    expect(SRC('apps/worker/src/outbound.ts')).toContain('حسابك موقوف');
  });
});

describe('الفحصُ العميق خلف توكن', () => {
  const main = code('apps/api/src/main.ts');

  it('★ `/api/health/deep` كان مفتوحاً للعموم عبر النفق', () => {
    /* أعماقُ الطوابير وعدَدُ الفاشلة و`uptime` خريطةُ حملٍ وتوقيت: عمقٌ يرتفع
       يقول إنّ العامل متعثّر، وهي اللحظةُ التي يُختار فيها الضغط. */
    const at = main.indexOf("'/api/health/deep'");
    expect(at).toBeGreaterThan(0);
    expect(main.slice(at, at + 160)).toContain('requireAuth({ console: true })');
  });

  it('والسطحيُّ يبقى مفتوحاً — بوّابةُ النشر ومراقبٌ خارجيٌّ يحتاجانه', () => {
    const at = main.indexOf("app.get('/api/health'");
    expect(at).toBeGreaterThan(0);
    expect(main.slice(at, at + 120)).not.toContain('requireAuth');
  });
});
