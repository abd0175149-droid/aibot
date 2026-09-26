import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { billingPeriod, DEFAULT_TZ } from '../../../packages/shared/src/period';

/**
 * ★★ **أربعةُ عيوبٍ في البيانات لا يُظهرها التطوير ويُظهرها أوّلُ عميلٍ حقيقيّ.**
 *
 *   ① المنطقةُ الزمنيّة تُحسم في أربعة مواضع (#40): دالّتان بافتراض «عمّان»،
 *      وشهرُ UTC في لوحة الهامش، وثابتٌ للاتّجاهات — وجدولُ العملاء وحده يقرأ
 *      `tenants.timezone`. فعدّادان في لوحةٍ واحدةٍ يختلفان ثلاثَ ساعات.
 *   ② مرشَّحو التكرار في ورقة الجهة (#22): ضمُّ n×n على `similarity` لكلّ فتحة.
 *   ③ مفاتيحُ أجنبيّةٌ بلا فهرس (#39): مسحٌ كاملٌ عند الحذف المتعاقب.
 *   ④ سباقُ أوّل رسالتين (#55): إدراجُ الجهة يسبق قيدَ الهويّة — جهةٌ يتيمة.
 *
 * الحسابُ الخالص يُختبر بالتنفيذ؛ والأسلاكُ تُمسح بعد نزع التعليقات.
 */

const REPO = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
const bare = (p: string): string => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('★ دورةُ الفوترة — دالّةٌ واحدةٌ بلا افتراضِ منطقة', () => {
  it('الشهرُ يتبع منطقةَ المستأجر عند رأس الشهر — وهذا هو الانحرافُ الذي قِيس', () => {
    const t = new Date('2026-09-30T21:30:00Z');
    expect(billingPeriod(t, 'Asia/Amman')).toBe('2026-10');
    expect(billingPeriod(t, 'UTC')).toBe('2026-09');
    expect(billingPeriod(t, 'America/New_York')).toBe('2026-09');
    expect(billingPeriod(new Date('2026-02-01T00:00:00Z'), 'Asia/Riyadh')).toBe('2026-02');
    expect(DEFAULT_TZ).toBe('Asia/Amman');
  });

  it('★ ولا مُعامِلَ اختياريّاً يتسلّل منه «عمّان» — التوقيعُ يُجبر على المنطقة', () => {
    const src = bare('packages/shared/src/period.ts');
    expect(src).toMatch(/export function billingPeriod\(d: Date, timeZone: string\)/);
    expect(src).not.toMatch(/timeZone = '/);
  });

  it('★★ ولا نسخةَ محلّيّةً في العامل أو التقارير، ولا نداءَ بلا منطقة', () => {
    const out = bare('apps/worker/src/outbound.ts');
    const rep = bare('apps/api/src/routes/reports.ts');
    expect(out).toContain("import { billingPeriod, DEFAULT_TZ } from '@aibot/shared';");
    expect(out).not.toMatch(/function billingPeriod\(/);
    expect(out).toContain('billingPeriod(new Date(), ctx.tenantTz)');
    expect(out).toContain('tenantTz: tenants.timezone');
    expect(out).not.toContain('billingPeriod(new Date())');
    expect(rep).toContain('async function tenantTz(');
    expect(rep).not.toMatch(/function period\(/);
    expect(rep).not.toContain('period()');
    expect(rep).not.toContain('REPORT_TZ');
    expect(rep).toContain('await tenantTz(tx as never, tenantId)');
  });

  it('★ ولوحةُ الهامش تحسب شهرَ كلّ عميلٍ بمنطقته حين لا يُطلب شهرٌ بعينه', () => {
    const con = bare('apps/api/src/routes/console.ts');
    const at = con.indexOf("'/console/usage'");
    const body = con.slice(at, at + 2200);
    expect(body).toContain("coalesce(${asked}::text, to_char(now() AT TIME ZONE t.timezone, 'YYYY-MM'))");
    expect(body).toContain("to_char(r.created_at AT TIME ZONE t.timezone, 'YYYY-MM')");
    expect(body).not.toContain('toISOString().slice(0, 7)');
  });
});

describe('★★ مرشَّحو جهةٍ واحدة — خطّيٌّ لا تربيعيّ', () => {
  const c = bare('apps/api/src/routes/contacts.ts');

  it('ورقةُ الجهة تنادي `dupPairsFor` — لا كلَّ الأزواج ثمّ ترشيح', () => {
    expect(c).toContain('function dupPairsFor(tenantId: string, contactId: string): Frag');
    expect(c).toContain('from ${dupPairsFor(tenantId, id)} p');
    expect(c).not.toMatch(/from \$\{dupPairs\(tenantId\)\} p\s*\n\s*where p\.a = \$\{id\}/);
  });

  it('★ ونفسُ السببَين ونفسُ العتبة — فلا يختلف الاقتراحُ بين القائمة والورقة', () => {
    const at = c.indexOf('function dupPairsFor(');
    const body = c.slice(at, c.indexOf('\n}\n', at));
    expect(body).toContain("'phone'::text as why");
    expect(body).toContain("'name'::text");
    expect(body).toContain('>= 0.62');
    expect(body).toContain('length(t.tail) >= 7');
    /* الطرفُ الثابت لا يُقارَن بنفسه. */
    expect(body).toContain('c.id <> ${contactId}::uuid');
  });
});

describe('★ فهارسُ المفاتيح الأجنبيّة — في الترحيل وفي المخطَّط معاً', () => {
  const mig = read('packages/db/migrations/0014_fk_indexes.sql');
  const ch = bare('packages/db/src/schema/channel.ts');
  const bot = bare('packages/db/src/schema/bot.ts');

  it('أربعةُ فهارس IF NOT EXISTS بلا CONCURRENTLY (الترحيلُ داخل معاملة)', () => {
    for (const n of ['conv_contact_idx', 'windows_contact_idx', 'kb_chunks_source_idx', 'kb_retr_conv_idx']) {
      expect(mig).toMatch(new RegExp(`CREATE INDEX IF NOT EXISTS ${n}\\s+ON`));
    }
    /* الكلمةُ تُفحص في الكود لا في التعليق — فالتعليقُ يشرح لماذا غابت. */
    expect(mig.replace(/^--.*$/gm, '')).not.toMatch(/CONCURRENTLY/i);
    expect(mig).not.toMatch(/\r/);
  });

  it('★ والمخطَّطُ يعرفها بنفس الأسماء — وإلّا ولّد drizzle نسخةً ثانية', () => {
    expect(ch).toContain("index('conv_contact_idx').on(t.tenantId, t.contactId)");
    expect(ch).toContain("index('windows_contact_idx').on(t.tenantId, t.contactId)");
    expect(bot).toContain("index('kb_chunks_source_idx').on(t.sourceId)");
    expect(bot).toContain("index('kb_retr_conv_idx').on(t.conversationId)");
  });

  it('والملفُّ مرقَّمٌ بعد 0013 — النشرُ يطبّق بالترتيب الأبجديّ', () => {
    const files = readdirSync(join(REPO, 'packages/db/migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(files.indexOf('0014_fk_indexes.sql')).toBeGreaterThan(files.indexOf('0013_bot_platform_lock.sql'));
  });
});

describe('★★ سباقُ أوّل رسالتين — قفلٌ ثمّ تنظيف', () => {
  const inb = bare('apps/worker/src/inbound.ts');

  it('قفلٌ استشاريٌّ على (القناة، المعرّف) **قبل** قراءة الهويّة', () => {
    const fn = inb.indexOf('async function upsertIdentity(');
    const lock = inb.indexOf('pg_advisory_xact_lock(hashtext(${job.channelId}', fn);
    const select = inb.indexOf('.from(channelIdentities)', fn);
    expect(fn).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(fn);
    expect(lock).toBeLessThan(select);
  });

  it('★ والجهةُ اليتيمةُ تُمحى إن سبقنا غيرُنا رغم القفل — لا صفٌّ «مكرّرٌ» لا يشرحه أحد', () => {
    const at = inb.indexOf('if (identity) return identity;');
    const again = inb.indexOf('const again = await tx', at);
    const del = inb.indexOf('await tx.delete(contacts).where(eq(contacts.id, contact!.id));', at);
    expect(del).toBeGreaterThan(at);
    expect(del).toBeLessThan(again);
  });
});
