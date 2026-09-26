import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { impRemainingMs, impRemainingLabel, IMP_LEAVE_EARLY_MS } from '../../web/src/lib/imp';
import { auditLabel, auditActor, auditKnown, isPlatformEntry } from '../../web/src/lib/audit';

/**
 * ★★★ **الانتحالُ كان وعداً مكتوباً في أربعة مواضع ولا يعمل في أيٍّ منها.**
 *
 *   ① لا زرَّ يبدؤه في أيّ شاشة (#2) — والأدهى أنّ `/me` كان يشتقّ المستأجرَ من
 *      صفّ المستخدم لا من التوكن، فحتّى لو نُودي المسارُ باليد أعادت القشرةُ
 *      المنتحِلَ إلى اللوحة قبل أن تُرسم شاشةُ عميلٍ واحدة.
 *   ② أجلُه ينقضي صامتاً فتصير الطلباتُ ٤٠٣ تحت لافتةٍ تقول «نشط»، واللافتةُ
 *      تمرّ مع المحتوى، وزرُّ الخروج يهبط على `/console/tenants` ولا وجودَ لها (#7).
 *   ③ «يراه العميل في سجلّه» — ولا سجلَّ للعميل أصلاً (#61).
 *   ④ من الحادثة إلى العميل لا طريق: اسمٌ بلا معرّف، وورقةٌ بلا رابط (#10).
 *   ⑤ واللوحةُ تردّ 500 على بريدٍ مكرّر وباقةٍ خاطئة، وتحلّ الحادثةَ بأيّ كلمةٍ
 *      في `:action`، وتُعلن إيقافَ بوتٍ على صفرِ صفوف (#23).
 *
 * الحسابُ الخالص يُختبر **بالتنفيذ**؛ والأسلاكُ تُمسح بعد نزع التعليقات، وكلُّ
 * سالبٍ يسبقه موجبٌ يُثبت أنّ المرساةَ موجودة.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const bare = (p: string): string => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('★ حسابُ مدّة الانتحال — تنفيذٌ لا نصّ', () => {
  const T0 = Date.parse('2026-09-26T10:00:00.000Z');

  it('يحسب المتبقّي من أجل ISO، و`null` بلا انتحال، وسالباً بعد الانقضاء', () => {
    expect(impRemainingMs(null, T0)).toBeNull();
    expect(impRemainingMs(undefined, T0)).toBeNull();
    expect(impRemainingMs('ليس تاريخاً', T0)).toBeNull();
    expect(impRemainingMs('2026-09-26T10:30:00.000Z', T0)).toBe(30 * 60_000);
    expect(impRemainingMs('2026-09-26T09:59:00.000Z', T0)).toBe(-60_000);
  });

  it('★ والنصُّ بالدقائق صعوداً، والصفرُ «انتهت» لا «٠ دقيقة»', () => {
    expect(impRemainingLabel(null)).toBe('');
    expect(impRemainingLabel(0)).toBe('انتهت المدّة');
    expect(impRemainingLabel(-5)).toBe('انتهت المدّة');
    expect(impRemainingLabel(40_000)).toBe('أقلّ من دقيقة');
    expect(impRemainingLabel(61_000)).toBe('دقيقتان');
    expect(impRemainingLabel(4 * 60_000 + 1)).toBe('5 دقائق');
    expect(impRemainingLabel(29 * 60_000 + 1)).toBe('30 دقيقة');
  });

  it('وهامشُ الخروج المبكّر ثوانٍ لا دقائق — قبل الأجل لا بعده', () => {
    expect(IMP_LEAVE_EARLY_MS).toBeGreaterThan(0);
    expect(IMP_LEAVE_EARLY_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('★ تسميةُ سجلّ الأفعال — تنفيذٌ لا نصّ', () => {
  it('كلُّ فعلٍ يكتبه الـAPI له اسمٌ عربيّ — ورمزٌ مجهولٌ يُعرض خامّاً لا يُخفى', () => {
    /* الأفعالُ تُجمع من المصدر لا من الذاكرة: فعلٌ جديدٌ غداً بلا اسمٍ يُمسك هنا. */
    const src = ['auth.ts', 'routes/console.ts', 'routes/team.ts', 'routes/contacts.ts', 'routes/bot.ts', 'routes/reports.ts', 'routes/playground.ts']
      .map((f) => read(`apps/api/src/${f}`)).join('\n');
    const actions = [...new Set([...src.matchAll(/action: '([a-z_.]+)'/g)].map((m) => m[1]!))]
      .filter((a) => a.includes('.'));
    expect(actions.length).toBeGreaterThanOrEqual(15);
    for (const a of actions) {
      expect(auditKnown(a), `«${a}» بلا اسمٍ عربيّ في lib/audit.ts`).toBe(true);
      expect(auditLabel(a)).not.toBe(a);
    }
    expect(auditKnown('x.unknown')).toBe(false);
    expect(auditLabel('x.unknown')).toBe('x.unknown');
  });

  it('★ والفاعلُ الفارغ يُفسَّر بالفعل: انتحالٌ بلا اسمٍ هو فريقُ المنصّة، لا «—»', () => {
    expect(auditActor({ action: 'tenant.impersonate', actorName: null, actorEmail: null })).toBe('فريق المنصّة');
    expect(auditActor({ action: 'team.invite', actorName: null, actorEmail: null })).toBe('حسابٌ أُزيل من الفريق');
    expect(auditActor({ action: 'team.invite', actorName: 'سارة', actorEmail: 's@x.jo' })).toBe('سارة');
    expect(isPlatformEntry('tenant.kill_bot')).toBe(true);
    expect(isPlatformEntry('contact.block')).toBe(false);
  });
});

describe('★★ /me — المستأجرُ من التوكن، والأجلُ مُعلَن', () => {
  const auth = bare('apps/api/src/auth.ts');

  it('يشتقّ المستأجرَ من `tid` التوكن لا من صفّ المستخدم وحده', () => {
    expect(auth).toContain('const tid = req.auth!.tid ?? u.tenantId;');
    expect(auth).not.toMatch(/const t = u\.tenantId\s*\?/);
  });

  it('★ ويُعلن أجلَ الانتحال من `exp` التوكن', () => {
    expect(auth).toContain('impersonating: req.auth!.imp ?? null');
    expect(auth).toMatch(/impersonationExpiresAt: req\.auth!\.imp \? new Date\(req\.auth!\.exp \* 1000\)/);
  });
});

describe('★★ اللوحة — متانةٌ في المسارات', () => {
  const con = bare('apps/api/src/routes/console.ts');

  it('★ الباقةُ تُحلّ قبل إدراج المستأجر — وإلّا 23503 قبل الـ400', () => {
    const create = con.indexOf("'/console/tenants',");
    const planAt = con.indexOf('if (!plan) {', create);
    const insertAt = con.indexOf('tx.insert(tenants)', create);
    expect(create).toBeGreaterThan(0);
    expect(planAt).toBeGreaterThan(create);
    expect(insertAt).toBeGreaterThan(planAt);
    expect(con).toContain("planId: plan.id,\n          }).returning();");
    expect(con).not.toContain('planId: b.planId ?? null');
  });

  it('★ وبريدٌ أو معرّفٌ مكرّرٌ يُقال بعينه لا 500', () => {
    expect(con).toContain("import { isUniqueViolation } from './team.js';");
    expect(con).toContain('if (isUniqueViolation(e)) throw new AppError(ErrorCode.VALIDATION, uniqueMessage(e), 409);');
    expect(con).toContain('function uniqueMessage(e: unknown): string');
    expect(con).toMatch(/if \(\/slug\/\.test\(c\)\)/);
    expect(con).toMatch(/if \(\/email\/\.test\(c\)\)/);
  });

  it('★★ و`:action` مقيَّدٌ — لا يحلّ الحادثةَ بأيّ كلمة', () => {
    const at = con.indexOf("'/console/incidents/:id/:action'");
    const guard = con.indexOf("req.params.action !== 'ack' && req.params.action !== 'resolve'", at);
    const tx = con.indexOf("withPlatform(db, 'تحديث حالة حادثة'", at);
    expect(at).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(at);
    expect(guard).toBeLessThan(tx);
  });

  it('★ وإيقافُ البوت لا يُعلن نجاحاً على صفر صفوف، والمعرّفُ المشوَّه ٤٠٤', () => {
    const at = con.indexOf("'/console/tenants/:id/kill-bot'");
    const body = con.slice(at, at + 1400);
    expect(body).toContain('.returning({ tenantId: botConfigs.tenantId })');
    expect(body).toContain('if (!hit.length) throw new AppError(ErrorCode.TENANT_NOT_FOUND');
    expect(body).toContain('UUID_RE.test(req.params.id)');
    const imp = con.indexOf("'/console/tenants/:id/impersonate'");
    expect(con.slice(imp, imp + 300)).toContain('UUID_RE.test(req.params.id)');
  });

  it('والحوادثُ تحمل معرّفَ العميل مع اسمه', () => {
    expect(con).toContain('tenantId: incidents.tenantId, tenantName: tenants.name');
  });
});

describe('★★ القشرة — زرٌّ يبدأ، عدّادٌ يخرج، لافتةٌ تلتصق', () => {
  const page = bare('apps/web/src/app/console/page.tsx');
  const shell = bare('apps/web/src/components/Shell.tsx');
  const css = read('apps/web/src/app/shell.css');

  it('★★★ ورقةُ العميل تبدأ الانتحال: توكنٌ في الذاكرة، وصلةٌ تُبنى من جديد، جلسةٌ تُقرأ، ثمّ انتقال', () => {
    const at = page.indexOf('async function impersonate(');
    expect(at).toBeGreaterThan(0);
    const body = page.slice(at, at + 900);
    expect(body).toContain('/impersonate`');
    const order = ['setToken(out.access)', 'resetSocket()', 'await reloadSession()', "router.replace('/app/inbox')"]
      .map((k) => body.indexOf(k));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    /* ولا تحميلَ كاملاً هنا: التوكنُ في الذاكرة يضيع معه. */
    expect(body).not.toContain('location.replace');
    expect(page).toContain("onClick={() => void impersonate(sel)}");
  });

  it('★ وتفتح ورقةَ العميل من `?t=` وتقول «انقضى الانتحال» من `?imp=expired`', () => {
    expect(page).toContain("const t = qs.get('t');");
    expect(page).toContain('if (t) setOpenId(t);');
    expect(page).toContain("qs.get('imp') === 'expired'");
  });

  it('★★ القشرةُ تعدّ تنازليّاً وتخرج قبل الأجل — إلى وِجهةٍ موجودة', () => {
    expect(shell).toContain('useNow(Boolean(me?.impersonating))');
    expect(shell).toContain('impRemainingMs(me?.impersonationExpiresAt, now)');
    expect(shell).toContain('if (impLeft == null || impLeft > IMP_LEAVE_EARLY_MS) return;');
    expect(shell).toContain('void leaveImpersonation(true);');
    expect(shell).toContain('impRemainingLabel(impLeft)');
    /* `/console/tenants` لا وجودَ لها — كان الخروج يهبط على ٤٠٤. */
    expect(shell).toContain("'/console'");
    expect(shell).not.toContain('/console/tenants');
  });

  it('★ واللافتةُ ملتصقةٌ بأعلى المُمرِّر لا تمرّ مع المحتوى', () => {
    expect(shell).toContain('<div className="imp-bar">');
    expect(css).toMatch(/\.main > \.imp-bar \{[^}]*position: sticky/);
  });
});

describe('★ من الحادثة إلى العميل — بالمعرّف', () => {
  const inc = bare('apps/web/src/app/console/incidents/page.tsx');
  const page = bare('apps/web/src/app/console/page.tsx');

  it('الترشيحُ بالمعرّف، والاسمُ عنوانٌ فقط', () => {
    expect(inc).toContain('tenantId: string | null;');
    expect(inc).toContain(': i.tenantId === tenant');
    expect(inc).not.toContain(': i.tenantName === tenant');
    expect(inc).toContain('counts.set(i.tenantId,');
  });

  it('★ وشارةُ العميل رابطٌ إلى ورقته، وورقتُه ترسل معرّفَه لا اسمَه', () => {
    expect(inc).toContain('href={`/console?t=${i.tenantId ?? \'\'}`}');
    expect(page).toContain('href={`/console/incidents?tenant=${sel.id}&name=${encodeURIComponent(sel.name)}`}');
    expect(page).toContain('lastIncident.set(inc.tenantId, inc)');
    expect(page).not.toMatch(/lastIncident\.get\(\w+\.name\)/);
  });
});

describe('★★ سجلُّ العميل — الوعدُ يُوفى', () => {
  const route = bare('apps/api/src/routes/audit.ts');
  const main = bare('apps/api/src/main.ts');
  const team = bare('apps/web/src/app/app/team/page.tsx');

  it('مسارٌ للمستأجر خلف صلاحيّة الإعدادات، تحت RLS، بلا `diff`', () => {
    expect(route).toContain("'/audit'");
    expect(route).toContain('requireAuth({ settings: true })');
    expect(route).toContain('withTenant(getDb(), tenantId,');
    expect(route).toContain('from(auditLog)');
    expect(route).not.toContain('auditLog.diff');
    expect(main).toContain('await registerAudit(api);');
  });

  it('★ وشاشةُ الفريق ترسمه وتسم دخولَ المنصّة', () => {
    expect(team).toContain("useApi<{ items: AuditRow[] }>('/audit')");
    expect(team).toContain('className="au-list"');
    expect(team).toContain("r.action === 'tenant.impersonate'");
    expect(team).toContain('auditActor(r)');
  });
});

describe('★ ولا ثابتَ تأكيدٍ لا يُرسَل', () => {
  it('OPTOUT_ACK_MSG أُزيل — نصٌّ لا يُرسَل وعدٌ كاذبٌ آخر', () => {
    const src = bare('packages/core/src/optout.ts');
    expect(src).toContain('export function detectOptOut');
    expect(src).not.toContain('OPTOUT_ACK_MSG');
  });
});
