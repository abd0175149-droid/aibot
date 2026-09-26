import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★★ **وعودٌ منشورةٌ بلا مسار، وفحصٌ يُعطّل ما يفحصه.**
 *
 *   ① صفحةُ الخصوصيّة تَعِد بحذف جهةٍ وكلّ بياناتها بزرٍّ واحد، وبتصديرٍ كامل،
 *      وبمحوٍ بعد ستّين يوماً من إنهاء العلاقة — ولا مسارَ لأيٍّ منها (#126).
 *   ② «افحص الاتّصال» كان يحوّل القناةَ إلى `error` عند أيّ تعثّرٍ عند ميتا —
 *      ثمّ يختفي زرُّ الفحص، ويرفض الإرسالُ كلَّ ردّ، ولا رجعةَ إلّا بسكربت (#123).
 *
 * الأسلاكُ تُمسح بعد نزع التعليقات، وكلُّ سالبٍ يسبقه موجب.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const bare = (p: string): string => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('★ فحصُ القناة — التنزيلُ عند العطل القاطع وحده', () => {
  const rep = bare('apps/api/src/routes/reports.ts');
  const page = bare('apps/web/src/app/app/channels/page.tsx');
  const levels = bare('packages/channels/src/types.ts');

  it('المستوياتُ أربعة — و`blocked` وحده توكنٌ باطل', () => {
    expect(levels).toContain("level: 'ok' | 'degraded' | 'blocked' | 'unreachable'");
  });

  it('★★ الخادم: `blocked` ⟶ error، و`unreachable` يُبقي الحالةَ ويكتب lastError', () => {
    const at = rep.indexOf("'/channel/test'");
    const body = rep.slice(at, at + 3500);
    expect(body).toContain("report.level === 'blocked' ? 'error' : ch.status");
    expect(body).toContain('lastError: report.issues[0] ?? null');
    expect(body).not.toMatch(/'connected' : 'error',/);
  });

  it('★ والشاشة تخيط بنفس القاعدة، وتُبقي زرَّ الفحص للمعطوبة — هو طريقُ عودتها', () => {
    expect(page).toContain("r.level === 'blocked' ? 'error' as const : c.status");
    expect(page).toContain("wa?.status === 'connected' || wa?.status === 'error' ?");
    expect(page).toContain("ig?.status === 'connected' || ig?.status === 'error' ?");
    expect(page).toContain("c.status === 'connected' || c.status === 'error'");
  });

  it('والفحصُ الدوريُّ ما زال يفحص `error` — فلا طريقَ بلا عودة', () => {
    const health = bare('apps/worker/src/health.ts');
    expect(health).toContain("inArray(tenantChannels.status, ['connected', 'error'])");
  });
});

describe('★★ الخصوصيّة — المساراتُ الثلاثة', () => {
  const priv = bare('apps/api/src/routes/privacy.ts');
  const main = bare('apps/api/src/main.ts');

  it('مسجَّلةٌ في الخادم، ولصاحب الإعدادات وحده', () => {
    expect(main).toContain('await registerPrivacy(api);');
    expect(priv).toContain("const owner = requireAuth({ settings: true });");
    for (const r of ["'/contacts/:id/export'", "'/contacts/:id'", "'/export'"]) expect(priv).toContain(r);
    expect(priv).toContain("app.delete<{ Params: { id: string } }>('/contacts/:id'");
  });

  it('★★★ الحذفُ يكتب أثرَه أعداداً **قبل** المحو، ولا يُعلن نجاحاً على صفر صفوف، ويبثّ بعد الإيداع', () => {
    const at = priv.indexOf("'/contacts/:id', { preHandler: owner }");
    const body = priv.slice(at, at + 3200);
    const audit = body.indexOf("action: 'contact.delete'");
    const del = body.indexOf('tx.delete(contacts)');
    const emit = body.indexOf("emitToTenant(tenantId, 'conversation:removed'");
    const txEnd = body.indexOf('return { conversationIds: convIds');
    expect(audit).toBeGreaterThan(0);
    expect(audit).toBeLessThan(del);
    expect(body).toContain('.returning({ id: contacts.id })');
    expect(body).toContain('if (!gone.length) throw');
    expect(emit).toBeGreaterThan(txEnd);
    expect(body).toContain('windowsBilled');
  });

  it('★ والتصديران مسجَّلان، وتصديرُ الحساب لا يُقطع بصمت', () => {
    expect(priv).toContain("action: 'contact.export'");
    expect(priv).toContain("action: 'tenant.export'");
    expect(priv).toContain('const truncated = msgs.length > EXPORT_MESSAGE_CAP;');
    expect(priv).toContain('truncated,');
    /* ولا حمولةَ خامّ: الجسمُ والنوع لا `channelPayload`. */
    expect(priv).not.toContain('channelPayload');
  });

  it('★ والمحوُ بعد ستّين يوماً من الأرشفة — الرقمُ نفسُه في الصفحة المنشورة', () => {
    const ret = bare('apps/worker/src/retention.ts');
    const privacy = read('apps/web/src/app/(legal)/privacy/page.tsx');
    expect(ret).toContain('export const PURGE_ARCHIVED_AFTER_DAYS = 60;');
    expect(ret).toContain("WHERE status = 'archived' AND archived_at < now() - ${`${PURGE_ARCHIVED_AFTER_DAYS} days`}::interval");
    expect(ret).toContain('LIMIT ${PURGE_TENANTS_PER_CYCLE}');
    expect(ret).toContain('const PURGE_TENANTS_PER_CYCLE = 3;');
    expect(ret).toContain('RETURNING id, slug, name, archived_at');
    expect(privacy).toMatch(/ثمّ حذفٌ بعد\{' '\}\s*<span className="num">60<\/span> يوماً/);
  });

  it('والحدثُ الجديد معلَنٌ في العقد ومسموعٌ في الإنبوكس', () => {
    const ev = bare('packages/shared/src/events.ts');
    const inbox = bare('apps/web/src/app/app/inbox/page.tsx');
    expect(ev).toContain("'conversation:removed': { id: string };");
    expect(ev).toMatch(/EVENT_NAMES = \[[^\]]*'conversation:removed'/);
    expect(inbox).toContain("'conversation:removed': () => { void list.reload(); }");
  });

  it('★ والشاشتان: زرّا الجهة خلف صلاحيّة الإعدادات وتأكيدٍ ثانٍ، وزرُّ الحساب في الفريق', () => {
    const contacts = bare('apps/web/src/app/app/contacts/page.tsx');
    const team = bare('apps/web/src/app/app/team/page.tsx');
    expect(contacts).toContain('perms.settings && !perms.readOnly && (');
    expect(contacts).toContain('download(`/contacts/${id}/export`');
    expect(contacts).toContain('del<{ message: string }>(`/contacts/${id}`)');
    expect(contacts).toContain('setConfirmDel(true)');
    expect(contacts).toContain('نعم — احذف نهائيّاً');
    expect(team).toContain("download('/export', 'aibot-export.json')");
  });

  it('وكلُّ فعلٍ جديدٍ له اسمٌ في سجلّ العميل', async () => {
    const { auditKnown } = await import('../../web/src/lib/audit');
    for (const a of ['contact.export', 'contact.delete', 'tenant.export']) expect(auditKnown(a), a).toBe(true);
  });
});
