import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★ **ثلاثةُ وعودٍ في المخطَّط والتعليقات لم يكن لها فعل.**
 *
 *   ① دورةُ حياة العميل (#127): `status` يُقرأ في خمسة مواضع ولا يكتبه أحد — كلُّ
 *      عميلٍ `trial` إلى الأبد، ولوحةُ الهامش تعرض `active` وحدها فتخلو.
 *   ② مفتاحُ الإيقاف من اللوحة (#63): `enabled=false` وحده، وهو ما يقلبه العميل
 *      من زرّه — فالإيقافُ الثالثةَ فجراً يعود خلال دقيقة بلا أثر.
 *   ③ تغطيةُ السجلّ (#64): النشرُ والتبديلُ وأدواتُ HTTP وربطُ القناة من العميل
 *      بلا صفّ، وسببُ `withPlatform` يُجبَر في الكود ولا يُرى في أيّ مكان.
 *
 * الأسلاكُ تُمسح بعد نزع التعليقات، وكلُّ سالبٍ يسبقه موجبٌ يُثبت المرساة.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const bare = (p: string): string => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('★★ قفلُ المنصّة على البوت — لا يفتحه العميل', () => {
  const mig = read('packages/db/migrations/0013_bot_platform_lock.sql');
  const schema = bare('packages/db/src/schema/bot.ts');
  const bot = bare('apps/api/src/routes/bot.ts');
  const con = bare('apps/api/src/routes/console.ts');

  it('عمودان في الترحيل والمخطَّط معاً — والترحيلُ يُعاد تطبيقُه بلا ضرر', () => {
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS platform_locked_at timestamptz');
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS platform_lock_reason text');
    expect(mig).not.toMatch(/\r/);
    expect(schema).toContain("platformLockedAt: timestamp('platform_locked_at'");
    expect(schema).toContain("platformLockReason: text('platform_lock_reason')");
  });

  it('★★ إيقافُ اللوحة يكتب القفلَ والسبب، و`/bot/toggle` يرفض التشغيلَ ما دام مكتوباً', () => {
    const kill = con.indexOf("'/console/tenants/:id/kill-bot'");
    expect(kill).toBeGreaterThan(0);
    expect(con.slice(kill, kill + 1800)).toContain('platformLockedAt: new Date(), platformLockReason: reason');
    const toggle = bot.indexOf("'/bot/toggle'");
    const guard = bot.indexOf('if (enabled && cur?.platformLockedAt)', toggle);
    const upsert = bot.indexOf('tx.insert(botConfigs)', toggle);
    expect(guard).toBeGreaterThan(toggle);
    expect(guard).toBeLessThan(upsert);
  });

  it('★ والنشرُ الأوّل لا يُشعل بوتاً مقفولاً — في المسارَين', () => {
    expect(bot).toContain("...(firstPublish && !cfg.platformLockedAt ? { enabled: true } : {})");
    expect(bot).toContain('if (firstPublish && !cfg.platformLockedAt) {');
    expect(bot).not.toContain('...(firstPublish ? { enabled: true } : {})');
  });

  it('★ والرفعُ من اللوحة وحدها، ولا يشغّل، ولا ينجح على لا شيء', () => {
    const at = con.indexOf("'/console/tenants/:id/unlock-bot'");
    const body = con.slice(at, at + 1200);
    expect(at).toBeGreaterThan(0);
    expect(body).toContain('platformLockedAt: null, platformLockReason: null');
    expect(body).not.toContain('enabled: true');
    expect(body).toContain('if (!hit.length) throw');
    expect(body).toContain("action: 'tenant.unlock_bot'");
  });

  it('وشاشةُ البوت تقول السببَ وتعطّل «شغّل»', () => {
    const page = bare('apps/web/src/app/app/bot/page.tsx');
    expect(page).toContain('const platformLock = cfg?.platformLockedAt');
    expect(page).toContain('const locked = Boolean(lockReason) || Boolean(platformLock);');
    expect(page).toContain('reason={lockReason ?? platformLock ?? undefined}');
    expect(page).toContain('} else if (platformLock) {');
  });
});

describe('★★★ دورةُ حياة العميل — انتقالاتٌ مسمّاةٌ تطرد', () => {
  const con = bare('apps/api/src/routes/console.ts');
  const page = bare('apps/web/src/app/console/page.tsx');

  it('ثلاثةُ انتقالاتٍ مقيَّدةٍ بالحالة الراهنة — لا حقلٌ حرّ', () => {
    expect(con).toContain("'/console/tenants/:id/status/:action'");
    expect(con).toContain('req.params.action in TENANT_TRANSITIONS');
    for (const k of ['activate:', 'suspend:', 'archive:']) expect(con).toContain(k);
    expect(con).toContain('(tr.from as readonly string[]).includes(t.status)');
    /* والقيمُ من القائمة المغلقة في المخطَّط وحدها. */
    for (const to of ["to: 'active'", "to: 'suspended'", "to: 'archived'"]) expect(con).toContain(to);
  });

  it('★★ الإيقافُ والأرشفةُ يُسقطان جلساتِ المستأجر في نفس المعاملة', () => {
    const at = con.indexOf("'/console/tenants/:id/status/:action'");
    const body = con.slice(at, at + 3000);
    const revoke = body.indexOf('tx.update(sessions).set({ revokedAt: new Date() })');
    const audit = body.indexOf("action: 'tenant.status'");
    expect(revoke).toBeGreaterThan(0);
    expect(revoke).toBeLessThan(audit);
    expect(body).toContain("if (tr.to !== 'active') {");
    /* والبثُّ بعد الإيداع. */
    expect(body.indexOf("emitToPlatform('tenant:update'")).toBeGreaterThan(body.indexOf('return { tenant: next!'));
  });

  it('★ ولوحةُ الهامش تعرض كلَّ من ليس مؤرشَفاً، والجدولُ يُظهر المؤرشَفين عند الطلب', () => {
    const usage = con.indexOf("'/console/usage'");
    expect(con.slice(usage, usage + 1600)).toContain("WHERE t.status <> 'archived'");
    expect(con.slice(usage, usage + 1600)).not.toContain("WHERE t.status = 'active'");
    expect(con).toContain("const includeArchived = req.query.archived === '1';");
    expect(con).toContain("WHERE ${includeArchived ? sql`true` : sql`t.status <> 'archived'`}");
  });

  it('والورقةُ تحمل الأفعالَ الثلاثة، والأرشفةُ خلف بوّابة الاسم', () => {
    expect(page).toContain("setStatus(sel, 'activate')");
    expect(page).toContain("setStatus(sel, 'suspend')");
    const arch = page.indexOf("setStatus(sel, 'archive')");
    expect(arch).toBeGreaterThan(0);
    /* داخل `details.cn-gate` وبشرط `armed` — لا نقرةً واحدةً في آخر الصفّ. */
    const gate = page.lastIndexOf('<details className="cn-gate">', arch);
    expect(gate).toBeGreaterThan(0);
    expect(page.slice(gate, arch)).toContain('disabled={!armed || can.readOnly}');
    expect(page).toContain("'/console/tenants?archived=1'");
    expect(page).toContain("active: { tone: 'ok', label: 'فعّال' }");
  });
});

describe('★★ تغطيةُ السجلّ — الأفعالُ الحسّاسة كلُّها', () => {
  const bot = bare('apps/api/src/routes/bot.ts');
  const reports = bare('apps/api/src/routes/reports.ts');

  it('النشرُ والتبديلُ وأدواتُ HTTP (إنشاءً وتعديلاً وحذفاً)', () => {
    for (const a of ['bot.publish', 'bot.toggle', 'bot.tool_create', 'bot.tool_update', 'bot.tool_delete']) {
      expect(bot, a).toContain(`action: '${a}'`);
    }
    /* ولا سرَّ في الفرق: أسماءُ الحقول لا قيمُها. */
    const upd = bot.indexOf("action: 'bot.tool_update'");
    expect(bot.slice(upd, upd + 400)).toContain("filter((k) => k !== 'secretsEnc' && k !== 'keyVersion')");
    expect(bot.slice(upd, upd + 400)).not.toContain('secrets:');
  });

  it('★ وربطُ القناة من العميل يُسجَّل كما يُسجَّل من اللوحة', () => {
    const at = reports.indexOf("'/channel/connect'");
    const body = reports.slice(at, at + 1200);
    expect(body).toContain("action: 'channel.connect'");
    expect(body).toContain('withTenant(getDb(), tenantId,');
  });

  it('★ وسببُ withPlatform يُرى في pg_stat_activity — لا يُجبَر في الكود فحسب', () => {
    const t = bare('packages/db/src/tenant.ts');
    const role = t.indexOf('SET LOCAL ROLE aibot_platform');
    const app = t.indexOf("set_config('application_name'");
    expect(role).toBeGreaterThan(0);
    expect(app).toBeGreaterThan(role);
    expect(t).toContain('`platform: ${reason}`.slice(0, 63)');
  });

  it('وكلُّ فعلٍ جديدٍ له اسمٌ عربيٌّ في سجلّ العميل', async () => {
    const { auditKnown } = await import('../../web/src/lib/audit');
    for (const a of ['tenant.status', 'tenant.unlock_bot', 'bot.publish', 'bot.toggle', 'bot.tool_create', 'bot.tool_update', 'bot.tool_delete']) {
      expect(auditKnown(a), a).toBe(true);
    }
  });
});
